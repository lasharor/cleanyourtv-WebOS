#!/bin/sh
# Build the directory that gets bind-mounted over LG's Home: the launcher page plus an appinfo.json derived
# from this TV's own stock Home (nothing of LG's is shipped in the repo). Safe to re-run while mounted.
L=/media/developer/cleanyourtv
S=$L/home-overlay
mkdir -p $S
# only what changed: the launcher's files (with the photos of the seasons, several MB) are not copied again at every boot, while the
# TV is still busy starting; a file that is gone from app/ is removed
for f in $L/app/*; do
  n=${f##*/}
  [ -f "$S/$n" ] && [ ! "$f" -nt "$S/$n" ] && cmp -s "$f" "$S/$n" && continue
  cp "$f" "$S/$n"
done
for f in $S/*; do
  n=${f##*/}
  case "$n" in appinfo.json) continue ;; esac
  [ -e "$L/app/$n" ] || rm -f "$f"
done
node $L/jtool.js stage "$L/backup/home-appinfo.orig.json" "$S/appinfo.json"
# what scripts/home-standin.sh sends to webapp-mgr where LG's Home is the native program (homeTakeover 'standin')
node $L/jtool.js wamlaunch "$S/appinfo.json" "$S" "$L/wam-launch.json"
