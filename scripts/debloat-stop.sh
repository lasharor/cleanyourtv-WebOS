#!/bin/sh
# Stop LG telemetry/ad daemons and keep the on-demand ones from starting (RAM-only; a reboot restores them unless run from init.d).
# Four groups, each can be switched off in the manager (options.debloatOff in config.json lists the ones that are off):
#   ads          adoverlay-service and the ad servers in /etc/hosts (not admanager: HBO Max and Disney+ wait for it at start, issue 47)
#   tracking     acr2 (viewing tracking, LivePlus)
#   logs         remotelogger, service-logger
#   suggestions  contentminer, nudge, sportsalarm
# sh debloat-stop.sh [group...]: only those groups; without arguments every group that is not switched off.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
if [ $# -gt 0 ]; then
  G=" $* "
else
  OFF=$(node -e 'try{var o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).options||{};console.log((o.debloatOff||[]).join(" "))}catch(e){}' $L/config.json 2>/dev/null)
  G=" "
  for g in ads tracking logs suggestions; do case " $OFF " in *" $g "*) ;; *) G="$G$g " ;; esac; done
fi
on() { case "$G" in *" $1 "*) return 0 ;; esac; return 1; }
units=""; bins=""
on logs && units="$units remotelogger service-logger"
on suggestions && { units="$units contentminer nudge"; bins="$bins sportsalarm"; }
on tracking && bins="$bins acr2"
on ads && bins="$bins adoverlay-service"
# --no-block: contentminer can take a minute to stop, which held up the rest of the script (and the manager waiting for it)
for s in $units; do systemctl --no-block stop $s.service 2>&1 | sed "s/^/$s: /"; done
# luna dynamic services: bind a do-nothing stub over the binary so ls-hubd cannot start them
printf '#!/bin/sh\nexit 0\n' > $L/stub-noop; chmod +x $L/stub-noop
# versions before 1.6.11 also stubbed admanager, and HBO Max and Disney+ stay on their loader without it (issue 47): lift our stub
if grep -q " /usr/sbin/admanager " /proc/mounts && cmp -s /usr/sbin/admanager $L/stub-noop; then umount /usr/sbin/admanager 2>/dev/null; fi
for b in $bins; do
  [ -e /usr/sbin/$b ] || continue
  grep -q " /usr/sbin/$b " /proc/mounts || mount --bind $L/stub-noop /usr/sbin/$b
  pkill -9 -f "^/usr/sbin/$b"
done
on ads || exit 0
# ad servers (resolved + verified as LG ad endpoints); the marker lets debloat-undo.sh remove them.
# lgsmartad.com has a server per country (nl.ad..., gb.ad...) and admanager asks the one of the TV's LG services country: block that one
# too, so it is refused at once instead of reaching the server (or, where the network drops it, waiting out a 10 s connect timeout
# that HBO Max and Disney+ wait for at start, issue 47)
cc=$(luna-send -n 1 -w 5000 luna://com.webos.settingsservice/getSystemSettings '{"category":"option","keys":["smartServiceCountryCode2"]}' </dev/null 2>/dev/null |
  sed -n 's/.*"smartServiceCountryCode2": *"\([A-Za-z][A-Za-z]\)".*/\1/p' | tr 'A-Z' 'a-z')
ad_hosts="eic.ads.lgtvcommon.com nl.ad.lgsmartad.com nl.info.lgsmartad.com"
[ -n "$cc" ] && [ "$cc" != nl ] && ad_hosts="$ad_hosts $cc.ad.lgsmartad.com $cc.info.lgsmartad.com"
add_hosts() {
  echo "127.0.0.1 $ad_hosts # cleanyourtv-debloat"
  echo "::1 $ad_hosts # cleanyourtv-debloat"
}
if ! grep -q "# cleanyourtv-debloat" /etc/hosts; then
  if [ -w /etc/hosts ] && add_hosts >> /etc/hosts 2>/dev/null; then
    :
  else
    # on some TVs /etc/hosts is on the read-only system partition (issue 11): a copy in RAM is mounted over it until the next restart
    cp /etc/hosts /tmp/cleanyourtv-hosts && add_hosts >> /tmp/cleanyourtv-hosts && mount --bind /tmp/cleanyourtv-hosts /etc/hosts && touch /tmp/cleanyourtv-hosts.mounted \
      || echo "hosts: /etc/hosts cannot be changed on this TV; the ad servers are not blocked"
  fi
fi
