#!/bin/sh
# CleanYourTV service bootstrap. Runs as root on the TV, from the service folder of the installed package:
#   sh bootstrap.sh install [--no-debloat] [--no-input-key] [--debloat] [--input-key] [--no-start] [--no-verify] [--force]
#   sh bootstrap.sh update <version>      after the manager installed a newer package (restarts the service, undoes it if it fails)
# It copies the service files to /media/developer/cleanyourtv, installs the boot scripts, replaces LG's Home and starts the service.
# Idempotent: running it again repairs a broken install. What differs between TVs (the notification window type, whether the
# firmware is in the compatibility list, whether LG's Home is a kind we support) is decided by helper/tvprofile.js, the same rules the
# service follows. The steps are the functions below; the order is at the end of the file.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
S=$(cd "$(dirname "$0")" && pwd)
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r "$S/scripts/luna-compat.sh" ] || . "$S/scripts/luna-compat.sh"
R=${CYTV_TEST_ROOT:-}                 # a folder that stands in for / (tools/test/scripts.test.js only; empty on a TV)
MD=$R/media/developer
D=$MD/cleanyourtv
export CYTV_DIR="$D"
INITD=$R/var/lib/webosbrew/init.d
J="node $S/scripts/jtool.js"          # JSON helper (node, not python3)
TV="node $S/helper/tvprofile.js"      # per-TV decisions
HOME_DIR=$R/usr/palm/applications/com.webos.app.home

MODE=${1:-install}; [ $# -gt 0 ] && shift
WANT=""; [ "$MODE" = update ] && { WANT=$1; shift; }
DEBLOAT=""; INPUTKEY=""; START=1; VERIFY=1; FORCE=0
for a in "$@"; do
  case "$a" in
    --no-debloat) DEBLOAT=0 ;; --debloat) DEBLOAT=1 ;;
    --no-input-key) INPUTKEY=0 ;; --input-key) INPUTKEY=1 ;;
    --no-start) START=0 ;; --no-verify) VERIFY=0 ;; --force) FORCE=1 ;;
    *) echo "unknown option: $a"; exit 1 ;;
  esac
done

say() { echo "[cleanyourtv] $*"; }
warn() { echo "[cleanyourtv] WARNING: $*" >&2; }
die() { echo "[cleanyourtv] ERROR: $*" >&2; exit 1; }
luna() { luna_send -n 1 -w 5000 -f "luna://$1" "$2" 2>/dev/null; }
svc_version() { sed -n "s/^const VERSION = '\(.*\)';/\1/p" "$1" | head -1; }
service_answers() { curl -s -m 3 http://127.0.0.1:8765/api/version | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'; }
opt() { $J opt "$D/config.json" "$1"; }

# ---- checks before anything is changed ----
preflight() {
  [ -n "$R" ] || [ "$(id -u)" = 0 ] || die "run as root"
  command -v luna-send >/dev/null || die "this does not look like webOS (no luna-send)"
  [ -d "$INITD" ] || die "$INITD not found: root with the Homebrew Channel is required (https://rootmy.tv)"
  [ -w $MD ] || die "/media/developer is not writable"
  for t in tar node; do command -v $t >/dev/null || die "missing tool: $t"; done
  # hard requirements: --force does not skip these (older webOS has no systemd and an old Node that cannot run the service)
  command -v systemctl >/dev/null || die "this TV has no systemd (webOS older than 5): CleanYourTV needs a newer webOS and cannot be set up here. Nothing was changed."
  node -e '(()=>1)()' >/dev/null 2>&1 || die "this TV's Node.js ($(node -v 2>&1 | head -1)) is too old for the service: CleanYourTV needs a newer webOS and cannot be set up here. Nothing was changed."
  [ -f $S/helper/helper.js ] && [ -f $S/scripts/10-cleanyourtv-home ] || die "the service files are incomplete in $S"
  [ -f $HOME_DIR/appinfo.json ] || die "stock Home app not found at $HOME_DIR"
  if grep -q " $HOME_DIR " /proc/mounts && [ ! -f $D/backup/home-appinfo.orig.json ]; then
    die "Home is already replaced but no backup exists; reboot the TV once, then run this again"
  fi
}

# ---- what this TV is ----
detect() {
  info=$(luna com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["modelName","firmwareVersion","sdkVersion"]}')
  model=$(echo "$info" | sed -n 's/.*"modelName": *"\([^"]*\)".*/\1/p')
  fw=$(echo "$info" | sed -n 's/.*"firmwareVersion": *"\([^"]*\)".*/\1/p')
  sdk=$(echo "$info" | sed -n 's/.*"sdkVersion": *"\([^"]*\)".*/\1/p')
}

# The notification app's window type (tvprofile.js: "topui" from SDK 10, "overlay" before and when the SDK is unknown). The package
# always ships "topui", so this runs on every install and update; a change needs the system app manager to read the app again
# (ensure_apps restarts it, the screen blinks once).
NOTIFY_CHANGED=0
fix_notify_window() {
  NA=$MD/apps/usr/palm/applications/com.cleanyourtv.notify/appinfo.json
  [ -f $NA ] || return 0
  want=$($TV get notifyWindow --sdk "$sdk")
  [ -n "$want" ] || want=overlay
  if $J wintype "$NA" "$want"; then NOTIFY_CHANGED=1; say "picture notifications use the $want window on this TV (webOS SDK ${sdk:-unknown})"; fi
}

# A firmware in the compatibility list is set up without --force (a newer copy of the list is fetched from the repository when possible).
# Otherwise LG's Home must be the flutter or web kind the launcher was written for, or the user chose "Set up anyway" (--force).
check_compat() {
  say "TV: ${model:-unknown model}, firmware ${fw:-?}, webOS SDK ${sdk:-?}"
  mkdir -p $D
  COMPATREPO=$(cut -d' ' -f1 $D/source 2>/dev/null); [ -n "$COMPATREPO" ] || COMPATREPO=lasharor/cleanyourtv-WebOS
  [ -z "$R" ] && curl -fsSL -m 6 "https://raw.githubusercontent.com/$COMPATREPO/main/compat.json" -o /tmp/cytv-compat.json 2>/dev/null && node -e 'JSON.parse(require("fs").readFileSync("/tmp/cytv-compat.json","utf8"))' 2>/dev/null && cp /tmp/cytv-compat.json $D/compat.json
  COMPATNOTE=$($TV get testedNote --firmware "$fw" --sdk "$sdk" --compat $D/compat.json $S/compat.json)

  SRCINFO=$D/backup/home-appinfo.orig.json; [ -f "$SRCINFO" ] || SRCINFO=$HOME_DIR/appinfo.json
  HOMEKIND=$($J kind "$SRCINFO" 2>/dev/null)
  case "$HOMEKIND" in com.webos.app.home*) HOMEID=1 ;; *) HOMEID=0 ;; esac
  if [ -n "$COMPATNOTE" ] && [ $HOMEID = 1 ]; then
    say "this firmware is in the compatibility list ($COMPATNOTE); LG's Home app is '${HOMEKIND#com.webos.app.home }'"
  elif [ "$($TV get homeSupported --home "$HOMEKIND")" = 1 ]; then
    warn "firmware ${fw:-?} is not in the compatibility list; continuing because LG's Home is the flutter or web kind this was written for. The original state is saved and a failed start restarts the TV with LG's Home."
  elif [ $FORCE = 1 ]; then
    warn "firmware ${fw:-?} is not in the compatibility list and LG's Home app is '${HOMEKIND:-unreadable}', not the flutter or web app this was tested with; continuing because of --force"
  else
    die "LG's Home app looks different from what this expects (found: ${HOMEKIND:-unreadable}; firmware ${fw:-?} is not in the compatibility list). To try anyway use 'Set up anyway' in the app, or run bootstrap.sh install --force. The original is saved and a failed start is rolled back with a restart."
  fi
}

# ---- the original state (first run only) ----
backup() {
  mkdir -p $D/backup
  [ -f $D/backup/home-appinfo.orig.json ] || cp $HOME_DIR/appinfo.json $D/backup/home-appinfo.orig.json
  [ -f $D/backup/hosts.orig ] || cp /etc/hosts $D/backup/hosts.orig
  [ -f $D/backup/processes.orig.txt ] || { ps > $D/backup/processes.orig.txt 2>&1; systemctl list-units --no-legend > $D/backup/units.orig.txt 2>&1; date > $D/backup/date.txt; }
  # an update keeps the running version's files, so a failed start can be undone
  if [ "$MODE" = update ]; then
    (cd $D && tar czf backup/service-prev.tgz $(ls *.js *.sh 10-cleanyourtv-home 15-cleanyourtv-debloat 2>/dev/null) inputhook 2>/dev/null)
  fi
}

# ---- the service files ----
copy_files() {
  cp $S/helper/*.js $D/
  [ -d $S/i18n ] && { mkdir -p $D/i18n; cp $S/i18n/* $D/i18n/; }   # the translations, for the phone pages (helper/i18n.js)
  if [ -f $S/BUILD ]; then cp $S/BUILD $D/BUILD; else rm -f $D/BUILD; fi   # the commit of a test build
  cp $S/scripts/* $D/
  mkdir -p $D/inputhook && cp $S/inputhook/* $D/inputhook/ && chmod 755 $D/inputhook/ezinject
  [ -d $S/licenses ] && { mkdir -p $D/licenses; cp $S/licenses/* $D/licenses/; }
  chmod +x $D/*.sh $D/10-cleanyourtv-home $D/15-cleanyourtv-debloat
  # root runs these files at boot and from the Input-key hook: nobody else may write them (the dev partition is world-writable)
  chmod -R go-w $D $S 2>/dev/null
  mkdir -p $D/live; chmod 700 $D/live 2>/dev/null; chmod 600 $D/config.json $D/usage.json $D/live/* 2>/dev/null
  [ -f $D/config.json ] || cp $S/config.example.json $D/config.json
  [ -f $D/compat.json ] || cp $S/compat.json $D/compat.json
}

# ---- the launcher that ships with the package, unless a newer one is already installed ----
install_launcher() {
  if [ ! -f $D/app/index.html ] || $J newer $S/payload/app/version.json $D/app/version.json || { [ -f $S/payload/app/BUILD ] && ! cmp -s $S/payload/app/BUILD $D/app/BUILD; }; then
    rm -rf $D/app.prev; [ -d $D/app ] && mv $D/app $D/app.prev
    mkdir -p $D/app && cp $S/payload/app/* $D/app/
    say "launcher $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' $D/app/version.json) in place"
    FRONTEND_NEW=1
  fi
}

# ---- options (stored in config.json, changed later in the manager). An update passes no values: the user's choices stay. ----
set_options() {
  $J options "$D/config.json" "$DEBLOAT" "$INPUTKEY"
  [ -n "$CYTV_REPO" ] && echo "$CYTV_REPO ${CYTV_REF:-main}" > $D/source
  [ "$MODE" = install ] && rm -f $D/DISABLE $D/DISABLE-DEBLOAT   # setting up selects our Home; an update keeps the choice
}

boot_scripts() {
  ln -sf $D/10-cleanyourtv-home $INITD/10-cleanyourtv-home
  if [ "$(opt debloat)" = 1 ]; then ln -sf $D/15-cleanyourtv-debloat $INITD/15-cleanyourtv-debloat; else rm -f $INITD/15-cleanyourtv-debloat; fi
  VERSION=$(svc_version $D/helper.js)
  say "service $VERSION installed in $D; boot scripts in $INITD"
}

# The picker and notification apps ship in the same package as the manager, but the system app manager only learns about the extra
# apps when it restarts. Restart it once if they are missing (the screen blinks).
ensure_apps() {
  missing=0
  for id in com.cleanyourtv.picker com.cleanyourtv.notify; do
    [ -d $MD/apps/usr/palm/applications/$id ] && ! luna com.webos.applicationManager/getAppInfo "{\"id\":\"$id\"}" | grep -q '"returnValue": true' && missing=1
  done
  [ $NOTIFY_CHANGED = 1 ] && missing=1
  [ $missing = 0 ] && return 0
  say "registering the overlay apps (the screen blinks once)"
  (sleep 3; pkill -9 -f /usr/palm/applications/airplay/LunaExecutable) </dev/null >/dev/null 2>&1 &
  systemctl restart sam
  for i in $(seq 1 60); do systemctl is-active sam >/dev/null && break; sleep 2; done
  sh $D/after-sam.sh </dev/null
  sleep 10
  pkill -f "[a]pp-id=com.webos.app.home"; sleep 2
  luna_send -n 1 -w 10000 -f luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null
}

# ---- an update: restart the service on the new files; go back to the previous files if it does not answer ----
restart_for_update() {
  say "restarting the service"
  pkill -f "[c]leanyourtv/watchdog.sh"   # the boot script below starts the watchdog of the new files
  pkill -f "[c]leanyourtv/helper.js"; sleep 1
  sh $D/10-cleanyourtv-home keep </dev/null
  ok=0
  for i in $(seq 1 15); do
    sleep 3
    hv=$(service_answers)
    [ "$hv" = "$WANT" ] && { ok=1; break; }
  done
  if [ $ok = 0 ]; then
    warn "the new service (${hv:-not answering}) did not come up; going back to the previous files"
    pkill -f "[c]leanyourtv/watchdog.sh"
    pkill -f "[c]leanyourtv/helper.js"; sleep 1
    [ -f $D/backup/service-prev.tgz ] && (cd $D && tar xzf backup/service-prev.tgz)
    echo "update to $WANT failed at $(date)" > $D/last-error.txt
    sh $D/10-cleanyourtv-home keep </dev/null
    exit 1
  fi
  say "service $WANT is running"
  ensure_apps
  # the overlay apps and the launcher may have new pages: restart the hidden picker (the service starts it again) and reload Home
  luna_send -n 1 -w 3000 luna://com.webos.applicationManager/closeByAppId '{"id":"com.cleanyourtv.picker"}' >/dev/null 2>&1
  if [ "$FRONTEND_NEW" = 1 ] && { grep -q " $HOME_DIR " /proc/mounts || [ -f $R/tmp/cleanyourtv-home-standin ]; }; then
    sh $D/reload-home.sh </dev/null
  fi
}

# ---- a new install: start everything ----
start_install() {
  say "starting (the screen blinks once while the system app manager restarts)"
  pkill -f "[c]leanyourtv/watchdog.sh"; pkill -f "[c]leanyourtv/helper.js"; pkill -f "[l]una-send -i -f"; sleep 1
  sh $D/10-cleanyourtv-home </dev/null
  [ "$(opt debloat)" = 1 ] && sh $D/debloat-stop.sh </dev/null
}

# ---- check that the new Home came up; with the stand-in way try the mount way once; roll back if neither works ----
# wait_home: up to two minutes for the launcher as Home and the service of this version; sets type and hv; true when it came up
wait_home() {
  for i in $(seq 1 40); do
    sleep 3
    type=$(luna com.webos.applicationManager/getAppInfo '{"id":"com.webos.app.home"}' | sed -n 's/.*"type": *"\([^"]*\)".*/\1/p' | head -1)
    # the stand-in way (LG's native Home): sam still sees LG's native Home, and webapp-mgr holds the launcher
    if [ -f $R/tmp/cleanyourtv-home-standin ] && luna com.palm.webappmanager/listRunningApps '{}' | grep -q '"com.webos.app.home"'; then type=web; fi
    hv=$(service_answers)
    if [ "$type" = web ] && [ "$hv" = "$VERSION" ]; then return 0; fi
  done
  return 1
}
verify() {
  say "checking that the new Home came up..."
  wait_home && return 0
  if [ "$($TV get homeTakeover --home "$HOMEKIND")" = standin ] && [ "$(cat $D/home-method 2>/dev/null)" != mount ]; then
    # Some TVs with a native Home never run the stand-in program: with CRIU (criu_enabled on the kernel command line) LG's Home is
    # restored from a checkpoint instead of being started from its program (issues 72 and 84). The mount way works there, so it is
    # used from now on, also at the next boots (home-method). A TV where the stand-in works never gets here.
    CRIU=$(grep -o criu_enabled $R/proc/cmdline 2>/dev/null | head -1)
    warn "the stand-in did not bring the launcher up (app type: ${type:-none}, service: ${hv:-not answering})${CRIU:+; this TV has CRIU}. Trying the other way: the launcher mounted over LG's Home"
    echo mount > $D/home-method; RETRIED=1
    # the boot script has put LG's Home back by now; make sure of it (this lifts the debloat, which is started again below)
    [ -f $R/tmp/cleanyourtv-home-standin ] && sh $D/undo-home.sh temp </dev/null
    pkill -f "[c]leanyourtv/watchdog.sh"; pkill -f "[c]leanyourtv/helper.js"; sleep 1
    sh $D/10-cleanyourtv-home </dev/null
    [ "$(opt debloat)" = 1 ] && sh $D/debloat-stop.sh </dev/null
    say "checking again..."
    wait_home && return 0
  fi
  warn "the new Home did not come up (app type: ${type:-none}, service: ${hv:-not answering}); rolling back"
  # restoring LG's Home live does not always work; without the boot scripts a restart brings it back
  cp /tmp/cleanyourtv-helper.log $MD/cytv-setup.log.service 2>/dev/null
  rm -f $INITD/10-cleanyourtv-home $INITD/15-cleanyourtv-debloat
  [ -n "$RETRIED" ] && rm -f $D/home-method   # only the file this setup wrote
  echo '{"lastAppId":"com.webos.app.home"}' > $R/var/luna/preferences/bootd_last_foreground_app_id.json 2>/dev/null
  (sleep 4; reboot) </dev/null >/dev/null 2>&1 &
  die "rolled back: the boot scripts are removed and the TV restarts with LG's Home. Details: /media/developer/cytv-setup.log and cytv-setup.log.service"
}

finish() {
  ensure_apps
  say "done. Hold OK on an app to customise the dock, or use the Customise button at the top right."
  [ -d $R/usr/palm/applications/com.webos.app.fullhome ] && say "This TV also has LG's full-screen Home. If the Home button opens that instead of CleanYourTV: TV Settings > General > Home Settings > Home Style > Basic."
  say "Back to LG's Home any time: switch off 'CleanYourTV as Home' in the manager app, or run: sh $D/undo-home.sh"
}

# ---- the order ----
preflight
detect
fix_notify_window
[ "$MODE" = install ] && check_compat
backup
copy_files
install_launcher
set_options
boot_scripts
if [ $START = 0 ]; then say "done. Everything takes effect at the next reboot."; exit 0; fi
if [ "$MODE" = update ]; then restart_for_update; exit 0; fi
start_install
[ $VERIFY = 1 ] && verify
finish
