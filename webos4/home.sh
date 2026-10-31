#!/bin/sh
# Called by the temporary HOME binding. A missing/expired marker restores LG on the next press.
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$HERE/home-bind.js" check || exit 1
if ! curl -fsS --max-time 3 http://127.0.0.1:8765/api/service | grep -q '"readOnly":false'; then
    node "$HERE/home-bind.js" restore
    exit 1
fi
luna-send -n 1 -w 5000 -f luna://com.webos.applicationManager/launch '{"id":"com.cleanyourtv.webos4"}' </dev/null
