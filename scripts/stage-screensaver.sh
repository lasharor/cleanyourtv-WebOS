#!/bin/sh
# Build the folder that is mounted over LG's screen saver app: our page plus an appinfo.json derived from this TV's own stock
# screen saver (saved in backup/screensaver-appinfo.orig.json), switched to the web type while it keeps LG's own window type
# ("screenSaver", which is what tvpowerd counts as the screen saver; jtool.js saver).
# Safe to re-run while mounted: the page's files are replaced where they already are.
# The paths can be pointed elsewhere for the tests (tools/test/screensaver.test.js); on the TV CYTV_TEST_ROOT is not set.
R=${CYTV_TEST_ROOT:-}
L=$R/media/developer/cleanyourtv
H=$R/usr/palm/applications/com.webos.app.screensaver
S=$L/screensaver-overlay
T=$L/.stage-screensaver   # what jtool writes, compared with the staged files before anything is copied
[ -d $L/screensaver/app ] || exit 1
[ -f $L/backup/screensaver-appinfo.orig.json ] || exit 1   # without LG's own manifest the derived one would have no app id
mkdir -p $S $T
node $L/jtool.js saver "$L/backup/screensaver-appinfo.orig.json" "$T/appinfo.json" || exit 1
# Already staged and unchanged (the usual boot): the page AND the generated manifest are compared, because the manifest follows this
# TV's stock screen saver and jtool.js, not only the page. Copying it again costs time for nothing.
if cmp -s $L/screensaver/app/index.html $S/index.html && cmp -s $T/appinfo.json $S/appinfo.json; then
  rm -rf $T
  exit 0
fi
cp -r $L/screensaver/app/* $S/ || exit 1
# the stock screen saver's icons, once: the derived appinfo.json names them, and the overlay folder hides theirs. While the folder is
# mounted, $H is this folder (the icon is there already, so nothing is copied); on a first stage it is LG's own folder.
for f in icon.png largeIcon.png iconSplash.png; do
  [ -f $H/$f ] && [ ! -f $S/$f ] && cp $H/$f $S/$f 2>/dev/null
done
mv $T/appinfo.json $S/appinfo.json || exit 1
rm -rf $T
exit 0
