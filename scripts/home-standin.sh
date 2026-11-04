#!/bin/sh
# Stands in for LG's Home program on TVs where LG's Home is the native app (tvprofile.js homeTakeover 'standin'). 10-cleanyourtv-home
# bind-mounts this file over that program, so the app manager (SAM) keeps LG's Home manifest and starts this script whenever Home is
# launched; it does not have to be restarted (issues 14, 23 and 24). The script asks webapp-mgr to open the launcher as
# com.webos.app.home and stays running. It also tries to register with SAM as Home: then the Home key sends it a "relaunch" and the
# launcher is shown again; without registration SAM restarts this script on the Home key, which shows the launcher the same way.
# Every step is written to /tmp/cleanyourtv-boot.log, which Share log includes.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r "$L/luna-compat.sh" ] || . "$L/luna-compat.sh"
LOG=${CYTV_BOOT_LOG:-/tmp/cleanyourtv-boot.log} # the tests point it elsewhere
up() { cut -d' ' -f1 /proc/uptime; }
log() { echo "$(up) home-standin[$$]: $*" >> $LOG 2>/dev/null; }

# a previous copy that SAM killed leaves its registration and reader behind
for p in $(pgrep -f "^/bin/sh $0"); do [ "$p" != $$ ] && kill "$p" 2>/dev/null; done
pkill -f "[l]una-send -i -a com.webos.app.home" 2>/dev/null

# The parameters of a Home launch ({live, guide} from guidekey.sh, {inputs} from inputkey.sh) are passed on to the launcher (issue 26).
# The key scripts leave them in $PARAMS with the time ("<uptime> <json>"), so they arrive even if what the app manager sends is read
# wrong; otherwise they are taken from the app manager's relaunch event or this script's start argument ($1).
PARAMS=/tmp/cleanyourtv-home-params
params() {  # $1: start or relaunch, $2: the start argument or the relaunch event
  if [ -f $PARAMS ]; then
    read -r t p < $PARAMS
    rm -f $PARAMS
    read -r now _ < /proc/uptime
    [ -n "$p" ] && [ $((${now%.*} - ${t%.*})) -le 10 ] && { echo "$p"; return; }
  fi
  p=$(echo "$2" | sed -n 's/.*"parameters": *\({[^{}]*}\).*/\1/p')
  [ -z "$p" ] && [ "$1" = start ] && case "$2" in '{'*'}') p=$2 ;; esac
  [ -n "$p" ] || p='{}'
  echo "$p"
}

# The app manager also starts Home in the background to preload it (seen on webOS 4.5, about 15 s after the boot stops LG's Home).
# The launcher is not opened then, since webapp-mgr would show it over what is on screen (an input the TV started on): it opens on
# the first Home key (the relaunch event). Any other start or relaunch leaves $ASKED, which 10-cleanyourtv-home waits for when
# the TV started on an input.
ASKED=/tmp/cleanyourtv-home-asked

show() {
  case "$1 $2" in
    'start '*'"reason":"preload"'* | 'start '*'"reason": "preload"'*)
      log "preloaded by the app manager: the launcher opens on the Home key"
      return 0 ;;
  esac
  touch $ASKED
  p=$(params "$1" "$2")
  k='"parameters":{}'
  for f in $L/wam-launch.json $L/wam-launch.json.str; do
    [ -f $f ] || continue
    req=$(cat $f)
    case "$req" in *"$k"*) req="${req%%"$k"*}\"parameters\":$p${req#*"$k"}" ;; esac
    r=$(luna_send -n 1 -w 8000 luna://com.palm.webappmanager/launchApp "$req" 2>&1 | tr -d '\n')
    if echo "$r" | grep -q '"returnValue": *true'; then log "launcher shown ($1) with $(echo "$p" | cut -c1-120)"; return 0; fi
    log "webapp-mgr refused ${f##*/}: $(echo "$r" | cut -c1-200)"
  done
  return 1
}

# LG's app manager restarts when the TV goes to standby (seen on webOS 6.5: the power state turns "Active Standby" and SAM starts
# again within two seconds). The new one does not know this script as Home, while webapp-mgr still has the launcher open as
# com.webos.app.home, so it took that for Home: on power on and on the Home key nothing came to the front (a black screen with only
# the pointer). So once the app manager is back, the launcher is closed and this script ends; the new app manager starts it afresh
# the next time Home is launched (at power on, or the Home key). watchdog.sh checks the screen as well.
sam_restarted() {
  log "the app manager restarted (the TV went to standby); the launcher is closed so that Home starts afresh"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    luna_send -n 1 -w 1000 luna://com.webos.applicationManager/running '{}' 2>/dev/null | grep -q '"returnValue": *true' && break
    sleep 1
  done
  luna_send -n 1 -w 5000 luna://com.palm.webappmanager/killApp '{"appId":"com.webos.app.home"}' >/dev/null 2>&1
  pkill -f "[l]una-send -i -a com.webos.app.home" 2>/dev/null
  kill $$ 2>/dev/null
  exit 0
}

log "started as uid $(id -u), arguments: $(echo "$*" | cut -c1-200)"
show start "$1"

# the registration: SAM's events arrive one JSON line each
for m in registerApp registerNativeApp; do
  luna_send -i -a com.webos.app.home "luna://com.webos.applicationManager/$m" '{}' 2>&1 | while read -r line; do
    case "$line" in
      *'"event"'*relaunch*) show relaunch "$line" ;;
      *'"event"'*close*) log "closed by the app manager"; kill $$ 2>/dev/null; exit 0 ;;
      *'"event"'*registered*) log "registered with the app manager ($m)" ;;
      *'com.webos.applicationManager is not running'*) sam_restarted ;;
      *'"returnValue"'*false*) log "$m refused: $(echo "$line" | cut -c1-200)" ;;
    esac
  done
  log "$m ended"
done

log "running without registration: the app manager restarts this script on the Home key"
while :; do sleep 60; done
