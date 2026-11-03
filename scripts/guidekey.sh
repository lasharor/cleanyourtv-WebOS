#!/bin/sh
# Run by the inputhook when the Guide button is pressed (and Live TV or the tuner guide is on).
# - the tuner guide is on (tuner-guide, written by the service) and LG's own Live TV is in front, or Live TV (the playlist) is off:
#   open the tuner guide over what is running, a transparent app like the Inputs picker, so the picture stays behind it
# - otherwise: open the Live TV (playlist) channel guide over whatever is running.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r /media/developer/cleanyourtv/luna-compat.sh ] || . /media/developer/cleanyourtv/luna-compat.sh
D=/media/developer/cleanyourtv
if [ "$(cat $D/tuner-guide 2>/dev/null)" = on ]; then
  FG=$(luna_send -n 1 -w 2000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null)
  case "$FG" in
    *'"appId": "com.webos.app.livetv"'* | *'"appId":"com.webos.app.livetv"'* | *'"appId": "com.webos.app.livemenu"'* | *'"appId":"com.webos.app.livemenu"'* | *'"appId": "com.cleanyourtv.guide"'* | *'"appId":"com.cleanyourtv.guide"'*) TUNER=1 ;;
    *) grep -q '"liveTv": *false' $D/config.json 2>/dev/null && TUNER=1 ;;
  esac
  if [ "$TUNER" = 1 ]; then
    # a second press while the guide is open closes it (the guide asks the service to close it too)
    r=$(luna_send -n 1 -w 3000 luna://com.webos.applicationManager/launch '{"id":"com.cleanyourtv.guide","params":{"toggle":true}}' 2>/dev/null)
    case "$r" in *'"returnValue":true'* | *'"returnValue": true'*) exit 0 ;; esac
  fi
fi
# where home-standin.sh stands in for LG's native Home, it takes the parameters from this file (issue 26)
[ -f /tmp/cleanyourtv-home-standin ] && { read -r UP _ < /proc/uptime; echo "$UP {\"live\":true,\"guide\":true}" > /tmp/cleanyourtv-home-params; }
luna_send -n 1 -w 3000 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home","params":{"live":true,"guide":true}}' >/dev/null 2>&1
