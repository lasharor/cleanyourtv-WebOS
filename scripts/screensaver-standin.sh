#!/bin/sh
# Stands in for LG's screen saver program on TVs where it is native (tvprofile.js saverTakeover 'standin').
# 20-cleanyourtv-screensaver bind-mounts this file over that program, so the app manager keeps LG's screen saver manifest and starts
# this script whenever the screen saver starts. The script asks webapp-mgr to open the page as com.webos.app.screensaver and stays
# while the page is up: the app manager counts this program as the app. The page closes on the first key; the service also closes it
# when the TV is back on an app (helper/screensaver.js). Every step goes to /tmp/cleanyourtv-boot.log, which Share log includes.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
LOG=/tmp/cleanyourtv-boot.log
up() { cut -d' ' -f1 /proc/uptime; }
log() { echo "$(up) saver-standin[$$]: $*" >> $LOG 2>/dev/null; }

# a previous copy the app manager killed can leave nothing behind, but two of them would open two pages
for p in $(pgrep -f "^/bin/sh $0"); do [ "$p" != $$ ] && kill "$p" 2>/dev/null; done

REQ=$L/wam-launch-saver.json
[ -f $REQ ] || { log "no $REQ: the screen saver page was not staged"; exit 1; }
r=$(luna-send -n 1 -w 8000 luna://com.palm.webappmanager/launchApp "$(cat $REQ)" </dev/null 2>&1 | tr -d '\n')
case "$r" in
  *'"returnValue": *true'*) log "the page is open" ;;
  *) log "webapp-mgr refused the page: $(echo "$r" | cut -c1-200)"; exit 1 ;;
esac

# stay while the page is up; then the screen saver is over and this program ends with it
n=0
while luna-send -n 1 -w 3000 luna://com.palm.webappmanager/listRunningApps '{}' </dev/null 2>/dev/null | grep -q 'com.webos.app.screensaver'; do
  sleep 5
  n=$((n + 1))
  [ $n -gt 8640 ] && { log "12 hours; stopping"; exit 0; }
done
log "the page is gone; the screen saver ends"
