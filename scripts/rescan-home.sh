#!/bin/sh
# Have LG's app manager (sam) read the folders mounted over LG's apps (Home, and the screen saver when it is on) again, without
# restarting it. A restart blanks an HDMI input for about 10 seconds and needs the after-sam.sh restarts on some TVs; this does not.
# sam scans every app folder again when the UI language changes (locales.UI of localeInfo; seen on webOS 24, firmware 33.31.75):
# the language is set to a nearby one (it-IT -> it, jtool.js localetemp) for a moment and back.
# Exit 0 when sam then reports Home with the type of the folder mounted over it, 1 otherwise: the caller restarts sam then.
# The language is written to locale-ui.restore before the change; "rescan-home.sh restore" (each boot) puts it back if the TV lost power
# in between. Each step is written to /tmp/cleanyourtv-boot.log.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
L=/media/developer/cleanyourtv
H=/usr/palm/applications/com.webos.app.home
LOG=/tmp/cleanyourtv-boot.log
R=$L/locale-ui.restore
T=/tmp/cleanyourtv-locale.json
luna_send() { command luna-send "$@" </dev/null; }
[ ! -r "$L/luna-compat.sh" ] || . "$L/luna-compat.sh"
up() { cut -d' ' -f1 /proc/uptime; }
readlocale() { luna_send -n 1 -w 5000 -f luna://com.webos.settingsservice/getSystemSettings '{"keys":["localeInfo"]}' > $T 2>/dev/null; }
setui() {
  readlocale || return 1
  req=$(node $L/jtool.js localeset $T "$1" 2>/dev/null) || return 1
  luna_send -n 1 -w 5000 luna://com.webos.settingsservice/setSystemSettings "$req" 2>/dev/null | grep -q '"returnValue": *true'
}
hometype() {
  luna_send -n 1 -w 5000 -f luna://com.webos.applicationManager/getAppInfo '{"id":"com.webos.app.home"}' 2>/dev/null |
    sed -n 's/.*"type": *"\([^"]*\)".*/\1/p' | head -n 1
}

# a language change that did not finish (the TV lost power in between)
if [ -s $R ]; then
  ui=$(cat $R)
  if setui "$ui"; then
    rm -f $R
    echo "$(up) rescan-home: the UI language is $ui again (left changed by an earlier run)" >> $LOG
  else
    echo "$(up) rescan-home: could not put the UI language back to $ui yet" >> $LOG
  fi
fi
[ "$1" = restore ] && exit 0

want=$(node $L/jtool.js kind $H/appinfo.json 2>/dev/null | cut -d' ' -f2)
[ -n "$want" ] || { echo "$(up) rescan-home: no appinfo.json in $H" >> $LOG; exit 1; }
readlocale
ui=$(node $L/jtool.js localeui $T 2>/dev/null)
tmp=$(node $L/jtool.js localetemp "$ui" 2>/dev/null)
[ -n "$ui" ] && [ -n "$tmp" ] || { echo "$(up) rescan-home: the UI language could not be read" >> $LOG; exit 1; }
echo "$ui" > $R
if ! setui "$tmp"; then
  rm -f $R
  echo "$(up) rescan-home: the UI language could not be changed" >> $LOG
  exit 1
fi
got=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  got=$(hometype)
  [ "$got" = "$want" ] && break
done
if setui "$ui"; then
  rm -f $R
else
  sleep 2
  setui "$ui" && rm -f $R
fi
if [ "$got" = "$want" ]; then
  echo "$(up) rescan-home: the app manager read the folders again (UI language $tmp for a moment, $ui again); Home is $got" >> $LOG
  exit 0
fi
echo "$(up) rescan-home: Home is still ${got:-unknown} after the rescan, not $want" >> $LOG
exit 1
