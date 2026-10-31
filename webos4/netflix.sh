#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PIDFILE="$HERE/service.pid"
LOCK=/tmp/cytv-netflix.start
LOG="$HERE/service.log"
BOOT=/var/lib/webosbrew/init.d/30-cleanyourtv-netflix
owned() {
    case "$1:$2" in *[!0-9:]*|:*|*:|0:*|1:*) return 1 ;; esac
    [ "$(readlink "/proc/$1/exe" 2>/dev/null || true)" = "$(readlink -f /usr/bin/node)" ] &&
        [ "$(awk '{print $22}' "/proc/$1/stat" 2>/dev/null || true)" = "$2" ] &&
        [ "$(tr '\000' '\n' <"/proc/$1/cmdline" 2>/dev/null | sed -n '2p')" = "$HERE/netflix-source-exit.js" ] &&
        [ "$(tr '\000' '\n' <"/proc/$1/cmdline" 2>/dev/null | sed -n '3p')" = --service ]
}
case "${1:-}" in
    start)
        umask 077
        mkdir "$LOCK" || { echo 'Another start/stop is in progress' >&2; exit 1; }
        trap 'rmdir "$LOCK"' EXIT
        if [ -f "$PIDFILE" ]; then
            read -r nf_pid nf_start <"$PIDFILE"
            if owned "$nf_pid" "$nf_start"; then echo already-running; exit 0; fi
        fi
        [ -r "$HERE/netflix-source-exit.js" ]
        nohup /usr/bin/node "$HERE/netflix-source-exit.js" --service </dev/null >"$LOG" 2>&1 &
        nf_pid=$!
        nf_start=$(awk '{print $22}' "/proc/$nf_pid/stat")
        printf '%s %s\n' "$nf_pid" "$nf_start" >"$PIDFILE"
        rmdir "$LOCK"
        trap - EXIT
        for attempt in 1 2 3 4 5 6 7 8; do
            owned "$nf_pid" "$nf_start" || break
            if grep -q '"event":"ready"' "$LOG"; then echo ready; exit 0; fi
            sleep 1
        done
        sh "$HERE/netflix.sh" stop
        cat "$LOG"
        exit 1
        ;;
    stop)
        mkdir "$LOCK" || { echo 'Another start/stop is in progress' >&2; exit 1; }
        trap 'rmdir "$LOCK"' EXIT
        [ -f "$PIDFILE" ] || exit 0
        read -r nf_pid nf_start <"$PIDFILE"
        if owned "$nf_pid" "$nf_start"; then
            kill -TERM "$nf_pid"
            for attempt in 1 2 3; do
                owned "$nf_pid" "$nf_start" || break
                sleep 1
            done
            if owned "$nf_pid" "$nf_start"; then echo 'Process has not stopped; left alone' >&2; exit 1; fi
        fi
        rm -f "$PIDFILE"
        ;;
    enable)
        if [ -e "$BOOT" ] || [ -L "$BOOT" ]; then
            [ ! -L "$BOOT" ] && cmp -s "$HERE/30-cleanyourtv-netflix" "$BOOT" || { echo 'Unrelated boot entry exists' >&2; exit 1; }
        else
            (umask 077; set -C; cat "$HERE/30-cleanyourtv-netflix" >"$BOOT")
            chmod 700 "$BOOT"
        fi
        if ! sh "$HERE/netflix.sh" start; then sh "$HERE/netflix.sh" disable; exit 1; fi
        ;;
    disable)
        if [ -e "$BOOT" ] || [ -L "$BOOT" ]; then
            [ ! -L "$BOOT" ] && cmp -s "$HERE/30-cleanyourtv-netflix" "$BOOT" || { echo 'Unrelated boot entry exists' >&2; exit 1; }
            rm -f "$BOOT"
        fi
        sh "$HERE/netflix.sh" stop
        ;;
    status)
        if [ -f "$PIDFILE" ]; then
            read -r nf_pid nf_start <"$PIDFILE"
            if owned "$nf_pid" "$nf_start"; then echo running; else echo stopped; fi
        else echo stopped; fi
        if [ -f "$BOOT" ] && cmp -s "$HERE/30-cleanyourtv-netflix" "$BOOT"; then echo boot-enabled; else echo boot-disabled; fi
        [ ! -f "$LOG" ] || tail -n 5 "$LOG"
        ;;
    *) echo 'Usage: netflix.sh start | stop | enable | disable | status' >&2; exit 2 ;;
esac
