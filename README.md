# dotfiles

Yet another dotfile manager.

Features:

* uses git to store file content
* register entries with `~` - will get expanded on user system
* allows arbitary git commands on repo (e.g. add remotes anyway you like)
* tag entries for inclusion by os/hostname/architecture (coming soon)
* include whole directory trees (coming soon)

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

(note the single quotes around arg to avoid bash expansion - we want it to be portable)

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