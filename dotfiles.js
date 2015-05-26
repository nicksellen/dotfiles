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

command('list').description('list paths').action(printList);

command('register [path]').description('register a path').action(function(path){
  if (!path) {
    console.error('requires path arg');
    return;
  }
  var state = load();
  var entry = getEntryForPath(state, path);
  if (entry) return console.log('we have an existing entry for', path);
  var src = getEntrySystemPath(entry);
  if (!fs.existsSync(src)) {
    console.error(src, 'not found');
    return;
  }
  var entry = {
    path: path,
    guid: generateGuid(),
    tags: {}
  };
  state.entries.push(entry);
  copyEntry(entry);
  save(state);
  commit('registered ' + path);
});

command('unregister [path]').description('unregister a path').action(function(path){
  if (!path) return console.error('requires path arg');

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

  var state = load();

  var entriesToCopy = [];

  state.entries.forEach(function(entry){
    var src = getEntryContentPath(entry);
    var dst = getEntrySystemPath(entry);
    if (!fs.existsSync(src)) {
      console.error('missing content file for', entry.path, 'should be at', src);
      return;
    }
    var dstStat = fs.statSync(dst);
    if (dstStat.isDirectory()) {
      console.error('not handling directories yet', dst);
      return;
    } else if (fileContentsEqual(src, dst)) {
      // contents are the same
      return;
    }
    entry.src = src;
    entry.dst = dst;
    entriesToCopy.push(entry);
  });

  if (entriesToCopy.length > 0) {
    entriesToCopy.forEach(function(entry){
      var src = entry.src;
      var dst = entry.dst;
      if (fs.existsSync(dst)) {
        console.log('* overwrite', dst);
      } else {
        console.log('+ create   ', dst);
      }
    });
    ask('Confirm [y/n] ? ', function(answer) {
      if (answer !== 'y') return;
      entriesToCopy.forEach(function(entry){
        fse.copySync(entry.src, entry.dst);
      });
    });
  } else {
    console.log('Nothing to do!');
  }

});

command('save').description('system > .dotfiles').action(function(){
  var state = load();
  var changedPaths = [];
  state.entries.forEach(function(entry){
    if (copyEntry(entry)) {
      changedPaths.push(entry.path);
    }
  });
  if (changedPaths.length > 0) {
    commit('updated content ' + changedPaths.join(', '));
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

  var diff = requireDiff();

  entries.forEach(function(entry){
    var contentPath = getEntryContentPath(entry);
    var systemPath = getEntrySystemPath(entry);
    diff(contentPath, systemPath);
  });
});

command('push').description('run git push').action(function(){
  // just a shortcut for dotfiles git push really
  git('push');
});

command('git').description('run git commands in ' + DOTFILE_DIR).action(function(){
  // this never gets called as we handle it before that
  // it's just so it appears in the list of commands
});

command('help').description('show help').action(function(arg) {
  app.help();
});

command('*').description('invalid command').action(function(arg) {
  console.error("invalid command: '%s'", arg);
  app.help();
});

// have to do it like this so commander doesn't try and parse git options
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

function copyEntry(entry) {
  var src = getEntrySystemPath(entry);
  var dst = getEntryContentPath(entry);
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
  fse.copySync(src, dst);  
  return true;
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

function requireDiff() {
  var args = ['diff', '-u'];
  if (spawnSync('which', ['grc']).status === 0) {
    args.unshift('grc');
  }
  return function(a, b) {
    run.apply(null, args.concat(a, b));
  };
}