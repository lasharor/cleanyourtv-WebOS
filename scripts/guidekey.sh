#!/bin/sh
# Run by the inputhook when the Guide button is pressed (and the TV guide or Live TV is on): open the guide over whatever is running.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r /media/developer/cleanyourtv/luna-compat.sh ] || . /media/developer/cleanyourtv/luna-compat.sh
# the app in front (LG's Live TV, an input, ...): Back in the guide goes back to it
FROM=$(luna_send -n 1 -w 1500 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p' | head -1)
case "$FROM" in *[!A-Za-z0-9._-]*|com.webos.app.home|"") P='{"live":true,"guide":true}' ;; *) P="{\"live\":true,\"guide\":true,\"from\":\"$FROM\"}" ;; esac
# where home-standin.sh stands in for LG's native Home, it takes the parameters from this file (issue 26)
[ -f /tmp/cleanyourtv-home-standin ] && { read -r UP _ < /proc/uptime; echo "$UP $P" > /tmp/cleanyourtv-home-params; }
luna_send -n 1 -w 3000 luna://com.webos.applicationManager/launch "{\"id\":\"com.webos.app.home\",\"params\":$P}" >/dev/null 2>&1
