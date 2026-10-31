#!/bin/sh
# Read-only probe: how does THIS TV start LG's screen saver?
# Nothing is changed: it reads luna, /proc, the app folder and runs one subscription for $SECS seconds.
# Run as root on the TV (leave the remote alone while it runs, so the screen saver starts by itself):
#   scp tools/probe-screensaver.sh root@<tv-ip>:/tmp/
#   ssh root@<tv-ip> 'sh /tmp/probe-screensaver.sh 120'
# Result: /tmp/cytv-screensaver-probe.txt (read it with: cat /tmp/cytv-screensaver-probe.txt). It holds no addresses or keys.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
SECS=${1:-120}
LOG=/tmp/cytv-screensaver-probe.txt
EV=/tmp/cytv-ss-events.log
exec >"$LOG" 2>&1
say() { echo "$*"; }
up() { cut -d' ' -f1 /proc/uptime 2>/dev/null; }

say "# CleanYourTV screen saver probe, uptime $(up)"
say

say "== system =="
luna-send -n 1 -w 5000 -f luna://com.webos.service.tv.systemproperty/getSystemInfo \
  '{"keys":["modelName","firmwareVersion","sdkVersion"]}' </dev/null 2>/dev/null
say

say "== the app folders that look like a screen saver =="
ls -d /usr/palm/applications/*screen* /usr/palm/applications/*photo* 2>/dev/null
for d in /usr/palm/applications/*screen*; do
  [ -d "$d" ] || continue
  say "--- $d"
  readlink -f "$d" 2>/dev/null
  [ -f "$d/appinfo.json" ] && cat "$d/appinfo.json"
  say
done

say "== what the app manager thinks of com.webos.app.screensaver =="
luna-send -n 1 -w 5000 -f luna://com.webos.applicationManager/getAppInfo '{"id":"com.webos.app.screensaver"}' </dev/null 2>/dev/null
say
if command -v node >/dev/null 2>&1; then
  luna-send -n 1 -w 8000 -f luna://com.webos.applicationManager/listApps '{}' </dev/null 2>/dev/null >/tmp/cytv-apps.json
  node -e 'try{var a=JSON.parse(require("fs").readFileSync("/tmp/cytv-apps.json","utf8")).apps||[];a.filter(function(x){return /screen|saver/i.test((x.id||"")+" "+(x.title||""))}).forEach(function(x){console.log(JSON.stringify(x))});console.log("apps in total: "+a.length)}catch(e){console.log("listApps unreadable: "+e.message)}'
  say
fi

say "== processes and mounts that mention a screen saver =="
ps 2>/dev/null | grep -i -e screen -e saver | grep -v grep
grep -i screen /proc/mounts
say

say "== settings that choose the screen saver =="
for cat in general picture option; do
  say "--- category $cat"
  luna-send -n 1 -w 5000 -f luna://com.webos.settingsservice/getSystemSettings \
    "{\"category\":\"$cat\",\"keys\":[\"screenSaver\",\"screensaver\",\"screenSaverType\",\"screenSaverTime\"]}" </dev/null 2>/dev/null
  say
done

say "== files that name the app id (first 20) =="
grep -rIl "com.webos.app.screensaver" /usr/palm/services /etc/palm /usr/share/luna-service2 2>/dev/null | head -20
say

say "== who has the screen saver request open (tvpower) =="
luna-send -n 1 -w 5000 -f luna://com.webos.service.tvpower/power/getPowerState '{}' </dev/null 2>/dev/null
say

say "== $SECS s of tvpower screen saver requests (leave the TV alone now) =="
luna-send -i -a cytv-probe luna://com.webos.service.tvpower/power/registerScreenSaverRequest \
  '{"subscribe":true,"clientName":"cytv-probe"}' </dev/null >"$EV" 2>&1 &
EVPID=$!
trap 'kill $EVPID 2>/dev/null' EXIT INT TERM
n=0
while [ "$n" -lt "$SECS" ]; do
  sleep 5
  n=$((n + 5))
  fg=$(luna-send -n 1 -w 3000 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null)
  pw=$(luna-send -n 1 -w 3000 -f luna://com.webos.service.tvpower/power/getPowerState '{}' </dev/null 2>/dev/null)
  say "t+${n}s foreground: $(echo "$fg" | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p') power: $(echo "$pw" | sed -n 's/.*"state": *"\([^"]*\)".*/\1/p')"
done
kill $EVPID 2>/dev/null
wait $EVPID 2>/dev/null
say
say "== tvpower events =="
cat "$EV" 2>/dev/null
say
say "# end; the probe changed nothing. Read this with: cat $LOG"
