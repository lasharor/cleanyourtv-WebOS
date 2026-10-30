#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG=/var/lib/webosbrew/cleanyourtv-bluetooth.json
PIDFILE=/tmp/cytv-bluetooth.pid
LOCK=/tmp/cytv-bluetooth.start
LOG=/tmp/cytv-bluetooth.log
BOOT=/var/lib/webosbrew/init.d/25-cleanyourtv-bluetooth
owned() {
    case "$1:$2" in *[!0-9:]*|:*|*:) return 1 ;; esac
    [ "$(readlink "/proc/$1/exe" 2>/dev/null || true)" = "$(readlink -f /usr/bin/node)" ] &&
        [ "$(awk '{print $22}' "/proc/$1/stat" 2>/dev/null || true)" = "$2" ] &&
        [ "$(tr '\000' '\n' <"/proc/$1/cmdline" 2>/dev/null | sed -n '2p')" = "$HERE/bluetooth-accept.js" ]
}
case "${1:-}" in
    start|trial)
        umask 077
        mkdir "$LOCK" || { echo 'Another start is in progress' >&2; exit 1; }
        trap 'rmdir "$LOCK"' EXIT
        bt_mode=
        [ "$1" != trial ] || bt_mode=--trial
        if [ -f "$PIDFILE" ]; then
            read -r bt_pid bt_start <"$PIDFILE"
            if owned "$bt_pid" "$bt_start"; then
                [ "$(tr '\000' '\n' <"/proc/$bt_pid/cmdline" | sed -n '4p')" = "$bt_mode" ] || {
                    echo 'Stop the existing trial/service before changing mode' >&2; exit 1;
                }
                echo already-running
                exit 0
            fi
        fi
        [ -r "$CONFIG" ] && [ -r "$HERE/bluetooth-accept.js" ]
        nohup /usr/bin/node "$HERE/bluetooth-accept.js" "$CONFIG" $bt_mode </dev/null >"$LOG" 2>&1 &
        bt_pid=$!
        bt_start=$(awk '{print $22}' "/proc/$bt_pid/stat")
        printf '%s %s\n' "$bt_pid" "$bt_start" >"$PIDFILE"
        rmdir "$LOCK"
        trap - EXIT
        for attempt in 1 2 3 4 5 6 7 8; do
            owned "$bt_pid" "$bt_start" || break
            if grep -q '^READY$' "$LOG"; then echo READY; exit 0; fi
            sleep 1
        done
        sh "$HERE/bluetooth.sh" stop
        cat "$LOG"
        exit 1
        ;;
    stop)
        mkdir "$LOCK" || { echo 'Another start/stop is in progress' >&2; exit 1; }
        trap 'rmdir "$LOCK"' EXIT
        [ -f "$PIDFILE" ] || exit 0
        read -r bt_pid bt_start <"$PIDFILE"
        if owned "$bt_pid" "$bt_start"; then
            kill -TERM "$bt_pid"
            for attempt in 1 2 3; do
                owned "$bt_pid" "$bt_start" || break
                sleep 1
            done
            if owned "$bt_pid" "$bt_start"; then kill -KILL "$bt_pid"; fi
        fi
        rm -f "$PIDFILE"
        ;;
    enable)
        if [ -e "$BOOT" ] || [ -L "$BOOT" ]; then
            cmp -s "$HERE/25-cleanyourtv-bluetooth" "$BOOT" || { echo 'Unrelated boot entry exists' >&2; exit 1; }
        else
            (umask 077; set -C; cat "$HERE/25-cleanyourtv-bluetooth" >"$BOOT")
            chmod 700 "$BOOT"
        fi
        if ! sh "$HERE/bluetooth.sh" start; then
            sh "$HERE/bluetooth.sh" disable
            exit 1
        fi
        ;;
    disable)
        if [ -e "$BOOT" ] || [ -L "$BOOT" ]; then
            cmp -s "$HERE/25-cleanyourtv-bluetooth" "$BOOT" || { echo 'Unrelated boot entry exists' >&2; exit 1; }
            rm -f "$BOOT"
        fi
        sh "$HERE/bluetooth.sh" stop
        ;;
    status)
        if [ -f "$PIDFILE" ]; then
            read -r bt_pid bt_start <"$PIDFILE"
            if owned "$bt_pid" "$bt_start"; then echo running; else echo stopped; fi
        else echo stopped; fi
        if [ -e "$BOOT" ] && cmp -s "$HERE/25-cleanyourtv-bluetooth" "$BOOT"; then echo boot-enabled; else echo boot-disabled; fi
        [ ! -f "$LOG" ] || tail -n 5 "$LOG"
        ;;
    *) echo 'Usage: bluetooth.sh start | trial | stop | enable | disable | status' >&2; exit 2 ;;
esac
