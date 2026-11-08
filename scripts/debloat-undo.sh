#!/bin/sh
# Undo debloat-stop.sh: restart the systemd daemons, remove the stubs and the hosts lines (dynamic services start on demand again).
# sh debloat-undo.sh [group...]: only those groups (ads, tracking, logs, suggestions, see debloat-stop.sh); without arguments all.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
G=" ${*:-ads tracking logs suggestions} "
on() { case "$G" in *" $1 "*) return 0 ;; esac; return 1; }
units=""; bins=""
on logs && units="$units remotelogger service-logger"
on suggestions && { units="$units contentminer nudge"; bins="$bins sportsalarm"; }
on tracking && bins="$bins acr2"
on ads && bins="$bins admanager adoverlay-service"   # admanager: a stub from before 1.6.11 (issue 47)
for b in $bins; do
  for m in $(awk -v b="/usr/sbin/$b" 'substr($2,length($2)-length(b)+1)==b {print $2}' /proc/mounts | sort -r); do umount $m 2>/dev/null; done
done
for s in $units; do systemctl --no-block start $s.service; done
on ads || exit 0
# the copy in RAM that debloat-stop.sh mounts where /etc/hosts is read-only, but only while it is what /etc/hosts shows: a table mounted
# over it later (Glasshouse's, the Homebrew Channel's update block) is not ours to unmount. Otherwise the marked lines in /etc/hosts itself
if [ -e /tmp/cleanyourtv-hosts.mounted ] && [ /etc/hosts -ef /tmp/cleanyourtv-hosts ]; then umount /etc/hosts 2>/dev/null && rm -f /tmp/cleanyourtv-hosts /tmp/cleanyourtv-hosts.mounted; fi
if grep -q "# cleanyourtv-debloat" /etc/hosts; then
  grep -v "# cleanyourtv-debloat" /etc/hosts > /tmp/hosts.new && cat /tmp/hosts.new > /etc/hosts; rm -f /tmp/hosts.new
fi
