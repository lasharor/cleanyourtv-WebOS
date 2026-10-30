# Internals

## The pieces

| Piece | Runs as | Notes |
|---|---|---|
| The **service** (`helper.js` and modules) | Node.js, root, started by the boot script | Listens on `127.0.0.1:8765`; bridges the web pages to `luna-send` (LG's service bus), serves app icons, runs Live TV, notifications, voice, the manager API and the input hook. |
| The **launcher** (`app/index.html`) | A web app in LG's web runtime, mounted as LG's Home | Reads apps and settings from the service. |
| **Manager**, **picker**, **notify** | Web apps installed from the package | The picker and notify apps are hidden; the service starts them. |
| The **input hook** | Injected into LG's input processes | Runs a command when a bound remote key is pressed. |

## The service

`helper/helper.js` only wires the parts together. Each part is a module with `create(ctx)` that returns its name, the paths it answers
(`paths` or a `prefix`), `handle(req, res, path, body)` and an optional `start()`. A part that fails to load is left out and listed at
`GET /api/service`; the others keep working.

| Module | What it is |
|---|---|
| `paths.js` | Every place on the TV the service reads or writes; the tests move them with environment variables. |
| `config.js` | The settings in `config.json`. `config.update(source, fn)` reads, changes and writes in one step, so two parts never overwrite each other's settings; every change of an option, a learned key or the Input-key mode is logged with its source (`config: options.inputKey true -> false (manager)`), which shows up in Share log. |
| `tvprofile.js` | Everything that differs between TVs: the Input key's default mode, the notification window type, whether the firmware is in `compat.json`, whether LG's Home is a supported kind, how Home is taken over (`homeTakeover`) and which services are restarted after the app manager (`afterSam`). The service saves it in `tv.json` (`GET /api/tv`); the setup script asks the same rules (`node tvprofile.js get notifyWindow --sdk 10.2.2`). |
| `exec.js`, `luna.js`, `fetch.js` | The one way to start a program (time limits without Node's own `timeout` option, which can abort Node 8), to call `luna-send`, and to download (redirects, gzip, size and time limits, dropped connections). |
| `server.js`, `web.js` | The HTTP server with the origin rules, and small reply helpers. |
| `apps.js`, `running.js` | The app list, icons, usage, launching and the launcher's own settings; the running apps to close (Back on Home). |
| `inputkey.js`, `inputhook.js`, `picker.js` | The Input key: the hook in LG's input processes, the key binds, the Inputs picker. |
| `manager.js`, `updates.js`, `debloat.js` | The manager's API, updates from GitHub releases with rollback, switching the debloat. |
| `live.js`, `notify.js`, `notifyapi.js` | One feature each. |
| `zram.js` | Compressed memory: switches the kernel's zram swap on with the size in `options.zram` at every start of the service, and on or off from the launcher (`/api/zram`). |
| `wallpapers.js` | Wallpapers: the photo library (uploads and Immich, apart on disk, with an index), the phone page on port 8791 and the Immich sync. |
| `androidbox.js`, `adbclient.js`, `androidboxpage.js` | Apps that open on an Android box: the settings and the launch hook, our own ADB client (packets, key, sign-in, one shell command; no `adb` program), and the phone page on port 8793. |
| `cards.js`, `weather.js` | Cards: the shape check of the cards the launcher saves, the phone page on port 8792 where their options are typed, and the weather card's Open-Meteo requests (kept 30 minutes). |
| `icons.js` | App icons: a picture of your own per app in `icons/` (Icon) or `icons/tile/` (Full tile; the app's own files are never touched), the phone page on port 8794 where it is chosen with a preview and the sizes that fit the theme's tiles, and the reset; `apps.js` sends the picture first on `/icon/<app id>` and marks the app with `iv` (and `it` for Full tile) in `/api/apps`. |
| `theme.js`, `themeschema.js` | Themes: `themeschema.js` holds every setting a theme can make, the checks and how a theme becomes CSS variables; `theme.js` reads themes from GitHub and keeps them on the TV. |
| `voice.js`, `answers.js` | Voice: the microphone, the recogniser, the phone setup page; `answers.js` asks Home Assistant, a language model or your server. |
| `selfupdate.js`, `sharelog.js` | Programs the manager runs when the service is not running. |

## The pages

The launcher and the manager are built from source files: `app/src` and `manager/src` hold `index.html` with `@include` lines and the
CSS and script files they name. `node tools/build-pages.js` writes `app/index.html` and `manager/app/index.html`, the single files
the TV loads; the built files are committed, so an update and the theme preview read them as before. The picker and the notification
card are small and stay single files.

## How the launcher becomes Home

1. `10-cleanyourtv-home` runs at boot and starts the service.
2. `stage-home.sh` builds a directory holding the launcher plus an `appinfo.json` derived from this TV's own stock Home (saved in
   `backup/home-appinfo.orig.json` the first time), switched to the web type.
3. `tvprofile.js` decides the way from the stock Home's kind (`homeTakeover`):
    - `mount` (flutter or web Home, webOS 24 and newer): the script **bind-mounts** that directory over
      `/usr/palm/applications/com.webos.app.home`, restarts the system app manager (`sam`) so it reads the new Home, and launches
      Home again. On webOS before 7 and with a native Home, `after-sam.sh` then restarts the services that keep talking to the old
      app manager (`afterSam`).
    - `standin` (native Home, webOS 5 to 23): `jtool.js exe` finds LG's Home program in the stock `appinfo.json` and the script
      bind-mounts `home-standin.sh` over it, then stops LG's running Home once. `sam` is not restarted and keeps LG's Home manifest,
      so it starts the stand-in for Home. The stand-in sends `wam-launch.json` (written by `stage-home.sh` with `jtool.js wamlaunch`) to
      `com.palm.webappmanager/launchApp`, which opens the directory from step 2 as `com.webos.app.home`, and holds a registration
      with `sam` so the Home key sends it `relaunch`. Without registration, `sam` restarts the stand-in on the Home key, which opens
      the launcher the same way. When `sam` starts the stand-in only to preload Home (`"reason":"preload"`, seen on webOS 4.5 about
      15 seconds after LG's Home is stopped), it registers but opens nothing, so the launcher does not cover the input on screen;
      the first Home key opens it. `/tmp/cleanyourtv-home-standin` holds the program's path while it is mounted; `reload-home.sh`,
      `undo-home.sh`, the debloat hook and the manager's status read it. If `webapp-mgr` does not list the launcher within 30
      seconds, `undo-home.sh temp` brings LG's Home back. That check starts about 3 seconds after the mount when Home is in the
      foreground; when the TV started on an input or another app, it waits until Home is first asked for (the stand-in leaves
      `/tmp/cleanyourtv-home-asked`; a preload does not count) or the app manager reports Home in the foreground without it (a stand-in
      that does not run), so a broken stand-in still brings LG's Home back. `home-method` holding `mount` forces the first way.
      `bootstrap.sh verify` does the same once: when the launcher does not come up after a stand-in setup (a TV with CRIU never runs
      the stand-in, issues 72 and 84; `criu` in `tvprofile.js` records it but does not decide), it writes `home-method` `mount`, runs the boot
      script again and checks again; the rollback removes the file only if the setup wrote it.
4. A **watchdog** (`watchdog.sh`, one per boot, started by the boot script also while LG's Home is selected) asks the service every 10
   seconds. When the service has stopped, it starts it again (also while LG's Home is back after a fallback, but not while
   `bootstrap.sh` runs), notes that in `/tmp/cleanyourtv-boot.log` and adds the log of the run that ended to
   `/tmp/cleanyourtv-helper.crash.log` (the last 400 lines; Share log includes it). A service that stops again at once is started less
   often (after 10, 20 ... up to 120 seconds). If the service stays unreachable for about a minute while our launcher is Home, it
   restores LG's Home until the next reboot. An update stops the watchdog and the boot script starts the one from the new files; it
   ends by itself when CleanYourTV is uninstalled (`helper.js` gone).

Nothing is written under `/usr`: the mount disappears at reboot. `DISABLE` in `/media/developer/cleanyourtv` makes the script skip it.

## Updates and rollback

- **Launcher.** The manager downloads `frontend-<version>.tgz` and its `.sha256`, checks the list of files in the archive (only
  `app/...`), unpacks, checks `version.json`, swaps it in (the old one becomes `app.prev`), reloads Home and waits up to 40 seconds
  for the new launcher to report that it started. If it does not, the previous launcher is swapped back.
- **Service.** The manager downloads the package, installs it with the system's app installer and runs `bootstrap.sh update`,
  which keeps the running files in `backup/service-prev.tgz`, copies the new ones, restarts the service and waits for it to answer
  with the new version. If it does not, the previous files are restored.
- **Dev builds.** Same flows, from the pre-release `dev`; the commit in a `BUILD` file is how two builds with one version number are told apart.

## Older webOS versions

webOS 5 and 6 ship Node.js 8, and webOS 6 has Chromium 79.

- `helper/netcompat.js` supplies `URL`, `URLSearchParams`, `crypto.randomInt`, `mkdir -p` and the `http(s).get(url, options)` form.
- What differs between versions is decided in `helper/tvprofile.js`: the picker is started on demand and the notification window is an
  `overlay` before webOS 25 (SDK 10); LG's native Home (webOS 5 to 23) is taken over by the stand-in, without restarting the app
  manager. The table is in [Tested TVs](../tested-tvs.md#what-differs-between-webos-versions).
- The pages do not use flex `gap`, which Chromium before 84 ignores: spacing between flex children is a sibling margin
  (`.row > * + * { margin-left: 22px; }`). Grid `gap` is fine from Chromium 66. The focus ring of a tile is a `::before` with its own
  radius, because Chromium before 94 draws an `outline` as a rectangle.
- The service accepts the `file://<appId>-webos` origin that webOS 6 apps send, for our own apps and the Home slot only.
- `scripts/reload-home.sh` restarts `webapp-mgr` on webOS 6, where a relaunch alone keeps the old page.

!!! note "Checked by reports, not by the maintainer"
    The maintainer's TV runs webOS 25. webOS 5, 6 and 23 are known from reports ([Tested TVs](../tested-tvs.md)). Every change is
    checked under Node 8.12.0 and in Chromium 68 and 79 (`sh tools/check.sh --chromium`), not on a TV of those versions.

## Things that were tried

!!! info "A native launcher"
    A launcher written in C with SDL2 (so it draws on the GPU without the web runtime) was built and run as LG's Home on a
    webOS 25 TV. It worked, started quickly and used about as much memory and CPU as the web launcher, but LG's compositor shows
    "Do you want to exit the app?" when Back is pressed in a native app, and setting a key mask on the window did not stop it. It
    is kept on the `native-launcher` branch for reference and is not part of the project.
