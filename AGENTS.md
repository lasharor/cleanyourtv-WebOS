# CleanYourTV for LG webOS: briefing for AI assistants

Read this first when you help someone with this project, either to find out what is wrong on their TV or to fix a bug in the code.
The full documentation is in `docs/` (published at https://lasharor.github.io/cleanyourtv-WebOS/); the page for you is `docs/ai.md`.

## What it is

A launcher that replaces LG's Home on a **rooted** LG webOS TV, plus a root service on the TV: Live TV from the user's own playlist, an Inputs
list on the remote's Input key, picture notifications, optional voice, themes, a debloat of LG's ads, and a manager app that sets up,
updates and removes everything. Everything is applied at boot with mounts in RAM; nothing under `/usr`, `/etc` or the firmware is changed on
disk, and a reboot without the boot scripts brings LG's Home back.

## Where things are

| Symptom or feature | Look at |
|---|---|
| The launcher page (home screen, menus) | `app/src/` (CSS and ES5 script per area), built into `app/index.html` by `tools/build-pages.js` |
| The root service: how the parts are wired | `helper/helper.js` (port 8765, loopback only), `helper/server.js`; one module per part (`docs/development/internals.md`) |
| Settings (`config.json`) and who changed them | `helper/config.js`: change settings only with `config.update(source, fn)`; changes are logged |
| Anything that differs between TVs (webOS version, firmware) | `helper/tvprofile.js`, also asked by `scripts/bootstrap.sh` |
| Apps, icons, usage, launching, running apps (Back on Home) | `helper/apps.js`, `helper/running.js` |
| Downloads, programs, luna, TV paths | `helper/fetch.js`, `helper/exec.js`, `helper/luna.js`, `helper/paths.js` |
| The manager app and its API (updates, options, keys) | `manager/src/` (built into `manager/app/index.html`), `helper/manager.js`, `helper/updates.js`, `helper/selfupdate.js` |
| The Input key, the Inputs list over the running app | `helper/inputkey.js`, `helper/inputhook.js`, `helper/picker.js`, `picker/app/`, `scripts/inputkey.sh` |
| Home takeover at boot, rollback, undo | `scripts/10-cleanyourtv-home`, `scripts/stage-home.sh`, `scripts/undo-home.sh`, `scripts/bootstrap.sh` |
| Live TV: playlist, guide, favourites | the bundled add-on iptv: `helper/addons-bundled/iptv/service.js` (service), `helper/addons-bundled/iptv/src/` (the player page, built into `page/index.html`); `app/src/js/live.js` only turns the book to it; the catalog add-on tuner (`addons/catalog/tuner`) is a TV guide for LG's own tuner whose page is built from the same guide code (`src/index.html` there includes the files of `helper/addons-bundled/iptv/src`) |
| Add-ons (loader, page serving, catalog install, the launcher's pages (the book: `PAGER`) and the manager's Add-ons screen) | `helper/addons.js`, `helper/addons-bundled/`, `addons/` (catalog), `app/src/js/addons.js`, `docs/development/addons.md` |
| An app that opens on an Android box over ADB (input switch, ADB start) | the bundled add-on androidbox: `helper/addons-bundled/androidbox/service.js`, `adbclient.js` (the ADB protocol), `page.js` (phone page); the hook in `/api/launch` in `helper/apps.js`, `docs/android-box.md` |
| Remote key remapping (a button opens an app, input, Live TV, Home) | `helper/remap.js`, `helper/keynames.js` (the name of a button), `scripts/remapkey.sh`, the binds in `helper/inputhook.js`, `manager/src/js/remap.js`, `docs/key-remap.md` |
| Phone remote (pairing, tokens, WebSocket, keys into the TV) | the bundled add-on phoneremote: `helper/addons-bundled/phoneremote/service.js`, `ws.js` (RFC 6455 server and client for Node 8), `remotekeys.js` (the key adapter: pointer socket, ime, audio), `page.js` (phone page), `manager/src/js/remote.js`, `docs/phone-remote.md` |
| Turning the TV on from the phone (Wake-on-LAN) and the phone remote as an Android app | `mobile/` (a WebView around the TV's own page, plus the wake packet and a start page; `mobile/android/build.ps1` builds it, and the TV hands it out at `:8798/app.apk`), the `window.CYTV_APP` hook and the on/off button in `helper/addons-bundled/phoneremote/page.js`, `mobile/README.md` |
| Picture notifications | `notify/app/`, `helper/notify.js`, `helper/notifyapi.js` |
| Voice (Moonshine, OpenRouter, Home Assistant) | `helper/voice.js` (microphone, recogniser), `helper/answers.js` (Assist, OpenRouter, your server), `voice/` |
| Themes | `helper/themeschema.js` (the schema), `helper/theme.js` (downloads), `themes/` (read from GitHub), `docs/themes.md` |
| Wallpapers | `helper/wallpapers.js` (uploads, phone page, the photo sources add-ons provide), `app/src/js/wall.js` (rotation on Home), `docs/wallpapers.md`; Immich is the catalog add-on `addons/catalog/immich` |
| The report people attach to issues | `helper/sharelog.js` (`node sharelog.js --print` prints it) |
| Node 8 compatibility helpers, diagnostics | `helper/netcompat.js`, `helper/diag.js` |
| Build and checks | `ipk/build.py`, `tools/build-pages.js`, `tools/check.sh`, the tests in `tools/test/` |

## Facts about the TV that matter

- Test TV: LG OLED65G26LA, webOS 25 (SDK 10), Node.js 16. **webOS 5 and 6 have Node.js 8.12** and an older Chromium (68 on webOS 5, 79 on
  webOS 6). The userland is 32-bit ARM on a 64-bit kernel.
- The root filesystem, `/usr` and `/etc` are read-only. Writable: `/media/developer`, `/var`, `/tmp`. Use bind mounts, never write into `/usr`.
- Where things are on the TV: `/media/developer/cleanyourtv/` (service files, `config.json`, `app/`, `live/`, `themes/`, `backup/`),
  `/var/lib/webosbrew/init.d/` (boot scripts, run by the Homebrew Channel), `/media/developer/cytv-setup.log` (setup log),
  `/tmp/cleanyourtv-helper.log` (service log), `/tmp/lginput-hook-lginput2.log` (input hook).
- Root SSH works with a key (`ssh root@<tv-ip>`). `luna-send` must have stdin redirected: `luna-send -n 1 -w 5000 -f <uri> '<json>' </dev/null`.
- The service listens on `127.0.0.1:8765` (use `curl` on the TV). Other ports: 8766 Live TV pairing, 8767 network notifications (opt-in),
  8768+ share log, 8769 voice setup, 8791 wallpapers, 8792 cards, 8793 Android box, 8794 app icons, 8795 Immich, 8796 Unsplash,
  8797 Spotify, 8798 phone remote. All of these are short-lived or off by default; 8798 is open only while the phone remote is switched
  on in the manager app and a phone is paired or its pairing window is open.
- Going back to LG's Home: manager app > CleanYourTV as Home off, or `sh /media/developer/cleanyourtv/undo-home.sh`. If a boot crashes,
  the Homebrew Channel's failsafe mode skips the boot scripts.
- A TV in **deep** standby answers nothing over TCP. With Quick Start+ (the default) the system stays partly up while the screen is off, and
  then the service, its ports and `tvpower` keep answering: the page can still reach the TV and its POWER key brings the screen back, so a
  phone is not always thrown back on Wake-on-LAN. The TV's own power state (`tvpower/power/getPowerState`: `Active`, `Screen Saver`,
  `Screen Off`, `Active Standby`) is the honest answer to "is the TV on", not whether a port answers. A Wake-on-LAN
  packet (UDP 9 and 7, broadcast, six 0xFF bytes then the MAC sixteen times) brings it back in a second or two with Quick Start+, or with a
  cold boot. Only the app can send it from a phone (a browser cannot send UDP); the TV cannot wake itself.
- A TV's own state can be the problem: a stuck media pipeline (black video, no sound) is cleared by a reboot; check
  `luna://com.webos.media/getActivePipelines` before blaming the code.

## Rules

1. **Do not touch the user's TV without being asked.** Start read-only (`tools/diagnose.sh`, the report, `ps`, `cat`, `luna-send` queries).
   Propose every change (restart, edit, install, delete) and wait for a yes, and name the command that undoes it. Never reboot, uninstall,
   delete files or change boot scripts on your own.
2. **Never put private data in the repository, an issue or a pull request:** no playlist addresses, access keys, tokens, IP addresses,
   user or device names, webhook addresses. Mask them. `tools/diagnose.sh` and Share log already mask what they can; read the output.
3. **The service must run on Node.js 8.12** (webOS 5/6): no `??`, `?.`, `fs.rmSync`, `fs.cpSync`, `mkdirSync({recursive})`, `crypto.randomInt`,
   `fs.promises`, global `URL`, `http.get(url, options)`, and no `timeout` option on child processes (use `diag.execFile`). Use
   `helper/netcompat.js`. **The pages are written for Chromium 68 and up**: ES5 style, only transform and opacity animate (the GPU is weak),
   no flex `gap` (Chromium before 84 ignores it): space flex children with sibling margins.
4. **A fix needs a test** in `tools/test/` (the file of that area) when it can be tested without a TV, and everything must pass:
   `sh tools/check.sh` (the tests under Node 8.12.0, downloaded once with a pinned checksum, and the current Node; the built pages).
   `tools/test/api.test.js` compares every API reply with a recorded one: a reply that changes needs a reason. Say plainly what was
   checked on a real TV and what was not.
5. **Documentation must match the code.** Change the page in `docs/` when behaviour changes, and the README if it is mentioned there.
6. **Licence:** the project is MIT. Do not copy code from GPL projects; describe behaviour and write your own.
7. **Do not release, tag, force-push or change repository settings.** The maintainer does that. Work on a branch and open the pull request
   against `dev`; once merged, every push to `dev` publishes the dev build (the pre-release `dev`), which people can install from the
   manager app (Update channel > Dev builds). A release goes out from `dev` once a day, unless the file `RELEASE-HOLD` is in the repository root (`tools/release.sh` then releases nothing; delete the file to release again). If `RELEASE-NOTES.md` is in the repository root, `tools/release.sh` uses it as the release notes (sections, credits, pictures from `docs/screenshots/`) instead of the commit subjects and removes it in the release commit: write it as the changes come in.

## Commands

```sh
sh tools/check.sh                  # every check: tests under Node 8.12.0 and the current Node, built pages
sh tools/check.sh --chromium       # also the pages in Chromium 68 and 79 (webOS 5 and 6), as CI does
npm install                        # once: TypeScript, ESLint and Prettier for check.sh (development only, nothing is shipped)
npm run format                     # formats the code (Prettier) and rebuilds the pages
node tools/test.js live            # one area of tests (the files in tools/test)
node tools/build-pages.js          # builds app/index.html and manager/app/index.html from app/src and manager/src
python3 ipk/build.py               # writes dist/: the package, the launcher bundle (.sha256 files) and the Homebrew Channel apps.json
node tools/theme-docs.js           # regenerates the settings table in docs/themes.md from helper/themeschema.js
node tools/theme-index.js          # writes themes/index.json
node tools/theme-preview.mjs <id>  # renders a theme in headless Chrome (Node 22+)
sh tools/diagnose.sh <tv-ip> > cytv-diagnose.txt   # read-only report from a TV over SSH
sh tools/perf-tv.sh <tv-ip>        # read-only timings from a TV: launcher, Input key, Live TV
```

## Things that have gone wrong before (check these first)

- A hidden overlay app can keep the remote (webOS 6.5); the Input key then starts the picker on demand and closes it. The `running` list of
  the app manager lags by seconds after a start or close: do not make decisions from one reading.
- Closing from the page (`window.close`, `PalmSystem.hide`) does nothing on some builds: the service closes apps with
  `applicationManager/closeByAppId`.
- Node's `timeout` option on child processes is avoided on purpose (a `uv_close` assertion on Node 8); use `diag.execFile`. After an abnormal
  exit the next start logs the last operations (`/tmp/cytv-run.json`); they appear in the report.
- `bootstrap.sh` copies only `helper/*.js` and `scripts/*` to the TV. Anything else the service needs must be copied there too, or be read
  from somewhere else (themes are read from GitHub for that reason).
- Update checks and downloads must always end: a dropped connection emits `aborted` on the response, not an error on the request.
- webOS 5's Chromium can leave old text in the compositor when a list is redrawn: the launcher swaps elements instead of rewriting them.
- Settings were lost when two parts read and rewrote `config.json` around each other (issues 6, 7): use `config.update`, which logs
  every change of an option or key with its source.
- A per-TV rule written in a module or a script drifts from the others: put it in `helper/tvprofile.js`.
- Edit the pages in `app/src`, `manager/src` and `helper/addons-bundled/iptv/src`, then `node tools/build-pages.js`; the built files are what the TV loads.
- Themes are data; a theme must never contain CSS or script. The schema in `helper/themeschema.js` is the only source of what a theme can set.
