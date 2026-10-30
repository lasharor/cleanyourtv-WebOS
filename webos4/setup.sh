#!/bin/sh
# This branch never falls through into the systemd installer.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
R=${CYTV_TEST_ROOT:-}
BASE=$(node -e 'console.log(require(process.argv[1]).runtime)' "$HERE/profile.json")
[ -n "$R" ] || [ "$(id -u)" = 0 ] || { echo 'Root is required' >&2; exit 1; }
if [ "${1:-}" = runtime-install ]; then
    exec node "$HERE/runtime-install.js"
fi
if [ -n "$R" ]; then
    exec node "$HERE/setup.js" "$@"
fi
if [ "${1:-}" = install ] && [ ! -x "$BASE/node18" ]; then
    node "$HERE/runtime-install.js"
fi
[ -x /lib/ld-linux.so.3 ] && [ -x "$BASE/node18" ] && [ -d "$BASE/lib" ] || {
    echo 'Previously validated isolated runtime missing; system Node was not changed' >&2; exit 1;
}
exec /lib/ld-linux.so.3 --library-path "$BASE/lib:/lib:/usr/lib" "$BASE/node18" "$HERE/setup.js" "$@"
