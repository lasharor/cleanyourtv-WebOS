#!/bin/sh
# Stands in for LG's screen saver program on TVs where it is native (tvprofile.js saverTakeover 'standin').
# 20-cleanyourtv-screensaver bind-mounts this file over that program, so the app manager keeps LG's screen saver manifest and starts
# this script whenever the screen saver starts. The script asks webapp-mgr to open the page as com.webos.app.screensaver and stays
# while the page is up: the app manager counts this program as the app. The page closes on the first key; the service also closes it
# when the TV is back on an app (helper/screensaver.js). Every step goes to /tmp/cleanyourtv-boot.log, which Share log includes.
# When our page does not open (webapp-mgr refuses it, or it never shows up), LG's own screen saver runs instead for this boot: the
# stand-in unmounts itself and starts LG's program, notes the failure for the service (/tmp/cleanyourtv-saver-failed, shown in the
# manager) and counts it; after two boots in a row with a failure, 20-cleanyourtv-screensaver uses the folder mount instead.
# The paths and the pace can be pointed elsewhere for the tests (tools/test/screensaver.test.js); on the TV none of them is set.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
[ -n "$CYTV_TEST_BIN" ] && export PATH=$CYTV_TEST_BIN:$PATH
L=${CYTV_DIR:-/media/developer/cleanyourtv}
LOG=${CYTV_BOOT_LOG:-/tmp/cleanyourtv-boot.log}
PROG=${CYTV_SA_PROGRAM:-$0}                      # LG's program: this script is bind-mounted over it, so it runs under that path
FAILED=${CYTV_SA_FAILED:-/tmp/cleanyourtv-saver-failed}
FAILS=$L/screensaver-standin-fails               # boots in a row where the page did not open (20-cleanyourtv-screensaver reads it)
EVERY=${CYTV_SS_SECS:-10}  # seconds between two readings of the running apps (a luna-send spawn each: not every few seconds all night)
up() { cut -d' ' -f1 /proc/uptime 2>/dev/null; }
log() { echo "$(up) saver-standin[$$]: $*" >> $LOG 2>/dev/null; }

# Our page did not open: LG's screen saver for this boot instead of none. The mount over LG's program comes off, and when the file
# under that path is LG's again (not this script), it takes over this process with the app manager's arguments.
fallback() {
  log "$1; LG's own screen saver until the next boot"
  shift   # what is left are the app manager's arguments, for LG's program
  touch $FAILED 2>/dev/null
  echo $(( $(cat $FAILS 2>/dev/null || echo 0) + 1 )) > $FAILS 2>/dev/null
  umount "$PROG" 2>/dev/null
  if [ -f "$PROG" ] && ! cmp -s "$PROG" "$L/screensaver-standin.sh"; then
    log "starting LG's screen saver program $PROG"
    exec "$PROG" "$@"
  fi
  log "LG's screen saver program could not be brought back (the stand-in is still mounted over $PROG)"
  exit 1
}

# a previous copy the app manager killed can leave nothing behind, but two of them would open two pages
for p in $(pgrep -f "^/bin/sh $0"); do [ "$p" != $$ ] && kill "$p" 2>/dev/null; done

REQ=$L/wam-launch-saver.json
[ -f $REQ ] || fallback "no $REQ: the screen saver page was not staged" "$@"
r=$(luna-send -n 1 -w 8000 luna://com.palm.webappmanager/launchApp "$(cat $REQ)" </dev/null 2>&1 | tr -d '\n')
# a regex, not a case pattern: inside quotes a case pattern's * is a literal star, so '"returnValue": *true' never matched the reply
if echo "$r" | grep -q '"returnValue": *true'; then
  log "the page is open"
else
  fallback "webapp-mgr refused the page: $(echo "$r" | cut -c1-200)" "$@"
fi

# Stay while the page is up; then the screen saver is over and this program ends with it. The running list of the app manager lags by
# seconds after a start and after a close, so one reading decides nothing (AGENTS.md): a page that has not shown up yet gets five
# readings (50 seconds) to appear, and a page that was seen is gone after two readings without it (20 seconds).
n=0; seen=0; miss=0
while [ $n -le 4320 ]; do
  if luna-send -n 1 -w 3000 luna://com.palm.webappmanager/listRunningApps '{}' </dev/null 2>/dev/null | grep -q 'com.webos.app.screensaver'; then
    [ $seen = 0 ] && { log "the page is listed"; rm -f $FAILS; }   # it works: no failure counted any more
    seen=1; miss=0
  else
    miss=$((miss + 1))
    if [ $seen = 0 ] && [ $miss -ge 5 ]; then
      luna-send -n 1 -w 3000 luna://com.palm.webappmanager/killApp '{"appId":"com.webos.app.screensaver"}' </dev/null >/dev/null 2>&1
      fallback "the page never appeared" "$@"
    fi
    if [ $seen = 1 ] && [ $miss -ge 2 ]; then log "the page is gone; the screen saver ends"; exit 0; fi
  fi
  sleep $EVERY
  n=$((n + 1))
done
log "12 hours; stopping"
