#!/bin/sh
# Put LG's own volume bar back as the TV had it. A custom volume bar (helper/audio.js) switches LG's setting
# com.webos.surfacemanager.volumeOSD off and saves what it was in backup/volume-osd.orig; this sets it back and forgets the copy.
# Run by undo-home.sh and uninstall.sh; safe to run when nothing was changed.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r /media/developer/cleanyourtv/luna-compat.sh ] || . /media/developer/cleanyourtv/luna-compat.sh
S=/media/developer/cleanyourtv/backup/volume-osd.orig
[ -f $S ] || exit 0
v=$(cat $S)
case "$v" in true|false) ;; *) v=true ;; esac
if luna_send -n 1 -w 5000 -f luna://com.webos.service.config/setConfigs "{\"configs\":{\"com.webos.surfacemanager.volumeOSD\":$v}}" 2>/dev/null | grep -q '"returnValue": *true'; then
  rm -f $S
  echo "LG's volume bar is back (volumeOSD=$v)"
else
  echo "LG's volume bar could not be put back; the copy stays in $S" >&2
  exit 1
fi
