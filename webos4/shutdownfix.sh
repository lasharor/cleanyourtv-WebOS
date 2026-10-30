#!/bin/sh
# Firmware-specific shutdown-script guard, not a proven standby-speed fix.
#
# LG's /etc/init/shutdown.conf starts by trying `rm -f` on /var/luna/preferences/devmode_enabled. On this TV that path is a directory,
# an early status-1 exit was recorded at about 14 ms and the directory case reproduces locally.
# Later original/fixed A/B tests both took ~12 s; Netflix's missing ACK explains a separately captured wait.
# This hook mounts, in RAM only, a copy of that file with one extra condition (`&& [ ! -d ...]`) so the directory is left alone and the rest runs.
# It touches nothing else and never writes to the directory. Nothing under /etc is changed on disk; a reboot without this hook restores LG's file.
#
# It acts only when ALL of these hold: no DISABLE-SHUTDOWNFIX marker, devmode_enabled is a directory, nothing is mounted over the file yet,
# the file's SHA-256 is the one this was written for, and the generated copy has the expected SHA-256. Otherwise it leaves LG's file alone.
# Undo now: umount /etc/init/shutdown.conf && initctl reload-configuration.  Undo for good: touch $BASE/DISABLE-SHUTDOWNFIX or remove the hook.
CONF=${CYTV_SF_CONF:-/etc/init/shutdown.conf}
PREFS=${CYTV_SF_PREFS:-/var/luna/preferences}
BASE=${CYTV_SF_BASE:-/media/developer/cleanyourtv}
OUT=${CYTV_SF_OUT:-/tmp/cytv-shutdown.conf}
MOUNTS=${CYTV_SF_MOUNTS:-/proc/mounts}
LOG=${CYTV_SF_LOG:-/tmp/cytv-shutdownfix.log}
ORIGINAL=4d04ec39a7deb73dcb11b9d85fca9fdf7f32700016afa11d6d0d7a99209cc379
FIXED=b38d52195f8df382c33768d923f5ded1104f63e439130c5a5c4f9bb521add71f

say() { echo "$(date +%T) $*" >>"$LOG"; }
sha() { sha256sum <"$1" 2>/dev/null | cut -d' ' -f1; }

[ -e "$BASE/DISABLE-SHUTDOWNFIX" ] && { say "disabled by marker"; exit 0; }
grep -qF " $CONF " "$MOUNTS" 2>/dev/null && { say "already mounted: left alone"; exit 0; }
[ -d "$PREFS/devmode_enabled" ] || { say "devmode_enabled is not a directory: LG's script works, nothing to do"; exit 0; }
[ "$(sha "$CONF")" = "$ORIGINAL" ] || { say "shutdown.conf is not the known one: left alone"; exit 0; }

sed 's|if \[ -e \$DIR/devmode_enabled \] ; then|if [ -e $DIR/devmode_enabled ] \&\& [ ! -d $DIR/devmode_enabled ] ; then|' "$CONF" >"$OUT" 2>/dev/null
if [ "$(sha "$OUT")" != "$FIXED" ]; then
    say "generated copy is not the expected one: left alone"
    rm -f "$OUT"
    exit 0
fi
chmod 644 "$OUT"
${CYTV_SF_MOUNT:-mount} --bind "$OUT" "$CONF" || { say "mount failed: left alone"; exit 0; }
${CYTV_SF_INITCTL:-initctl} reload-configuration || say "reload-configuration failed"
say "mounted the fixed copy over $CONF"
exit 0
