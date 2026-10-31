#!/bin/sh
# Read-only installer inventory. This is not an installation or a safety guarantee.
set -eu
command -v luna-send >/dev/null || { echo 'Not on a webOS TV: no luna-send' >&2; exit 1; }
command -v node >/dev/null || { echo 'Cannot inspect JSON: no system Node' >&2; exit 1; }
INFO=$(luna-send -n 1 -w 5000 luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["sdkVersion"]}' </dev/null)
SDK=$(printf '%s' "$INFO" | node -e 'var s="";process.stdin.on("data",function(c){s+=c;});process.stdin.on("end",function(){try{var d=JSON.parse(s);if(d.returnValue!==true||!/^\d+(\.\d+)*$/.test(d.sdkVersion||""))throw Error();console.log(d.sdkVersion);}catch(e){process.exit(1);}});') || {
    echo 'Unknown SDK: nothing changed' >&2; exit 1;
}
MAJOR=${SDK%%.*}
INIT=unknown
if command -v systemctl >/dev/null; then INIT=systemd
elif command -v initctl >/dev/null; then INIT=upstart; fi
SYSTEM_NODE=$(node --version)
MODERN_NODE=0
node -e '(()=>1)()' >/dev/null 2>&1 && MODERN_NODE=1
printf 'readOnly=true\nsdk=%s\ninit=%s\nsystemNode=%s\n' "$SDK" "$INIT" "$SYSTEM_NODE"
if [ "$MAJOR" = 4 ]; then
    echo 'normalInstallerSupported=false'
    echo 'requiredPort=isolated-runtime,Upstart,configd-keyfilters,validated-source-launches'
    echo 'status=experimental-port-required; the separate UI trial is not proof of installer support'
elif [ "$MAJOR" -ge 5 ] && [ "$INIT" = systemd ] && [ "$MODERN_NODE" = 1 ]; then
    echo 'normalInstallerPrerequisites=true'
    echo 'status=inventory-only; firmware,HOME,backup and physical validation still required'
else
    echo 'normalInstallerSupported=false'
    echo 'status=unsupported-prerequisites; nothing changed'
fi
echo 'No install, download, service restart, mount, boot edit or TV setting change performed.'
