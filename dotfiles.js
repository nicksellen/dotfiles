#!/usr/bin/env node

var app = require('commander');
var execSync = require('child_process').execSync;
var spawnSync = require('child_process').spawnSync;
var fs = require('fs');
var fse = require('fs-extra');
var paths = require('path');
var format = require('util').format;
var os = require('os');

var command = app.command.bind(app);

var HOME_DIR = process.env['HOME'];
var DOTFILE_DIR = paths.join(HOME_DIR, '.dotfiles');
var CONFIG_FILE = paths.join(DOTFILE_DIR, 'config.json');
var FILES_DIR = paths.join(DOTFILE_DIR, 'content');

var AUTO_PULL = true; // TODO: make it configurable
var AUTO_PUSH = true; // TODO: make it configurable

var ALL = function(){ return true; };

var SYSTEM_TAGS = {};
SYSTEM_TAGS.os = os.platform();
SYSTEM_TAGS.hostname = os.hostname();

var HOME_DIR_RE = new RegExp('^' + escapeRegExp(HOME_DIR + '/'));

function check(ok, errorMessage) {
  if (ok) return;
  var fmtArgs = new Array(arguments.length - 1);
  fmtArgs[0] = errorMessage;
  for (var i = 2; i < arguments.length; i++) {
    fmtArgs[i - 1] = arguments[i];
  }
  console.error(format.apply(null, fmtArgs));
  process.exit(1);
}

app.option('-x, --expand', 'expand ~ (list command)');
app.option('-t, --tags', 'print tags too (list command)');
app.option('-a, --all', 'include entries not for this system (list command)');

command('list').description('list paths').action(printList);

command('tag [path] [key] [value]').description('tag a path').action(function(path, key, value){
  check(path && key && value, 'path/key/value required');
  path = collapseHomeDir(path);
  var state = load();
  var entry = getEntryForPath(state, path);
  check(entry, 'no entry found for %s', path);
  console.log('tagging', path, key, value);
  if (!entry.tags) entry.tags = {};
  entry.tags[key] = value;
  save(state);
  git('add', 'config.json');
});

command('untag [path] [key]').description('tag a path').action(function(path, key){
  check(path && key, 'path/key required');
  path = collapseHomeDir(path);
  var state = load();
  var entry = getEntryForPath(state, path);
  check(entry, 'no entry found for %s', path);
  if (!entry.tags) entry.tags = {};
  check(entry.tags.hasOwnProperty(key), '%s is not tagged with %s', path, key);
  console.log('untagging', path, key);
  delete entry.tags[key];
  save(state);
  git('add', 'config.json');
});

command('add [path]').description('register a path').action(function(path){
  if (!path) return console.error('requires path arg');

  path = collapseHomeDir(path);

  var state = load();
  var entry = getEntryForPath(state, path);
  check(!entry, 'we have an existing entry for %s', path);

  var entry = {
    path: path,
    guid: generateGuid(),
    tags: {}
  };

  var src = getEntrySystemPath(entry);
  if (!fs.existsSync(src)) {
    console.error(src, 'not found');
    return;
  }
  state.entries.push(entry);
  copyEntryFromSystemToContent(entry);
  save(state);
  git('add', '-A');
});

command('rm [path]').description('unregister a path').action(function(path){
  if (!path) return console.error('requires path arg');

  path = collapseHomeDir(path);

  var state = load();
  var changed = false;
  var i = 0;
  while (i < state.entries.length) {
    var entry = state.entries[i];
    if (entry.path === path) {
      state.entries.splice(i, 1);
      var contentPath = paths.join(FILES_DIR, entry.guid);
      if (fs.existsSync(contentPath)) {
        fs.unlinkSync(contentPath);
      }
      changed = true;
    } else {
      i++;
    }
  }
  if (changed) {
    save(state);
    git('add', '-A');
  } else {
    console.log('Nothing to do!');
  }
});

command('load').description('.dotfiles > system').action(function(){

  if (AUTO_PULL) git('pull');

  var state = load();

  var entriesToCopy = [];

  state.entries.filter(entryIsForThisSystem).forEach(function(entry){
    var src = getEntryContentPath(entry);
    var dst = getEntrySystemPath(entry);
    if (canCopy(src, dst)) {
      entriesToCopy.push(entry);
    }
  });

  if (entriesToCopy.length > 0) {
    diffEntries(entriesToCopy, true);
    ask('\nConfirm load changes [y/n] ? ', function(answer) {
      if (answer !== 'y') return;
      entriesToCopy.forEach(function(entry){
        copyEntryFromContentToSystem(entry);
      });
    });
  } else {
    console.log('Nothing to do!');
  }

});

command('save [message]').description('system > .dotfiles').action(function(message){
  var state = load();
  var entriesToCopy = [];
  state.entries.filter(entryIsForThisSystem).forEach(function(entry){
    var src = getEntrySystemPath(entry);
    var dst = getEntryContentPath(entry);
    if (canCopy(src, dst)) {
      entriesToCopy.push(entry);
    }
  });
  if (entriesToCopy.length > 0) {
    diffEntries(entriesToCopy);
    ask('\nConfirm save changes [y/n] ? ', function(answer){
      if (answer !== 'y') return;
      var changedPaths = [];
      entriesToCopy.forEach(function(entry){
        copyEntryFromSystemToContent(entry);
        changedPaths.push(entry.path);
      });
      commit(message || 'updated content ' + changedPaths.join(', '));
      if (AUTO_PUSH) git('push');
    });
  } else {
    console.log('Nothing to do!');
  }
});

command('init').description('init ' + DOTFILE_DIR).action(function(){

  if (fs.existsSync(DOTFILE_DIR)) {
    if (fs.statSync(DOTFILE_DIR).isFile()) {
      console.error('cannot be file', DOTFILE_DIR);
      process.exit(2);
    }
  } else {
    fs.mkdirSync(DOTFILE_DIR);
  }
  git('init');

  var changed = false;

  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR);
    changed = true;
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    changed = true;
    save({});
  }
  
  if (changed) {
    commit();
  }

});

command('diff [path]').description('show diff from system > .dotfiles').action(function(path){
  var state = load();
  var entries;
  if (path) {
    var entry = getEntryForPath(load(), path);
    if (!entry) return console.error('no entry for', path);
    entries = [entry];
  } else {
    entries = state.entries;
  }
  diffEntries(entries);
});

command('push').description('run git push').action(function(){
  git('push'); // just a shortcut for git push
});

command('pull').description('run git pull').action(function(){
  git('pull'); // just a shortcut for git pull
});

command('git').description('run git commands in ' + DOTFILE_DIR).action(function(){
  // this never gets called as we handle it before that
  // it's just so it appears in the usage list
});

command('help').description('show help').action(function(arg) {
  app.help();
});

// unmatched
// TODO: how do I stop this appearing in the usage?
command('*').description('invalid command').action(function(arg) {
  console.error("invalid command: '%s'", arg);
  app.help();
});

// have to intercept the 'git' subcommand so we can take full control
if (process.argv[2] === 'git') {
  var res = git.apply(null, process.argv.slice(3));
  process.exit(res.status);
}

app.parse(process.argv);

if (app.args.length === 0) {
  printList();
  process.exit(0);
}

function run() {
  var args = argumentsToArray(arguments);
  var cmd = args.shift();
  return spawnSync(cmd, args, {
    cwd: DOTFILE_DIR,
    stdio: [process.stdin, process.stdout, process.stderr]
  });
}

function git() {
  var args = argumentsToArray(arguments);
  args.unshift('git');
  return run.apply(null, args);
}

function load() {
  var state = {};
  if (fs.existsSync(CONFIG_FILE)) {
    state = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
  if (!state.entries) state.entries = [];
  return state;
}

function save(state) {
  var data = JSON.stringify(state, null, 2);
  fs.writeFileSync(CONFIG_FILE, data);
}

function commit(message) {
  git('add', '-A');
  git('commit', '-m', message || 'update');
}

function getEntryForPath(state, path) {
  for (var i = 0; i < state.entries.length; i++) {
    var entry = state.entries[i];
    if (entry.path === path) {
      return entry;
    }
  }
}

function getEntrySystemPath(entry) {
  return expandHomeDir(entry.path);
}

function getEntryContentPath(entry) {
  return paths.join(FILES_DIR, entry.guid);  
}

function expandHomeDir(path) {
  return path.replace(/~/g, HOME_DIR);
}

function collapseHomeDir(path) {
  if (HOME_DIR_RE.test(path)) {
    return '~' + path.substring(HOME_DIR.length);
  } else {
    return path;
  }
}

function generateGuid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}

function fileContentsEqual(a, b) {
  if (!a || !b) return false;
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  return fs.readFileSync(a).toString() === fs.readFileSync(b).toString();
}

function ask(question, callback) {
  var readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  readline.question(question, function(answer) {
    readline.close();
    callback(answer);
  });
}

function canCopy(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn('not found on system', src);
    return false;
  }
  var srcStat = fs.statSync(src);
  if (srcStat.isDirectory()) {
    console.error('not handling directories yet', src);
    return false;
  } else if (!srcStat.isFile()) {
    console.warn('not found on system', src);
    return false;
  } else if (fileContentsEqual(src, dst)) {
    // contents are the same
    return false;
  }
  return true;
}

function copyEntryFromSystemToContent(entry) {
  var src = getEntrySystemPath(entry);
  var dst = getEntryContentPath(entry);
  if (canCopy(src, dst)) {
    fse.copySync(src, dst);  
    return true;
  } else {
    return false;
  }
}

function copyEntryFromContentToSystem(entry) {
  var src = getEntryContentPath(entry);
  var dst = getEntrySystemPath(entry);
  if (canCopy(src, dst)) {
    fse.copySync(src, dst);  
    return true;
  } else {
    return false;
  }
}

function printList() {
  var state = load();
  var filter = app.all ? ALL : entryIsForThisSystem;
  state.entries.filter(filter).forEach(function(entry){
    var path = entry.path;
    if (app.expand) {
      path = expandHomeDir(path);
    }
    if (app.tags && entry.tags) {
      path += ' ';
      path += Object.keys(entry.tags).sort().map(function(tag){
        return format('%s=%s', tag, entry.tags[tag]);
      }).join(' ');
    }
    console.log(path);
  });
}

function argumentsToArray(args) {
  var ary = new Array(args.length);
  for (var i = 0; i < args.length; i++) {
    ary[i] = args[i];
  }
  return ary;
}

function entryIsForThisSystem(entry) {
  if (!entry.tags) return true;
  var tagKeys = Object.keys(SYSTEM_TAGS);
  for (var i = 0; i < tagKeys.length; i++) {
    var key = tagKeys[i];
    if (!entry.tags.hasOwnProperty(key)) continue;
    var systemValue = SYSTEM_TAGS[key];
    var entryValue = entry.tags[key];
    if (systemValue !== entryValue) {
      return false;
    }
  }
  return true;
}

function diffEntries(entries, inverse) {
  entries.forEach(function(entry){
    var contentPath = getEntryContentPath(entry);
    var systemPath = getEntrySystemPath(entry);
    if (inverse) {
      diff(systemPath, contentPath);
    } else {
      diff(contentPath, systemPath);
    }
  });
}

var __diffFn;
function loadDiffFn() {
  var args = ['diff', '-u'];
  if (spawnSync('which', ['grc']).status === 0) {
    args.unshift('grc');
  }
  return function(a, b) {
    run.apply(null, args.concat(a, b));
  };  
}

function diff(a, b) {
  if (!__diffFn) __diffFn = loadDiffFn();
  __diffFn(a, b);
}

// http://stackoverflow.com/a/6969486
function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}