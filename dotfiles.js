#!/usr/bin/env node

var app = require('commander');
var execSync = require('child_process').execSync;
var spawnSync = require('child_process').spawnSync;
var fs = require('fs');
var fse = require('fs-extra');
var paths = require('path');

var command = app.command.bind(app);

var HOME_DIR = process.env['HOME'];
var DOTFILE_DIR = paths.join(HOME_DIR, '.dotfiles');
var CONFIG_FILE = paths.join(DOTFILE_DIR, 'config.json');
var FILES_DIR = paths.join(DOTFILE_DIR, 'content');

var AUTO_PULL = true; // TODO: make it configurable
var AUTO_PUSH = true; // TODO: make it configurable

var HOME_DIR_RE = new RegExp('^' + escapeRegExp(HOME_DIR + '/'));

command('list').description('list paths').action(printList);

command('register [path]').description('register a path').action(function(path){
  if (!path) return console.error('requires path arg');

  if (HOME_DIR_RE.test(path)) {
    path = '~' + path.substring(HOME_DIR.length);
  }
  var state = load();
  var entry = getEntryForPath(state, path);
  if (entry) return console.log('we have an existing entry for', path);

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
  commit('registered ' + path);
  if (AUTO_PUSH) git('push');
});

command('unregister [path]').description('unregister a path').action(function(path){
  if (!path) return console.error('requires path arg');

  if (HOME_DIR_RE.test(path)) {
    path = '~' + path.substring(HOME_DIR.length);
  }

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
    commit('unregistered ' + path);
  } else {
    console.log('Nothing to do!');
  }
});

command('load').description('.dotfiles > system').action(function(){

  if (AUTO_PULL) git('pull');

  var state = load();

  var entriesToCopy = [];

  state.entries.forEach(function(entry){
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

command('save').description('system > .dotfiles').action(function(){
  var state = load();
  var entriesToCopy = [];
  state.entries.forEach(function(entry){
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
      commit('updated content ' + changedPaths.join(', '));
      if (AUTO_PUSH) git('push');
    });
  } else {
    console.log('Nothing to do!');
  }
});

command('init').description('init ' + DOTFILE_DIR).action(function(){
  var stat = fs.statSync(DOTFILE_DIR);

  if (stat.isFile()) {
    console.error('cannot be file', DOTFILE_DIR);
    process.exit(2);
  } else if (!stat.isDirectory()) {
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
  return entry.path.replace(/~/g, HOME_DIR);
}

function getEntryContentPath(entry) {
  return paths.join(FILES_DIR, entry.guid);  
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
  state.entries.forEach(function(entry){
    console.log(entry.path);
  });
}

function argumentsToArray(args) {
  var ary = new Array(args.length);
  for (var i = 0; i < args.length; i++) {
    ary[i] = args[i];
  }
  return ary;
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