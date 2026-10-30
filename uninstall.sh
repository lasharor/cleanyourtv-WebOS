#!/bin/sh
# CleanYourTV for LG webOS: uninstaller. Run on the TV as root:  sh /media/developer/cleanyourtv/uninstall.sh
# Restores LG's Home and services, gives the Input key back to LG, removes the apps, the boot scripts and
# /media/developer/cleanyourtv. (The inputhook stays loaded in LG's input process until the next reboot; without
# a bind it does nothing.) Pass --keep-config to keep your settings (config.json) and usage history.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
D=/media/developer/cleanyourtv
INITD=/var/lib/webosbrew/init.d
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
rm -f $INITD/10-cleanyourtv-home $INITD/15-cleanyourtv-debloat
# our apps must not be what the TV tries to come back to: close them and point the boot's "last app" at LG's Home
for id in com.cleanyourtv.manager com.cleanyourtv.picker com.cleanyourtv.notify; do
  luna-send -n 1 -w 3000 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$id\"}" </dev/null >/dev/null 2>&1
done
[ -f $D/volume-osd-restore.sh ] && sh $D/volume-osd-restore.sh </dev/null   # LG's own volume bar, if a custom one switched it off
LASTAPP=/var/luna/preferences/bootd_last_foreground_app_id.json
grep -q cleanyourtv $LASTAPP 2>/dev/null && echo '{"lastAppId":"com.webos.app.home"}' > $LASTAPP
[ -f $D/debloat-undo.sh ] && sh $D/debloat-undo.sh </dev/null
pkill -f "[c]leanyourtv/watchdog.sh"   # the watchdog would restart the service
pkill -f "[1]0-cleanyourtv-home"
pkill -f "[c]leanyourtv/helper.js"
# our Input-key bind
node $D/jtool.js rmbind 2>/dev/null
case " $* " in *" --no-reboot "*)
  sh "$D/undo-home.sh" temp </dev/null || { echo 'Home restoration failed; runtime retained for recovery' >&2; exit 1; }
;; esac
KEEP=0; case " $* " in *" --keep-config "*) KEEP=1 ;; esac
if [ $KEEP = 1 ]; then mkdir -p /media/developer/cytv-keep; cp $D/config.json $D/usage.json /media/developer/cytv-keep/ 2>/dev/null; fi
for id in com.cleanyourtv.picker com.cleanyourtv.notify com.cleanyourtv.live com.cleanyourtv.manager; do
  luna-send -n 1 -w 20000 -f luna://com.webos.appInstallService/dev/remove "{\"id\":\"$id\",\"subscribe\":false}" </dev/null >/dev/null 2>&1
  rm -rf /media/developer/apps/usr/palm/packages/$id /media/developer/apps/usr/palm/applications/$id
done
rm -rf /media/developer/apps/usr/palm/services/com.cleanyourtv.manager.service
rm -rf $D
[ $KEEP = 1 ] && { mkdir -p $D; mv /media/developer/cytv-keep/* $D/ 2>/dev/null; rmdir /media/developer/cytv-keep; }
echo "[cleanyourtv] removed. Restarting the TV so that LG's Home and services come back."
case " $* " in *" --no-reboot "*) ;; *) sleep 2; reboot ;; esac
