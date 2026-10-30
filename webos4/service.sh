#!/bin/sh
# Manual foreground service only. No init, mounts, LG process restarts or system Node changes.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT=$(CDPATH= cd -- "$HERE/.." && pwd)
STATE=${CYTV_WEBOS4_DIR:-"$HERE/state"}
RUNTIME="$HERE/runtime"
PIDFILE="$STATE/helper.pid"
export CYTV_WEBOS4_DIR="$STATE"

own_pid() {
    [ -f "$PIDFILE" ] || return 1
    PID=$(cat "$PIDFILE")
    case "$PID" in ''|*[!0-9]*|0|1) return 1 ;; esac
    [ -r "/proc/$PID/cmdline" ] || return 1
    tr '\000' '\n' < "/proc/$PID/cmdline" | grep -Fx "$PROJECT/helper/webos4.js" >/dev/null
}

case "${1:-}" in
    run)
        shift
        case "$*" in ''|--allow-launch) ;; *) echo 'Usage: service.sh run [--allow-launch]' >&2; exit 1 ;; esac
        [ -x /lib/ld-linux.so.3 ] && [ -x "$RUNTIME/node18" ] && [ -d "$RUNTIME/lib" ] || {
            echo "Place the previously verified Node 18 binary and its complete lib/ in $RUNTIME" >&2
            exit 1
        }
        umask 077
        mkdir -p "$STATE"
        echo "Foreground helper; log: $STATE/helper.log. Stop with Ctrl+C or service.sh stop."
        exec /lib/ld-linux.so.3 --library-path "$RUNTIME/lib:/lib:/usr/lib" "$RUNTIME/node18" \
            "$PROJECT/helper/webos4.js" "$@" >>"$STATE/helper.log" 2>&1
        ;;
    stop)
        own_pid || { echo 'No matching webOS 4 helper; nothing stopped.' >&2; exit 1; }
        kill -TERM "$PID"
        ;;
    status)
        own_pid || { echo 'Stopped (or PID file does not match).'; exit 1; }
        echo "Running: $PID"
        ;;
    *) echo 'Usage: service.sh run [--allow-launch] | stop | status' >&2; exit 1 ;;
esac
