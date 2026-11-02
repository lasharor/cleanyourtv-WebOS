# Screen saver

CleanYourTV replaces LG's screen saver with its own page: your own photos from the [wallpaper library](wallpapers.md), cross-faded,
with a dim clock and date in the corner. It appears when the TV is idle, exactly when LG's screen saver used to.

It is applied the same way as Home (**RAM only**): a reboot without the boot scripts, or the Homebrew Channel's failsafe mode, brings
LG's screen saver back.

## What it shows

- **Photos** from the wallpaper library (uploads from the phone and Immich, the same photos as the ones behind Home), changed every
  25 seconds. A new photo starts when the page opens.
- **The clock and the date**, bottom right, dim: the clock fades further after two minutes, so a bright corner does not stay in one
  place on an OLED panel.
- **No photos**: the clock and date alone, on black.

The first key, click or touch closes it and the app that was on screen comes back. Nothing is saved or uploaded.

## How it replaces LG's screen saver

The same idea as for [Home](tv-changes.md#at-boot), on the app the TV starts when it is idle: `com.webos.app.screensaver`.

1. `20-cleanyourtv-screensaver` runs at boot. It builds a folder with the page and an `appinfo.json` derived from **this TV's own**
   screen saver (saved in `backup/screensaver-appinfo.orig.json` the first time), switched to the web type and to an overlay window.
   The app id stays LG's, which is why the TV keeps asking for it.
2. How it is put in place is decided by `helper/tvprofile.js` (`saverTakeover`), from the kind of LG's screen saver as it came with
   the TV:
    - **a native program**: `screensaver-standin.sh` is bind-mounted over that program. The app manager keeps LG's manifest and starts
      the script when the screen saver starts; the script asks `webapp-mgr` to open the page. The app manager is not restarted.
    - **anything else** (a QML or web screen saver): the page's folder is bind-mounted over
      `/usr/palm/applications/com.webos.app.screensaver` and the app manager is restarted so that it reads it.
3. The page is an **overlay window**: closing it gives the app that was underneath back, instead of going to Home.

`10-cleanyourtv-home` mounts the screen saver *before* it restarts the app manager, so on a TV where both use the folder mount there is
one restart, not two. A file `screensaver-method` holding `mount` forces the folder mount on a TV whose screen saver is a native
program.

Where Home is a stand-in but the screen saver needs the folder mount (a QML screen saver, the likely case on webOS 5 and 6), the app
manager is restarted at boot *after* Home came up, and Home is opened again afterwards (`reload-home.sh`), because the restart takes
down the page in `webapp-mgr`. The setup itself only mounts; such a TV gets the new screen saver from its next boot.

## While it runs

- The page asks the service for the photos and closes itself through it (`POST /api/screensaver/dismiss`). The service closes the
  page with `com.palm.webappmanager/killApp`, which is what works where `window.close()` does nothing.
- If the system ends the screen saver by itself (the TV is back on an app) and the page is still listed, the service closes it within
  about a minute. A page left behind would keep the remote.

## Turning it off and on

In the manager app: **CleanYourTV as Home → Screen saver**, On or Off. Switching restarts the TV, as that switch does for Home.

The same thing from a shell on the TV — LG's own screen saver back for good:

```sh
sh /media/developer/cleanyourtv/undo-screensaver.sh
```

Until the next restart only:

```sh
sh /media/developer/cleanyourtv/undo-screensaver.sh temp
```

CleanYourTV's screen saver again (the next restart):

```sh
rm /media/developer/cleanyourtv/DISABLE-SCREENSAVER
```

The setting is the file `DISABLE-SCREENSAVER` in `/media/developer/cleanyourtv`: present means LG's screen saver.

## Limits

!!! warning "Power-off stalled on the first TV, then was fixed"
    On the LG 65UR91006LB (2026-10-31) turning the TV off while the page was up **stalled**: the picture stayed frozen for a few
    minutes before the TV went off. The page had no standby handling, and the service had closed it with `killApp` while `tvpowerd`
    owned it. The page now closes itself on `visibilitychange` (standby, another app on top), and with that in place a power-off with
    the saver on screen went cleanly (verified on the same TV). The `killApp` path on dismissal is still there, so treat this as
    "fixed once, watch it".

!!! note "What was verified on that TV"
    LG's screen saver is a **Flutter** app started by `tvpowerd`: after the mount and one app manager restart, sam reports `type: web`,
    `main: index.html`; `tvpowerd` starts the page after the idle timeout (`caller_id: com.webos.service.tvpower`, window
    `_WEBOS_WINDOW_TYPE_OVERLAY`), and the first key closes it and gives the launcher back. Without the app manager restart the registry
    keeps `type: flutter` and nothing appears — the restart is what makes the mount take effect.

The launch showed a grey "loading" screen with a spinner for a second, like any web app: the derived manifest now sets
`noSplashOnLaunch: true` and `spinnerOnLaunch: false`, so the page's own black background is what appears. (Not yet seen on the TV.)

- While the page is up the power state stays `Active` with `processing: "Screen Saver Ready"`; that is why the service treats it as the
  screen saver and leaves it alone (a page that was closed every minute by its own safety check was the first bug found on the TV).
- The window is an `overlay`, not LG's `screenSaver` type: closing it gives the app underneath back, which is what a screen saver needs.
- If the page does not open, the TV stays on the app it was showing: the screen stays on rather than turning black, and the next restart
  is LG's screen saver as before.
- LG's **Screen Saver** setting (Clock, Gallery, Photo) still exists and is untouched; only the app it starts is replaced.
- The TV's own sleep and power-off timers are untouched.
- Photos are streamed from the service on `127.0.0.1`, so they are as fast as the wallpaper library behind Home.
