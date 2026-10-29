# What it changes on the TV

Only the takeover of Home and the debloat's `/etc/hosts` lines are applied in RAM at boot, as mounts. Everything else is stored in
the writable partitions listed below and stays after a reboot until you uninstall. Nothing under `/usr`, `/etc` or the firmware
is modified on disk, and a reboot without the boot scripts brings LG's Home back.

The optional voice download (about 80 MB) is stored in `/media/developer/cleanyourtv/voice` and stays until **Remove voice** or the
uninstall. Optional features contact other services only when you switch them on; see [Security](security.md).

## Files

| Where | What |
|---|---|
| `/media/developer/cleanyourtv/` | The service (`helper.js` and modules), the launcher (`app/`), scripts, `config.json`, `usage.json`, the backup of the original state in `backup/`, downloaded themes in `themes/`, the weather card's last answers in `weather.json`, Live TV data in `live/`, the optional voice download in `voice/` |
| `/media/developer/apps/usr/palm/applications/` | The apps `com.cleanyourtv.manager`, `.picker` and `.notify` |
| `/media/developer/apps/usr/palm/services/com.cleanyourtv.manager.service/` | The installed package contents |
| `/var/lib/webosbrew/init.d/` | Boot scripts `10-cleanyourtv-home` and, with debloat on, `15-cleanyourtv-debloat` (links into the folder above) |
| `/home/root/.config/lginputhook/keybinds.json` | Our binds for the Input key (and the voice key); other binds are left alone |
| `/media/developer/cytv-setup.log` | The setup log |

## At boot

1. The Homebrew Channel runs the boot scripts in `/var/lib/webosbrew/init.d/`.
2. `10-cleanyourtv-home` starts the service and, unless `/media/developer/cleanyourtv/DISABLE` exists, replaces LG's Home. How
   depends on LG's Home app as it came with the TV (`helper/tvprofile.js`, `homeTakeover`; see
   [what differs between webOS versions](tested-tvs.md#what-differs-between-webos-versions)):

    - **LG's Home is a flutter or web app** (webOS 24 and newer): a directory holding the launcher is **bind-mounted** over LG's Home
      app (`/usr/palm/applications/com.webos.app.home`). Its `appinfo.json` is derived from this TV's own stock Home, so nothing of
      LG's is shipped. The system app manager (`sam`) is restarted so that it reads the new Home.
    - **LG's Home is a native program** (webOS 5 to 23): `home-standin.sh` is **bind-mounted** over that program (its path comes from
      the stock Home's `appinfo.json`, usually `/usr/bin/com.webos.app.home`) and LG's running Home is stopped once. LG's Home
      manifest stays in place and the app manager is not restarted: it starts the stand-in whenever Home is launched. The stand-in
      asks `webapp-mgr` to open the launcher directory as `com.webos.app.home` and tries to register with the app manager as Home,
      so the Home key shows the open launcher again. If the launcher is not open in `webapp-mgr` within 30 seconds, the stand-in is
      removed and LG's Home comes back until the next reboot. A file `/media/developer/cleanyourtv/home-method` holding `mount`
      makes such a TV use the first way.

   Whenever the app manager is restarted on a TV with LG's native Home or on webOS before 7 (the first way, or the setup registering
   our extra apps), the services that talk to it (`eim`, `webapp-mgr`, `preload-manager`, `memorymanager`, those the TV has) are
   restarted after it (`after-sam.sh`). Without that, apps stopped opening, an HDMI input lost its picture and HDMI-CEC control
   stopped (issues 14, 23 and 24). Each step is written to `/tmp/cleanyourtv-boot.log`, which **Share log** includes.
   On webOS 26 (SDK 11) with the flutter or web Home, the same hook restarts `arccontroller` and `umediaserver` after the app manager, if they run: on
   an OLED65C35LA HDMI ARC to the soundbar stayed silent although the right output was chosen and the controller was running, and
   restarting that controller brought the sound back (issue 21, found by karim7878), and `umediaserver` lost its subscription to the app manager's foreground notifications (`getForegroundApps`), muting video output (black screen on playback across all video apps). webOS 25 is left alone; eARC keeps working there.
3. About a minute later the debloat runs, if it is on.

Either bind mount lives in RAM. A reboot without the boot scripts, or the Homebrew Channel's failsafe mode, leaves LG's Home as it was.

## Processes and ports

| What | Port |
|---|---|
| The service (`node helper.js`), running as root | `127.0.0.1:8765` |
| The input hook, injected into LG's input service (`lginput2`; other input processes only on firmware without it) | none |
| Short-lived pages (Live TV pairing, share log, voice setup) and the optional notification endpoint | [Security](security.md#what-this-changes-on-a-tv) |

## What the uninstall removes

The apps, the boot scripts, the Input-key and voice-key binds, the debloat changes and the folder
`/media/developer/cleanyourtv` (with `--keep-config`, the settings and usage history stay). The TV then restarts with LG's Home.
