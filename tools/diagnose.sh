#!/bin/sh
# Collects a read-only diagnostic report from a rooted TV over SSH and prints it, with addresses and secrets masked, so it can be saved and
# given to an AI assistant (or attached to a bug report). It changes nothing on the TV.
#   sh tools/diagnose.sh <tv-ip> > cytv-diagnose.txt
# Needs SSH access as root with a key (the Homebrew Channel's setup). READ THE FILE before you share it: masking is best effort.
IP="$1"
[ -n "$IP" ] || { echo "usage: sh tools/diagnose.sh <tv-ip> > cytv-diagnose.txt" >&2; exit 2; }

# hides what should not leave the house: addresses, MAC addresses, the secret parts of stream URLs, bearer tokens, long hex strings
# (perl is on macOS and Linux; sed on macOS has no word boundaries)
mask() {
  perl -pe 's#(https?://[^/\s"]+)/[^\s"]*#$1/<path>#g; s#Bearer [A-Za-z0-9._~+/=-]+#Bearer <token>#g; s#("(?:token|key|password|secret|bearer)"\s*:\s*")[^"]*#$1<hidden>#g; s#\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b#<mac>#g; s#\b[0-9a-fA-F]{32,}\b#<hex>#g; s#\b(?!127\.|0\.0\.0\.0)\d{1,3}(?:\.\d{1,3}){3}\b#<ip>#g'
}

ssh -o BatchMode=yes -o ConnectTimeout=8 "root@$IP" 'sh -s' <<'REMOTE' | mask
D=/media/developer/cleanyourtv
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
echo "===== diagnose.sh ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ====="
echo; echo "===== The CleanYourTV report (the same as Share log) ====="
node $D/sharelog.js --print 2>&1
echo; echo "===== System ====="
uname -a; echo "uptime: $(cut -d' ' -f1 /proc/uptime) s"; free 2>/dev/null | head -3; df -h /media/developer 2>/dev/null | tail -1
echo; echo "===== Foreground app ====="
luna-send -n 1 -w 3000 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>&1 | grep -E '"appId"|returnValue'
echo; echo "===== Running apps (ids) ====="
luna-send -n 1 -w 3000 -f luna://com.webos.applicationManager/running '{}' </dev/null 2>&1 | grep -E '"id"' | head -40
echo; echo "===== Media pipelines (a managed one that is not foreground can mean black video; a reboot clears it) ====="
luna-send -n 1 -w 4000 -f luna://com.webos.media/getActivePipelines '{}' </dev/null 2>&1 | grep -E '"type"|"sub_type"|"is_foreground"|"is_managed"|"app_id"|"resource"' | head -80
echo; echo "===== Processes ====="
ps 2>/dev/null | grep -E 'helper\.js|picker|hyperhdr|voiceconductor|node ' | grep -v grep
echo; echo "===== The service: version, Node.js, which parts run (/api/service) and the TV profile (/api/tv) ====="
curl -s -m 3 http://127.0.0.1:8765/api/service 2>&1; echo
curl -s -m 3 http://127.0.0.1:8765/api/tv 2>&1; echo
echo; echo "===== Settings changes in the service log (who changed an option or a key) ====="
grep -E '^config: ' /tmp/cleanyourtv-helper.log 2>/dev/null | tail -20
echo; echo "===== Input key mode (overlay, ondemand or launcher) and picker state ====="
cat $D/picker-mode 2>&1
echo; echo "===== config.json (secrets hidden) ====="
node -e 'var c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));(function m(o){for(var k in o){if(/token|key|secret|password|hash|url|webhook|playlist/i.test(k)&&typeof o[k]==="string"&&o[k])o[k]="<set>";else if(o[k]&&typeof o[k]==="object")m(o[k])}})(c);((c.phoneRemote||{}).phones||[]).forEach(function(p){p.name="<set>"});console.log(JSON.stringify(c,null,1))' $D/config.json 2>&1
echo; echo "===== Themes on the TV ====="
ls $D/themes 2>&1
echo; echo "===== The service's last operations (a start that finds a dead process logs them) ====="
cat /tmp/cytv-run.json 2>&1
echo; echo "===== Live TV status ====="
curl -s -m 3 http://127.0.0.1:8765/api/live/status 2>&1
echo
REMOTE
