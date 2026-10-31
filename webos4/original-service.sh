#!/bin/sh
# Manual trial only. Uses the verified isolated runtime installed by this profile.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BASE=$(node -e 'console.log(require(process.argv[1]).runtime)' "$HERE/webos4/profile.json")
PIDFILE="$HERE/state/helper.pid"
own_pid() {
    [ -r "$PIDFILE" ] || return 1
    PID=$(cat "$PIDFILE")
    case "$PID" in ''|*[!0-9]*|0|1) return 1 ;; esac
    [ -r "/proc/$PID/cmdline" ] || return 1
    tr '\000' '\n' <"/proc/$PID/cmdline" | grep -Fxq "$HERE/helper/webos4-original.js"
}
case "${1:-}" in
    run)
        own_pid && { echo 'Trial already running'; exit 1; }
        [ -x /lib/ld-linux.so.3 ] && [ -x "$BASE/node18" ] && [ -d "$BASE/lib" ] || exit 1
        umask 077
        exec /lib/ld-linux.so.3 --library-path "$BASE/lib:/lib:/usr/lib" "$BASE/node18" "$HERE/helper/webos4-original.js"
        ;;
    stop)
        own_pid || { echo 'No matching trial process'; exit 1; }
        kill -TERM "$PID"
        ;;
    status) own_pid && echo running || { echo stopped; exit 1; } ;;
    *) echo 'Usage: original-service.sh run | stop | status' >&2; exit 2 ;;
esac
