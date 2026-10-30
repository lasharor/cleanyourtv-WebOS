#!/bin/sh
# CleanYourTV for LG webOS: installs the manager app only. Run ON the TV, as root (see the README and https://lasharor.github.io/cleanyourtv-WebOS/install/). It downloads the latest
# release package (an .ipk), checks its SHA-256 and installs it. The setup itself (replacing LG's Home, the Input key,
# the debloat) is done afterwards in the CleanYourTV app on the TV: open it and choose "Set up now".
#
#   ssh root@<tv-ip> 'curl -fsSL https://raw.githubusercontent.com/lasharor/cleanyourtv-WebOS/main/install.sh | sh'
#
# Environment: CYTV_REPO=owner/name (default lasharor/cleanyourtv-WebOS)  CYTV_IPK=/path/to/package.ipk (use a local package)
#   CYTV_CHANNEL=dev  install the dev build (the pre-release dev, rebuilt on every change) and keep following it; the manager app
#   can switch back to the stable releases (Update channel). CYTV_BRANCH=<anything>, from before the dev builds, means the same.
# From a local checkout, --check only inventories the TV; it does not install or make webOS 4 supported.
# A built local kit also supports --webos4 check|install|start|stop|status|show for the experimental SDK 4 profile.
# That branch installs a separate original-UI candidate and never runs the systemd/Home replacement setup below.

main() {
  REPO="${CYTV_REPO:-lasharor/cleanyourtv-WebOS}"
  ID=com.cleanyourtv.manager
  export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
  say() { echo "[cleanyourtv] $*"; }
  die() { echo "[cleanyourtv] ERROR: $*" >&2; exit 1; }
  case "$1" in
    --webos4)
      PORT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      [ -f "$PORT_DIR/scripts/bootstrap.sh" ] || die 'Local webOS 4 install kit required'
      shift
      sh "$PORT_DIR/scripts/bootstrap.sh" webos4 "$@"
      return $?
      ;;
    --check)
      CHECK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      [ -f "$CHECK_DIR/scripts/check-tv.sh" ] || die '--check requires a local repository checkout; nothing changed'
      sh "$CHECK_DIR/scripts/check-tv.sh"
      return $?
      ;;
    -h|--help) sed -n '2,8p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; return 0 ;;
    "") ;;
    *) die "unknown option: $1" ;;
  esac

  [ "$(id -u)" = 0 ] || die "run as root (ssh root@<tv-ip>)"
  command -v luna-send >/dev/null || die "this does not look like webOS (no luna-send)"
  [ -d /var/lib/webosbrew/init.d ] || die "/var/lib/webosbrew/init.d not found: root with the Homebrew Channel is required (https://rootmy.tv)"
  for t in curl node; do command -v $t >/dev/null || die "missing tool: $t"; done

  command -v systemctl >/dev/null && node -e '(()=>1)()' >/dev/null 2>&1 || die "this TV is too old (webOS 4 or earlier: no systemd, old Node.js). CleanYourTV needs webOS 5 or newer."
  T=$(mktemp -d /tmp/cytv.XXXXXX) || die "mktemp failed"
  trap 'rm -rf "$T"' EXIT
  if [ -n "$CYTV_IPK" ]; then
    [ -f "$CYTV_IPK" ] || die "$CYTV_IPK not found"
    IPK="$CYTV_IPK"
  else
    API="https://api.github.com/repos/$REPO/releases/latest"
    [ -n "$CYTV_BRANCH" ] && [ -z "$CYTV_CHANNEL" ] && { say "CYTV_BRANCH: there is one dev build for all changes now; installing that"; CYTV_CHANNEL=dev; }
    case "$CYTV_CHANNEL" in ""|stable) CYTV_CHANNEL= ;; dev) ;; *) die "CYTV_CHANNEL must be dev or stable" ;; esac
    if [ -n "$CYTV_CHANNEL" ]; then
      API="https://api.github.com/repos/$REPO/releases/tags/dev"
      say "looking for the dev build of $REPO"
    else
      say "looking for the latest release of $REPO"
    fi
    curl -fsSL -H 'User-Agent: cleanyourtv-installer' "$API" > $T/release.json || die "could not read the release list (is there a release yet? for dev: has its build finished?)"
    node -e 'var j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),a={};(j.assets||[]).forEach(function(x){a[x.name]=x.browser_download_url});var k=Object.keys(a).filter(function(n){return /^com\.cleanyourtv\.manager_.*_all\.ipk$/.test(n)&&a[n+".sha256"]})[0];if(!k)process.exit(1);console.log(a[k]);console.log(a[k+".sha256"])' $T/release.json > $T/assets.txt || die "the release has no package (com.cleanyourtv.manager_<version>_all.ipk with a .sha256 file)"
    IPKURL=$(sed -n 1p $T/assets.txt); SHAURL=$(sed -n 2p $T/assets.txt)
    say "downloading $(basename "$IPKURL")"
    curl -fsSL "$IPKURL" -o $T/pkg.ipk || die "download failed"
    want=$(curl -fsSL "$SHAURL" | awk '{print $1}')
    got=$(node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' $T/pkg.ipk)
    [ -n "$want" ] && [ "$want" = "$got" ] || die "the package does not match its checksum; nothing was installed"
    IPK=$T/pkg.ipk
  fi

  # right after a system app manager restart an install can be silently dropped, so check and retry. The TV reports each step to a
  # subscription and ends with "installed": wait for that. The files alone say yes at once on an update (they are there already), and
  # the package would be removed while the TV is still unpacking it, which left the old version in place without a word.
  cp "$IPK" /tmp/cytv-manager.ipk
  n=0; ok=0
  while [ $n -lt 4 ]; do
    rm -f /tmp/cytv-install.log
    luna-send -i luna://com.webos.appInstallService/dev/install "{\"id\":\"$ID\",\"ipkUrl\":\"/tmp/cytv-manager.ipk\",\"subscribe\":true}" </dev/null >/tmp/cytv-install.log 2>&1 &
    lp=$!
    for i in $(seq 1 45); do
      sleep 2
      grep -Eq '"state": *"installed"' /tmp/cytv-install.log 2>/dev/null && break
      kill -0 $lp 2>/dev/null || break
    done
    kill $lp 2>/dev/null; wait $lp 2>/dev/null
    # firmware that words the steps differently still ends here: the files and the app's registration decide
    for i in 1 2 3 4 5 6 7 8; do
      [ -f /media/developer/apps/usr/palm/services/$ID.service/bootstrap.sh ] && luna-send -n 1 -w 5000 -f luna://com.webos.applicationManager/getAppInfo "{\"id\":\"$ID\"}" </dev/null 2>/dev/null | grep -q '"returnValue": true' && { ok=1; break; }
      sleep 3
    done
    [ $ok = 1 ] && break
    n=$((n+1))
  done
  rm -f /tmp/cytv-install.log /tmp/cytv-manager.ipk
  [ $ok = 1 ] || die "the package did not install (see Troubleshooting in the documentation: https://lasharor.github.io/cleanyourtv-WebOS/troubleshooting/)"
  if [ -n "$CYTV_CHANNEL" ]; then mkdir -p /media/developer/cleanyourtv && echo dev > /media/developer/cleanyourtv/channel; say "the manager app now follows the dev builds (Update channel in the manager switches back to the stable releases)."; fi
  say "the CleanYourTV app is installed."
  if [ -f /media/developer/cleanyourtv/helper.js ] && [ -e /var/lib/webosbrew/init.d/10-cleanyourtv-home ]; then
    # already set up: this is an update, so bring the running service to the new version
    sh /media/developer/apps/usr/palm/services/$ID.service/bootstrap.sh update "$(sed -n "s/^const VERSION = '\(.*\)';/\1/p" /media/developer/apps/usr/palm/services/$ID.service/helper/helper.js | head -1)"
  else
    say "Next, on the TV: open CleanYourTV in the app list and choose 'Set up now'."
  fi
}
main "$@"
