#!/bin/sh
set -e
TARGET="/usr/lib/qt5/qml/KeyFilters/systemUi.js"
PATCHED="/media/developer/cleanyourtv/webos4/systemUi.js"

if [ ! -f "$PATCHED" ]; then
    echo "Error: $PATCHED not found"
    exit 1
fi

mount --bind "$PATCHED" "$TARGET"
echo "Mounted $PATCHED over $TARGET"
