#!/bin/sh
# Run by the inputhook when the remote's Input button is pressed: show the Inputs picker over the current app.
# The service writes how in picker-mode: overlay = the picker app that was started hidden at boot (instant), ondemand = start the picker app
# now and let it close itself after use (older webOS, where a hidden overlay kept the remote), launcher = the launcher's own Inputs list.
# If the picker app is missing, open the launcher's Inputs list instead.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r /media/developer/cleanyourtv/luna-compat.sh ] || . /media/developer/cleanyourtv/luna-compat.sh
read UP _ < /proc/uptime   # when the key was pressed, for tools/perf-tv.sh (logged after the work is done)
mark() { (curl -s -m 2 "http://127.0.0.1:8765/api/log?m=perf%20key%20$1%20$UP" </dev/null >/dev/null 2>&1 &); }
M=$(cat /media/developer/cleanyourtv/picker-mode 2>/dev/null)
HOME_INPUTS='{"id":"com.webos.app.home","params":{"inputs":true}}'
# where home-standin.sh stands in for LG's native Home, it takes the parameters from this file (issue 26)
standin() { [ -f /tmp/cleanyourtv-home-standin ] && echo "$UP {\"inputs\":true}" > /tmp/cleanyourtv-home-params; }
if [ "$M" = launcher ]; then
  standin
  luna_send -n 1 -w 3000 luna://com.webos.applicationManager/launch "$HOME_INPUTS" >/dev/null 2>&1
  mark launcher
  exit 0
fi
if [ "$M" = ondemand ]; then P='{"id":"com.cleanyourtv.picker","params":{"ondemand":true}}'; else P='{"id":"com.cleanyourtv.picker"}'; fi
r=$(luna_send -n 1 -w 3000 luna://com.webos.applicationManager/launch "$P" 2>/dev/null)
case "$r" in *'"returnValue":true'*) mark "$M"; exit 0 ;; esac
standin
luna_send -n 1 -w 3000 luna://com.webos.applicationManager/launch "$HOME_INPUTS" >/dev/null 2>&1
