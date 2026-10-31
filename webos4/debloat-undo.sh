#!/bin/sh
# Undo only owned mounts; never overwrite hosts with a stale backup.
set -eu
export PATH=$PATH:/usr/bin:/usr/sbin:/bin:/sbin
D=${CYTV_DEBLOAT_DIR:-/media/developer/cleanyourtv}
B=$D/backup/debloat-webos4
HOSTS=${CYTV_DEBLOAT_HOSTS:-/etc/hosts}
SBIN=${CYTV_DEBLOAT_SBIN:-/usr/sbin}
MOUNTS=${CYTV_DEBLOAT_MOUNTS:-/proc/mounts}
INITCTL=${CYTV_DEBLOAT_INITCTL:-/sbin/initctl}
umask 077
mkdir -p "$B"
mkdir "$B/lock" || exit 1
trap 'rmdir "$B/lock"' EXIT
touch "$D/DISABLE-DEBLOAT"

# 1. Unmount stubs over dynamic services
for target in "$SBIN/acr2" "$SBIN/admanager" "$HOSTS"; do
    grep -qF " $target " "$MOUNTS" || continue
    case "$target" in
        "$HOSTS") [ -e "$B/owns-hosts" ] && cmp -s "$HOSTS" "$B/hosts" ;;
        *) [ -e "$B/owns-${target##*/}" ] && cmp -s "$target" "$D/stub-noop" ;;
    esac || { echo 'Foreign mount: left alone' >&2; exit 1; }
    umount "$target"
    case "$target" in
        "$HOSTS") rm "$B/owns-hosts" ;;
        *) rm "$B/owns-${target##*/}" ;;
    esac
done

# 2. Restart Upstart daemon
if [ -e "$B/restart-remotelogger" ]; then
    if ! "$INITCTL" status remotelogger 2>/dev/null | grep -q 'start/running'; then
        "$INITCTL" start remotelogger
    fi
    rm "$B/restart-remotelogger"
fi

# 3. Restore /etc/hosts from backup if present, otherwise clean marked lines
echo 'Debloat disabled. Power off/on restores previously running ad binaries.'
