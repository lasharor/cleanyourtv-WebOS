# The manager app

**CleanYourTV** in LG's app list sets up, updates and removes everything. The left side of the screen explains the focused row.

![Manager app](screenshots/manager.jpg)

| Row | Function |
|---|---|
| Launcher, Service | Installed version; offers an update when the latest release is newer. |
| Check for updates | Asks GitHub for the latest release. |
| Update channel | Follow the stable releases or the [dev builds](managing.md#dev-builds). |
| Go back to launcher | Appears after a launcher update. |
| CleanYourTV as Home | **Use CleanYourTV as Home** (LG's Home or ours; the TV restarts) and the optional **Learn the Home key**. |
| Wallpapers | Your own photos behind Home: the phone page (uploads and Immich), counts, **Sync now**, **Picture size**, **Remove all uploads** and **Disconnect Immich**. See [Wallpapers](wallpapers.md). |
| App icons | A picture of your own for an app: the phone page (a QR code), where you choose **Change** next to an app and a picture, shown as **Full tile** or **Icon** with a preview, or **Reset**. The screen gives the picture sizes that fit the theme's tiles on this TV. A tile's **Change icon** on Home opens it with that app first. See [Your own icon](launcher.md#your-own-icon). |
| Cards | A card for each place of the theme (Lock Screen, Bloom, Horizon), the phone page for their names, texts and options, and a link to Home Assistant; see [Cards](launcher.md#cards). |
| Live TV | **Show Live TV** (off hides it in the launcher and Inputs list and leaves the Guide button to LG), **Show LG's own Live TV** (the tuner in the Inputs list and the TV button; independent of the first), the **Playlist** (set up from your phone with a QR code and a 6-digit code), **Refresh playlist and guide**, **Learn the Guide key**, **Clear recent channels** and **Remove the playlist**. See [Live TV](live-tv.md). |
| Input key | The takeover switch, **Learn the Input key**, **Input key shows** (the Inputs list over the running app, ready in the background or started when pressed, or the launcher's own list). See [The Input key](input-key.md). |
| Debloat | The four groups of the [debloat](debloat.md), each on or off, and **Switch all on** / **Switch all off**. |
| Experimental | Things that are not for every TV, off by default and tried on one TV only. **Compressed memory** (zram) keeps the memory that apps are not using compressed in RAM, ahead of LG's own swap on the eMMC, with a **Size** of 256 to 1024 MB (512 MB is a good start) and what it keeps. The row appears only where the kernel has zram. See [Compressed memory](#compressed-memory-experimental). **Volume bar** replaces LG's own bar with a Pill, Capsule or Dial over every app; **System default** puts LG's bar back. See [Volume bar themes](volume-themes.md). |
| More | **Home Assistant**: its address and long-lived access token (set up from your phone), **Test the connection** and **Forget Home Assistant**; Voice and the Home Assistant cards use it. **Language**: the language of every screen, Automatic (the TV's) or one of the translations with how complete it is; see [Translations](https://github.com/lasharor/cleanyourtv-WebOS/tree/dev/i18n). **Voice**: optional; installs the speech recogniser (about 80 MB), learns the voice button, tries it, sets where the text goes (see [Voice](voice.md)). **Network notifications**: switch, address, token (also as a QR code for a phone) and an example for sending [picture notifications](notifications.md) from other devices. |
| Share log | A QR code that opens a masked diagnostic report on a phone, with a **Copy** button. |
| Reset Home customisation | Puts the launcher's dock, top buttons, hidden apps, app order and clock back to the defaults, after a confirmation. The theme stays. |
| Uninstall | Removes everything and restarts the TV. |

## When the service is not running

The manager works without the service for two things: checking for a newer package and installing it, so a broken service can
be repaired from the TV. It follows the same **Update channel** as the service: on the dev channel it offers the dev build's package.
**Set up now** starts from the options that are already saved (Input key, Debloat), so setting up again does not switch them back
on.

## Share log

**Share log** opens a short-lived page on your local network (port 8768 or higher, a random address, ten minutes). Scan the
QR code with a phone on the same network. It works even when the service is not running, so it can also report a failed setup.

The report is **masked**: addresses, MAC addresses and URL paths are replaced, and the values of `token`, `key`, `password`,
`pass`, `secret` and `apikey` are removed. It holds the TV model and firmware, the versions, LG's stock Home app, the mounts and
boot scripts, whether our apps are registered, your options, the remote key codes seen by the input hook, the service status, the
setup log, the last lines of the service log and the input hook log. Attach it to bug reports.

### Compressed memory (experimental)

LG's kernel has zram but leaves it unused; the only swap is `eswap`, a partition on the eMMC. With **Experimental** > **Compressed
memory** on, idle pages are kept compressed in RAM (lz4, priority 10, ahead of `eswap`). It can help a TV with little memory, where most of
it is reserved for video; it also sets `vm.page-cluster` to 0 while it is on, because reading ahead only costs CPU when every page is decompressed, and puts
LG's value back when it is off. The service switches it on again at every start. Nothing is written to disk: switching it off, or a reboot without CleanYourTV,
leaves the TV as LG ships it.

- Switching it off pulls the pages back into RAM. When there is not enough free memory for that, the manager says so and leaves it on:
  close some apps and try again.
- If the TV hangs or loses power in the middle of a change, the next start leaves zram off and forgets the size, so a bad setting cannot
  come back at every boot. The Homebrew Channel's failsafe mode also skips the boot scripts.
- It was tried on one TV (a 65QNED866QA with 1.7 GB of RAM, where free memory went from about 220 to 400 MB up to 511 MB). Other models may
  behave differently: report what you see.
