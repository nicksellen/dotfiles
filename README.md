# dotfiles

Yet another dotfile manager.

Features/overview:

* register paths one-by-one for inclusion
* store a copy of the file at each registered path and some metadata in `~/.dotfiles` along with a generated uuid
* manage copying to/from the original path on your system
* tag entries for inclusion on your system by os/hostname/architecture (coming soon)
* `~/.dotfiles` is a git repo which you can manage arbitarily from anywhere with `dotfiles git <normal git args>` - add remotes/branches/whatever
* not very mature - use at your own risk

## installation

````
npm install -g https://github.com/nicksellen/dotfiles
````

## coloured diff

If you have [grc](https://github.com/garabik/grc) on your path it will use it for coloured diffs (`brew install grc` on osx does the trick).

![dotfiles save screenshot](http://nicksellen.co.uk/upld/dotfiles.save.png)

## ~ handling

If the path you register/unregister starts with your home dir it will replace it with a `~`. This means you don't need to worry about bash expansion of the `~` and you can use the dotfiles on another system and it'll still use your correct home dir.

## commands

### init

````
dotfiles init
````

* creates `~/.dotfiles`
* creates `~/.dotfiles/config.json`
* runs `git init` inside `~/.dotfiles`

### register

Register a path into dotfiles, and copy the contents.

````
dotfiles register ~/.ssh/config
````

* adds an entry to `~/.ssh/config.json`
* copies the file into `~/.dotfiles/content/<uuid>`
* `git add -A` and `git commit`

### unregister

Unregister a path from dotfiles, and remove the saved contents.

````
dotfiles unregister ~/.ssh/config
````

* removes entry from `~/.ssh/config.json` matching on name
* removes the entry at `~/.dotfiles/content/<uuid>`
* `git add -A` and `git commit`

### list

List all registered files.

````
dotfiles
````

### save

Copy changes from system into `~/.dotfiles`.

````
dotfiles save
````

* loops through entries in `config.json`
* if any files on system have changed, copy contents into `~/.dotfiles/content/<uuid>`
* if any changes shows a diff and asks for confirmation
* `git add -A` and `git commit`
* `git push` (should be made configurable)

### load

Load dotfiles onto your system

````
dotfiles load
````

* `git pull` (should be made configurable)
* loops through entries in `config.json`
* if any files on system are different add to list
* if list contains any entries, shows a diff and asks for confirmation
* write content from `~/.dotfiles/content/<uuid>` to `<path>`

### git

You can run arbitary git commands, and they will be run from the `~/.dotfiles` dir - inspired by [pass](http://www.passwordstore.org/). 

E.g. add a remote:

````
dotfiles git remote add origin <url>
````

````
dotfiles git push -u origin master
````

## TODO

* make it handle directories properly
* add some tests
* make it handle tags/filters for entries
* think about git branching