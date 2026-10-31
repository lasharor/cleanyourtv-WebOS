#!/bin/sh
# Opt-in debloat for the tested webOS 4 firmware; not installed by the IPK.
set -eu
export PATH=$PATH:/usr/bin:/usr/sbin:/bin:/sbin
D=${CYTV_DEBLOAT_DIR:-/media/developer/cleanyourtv}
B=$D/backup/debloat-webos4
HOSTS=${CYTV_DEBLOAT_HOSTS:-/etc/hosts}
SBIN=${CYTV_DEBLOAT_SBIN:-/usr/sbin}
MOUNTS=${CYTV_DEBLOAT_MOUNTS:-/proc/mounts}
INITCTL=${CYTV_DEBLOAT_INITCTL:-/sbin/initctl}
[ ! -e "$D/DISABLE-DEBLOAT" ] || exit 0
umask 077

mkdir -p "$B"
mkdir "$B/lock" || exit 1
trap 'rmdir "$B/lock"' EXIT
for target in "$SBIN/acr2" "$SBIN/admanager" "$HOSTS"; do
    grep -qF " $target " "$MOUNTS" || continue
    case "$target" in
        "$HOSTS") [ -e "$B/owns-hosts" ] && cmp -s "$HOSTS" "$B/hosts" ;;
        *) [ -e "$B/owns-${target##*/}" ] && cmp -s "$target" "$D/stub-noop" ;;
    esac || { echo 'Foreign mount: nothing changed' >&2; exit 1; }
done

# 1. Backup /etc/hosts before changes
if [ ! -f "$B/hosts.original" ]; then
    cp "$HOSTS" "$B/hosts.original"
fi

# 2. Stop telemetry daemon remotelogger via Upstart
if "$INITCTL" status remotelogger 2>/dev/null | grep -q 'start/running'; then
    touch "$B/restart-remotelogger"
    "$INITCTL" stop remotelogger
fi

# 3. Bind-mount no-op stub over ad and telemetry binaries
printf '#!/bin/sh\nexit 0\n' > "$D/stub-noop"
chmod +x "$D/stub-noop"

for b in acr2 admanager; do
    if [ -e "$SBIN/$b" ]; then
        if grep -qF " $SBIN/$b " "$MOUNTS"; then
            cmp -s "$D/stub-noop" "$SBIN/$b" || { echo 'Foreign mount: left alone' >&2; exit 1; }
        else
            mount --bind "$D/stub-noop" "$SBIN/$b"
            touch "$B/owns-$b"
        fi
        pkill -9 -f "^$SBIN/$b( |$)" 2>/dev/null || true
    fi
done

# 4. Block ad servers in /etc/hosts
add_hosts() {
    cat <<'H'
127.0.0.1 eic.ads.lgtvcommon.com nl.ad.lgsmartad.com nl.info.lgsmartad.com # cleanyourtv-debloat
::1 eic.ads.lgtvcommon.com nl.ad.lgsmartad.com nl.info.lgsmartad.com # cleanyourtv-debloat
H
}

if grep -qF " $HOSTS " "$MOUNTS"; then
    cmp -s "$HOSTS" "$B/hosts" || { echo 'Foreign hosts mount: left alone' >&2; exit 1; }
else
    cp "$HOSTS" "$B/hosts"
    add_hosts >>"$B/hosts"
    mount --bind "$B/hosts" "$HOSTS"
    touch "$B/owns-hosts"
fi

echo "Debloat applied successfully."
