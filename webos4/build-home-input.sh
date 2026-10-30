#!/bin/sh
# Development build only. Does not contact or install anything on a TV.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=${CYTV_HOME_INPUT_OUT:-"$ROOT/dist/webos4"}
mkdir -p "$OUT"
"${CC:-arm-linux-gnueabi-gcc}" -std=c11 -O2 -Wall -Wextra -Werror -static "$ROOT/webos4/home-input.c" -o "$OUT/home-input-arm"
cd "$OUT"
sha256sum home-input-arm >home-input-arm.sha256
printf '%s\n' "$OUT/home-input-arm"
