#!/bin/sh
# webOS 4 only. Config notifications reload the native key filters in place.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=/usr/lib/qt5/qml/KeyFilters/systemUi.js
PATCH="$HERE/systemUi.js"
BASE=/media/developer/cleanyourtv
RUN="$BASE/run_helper.sh"
LOCK=/tmp/cytv-home-startup.lock
BOOT=/var/lib/webosbrew/init.d/10-cleanyourtv-home
ORIGINAL=a28d9fee1256258b56727dd3827c3925c07badbb51349a8c1a8189fdfbbb1279
PATCHED=bf89d18f597ade2b226c6cacefadfd1eb578af936b846afba957d9bd0e99874e
LEGACY=1b0d05a975c2601b6bf6f0e0065266271793f906f8e94ff9802e7155604af4f5
sha() { sha256sum <"$1" 2>/dev/null | cut -d' ' -f1; }
mounted() { grep -q " $TARGET " /proc/mounts; }
known_mount() {
    case "$(sha "$TARGET")" in "$PATCHED"|"$LEGACY") return 0 ;; *) return 1 ;; esac
}
check_configs() {
    [ "$(sha "$HERE/keyfilters-original.json")" = 4afb42bc3f369966ddb3fbeda670eacec735699768a48387b331c69bb162255f ] &&
    [ "$(sha "$HERE/keyfilters-cleanyourtv.json")" = e8d66484e0ed92e5283ae66a6a33d48b37bee549aec6275c5dd2f793b5a5950e ] || {
        echo 'Unexpected key-filter templates: nothing changed' >&2; return 1;
    }
}
filters_state() {
    luna-send -n 1 -w 3000 luna://com.webos.service.config/getConfigs '{"configNames":["com.webos.surfacemanager.keyFilters"]}' </dev/null |
        /usr/bin/node -e 'var fs=require("fs"),s="",key="com.webos.surfacemanager.keyFilters",dir=process.argv[1];
function same(a,b){return Array.isArray(a)&&a.length===b.length&&a.every(function(v,i){return v&&Object.keys(v).length===2&&v.handler===b[i].handler&&v.file===b[i].file;});}
process.stdin.on("data",function(c){s+=c;});process.stdin.on("end",function(){try{var d=JSON.parse(s);if(d.returnValue!==true||!d.configs)throw Error();var a=d.configs[key];for(var i=0;i<2;i++){var name=i?"cleanyourtv":"original",b=JSON.parse(fs.readFileSync(dir+"/keyfilters-"+name+".json","utf8")).configs[key];if(same(a,b)){console.log(name);return;}}throw Error();}catch(e){console.error("Unknown or unavailable key-filter configuration: left alone");process.exit(1);}});' "$HERE"
}
set_filters() {
    luna-send -n 1 -w 3000 luna://com.webos.service.config/setConfigs "$(cat "$HERE/keyfilters-$1.json")" </dev/null |
        /usr/bin/node -e 'var s="";process.stdin.on("data",function(c){s+=c;});process.stdin.on("end",function(){try{process.exit(JSON.parse(s).returnValue===true?0:1);}catch(e){process.exit(1);}});' || {
        echo 'Key-filter update uncertain: not retried' >&2; return 1;
    }
    [ "$(filters_state)" = "$1" ] || { echo 'Key-filter readback uncertain: not retried' >&2; return 1; }
}
ready() {
    curl -fsS --max-time 2 http://127.0.0.1:8765/api/service 2>/dev/null |
        /usr/bin/node -e 'var s="";process.stdin.on("data",function(c){s+=c;});process.stdin.on("end",function(){try{var d=JSON.parse(s);process.exit(d.version==="0.2.0"&&d.readOnly===false?0:1);}catch(e){process.exit(1);}});'
}
umask 077
case "${1:-}" in
    start|disable)
        mkdir "$LOCK" || { echo 'Another HOME start/disable is in progress' >&2; exit 1; }
        trap 'rmdir "$LOCK"' EXIT
        ;;
esac
case "${1:-}" in
    disable)
        check_configs
        hf_filters=$(filters_state)
        touch "$HERE/DISABLED"
        if mounted; then
            known_mount || { echo 'Unknown HOME mount: left alone' >&2; exit 1; }
            umount "$TARGET"
        fi
        # A different array forces reload after unmount, even if LG paths were already selected.
        if [ "$hf_filters" = original ]; then set_filters cleanyourtv; else set_filters original; fi
        echo 'Disabled. LG key filters restored without restarting graphics. Helper left running.'
        exit 0
        ;;
    status)
        if [ -e "$HERE/DISABLED" ]; then echo disabled
        elif [ -x "$BOOT" ] && cmp -s "$HERE/10-cleanyourtv-home" "$BOOT"; then echo boot-enabled
        else echo boot-not-installed; fi
        if mounted && known_mount; then
            if [ "$(sha "$TARGET")" = "$PATCHED" ]; then echo patch-mounted; else echo legacy-patch-mounted; fi
        else echo no-known-patch-mount; fi
        check_configs
        filters_state
        if ready; then echo helper-ready; else echo helper-unavailable; fi
        exit 0
        ;;
    start) ;;
    *) echo 'Usage: home-startup.sh start | disable | status' >&2; exit 2 ;;
esac
[ ! -e "$HERE/DISABLED" ] || { echo disabled; exit 0; }
check_configs
[ "$(sha "$PATCH")" = "$PATCHED" ] || { echo 'Unexpected patch: nothing changed' >&2; exit 1; }
if mounted; then
    known_mount || { echo 'Unrelated HOME mount: left alone' >&2; exit 1; }
else
    [ "$(sha "$TARGET")" = "$ORIGINAL" ] || { echo 'Unexpected LG file: nothing changed' >&2; exit 1; }
fi
[ "$(cat /home/root/.config/lginputhook/keybinds.json)" = '{}' ] && [ ! -e /tmp/inputhook ] || {
    echo 'Conflicting Input Hook: nothing changed' >&2; exit 1;
}
[ "$(sha "$RUN")" = d22f69ece11fd8610cec55a9ea6a86d6083c5c1882c24f58170cc5d40d870f26 ] &&
[ "$(sha "$BASE/helper/webos4.js")" = ed1e72cd29e375452bbf03cad4ddc5bafb6936912a13004f5cb24c969a5cb8fc ] || {
    echo 'Unexpected helper files: nothing changed' >&2; exit 1;
}
hf_filters=$(filters_state)
if ! ready; then
    # Do not start another copy over a live but unresponsive helper.
    if [ -r "$BASE/state/helper.pid" ]; then
        hf_pid=$(cat "$BASE/state/helper.pid")
        case "$hf_pid" in ''|*[!0-9]*) hf_pid=0 ;; esac
        if [ "$hf_pid" -gt 1 ] && [ -r "/proc/$hf_pid/cmdline" ] &&
            tr '\000' '\n' <"/proc/$hf_pid/cmdline" | grep -Fxq "$BASE/helper/webos4.js"; then
            echo 'Existing helper is unresponsive: left alone' >&2; exit 1;
        fi
    fi
    nohup sh "$RUN" </dev/null >>"$HERE/helper.log" 2>&1 &
    hf_ready=false
    for attempt in 1 2 3 4 5 6 7 8; do
        if ready; then hf_ready=true; break; fi
        sleep 1
    done
    [ "$hf_ready" = true ] || { echo 'Helper failed: HOME unchanged' >&2; exit 1; }
fi
if mounted; then echo 'Known HOME already mounted; helper ready; no graphics restart'; exit 0; fi
mount --bind "$PATCH" "$TARGET"
# Both path spellings resolve to LG's file after reboot; only this boot's RAM mount replaces it.
if [ "$hf_filters" = original ]; then hf_next=cleanyourtv; else hf_next=original; fi
if ! set_filters "$hf_next"; then
    touch "$HERE/DISABLED"
    umount "$TARGET"
    echo 'HOME reload uncertain; disabled for next boot. No graphics restart.' >&2
    exit 1
fi
echo 'HOME key filters active; helper ready; no graphics restart'
