#!/bin/sh
# One-shot native HOME filter experiment. All files live in its dedicated session directory.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN="$HERE/home-input"
PIDFILE="$HERE/trial.pid"
LOG="$HERE/trial.log"
owned() {
    case "$1:$2" in *[!0-9:]*|:*|*:) return 1 ;; esac
    [ "$(readlink "/proc/$1/exe" 2>/dev/null || true)" = "$BIN" ] &&
        [ "$(awk '{print $22}' "/proc/$1/stat" 2>/dev/null || true)" = "$2" ]
}
case "${1:-}" in
    check)
        exec "$BIN" --check
        ;;
    start)
        "$BIN" --self-test >/dev/null
        # Never overwrite another start's PID or reuse a session whose state is uncertain.
        (set -C; printf 'starting\n' >"$PIDFILE") || { echo 'Use a fresh trial directory' >&2; exit 1; }
        nohup "$BIN" --filter-only </dev/null >"$LOG" 2>&1 &
        trial_pid=$!
        trial_start=$(awk '{print $22}' "/proc/$trial_pid/stat")
        printf '%s %s\n' "$trial_pid" "$trial_start" >"$PIDFILE"
        nohup sh "$HERE/home-input-trial.sh" watchdog "$trial_pid" "$trial_start" </dev/null >/dev/null 2>&1 &
        for attempt in 1 2 3 4 5 6 7; do
            if grep -q '"event":"ready"' "$LOG"; then
                printf 'READY: filter only; automatic release in at most 120 seconds.\nUndo: sh %s stop\n' "$HERE/home-input-trial.sh"
                exit 0
            fi
            owned "$trial_pid" "$trial_start" || break
            sleep 1
        done
        sh "$HERE/home-input-trial.sh" stop
        cat "$LOG"
        exit 1
        ;;
    stop)
        [ -f "$PIDFILE" ] || exit 0
        read -r trial_pid trial_start <"$PIDFILE" || exit 1
        if owned "$trial_pid" "$trial_start"; then
            kill -TERM "$trial_pid"
            for attempt in 1 2 3; do
                owned "$trial_pid" "$trial_start" || break
                sleep 1
            done
            if owned "$trial_pid" "$trial_start"; then kill -KILL "$trial_pid"; fi
        fi
        ;;
    watchdog)
        [ "$#" -eq 3 ] || exit 1
        sleep 125
        # Independent backstop: kernel closes the grabbed fd even after a forced exit.
        if owned "$2" "$3"; then kill -KILL "$2"; fi
        ;;
    status)
        if [ -f "$PIDFILE" ]; then
            read -r trial_pid trial_start <"$PIDFILE" || exit 1
            if owned "$trial_pid" "$trial_start"; then echo running; else echo stopped; fi
        else echo not-started; fi
        [ ! -f "$LOG" ] || tail -n 4 "$LOG"
        ;;
    *) echo 'Usage: home-input-trial.sh check | start | stop | status' >&2; exit 2 ;;
esac
