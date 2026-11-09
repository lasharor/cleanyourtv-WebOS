#!/bin/sh
# Put LG's screen saver back: the same as switching it off in the manager (Features > Screen saver). SCREENSAVER-ON is removed and the
# TV restarts; the boot after it does not mount our page (RAM only: nothing on disk under /usr was changed). "--no-reboot": only remove
# the file; LG's screen saver comes back at the next restart.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
rm -f $L/SCREENSAVER-ON
echo "$(cut -d' ' -f1 /proc/uptime) undo-screensaver: SCREENSAVER-ON removed" >> /tmp/cleanyourtv-boot.log
case " $* " in
  *" --no-reboot "*) echo "LG's screen saver comes back at the next restart; switch ours on again in the manager (Features > Screen saver)" ;;
  *) echo "LG's screen saver is back after this restart; switch ours on again in the manager (Features > Screen saver)"; sleep 2; reboot ;;
esac
