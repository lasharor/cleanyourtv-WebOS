#!/bin/sh
# The service's watchdog, started by 10-cleanyourtv-home (one per boot, also while LG's Home is selected). Every 10 seconds it asks the
# service; when it does not answer:
#   - if the service is not running at all (it exited, for example on a Node 8 libuv assertion, issue 65) it starts it again, notes that
#     in the boot log and adds the service log of the run that ended to cleanyourtv-helper.crash.log (the last 400 lines are kept, so a
#     service that crashes again at once does not wipe the first cause; Share log includes it). This happens as long as CleanYourTV is
#     installed, also while LG's Home is back after a fallback, so the launcher, the Input key and the manager keep their service. Not
#     while bootstrap.sh runs: a setup or an update starts and stops the service itself. A service that stops again at once is started
#     less often (after 10, 20, ... up to 120 seconds), so a service that cannot start does not use the TV all night.
#   - while our launcher is Home and the service stays unreachable for about a minute, LG's Home comes back until the next reboot
#     (undo-home.sh temp), as before.
#   - a black box: every 30 seconds one line in blackbox.log in the service folder (on the TV's storage, so it survives a reset): the
#     free memory and swap, the load, the app in front and the busiest processes. At the start of a boot the box of the boot before
#     becomes blackbox.last.log, with the reason the TV gave for that start first (power/getPowerOnReason, such as cpuAbnormal for a
#     reset). Share log shows both, so what happened just before an unexpected reset can be read afterwards (issue 112). Kept below
#     64 KB.
#   - nothing on screen: while our launcher is Home (the stand-in way), the TV is on (power state Active) and no app is in front for
#     two checks in a row, Home is set up again: the stand-in and the launcher are closed and the app manager opens Home afresh. LG's
#     app manager restarts when the TV goes to standby; a launcher that stayed open was then no longer known as Home, and the Home
#     key gave a black screen with only the pointer. home-standin.sh handles that at once; this is the safety net. If the screen
#     stays empty after two such tries, LG's Home comes back until the next reboot (undo-home.sh temp). The other form of the same
#     fault: the app manager lists Home as running while no stand-in runs (a restart of the app manager can end it too), so the Home
#     key does nothing; seen for two checks in a row, the launcher is closed (and Home opened again when it was in front).
# The whole script is one block that ends in exit: the shell has read all of it before it runs, so an update that copies a new
# watchdog.sh over this file does not confuse the copy that is running (bootstrap.sh stops it, and the boot script starts the new one).
# The paths can be pointed elsewhere for the tests (tools/test/scripts.test.js); on the TV none of these variables is set.
{
  export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
  L=${CYTV_DIR:-/media/developer/cleanyourtv}
  LOG=${CYTV_BOOT_LOG:-/tmp/cleanyourtv-boot.log}
  SLOG=${CYTV_SERVICE_LOG:-/tmp/cleanyourtv-helper.log}
  CRASH=${SLOG%.log}.crash.log
  URL=${CYTV_SERVICE_URL:-http://127.0.0.1:8765/api/foreground}
  EVERY=${CYTV_WATCH_SECS:-10}
  BB=${CYTV_BLACKBOX:-$L/blackbox.log}
  BB_EVERY=${CYTV_BLACKBOX_EVERY:-3} # checks between two lines of the black box
  H=/usr/palm/applications/com.webos.app.home
  STANDIN=${CYTV_STANDIN:-/tmp/cleanyourtv-home-standin}
  MOUNTS=${CYTV_MOUNTS:-/proc/mounts}
  LUNA=${CYTV_LUNA:-luna-send}
  up() { cut -d' ' -f1 /proc/uptime 2>/dev/null; }
  replaced() { grep -q " $H " $MOUNTS || { [ -f $STANDIN ] && grep -q " $(cat $STANDIN) " $MOUNTS; }; }
  luna() { "$LUNA" -n 1 -w 3000 "$@" </dev/null 2>/dev/null; }
  # the stand-in way, and the TV on with no app in front (an empty screen); the app manager not answering is not counted, and an app
  # in front ends a run of tries
  blank() {
    [ -f $STANDIN ] && grep -q " $(cat $STANDIN) " $MOUNTS || return 1
    a=$(luna luna://com.webos.applicationManager/getForegroundAppInfo '{}') || return 1
    echo "$a" | grep -q '"returnValue": *true' || return 1
    [ -z "$(echo "$a" | sed -n 's/.*"appId" *: *"\([^"]*\)".*/\1/p')" ] || { tries=0; return 1; }
    luna luna://com.webos.service.tvpower/power/getPowerState '{}' | grep -q '"state": *"Active"'
  }
  # the app manager lists Home as running, but no stand-in runs: the launcher webapp-mgr has open is taken for Home, and the Home key
  # does nothing. $fg is the app in front then.
  orphan() {
    [ -f $STANDIN ] && grep -q " $(cat $STANDIN) " $MOUNTS || return 1
    pgrep -f "^/bin/sh $(cat $STANDIN)" >/dev/null && return 1
    luna luna://com.webos.applicationManager/running '{}' | grep -q '"id": *"com.webos.app.home"' || return 1
    fg=$(luna luna://com.webos.applicationManager/getForegroundAppInfo '{}' | sed -n 's/.*"appId" *: *"\([^"]*\)".*/\1/p')
  }
  # Home set up again: the stand-ins and their registrations end, webapp-mgr closes the launcher, and (unless $1 is "closed") the
  # app manager opens Home
  rehome() {
    EXE=$(cat $STANDIN)
    for p in $(pgrep -f "^/bin/sh $EXE"); do kill "$p" 2>/dev/null; done
    pkill -f "[l]una-send -i -a com.webos.app.home" 2>/dev/null
    luna luna://com.palm.webappmanager/killApp '{"appId":"com.webos.app.home"}' >/dev/null
    [ "$1" = closed ] && return 0
    sleep 2
    luna luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null
  }
  # the log of the run that ended goes to the crash log, which keeps its last 400 lines
  keep_log() {
    [ -s "$SLOG" ] || return 0
    { echo "=== the service log of a run that ended (uptime $(up)) ==="; tail -n 200 "$SLOG"; } >>"$CRASH" 2>/dev/null
    n=$(wc -l <"$CRASH" 2>/dev/null)
    if [ "${n:-0}" -gt 400 ]; then tail -n 400 "$CRASH" >"$CRASH.tmp" && mv "$CRASH.tmp" "$CRASH"; fi
  }

  # one line of the black box; $1: the service's answer about the app in front
  box() {
    m=$(sed -n 's/^MemAvailable: *\([0-9]*\).*/\1/p' /proc/meminfo 2>/dev/null)
    w=$(sed -n 's/^SwapFree: *\([0-9]*\).*/\1/p' /proc/meminfo 2>/dev/null)
    l=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)
    f=$(echo "$1" | sed -n 's/.*"appId" *: *"\([^"]*\)".*/\1/p')
    # the three lines after the column header (busybox and procps top differ in what comes before it)
    t=$(top -b -n 1 2>/dev/null | sed -n '/PID/{n;p;n;p;n;p;q;}' | tr -s ' ' | cut -c1-90 | tr '\n' '|')
    echo "$(up) mem=${m:-?}k swap=${w:-?}k load=${l:-?} fg=${f:-${2:-?}} top=${t:-?}" >>"$BB" 2>/dev/null
    if [ "$(wc -c <"$BB" 2>/dev/null)" -gt 65536 ]; then tail -c 32768 "$BB" | sed 1d >"$BB.tmp" && mv "$BB.tmp" "$BB"; fi
  }
  # the box of the boot before is kept once, with why the TV started this time (a reset says so)
  if [ -s "$BB" ]; then
    why=$(command -v luna-send >/dev/null && luna-send -n 1 -w 3000 -f luna://com.webos.service.tvpower/power/getPowerOnReason '{}' </dev/null 2>/dev/null | sed -n 's/.*"reason" *: *"\([^"]*\)".*/\1/p')
    { echo "=== the boot before; this boot started because: ${why:-unknown} ==="; cat "$BB"; } >"${BB%.log}.last.log" 2>/dev/null
    rm -f "$BB"
  fi
  echo "$(up) === boot ===" >>"$BB" 2>/dev/null
  tick=0

  bad=0       # checks in a row without an answer (the fallback to LG's Home counts them)
  fallback=0  # 1 once LG's Home has been brought back by this watchdog
  fails=0     # starts in a row that did not bring the service back
  hold=0      # checks to wait before the next start
  empty=0     # checks in a row with nothing on screen
  tries=0     # times Home was set up again while the screen stayed empty
  lost=0      # checks in a row with Home running without its stand-in
  while [ -f "$L/helper.js" ]; do
    sleep "$EVERY"
    tick=$((tick + 1))
    if [ $fallback = 0 ] && blank; then
      empty=$((empty + 1))
      if [ $empty -ge 2 ]; then
        empty=0
        tries=$((tries + 1))
        if [ $tries -le 2 ]; then
          echo "$(up) watchdog: the TV is on with nothing on screen; Home is set up again (try $tries)" >>"$LOG"
          rehome
        else
          echo "$(up) watchdog: still nothing on screen; LG's Home until the next reboot" >>"$LOG"
          sh "$L/undo-home.sh" temp
          fallback=1
        fi
      fi
    else
      empty=0
    fi
    if [ $fallback = 0 ] && orphan; then
      lost=$((lost + 1))
      if [ $lost -ge 2 ]; then
        lost=0
        if [ -z "$fg" ] || [ "$fg" = com.webos.app.home ]; then
          echo "$(up) watchdog: Home runs without its stand-in (the app manager restarted); Home is set up again" >>"$LOG"
          rehome
        else
          echo "$(up) watchdog: Home runs without its stand-in (the app manager restarted); the launcher is closed, the Home key opens it afresh" >>"$LOG"
          rehome closed
        fi
      fi
    else
      lost=0
    fi
    if ans=$(curl -s -m 3 "$URL"); then
      [ $((tick % BB_EVERY)) = 0 ] && box "$ans"
      bad=0
      fails=0
      hold=0
      continue
    fi
    [ $((tick % BB_EVERY)) = 0 ] && box "" "(service not answering)"
    if ! pgrep -f "$L/helper.js" >/dev/null && ! pgrep -f "^[a-z/]*sh [^ ]*[b]ootstrap.sh" >/dev/null; then
      if [ $hold -gt 0 ]; then
        hold=$((hold - 1))
      else
        fails=$((fails + 1))
        hold=$((fails - 1))
        [ $hold -gt 11 ] && hold=11
        echo "$(up) watchdog: the service had stopped; starting it again (start $fails in a row)" >>"$LOG"
        keep_log
        (cd / && nohup node "$L/helper.js" >"$SLOG" 2>&1 </dev/null &)
      fi
    fi
    if [ $fallback = 0 ] && replaced; then
      bad=$((bad + 1))
      if [ $bad -ge 6 ]; then
        echo "$(up) watchdog: the service did not answer for a minute; LG's Home until the next reboot" >>"$LOG"
        sh "$L/undo-home.sh" temp
        fallback=1
      fi
    fi
  done
  exit 0
}
