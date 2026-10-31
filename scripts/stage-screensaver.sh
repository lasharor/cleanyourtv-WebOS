#!/bin/sh
# Build the directory that is mounted over LG's screen saver app: our page plus an appinfo.json derived from this TV's own stock
# screen saver (saved in backup/screensaver-appinfo.orig.json), switched to the web type with the overlay window.
# Safe to re-run while mounted: the page's files are replaced where they already are.
L=/media/developer/cleanyourtv
H=/usr/palm/applications/com.webos.app.screensaver
S=$L/screensaver-overlay
[ -d $L/screensaver/app ] || exit 1
# already staged and unchanged (the usual boot): copying it again and running node three times costs seconds for nothing
if [ -f $S/appinfo.json ] && cmp -s $L/screensaver/app/index.html $S/index.html; then exit 0; fi
mkdir -p $S
cp $L/screensaver/app/* $S/
# the stock screen saver's icons, once: the derived appinfo.json names them, and the overlay folder hides theirs
for f in icon.png largeIcon.png iconSplash.png; do
  [ -f $H/$f ] && [ ! -f $S/$f ] && cp $H/$f $S/$f 2>/dev/null
done
node $L/jtool.js saver "$L/backup/screensaver-appinfo.orig.json" "$S/appinfo.json"
# what scripts/screensaver-standin.sh sends to webapp-mgr where LG's screen saver is the native program (saverTakeover 'standin')
node $L/jtool.js wamlaunch "$S/appinfo.json" "$S" "$L/wam-launch-saver.json" cleanyourtv-screensaver
