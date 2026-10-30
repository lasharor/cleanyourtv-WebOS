#!/bin/sh
# Run by the inputhook when the Guide button is pressed (and Live TV is on): open the Live TV channel guide over whatever is running.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r /media/developer/cleanyourtv/luna-compat.sh ] || . /media/developer/cleanyourtv/luna-compat.sh
# where home-standin.sh stands in for LG's native Home, it takes the parameters from this file (issue 26)
[ -f /tmp/cleanyourtv-home-standin ] && { read -r UP _ < /proc/uptime; echo "$UP {\"live\":true,\"guide\":true}" > /tmp/cleanyourtv-home-params; }
luna_send -n 1 -w 3000 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home","params":{"live":true,"guide":true}}' >/dev/null 2>&1
