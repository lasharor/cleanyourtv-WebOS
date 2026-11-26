#!/bin/sh
# Home after a cold boot on an input (the stand-in way, LG's native Home: webOS 5 to 23). A full restart (the Homebrew Channel's reboot,
# a power cut) brings the TV up on the last input, and with the stand-in in place of LG's Home nothing opened Home: the app manager only
# preloads it, and the stand-in waits for the Home key then (seen on a 65UP77006LB, webOS 6.5.3: the TV stayed on HDMI 1 after a reboot,
# one press of Home showed the launcher). home-standin.sh already opens Home when the TV comes back from standby; this does the same for
# a boot, by the same rule: LG's setting Home Auto Launch (General > Home Settings, "homeAutoLaunch") is on and an input (or nothing) is
# in front. An app in front (one the TV was started with, or one opened meanwhile) is left alone, as is Home already in front.
# Started by 10-cleanyourtv-home when the TV came up on an input, with that input's app id in $1, after hdmi-plane.sh (which restarts
# webapp-mgr only while the launcher is not open). Only while the uptime is under 300 s (CYTV_BOOT_INPUT_MAXUP): a setup or an update
# that runs the boot hook later never opens Home over what someone watches. Every step is written to /tmp/cleanyourtv-boot.log.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r "$L/luna-compat.sh" ] || . "$L/luna-compat.sh"
LOG=${CYTV_BOOT_LOG:-/tmp/cleanyourtv-boot.log} # the tests point these elsewhere
UPTIME=${CYTV_UPTIME:-/proc/uptime}
MAXUP=${CYTV_BOOT_INPUT_MAXUP:-300}
WAMWAIT=${CYTV_BOOT_INPUT_WAMWAIT:-20}
up() { cut -d' ' -f1 $UPTIME; }
upsec() { read -r n _ < $UPTIME; echo "${n%.*}"; }
log() { echo "$(up) home-boot-input: $*" >> $LOG 2>/dev/null; }

[ "$(upsec)" -lt "$MAXUP" ] || { log "the TV has been on for $(upsec) s: not a boot, Home is not opened"; exit 0; }
if ! luna_send -n 1 -w 3000 luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["homeAutoLaunch"]}' 2>/dev/null |
  grep -q '"homeAutoLaunch": *"on"'; then
  log "the TV started on ${1:-an input}; Home Auto Launch is off in LG's settings, so it stays there"
  exit 0
fi
# hdmi-plane.sh may just have restarted webapp-mgr, which opens the launcher: systemd calls it active before it answers on the bus, and
# a launch it refuses would leave the boot hook to think the launcher cannot open. So wait until it answers (at most 20 s).
for i in $(seq 1 "$WAMWAIT"); do
  luna_send -n 1 -w 2000 luna://com.palm.webappmanager/listRunningApps '{}' 2>/dev/null | grep -q '"returnValue": *true' && break
  [ "$i" = "$WAMWAIT" ] && { log "webapp-mgr does not answer; Home is not opened (the Home key opens it)"; exit 0; }
  sleep 1
done
# what is in front is read last, right before the launch
fg=$(luna_send -n 1 -w 3000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p')
case "$fg" in
  com.webos.app.home) log "Home is already in front"; exit 0 ;;
  com.webos.app.hdmi* | com.webos.app.livetv | com.webos.app.externalinput.* | '') ;;
  *) log "$fg is in front now; Home is not opened over it"; exit 0 ;;
esac
log "the TV started on ${fg:-nothing in front} and Home Auto Launch is on: Home is opened"
luna_send -n 1 -w 5000 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null 2>&1
exit 0
