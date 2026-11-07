#!/bin/sh
# Put LG's screen saver back (RAM only). "temp": until the next reboot only; no argument: also remove SCREENSAVER-ON, so the next
# boots keep LG's screen saver.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
STANDIN=/tmp/cleanyourtv-screensaver-standin
[ "$1" = temp ] || rm -f $L/SCREENSAVER-ON
# our page, if it is up: the app that was on screen comes back
luna-send -n 1 -w 5000 luna://com.palm.webappmanager/killApp '{"appId":"com.webos.app.screensaver"}' </dev/null >/dev/null 2>&1
# the stand-in way (LG's screen saver is a native program): unmount it; the app manager was never restarted
if [ -f $STANDIN ] && grep -q " $(cat $STANDIN) " /proc/mounts; then
  EXE=$(cat $STANDIN)
  umount "$EXE" 2>/dev/null
  rm -f $STANDIN
  echo "$(cut -d' ' -f1 /proc/uptime) undo-screensaver: the stand-in is removed from $EXE" >> /tmp/cleanyourtv-boot.log
  echo "LG's screen saver is back; switch it on again in the manager (Features > Screen saver)"
  exit 0
fi
for m in $(awk '$2 ~ /applications\/com.webos.app.screensaver$/ {print $2}' /proc/mounts | sort -r); do umount $m 2>/dev/null; done
# the app manager keeps the web manifest: restart it, and the services that kept talking to the old one
(sleep 3; pkill -9 -f /usr/palm/applications/airplay/LunaExecutable) </dev/null >/dev/null 2>&1 &
systemctl restart sam 2>/dev/null
for i in $(seq 1 60); do systemctl is-active sam >/dev/null && break; sleep 2; done
[ -f $L/after-sam.sh ] && sh $L/after-sam.sh </dev/null
# An app manager restart leaves nothing in the foreground. Open Home the way the manager does after a launcher update
# (reload-home.sh knows the stand-in and the webOS 6 webapp-mgr case), then look whether it really came up: one launch after the
# restart did not get the page on screen on the 65UR91006LB, and the result was a black TV.
sleep 4
sh $L/reload-home.sh </dev/null
sleep 5
fg=$(luna-send -n 1 -w 3000 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null)
case "$fg" in
  *com.webos.app.home*) ;;
  *)
    echo "$(cut -d' ' -f1 /proc/uptime) undo-screensaver: Home did not come back; asking once more" >> /tmp/cleanyourtv-boot.log
    sh $L/reload-home.sh </dev/null ;;
esac
echo "LG's screen saver is back; switch it on again in the manager (Features > Screen saver)"
