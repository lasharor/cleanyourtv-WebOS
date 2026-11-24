#!/bin/sh
# Give an HDMI input its picture back after the stand-in takeover (issue 255). On a 50UP75003LF (webOS 6.5.3, MStar) every HDMI input
# stayed black after the takeover: the input app ran and the signal was live, but the video plane was never attached. One restart of
# webapp-mgr early in the boot attaches it; five minutes in the same restart does nothing (the reporter measured: a restart at 182 s
# brought the picture back, one at 302 s did not). Started by 10-cleanyourtv-home when the TV came up on an input, with the app id of
# that input in $1. It restarts webapp-mgr once, and only when ALL of this holds:
#   - helper/tvprofile.js says this TV needs it (hdmiPlane: webOS 6 with LG's native Home), or the file hdmi-plane-on is in the service
#     folder; the file hdmi-plane-off switches it off on one TV (updates leave both files alone)
#   - the uptime is under 120 s (CYTV_HDMI_PLANE_MAXUP)
#   - an HDMI input is in front and its port reports hdmiPlugIn:true (a live signal; a boot with no signal cannot be repaired this way)
#   - the launcher is not open: it runs inside webapp-mgr, so a restart would close it and leave a black screen that LG answers with
#     warm standby requests (CEC then turns the connected player off too)
# The Home key is never pressed here and Home is never launched. Every step is written to /tmp/cleanyourtv-boot.log (Share log).
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r "$L/luna-compat.sh" ] || . "$L/luna-compat.sh"
LOG=/tmp/cleanyourtv-boot.log
UPTIME=/proc/uptime
DONE=/tmp/cleanyourtv-hdmi-plane-done
MAXUP=${CYTV_HDMI_PLANE_MAXUP:-120}
up() { cut -d' ' -f1 $UPTIME; }
upsec() { read -r n _ < $UPTIME; echo "${n%.*}"; }
log() { echo "$(up) hdmi-plane: $*" >> $LOG; }

app=$1
case "$app" in com.webos.app.hdmi[0-9]*) ;; *) exit 0 ;; esac
[ -e $L/hdmi-plane-off ] && exit 0
[ -e $DONE ] && exit 0
if [ ! -e $L/hdmi-plane-on ]; then
  sdk=$(luna_send -n 1 -w 5000 -f luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["sdkVersion"]}' 2>/dev/null | sed -n 's/.*"sdkVersion": *"\([^"]*\)".*/\1/p')
  home=$(node $L/jtool.js kind $L/backup/home-appinfo.orig.json 2>/dev/null)
  [ "$(node $L/tvprofile.js get hdmiPlane --sdk "$sdk" --home "$home" 2>/dev/null)" = 1 ] || exit 0
fi

# a live signal on the port of that input: eim lists every input with its appId and hdmiPlugIn
live() {
  luna_send -n 1 -w 5000 luna://com.webos.service.eim/getAllInputStatus '{}' 2>/dev/null | node -e '
    var s = "", app = process.argv[1];
    process.stdin.on("data", function (d) { s += d; }).on("end", function () {
      var found = false;
      (function walk(o) {
        if (!o || typeof o !== "object") return;
        if (o.appId === app && o.hdmiPlugIn === true) found = true;
        Object.keys(o).forEach(function (k) { walk(o[k]); });
      })((function () { try { return JSON.parse(s); } catch (e) { return null; } })());
      process.exit(found ? 0 : 1);
    });' "$app"
}
front() { luna_send -n 1 -w 3000 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p'; }
launcher_open() { luna_send -n 1 -w 3000 luna://com.palm.webappmanager/listRunningApps '{}' 2>/dev/null | grep -q '"com.webos.app.home"'; }

log "the TV started on $app; waiting for a live signal on it (restart of webapp-mgr only before ${MAXUP}s of uptime)"
for i in $(seq 1 30); do
  [ "$(upsec)" -lt "$MAXUP" ] || { log "no live signal before ${MAXUP}s of uptime: nothing restarted"; exit 0; }
  [ "$(front)" = "$app" ] || { log "$app is no longer in front: nothing restarted"; exit 0; }
  live && break
  [ "$i" = 30 ] && { log "no live signal on $app: nothing restarted (a boot without signal needs a reboot with the box on)"; exit 0; }
  sleep 2
done
# the checks again right before the restart: it must not close the launcher
if [ "$(front)" != "$app" ] || launcher_open; then log "the launcher is open or $app left the front: nothing restarted"; exit 0; fi
touch $DONE
log "live signal on $app: restarting webapp-mgr once to attach the video plane"
systemctl restart webapp-mgr >/dev/null 2>&1
for i in 1 2 3 4 5 6 7 8 9 10; do systemctl is-active webapp-mgr >/dev/null 2>&1 && break; sleep 1; done
log "webapp-mgr $(systemctl is-active webapp-mgr 2>/dev/null)"
exit 0
