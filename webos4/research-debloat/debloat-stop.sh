#!/bin/sh
# Safe RAM-only debloat for webOS 4 (Upstart initctl, stub mounts, hosts)
set -eu
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
D=/media/developer/cleanyourtv
B=$D/backup/debloat-20261026

mkdir -p "$B"

# 1. Backup /etc/hosts before changes
if [ ! -f "$B/hosts.original" ]; then
    cp /etc/hosts "$B/hosts.original"
fi

# 2. Stop telemetry daemon remotelogger via Upstart
if /sbin/initctl status remotelogger 2>/dev/null | grep -q 'start/running'; then
    /sbin/initctl stop remotelogger 2>&1 | sed "s/^/remotelogger: /" || true
fi

# 3. Bind-mount no-op stub over ad and telemetry binaries
printf '#!/bin/sh\nexit 0\n' > "$D/stub-noop"
chmod +x "$D/stub-noop"

for b in acr2 admanager; do
    if [ -e "/usr/sbin/$b" ]; then
        grep -q " /usr/sbin/$b " /proc/mounts || mount --bind "$D/stub-noop" "/usr/sbin/$b"
        pkill -9 -f "^/usr/sbin/$b" 2>/dev/null || true
    fi
done

# 4. Block ad servers in /etc/hosts
add_hosts() {
    cat <<'H'
127.0.0.1 eic.ads.lgtvcommon.com nl.ad.lgsmartad.com nl.info.lgsmartad.com # cleanyourtv-debloat
::1 eic.ads.lgtvcommon.com nl.ad.lgsmartad.com nl.info.lgsmartad.com # cleanyourtv-debloat
H
}

if ! grep -q "# cleanyourtv-debloat" /etc/hosts; then
    add_hosts >> /etc/hosts
fi

echo "Debloat applied successfully."
