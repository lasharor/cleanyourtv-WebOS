#!/bin/sh
# Stands in for LG's screen saver program on TVs where it is native (tvprofile.js saverTakeover 'standin').
# 20-cleanyourtv-screensaver bind-mounts this file over that program, so the app manager keeps LG's screen saver manifest and starts
# this script whenever the screen saver starts. The script asks webapp-mgr to open the page as com.webos.app.screensaver and stays
# while the page is up: the app manager counts this program as the app. The page closes on the first key; the service also closes it
# when the TV is back on an app (helper/screensaver.js). Every step goes to /tmp/cleanyourtv-boot.log, which Share log includes.
# The paths and the pace can be pointed elsewhere for the tests (tools/test/screensaver.test.js); on the TV none of them is set.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=${CYTV_DIR:-/media/developer/cleanyourtv}
LOG=${CYTV_BOOT_LOG:-/tmp/cleanyourtv-boot.log}
EVERY=${CYTV_SS_SECS:-5}   # seconds between two readings of the running apps
up() { cut -d' ' -f1 /proc/uptime 2>/dev/null; }
log() { echo "$(up) saver-standin[$$]: $*" >> $LOG 2>/dev/null; }

# a previous copy the app manager killed can leave nothing behind, but two of them would open two pages
for p in $(pgrep -f "^/bin/sh $0"); do [ "$p" != $$ ] && kill "$p" 2>/dev/null; done

REQ=$L/wam-launch-saver.json
[ -f $REQ ] || { log "no $REQ: the screen saver page was not staged"; exit 1; }
r=$(luna-send -n 1 -w 8000 luna://com.palm.webappmanager/launchApp "$(cat $REQ)" </dev/null 2>&1 | tr -d '\n')
# a regex, not a case pattern: inside quotes a case pattern's * is a literal star, so '"returnValue": *true' never matched the reply
if echo "$r" | grep -q '"returnValue": *true'; then
  log "the page is open"
else
  log "webapp-mgr refused the page: $(echo "$r" | cut -c1-200)"; exit 1
fi

# Stay while the page is up; then the screen saver is over and this program ends with it. The running list of the app manager lags by
# seconds after a start and after a close, so one reading decides nothing (AGENTS.md): a page that has not shown up yet gets ten
# readings (50 seconds) to appear, and a page that was seen is gone after three readings without it (15 seconds).
n=0; seen=0; miss=0
while [ $n -le 8640 ]; do
  if luna-send -n 1 -w 3000 luna://com.palm.webappmanager/listRunningApps '{}' </dev/null 2>/dev/null | grep -q 'com.webos.app.screensaver'; then
    [ $seen = 0 ] && log "the page is listed"
    seen=1; miss=0
  else
    miss=$((miss + 1))
    if [ $seen = 0 ] && [ $miss -ge 10 ]; then log "the page never appeared; the screen saver ends"; exit 1; fi
    if [ $seen = 1 ] && [ $miss -ge 3 ]; then log "the page is gone; the screen saver ends"; exit 0; fi
  fi
  sleep $EVERY
  n=$((n + 1))
done
log "12 hours; stopping"
