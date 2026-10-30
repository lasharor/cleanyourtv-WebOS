# webOS 4 port: status and contribution guide

This is an isolated, experimental port for the tested SDK 4.4.0 firmware, Chromium 53.0.2785.34 at 1920×1080.
It does not make the normal manager, installer, updater or every upstream feature compatible with webOS 4.
The launcher helper uses the separately verified Node 18.17.1 ARMv7 runtime and its own loader/libraries.
The system Node 0.12.2 is preserved; HOME/Bluetooth/Netflix controllers were separately smoke-tested on it.
No runtime, private configuration, device address, screenshot or full LG firmware file is distributed.

## Original installer and UI

The original entry points now accept an explicit `--webos4` branch for SDK 4.4.0. The original UI and six upstream modules install
as `com.cleanyourtv.webos4.original` with separate state and port 8764. The user confirmed the actual UI/icons and the complete
YouTube → original candidate → native LG TV → HDMI 1 sequence, with picture, sound and remote control.
HOME still opens the accepted research launcher; the candidate does not enable persistent takeover, the regular manager or updater.
The rebase onto upstream 1.6.12 keeps its new audio subscription/volume OSD disabled in both isolated entry points; neither ships
the audio service. The candidate also blocks full power-off. The new tuner metadata query is read-only; native launches retain the
captured helper path and payloads below.

System Node 0.12.2 can install the pinned Node 18.17.1 and libraries into a private version directory. This runtime installation was
checked on the TV without replacing system Node or changing protected HOME/helper/shutdown hashes. The new kit can host the unchanged
native bridge in its own process if port 8765 is free; that fresh-install ownership mode has local tests, not another physical TV test.

Prepare the runtime on a development PC with Python 3.9+ using the pinned third-party release in `webos4/runtime-source.json`:

```sh
curl -fL --max-time 180 -o dist/stremcompat-runtime-source.ipk https://github.com/Alexesmm/stremcompat-lg-webos/releases/download/v1.3.3/StremCompat-webOS4-UM4-armv7-graphics-1920x1080-1.2.29.ipk
python3 webos4/prepare-runtime.py dist/stremcompat-runtime-source.ipk dist/webos4-runtime
python3 webos4/build-original.py --runtime dist/webos4-runtime
```

Create `dist/` first if absent. The preparer checks source IPK SHA-256, then all 14 runtime files against the pinned manifest.
It resolves archive links in memory into regular files under a new output directory; it never installs or executes StremCompat.
The downloaded release reproduced every byte of the TV-validated runtime. Source/checksums and extraction code are committed;
binary artifacts stay local under ignored `dist/`. See [runtime provenance](webos4-runtime.md) before redistributing those binaries.

Copy and extract `dist/webos4-original-trial/cleanyourtv-webos4-install-kit.tgz` into a new private directory on the rooted TV, verify
its SHA-256, then use `sh install.sh --check` for the initial inventory and `sh install.sh --webos4 install` for the separate candidate.
Manual `start|stop|status|show` actions are available; `install` stages the included runtime if absent. Another release never overwrites
an existing candidate automatically. `stop` checks process path/PID/start time and preserves its files and any external bridge.
The full investigation, backup record and action sequence are in [the installer-port record](webos4-installer-port.md).

## Current status — 30 October 2026

This table supersedes historical “pending”, “current” and test counts in the two research logs.
The logs describe different stages, sometimes out of chronological order; they are evidence, not installation instructions.
The post-rebase original UI and helper-served standalone icons are locally tested revisions; they have not replaced the earlier
physically accepted candidate. The table records the hardware observations for their original revisions.

| Area                                  | Physical evidence                                                                                                   | Limit                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Launcher, catalogue, remote, Settings | 25 real installed apps; physical arrows/OK/Back and native Settings work                                            | One firmware/resolution; cached page needs helper for launches                                                        |
| Native Live TV and HDMI 1             | YouTube → launcher → Live TV → HDMI 1 picture/audio confirmed                                                       | Earlier black video recovered by authorized reboot; unique low-level cause unresolved                                 |
| HOME filter patch                     | HOME opens only CleanYourTV; repeated HOME stays there; Back returns to the source/app of origin                    | Generated only from the known firmware hash; no general support claim                                                 |
| HOME/helper startup                   | Initial compositor retained across tested boot; 25 apps; user confirms picture/audio without the second black cut   | Legacy helper hashes/layout intentionally refuse other installations; reload needs the captured configd handler array |
| Initial LG menu                       | `general.homeAutoLaunch=off` and `checkHomeAutoLaunchValue=user` persisted; user confirms LG Home no longer appears | Settings are opt-in; keep both original values for rollback                                                           |
| Debloat                               | Upstart remotelogger stopped; acr2/admanager stubs and marked hosts observed, reenabled with approval               | Revised public scripts use a volatile hosts mount and safer undo; this revision needs physical validation             |
| Shutdown guard                        | Avoids `rm -f` on the Developer Mode directory; script reaches later stages                                         | Original/fixed A/B both measured ~12 s: cannot claim this alone fixes standby delay                                   |
| Netflix                               | Missing sole ACK makes tvpowerd exhaust 8 s; closing before poweroff removes wait (~4–5 s)                          | Disable preload only helps before manual use; closing at poweroff failed (~11.49 s)                                   |
| Netflix source-exit observer          | Close after stable native-source return removes process/power registrations; real boot verified                     | Direct poweroff inside Netflix remains outside workaround; final foreground race remains                              |
| Paired Bluetooth                      | Robust observer accepted a real boot dialog; configured device had A2DP connected; user confirms everything works   | Private per-device calibration required; unknown dialogs/pixels never authorize keys                                  |

The final research-session user acceptance was “everything is working at 100%” on this TV. The HOME reload and robust Bluetooth
modules below match those final fixes; the repository checks do not transfer that hardware claim to revised public debloat, a new
deployment layout or other TVs. The final navigation correction from 30 October is now included: Up on "All" focuses the featured
row; OK opens the library. It was checked with keyboard events in the visible, loaded TV Chromium 53 page, not a fresh physical remote test.

## Validated source-switching contract

Page launches go through one `POST /api/launch` to the loopback isolated helper, with a ten-second wait and no automatic retry or
PalmServiceBridge fallback after failure/timeout. Caller parameters are discarded. Native Live TV uses exactly:

```json
{
  "checkUpdateOnLaunch": false,
  "id": "com.webos.app.livetv",
  "reason": "recent",
  "autoInstallation": false,
  "params": { "reason": "recent" }
}
```

HDMI 1 uses only `{"id":"com.webos.app.hdmi1"}`. Keep launcher/source windows alive during ordinary source handoffs: no delayed
close/hide or input cleanup. Hidden Chromium 53 timers can resume when the launcher returns. HTTP success and media resource lists
do not prove video. The current HOME controller reloads native key filters through configd without closing apps or restarting graphics.
Never mix UI automation with a physical source check or press Enter on unverified startup focus.
Stop if native video turns black. Do not repeat uncertain launches. Recovery may require an explicitly authorized power cycle.
"Connection" reads only `/api/service`; no upstream downloads or updates are available to this port.

## Build and manual launcher test

```sh
npm ci
sh tools/check.sh --chromium
python3 webos4/build.py
```

`dist/webos4/` contains a standalone IPK, manual helper archive, optional addons archive and SHA-256 files.
The IPK installs only `com.cleanyourtv.webos4`. No artifact installs boot hooks, a runtime or debloat automatically.
The manual helper includes only its dependency allowlist. The addons archive contains optional controllers and historical diagnostic
tools; those are not a recommended installation sequence. The normal `python3 ipk/build.py` packaging remains separate.

After reviewing a device-specific plan, extract the manual helper into `/media/developer/cleanyourtv-webos4/`.
Supply the previously verified loader/runtime at `webos4/runtime/node18` with its complete `lib/` tree; do not replace system Node.
Run `sh webos4/service.sh run` from that directory for read-only discovery, or `run --allow-launch` for explicit app launching.
The helper refuses an occupied port. `status` and `stop` use its saved identity; no name-based kill is used.
Install/launch the standalone IPK with the TV's package installer only after approval.
Undo: stop this helper and uninstall only `com.cleanyourtv.webos4`, retaining diagnostics if needed.
The normal installer/uninstaller remain unsuitable as webOS 4 recovery tools; use the explicit branch above for the original candidate.

## HOME: firmware-specific, opt-in

The hook probe recorded zero physical invocations. Passive evdev observation opened both LG and CleanYourTV. The uinput check
never established compositor acceptance and acquired no input grab. None is a working replacement; do not persist those trials.
The working route changes HOME handling in `KeyFilters/systemUi.js`. The compositor also subscribes to
`com.webos.surfacemanager.keyFilters` and reloads the handlers when that array changes; no graphics restart is necessary.

Full LG files are deliberately excluded. Retrieve the owner's unmodified original using a read-only transfer, then run locally:

```sh
python3 webos4/generate-home-patch.py /private/path/systemUi.original.js /private/path/systemUi.js
```

The generator accepts only original SHA-256 `a28d9fee1256258b56727dd3827c3925c07badbb51349a8c1a8189fdfbbb1279`,
requires unique replacement anchors and verifies final SHA-256 `bf89d18f597ade2b226c6cacefadfd1eb578af936b846afba957d9bd0e99874e`.
It never contacts the TV or overwrites an existing output. Unknown firmware requires a new investigation.
`home-startup.sh` and `10-cleanyourtv-home` preserve the recorded private deployment layout and helper hashes;
they are reference controllers, not a generic installer for the new archive. Do not bypass their guards to make installation pass.
Keep original/patch backups private. Place both packaged `keyfilters-*.json` templates beside the controller. They preserve all twelve
handlers and their order, changing only four path spellings between `/usr/lib/qt5/qml/KeyFilters/systemUi.js` and
`/usr/lib/qt5/qml/KeyFilters/./systemUi.js`. After the helper is ready, a fresh boot binds the verified patch in RAM and toggles the
array once. This causes a fresh native read without closing HDMI/other apps or restarting the compositor. An existing known mount
is reused. Unknown arrays, extra policy fields or altered templates are refused. An uncertain write is never retried: the mount
is removed and the next start disabled. Both path spellings resolve to LG's original file in a boot without the RAM mount, preserving
the Homebrew failsafe fallback; no private script path is persisted in configd.
For the recorded installation, undo is `sh /var/lib/webosbrew/cleanyourtv-home/home-startup.sh disable`.
This unmounts only a recognized patch, toggles the array to reload LG immediately and disables future startup, leaving the helper alone.

LG's native Settings UI stores the user's choice as two fields in one API call. Changing only `homeAutoLaunch` can be overwritten
by the server while `checkHomeAutoLaunchValue` remains `default`. After saving the TV's own original pair privately, the user can
select last-source startup with `settingsservice/setSystemSettings` using category `general` and settings
`{"homeAutoLaunch":"off","checkHomeAutoLaunchValue":"user"}`. The native server-update gate honors `user`. Restore the saved original
pair through the same API; do not hard-code another TV's previous values or edit the settings database/cache.

## Debloat: separate, reversible Upstart path

The exact installed and user-validated scripts are preserved under
`webos4/research-debloat/` in the source checkout, including its README with the recorded deployment/undo and legacy limitations.
The optional addons archive includes this reference separately. This closes the missing record of what actually ran on the TV;
it does not silently substitute a different implementation or apply either version. HOME/helper, the installed debloat, Netflix,
shutdown guard and robust Bluetooth are accepted for the tested session; no further session validation is requested.

The upstream systemd debloat is unsuitable here. The isolated scripts stop only observed `remotelogger`, bind no-op stubs over
`/usr/sbin/acr2` and `/usr/sbin/admanager`, terminate matching absolute executable paths and block the three observed ad domains.
They do not disable tvservice, media, compositor, networking, Bluetooth or the preload manager.
The public revision mounts a private hosts candidate over `/etc/hosts`, leaving the underlying file untouched. Undo unmounts owned
content, preserves unrelated hosts edits and restarts remotelogger only if this script stopped it. A foreign mount is refused.
Failure may leave earlier operations applied: use undo before any retry. This is not a universal debloat list or a speed claim.

After approval, with the scripts copied to the isolated deployment, apply `sh webos4/debloat-stop.sh`.
Undo: `sh webos4/debloat-undo.sh`; it creates `/media/developer/cleanyourtv/DISABLE-DEBLOAT` and prevents later application.
Power off/on restores previously killed ad processes if no other boot tool disables them. To deliberately reenable, remove that marker
only after checking no legacy debloat mounts remain. No debloat boot hook is installed by this contribution.
Do not run this revision over the older deployment's mounts: its undo was different. Keep the legacy undo available for that TV.
Validate source video/audio, LG fallback, network, Bluetooth, poweroff and rollback before making a new installation persistent.

## Power and Bluetooth findings

Do not delete `/var/luna/preferences/devmode_enabled`: its directory form can preserve root. `shutdownfix.sh` patches only a known
shutdown script through a RAM mount and has a disable marker. Undo that known installation with its documented unmount and
`initctl reload-configuration`; never execute the shutdown job as a diagnostic.

Netflix's preload list was changed through configd by preserving every other entry/field and keeping private original/candidate payloads.
Do not copy a captured list to another TV or edit configd's database. Source-exit mitigation first sees Netflix, then a native source
for two seconds and confirms the foreground again before one close. No ACK spoofing, retries or native-source closures.
`netflix.sh disable` removes only its own boot entry and stops its matching process. Packaging does not enable it.

Bluetooth confirmation must use the calibrated visible native UI. Direct `btaudiosrc/onClickListener` Yes was followed by LG's No close
action and disconnection. Preserve paired peer checks, active audio checks, focus/pixel checks and private root-owned 0600 config
outside `/media/developer`. Do not distribute calibration screenshots or peer identifiers. `bluetooth.sh disable` removes its own boot
entry without disconnecting/unpairing the peer.
The observer waits up to fifteen seconds for matching focus and pixels, including a focus delay after RIGHT. It sends RIGHT only
for calibrated No, ENTER only for freshly calibrated Yes, and rechecks the paired/active device and focus before each key. Already
selected Yes requires only ENTER. Close/replacement/stop cancels pending callbacks and timers. An uncertain key is never retried;
unrecognized rendering is not interpreted as No. The observed startup `accepted` event was followed by an A2DP status confirmation.

[Bluetooth automation reference](webos4-bluetooth.md) records the observed APIs, dialog checks, calibration, bounded sequence and
rollback requirements for future work. It is documentation only and does not add or enable an automation.

## Research and future upstream contribution

[Detailed English chronology](webos4-history.md) and [Investigation notebook](webos4-research.md) retain successful, failed
and superseded hypotheses, measurements, recovery steps and remaining questions. Historical PC patch drivers/full firmware files
were intentionally not imported; use the guarded generator above. Old tool references describe the research checkout.

For a future PR against upstream `dev`, split shared fixes (app-cache rejection recovery, configurable local origin policy,
portable IPK paths/timestamps) from the standalone port and optional hardware-specific controllers. Preserve original API golden
replies and Node 8 compatibility. Include source payload regressions, origin/method/read-only guards, process identity/rollback tests,
packaging tests and a fresh recorded check run. Chromium 68/79 results are regressions, not proof of Chromium 53 support.
State exactly which revision was checked on hardware, distinguish the accepted research boot from untested public deployments/debloat,
and disclose AI assistance
(OpenAI Codex). Do not publish releases, private logs or claim general webOS 4 support based on this one TV.

[Prepared PR outline and submission checklist](webos4-pr.md).
[Repository validation and review record](webos4-validation.md).

[Prior backup and separate trial of the original UI](webos4-original-trial.md).
[Adapted original installer, runtime, and physical validation](webos4-installer-port.md).
