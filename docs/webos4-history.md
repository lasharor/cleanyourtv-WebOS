> Historical research log. Current accepted state and limitations: [webos4.md](webos4.md). Earlier pending states below are superseded.

# Experimental standalone launcher for webOS 4

This is the standalone prototype from `webos4-research.md`, version 0.2.0. The earlier version was installed and exercised on a
webOS SDK 4.4.0 TV with Chromium 53.0.2785.34 and the isolated Node 18.17.1 runtime. It is **not a replacement for LG Home**.
The normal manager and installer still require webOS 5+; boot startup and recovery have not been tested for this prototype.

## Validated source-switching contract

**Current validated baseline, 26 October 2026:** the user confirmed both the first Live TV/HDMI 1 cycle and the full
YouTube playback → LG menu → CleanYourTV → Live TV → HDMI 1 cycle work with the deployed page. The helper remains manually started;
HOME bindings, automatic startup and debloat are not enabled. This baseline supersedes the older experiments recorded below.

Preserve these invariants when implementing the remaining features:

1. Page-initiated app/source launches use only `POST /api/launch` through the isolated helper. Native Live TV must receive exactly:

   ```json
   {
     "checkUpdateOnLaunch": false,
     "id": "com.webos.app.livetv",
     "reason": "recent",
     "autoInstallation": false,
     "params": { "reason": "recent" }
   }
   ```

   HDMI 1 uses only `{"id":"com.webos.app.hdmi1"}`. The helper supplies these payloads; arbitrary page parameters are discarded.

2. Keep the launcher window alive during source switching. Do not queue a close/hide and do not close input apps as cleanup.
   A hidden Chromium 53 page can suspend its callbacks until reactivation. Closing a hidden app and immediately launching it again
   also races the app manager's asynchronous lifecycle; avoid that pattern during validation.
3. A launch has a ten-second client timeout and **no automatic retry or direct bridge fallback**. An error/timeout is uncertain:
   the first request may already have reached LG. Report it and inspect the source instead of issuing a second activation.
4. Keep the source-switching tests in `tools/test/webos4.test.js`: exact helper payloads, no input closes, no queued window close,
   no bridge retry on error/timeout, and the default read-only guard. Run `sh tools/check.sh --chromium` before accepting changes.
5. Recheck physically: native LG Live TV and HDMI 1 first; then CleanYourTV's Live TV and HDMI 1; finally play YouTube for a few seconds,
   return through LG's menu to CleanYourTV, open Live TV once and return to HDMI 1. Check actual picture and remote response.
   For automated checks, wait for document load, list completion and the correct foreground target; never rely on an initial Enter focus.
6. If both stock LG sources are black, stop testing launches and collect read-only diagnostics. A full reboot recovered this state in
   the observed incidents and requires the user's authorization. After recovery, validate the stock sources before restarting the helper.
   A reboot recovery does not establish that the launcher fix works: repeat the custom-launcher and YouTube transitions as well.
7. Keep software updates disabled for this isolated port. **Connection** only reads `/api/service` on loopback; app discovery only reads
   `/api/apps`. Do not wire them to the normal manager's release, download or update endpoints.

All 450 local checks passed on Node 8.12 and Node 22, including the original API golden replies, with types/lint/formatting, page builds,
and Chromium 68/79 checks. The real-device sequence above was confirmed separately by the user. These fixes eliminate observed races;
they do not identify the unique low-level media/compositor cause or guarantee against every future TV failure.

## Paired Bluetooth audio confirmation

The standalone `webos4/bluetooth-accept.js` service is independent of the launcher/helper. It never initiates pairing.
On startup it makes at most one A2DP connection request to the configured paired peer if disconnected and no other audio device is active.
A failed or uncertain connection is not retried.
It accepts only the configured, already-paired A2DP device when `pairing:false`, its MAC/name and the active audio device agree.
Its root-owned 0600 configuration lives at `/var/lib/webosbrew/cleanyourtv-bluetooth.json`; observed reboot permission changes under
`/media/developer` make that tree unsuitable for the private configuration.

**Do not invoke the native Yes callback directly.** On this firmware, calling
`com.webos.service.btaudiosrc/onClickListener {"button":5,"type":3}` closes the dialog without clearing its UI close action.
A captured trace proved that the compositor then sends `{"button":4,"type":3}`, causing A2DP disconnect and a return to TV speakers.
The initial apparent success was superseded by this stability failure.

The service instead uses the existing LG UI button. It checks the focused `alertView`, captures a BMP into a private temporary directory,
and hashes the calibrated opaque dialog region, including the device message and button focus. RIGHT is sent only for the known No
image; ENTER is sent only for the known Yes image after another focus check. Other content or an intervening dialog cancels the action.
Read-only rendering checks are bounded; key requests are never retried. Startup can also recognize an already-visible calibrated prompt.
Changing LG's dialog layout, language or resolution requires recalibration; an unmatched image leaves manual control intact.

**Robust waiting installed with explicit authorization:** confirmation now has a single 15-second deadline and polls every 500 ms while
focus or the calibrated image is unavailable. It also waits if focus is lost after an accepted RIGHT, without sending RIGHT twice.
An already-selected, recognized Yes needs only ENTER; a recognized No permits one RIGHT, then a newly recognized Yes is required.
Device pairing/active identity, the image and focus are rechecked before each key. A stale Yes cannot authorize ENTER after device
verification. Unknown pixels are never treated as No. Closing/replacing the alert, stopping, uncertainty or the deadline cancels pending work.
This changes waiting behavior only: private device/calibration configuration, boot entry and native Yes callbacks remain untouched.
It cannot fix an unrecognized dialog layout or a permanently broken native focus; those cases expire without accepting anything.
The older deployment was seen reporting `startup-connect-uncertain / skipped-image` and, in a later boot,
`startup-connect-requested / skipped-focus`. Read-only capture confirmed a No-selected paired-device prompt but its pixel hash was
unrecognized. No diagnostic arrow or ENTER was actually sent: the user restarted before that action, the old capture directory was gone,
and they subsequently reported that the popup disappeared and Bluetooth connected.
The new waiting behavior passed 634 checks on Node 8/22, types/lint/formatting, Chromium 68/79 and an actual Node 0.12.2 smoke
using simulated callbacks. Only its own process was restarted; the private configuration checksum stayed identical and the paired
device remained connected. With no alert present, `timeout-before-key-focus` means the observer sent no keys, not a failed connection.
The later boot with HOME's graphics restart removed recorded a real `accepted` event, and a private status query confirmed the
configured device connected through A2DP. The user subsequently confirmed everything working. Calibration was unchanged.
Private previous code and a restoration script are in
`/var/lib/webosbrew/bluetooth-robust-before-20261029/`; revert with `sh /var/lib/webosbrew/bluetooth-robust-before-20261029/restore.sh`.

A real 25-second trial maintained the Bluetooth audio connection after the observer exited. The user confirmed working audio and
the trace contained only the compositor's Yes, without the later No. Continuous start, duplicate-start prevention and disable/re-enable
were checked on the TV. The boot entry and private configuration survived a real reboot and the service ran, but the peer did not initiate a connection.
The final one-shot startup connection was then tested: one A2DP connect, one native Yes, no No or disconnect, stable audio and `pairing:false`.
Full reboot verification of this last connection addition is pending. There are 38 focused tests, including
real child processes, BMP matching, closed/replaced prompts, wrong devices, uncertainty and private configuration, within 540 passing
Node 8/22 checks. The module and real image signatures also ran on system Node 0.12.

The isolated controller is `/media/developer/cleanyourtv/bluetooth/bluetooth.sh`:
`status`, `start`, `stop`, `trial` (25 seconds), `enable`, `disable`.
Disable removes only its matching `/var/lib/webosbrew/init.d/25-cleanyourtv-bluetooth` and stops only its PID/executable/script/start-time
identity. It does not disconnect or unpair the audio device. Logs/PID files live under `/tmp/cytv-bluetooth.*`; device identifiers and
screenshots are never logged to the repository. This does not enable helper/HOME startup, an updater, or debloat.

## Netflix preloading and slow standby

On the test TV, a captured slow shutdown had 14 of 15 preparation acknowledgements: preloaded Netflix did not acknowledge
`Prepare Power Off`. The power manager waited for its eight-second deadline. Closing only that background app removed its client
registration; all 14 remaining clients acknowledged and shutdown proceeded 1.3 ms after the last acknowledgement. The user reported
about four seconds from black screen to the standby LED in that comparison. This identifies that captured delay, not every possible
Netflix or power-management failure.

With explicit approval, `com.webos.service.config/setConfigs` changed only Netflix's `isEnabled` to `false` in
`com.webos.service.preloadmanager.supportAppList`. The other eight entries and all their fields were preserved. The foreground input,
native launch payloads, Bluetooth confirmation service and HOME handling were not changed. No extra boot hook or service was installed.
The source configuration retained this exact value after a manual off/on cycle. Do not infer persistence from `getPreloadPolicy` alone:
its runtime view had shown Netflix disabled while the already-preloaded process was still present.

Private original/candidate payloads are in `/var/lib/webosbrew/netflix-preload-20261029/` (root directory 0700, files 0600).
Restore the original values through the same API; never edit the whole configd database directly:

```sh
luna-send -n 1 -w 5000 luna://com.webos.service.config/setConfigs "$(cat /var/lib/webosbrew/netflix-preload-20261029/netflix-preload-original.json)" </dev/null
```

The user confirmed that Netflix opens normally from LG's app icon after the change. A subsequent manual-use shutdown took
11.22 seconds and again had 14 of 15 preparation acknowledgements, with only Netflix missing. Disabling preloading therefore
mitigates idle preloading only; it does not fix the missing acknowledgement after manual use.
These payloads belong to this TV's recorded list; do not apply them to another TV or firmware blindly.

The former `netflix-poweroff.js` was a separate **failed experimental** two-minute trial. It observed power-state notifications and,
only after seeing Active, sends one fixed Netflix close at `Request Power Off`. It does not close Netflix when the user changes apps,
send power acknowledgements, retry uncertain closes or install anything at boot. A signal or its deadline stops only its own Luna
children. In its authorized physical trial, LG accepted the close but Netflix did not clear its pending acknowledgement; shutdown
still took 11.49 seconds and exhausted the same deadline. It is not installed at boot and must not be persisted as a fix.
Closing Netflix while the TV is still fully active, before requesting power-off, remains the only tested successful close sequence.

The user selected closing Netflix on return to a native source. Its replacement, `webos4/netflix-source-exit.js`, defaults to a
two-minute trial. The TV supports its passive `getForegroundAppInfo` subscription. The observer must
first observe Netflix in the foreground, then Live TV or HDMI 1–4 continuously for two seconds, then confirm the same foreground
source with a fresh query. Menus and other apps do not trigger closure; returning to Netflix or stopping invalidates pending work.
It sends one fixed Netflix close, with no retry after an uncertain result, and requires another Netflix visit before rearming.
The trial neither launches nor closes native sources or the launcher. Returning to Netflix later requires opening it again.
In the authorized trial, the user confirmed source picture/audio; the Netflix process and all its power-client registrations
disappeared, and the following shutdown took approximately **4–5 seconds**. The trial expired without a boot entry.
An accepted close alone is insufficient evidence of termination. A last-moment foreground change after the query remains a small
timing race, and switching directly off while still in Netflix is outside this workaround.

**Installed with explicit authorization on 29 October 2026**: `netflix.sh` manages `netflix-source-exit.js --service` without the trial deadline; an owned
`30-cleanyourtv-netflix` boot entry starts it from the private `/var/lib/webosbrew/netflix-source-exit/` directory. It follows the
existing Bluetooth controller's ownership pattern without modifying Bluetooth: exact executable, script, mode and process start
time must match before stopping a process. Repeated starts reuse that process; unrelated boot entries block installation.
Logs and PID records stay in the private service directory. It does not automatically restart on subscription failure.
The user confirmed the full physical source regression sequence. Native Node 0.12.2 loads the installed module, shell syntax and
all copied hashes match, and the service reports `running`/`boot-enabled`. Invoking its boot entry again reuses the same process.
Actual startup after a subsequent physical power cycle is still unverified; no extra power cycle was requested for installation.
The app-list helper remains manually started and is independent of this Netflix boot entry.
Enable:
`sh /var/lib/webosbrew/netflix-source-exit/netflix.sh enable`.
Undo, stopping the observer and removing only its matching boot entry:
`sh /var/lib/webosbrew/netflix-source-exit/netflix.sh disable`.
Check with `status`; use `start`/`stop` for the current session without changing boot configuration.

## TV interface refinement

Focus no longer translates or scales buttons and has no transform transition. The user reported temporarily square corners while
moving focus; Chromium 53's animated layer repaint is a plausible mechanism, not a proven root cause. The rounded white focus ring
and selected colours remain. The new browser check failed before the change and passes afterwards in Chromium 68 and 79.
On the real TV, key navigation and computed styles confirmed `transform: none`, zero transition duration and the expected radii
for all home buttons. Only CSS was deployed, with a page backup and `rollback-focus.sh`. The user subsequently confirmed the
corners now look correct while navigating.

The native Settings app (`com.palm.app.settings`) is installed with `visible: false` on the test TV. The normal visible-app filter
therefore excluded it from the launch allowlist. The prototype now explicitly allows this single Settings id when launching is enabled;
other hidden/unlisted apps remain blocked and caller parameters are still discarded. The list remains limited to visible apps.
The new regression failed before the exception and passes afterwards; all 421 checks pass on Node 8.12 and Node 22.
After deploying only the helper with a backup and `rollback-settings.sh`, Settings was opened from the actual launcher button.
LG reports it running as `defaultWindowType: overlay`, so the foreground app can still be CleanYourTV. The user confirmed the
Settings panel opens and physical Back closes it correctly. No configuration values were changed.

The current interface uses a matte dark background, original locally bundled app icons and each platform's own colours.
Cards, favourite tiles and utility icons share consistent sizing; the remote focus ring remains visible on every surface.
The fixed HDMI/resolution banner was replaced by the current selection's description, avoiding an unqueried source claim.
Brand images retain their aspect ratio and load offline. System utilities use consistent line icons; unknown apps use a neutral fallback.
Image ownership is recorded in `webos4/app/assets/NOTICE.txt`. App artwork is separate from the project's MIT-licensed code.

Home, the six-column library and the five-column Inputs selector were inspected on the real TV's Chromium 53 at 1920×1080.
On 30 October, Up on the dock's All apps button was changed to focus the featured row, matching the other dock buttons; only OK/click
opens the library. A regression reproduced the former Up-to-open behavior and passed after removing that exception. All 643 local
checks and Chromium 68/79 checks passed. The rebuilt page was installed with a private backup, without restarting TV graphics/services.
Keyboard events in the visible, loaded real Chromium 53 page confirmed Up keeps the drawer closed, OK opens it, library arrows move
one row and Back/Escape returns to the dock. No app/source launch behavior changed; this was not a physical remote-key test.
Undo: `sh /var/lib/webosbrew/cleanyourtv-home/ui-nav-before-20261030/restore.sh`, then reopen/reload CleanYourTV.
Remote key events were used to check focus, library navigation and Back from both overlays. All bundled icons loaded successfully.
During that visual-only refinement the helper and source-launch/fallback functions were unchanged. The visual update did not restart
the helper or switch native sources. A page backup and `rollback-ui.sh` were kept on the TV before updating the page and images.
Local verification covers 418 checks on Node 8.12 and Node 22, types/lint/formatting, packaging and the pages in Chromium 68 and 79.

## Remaining work before HOME and debloat

The working native source activation does not establish readiness for permanent HOME integration.

The current local page reads its installed application catalogue from `GET /api/apps` on startup and when opening the library.
Known names and offline artwork are display metadata, not evidence of installation. Failed/invalid/timed-out reads retain the last
successful list, and rereading preserves saved favourite ids and focus. The old notification-only Refresh button is now **Connection**:
it makes only `GET /api/service` against `127.0.0.1:8765` and reports helper availability, response time and read-only mode.
It never checks a release, downloads a build or installs software. The prototype helper has no update routes or update modules.
Tests explicitly reject the regular manager's check/update endpoints. The working port stays pinned to the local code.

The catalogue/Connection change was deployed with a page backup. On the TV it displayed 25 real apps and seven favourites;
the last library row was reachable and the connection button made one local `GET /api/service` (15 ms in that test).
There were no release checks or software downloads. During a read-only HOME-key
capture attempt the TV rebooted, removing the temporary reader and its output. No reboot command, HOME binding or boot edit was sent.
The user was away and could not identify the cause. After reboot, SSH worked,
the helper was stopped, its file checksum was unchanged, and the hook's binding file was still empty.

1. Finish repeat native-source validation after the recovery described below, before enabling HOME.
2. Add a webOS 4-specific manual service/boot lifecycle with the isolated Node runtime, ownership checks, a disable switch and recovery.
   The current helper still starts manually. Only the existing Input Hook boot file is present on the inspected TV.
3. Learn and temporarily test the physical HOME key through the already installed hook, with an explicit way back to LG.
   The inspected key binding file is empty. The original Home overlay scripts assume `systemctl` and a newer Home app layout;
   they must not be used as the webOS 4 activation path.
4. Verify apps, repeated Live TV/HDMI switching, remote keys, sound, network, helper failure recovery, boot and rollback before persisting HOME.
5. Audit and adapt debloat separately. The inspected TV uses Upstart (`initctl`), while the existing scripts stop/restart systemd units.
   Of the original candidate jobs, `remotelogger` was running and `admanager` was waiting; the `acr2` and `admanager` binaries existed.
   This inventory does not establish that disabling them is safe. Test changes individually, including their undo and the LG Home fallback.

No HOME binding, boot change, service stop, hosts modification or debloat was applied during this inspection.

### HOME observation and temporary trial preparation

On a subsequent read-only retry, the user confirmed HOME opened LG without rebooting. The remote input device emitted code 773.
No key binding was changed. A two-minute trial controller is prepared in `webos4/home-bind.js` and `webos4/home.sh` but is not activated
or installed on the TV yet. It refuses an occupied key, preserves unrelated bindings and has marker/expiry checks and an explicit restore.
A missing marker after reboot restores only its own binding on the next HOME press; that first press may only restore the binding,
so a second press is needed to show LG. An external timed restore must also be started with a trial-specific marker when testing live.
The configuration lock is volatile so it cannot block recovery across reboot. No boot hook is installed by these files or by packaging.

### Interactive HOME experiment from a PC

The user reports that previous HOME attempts did not work. A prepared script is **not evidence of a working HOME replacement**.
`webos4/test-home.py` is a separate, manual experiment driver. On Windows, double-click `webos4/Probar-HOME.cmd`, or run:

```sh
python webos4/test-home.py
```

Use `--list` for the offline plan. The PC needs Python 3 and Paramiko (`python -m pip install paramiko` if missing).
The driver asks for the address and password; neither is saved in the repository or result. SSH must already trust the TV's host key;
an unknown or changed key is refused. It checks the installed launcher and existing HOME assignment, asks the user to verify native
LG HOME/Live TV/HDMI 1, and requires typing `PROBAR` before copying files or changing the TV. An occupied HOME key is never replaced.
It also refuses an already mounted `KeyFilters/systemUi.js` patch or an earlier CleanYourTV HOME boot script. The local QML/mount
experiments are not used, removed or replaced by this runner; layering them would invalidate the comparison and LG recovery claim.
It uses a fresh directory under `/media/developer/cleanyourtv/home-lab-<session>`, preserving the installed page, helper and earlier scripts.

If the helper is stopped after boot, starting it requires a separate prompt and exact checks of the previously validated helper hash
and `run_helper.sh` contents. Unknown or modified files are refused. It does not install a runtime or configure automatic startup.
An already available helper is left running. No source-switching code, updater, boot script, system service or debloat is changed.

The finite diagnostic matrix is:

| Variant  | HOME action                                           | What it distinguishes                                                  |
| -------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `probe`  | Record only; no app launch                            | Whether key 773 actually reaches the hook's executable binding         |
| `plain`  | Private Luna bus, launcher id only                    | Normal Application Manager activation                                  |
| `recent` | Private bus, LG `recent` recipe, with the launcher id | Activation-reason behavior for this launcher; still an experiment      |
| `public` | `luna-send-pub`, launcher id only                     | Public-bus permissions/activation; skipped if the executable is absent |

Every activation targets **only `com.cleanyourtv.webos4`**. These are bounded candidate methods, not every conceivable firmware change.
The public [Application Manager API](https://webostv.developer.lge.com/develop/references/application-manager) documents the id launch.
The hook's [usage documentation](https://github.com/Simon34545/lginputhook#how-to-use) describes executable bindings and live reload.
Neither documentation proves the candidates work on this TV. The experiment must distinguish hook delivery, an accepted Luna reply,
the visible launcher and usable native picture; none substitutes for the others.

For each variant, the driver waits for a TV-side readiness record before saying **LISTO**. Only then press HOME. The diagnostic phase
normally suppresses HOME without opening anything. For activation variants, test HOME from Live TV/HDMI 1, repeat HOME while the launcher
is visible, play YouTube and return with HOME, then open Live TV once and change with Input to HDMI 1. Observe image, sound and remote.
The run lasts **at most 120 seconds**, so incomplete checks must be reported as incomplete, not passed. Return a written observation;
the script records invocation counts and restricted Luna outcomes, not an automatic visual pass. If there were no hook invocations in
the diagnostic phase, it stops rather than trying more launch recipes. A black-picture report or failed LG/source recovery also stops it.

The TV's system Node runs `home-lab.js` under `nohup`, with its own timer armed **before** assigning HOME. It restores only its own binding
at the deadline even if the PC/SSH disappears. Ctrl+C, input EOF or a normal driver error also attempts immediate restore. No activation
is retried; simultaneous/rapid presses are suppressed. Each new variant requires another confirmation and restored LG HOME/source checks.
The driver leaves a twelve-second settling gap after restoration; a previously sent Luna request cannot be withdrawn.

Restoration returns ownership of the button to LG; it does not forcibly open an unidentified LG Home app. Press HOME to check LG.
A reboot or killed guardian is a separate failure mode: the persistent handler checks expiry and its volatile marker on the next press,
removes its own binding, and may need a **second press** to show LG. No script can guarantee timed recovery while the TV is off, hung,
or its storage cannot be written. Do not power-cycle as an unattended test strategy.

Reports are saved under ignored `dist/webos4/home-test-<session>.json`, including observations, per-run undo commands and restricted events.
The TV also retains `events.jsonl` and `guardian.log` in that session's directory. Review free-text observations before sharing reports.
To restore early over SSH, use the exact `undo` command from the report (`node <session-directory>/home-lab.js restore <run-id>`).
Do not delete session tools while a binding points to them. The helper is deliberately left active after the experiment.

Before the first physical run below, the trial had only local verification. The TV did not respond to SSH during preparation;
the later preflight established its state before the temporary binding was applied. No permanent HOME configuration was installed.
Local verification includes 476 checks on Node 8/22 and Chromium 68/79. A separate Linux x64 Node 0.12.2 smoke test exercised hook
recording, the autonomous deadline, restore and reboot-marker recovery. That is compatibility evidence, not an ARM/physical TV test.

#### First physical HOME diagnostic, 26 October 2026

The driver was subsequently deployed and its `probe` variant exercised on the TV's actual Node 0.12.2. Preflight found empty bindings,
no mounted QML HOME patch and no CleanYourTV HOME boot script. An existing debloat boot script was observed but not created, changed
or evaluated by this experiment. The validated helper files matched their hashes and the manual helper was started; no boot changes.
The user confirmed native LG HOME, Live TV and HDMI 1 worked before testing.

The guardian reported `ready`; the user pressed HOME and saw LG. The trial recorded **zero handler invocations**. The hook log recorded
configuration reloads on assignment/restoration. This rules out treating any launcher-activation variant as tested; it does not yet
isolate whether the failure is key delivery, the installed hook path or execution before the handler's counter.

The driver restored early and stopped as designed rather than trying `plain`, `recent` or `public`. Bindings were independently checked
as `{}`, the guardian lock was gone, and the helper remained available with launching enabled. The user again confirmed LG HOME and both
native pictures worked. No trial activation was sent. Early recovery was physically confirmed; the two-minute autonomous deadline was
not awaited on the TV. The report is `dist/webos4/home-test-1793040838351-d452cbca.json`; session tools/logs remain for diagnosis.
Next investigate the missing handler invocation before enabling further launch variants or persistent HOME.

#### Direct HOME observation after the failed hook diagnostic

A follow-up bounded capture saw HOME down as Linux key 773 on `/dev/input/event1` (`LGE RCU`), while the hook's interception log
still showed no key calls. Running the exact probe handler over SSH incremented its counter once; the later physical HOME opened LG
and did not increment it. The temporary assignment was removed again. This distinguishes a working handler from the installed hook's
missing physical delivery; the precise firmware input route has not been isolated.

`python webos4/test-home.py --observe` now offers a separate **two-minute experiment**, reusing the trial guardian and single-launch
code. It reads the verified device without grabbing or rewriting events and never changes `keybinds.json`. The driver refuses a
different device name or another HOME modification. Native LG still receives HOME; one launcher-id activation is scheduled 300 ms
later, with the normal ten-second Luna wait and no automatic retry, window cleanup or source changes. LG's overlay may remain visible;
only a physical test can establish whether this is a usable HOME experience.

Readiness requires the input device to be open. Only HOME down triggers activation; releases, held-key repeats and other keys are
ignored, as are rapid overlapping requests. Stop/deadline cancels pending activations, closes the reader and leaves LG's original
bindings intact. The process is temporary and has no startup installation. The original hook-based matrix still stops after a zero-hit
probe; `--observe` is an explicit separate mode, not an automatic fallback or second launch request.

Local tests cover fragmented input frames, the deadline, device failure, stopped callbacks, conflicting bindings, unchanged keys and
one-launch behavior. All 488 checks pass on Node 8/22 with types/lint/formatting; Chromium 68/79 checks also passed during this work.
A Node 0.12.2 smoke test exercised the observer path, fragmented frames, one launch and clean stop.

**Physical observer result: failed as a HOME replacement.** Two physical presses were recorded and each sent one accepted activation.
The user saw both LG and CleanYourTV, with roughly three seconds before CleanYourTV appeared. The observer deliberately did not
consume the original HOME event, so LG's action was still possible. The TV's original `KeyFilters/systemUi.js` calls `global.goHome()`
on a short HOME release. A passive reader cannot prevent that native action. The exact installed-hook delivery failure remains unresolved.

The observer was stopped early. Its state is `restored`, its guardian lock is gone and `keybinds.json` stayed `{}` throughout.
The helper remains active. The user confirmed LG HOME, Live TV and HDMI 1 still work after stopping. Report:
`dist/webos4/home-test-1793041807507-222828b2.json`. No YouTube → HOME → Live TV → HDMI acceptance sequence was completed with this
observer: the overlay failure already invalidated it. The two-minute TV deadline was not awaited; do not claim physical timed recovery.

A later read-only capture asked the user to choose CleanYourTV's icon from LG. They reported that only LG remained. The filtered Luna
trace contained catalogue database writes, not an identifiable activation call. It does not establish a replacement payload or prove
that LG's normal path succeeded. The installed app/launch point were still registered. Both bounded capture processes finished.

Do not enable the passive observer as permanent HOME, change the validated source payloads, or introduce a delayed close/hide to
compensate for LG's overlay. A future solution must suppress the native HOME action at a verified interception point; that mechanism
has not been implemented or tested here. No injection, compositor restart, QML mount, boot edit, firmware change or debloat change
was performed in this follow-up.

#### Native input filter prototype (not yet enabled)

Read-only descriptor inspection confirmed that LG's compositor reads the verified RCU event device. `webos4/home-input.c` is an
independent MIT implementation of a bounded evdev/uinput diagnostic, using the documented Linux
[uinput interface](https://docs.kernel.org/input/uinput.html). It neither injects a library nor changes LG code.
The passive observer is not used concurrently.

Build on Linux with an ARM soft-float cross compiler installed:

```sh
sh webos4/build-home-input.sh
```

This produces a separate static `dist/webos4/home-input-arm` and checksum. It is not installed by the IPK or enabled by the normal
helper bundle. The manual bundle includes the source, build script and `home-input-trial.sh`, not the binary or a boot hook.
Keep the binary as `home-input` beside the controller in a fresh, dedicated trial directory. No system Node/runtime is replaced.

The native diagnostic modes are deliberately separate:

| Mode            | Effect                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `--self-test`   | No TV device access; checks HOME filtering, unchanged other key states and invalid/lost streams        |
| `--probe`       | Read-only device/capability/compositor inspection; no virtual device or exclusive grab                 |
| `--check`       | Temporarily creates a replacement input and waits for LG to open it; no grab and no emitted key events |
| `--filter-only` | Only after LG opens the replacement: temporarily forwards other keys and removes HOME down/repeat/up   |

The error record includes `proxyResolved`: at `wait-for-lg-consumer`, `false` means replacement-path discovery did not succeed;
`true` means the path was found but compositor acceptance was not confirmed. `errno` can be left by an earlier failed descriptor
lookup, so it alone does not identify the cause of a consumer timeout. No input grab is allowed without consumer confirmation.

`--filter-only` **does not launch CleanYourTV**. Its initial acceptance question is whether HOME can be suppressed while other remote
keys still reach LG. A lost stream, unsupported device/capability, held key at setup, failed write or missing replacement consumer aborts
the attempt. The program tracks forwarded held keys and releases them during normal cleanup. A native monotonic deadline and alarm
stop it after 120 seconds. An independent controller watchdog kills only that exact executable/PID/start-time at 125 seconds as a
backstop, releasing the kernel grab on process exit. No persistent HOME assignment is written.

After explicit approval for this new routing trial, run `sh <trial-directory>/home-input-trial.sh check` first. Only if that succeeds,
run its `start` command. The controller reports **READY** only after the native process has acquired the replacement and enabled the
filter. Do not press remote keys during setup. Verify HOME no longer opens LG, then arrows/OK/Back, Input, volume and channel/numeric
keys. Stop immediately if any control fails. Undo is `sh <trial-directory>/home-input-trial.sh stop`; `status` reports the owned process
and bounded log. Each directory permits one start, avoiding replacement of an uncertain PID record. No app launch, source handoff,
firmware mount, compositor/service restart or boot change occurs in this diagnostic.

The ARM binary passed its self-test and read-only probe on the actual TV: 16-byte native input events, extended key codes through 1279,
and an identified compositor reader. This does **not** validate the virtual replacement or exclusive routing. `check` and the physical
filter trial remain approval-gated; the ordinary HOME/source baseline is unchanged.
All 498 local checks pass on Node 8/22, including native compilation/self-checks and refusal to signal an unrelated PID, with
types/lint/formatting and package builds. Subsequently SSH stopped responding, including a later port check. The cause/power state
was not established. Controller upload did not begin because connection failed; it remains prepared locally. No native filter or
virtual-device check was active. Restore access and verify the physical baseline before any new trial.

### Manual HOME patch from the PC (apply, status, revert)

On 27 October 2026 the patched `KeyFilters/systemUi.js` (HOME opens `com.cleanyourtv.webos4`, or LG's Home when it is already the
foreground app) worked on the test TV: HOME opened CleanYourTV, no LG overlay appeared, and the YouTube → HOME → Live TV → Input → HDMI 1
sequence passed. The compositor loads that file once at start, so the patch is a volatile `mount --bind` plus `initctl restart surface-manager`;
no boot hook is installed and a TV reboot always restores LG's Home. The earlier input-device filter cannot work (LG's `LGE RCU` is a virtual
device created by `tvservice`, and `surface-manager` never opens devices created after it starts).

`webos4/home-patch.py` (shortcuts `Estado-HOME.cmd`, `Aplicar-HOME.cmd`, `Revertir-HOME.cmd`) drives it over SSH with a key, no password;
pass `--host <tv-ip>` or set `CYTV_TV_HOST`, and `--key` if it is not `~/.ssh/id_tv_webos`. It asks before every step (`--yes` skips the questions).

| Command  | What it does                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` | Read-only: which `systemUi.js` is live (LG's or the patch), mounts, `keybinds.json`, helper, backup copies                                                                                                       |
| `backup` | Verified copy of LG's original file in `dist/webos4/backup/` and in `/media/developer/cleanyourtv/backup/` on the TV                                                                                             |
| `apply`  | Refuses unless the file is LG's original, nothing is mounted and `keybinds.json` is `{}`; backs up, mounts the patch (hash-checked), starts the helper, closes LG's own apps one by one, restarts the compositor |
| `revert` | Unmounts, checks that LG's original is back, restarts the compositor (`--reboot` restarts the whole TV instead)                                                                                                  |

Known risk: a compositor restart with apps open once left Live TV black until a full reboot (cause not isolated; the debloat boot hook was
tested and ruled out). `revert --reboot` or a physical reboot is the way out. Not done yet: automatic patching at boot, and repeating the
apply/revert cycle over several days.

On 29 October the user explicitly authorized this same manual procedure again. The original file and empty bindings passed preflight;
backup and mounted patch hashes matched, the existing helper started, and the listed native apps were closed before the compositor
restart. The new compositor was running and the helper returned 25 apps afterward. Physical HOME/picture confirmation is pending.
No HOME/helper boot entry was added. The user already validated the general source flow and requested no further repetitions of it.
The previous debloat was separately reenabled with permission and verified; the Netflix observer also passed an actual boot check.

The user then confirmed that HDMI picture/sound work and HOME opens CleanYourTV without LG superimposed.
**Installed with explicit authorization on 29 October**: `home-startup.sh`, the guarded replacement `10-cleanyourtv-home` and the same validated
`systemUi.patched.js`. The intended private directory is `/var/lib/webosbrew/cleanyourtv-home/`, with the patch named `systemUi.js`.
The boot entry starts the existing isolated helper, waits for its API, verifies original/patch/helper hashes and empty hook bindings,
then performs the established native-app closure and compositor restart once. If the known patch is already mounted it reuses it,
so installation in the current working session does not restart graphics again. Unrelated files/mounts and conflicting hooks are refused.
No input injection or source activation payload changes are added. The boot entry records its output privately in `startup.log`.
A graphics restart error disables future attempts and unmounts the patch; uncertain closes are not retried. A successful restart
still needs physical confirmation of usable picture, as in the manual procedure. There is no automatic restart of a dead helper.
Undo HOME **and helper startup** with `sh /var/lib/webosbrew/cleanyourtv-home/home-startup.sh disable`, then power off/on to reload LG.
The disable marker prevents that boot entry from acting; it does not kill processes or restart graphics. The helper can remain in the
current session until the physical power cycle. The normal webOS 5+ installer/updater does not install this separate TV-specific boot path.
The installed hashes and native shell syntax match the reviewed files; `run-parts --test` selects this entry and status reports
`boot-enabled`. At installation the TV was back on LG's original file with the helper stopped, so the new boot script was not run
immediately and graphics were not restarted. The user was asked for one power cycle and picture/audio confirmation after three minutes.
Automatic HOME/helper startup and its physical result are still pending that check. All 605 local checks passed on Node 8/22,
with types/lint/formatting and Chromium 68/79 checks; those checks alone do not prove native video on the TV.

The subsequent physical boot succeeded: the log reported `HOME patch loaded; helper ready`, the mounted patch matched,
the helper answered, and the user confirmed picture and sound. The user then reported that a second HOME press while in
CleanYourTV superimposes LG, and Back from the main page also opens LG. These follow directly from the previous patch's
`global.goHome()` branch and the page's `platformBack()` call; they do not mean that automatic startup failed.

**Installed with explicit approval, physical result pending:** HOME is consumed while CleanYourTV is already foreground. When opening it from another
app/source, the native activation carries only that origin's app id in `params.cytvPreviousAppId`. The page reads the initial
launch parameters and later `webOSLaunch`/`webOSRelaunch` events. At the user's request, Back from its main page sends one
activation of the origin through the unchanged isolated helper; app/input panels consume Back themselves. Held Back and
uncertain requests do not retry. The launcher stays alive; no delayed hide/close, direct-bridge activation or source payload change
is added. Invalid, missing and self-referential origins cause no launch and explain that HOME must supply an origin first.
Opening the app directly from its icon cannot establish a prior app by itself. This uses LG's documented
[launch parameters and lifecycle events](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management), with
`handlesRelaunch` left at its default so the platform continues activating the page automatically.
The boot controller recognizes the previous mounted patch during migration/undo while requiring the new file for future startup.
An update must replace files atomically, preserving the currently mounted inode until a physical power cycle loads the new version.
Private local pre-update copies are under ignored `dist/webos4/home-back-before-20261029/`; verified TV backups and a restoration
script are in `/var/lib/webosbrew/cleanyourtv-home/backup-home-back/`. The three new files were installed by rename without
restarting graphics: the live mount still has the previous hash and the new controller reports `legacy-patch-mounted` correctly.
Actual HOME/Back behavior with parameters is still untested on the TV. The user was asked to power-cycle, wait three minutes,
then try HOME → HOME → Back from a source/app. Restore the prior files with
`sh /var/lib/webosbrew/cleanyourtv-home/backup-home-back/restore.sh`, then power off/on. All 621 local checks passed.

The user subsequently confirmed the corrected HOME/Back behavior, but reported a black first opening recovered by Back to HDMI 1
and opening HOME again. The new boot and patch were verified. The first activation began at 92.808 s of uptime and reached the
foreground at 94.442 s; Back returned to HDMI at 103.992 s. Later activations reached the foreground in roughly 33–61 ms.
Read-only inspection of the same page reported DOMContentLoaded in 858 ms and load in 995 ms, with 25 apps loaded and a valid
captured origin. It did not expose a usable first-paint measurement. This suggests an initial presentation issue, without proving
its cause or excluding a delayed asynchronous catalogue response. A prolonged black page requiring Back is an **unresolved issue**,
separate from the expected brief boot graphics restart. No further TV modifications or restarts were made for this inspection.

The user wants the last source on power-on, with CleanYourTV only on HOME. In a subsequent boot the log showed native Home before
our late hook and two HDMI last-input activations around the native-app closures/graphics restart, with **no CleanYourTV launch**.
That startup cut is caused by the current patch-loading method; simply omitting the compositor restart would leave the late-mounted
JS inactive. This is distinct from the earlier black first opening of the launcher itself.
Changing only `general.homeAutoLaunch` to `off` did not persist: it returned to `on` after a later boot. Inspection of LG's own
Settings toggle showed that it also writes `checkHomeAutoLaunchValue: "user"`. In the native inputcommon QML,
`SettingPropertyService.qml` permits server updates only while this marker is `default`; `HomeAutoLaunchModel.qml` then applies
the server's `auto_home_launch` value. Marking the choice as `user` blocks this overwrite.

With the owner's standing authorization for reversible debugging, both values were saved together as `off/user`. The original
`on/default` pair and candidate are private JSON files under
`/var/lib/webosbrew/cleanyourtv-home/home-autolaunch-user-20261029/`. After an announced software reboot, API and filtered-cache
readbacks retained `off/user` beyond 14 minutes; both last-input ids remained HDMI 1 and HOME/helper were ready. Restore through
`settingsservice/setSystemSettings` with `{"category":"general","settings":{"homeAutoLaunch":"on","checkHomeAutoLaunchValue":"default"}}`.
The user then performed another restart and confirmed that LG Home no longer appeared, while HDMI 1 still suffered the later black
cut. The power-on method of that user restart was not specified. Readback at 97.45 s retained `off/user`, both last-input ids remained
HDMI 1, and HOME/helper plus Bluetooth were running. Earlier native Home visibility logs therefore did not establish a drawn menu.
The graphics-restart cut remains a known limitation: the native compositor starts before the Homebrew hook (`minimal-boot-done`),
and the inspected compositor API exposes no key-filter reload method. No safe earlier activation path has been validated.
No firmware, Upstart or Homebrew startup file was modified.

### HOME without a compositor restart

Further read-only inspection found the missing reload path in the compositor's embedded QML: it subscribes to configd, assigns
`com.webos.surfacemanager.keyFilters`, and calls `loadKeyFilters` when that array changes. A direct compositor reload API is not needed.
A bounded TV trial changed only the four `systemUi.js` file paths in the captured twelve-handler array. The trial file added one
read-only configuration query to its initializer. Bus capture recorded that query from `com.webos.starfish.keyfilters`, proving
that the new file executed. The compositor PID stayed unchanged and HDMI 1 remained foreground. A thirty-second guard restored
the original array automatically; this does not alone prove uninterrupted physical picture or sound.

The revised `webos4/home-startup.sh` uses `keyfilters-original.json` and `keyfilters-cleanyourtv.json` with pinned hashes. It refuses
unknown arrays, order changes or extra policy fields, preserves all twelve handlers and waits for the existing helper. It binds the
same verified patch in RAM, then toggles only four paths between `/usr/lib/qt5/qml/KeyFilters/systemUi.js` and
`/usr/lib/qt5/qml/KeyFilters/./systemUi.js` to trigger the native reload. Both spellings resolve to LG's original file on a boot without
the RAM mount, preserving the Homebrew failsafe fallback. No private file path remains in the persisted filter configuration.
It never closes native apps, activates a source or restarts graphics. Repeated starts reuse a known active mount; each fresh boot
toggles once. Failed/uncertain writes are not retried: the mount is removed and the next boot disabled. Neither native JS nor the
original handler order is changed on disk.

Reversal is `sh /var/lib/webosbrew/cleanyourtv-home/home-startup.sh disable`: it removes only the known RAM mount, toggles the native
path spelling to reload LG's original JS, and disables the helper boot entry, leaving the running helper alone. No graphics restart
is required. Either known path array has the same LG behavior without the mount.
A second bounded TV trial used the dot spelling with an instrumented RAM mount; the initializer's read-only marker query was
observed again, proving a fresh file read through this exact route. Its guard removed the extra trial mount and restored the array.
All **641 checks** passed on Node 8/22, with types/lint/formatting and Chromium 68/79 checks. Native Node 0.12.2 parsed and ran the
new status/start/disable paths. The controller and templates are installed, with the previous controller saved privately under
`/var/lib/webosbrew/cleanyourtv-home/reload-before-20261029/`. A live disable/start restored and reinstalled the RAM patch, retaining
the same compositor PID and HDMI foreground. After the announced test reboot, at 91.21 s the compositor was still the initial
PID 1059 (start tick 207), with no kernel report of a compositor kill/restart. The new boot log reports `no graphics restart`;
the helper serves 25 apps, `off/user` persists, and the Homebrew failsafe flag cleared. Debloat's two stubs/remotelogger and the
shutdown fix remain active, as does the Netflix observer. Bluetooth recorded `accepted` and the configured device had A2DP connected,
providing the first real acceptance result for the robust module. The user subsequently confirmed that the reload maintained HDMI
picture and sound without a cut, saying everything was working perfectly at 100%. The session is accepted as complete, including
the previously confirmed HOME/Back behavior; no broad source-switching sequence was repeated. This validates the tested TV and
flows, not every model or untested power/input scenario. Preserve this working configuration and its backups.
The older restart-based procedure above is historical.

### Native-source recovery and launch lifecycle

During validation, YouTube was foreground and the user reported Live TV failing again; Input opened LG's selector but both native
sources were black. A recovery reboot was performed under the existing explicit permission. HOME bindings were still empty and the
helper's previously verified LG activation recipe was unchanged. The user confirmed both native sources recovered after reboot.

The page's old delayed `window.close()` could remain queued while hidden and close it on reactivation. That scheduling was removed.
The page also used a 2.5-second XHR timeout followed by a direct bridge fallback, which could duplicate an activation whose first request
was still pending. It now waits up to ten seconds and reports error/timeout without automatically issuing another launch.
App switching goes only through the existing helper; all captured LG source payloads remain unchanged. These changes eliminate races;
they do not prove the unique cause of the physical black video. Both changes were subsequently deployed after the native-source
baseline was confirmed, without closing any app. The helper was started manually and the launcher opened; the live Chromium 53 page
confirmed 25 apps, no close code, no direct bridge fallback and the ten-second timeout. The user confirmed the first Live TV/HDMI 1
cycle works with this version. The user then confirmed the YouTube playback → launcher → Live TV → HDMI 1 transition also works.
The current local suite has 450 checks including the temporary HOME controller's recovery tests.

## Native source activation

The Live TV activation fix has been restored after subsequent local edits: source launches no longer close all other inputs first.
Live TV uses the captured LG `recent` request, and HDMI uses an id-only request. The earlier direct HDMI bridge fallback has since been removed.
The current page remains alive after a successful launch; earlier experiments that closed it after a reply are superseded by the contract above.
Regression tests cover these sequences; all 415 checks passed on Node 8.12 and Node 22, with types, lint, formatting and generated pages.
The earlier TV confirmations below describe the previous interface; the revised interface was subsequently tested as follows.
The first trial after restoring the fix still showed both sources black. The user explicitly approved a recovery reboot;
SSH returned and the helper remained stopped. The user confirmed both native sources recovered. The corrected helper was then
started manually and CleanYourTV opened. The user confirmed that Live TV from its tile and returning to HDMI 1 with Input both work.
The helper remains active. This verifies the revised interface after reboot; applying the patch alone did not recover already-black video.

The web app lists visible installed applications and, when explicitly enabled, opens a selected app. The helper reuses
CleanYourTV's `apps`, `luna`, HTTP server and diagnostics. It never calls feature `start()` methods, reads the official
configuration, loads the manager, or schedules updates. It writes only its own PID, diagnostics and log in `webos4/state/`.

| Feature                                                                      | Prototype                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| App list and Refresh                                                         | Verified on the TV: 25 visible apps; successful HTTP replies                                                       |
| Arrows, OK and Back                                                          | Confirmed by the user with the physical remote; arrows/OK also exercised through the TV's inspector                |
| Manual app launch                                                            | Verified: the browser opened from a tile with `--allow-launch`                                                     |
| Chromium 53 layout                                                           | Verified at 1920×1080, including five columns with a scrollbar and scrolling to the last tile                      |
| Native Back                                                                  | Uses LG's default history handling; user confirmed the physical button works                                       |
| Native LG Live TV app                                                        | Verified from its tile using LG's captured activation request; video and remote numbers work                       |
| Returning to HDMI 1                                                          | Verified with LG Input after opening Live TV from the prototype; no custom Inputs list yet                         |
| Icons, favourites and Inputs layout                                          | Original app icons, seven favourites and existing input shortcuts are displayed; UI navigation verified on the TV  |
| Native LG Settings shortcut                                                  | User confirmed the panel opens from CleanYourTV and physical Back closes it; LG marks this installed app as hidden |
| Themes and additional settings                                               | Deferred                                                                                                           |
| HOME/INPUT hooks, boot startup, debloat, IPTV, voice, notifications, updates | Unavailable                                                                                                        |

## Build on the computer

```sh
node tools/test.js webos4
sh tools/check.sh
python3 webos4/build.py
```

The output is in `dist/webos4/`:

- `com.cleanyourtv.webos4_0.2.0_all.ipk`: a visible `type: web` application, with no bundled service registration.
- `cleanyourtv-webos4-0.2.0.tgz`: only the helper dependencies, manual service script, licence and this guide.
- A SHA-256 file for each artifact. No Node binary, third-party libraries, credentials or TV addresses are bundled.

Edit `webos4/src/`, then run `node tools/build-pages.js`. The smaller page preserves the original launcher's colours and typography;
it avoids loading the original launcher's Live TV, theme and settings controls.

## Manual TV test (requires approval before changing the TV)

Do not run `install.sh`, `bootstrap.sh`, the manager setup or the original boot scripts on webOS 4.
Check root, free disk space, the isolated runtime and port 8765 before copying anything. If another service owns the port, leave it
running and stop this test. The prototype fails to bind rather than stopping an existing process.

After reviewing and approving a manual test:

1. Extract the helper bundle **only** into `/media/developer/cleanyourtv-webos4/`. Keep its `helper/` and `webos4/` directories together.
2. Copy the **previously verified** Node 18.17.1 ARMv7 binary into `webos4/runtime/node18` and its **complete** `lib/` directory into
   `webos4/runtime/lib/`. Preserve executable permissions and library symlinks. This project does not download or install a runtime.
   Do not replace the system Node or create links under `/lib` or `/usr`.
3. Start the helper in the foreground over SSH:

   ```sh
   sh /media/developer/cleanyourtv-webos4/webos4/service.sh run
   ```

   This is read-only with respect to TV settings and apps. It creates its own state/log files. In another SSH session:

   ```sh
   curl -fsS http://127.0.0.1:8765/api/version
   curl -fsS http://127.0.0.1:8765/api/service
   curl -fsS http://127.0.0.1:8765/api/apps
   ```

4. Install the standalone IPK using the TV's normal package installer, after approving that installation. Confirm all of:
   installation `statusValue: 30`, `getAppLoadStatus.exist: true`, `getAppInfo.returnValue: true`, and a successful manual launch.
   An installation success alone is insufficient. The uninstall target is **only** `com.cleanyourtv.webos4` in that same installer.
5. Open **CleanYourTV webOS 4 (test)**. Check the list, scrolling, Refresh, pointer and arrows. For the app-opening test, stop this
   helper and restart it with the explicit launch switch:

   ```sh
   sh /media/developer/cleanyourtv-webos4/webos4/service.sh stop
   sh /media/developer/cleanyourtv-webos4/webos4/service.sh run --allow-launch
   ```

   Refresh the page, select an app and press OK. Confirm the app opens and native Back returns to LG.

6. Stop only this helper with Ctrl+C in its foreground session, or from another session:

   ```sh
   sh /media/developer/cleanyourtv-webos4/webos4/service.sh stop
   ```

   The stop script validates the saved PID against the exact helper path in `/proc/<pid>/cmdline`; it refuses another process or a stale
   PID. It never kills by process name. `service.sh status` checks the same identity. Logs stay in `webos4/state/helper.log`.
   To undo the test, stop this helper and uninstall only `com.cleanyourtv.webos4`. The isolated directory may be retained for diagnosis;
   there are no boot hooks or HOME changes to undo. Do not run the normal project's uninstaller for this prototype.

For a different state location, set the absolute `CYTV_WEBOS4_DIR` consistently for run, stop and status. `CYTV_DIR` and `CYTV_RUNFILE`
inherited from a regular installation are overridden by the standalone entry point. The default runtime location is fixed beside
`service.sh`, so it never depends on PATH or the system Node version.

After a successful foreground test, the same manual helper can be kept running when SSH closes:

```sh
nohup sh /media/developer/cleanyourtv-webos4/webos4/service.sh run --allow-launch </dev/null >/dev/null 2>&1 &
```

Use `service.sh status` to check it and `service.sh stop` to stop only its matching PID. This adds no boot startup. After a reboot,
or when the helper is explicitly stopped, the web app can still draw its cached page and handle keys, but Refresh and app launches
cannot reach the TV API and show **Helper unavailable**. Start the isolated helper and select Refresh to recover; reinstalling the
app or changing HOME is unnecessary.

## API and boundaries

The helper binds only `127.0.0.1:8765`. Reads: `GET /api/version`, `/api/service`, `/api/apps`. Optional mutation:
`POST /api/launch {"id":"<listed-app-id>"}`; arbitrary launch parameters are discarded. Fixed native source ids and
`com.palm.app.settings` are also allowed when launch mode is enabled, even if absent from the visible list.
For native `com.webos.app.livetv`, the standalone
helper uses the activation request observed from LG: top-level `reason: "recent"`, `params: {reason: "recent"}`,
`checkUpdateOnLaunch: false` and `autoInstallation: false`. This is specific to the prototype; the normal helper is unchanged.
Other routes are unavailable and wrong methods
receive 405. Read-only mode returns 403 for launch. Nothing starts automatically after reboot.

Allowed origins are absent (local tools), `null` (opaque local web-app origins), and exactly
`file://com.cleanyourtv.webos4` (observed on Chromium 53 POST requests) or `file://com.cleanyourtv.webos4-webos`.
HTTP(S) origins and other named file origins are rejected. As in the regular helper, accepting
`null` cannot distinguish this app from another opaque local origin. Verify the actual Origin on the TV before expanding this policy;
do not allow arbitrary web origins or bind to a LAN interface.

## Validation record

Local regression tests use a stand-in Luna API to cover discovery, manual launch, read-only enforcement, origin checks, invalid requests,
startup isolation, occupied-port failure, stopping only the saved helper, and package contents. The original API golden replies are kept.
Page scripts are parsed as ES5 by the normal checks. A local browser cannot prove the LG-specific application manager or remote works.

Local checks completed: the full suite on Node 8.12.0 and Node 22, type/lint/format checks, unchanged original API golden replies,
and all four pages in Chromium 68 and 79 (`node tools/oldchrome.js`). The standalone page's 1920×1080 screenshot was visually inspected.
Both the normal package and the standalone package build; the standalone build also runs directly on Windows. These desktop engines
are regression evidence; the separate TV checks below establish what was actually exercised on Chromium 53.

### Real TV test, 25 October 2026

- Confirmed SDK 4.4.0, Chromium 53.0.2785.34, 1920×1080, and Node 18.17.1 through the isolated loader and libraries.
- Verified both artifact hashes on the TV, package registration (`getAppLoadStatus.exist` and `getAppInfo.returnValue`), and foreground
  launch of the standalone web app. The initial install reply was an acknowledgement, not a captured `statusValue: 30` event.
- Read-only helper returned its version, service mode and 25 visible apps without loading official settings. Read-only launch and an
  HTTP(S) web origin both received 403. Stopping and restarting the isolated helper worked.
- Inspected the live DOM, successful app-list/Refresh HTTP responses and actual TV screenshots. Grid was unavailable and Flexbox
  available in this engine, as expected. Browser key events navigated to tile 24 and scrolled it into view; OK respected read-only mode.
- Found and fixed two device-specific failures: a visible scrollbar wrapped the grid into four columns, and POST requests used the
  exact file origin without `-webos`. Confirmed five columns and an app launch after fixing both. The browser became the foreground app
  after selection and OK in the prototype. No arbitrary external web origin was permitted.
- Windows-created checksum files originally contained CRLF; the builder now writes ASCII bytes with LF. Verified the regenerated
  checksum files directly with the TV's `sha256sum -c`.

Back remains controlled by LG's default History API behavior. On webOS 5 and earlier, native Back at the entry page shows LG's Home
launcher; this can be an overlay, so a foreground-app query alone does not prove the visible result. See LG's
[Back Button guide](https://webostv.developer.lge.com/develop/guides/back-button). Inspector-generated Back did not reach the page's
keydown listener under the default history setting. The user subsequently confirmed that arrows, OK and Back work with the physical remote.

The user then reported a black screen after selecting the **native LG Live TV app** (`com.webos.app.livetv`), not CleanYourTV's IPTV player.
At diagnosis time, the helper still answered HTTP, the page reported `busy: false` and a successful launch, LG listed Live TV as the
foreground app, and a native TV media pipeline was active. The scoped system log recorded a normal fullscreen transition without a
matching crash. The stock Live TV launch point also had empty parameters, matching the prototype's request. None of these observations
proves that video worked. The user clarified that the screen was black and the remote keys still worked. The cause of the black screen
was unresolved at this stage; the comparison with LG's own launcher is recorded below.
Launching the original HDMI 1 app restored that foreground app without restarting the TV or services. Do not replace HOME or call the
port ready until this report has been explained and the affected flow has been retested.
At the end of this test, the isolated helper was stopped and only the standalone prototype window was closed. HDMI 1 remained the
foreground app. The separate prototype package is still installed; its helper files were retained in the temporary test directory for
diagnosis, without any boot startup.

On follow-up, the user returned to the prototype and saw **Helper unavailable**. SSH confirmed that port 8765 was free and the helper
was stopped, as left at the end of the previous test. Restarting the isolated helper with `nohup` restored successful service/app-list
HTTP replies and **25 apps · Ready**. Refresh was also exercised through its button with OK in the TV's inspector. This availability
failure was caused by stopping the manual backend, not by the native Live TV launch. The helper is now left running for further manual
tests; boot startup remains absent. The signal-query methods tried did not accept the supplied arguments, so they establish nothing
about antenna reception or video health.

The user subsequently confirmed that channels had worked before testing and that HDMI 1 had also gone black. Closing the standalone
window did not restore native Live TV; the input-hook keybind file was empty. With explicit approval, Live TV was closed/reopened through
the app manager; its process and stale media pipeline remained, and the user still saw black video. With separate explicit approval, a
full TV reboot was performed. The user confirmed that **HDMI and TV channels both worked again**, and read-only SSH checks showed a new
foreground HDMI pipeline with video/audio resources. SSH and the persistent isolated Node runtime were available after reboot.

The triggering mechanism was unproven. At that stage, a temporary guard omitted native Live TV from app discovery and rejected direct
launch attempts without calling Luna. That guard was containment, not a root-cause fix; it was subsequently replaced by the observed
LG activation request described below. The prototype helper did not auto-start after reboot, and its old temporary files were cleared.
No HOME or boot hooks were added.
A fresh temporary helper with the guard was then started manually. On the TV, discovery returned **24 apps with native Live TV absent**,
and a direct native Live TV POST returned **404**. The helper's diagnostics recorded app discovery only, with no Luna launch for the
blocked request. HDMI 1 remained the foreground source with a working media pipeline. The protected helper was left running for manual
tests; the standalone window was not opened during this check. All **409 checks** passed on Node 8.12.0 and Node 22, including a new test
that first reproduced the missing guard and then verified no native launch occurs.

### Native activation fix verified on the TV

A subsequent read-only Luna trace captured the working stock transitions. LG's input picker launched HDMI 1 with only its app ID;
LG Home's recent-app entry launched Live TV with an activation reason at both the top level and inside `params`. The prototype's old
generic request had sent an empty `params` object and no activation reason.

With approval for controlled tests, the exact Live TV request from LG was replayed first over SSH, then through the prototype's actual
Node 18 `helper/luna.js` bridge while its page was closed. The user confirmed working video, remote numbers and a return to HDMI.
The standalone helper was then changed to use that same request for native Live TV, and its temporary block was removed. Other app
launches keep their existing behavior; caller-supplied parameters still cannot override the native activation request.

With separate approval, the change was applied only to the temporary helper and Live TV was opened from the prototype's tile using OK
in the actual Chromium 53 page. The trace asserted that the outgoing request payload exactly matched the captured LG request. The user
confirmed both the TV picture and the subsequent return to HDMI 1 worked. Native video/audio resources remained allocated; no reboot
or system-service restart was performed during this investigation.

All **410 checks** pass under Node 8.12.0 and Node 22, including the activation payload, ignored caller parameters, default read-only mode
and the original API golden replies. The current helper again lists **25 apps**, including native Live TV, and remains running manually
for testing. HOME, Input-key bindings and boot behavior remain unchanged.

This verifies that the current request works on the test TV; it does not isolate the cause of the earlier media-state failure. The old
request and earlier background experiments were not deliberately replayed after reboot to distinguish them, and no individual field
has been proven to cause that failure. Other firmware models remain untested.

The test used a new temporary helper directory and a separate app ID. HOME, INPUT configuration, Upstart, boot scripts, system Node
and firmware files were not changed. The older experimental Homebar helper was left running and untouched.
A full TV reboot was performed once with explicit approval to recover the earlier blackout. Prototype boot persistence, HOME replacement
and their recovery/rollback sequence have not been implemented or tested. The helper does not start itself after reboot.
