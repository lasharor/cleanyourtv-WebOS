#!/bin/sh
# Put LG's screen saver back (RAM only). "temp": until the next reboot only; no argument: also write DISABLE-SCREENSAVER, so the next
# boots keep LG's screen saver.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
STANDIN=/tmp/cleanyourtv-screensaver-standin
[ "$1" = temp ] || touch $L/DISABLE-SCREENSAVER
# our page, if it is up: the app that was on screen comes back
luna-send -n 1 -w 5000 luna://com.palm.webappmanager/killApp '{"appId":"com.webos.app.screensaver"}' </dev/null >/dev/null 2>&1
# the stand-in way (LG's screen saver is a native program): unmount it; the app manager was never restarted
if [ -f $STANDIN ] && grep -q " $(cat $STANDIN) " /proc/mounts; then
  EXE=$(cat $STANDIN)
  umount "$EXE" 2>/dev/null
  rm -f $STANDIN
  echo "$(cut -d' ' -f1 /proc/uptime) undo-screensaver: the stand-in is removed from $EXE" >> /tmp/cleanyourtv-boot.log
  echo "LG's screen saver is back; rm $L/DISABLE-SCREENSAVER to replace it again at the next boot"
  exit 0
fi
for m in $(awk '$2 ~ /applications\/com.webos.app.screensaver$/ {print $2}' /proc/mounts | sort -r); do umount $m 2>/dev/null; done
# the app manager keeps the web manifest: restart it, and the services that kept talking to the old one
(sleep 3; pkill -9 -f /usr/palm/applications/airplay/LunaExecutable) </dev/null >/dev/null 2>&1 &
systemctl restart sam 2>/dev/null
for i in $(seq 1 60); do systemctl is-active sam >/dev/null && break; sleep 2; done
[ -f $L/after-sam.sh ] && sh $L/after-sam.sh </dev/null
# an app manager restart leaves nothing in the foreground: open Home again, as 10-cleanyourtv-home does at boot
pkill -f "[a]pp-id=com.webos.app.home" 2>/dev/null
sleep 2
luna-send -n 1 -w 10000 -f luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' </dev/null >/dev/null 2>&1
echo "LG's screen saver is back; rm $L/DISABLE-SCREENSAVER to replace it again at the next boot"
