#!/bin/sh
# Builds the two voice programs from source on any computer with zig (https://ziglang.org, tested with 0.15.2):
#   voice/cytv-asr    (64-bit ARM, Linux) from asr.c, against libmoonshine.so and moonshine-c-api.h of the moonshine-voice 0.1.5 release
#   voice/cytv-asr32  (32-bit ARM hard-float, Linux) from asr32.c, against libsherpa-onnx-c-api.so and c-api.h of sherpa-onnx-core 2.0.1
# The script fetches what it links against and checks the checksums.
set -e
cd "$(dirname "$0")"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
sum() { [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$2" ] || { echo "checksum mismatch: $1" >&2; exit 1; }; }

URL=https://files.pythonhosted.org/packages/23/1c/cb821747b2a7b40216dd576a62d1ebc77d04fab97064efc97fa460f137ed/moonshine_voice-0.1.5-py3-none-manylinux_2_31_aarch64.whl
curl -fsSL "$URL" -o "$T/mv.whl"
sum "$T/mv.whl" 605300afe33eb7920301e73f11e0ea7493770eb655f389ba65be4aa1db8dedd6
unzip -qo "$T/mv.whl" moonshine_voice/libmoonshine.so -d "$T"
curl -fsSL https://raw.githubusercontent.com/moonshine-ai/moonshine/v0.1.5/core/moonshine-c-api.h -o "$T/moonshine-c-api.h"
zig cc -target aarch64-linux-gnu.2.31 -O2 -s -I"$T" asr.c "$T/moonshine_voice/libmoonshine.so" -o cytv-asr

# ARMv7 with hard float: the voice download brings the hard-float C library of ubuntu-base armhf (the TV's own 32-bit libc is soft-float)
URL=https://files.pythonhosted.org/packages/2a/d3/6793600ab1d256c57f4f03d08df15e8a56ea96605e4db7b4f96e8275be8a/sherpa_onnx_core-2.0.1-py3-none-manylinux_2_35_armv7l.whl
curl -fsSL "$URL" -o "$T/so.whl"
sum "$T/so.whl" c6ee74dffb4acf81f5fb26e1d45560baa6fd5c34bc192546b50c744005eb9702
unzip -qo "$T/so.whl" 'sherpa_onnx/include/*' sherpa_onnx/lib/libsherpa-onnx-c-api.so -d "$T"
zig cc -target arm-linux-gnueabihf.2.27 -mcpu=cortex_a7 -O2 -s -I"$T/sherpa_onnx/include" asr32.c "$T/sherpa_onnx/lib/libsherpa-onnx-c-api.so" -o cytv-asr32
ls -l cytv-asr cytv-asr32
