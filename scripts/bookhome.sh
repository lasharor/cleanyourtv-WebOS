#!/bin/sh
# The Home key while a page of the launcher's book shows (helper/book.js binds the code learned in the manager, else 773, only then): asking the
# app manager for Home is the same relaunch webOS sends when Home is brought forward from another app, and the launcher turns back
# to its first page on it. Without this, a press would do nothing: webOS sees the Home app in front (the page is its iframe) and
# does not relaunch it.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r /media/developer/cleanyourtv/luna-compat.sh ] || . /media/developer/cleanyourtv/luna-compat.sh
# where home-standin.sh stands in for LG's native Home, it takes the parameters from this file (issue 26)
[ -f /tmp/cleanyourtv-home-standin ] && { read -r UP _ < /proc/uptime; echo "$UP {\"keepAlive\":true}" > /tmp/cleanyourtv-home-params; }
luna_send -n 1 -w 3000 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home","params":{"keepAlive":true}}' >/dev/null 2>&1
