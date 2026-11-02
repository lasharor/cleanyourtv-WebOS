#!/bin/sh
# Reload the page of Home. Where the Home renderer can be found (webOS 7 and newer) it is killed and Home is launched
# again. On webOS 6 (Node 8) WebAppMgr keeps the replaced page alive and a relaunch only brings the old page back, so
# there webapp-mgr is restarted. Other versions are never restarted this way.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r /media/developer/cleanyourtv/luna-compat.sh ] || . /media/developer/cleanyourtv/luna-compat.sh
# The stand-in way (LG's native Home, scripts/home-standin.sh): webapp-mgr holds the launcher; close it there, and launching Home
# makes the stand-in open it again.
STANDIN=/tmp/cleanyourtv-home-standin
if [ -f $STANDIN ] && grep -q " $(cat $STANDIN) " /proc/mounts; then
  luna_send -n 1 -w 5000 luna://com.palm.webappmanager/killApp '{"appId":"com.webos.app.home"}' >/dev/null 2>&1
  sleep 2
  luna_send -n 1 -w 10000 -f luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null
  exit 0
fi
if pgrep -f "[a]pp-id=com.webos.app.home" >/dev/null; then
  pkill -f "[a]pp-id=com.webos.app.home"; sleep 2
else
  nm=$(node -p 'parseInt(process.versions.node, 10)' 2>/dev/null)
  if [ "${nm:-99}" -lt 10 ] && systemctl cat webapp-mgr.service >/dev/null 2>&1; then
    systemctl restart webapp-mgr
    for i in $(seq 1 30); do systemctl is-active webapp-mgr >/dev/null && break; sleep 1; done
    sleep 3
  fi
fi
luna_send -n 1 -w 10000 -f luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null
