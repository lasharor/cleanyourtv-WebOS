#!/bin/sh
# Full undo of debloat on webOS 4: restore hosts, unmount stubs, restart remotelogger
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
D=/media/developer/cleanyourtv
B=$D/backup/debloat-20261026

# 1. Unmount stubs over dynamic services
for b in acr2 admanager; do
    for m in $(awk -v b="/usr/sbin/$b" 'substr($2,length($2)-length(b)+1)==b {print $2}' /proc/mounts | sort -r); do
        umount "$m" 2>/dev/null || true
    done
done
rm -f "$D/stub-noop"

# 2. Restart Upstart daemon
/sbin/initctl start remotelogger 2>&1 | sed "s/^/remotelogger: /" || true

# 3. Restore /etc/hosts from backup if present, otherwise clean marked lines
if [ -f "$B/hosts.original" ]; then
    cp "$B/hosts.original" /etc/hosts
fi
if grep -q "# cleanyourtv-debloat" /etc/hosts; then
    grep -v "# cleanyourtv-debloat" /etc/hosts > /tmp/hosts.clean && cat /tmp/hosts.clean > /etc/hosts
    rm -f /tmp/hosts.clean
fi

echo "Debloat undone. Current status:"
/sbin/initctl status remotelogger || true
