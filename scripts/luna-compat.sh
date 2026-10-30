#!/bin/sh
# Closed stdin is the default. Opt in only where EOF makes luna-send exit early.
# Each call owns a subshell: neither the caller nor background children inherit fd 3.
# The flag is not overwritten by bootstrap.sh, so it survives updates and reboots.
luna_exec() {
    _cytv_luna_mode=${CYTV_LUNA_STDIN:-}
    if [ "$_cytv_luna_mode" != open ] && [ "$_cytv_luna_mode" != closed ]; then
        _cytv_luna_mode=closed
        [ ! -f "${CYTV_DIR:-/media/developer/cleanyourtv}/luna-stdin-open" ] || _cytv_luna_mode=open
    fi
    if [ "$_cytv_luna_mode" = open ]; then
        _cytv_luna_tmp=$(umask 077; mktemp -d "${TMPDIR:-/tmp}/cytv-luna.XXXXXX") || return 1
        mkfifo "$_cytv_luna_tmp/stdin" || { rmdir "$_cytv_luna_tmp"; return 1; }
        exec 3<> "$_cytv_luna_tmp/stdin" || { rm -f "$_cytv_luna_tmp/stdin"; rmdir "$_cytv_luna_tmp"; return 1; }
        rm -f "$_cytv_luna_tmp/stdin"
        rmdir "$_cytv_luna_tmp"
        exec luna-send "$@" <&3 3<&-
    else
        exec luna-send "$@" </dev/null
    fi
}
luna_send() ( luna_exec "$@" )
