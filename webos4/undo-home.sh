#!/bin/sh
TARGET="/usr/lib/qt5/qml/KeyFilters/systemUi.js"
BOOT_HOOK="/var/lib/webosbrew/init.d/10-cleanyourtv-home"

rm -f "$BOOT_HOOK" 2>/dev/null || true

if mount | grep -q "$TARGET"; then
    umount "$TARGET" 2>/dev/null || true
    echo "Unmounted $TARGET"
else
    echo "$TARGET was not mounted"
fi
