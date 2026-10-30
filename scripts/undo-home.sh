#!/bin/sh
# Restore LG's stock Home. "temp": until next reboot only; no arg: also create DISABLE so reboots keep stock Home.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
[ "$1" = temp ] || touch /media/developer/cleanyourtv/DISABLE /media/developer/cleanyourtv/DISABLE-DEBLOAT
# our apps must not be what the TV tries to come back to: close them and point the boot's "last app" at LG's Home
for id in com.cleanyourtv.manager com.cleanyourtv.picker com.cleanyourtv.notify; do
  luna-send -n 1 -w 3000 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$id\"}" </dev/null >/dev/null 2>&1
done
LASTAPP=/var/luna/preferences/bootd_last_foreground_app_id.json
grep -q cleanyourtv $LASTAPP 2>/dev/null && echo '{"lastAppId":"com.webos.app.home"}' > $LASTAPP
# LG's own volume bar, if a custom one switched it off
[ -f /media/developer/cleanyourtv/volume-osd-restore.sh ] && sh /media/developer/cleanyourtv/volume-osd-restore.sh </dev/null >/dev/null 2>&1
# LG's own Home needs the ad services the debloat blocks (it fails to start without them), so lift the debloat first
[ -f /media/developer/cleanyourtv/debloat-undo.sh ] && sh /media/developer/cleanyourtv/debloat-undo.sh </dev/null >/dev/null 2>&1
# the stand-in way (LG's native Home): unmount it from LG's Home program and close the launcher; sam was never restarted
STANDIN=/tmp/cleanyourtv-home-standin
EXE=$(node "$L/nativehome.js" target) || { echo 'Cannot identify the stand-in safely; runtime retained for recovery' >&2; exit 1; }
if [ -n "$EXE" ]; then
  if ! node "$L/nativehome.js" stop "$EXE"; then
    echo 'Stand-in checks failed; trying recovery from the owned mount instead of saved metadata' >&2
    # Best effort without manifest/marker assumptions, never broad pkill or a foreign mount.
    node "$L/nativehome.js" recover "$EXE" || echo 'Owned process cleanup incomplete; trying stock Home restoration' >&2
  fi
  node "$L/nativehome.js" owned "$EXE" || exit 1
  umount "$EXE" || { echo 'Native Home mount is still busy; marker retained for recovery' >&2; exit 1; }
  rm -f "$STANDIN"
  luna-send -n 1 -w 5000 luna://com.palm.webappmanager/killApp '{"appId":"com.webos.app.home"}' </dev/null >/dev/null 2>&1
  echo "$(cut -d' ' -f1 /proc/uptime) undo-home: the stand-in is removed from $EXE" >> /tmp/cleanyourtv-boot.log
  sleep 2
  luna-send -n 1 -w 10000 -f luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' </dev/null
  echo "stock Home restored; rm /media/developer/cleanyourtv/DISABLE to re-enable at next boot"
  exit 0
fi
# A no-reboot uninstall also calls us when no takeover remains; do not restart sam then.
if ! grep -q ' /usr/palm/applications/com.webos.app.home ' /proc/mounts; then
  echo 'stock Home is not replaced; no Home restart needed'
  exit 0
fi
for m in $(awk '$2 ~ /applications\/com.webos.app.home$/ {print $2}' /proc/mounts | sort -r); do umount $m 2>/dev/null; done
# an airplay child of sam makes the stop wait ~90 s; kill it once the stop has begun
(sleep 3; pkill -9 -f /usr/palm/applications/airplay/LunaExecutable) </dev/null >/dev/null 2>&1 &
systemctl restart sam
for i in $(seq 1 60); do systemctl is-active sam >/dev/null && break; sleep 2; done
[ -f /media/developer/cleanyourtv/after-sam.sh ] && sh /media/developer/cleanyourtv/after-sam.sh </dev/null
sleep 5
# the old web renderer for Home would keep showing the launcher; retry until the stock flutter Home is up
for t in 1 2 3 4; do
  pkill -f "[a]pp-id=com.webos.app.home"
  sleep 3
  luna-send -n 1 -w 10000 -f luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' </dev/null
  sleep 8
  pgrep -f "[f]lutter-client -i com.webos.app.home" >/dev/null && ! pgrep -f "[a]pp-id=com.webos.app.home" >/dev/null && break
done
echo "stock Home restored; rm /media/developer/cleanyourtv/DISABLE to re-enable at next boot"
