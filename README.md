# dotfiles

## init

````
dotfiles init
````

* creates `~/.dotfiles`
* creates `~/.dotfiles/config.json`
* runs `git init` inside `~/.dotfiles`

## register

Register a path into dotfiles, and copy the contents.

````
dotfiles register '~/.ssh/config'
````

* adds an entry to `~/.ssh/config.json`
* copies the file into `~/.dotfiles/content/<uuid>`
* `git add -A` and `git commit`

## unregister

Unregister a path from dotfiles, and remove the saved contents.

````
dotfiles unregister '~/.ssh/config'
````

* removes entry from `~/.ssh/config.json` matching on name
* removes the entry at `~/.dotfiles/content/<uuid>`
* `git add -A` and `git commit`

## save

Copy changes from system into `~/.dotfiles`.

````
dotfiles save
````

* loops through entries in `config.json`
* if any files on system have changed, copy contents into `~/.dotfiles/content/<uuid>`
* `git add -A` and `git commit` if any changes

## load

Load dotfiles onto your system

````
dotfiles load
````

* loops through entries in `config.json`
* if any files on system are different add to list
* if list contains any entries, ask for confirmation
* write content from `~/.dotfiles/content/<uuid>` to `<path>`

## git

You can run arbitary git commands, and they will be run from the `~/.dotfiles` dir - inspired by [pass](http://www.passwordstore.org/). 

E.g. add a remote:

````
dotfiles git remote add origin <url>
````

````
dotfiles git push -u origin master
````