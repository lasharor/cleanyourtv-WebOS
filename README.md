<p align="center">
  <a href="https://github.com/lasharor/cleanyourtv-WebOS/stargazers"><img src="https://img.shields.io/github/stars/lasharor/cleanyourtv-WebOS?style=flat&cacheSeconds=1800&color=ffc857&labelColor=101218" alt="Stars"></a>
  <a href="https://github.com/lasharor/cleanyourtv-WebOS/pulls?q=is%3Amerged"><img src="https://img.shields.io/github/issues-search?query=repo%3Alasharor%2Fcleanyourtv-WebOS%20is%3Apr%20is%3Amerged&style=flat&cacheSeconds=1800&color=7c6cff&labelColor=101218&label=merged%20PRs" alt="Merged PRs"></a>
  <a href="https://github.com/lasharor/cleanyourtv-WebOS/network/members"><img src="https://img.shields.io/github/forks/lasharor/cleanyourtv-WebOS?style=flat&cacheSeconds=1800&color=2fd3c0&labelColor=101218" alt="Forks"></a>
  <a href="https://discord.gg/9hHAmCfqB"><img src="https://img.shields.io/badge/Discord-join-f5f6f8?style=flat&logo=discord&logoColor=white&labelColor=101218" alt="Discord"></a>
</p>

<p align="center"><img src="assets/icon.svg" width="128" alt="CleanYourTV icon"></p>

# CleanYourTV for LG webOS

A fast home screen for rooted LG webOS TVs, with Live TV from your own playlist, an Inputs list on the Input key,
picture notifications, optional on-device voice recognition and an optional debloat of LG's ads and telemetry.

> [!NOTE]
> **LG's system files are not modified.** The launcher takes over Home with a mount that exists only in RAM, so a reboot without the
> boot scripts brings LG's Home back. Everything we install is stored in `/media/developer/cleanyourtv` (plus two boot scripts and
> the key binds), and the uninstall removes it. It runs on the TV: no server and no account of ours, and the project collects no
> data. Optional features contact the services you choose; [Security](https://lasharor.github.io/cleanyourtv-WebOS/security/) lists them.

**CleanYourTV** replaces LG's Home with a launcher: a dock of four apps, a top shelf, an app grid sorted by use, an Inputs
picker, a Settings shortcut and a clock. A small service runs on the TV as root and adds the rest. A manager app on the TV
sets up, updates and removes everything.

<p align="center"><img src="docs/screenshots/menu.gif" alt="The home screen, app options, Customise and Inputs menus" width="800"></p>

### Compatibility at a glance

* **webOS**: 5 and newer (2020 models and later). webOS 4 and older have no systemd and an old Node.js; the setup stops before it
  changes anything. LG names its versions two ways: [webOS version numbers](https://lasharor.github.io/cleanyourtv-WebOS/tested-tvs/#webos-version-numbers) gives both.
* **Access**: a TV rooted with the [Homebrew Channel](https://webosbrew.org) ([rootmy.tv](https://rootmy.tv)) and internet access
  on the TV for the download. Install from the Homebrew Channel, or with one command over SSH as `root`.
* **Tested hardware**: LG OLED65G26LA on webOS 25. Other TVs are reported in
  [Tested TVs](https://lasharor.github.io/cleanyourtv-WebOS/tested-tvs/); an unlisted firmware is set up when LG's Home is of the
  flutter or web kind, and otherwise the setup stops and offers **Set up anyway**.

**[Read the documentation](https://lasharor.github.io/cleanyourtv-WebOS/)** for the features, installation, updates and security.

---

## Quick start

1. Root the TV and install the [Homebrew Channel](https://webosbrew.org).
2. Install the manager app, one of two ways:
   - **From the Homebrew Channel.** Open the Homebrew Channel, the gear at the top, **Add repository**, and enter

     ```text
     https://github.com/lasharor/cleanyourtv-WebOS/releases/latest/download/apps.json
     ```

     **CleanYourTV** then shows in the channel's list: open it and choose **Install**. New releases show there as updates.
   - **From your computer**, with your TV's IP address:

     ```sh
     ssh root@192.168.1.50 'curl -fsSL https://raw.githubusercontent.com/lasharor/cleanyourtv-WebOS/main/install.sh | sh'
     ```

3. On the TV, open **CleanYourTV**, choose the options and **Set up now**. It takes about a minute and the screen blinks once.

That's it. The launcher is LG's Home from then on. If the new Home does not come up, the setup removes the boot scripts and
restarts the TV with LG's Home. The [installation guide](https://lasharor.github.io/cleanyourtv-WebOS/install/) has the details
and troubleshooting.

---

## What it's for

1. **[A launcher that is quick and yours](https://lasharor.github.io/cleanyourtv-WebOS/launcher/).** A dock of four apps, an app
   grid sorted by how often you use each app, top buttons you choose, an Inputs list and a clock; menus in English, Dutch, German,
   French, Spanish, Russian, Turkish, Arabic, Polish, Italian and Brazilian Portuguese ([more languages welcome](https://lasharor.github.io/cleanyourtv-WebOS/languages/)); [themes](https://lasharor.github.io/cleanyourtv-WebOS/themes/) for colours, layout and wallpaper, and
   [Wallpapers](https://lasharor.github.io/cleanyourtv-WebOS/wallpapers/): your own photos behind Home, uploaded from a phone or synced
   from Immich albums.

2. **[Live TV from your own playlist](https://lasharor.github.io/cleanyourtv-WebOS/live-tv/).** Plays an M3U playlist (HLS) with a
   channel list, a programme guide (XMLTV) and number entry. It does not use LG's tuner, and the project provides no channels.

3. **[An Inputs list on the Input key](https://lasharor.github.io/cleanyourtv-WebOS/input-key/).** The remote's Input button opens
   the dock apps, the HDMI inputs (with what is connected) and Live TV over the running app.

4. **[Picture notifications](https://lasharor.github.io/cleanyourtv-WebOS/notifications/).** A card with a photo over whatever is on
   screen, sent from your network with a POST request, for example from Home Assistant.

5. **[Voice, on the TV](https://lasharor.github.io/cleanyourtv-WebOS/voice/) (optional).** Speech recognition from the remote's
   microphone with a local model (Moonshine), answers from Home Assistant's Assist, a language model through OpenRouter or your own server, shown as
   text. No audio is recorded or sent anywhere.

6. **[Removing LG's ads and telemetry](https://lasharor.github.io/cleanyourtv-WebOS/debloat/) (optional).** Stops LG's ad and
   telemetry services and blocks a few ad servers, only while the launcher is Home, and undoes cleanly.

7. **[Setting up, updating and removing it from the TV](https://lasharor.github.io/cleanyourtv-WebOS/manager/).** The manager app
   checks every download against a SHA-256 file, rolls back a launcher or service that does not start, and can follow a
   [dev build](https://lasharor.github.io/cleanyourtv-WebOS/managing/#dev-builds) to get changes before the daily release.

---

## Themes

Pick how Home looks in the manager app: colours, the position and size of the clock, buttons, dock and grid, a wallpaper, animation
speed. The themes are in [`themes/`](themes/) of this repository: the TV reads them from GitHub and downloads one when you choose it,
so a new theme needs a pull request and no release ([how](https://lasharor.github.io/cleanyourtv-WebOS/themes/#contributing-a-theme)).

<p align="center"><a href="themes/"><img src="docs/screenshots/themes-readme.jpg" alt="Classic, Midnight, Pixel and Bloom themes" width="800"></a></p>

---

## Screenshots

<p align="center">
  <a href="docs/screenshots/live.jpg"><img src="docs/screenshots/live.jpg" alt="Live TV guide" width="440"></a>
  &nbsp;
  <a href="docs/screenshots/picker.jpg"><img src="docs/screenshots/picker.jpg" alt="Inputs picker on the Input key" width="440"></a>
  <br>
  <a href="docs/screenshots/grid.jpg"><img src="docs/screenshots/grid.jpg" alt="App grid" width="440"></a>
  &nbsp;
  <a href="docs/screenshots/manager.jpg"><img src="docs/screenshots/manager.jpg" alt="Manager app" width="440"></a>
  <br>
  <sub>Live TV guide, the Inputs picker, the app grid and the manager app.</sub>
</p>

[More screenshots](https://lasharor.github.io/cleanyourtv-WebOS/#screenshots).

---

## Documentation

* [Installing](https://lasharor.github.io/cleanyourtv-WebOS/install/) and [tested TVs](https://lasharor.github.io/cleanyourtv-WebOS/tested-tvs/)
* [Updating and uninstalling](https://lasharor.github.io/cleanyourtv-WebOS/managing/), including dev builds
* Using it: [the launcher](https://lasharor.github.io/cleanyourtv-WebOS/launcher/), [Live TV](https://lasharor.github.io/cleanyourtv-WebOS/live-tv/),
  [the Input key](https://lasharor.github.io/cleanyourtv-WebOS/input-key/), [picture notifications](https://lasharor.github.io/cleanyourtv-WebOS/notifications/),
  [voice](https://lasharor.github.io/cleanyourtv-WebOS/voice/), [debloat](https://lasharor.github.io/cleanyourtv-WebOS/debloat/) and
  [the manager app](https://lasharor.github.io/cleanyourtv-WebOS/manager/)
* [Security](https://lasharor.github.io/cleanyourtv-WebOS/security/)
* [What it changes on the TV](https://lasharor.github.io/cleanyourtv-WebOS/tv-changes/)
* [Service API](https://lasharor.github.io/cleanyourtv-WebOS/api/) and [troubleshooting](https://lasharor.github.io/cleanyourtv-WebOS/troubleshooting/)
* [Contributing](https://lasharor.github.io/cleanyourtv-WebOS/development/), [testing and CI](https://lasharor.github.io/cleanyourtv-WebOS/development/testing/)
  and [internals](https://lasharor.github.io/cleanyourtv-WebOS/development/internals/)

The pages are built with [Zensical](https://zensical.org) from [docs/](docs/), so they can also be read there.

---

## Security

The service runs as root on the TV and listens on `127.0.0.1:8765` only. A few short-lived pages open on the local network on
request (Live TV pairing, share log, voice setup) and the notification endpoint is off until you switch it on. Everything it
installs comes from this repository's GitHub releases and carries a SHA-256 file, which detects corruption but **not a compromised
repository**: download only from this repository's release page. [Security](https://lasharor.github.io/cleanyourtv-WebOS/security/)
covers the ports, the token for notifications, voice and dev builds. To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

## Community

Questions, ideas and showing off your home screen: join the [CleanYourTV Discord](https://discord.gg/9hHAmCfqB). Bugs and reports of TVs
that work go in the [issues](https://github.com/lasharor/cleanyourtv-WebOS/issues), so they stay findable.

---

## Contributing

Troubleshooting and fixing with an AI assistant (Claude, ChatGPT, a local model) is supported: [`AGENTS.md`](AGENTS.md) is the briefing,
[`tools/diagnose.sh`](tools/diagnose.sh) collects a read-only report from the TV, and the
[documentation](https://lasharor.github.io/cleanyourtv-WebOS/ai/) has the prompts and the rules.

Translations are welcome too: a language is one file in [`i18n/`](i18n/), no programming needed
([how](https://lasharor.github.io/cleanyourtv-WebOS/languages/)). Reports from other TVs are the most useful contribution: open an [issue](https://github.com/lasharor/cleanyourtv-WebOS/issues)
with the output of **Share log** in the manager app. For code, see [Contributing](https://lasharor.github.io/cleanyourtv-WebOS/development/):
the service runs on Node.js 8 (webOS 5), `sh tools/check.sh` runs every check, every push to `dev` publishes a dev build, and a release goes out daily from `dev`.

---

## Disclaimer

CleanYourTV is an independent project. It is not affiliated with, endorsed by or supported by LG Electronics. LG and webOS are
trademarks of LG Electronics. This modifies a running TV with root access; read `install.sh` and `scripts/` before running them,
and use it at your own risk. Live TV plays only the playlists you add.

## Licence

MIT. See `LICENSE`. The package also contains third-party files, listed with their licences in
[`THIRD-PARTY.md`](THIRD-PARTY.md) and in [Credits and licences](https://lasharor.github.io/cleanyourtv-WebOS/credits/). The home-screen
design follows the Android TV project [CleanYourTV](https://github.com/Gathin23/cleanyourtv) (MIT); no code from it is used.
# Experimental webOS 4 port

`sh install.sh --check` inventories a TV without installing; webOS 4 still requires the [original installer port](docs/webos4-installer-port.md).
The built local kit now provides `sh install.sh --webos4 install` and manual `start|stop|status|show` for the tested SDK 4 profile,
installing the original UI separately while retaining the validated HOME and helper. This is an experimental migration path, not a
generic webOS 4 manager install or a replacement for its physical validation.
Build with `python3 webos4/build-original.py --runtime <verified-local-runtime-tree>` to include the pinned Node 18.17.1 and libraries.
The [runtime preparation guide](docs/webos4-runtime.md) identifies the pinned public source and local extraction command.
The installer bootstraps that private runtime using system Node 0.12 without replacing it; a fresh manual installation can host
the validated native bridge itself. This profile accepts SDK 4.4.0 only. The original UI and physical source sequence have been
user-validated; persistent original-HOME activation and fresh-install bridge ownership still need hardware validation.
The isolated launcher, optional Upstart debloat and hardware investigation are documented in
[the webOS 4 guide](docs/webos4.md). This is firmware-specific experimental support; the normal installer and updater still require
webOS 5+. See the guide's validation matrix before using HOME, boot or power-management tools.
The firmware-specific addons include HOME reload without a compositor restart, reversible Upstart debloat, the shutdown guard,
Netflix source-exit mitigation and robust calibrated Bluetooth confirmation. Node 18 stays isolated; system Node and the existing
interface are preserved. These optional tools do not enable themselves or change the regular package's installation path.
