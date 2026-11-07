# What it changes on the TV

Only the takeover of Home and the debloat's `/etc/hosts` lines are applied in RAM at boot, as mounts. Everything else is stored in
the writable partitions listed below and stays after a reboot until you uninstall. Nothing under `/usr`, `/etc` or the firmware
is modified on disk, and a reboot without the boot scripts brings LG's Home back.

The optional voice download (about 80 MB) is stored in `/media/developer/cleanyourtv/voice` and stays until **Remove voice** or the
uninstall. Optional features contact other services only when you switch them on; see [Security](security.md).

## Files

| Where | What |
|---|---|
| `/media/developer/cleanyourtv/` | The service (`helper.js` and modules), the launcher (`app/`), scripts, `config.json`, `usage.json`, the backup of the original state in `backup/`, downloaded themes in `themes/`, the weather card's last answers in `weather.json`, Live TV data in `live/`, the optional voice download in `voice/`, the key for an Android box in `adb/adbkey` (only if you set that up) |
| `/media/developer/apps/usr/palm/applications/` | The apps `com.cleanyourtv.manager`, `.picker` and `.notify` |
| `/media/developer/apps/usr/palm/services/com.cleanyourtv.manager.service/` | The installed package contents |
| `/var/lib/webosbrew/init.d/` | Boot scripts `10-cleanyourtv-home`, `20-cleanyourtv-screensaver` and, with debloat on, `15-cleanyourtv-debloat` (links into the folder above) |
| `/home/root/.config/lginputhook/keybinds.json` | Our binds for the Input key, the voice and Guide keys, the Home key while a page of the launcher's [book](development/addons.md#pages-home-is-page-1-of-a-book) shows, and any [remapped buttons](key-remap.md); other binds are left alone |
| `/home/root/.local/bin/cytv-addons` | Only if you run `cytv-addons.js shortcut`: a one-line command for [add-on repositories](development/addon-repos.md) over SSH. The uninstall removes it |
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
      so the Home key shows the open launcher again. When the app manager starts Home in the background to preload it, the stand-in
      opens nothing until the Home key. If the launcher is not open in `webapp-mgr` within 30 seconds, the stand-in is
      removed and LG's Home comes back until the next reboot. When the TV starts on an input, those 30 seconds count from the
      first time Home is opened. A file `/media/developer/cleanyourtv/home-method` holding `mount`
      makes such a TV use the first way.
      On some of these TVs the stand-in never runs: the kernel has CRIU (`criu_enabled` in `/proc/cmdline`), which restores LG's Home
      from a checkpoint instead of starting its program (issues 72 and 84). When the launcher does not come up after the setup, the
      setup tries the first way once and writes `home-method` itself, so the next boots use it too; only when that fails as well is
      everything rolled back. TVs where the stand-in works are not touched.

   When switched on in the manager (off by default), LG's **screen saver** is replaced as well, by `20-cleanyourtv-screensaver`: either the page's folder is mounted over
   `/usr/palm/applications/com.webos.app.screensaver` and the app manager reads it, or, where LG's screen saver is a native program,
   `screensaver-standin.sh` is mounted over that program and the app manager is left alone (`helper/tvprofile.js`, `saverTakeover`).
   The app id stays LG's, so the TV starts the page when it would have started its own screen saver. Where both use the folder mount,
   `10-cleanyourtv-home` mounts the screen saver before it restarts the app manager, so there is one restart. See
   [Screen saver](screensaver.md).

   Whenever the app manager is restarted on a TV with LG's native Home or on webOS before 7 (the first way, or the setup registering
   our extra apps), the services that talk to it (`eim`, `webapp-mgr`, `preload-manager`, `memorymanager`, those the TV has) are
   restarted after it (`after-sam.sh`). Without that, apps stopped opening, an HDMI input lost its picture and HDMI-CEC control
   stopped (issues 14, 23 and 24). Each step is written to `/tmp/cleanyourtv-boot.log`, which **Share log** includes.
   On webOS 26 (SDK 11) with the flutter or web Home, the same hook restarts `arccontroller` and `umediaserver` after the app manager,
   if they run. On an OLED65C35LA HDMI ARC to the soundbar stayed silent although the right output was chosen and the controller was
   running, and restarting that controller brought the sound back (issue 21, found by karim7878). On a 50NU850BPSA `umediaserver` lost
   its subscription to the app manager's foreground apps, so every video app showed a black screen (pull request 73). On webOS 25 (SDK 10)
   with the flutter or web Home it restarts `videooutputd` and then `umediaserver` (issue 122: on an OLED65B2RLA a video app now and then
   played with a black picture after the takeover, because the media services had no foreground app; restarting those two brought picture
   and sound back). The ARC controller is left alone there; eARC keeps working. Other webOS 25 TVs were fine without it, so a file
   `after-sam-services` in `/media/developer/cleanyourtv/` replaces the list on one TV (an empty file switches it off; updates leave it).
3. About a minute later the debloat runs, if it is on.

Either bind mount lives in RAM. A reboot without the boot scripts, or the Homebrew Channel's failsafe mode, leaves LG's Home as it was.

## Experimental (off by default)

These are switched on in the manager app, **Experimental**, and put back by switching them off.

- **Volume bar.** A Pill, Capsule or Dial replaces LG's volume bar. LG's own setting `com.webos.surfacemanager.volumeOSD` is switched off for that; the value the TV had is saved in `backup/volume-osd.orig` and put back by **System default**, `undo-home.sh` and the uninstall. See [Volume bar themes](volume-themes.md).
- **Compressed memory.** zram (`/dev/zram0`, lz4) as swap in RAM ahead of LG's `eswap`, and `vm.page-cluster` 0 while it is on. Nothing is written to disk; switching it off, or a reboot without CleanYourTV, leaves the TV as LG ships it. See [the manager](manager.md#compressed-memory-experimental).
- **Weekly trim** (issue 100, found by Reveal80). LG ships `fstrim` but never runs it, and none of the writable ext4 partitions is mounted with `discard`, so the built-in storage is never told which blocks are free. Switched on, the service runs `fstrim` on the writable ext4 partitions of the eMMC five minutes after it starts, when the last trim is a week old (checked again every six hours), and keeps the date and result in `trim.json`. The small key partitions (`uhdcp`, `ciplus`) are left alone, a filesystem that is mounted in several places is trimmed once, and nothing else changes. **Trim now** runs it at once. The rows appear only where the storage reports discard support.

## Processes and ports

| What | Port |
|---|---|
| The service (`node helper.js`), running as root | `127.0.0.1:8765` |
| The input hook, injected into LG's input service (`lginput2`; other input processes only on firmware without it) | none |
| Short-lived pages (Live TV pairing, share log, voice setup) and the optional notification endpoint | [Security](security.md#what-this-changes-on-a-tv) |

## What the uninstall removes

The apps, the boot scripts, the `cytv-addons` command, the Input-key and voice-key binds, the debloat changes, a switched-off LG volume bar (put back) and the folder
`/media/developer/cleanyourtv` (with `--keep-config`, the settings and usage history stay). The mounts that replace LG's Home and LG's
screen saver are removed too, so the TV then restarts with both as LG shipped them.
