# Screen saver

CleanYourTV replaces LG's screen saver with its own page: the same pictures as behind Home (the theme's scenes, your photos from the
[wallpaper library](wallpapers.md) or the theme's wallpaper), cross-faded, with the clock and date in the corner. It appears when the
TV is idle, when LG's screen saver would have (see [When it appears](#when-it-appears)).

**It is off until you switch it on**: in the manager app, **Features → Screen saver** (the TV restarts). A new install and an update
keep LG's screen saver.

It is applied the same way as Home (**RAM only**): a reboot without the boot scripts, or the Homebrew Channel's failsafe mode, brings
LG's screen saver back.

## What it shows

- **What Home has behind it**, worked out in Home's own order, changed every 25 seconds (a new photo starts when the page opens):
    1. the theme's **scenes**: the five landscapes of the couch scenes (or an add-on's scenes in their place, such as Seasons, with
       their credit line), or a theme's own scenes;
    2. else, with [Wallpapers](wallpapers.md) on, the **wallpaper library**: uploads from the phone, the photos of a source add-on
       (Immich), and a live source (Unsplash: the photo Home shows now, with the photographer's name; the saver does not ask the
       source for another, which would make Home skip one; right after the service starts, the photo the saver fetched first is
       the one Home gets next; with only a live source the page looks again every 25 seconds and follows
       Home when its photo changes);
    3. else the **theme's wallpaper**.
- **The clock and the date**, bottom right, solid white over the photo: no transparency, so it stays readable on a bright picture.
  It sits in the same corner all the time, which is the one thing to watch on a panel that retains static content.
- **Nothing behind Home** (a plain theme, Wallpapers off): the clock and date alone, on black.

The first key, click or touch closes it and the app that was on screen comes back. Nothing is saved or uploaded.

## How it replaces LG's screen saver

The same idea as for [Home](tv-changes.md#at-boot), on the app the TV starts when it is idle: `com.webos.app.screensaver`.

1. `20-cleanyourtv-screensaver` runs at boot. It builds a folder with the page and an `appinfo.json` derived from **this TV's own**
   screen saver (saved in `backup/screensaver-appinfo.orig.json` the first time), switched to the web type while it keeps **this TV's
   own window type** (`screenSaver`, which is the only one `tvpowerd` counts — see [When it appears](#when-it-appears)). The app id
   stays LG's, which is why the TV keeps asking for it. The folder is built on every run, also while it is already mounted, so a
   setup over a running install puts the new page in place (as `10-cleanyourtv-home` does for Home).
2. How it is put in place is decided by `helper/tvprofile.js` (`saverTakeover`), from the kind of LG's screen saver as it came with
   the TV:
    - **a native program**: `screensaver-standin.sh` is bind-mounted over that program. The app manager keeps LG's manifest and starts
      the script when the screen saver starts; the script asks `webapp-mgr` to open the page. The app manager is not restarted.
      If our page does not open (webapp-mgr refuses it, or it never shows up), the stand-in takes its own mount off and starts
      LG's program, so the TV has LG's screen saver for that boot rather than none; the manager then shows "ours did not open"
      under Features > Screen saver. After two boots in a row with such a failure, the boot script switches to the folder mount
      (`screensaver-method` holding `mount`); deleting that file tries the stand-in again.
    - **anything else** (a QML or web screen saver): the page's folder is bind-mounted over
      `/usr/palm/applications/com.webos.app.screensaver` and the app manager is restarted so that it reads it.
3. The page runs as LG's screen saver app, so the TV treats it as its screen saver, and closing it gives the app that was underneath back
   instead of going to Home (that was seen with the earlier `overlay` manifest — see [Limits](#limits)).

`10-cleanyourtv-home` mounts the screen saver *before* it restarts the app manager, so on a TV where both use the folder mount there is
one restart, not two. A file `screensaver-method` holding `mount` forces the folder mount on a TV whose screen saver is a native
program.

Where Home is a stand-in but the screen saver needs the folder mount (a QML screen saver, the likely case on webOS 5 and 6), the app
manager is restarted at boot *after* Home came up, because the restart takes down the page in `webapp-mgr`; a moment later Home is
opened again (`reload-home.sh`), but only when nothing or Home is in front, not over an app or input the TV is on by then. The setup
itself never restarts the app manager for the screen saver: such a TV keeps LG's screen saver until its next boot and gets ours then
(a folder mounted without that restart would hide LG's files from an app manager that has not read the new manifest, and the TV would
have no screen saver at all). A native saver (the stand-in) and a TV where the Home takeover restarted the app manager get ours at
once.

## When it appears

`tvpowerd` starts it after the TV's idle timeout (two minutes, `com.webos.surfacemanager.userActivityTimeout`) and starts it again after
each dismissal, as LG's own saver does — **provided the window type is LG's own**. With `defaultWindowType: "overlay"` it started the
page once and then stayed at `Screen Saver Ready` for good; with `"screenSaver"` (inherited from the stock manifest, see
`scripts/jtool.js`) it re-arms. Three timed cycles on the tested TV: 61 s, 112 s, 61 s.

The service keeps a second, slower timer as a fallback (`helper/screensaver.js`): two quiet minutes with the launcher
in front and it opens the page itself. It covered one of those three cycles, where `tvpowerd` did not fire. "Quiet" is the launcher's
own word: its page reports every key, click and pointer movement to the service (`POST /api/screensaver/active`), and the timer only
fires when no report has come for two minutes — a TV being browsed with the remote is Home in front all evening, and only `tvpowerd`'s
timer knows about that. A launcher that reports nothing (LG's Home in front, a launcher from before this) is left to `tvpowerd`.

The limit that follows: over a video app the service cannot tell an idle TV from a watched one, so there the saver comes only from
`tvpowerd`.

The page ignores keys for its first two seconds: webOS delivers a key with the launch, and without that guard the page closed itself
right after opening.

## While it runs

- The page asks the service for the photos and closes itself through it (`POST /api/screensaver/dismiss`). The service closes the
  page with `com.palm.webappmanager/killApp` and the app manager's `closeByAppId`, each tried on its own, which is what works where
  `window.close()` does nothing.
- If the system ends the screen saver by itself (the TV is back on an app) and the page is still listed, the service closes it within
  about a minute. A page left behind would keep the remote.

## Turning it off and on

In the manager app: **CleanYourTV as Home → Screen saver** or **Features → Screen saver**, On or Off. Switching restarts the TV, as
that switch does for Home. The row under Features also says which screen saver runs now: ours, LG's own, or "ours did not open"
when the stand-in gave LG's screen saver back this boot.

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
touch /media/developer/cleanyourtv/SCREENSAVER-ON
```

The setting is the file `SCREENSAVER-ON` in `/media/developer/cleanyourtv`: present means ours, absent (the default) means LG's.

## Limits

!!! warning "Power-off stalled on the first TV, then was fixed"
    On the LG 65UR91006LB (2026-10-31) turning the TV off while the page was up **stalled**: the picture stayed frozen for a few
    minutes before the TV went off. The page had no standby handling, and the service had closed it with `killApp` while `tvpowerd`
    owned it. The page now closes itself on `visibilitychange` (standby, another app on top), and with that in place a power-off with
    the saver on screen went cleanly (verified on the same TV). The `killApp` path on dismissal is still there, so treat this as
    "fixed once, watch it".

!!! note "What was verified on that TV"
    LG's screen saver is a **Flutter** app started by `tvpowerd`: after the mount and one app manager restart, sam reports `type: web`,
    `main: index.html`; `tvpowerd` starts the page after the idle timeout (`caller_id: com.webos.service.tvpower`), with the window type
    of the manifest, and the first key closes it and gives the launcher back. Without the app manager restart the registry keeps
    `type: flutter` and nothing appears — the restart is what makes the mount take effect.

The launch showed a grey "loading" screen with a spinner for a second, like any web app: the derived manifest now sets
`noSplashOnLaunch: true` and `spinnerOnLaunch: false`, so the page's own black background is what appears. (Not yet seen on the TV.)

- While the page is up the power state stays `Active` with `processing: "Screen Saver Ready"`; that is why the service treats it as the
  screen saver and leaves it alone (a page that was closed every minute by its own safety check was the first bug found on the TV).
  The safety close rests on that one string of LG's, seen on the tested TV: a build that reports `Active` with another `processing`
  while the page is up would see the page closed and opened again. To keep one odd reading from doing that, the service closes the
  page only after a minute and at two readings in a row (10 seconds apart) without "Screen Saver" in `processing`.
- The page keeps LG's `screenSaver` window type: that is what makes `tvpowerd` arm it again after a dismissal (with `overlay` it started
  once and then stayed at `Screen Saver Ready`, see [When it appears](#when-it-appears)).
- "Closing it gives the app underneath back" was seen with the earlier `overlay` manifest, where the first key closed the page and gave
  the launcher back. With LG's own window type that is worth one look on a TV with a video app behind the saver.
- If the page does not open where its folder is mounted, the TV stays on the app it was showing: the screen stays on rather than
  turning black. Where the stand-in is used, LG's screen saver runs instead for that boot (see
  [How it replaces LG's screen saver](#how-it-replaces-lgs-screen-saver)).
- LG's **Screen Saver** setting (Clock, Gallery, Photo) still exists and is untouched; only the app it starts is replaced.
- The TV's own sleep and power-off timers are untouched.
- Photos are streamed from the service on `127.0.0.1`, so they are as fast as the wallpaper library behind Home.
