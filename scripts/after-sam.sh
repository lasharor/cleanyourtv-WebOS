#!/bin/sh
# Run after the system app manager (SAM) was restarted to take over Home. On webOS before 7 and where LG's Home is the native program,
# the services that talk to SAM keep a connection to the old one: web and video apps stop opening, the remote stops controlling HDMI-CEC
# devices and apps are no longer preloaded (issues 23 and 24); on webOS 26 HDMI ARC to a soundbar stays silent (issue 21). Restart those
# of them this TV has; which ones is decided by helper/tvprofile.js (afterSam).
# Each step is written to /tmp/cleanyourtv-boot.log, which Share log includes.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r "$L/luna-compat.sh" ] || . "$L/luna-compat.sh"
LOG=/tmp/cleanyourtv-boot.log
up() { cut -d' ' -f1 /proc/uptime; }
sdk=$(luna_send -n 1 -w 5000 -f luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["sdkVersion"]}' 2>/dev/null | sed -n 's/.*"sdkVersion": *"\([^"]*\)".*/\1/p')
# LG's Home as it came with the TV (the backup the setup made), not our launcher that is mounted over it now
home=$(node $L/jtool.js kind $L/backup/home-appinfo.orig.json 2>/dev/null)
list=$(node $L/tvprofile.js get afterSam --sdk "$sdk" --home "$home" 2>/dev/null)
echo "$(up) after-sam: webOS SDK ${sdk:-unknown}, Home '${home:-unknown}', services: ${list:-none}" >> $LOG
for s in $list; do
  systemctl cat "$s.service" >/dev/null 2>&1 || { echo "$(up) after-sam: $s not on this TV" >> $LOG; continue; }
  systemctl is-active "$s" >/dev/null 2>&1 || { echo "$(up) after-sam: $s not running, left alone" >> $LOG; continue; }
  systemctl restart "$s" >/dev/null 2>&1
  echo "$(up) after-sam: restarted $s ($(systemctl is-active "$s" 2>/dev/null))" >> $LOG
done
exit 0
