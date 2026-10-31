#!/bin/sh
# Separate from the launcher and the normal HOME controller; no hide/close or source activation.
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$HERE/home-lab.js" press
