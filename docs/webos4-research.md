> Historical research log. Current accepted state and limitations: [webos4.md](webos4.md). Earlier pending states below are superseded.

# CleanYourTV for LG webOS 4 — investigation and port plan

## "All" navigation — 30 October 2026

The user requested that Up on "All" should not open the panel and navigate to the top element; the panel opens with OK.
The cause was an explicit exception in the dock handler: Up called showApps only for that button. The exception was removed;
it now uses the same cards-row focus as the rest of the dock. Click/OK, library navigation, and Back are preserved.
The regression test failed before the change and passes afterwards. All 643 checks pass on Node 8/22, types/lint/formatting, and Chromium 68/79.
Only the page was installed: SHA b2da1a41c761352c780e5f3ad5c4164f1bdf56177611a24a2b46ad8819d20c07. Without rebooting the TV or restarting services.
Private original SHA 5fd49826e23c5517ac1f54d720f891ebd79bceb381ea0d3a21ef5302f66c6cd1 in
`/var/lib/webosbrew/cleanyourtv-home/ui-nav-before-20261030/`.
Rollback: `sh /var/lib/webosbrew/cleanyourtv-home/ui-nav-before-20261030/restore.sh`, followed by reopening/reloading CleanYourTV.
Verified using keyboard events in real Chromium 53, with page visible and 25 apps loaded: Up keeps home and moves to cards;
OK opens library and focuses first app; Down/Up traverses a row; Escape closes the panel and returns to "All". No other app was opened.
The verification was automated on the TV, not a physical remote press. Menu left at home with "All" focused.
Change limited to the research checkout and the TV; repo interface in Downloads was not modified in this task.

## Final state validated by user — 29 October 2026

The user confirms: **"Works perfectly"** and **"everything is working at 100%"**. The reload keeps HDMI with picture and sound,
without interruption. Work for this session is considered complete; no requested tests remain pending. This block supersedes
the historical preparation or pending validation states preserved below.

- Boot to last source, without initial LG menu: `homeAutoLaunch=off` and `checkHomeAutoLaunchValue=user`.
- HOME opens only CleanYourTV; a subsequent HOME stays there and Back returns to the origin source/app.
- Automatic boot of HOME and helper, with 25 apps; RAM filter reload without closing sources or restarting graphics.
- Prior debloat active, shutdown fix installed, and Netflix closure on returning to HDMI/Live TV operational.
- Robust Bluetooth active: prompt accepted automatically and configured device connected via A2DP.

Deployed code and recovery copies preserved at the paths described below. 641 checks pass on
Node 8/22, types, lint, formatting, and Chromium 68/79. The confirmation applies to the tested usage on this TV, not to other models or
untested scenarios. Do not repeat trials or alter the stable configuration without a new requirement.

## HOME without graphics restart — 29 October 2026

The user confirmed that off/user eliminates the initial LG Home; the black screen from surface-manager's own restart followed.
Inspection of the embedded QML revealed the overlooked path: configd subscribes to keyFilters and `onKeyFiltersChanged` runs loadKeyFilters.
Two bounded trials logged an innocuous query added to init from the native filter, demonstrating new JS loading without
changing the compositor's PID (1399 in those trials), with HDMI 1 still in the foreground. Watchdogs restored everything automatically.
The second trial used exactly the RAM mount and the path with `/./` of the final solution, ruling out stale JS reuse.

Installed `home-startup.sh` SHA ed043387301142187dd8ab8cb0ffbcf949385620935ccb1e306d21523ba6c531 and two templates with pinned hashes.
It no longer closes apps or restarts graphics: starts/reuses helper, mounts the same patch in RAM, and toggles four paths in the native array
between systemUi.js and ./systemUi.js. Preserves order and twelve handlers; rejects extra keys/foreign configs. Each boot toggles
once to force reload. Both paths point to the LG file without the mount: a failsafe boot preserves LG recovery.
Uncertain writes are not retried: unmounts and disables subsequent boot. Repeated start reuses known mount.
Rollback: `sh /var/lib/webosbrew/cleanyourtv-home/home-startup.sh disable`; unmounts, toggles paths to reload LG, and leaves helper alive.
Backup of previous controller and original array: private `/var/lib/webosbrew/cleanyourtv-home/reload-before-20261029/`.
641 checks on Node 8/22, types/lint/formatting, and Chromium 68/79 pass. On real Node 0.12.2 status/start/disable/start work,
without changing PID 1399 or activating another source. A test reboot was announced and executed after checking uptime >180 s and no pending failsafe.
Test boot result: at 91.21 s initial compositor 1059, start tick 207; no kernel death/restart message for the
compositor. startup.log records `no graphics restart`; HOME/helper active and 25 apps. At 128.37 s off/user persists and failsafe cleared;
debloat active (acr2/admanager mounted and remotelogger stopped), shutdown.conf hash corrected, and Netflix observer active.
Bluetooth records `accepted` and private query confirms configured device connected via A2DP: first real prompt accepted
with the robust version. The user subsequently confirmed full operation; general source sequence was not repeated.
Earlier restart sections are historical.

## Shutdown update — 29 October 2026

This block updates the historical shutdown trials below. At boot, the TV has active
`20-cleanyourtv-shutdownfix`; `/etc/init/shutdown.conf` shows the corrected hash `b38d52195f8df382c33768d923f5ded1104f63e439130c5a5c4f9bb521add71f`.
The calibrated Bluetooth service is also active: do not modify its private configuration or UI acceptance during these trials.

The user reports fast shutdowns around 5 s and slow shutdowns of 10.76/12.61 s, on HDMI and Live TV. Do not attribute variation to HDMI alone.
Historical captures were copied to local ignored directory `dist/webos4/shutdown-analysis-20261029/` and monotonic timestamps
from kernel logs were compared, without sequence number jumps:

| Capture        | Duration of preparePowerOff | End of preparePowerOff to start of shutdown.conf | Start of shutdown.conf to remount marker |
| -------------- | --------------------------- | ------------------------------------------------ | ---------------------------------------- |
| kmsg-live.log  | 2.026 s                     | 0.051 s                                          | 2.719 s                                  |
| kmsg-live2.log | 2.220 s                     | 5.833 s                                          | 2.727 s                                  |
| kmsg-live3.log | 1.817 s                     | 0.055 s                                          | 2.677 s                                  |
| kmsg-live4.log | 1.831 s                     | 6.217 s                                          | 2.679 s                                  |

Variation occurs **before** executing the script. All four captures reach the marker for remounting partitions read-only,
overcoming the initial 14 ms failure. Logs end at that point: they do not prove that the final `shutDown` call was executed
or measure the physical instant of the red standby LED. Subsequent script time includes ~2.3 s waiting for a log copy that
Homebrew prevents from saving by mounting `/var/spool/rdxd` read-only; that wait is similar in fast and slow shutdowns.

The read-only query `tvpowerd/power/getClientList` works and shows registered clients for prepare shutdown/suspend.
The tvpowerd binary includes an 8 s wait in `readyToWaitPreparePowerOffResponses`; it does not yet identify the client or condition
that causes it to expire. In messages-live4, preloading of `com.webos.app.container` at 505.042 s occurred **after** the first power-off
request from kernel (497.699 s), though before the final `Power Off` log (505.863 s). It does not prove that it initiated the issue.

Previous captures were no longer running during the inspected boot. With express authorization, two new captures were started,
bounded to 20 minutes and without persistent boot, in `/var/lib/webosbrew/shutdown-diag-20261029/` (root 0700 directory):
`kernel.log` from `/dev/kmsg` and `power.tty.log` from `ls-monitor -j -f com.webos.service.tvpower`.
The monitor uses `script -q -f` for disk output; capture of getClientList and its response was verified. The first direct capture
was stopped by its verified PID/start time. Active processes: cat PID 5543, wrapper script 5586, ls-monitor 5589;
do not use these PIDs after a reboot or without reverifying identity. BusyBox timeout uses **`-t 1200`**, not positional `1200`.
No ACKs emitted, no new shutdown client registered, no apps closed, and no services restarted. Pending physical shutdown
with recorded time and input; TV had already exceeded three minutes uptime before requesting it.

**Result of acknowledgment capture:** user estimated ~**9 s** from black screen to red standby LED and powered back on.
`kernel.log` and `power.tty.log` were retrieved to the PC as `kernel-ack-trial.log` and `power-ack-trial.log` in the local analysis directory.
The 745 JSON lines were parsed without errors. In `Prepare Power Off`, timestamp `1407353799`, **14 of 15 registered clients**
responded with `ack: true`. **Only `netflix` is missing**. Netflix had responded to initial notice `responsePowerOffRequest`
(1220.967967 s); the monitor logs transmission of subsequent notice to Netflix (1221.098338 s), but not RX receipt or a subsequent ACK.
There was no cancellation of its prepare registration in that window. This indicates an absent confirmation; it does not yet prove
the internal reason Netflix ceases servicing that exchange.

The last ACK from other clients was tvservice at 1223.134099 s. `machineOff` was sent at 1229.106420 s:
**8.008 s from prepare notice and 5.972 s after the last ACK**. Kernel places end of preparePowerOff at
1223.145032 s and start of shutdown.conf at 1229.166775 s. The gap is again before the script.
Logs do not prove that Netflix explains all historical shutdowns, but do identify the sole missing ACK in this one.

After boot, read-only query confirms HDMI 1 in foreground and Netflix running with `reason: preload`,
`preload: partial`. Prepared, pending authorization, a comparison closing **only that Netflix app** once via app manager,
without stopping preloading or changing its configuration. Before next shutdown, verify that its process and client registration
have disappeared and TV exceeds three minutes uptime; if it does not disappear, do not force or repeat closure.
Recovery is opening Netflix normally (`applicationManager/launch`, id `netflix`); no block is uninstalled or persisted.

**Authorized and prepared control without Netflix:** a single request `closeByAppId {"id":"netflix"}` was issued with response
`returnValue: true`. After three seconds `netflix.bin` was no longer in command lines and Netflix had vanished from all
tvpowerd client lists, including `ListPreparePowerOff` (14 remain). HDMI 1 remained in foreground. Do not look for process
by `comm` alone: observed Netflix process had name **GIBBON_MAIN**, although its executable was `netflix.bin`.
User mentioned checking whether an update existed; no relation to missing ACK was proven, and no app was updated or reinstalled
during this control.

New captures bounded to 20 minutes, verified with getClientList query, in private subdirectory
`/var/lib/webosbrew/shutdown-diag-20261029/no-netflix/`: `kernel.log` and `power.tty.log`. Cat PID 5313 and wrapper 5314 in that session;
do not reuse after reboot without verifying identity. Netflix had not reappeared when verifying capture;
uptime over three minutes. Pending physical measurement by user and comparing confirmations before concluding causality.

**Result of control without Netflix:** user noticed a clear reduction and estimated **~4 s**. After powering on, logs were retrieved
as `kernel-no-netflix.log` and `power-no-netflix.log` in local analysis directory. All 740 JSON lines parsed
without errors. In shutdown preparation, **all 14 of 14 clients** responded with `ack: true`, with no Netflix registered.
The last ACK was tvservice at 509.438339 s and `machineOff` at 509.439636 s: **1.297 ms later**, without exhausting the 8 s timer.
In kernel, end of preparePowerOff at 509.449272 s and start of shutdown.conf at 509.536414 s: **87 ms**, compared to ~6 s in the
previous trial. The script retains the log copy wait and reaches the remount marker; it was not changed between trials.

The comparison confirms the mechanism of that delay: registered Netflix does not confirm preparation and tvpowerd exhausts the timeout;
removing only that app removes the wait. It does not yet identify the internal defect in Netflix or prove that all historical shutdowns
share an identical origin. No permanent remedy was applied to its preloading: after boot it can load again.
Captures from this control terminated with shutdown and have no persistent boot. Do not repeat cycles solely to confirm what has
already been measured; any persistent remedy requires separate scope, rollback, and authorization.

**Authorized selective fix trial:** source configuration
`com.webos.service.preloadmanager.supportAppList` returned nine entries, Netflix with `isEnabled: true`.
Two JSONs were prepared, original and candidate, and verified by comparison that only **Netflix: true → false** changes,
preserving the other eight entries and all their fields. `getPreloadPolicy` value from running manager does not replace
this verification: it once showed Netflix disabled while its preloaded process was still alive.

With authorization, copies were saved in `/var/lib/webosbrew/netflix-preload-20261029/` (0700 directory, 0600 JSON),
with hashes checked against local: original `a52cc17b66828ff56ab63e08969956f23a7c19901d9713362f02a3b1f085cee0`,
candidate `79ed72aefa639c8fb49d9cd9e409493e1b0902e93c986da6724b29c168d45680`.
A single call to `config/setConfigs` was made with candidate: `returnValue: true`; subsequent query matched exactly
the expected JSON. Afterwards, Netflix was closed once in background via `closeByAppId`, with HDMI 1 in foreground.
Verified no `netflix.bin` process and no Netflix client (14 shutdown clients).

**Pending validation of persistence on this TV after power off/on.** No boot hook, service, or watchdog was added.
Do not claim yet that the change is permanent or that manual Netflix is verified. Configd API exists in this firmware;
persistence of overrides depends on implementation and must be measured, not deduced from HTTP/Luna responses.
Rollback of values via the same API (without writing configd_db.json directly):
`luna-send -n 1 -w 5000 luna://com.webos.service.config/setConfigs "$(cat /var/lib/webosbrew/netflix-preload-20261029/netflix-preload-original.json)" </dev/null`.

**Persistence verified on 29 October:** user powered off and on without opening Netflix. In the new boot, at 67 s,
configd source retained Netflix disabled and no `netflix.bin` process existed. A second read matched by JSON equality
with the candidate: all nine entries match exactly, including the other eight untouched. Preload manager
was running. At **204.20 s uptime** the check was repeated: Netflix remains disabled in configd, no
preloaded process, preload manager active, and 14 shutdown clients, none Netflix. **Persistence and absence of preloading
validated after exceeding three minutes.** User opened Netflix from stock LG icon and confirmed **"All good"**:
manual opening is also validated. A shutdown after manual use has not been measured, nor has the internal ACK defect
in Netflix been fixed; the correction prevents its automatic loading, not promising to fix all states after using the app.

**Validation following manual use, ongoing:** user asked to continue. Read confirmed HDMI 1 in foreground and Netflix
still open, with `reason: hotKey`/`parameters.reason: hotkey`, without `reason: preload`. Netflix was not closed for this comparison.
Bounded capture of kernel and confirmations was repeated in private subdirectory
`/var/lib/webosbrew/shutdown-diag-20261029/manual-netflix/` (20 minutes, without persistent boot).
Verified both logs with data, without capture errors, and **15 prepare clients, including Netflix**, at 685 s uptime.
Cat PID 5221 and wrapper 5222 in this session; do not reuse after reboot or without verifying identity.
Pending physical shutdown, approximate time from user, and checking Netflix ACK before broadening conclusion.

**Result following manual use: 11.22 s, same failure recurs.** Captures `kernel-manual-netflix.log` and
`power-manual-netflix.log` were retrieved to the PC (730 valid JSON records). In preparation, timestamp `3236674033`,
14 of 15 clients responded: once again only Netflix is missing, though it responded to initial power-off notice.
Notice to Netflix at 718.952670 s, last ACK from tvservice at 721.112745 s, and `machineOff` at 726.963392 s:
8.011 s from notice. Kernel gap before script was 5.918 s.
**Preload disablement is a mitigation for when Netflix has not been used, not a complete solution after opening it.**

Stock option `keepAliveApps` was reviewed: Netflix is not on that list; unvalidated app properties were not added or modified.
Prepared **locally only** `webos4/netflix-poweroff.js`: two-minute trial, without boot hook or Bluetooth integration.
Passively observes `getPowerState {"subscribe":true}` (subscription verified on TV), waits first for Active, and sends **a single**
close command with pinned id `netflix` when `Active / Request Power Off` appears. Does not act on switching apps, does not launch apps,
does not send ACK, and does not retry uncertain closes. Halts on TTL or signal and terminates only its own Luna child processes.
Unit tests and integration with a mock Luna test chunked data, boundaries, invalid states, single attempt, and stopping.
The trial **has not been copied or executed on the TV**. Requires authorization and physical test: closing Netflix at shutdown start
is a new race that must be validated before any permanent autostart. Trial rollback: SIGTERM to verified PID
or wait for two-minute limit; do not stop tvservice or compositor.

**Shutdown closure trial authorized:** user expressly approved temporary two-minute load with captures.
**557 checks** pass on Node 8/22, types/lint/formatting, and Chromium 68/79 on isolated Linux copy with LF.
New test includes real process against mock Luna, plus controller and parser. In previous shutdownfix test,
use of `mkdirSync({recursive:true})`, incompatible with Node 8, was corrected; deployed fix was unchanged.
Scope reviewed: single pinned id, no ACK, no input closures, no retry, and no new autostart.

Candidate copied to `/var/lib/webosbrew/netflix-poweroff-trial-20261029/netflix-poweroff.js` (0700 directory, 0600 file).
Local/TV SHA256 `f87e002f303b7f8948cc74a1aeb1e5fe6d12430e0064ec92c0cde4ef7dd2c075`.
The controller passed a smoke test with mock functions on real Node **0.12.2**, without sending close to LG during smoke.
Three-minute kernel and power.tty.log captures were prepared in same directory. Trial then started:
PID **5094**, with PID/start time saved, `ready` logged. Do not reuse that PID after boot or without verification.
Pending requested physical test: open Netflix manually, return to HDMI 1, and power off within two-minute limit.
No permanent service installed; trial itself expires and terminates only its Luna children.

**Result of shutdown trial: 11.49 s, failed.** Trial log shows `ready` and `close-accepted`: close was sent
and LG accepted the request, but this does not prove termination. Retrieved captures `power-close-at-poweroff.log` (810 JSON)
and `kernel-close-at-poweroff.log` show that only Netflix ACK is missing again. `machineOff` at 1029.308070 s,
following prepare notice at approximately 1021.3 s: the 8 s wait expired once more. There was no cancellation of Netflix registration
to avoid the wait. Internal reason close does not remove it in that phase remains unisolated.
**Do not persist or repeat this candidate at boot:** accepting close during shutdown does not reproduce result of closing it
while TV is still active. After power off/on trial is no longer running and HDMI 1 is back in foreground.
Selective preload mitigation remains partial; the only verified close that avoids the wait was prior to shutdown.

**Next candidate, local only:** user chose to close Netflix on returning to a source. Failed prototype replaced
with `webos4/netflix-source-exit.js`, two-minute trial without permanent boot. Stock read-only subscription
`applicationManager/getForegroundAppInfo` works on this TV. Candidate observes Netflix first, waits two seconds
on Live TV or HDMI 1–4, and queries foreground again before sending a single Netflix close. Menus and other apps do not
trigger close; returning to Netflix or stopping trial cancels pending action. No retries for uncertain close.
Does not launch or close sources/launcher. User accepts losing Netflix background resumption.
Pending specific authorization to upload/run this new trial; not applied to TV. Rollback: SIGTERM to verified
own PID or two-minute expiration. Before persisting, verify real disappearance of process/clients and physical video;
a small race remains if foreground changes right after query. Historical logs from shutdown trial
remain private; its old local module was removed to prevent reusing failed candidate.
Local candidate validation: **583 checks** on Node 8.12/22, types/lint/formatting, and Chromium 68/79, all passing.
Module also passes ES5 analysis. Review of boundaries, cancellation, and invocations: no pending issues; physical test needed.

**Source-exit trial authorized and active:** copied to
`/var/lib/webosbrew/netflix-source-exit-trial-20261029/netflix-source-exit.js`, 0700 directory, private module and logs.
Local/TV SHA256 `407d2425031efb5679169089ae298eed3af6baad8fbf5de908a389867b52e525`.
Controller passes smoke test with mock functions on stock Node 0.12.2, without LG calls in smoke.
Started PID **4970**, with `trial.pid` and initial `/proc/PID/stat` in `trial.start`; `trial.log` confirms `ready`.
Do not reuse PID after reboot or without checking start. Expires after two minutes and is not installed at boot.
Prior to start: HDMI 1 in foreground, no Netflix among 14 prepare clients; uptime over three minutes.
User asked to open Netflix, return to HDMI/Live TV, wait five seconds, and confirm picture/sound; **without powering off yet**.
Pending verification of `netflix.bin` process, all its tvpowerd lists, and trial log before concluding success.

**First result of source-return trial:** user confirms correct picture and sound on source.
`trial.log` records `close-accepted` at `1793282837257`; `trial.err` is empty. Subsequent query at 903.34 s uptime:
HDMI 1 in foreground, no `netflix.bin` process, and no Netflix in any tvpowerd client list; 14 remain in
`ListPreparePowerOff`. This time actual termination is verified prior to shutdown, not just API acceptance.
Trial remains temporary and without boot; shutdown after this close and validating physical source sequence
remain before accepting persistent integration. Shutdown fix and selective preloading were not modified.

**Shutdown after source-return close: ~4–5 s**, confirmed by user, who powered back on.
New boot reading at 192.17 s: no trial process or `netflix.bin`; previous log shows `expired`.
Physical measurement supports remedy prior to shutdown; no new capture of confirmation exchange in this cycle.
Prepared locally only `--service` option and `netflix.sh` with isolated entry `30-cleanyourtv-netflix`.
Planned private path: `/var/lib/webosbrew/netflix-source-exit/`; that version has not been copied or enabled.
Reuses Bluetooth controller ownership pattern without modification: exact executable/script/mode/start, idempotent
start, rejection of foreign entry, and stopping only own process. `disable` removes matching boot and stops it.
Planned rollback: `sh /var/lib/webosbrew/netflix-source-exit/netflix.sh disable`.
Physical sequence YouTube → CleanYourTV by icon → Live TV → HDMI 1 requested before accepting persistence.
User confirms that entire sequence works and asks to stop repeating it: **flow validated**, do not request again without
a new regression. Local wrapper validation and specific authorization for permanent installation remain.

**App list incident after power-on:** user notes bottom bar could not list all applications.
TV read at 194.47 s: no webOS 4 helper/Node 18 in processes; both `/api/service` and `/api/apps` reject connection
on loopback:8765. No helper boot entry in init.d. Verified cause of list unavailability in this session:
manual backend absent after power-on, not proven loss of installed apps. Do not modify dock or source flow for this reason.
Existing manual autostart `/media/developer/cleanyourtv/run_helper.sh` reviewed; not started without authorization.
With user authorization, existing script was started via nohup, without adding boot or changing deployed code.
Observed PID **1649**, process start `/proc/stat` **28026**, executable ld-linux.so.3 with isolated Node 18 and exact argument
`/media/developer/cleanyourtv/helper/webos4.js --allow-launch`. Do not reuse without verifying that data.
`/api/service` resumes answering with version 0.2.0/Node 18.17.1 and `/api/apps` returns **25 apps**.
Persistent Netflix wrapper now passes **590 checks** on Node 8/22, types/lint/formatting, and Chromium 68/79.
Not installed: installation authorization and validation after boot remain pending. Physical source flow already validated.

**Netflix close installed with express authorization, 29 October:** created private directory
`/var/lib/webosbrew/netflix-source-exit/` (0700), module (0600), controller, and boot template (0700).
Matching local/TV SHA256: module `eb594a2455193387bda9ab50f67b54f968bb447e91d069e4a50a74bcb7be98b1`,
controller `46a729d6a0802903600ec833d699973a5b0fd5b04cefbd412ecde81b2dfa40fc`,
boot `e18b1c75b63cb9ce29fecb3320df94c9e8b729ca5aac41aa9da2e8b8410b1690`.
Module loading in Node 0.12.2 and syntax of both scripts correct. `netflix.sh enable` returns `ready`;
`status`: `running`, `boot-enabled`. Observed PID **1885**, start **35669**, saved in private `service.pid`.
Only `/var/lib/webosbrew/init.d/30-cleanyourtv-netflix` was added; executing that entry again returns `already-running`
and preserves PID/start, without duplicating observers. Apps helper continues responding and retains manual start.
Rollback: `sh /var/lib/webosbrew/netflix-source-exit/netflix.sh disable`.
Checking this boot on next physical power-on remains; do not request another cycle or repeat validated flow for installation.
Remedy limitation: acts after returning to a source; powering off directly inside Netflix can still exhaust timer.

**New power-on verified, 29 October:** Netflix already appears running from its boot entry (`ready` and
`running`/`boot-enabled`), with new uptime 98.28 s. Real boot of observer is validated; previous PID no longer valid.
Shutdown fix preserves its corrected hash and Bluetooth service preserves its boot entry unchanged.
Apps helper stopped again after power-on: its automatic lifecycle is needed to install HOME usefully.

**Debloat reactivated with express authorization:** removed `DISABLE-DEBLOAT` and executed the same `debloat-stop.sh`, without editing it.
Verified `remotelogger stop/waiting`, stub mounts on `/usr/sbin/acr2` and `/usr/sbin/admanager`, without those processes and two
marked hosts lines. Existing entry `15-cleanyourtv-debloat` reapplies it after next boot.
Rollback: `touch /media/developer/cleanyourtv/DISABLE-DEBLOAT; sh /media/developer/cleanyourtv/debloat-undo.sh`.

**HOME in this session:** LG original `a28d9fee1256258b56727dd3827c3925c07badbb51349a8c1a8189fdfbbb1279`, unmounted;
bindings `{}`, Input Hook mode 644. Compositor (PID 1059 in this read) opens event1 directly and uses libim; introspected
APIs expose no key filter switching. Failed injections, observer, or uinput were not repeated.
Manual patch section of `docs/webos4.md` records functional HOME on 27 October, via mount and graphics restart.
Patch is already on TV with SHA `1b0d05a975c2601b6bf6f0e0065266271793f906f8e94ff9802e7155604af4f5` and verified original copy.
`home-patch.py` reviewed: its `apply` backs up, mounts, starts helper, closes stock LG apps, and restarts surface-manager;
specific authorization was requested for that procedure given historical risk of black video and recovery via power off/on.
Pending reply: HOME not activated and compositor not restarted. Automatic HOME/helper boot still uninstalled.
Do not ask for general source sequence again: user considered it validated and asked to stop repeating it.

**HOME activated with express authorization, 29 October:** executed existing procedure
`webos4/home-patch.py apply --yes` via SSH with key. Preflight: original file, unmounted, bindings `{}`.
Verified PC/TV original copy; patch mounted with SHA
`1b0d05a975c2601b6bf6f0e0065266271793f906f8e94ff9802e7155604af4f5`.
Existing helper was started. Procedure closed, with accepted response, HDMI 1, AirPlay, and LG browser, and restarted
surface-manager: new observed PID **1343**. Controller completed without errors.
Subsequent check: mount and hash correct, interface `start/running`, `/api/service` responds, and `/api/apps` returns 25.
HDMI 1 is again foreground; this does not prove picture/sound. Netflix remains active and boot-enabled, debloat remains applied
(remotelogger stopped, two stubs, and two marked hosts lines). No HOME/helper boot was added.
Requested only to confirm HDMI and press HOME once, without repeating already-validated general flow or powering off yet.
Pending physical confirmation. Authorized/documented rollback: unmount systemUi.js and physically power off/on.

**Physical HOME confirmed:** user confirms HOME opens CleanYourTV without overlaid LG, and HDMI has picture/sound.
Joint HOME/helper boot prepared locally only: `webos4/home-startup.sh`, template `webos4/10-cleanyourtv-home`, and
already-tested patch, unmodified. Planned private destination `/var/lib/webosbrew/cleanyourtv-home/`, patch `systemUi.js`.
Script pins original/patch/helper/run_helper hashes, rejects conflicting hooks/mappings and foreign mounts, starts
existing isolated helper if missing, and awaits its API. If it detects a live but unresponsive helper, it does not start another copy.
With patch already mounted, it reuses current session without closures or graphics restart. On a fresh boot it reproduces native
closures and graphics restart from manual procedure, exactly once. `10-` precedes debloat/shutdownfix/Bluetooth/Netflix.
Private `startup.log`/`helper.log`; volatile lock serialises start/disable. No restart loop for UI or helper.
A restart failure disables future attempts and unmounts; an uncertain close aborts before mounting without retry.
Planned rollback: `sh /var/lib/webosbrew/cleanyourtv-home/home-startup.sh disable`, followed by physical power off/on.
This command creates DISABLED and unmounts only a known patch, without killing processes or restarting UI. Current helper
may continue until shutdown. This boot integration has not yet been copied or installed.
Local tests: cold boot simulation, reuse, foreign hash/hook, stuck helper, close/restart failures, and rollback.
Final checks and specific authorization to install boot integration with graphics restart at power-on remain.

**HOME/helper boot installed with express authorization:** **605 checks** pass on Node 8/22 and remaining checks
(pages, types, lint, formatting, Chromium 68/79). Failure branches reviewed and a start/disable race fixed with shared lock.
All three files copied to `/var/lib/webosbrew/cleanyourtv-home/` (0700), scripts 0700, and `systemUi.js` 0600.
Controller SHA `398759dbb061d230e50a9014f3dc12b1f508d7557bbe0547e7d32ee1b9dccc29`, entry
`2d9587bdf06edf84ae8b71a540aeacbe94de7683ea8a85ad76d71bacab630259`, unchanged patch
`1b0d05a975c2601b6bf6f0e0065266271793f906f8e94ff9802e7155604af4f5`; TV copies match and native syntax correct.
Initial reuse check did not pass: in that read the TV again had original file, compositor PID 1059,
unmounted HOME, and stopped helper, so `start` was not run and UI was not restarted during installation.
Only entry `10-cleanyourtv-home` was added; `status` returns `boot-enabled`, and `run-parts --test` selects all five
hooks 10/15/20/25/30. HOME/helper will load on next power-on; physical success of this automatic boot not yet achieved.
User asked to power off/on with remote, wait three minutes, and confirm picture/sound, without measuring shutdown or repeating sources.
Pending that response and reviewing `startup.log`, mount, compositor, and apps API. Rollback: controller `disable` and power off/on.

**Real boot confirmed:** user reports picture and sound. Read at 171.78 s: `startup.log` shows restart to PID 1391
and `HOME patch loaded; helper ready`; status boot-enabled/patch-mounted/helper-ready, previous patch hash correct, and helper alive.
User detects two unwanted behaviours: HOME while on CleanYourTV also opens LG, and primary Back opens LG.
Mechanisms verified in code: explicit `global.goHome()` branch when on CleanYourTV, and `platformBack()` in page.
User chose **Back returns to previous source/app**. Do not modify or repeat validated general source flow.

**HOME/Back fix prepared locally only:** QML consumes HOME when CleanYourTV is already front. When opened from another
app/source, it sends a single launch of the launcher with its origin id in `params.cytvPreviousAppId`, via stock Luna.
The page reads initial params and launch/relaunch events; Back closes panels or activates that origin via validated helper.
No `platformBack`, launcher close/hide, activation fallback, or retries. If opened by icon without origin, logs and does not
invent another source. `handlesRelaunch` retained by default. Official LG docs describe delivery of these parameters.
New QML hash `bf89d18f597ade2b226c6cacefadfd1eb578af936b846afba957d9bd0e99874e`; controller recognises legacy mount
`1b0d05a975c2601b6bf6f0e0065266271793f906f8e94ff9802e7155604af4f5` for migration/stop and requires new file at boot.
Manual PC controller also recognises legacy hash to avoid losing rollback. Copies of old page/controller/patch
retrieved from TV in `dist/webos4/home-back-before-20261029/` (ignored), without touching TV yet.
UI tests, QML executed with mock context, and migration of previous patch added. Pending final check,
authorization to atomically update the three files, and physical power off/on to load fix.
Validation complete: **621 checks** on Node 8/22, types/lint/formatting, pages, and Chromium 68/79 passing;
QML passes ES5 analysis. Change review has no pending issues; physical validation of parameters and return needed.
New controller SHA `e4fb964cffff5cd23a94e11dc6da486e28fb369dd14c987ec795c4a8aab4e9a1`,
new page `5fd49826e23c5517ac1f54d720f891ebd79bceb381ea0d3a21ef5302f66c6cd1`.
Private restore script for the three files prepared to install alongside their backups, without another hot graphics restart.

**HOME/Back fix installed with express authorization:** current three copies saved and verified in
`/var/lib/webosbrew/cleanyourtv-home/backup-home-back/`, together with `restore.sh` (0700).
Previous page SHA `79a4469281343b71e5f1155821403d3cccebcafda97d4741aa75db3e4fe7f1e9`; previous controller/patch already noted.
Candidates uploaded to `update-home-back/`, hashes and script syntax verified, atomic replacement of QML/controller/page via rename.
Installed hashes match previous candidates. Live mount preserves previous inode and legacy SHA `1b0d…`;
status `boot-enabled / legacy-patch-mounted / helper-ready`, compositor **1391** without restart during this update.
The fix will load on next power off/on. User asked to wait three minutes and verify only
HOME → HOME → Back from a source/app, without repeating general flow or measuring shutdown. Pending physical result.
Exact rollback for the three files: `sh /var/lib/webosbrew/cleanyourtv-home/backup-home-back/restore.sh` and power off/on.

**Corrected HOME/Back physically confirmed:** user states both work and return to source/app with picture/sound.
Observes a new incident: first opening very slow and black; Back returned HDMI 1, returning to HOME rendered properly.
Do not treat black screen as normal or claim boot is entirely solved. Subsequent read-only inspection:
uptime 210.26 s, new compositor **1396**, helper **4315**, new QML hash `bf89d…`, status boot-enabled/patch-mounted/helper-ready.
`startup.log` confirms new execution; also retains lines from previous boot (it is append-only, not proof of two restarts in this boot).
Helper started at **46.41 s** and compositor at **60.18 s** (proc start ticks / CLK_TCK=100).
SAM receives first HOME at **92.808 s**, CleanYourTV surface in foreground at **94.442 s** (1.634 s), Back at **103.992 s**.
Second opening at 107.259 s and foreground at 107.293 s (~34 ms); subsequent openings ~33–61 ms.
CDP inspection of exact page, read-only: DOMContentLoaded **858 ms**, load **995 ms** from initial navigation,
document ready complete, 25 apps, and Live TV origin captured correctly. `chrome.loadTimes` provides no usable first paint.
This aligns with presentation/first paint, but **does not isolate the cause** or measure first visible frame. A loaded DOM does not prove
that async list had responded or that frame was presented. No explicit GPU/OOM/crash errors in checked data.
User pressed first HOME at ~93 s, not after three minutes; that does not prove failure was solely due to not waiting long enough.
No changes or reboots were performed. Local inspection tunnel stopped. Netflix remains boot-enabled and remotelogger stopped.

**User boot preference:** last source (HDMI 1), CleanYourTV only on pressing HOME.
On subsequent power-on, user reports initial LG Home, return to HDMI, and subsequent black screen before stabilising. Read of that boot
contains no launch of CleanYourTV: black screen in that boot coincides with our patch load/graphics restart,
not an attempt to open the launcher. Current script does not open CleanYourTV at boot.
LSM is already active at ~7.5 s; HDMI appears at 20.43 s and native HOME at 24.53 s. Our helper/hook arrives later.
HDMI loses visibility at 48.142 s, LG relaunches it as last_input at 49.195 s; relaunches it again at 65.545 s after graphics restart.
This sequence distinguishes the interruption caused by installing HOME from first-draw incident when pressing HOME in previous boot.
Do not simply remove restart: native JS loads once and late mounting alone does not activate patch.

Initial query in `option` category did not find those keys; correct category on this TV is **general**.
`getSystemSettings` returned `homeAutoLaunch: "on"`, `lastInputApp` and `physicalLastInputApp` both HDMI 1.
With express authorization, `/var/lib/webosbrew/cleanyourtv-home/home-autolaunch-before-20261029.json` (0600) was saved with
original homeAutoLaunch value only, and a single setSystemSettings was executed with `{category:"general",settings:{homeAutoLaunch:"off"}}`.
API accepted and subsequent read confirms `off`, preserving both last input ids. HOME/helper remain active.
Rollback: `luna-send -n 1 -w 5000 luna://com.webos.settingsservice/setSystemSettings '{"category":"general","settings":{"homeAutoLaunch":"on"}}' </dev/null`.
Pending verification of suppressing initial LG HOME in another natural power-on. No immediate shutdown was requested.
Graphics restart interruption remains a known limitation of current mechanism; eliminating it requires another way to activate
the patch, not yet implemented or validated. Homebrew startup.sh, Upstart, firmware, hooks, sources, and controllers were not modified.

**Subsequent validation and Bluetooth, 29 October:** user reports app update notice, return to HDMI, second interruption,
and Bluetooth notice stuck on No; could not move it with physical arrow either. In that boot automation was running/boot-enabled,
with `READY`, `startup-connect-uncertain`, `skipped-image`. Single paired configured device and A2DP/AVRCP connected,
without printing name/MAC. Focus alternated between none and alertView. Private ignored capture
`dist/webos4/bluetooth-focus-20261029/diagnostic.bmp` showed correct prompt on No but pixelState=other.
User authorized right arrow and OK, but rebooted before keys were executed: previous temp directory no longer existed, capture
ERR_INVALID_PATH, no key was sent. In new boot logs are startup-connect-requested/skipped-focus, and user
confirms popup disappeared and connects fine. Do not blindly modify private calibration.
Additionally, general.homeAutoLaunch value returned to **on** after reboot and user observed LG again: off persistence NOT validated.

**Bluetooth robustness prepared locally only:** user requests observing notice, confirming if on Yes or moving right and confirming.
`bluetooth-accept.js` maintains an absolute 15 s timeout, checks every 500 ms, and tolerates late focus/image, including after RIGHT.
Only one RIGHT per prompt; ENTER only with calibrated Yes, fresh check of paired/active device, image, and focus.
Do not interpret unknown image as No. No retries of uncertain keys, no direct Yes callback, and no config/calibration modification.
Closing/replacing notice, stopping, or expiring cancels timers and late callbacks. Timeout identifies before/after RIGHT
and whether waiting for focus/image/device; no keys sent after that limit. Waiting does not fix permanently altered calibration.
51 focused tests pass, including focus wait, loss after RIGHT, unchanging No, already selected Yes, Yes reverting to No
before Enter, pairing change, stop/expiration, and real process with mock captures. ES5 analysis correct.
Pending test suite completion, backup, and specific authorization to replace only the module and restart its own process.
TV remains with original module SHA `187a61a032a66005df0e7c801d082b6ca82a5c2493907ac77d9e0d0c29ca30e6`; no changes applied.
Final local validation: **634 checks** on Node 8/22, pages, types/lint/formatting, and Chromium 68/79, all passing.
Callback, expiration, and fresh-image key review with no pending issues. To deploy: save copy of original module,
load candidate first with mock functions on real Node 0.12, replace module only, and restart automation
via its controller with ownership verification. Do not touch private config or boot entry.
Prepared restoration: `sh /var/lib/webosbrew/bluetooth-robust-before-20261029/restore.sh`, using same verified stop/start.

**Robust Bluetooth installed with express authorization:** old module copy saved in
`/var/lib/webosbrew/bluetooth-robust-before-20261029/` (0700), with `restore.sh` and private config checksum before change.
Candidate SHA `b05fc61f5d89e02e698e5c59a97455707985015433541be6bd3dab722e2bf598` verified on TV.
Tested with mock functions and clock on real Node **0.12.2**: focus wait, RIGHT, verified Yes/ENTER, and stop correct,
without calls to real services during smoke. Only bluetooth-accept.js was replaced and stop/start executed via controller
with own-process verification; boot, pairing, and private config/calibration were not changed (checksum equal).
Observed process **2448**, start **120455**, in `/tmp/cytv-bluetooth.pid`; do not reuse without verifying identity.
Status running/boot-enabled/READY. Configured device remains connected according to btaudiosrc and HOME/helper remain active.
Without current popup, after 15 s `timeout-before-key-focus` appears: no keys sent, expected behaviour when no prompt is present.
Pending real prompt. User asked to power off/on **only the Bluetooth device**, keeping TV on, and wait up to 15 s
without touching remote if panel appears. If left on No, leave open to diagnose; if connects without prompt, acceptance is untested.
Return of `homeAutoLaunch` to on remains under separate investigation; this installation did not change it again.

**Boot investigation prioritised by user:** no settings modified and nothing rebooted during this inspection.
In observed boot, HDMI 1 appears at 20.52 s; our closure hides it at 48.41 s, last_input_handler relaunches it at 49.48 s,
and graphics restart triggers last_input_handler again at 65.14 s. New compositor starts at 58.24 s (1414 in this read).
The sequence HDMI → interruption → HDMI comes from the stock closure and restart added to load HOME JS, not an automatic launch
of CleanYourTV. Do not simply remove restart: late mounted JS will not reload without it. Minimising interruption requires another proven mechanism.

For LG Home, metadata for both general keys: global, dimension=[], volatile=false; homeAutoLaunch accepts on/off and
checkHomeAutoLaunchValue accepts default/user. API and `/var/luna/preferences/general` cache, read with field filter only,
match on on/default, with powerOnScreen=todays and last source HDMI 1. Full cache was not read and personal data was not dumped.
A filtered DB8 query was rejected due to permissions; permissions were not altered and DB/cache were not directly written.
**Omission identified:** stock Settings toggle, inspected in
`/usr/palm/applications/com.palm.app.settings/main.js`, constructs empty app_id and saves homeAutoLaunch alongside
checkHomeAutoLaunchValue="user" in the same setSystemSettings call. Our previous call changed only homeAutoLaunch.
This provides a targeted fix to the native contract; it does not yet prove which process restores on at next boot.
Original on/default and candidate off/user prepared on PC only in
`dist/webos4/home-autolaunch-user-20261029/`, without touching last input ids or powerOnScreen.
Already accepted API body retained (category/settings), adding only user flag: stock getter rejected
optional app_id field, so UI transport or OSE API cannot be blindly extrapolated to this older firmware.
Pending approval to save both values via API and validate persistence after power-on. This fix does not eliminate
the graphics cut, and a write patch on every boot hiding the persistence issue is not proposed.

**Permanent direct work authorization:** user asks to keep choice and remove requirement to confirm every step.
Updated rule 1 of AGENTS.md: diagnosis, reversible fixes, and test reboots within the task authorized without
asking for another yes; announce interruptions, keep backups and rollback. Limits on firmware/root/personal data and validated sources maintained.
With that authorization, original on/default and candidate off/user were saved in
`/var/lib/webosbrew/cleanyourtv-home/home-autolaunch-user-20261029/` (0700; JSON 0600).
A single setSystemSettings call saved both keys; API and filtered cache returned off/user and both HDMI 1 ids unchanged.
After checking uptime >180 s and absence of pending failsafe, a test reboot was announced and executed via SSH.
New boot readings at 91.21 s, 256 s, and over 500 s retained off/user; at 844 s HOME/helper remained active and patch loaded.
Stock QML provides the specific cause: `SettingPropertyService.qml` allows server updates only with default flag;
`HomeAutoLaunchModel.qml` then applies `auto_home_launch` received from SDX. The user flag prevents that overwrite.
Stock HOME logs visibility at 24.897–26.799 s and 69.078–69.837 s; this does not prove drawn menu by itself.
Pending user observation. Reboot was micomPower; native autostart checks remoteKey, so physical validation by remote cannot be claimed.
Black screen sequence remains explained by our closures at ~48 s and graphics restart at ~58–60 s.
In this boot Bluetooth did not start (empty log, no PID). Recovered via its existing controller; READY and boot-enabled verified,
without altering calibration or sending keys. Possible race prior to exec in controller, not yet reproduced or fixed.

**User confirmation on another reboot:** rebooted independently and LG Home did not appear; HDMI 1 persists followed by black screen.
Did not specify how reboot was performed. Read at 97.45 s: off/user persists, both last inputs HDMI 1; HOME/helper and Bluetooth active.
Read-only inspection: surface-manager starts with ls-hubd_public-ready/gpu-libs/tvwin-ready; devmode, running Homebrew,
waits for minimal-boot-done. Current hook arrives late for first compositor. Stock introspection offers no filter reload.
Hooks were not changed and nothing rebooted during this inspection; earlier activation or reload without restart remains unproven.

**Physical HOME validation and reversible boot preparation, 29 October:** user confirmed HOME operation
in this session; process query shows CleanYourTV open (`processid: 1439`) and Live TV (`1642`), with HDMI 1
in foreground and surface-manager stable (PID 1343).
`webos4/home-startup.sh` and boot template `webos4/10-cleanyourtv-home` prepared locally. The script reuses active
mount and helper if already operating in the session, without restarting surface-manager or closing applications again.
Verifies that patch and helper files match pinned hashes, that no remaps exist in `keybinds.json` or `/tmp/inputhook`,
and if graphics restart fails disables future boot (`DISABLED`) and unmounts patch.
Validated locally with `tools/test/webos4homeboot.test.js`. Pending authorization to deploy staging to
`/var/lib/webosbrew/cleanyourtv-home/` and check `home-startup.sh start` in current session before installing to `init.d`.
Rollback: `rm -rf /var/lib/webosbrew/cleanyourtv-home` or `sh /var/lib/webosbrew/cleanyourtv-home/home-startup.sh disable`.

## Validated state — 26 October 2026

**This block and the stability contract represent current state. Subsequent sections preserve test history.**

The user confirms that Live TV/HDMI 1 cycle and full sequence **YouTube playing → LG menu → CleanYourTV →
Live TV → HDMI 1** work. Settings/Back and static focus without pointed corners were also verified. 25 real apps exist and "Connection" queries
only the local helper: does not download or update software. 450 local tests, types, lint, formatting, and Chromium 68/79 checks pass.

**Do not reintroduce:** closing/hiding launcher when opening sources, closing other inputs, `window.close` timers,
direct fallback to `PalmServiceBridge`, or automatic retries following error/timeout. There is a single request to the helper with ten seconds
margin. Helper retains `recent` command captured from LG for Live TV and only id for HDMI. Do not replace with empty parameters.

Complete contract, recovery, and test protocol: [docs/webos4.md](webos4.md#validated-source-switching-contract).
These rules are also in `AGENTS.md` to be read before future changes. Single cause of black screen was not isolated;
current combination passed indicated physical tests. Helper remains active manually. HOME, automatic boot, and debloat
remain unactivated; temporary HOME controller prepared locally only.

**First HOME diagnostic executed 26 October:** SSH resumed responding. Before and after trial, user confirmed
LG HOME, Live TV, and HDMI 1 working. The `probe` trial was ready with Node 0.12, but pressing HOME opened LG and script log
retained **zero invocations**. Hook logged configuration reloads; unisolated why handler did not run.
Mapping removed early: `keybinds.json` returns to `{}`, watchdog finished, and validated helper remains active.
Script halted without testing `plain`, `recent`, or `public`; no app launched from trial. Early rollback passed;
did not wait to physically check two-minute automatic limit. Local report in `dist/webos4/home-test-1793040838351-d452cbca.json`.
Inspection found preexisting debloat boot entry; not created or modified in this test and effects not evaluated.
Script checks and rejects prior remaps, QML mounts, or HOME boot before permitting a test, without deleting them.
`webos4/Probar-HOME.cmd` / `python webos4/test-home.py` executes from PC hook detection and three launch variants,
one at a time, with logging and two-minute rollback executed on the TV itself. Requests confirming stock state and authorizing each phase;
does not alter launcher, source launches, boot, or debloat. Details, limits, and recovery:
[interactive HOME experiment](webos4-history.md#interactive-home-experiment-from-a-pc). HOME remains unvalidated: investigate key delivery first.

Follow-up: bounded capture confirms HOME 773 on remote device; executing diagnostic handler via SSH
increments counter, but pressing HOME does not. Still no key calls in hook interception log. Removed temporary
mapping again. Prepared `python webos4/test-home.py --observe`: observes that device without remapping or blocking button,
attempts single launcher launch per press, and halts after two minutes.
**Physical result: unusable as HOME replacement.** Logged two presses and two accepted commands, one per press;
user saw LG and CleanYourTV overlaid, with ~three seconds delay. Stopped early: bindings `{}`, watchdog
finished, and helper active. User subsequently confirmed HOME, Live TV, and HDMI 1 working. Report:
`dist/webos4/home-test-1793041807507-222828b2.json`. Suite passes 488 tests on Node 8/22 and observer passed smoke test on Node 0.12.
Subsequent icon selection from LG left LG visible per user; capture only collected catalogue writes, without identifiable
launch command. Does not prove alternative recipe. Intercepting HOME prior to stock action remains needed; do not compensate
overlap by closing/hiding windows or enabling observer at boot.

Next trial prepared: `webos4/home-input.c` and `home-input-trial.sh`. Temporary native filter: first requires LG to open
a passthrough device; only then can set aside HOME and forward other keys. **Does not yet open CleanYourTV.** Has
own 120 s limit, 125 s secondary safety, and stop by PID/executable/start time. ARM binary passed self-test and read-only
probe on TV (16-byte events, extended keys, compositor reader found). `check` and filtering not executed:
new remote path requires authorizing that specific trial. No mapping, service, or boot changes at this stage.
498 checks pass on Node 8/22, types, lint, formatting, and build. Following probe, SSH ceased responding; port also
unresponsive in subsequent check. Reason not confirmed nor whether TV is powered on. Stop controller prepared
locally: subsequent copy did not initiate due to connection failure. No active filter or executed `check`.

## HOME and standby delay — diagnosis of 28 October 2026

Read-only inspection: SSH available, bindings `{}`, stock `systemUi.js`, no active HOME filter, and helper stopped.
ARM binary and controller match local copies; `--probe` and `--self-test` pass on TV.
User authorized **`check` only**: ran and failed after five seconds in `wait-for-lg-consumer`, `errno: 2`,
`hadGrab: false`. Acceptance of virtual device not confirmed; remote was not blocked and filter was not run.
Temporary device removed on exit. Local test `node tools/test.js webos4homeinput` fails on Windows
due to missing `linux/input.h`; full suite not rerun and HOME not physically validated in this session.

User measures ~**19.72 s from image disappearance to red standby LED**. Estimates another **0.5–0.7 s from pressing
power-off to image disappearance**: total approximately **20.22–20.42 s from button to standby**.
Main delay occurs with screen already black; user confirms it **did not exist prior to introducing CleanYourTV and its changes**.
Previous log found in
`/var/spool/klog-formatter/previous_fault_logs.tar.gz`: that shutdown listed for `nosignal`, not remote.
Kernel logs `start shutdown.conf` at 3468.882829 and exit status 1 at 3468.896781: ~14 ms later,
without subsequent script markers. On the TV, `/var/luna/preferences/devmode_enabled` is a **directory** and
`com.palmdts.devmode.service/start-devmode.sh` is missing. Initial branch of `/etc/init/shutdown.conf` attempts `rm -f` on that directory:
mechanism consistent with early exit and subsequent wait at shutdown limit. That execution was not traced
or timeout measured; does not yet prove it explains exactly the user's 19.72 s.
**Do not delete that directory or execute shutdown script to test it:** may be part of root preservation.
Only authorized temporary `check` was run; firmware was not changed, TV was not rebooted/powered off, and preexisting debloat was not touched.
Debloat is active at boot
(symlink `15-cleanyourtv-debloat`, mounts for `acr2`/`admanager`); corrects any inference that it was disabled.

Subsequent authorized debugging: HOME diagnostic adds `proxyResolved`. In a new folder **`--check` only** was run:
`proxyResolved: true`, without compositor acceptance in five seconds, `hadGrab: false`. Virtual remote was removed;
bindings `{}` and stock probe remain correct. Rules out virtual path discovery failure in that trial,
but does not identify why LG does not open that device. Do not run filter or add boot based on this result.
529 checks pass on Node 8/22, types/lint/formatting, and Chromium 68/79 on isolated Linux copy with LF;
Windows checkout CRLFs cause failures unrelated to change when executed directly. ARM binary compiled without warnings.

Initial shutdown branch reproduced in local sandbox: `rm -f` on directory gives status 1. Candidate prepared
adding only `&& [ ! -d $DIR/devmode_enabled ]` to that condition; preserves directory and behaviour with file marker
or absent. Syntax, rejection of unknown originals, and replacement of single condition verified.
With express authorization, copy saved in `/media/developer/cleanyourtv/shutdown-trial-20261028/` and candidate mounted
over `/etc/init/shutdown.conf`, followed by `initctl reload-configuration`; job was not started and services not restarted.
Original SHA256 `4d04ec39a7deb73dcb11b9d85fca9fdf7f32700016afa11d6d0d7a99209cc379`;
candidate `b38d52195f8df382c33768d923f5ded1104f63e439130c5a5c4f9bb521add71f`.
Developer Mode directory remains intact. User measured **12 s from black to red LED**, compared to 19.72 s earlier
(7.72 s less in that trial). Subsequent control with original restored gave **also 12 s**, per user.
Therefore, this comparison **does not prove an improvement attributable to patch**. Initial branch error is reproduced,
but relation to standby delay remains unconfirmed; do not install candidate permanently based on these results.
Read-only capture of `/dev/kmsg` to PC, in
`dist/webos4/shutdown-trial/kernel-live.log`, aborted when network dropped during `preparePowerOff`, before final
shutdown markers. After power-on, SSH confirms new uptime, original `shutdown.conf` hash, no mount persistence,
and intact Developer Mode directory. Previous fault file retains its date; no new copy of shutdown appeared.
Manual rollback before power-off: `umount /etc/init/shutdown.conf; initctl reload-configuration`.

### Next isolation: Input Hook 1.5.1

Subsequent inspection confirms Input Hook **1.5.1**, executable boot `inputhook`, bindings `{}`, and library injected
into native processes. `lginput2` initialises hook; `tvservice` hook log remains empty.
External reports exist of [1.5.1 without keystrokes in log](https://github.com/Simon34545/lginputhook/issues/44) and
[the 1.5 series affecting tvservice/video on webOS 4](https://github.com/Simon34545/lginputhook/issues/41).
These are reasons to isolate the component, not a proven cause on this TV or proof that changing versions resolves HOME.

Local boot copy saved in `dist/webos4/backup/inputhook-before-isolation.sh`;
SHA256 `cb8f69d81f1bae6dd50a5f9ebae734f427ccdde97d0248155fe7964503e18733`, original mode 755.
Real Homebrew startup uses `run-parts`, whose `--test` verifies selection without executing scripts.
User authorized temporarily omitting that boot: mode **644** applied, checksum preserved, and `run-parts --test` confirms
only selecting preexisting debloat, without `inputhook`. Current session injection remains until power off/on.
First manual cycle completed. After waiting for SSH availability, verified new uptime, mode 644,
exclusion in `run-parts --test`, absence of marker and Input Hook logs in `/tmp`, and no match
for `libinputhookpp` or `libphp` in process maps. Bindings `{}` and original `shutdown.conf`.
User measured shutdown in that session without hook: **"same"**, approximately 12 s. No improvement observed removing
Input Hook in this comparison; does not resolve incompatibility with HOME or prove cause of initial 19.72 s.
Preexisting debloat remains selected at boot. Input Hook remains mode 644 for isolation;
restoration to mode 755 remains pending and no other change was made to compensate.

User subsequently authorized isolating debloat as well: created empty marker
`/media/developer/cleanyourtv/DISABLE-DEBLOAT`, keeping Input Hook in mode 644. `debloat-undo.sh` was not executed,
stubs were not unmounted, and services were not hot restarted. Marker only prevents scheduling debloat on **next boot**;
does not cancel `sleep 60` that might already be scheduled in current session. Pending manual power off/on and verification
after exceeding 60 s uptime. First boot without both completed: at **64.83 s uptime** verified marker,
Input Hook in mode 644, absence of injected libraries, no `acr2`/`admanager` stubs or debloat hosts lines,
`remotelogger start/running`, and original `shutdown.conf`. User measured **"same"**, approximately 12 s, also without
both components. Available controls show no benefit from shutdown patch, removing Input Hook, or removing
debloat. Do not attribute current delay or initial 19.72 s to any of them without other evidence.
Repeated shutdowns halted while no new testable hypothesis exists.
Input Hook and debloat remain disabled for testing; previous boot states not yet restored.

For HOME, official Input Hook 1.4.0 package prepared **on PC only**, uninstalled:
`dist/webos4/org.webosbrew.inputhook_1.4.0_all.ipk`. SHA256 verified against official manifest:
`5dc3dff1fadd5da30af6f60b237282564491e62d502f2beaeca32c9febf0ecfb`.
Local copies of installed 1.5.1 app and service saved in `dist/webos4/backup/`.
Injector 1.4 is ARM EABI5 with `/lib/ld-linux.so.3`; TV has `libcrypt.so.1`, corresponding to `libcrypt1` variant.
Verifies visible requirements, not execution or IR remote compatibility on this firmware.
User authorized trial **on lginput2 only**. Copied without modifying injector, both PHP and `libcrypt1/libphp.so` to
`/media/developer/cleanyourtv/home-hook14-20261028/`, with hashes checked against local copies from official IPK.
Single injection performed to PID verified as `lginput2`. Injector exited with status 1; keystroke log not created.
Log records signal 4 during bootstrap, cause unisolated. Original process remains alive, in
sleeping state and `TracerPid: 0`, with `libphp` mapped. **Do not repeat injection on that session or consider functional**.
Did not request pressing HOME, did not change bindings, did not load in tvservice, did not install IPK or enable boot.
Log copied to PC: `dist/webos4/inputhook14-inject.log`. User completed recovery power off/on.
At 158.53 s uptime verified **no libphp/libinputhookpp libraries in process maps**, bindings `{}`,
original hashes for `shutdown.conf` and `systemUi.js`, and absence of mounts on both. Partial load removed.
Input Hook continues with mode 644 and `DISABLE-DEBLOAT` marker remains present; test did not enable any new boot.
Injected engine has no hot rollback: recovery from that test requires manual power off/on.
Do not copy foreign engine code into CleanYourTV MIT code; inspected files remain in ignored `dist/`.
Rollback for next boot: `rm -f /media/developer/cleanyourtv/DISABLE-DEBLOAT`.
Do not stop or restart tvservice/compositor to uninject.
Rollback: `chmod 755 /var/lib/webosbrew/init.d/inputhook`. Do not open Input Hook app during comparison, as it may start it.

Inspection of Homebrew startup also explains diagnostic limitation: mounts empty and read-only
`/var/spool/rdxd` and other telemetry paths. Absence of `previous_boot_logs.tar.gz` **does not prove** that shutdown
completed cleanly or that patch eliminated an error. Do not remove those mounts to retrieve logs without authorization.

## Bluetooth — installed 28 October 2026

Standalone service is **active and enabled at boot**, only for already-paired audio device configured in
`/var/lib/webosbrew/cleanyourtv-bluetooth.json` (root, mode 0600). Configuration includes name, address, and signatures of two captures;
it is private and must not be copied to repository. Moved outside `/media/developer`: following user reboots 0777 permissions
were observed there, and first prototype's private read correctly refused to start.

**Critical fix:** calling `btaudiosrc/onClickListener {"button":5,"type":3}` directly is NOT complete acceptance.
Capture showed "Yes" → dialog closes → `com.webos.surfacemanager` sends `{"button":4,"type":3}` (the "No" from `onClose`) →
`bluetooth2/a2dp/disconnect` → `tv_speaker` output. Initial callback success and momentary sound did not demonstrate stability.
The native view only cancels that closing action when its physical button is pressed.

Current version verifies single device, its address, `paired:true`, `pairing:false`, A2DP profile, and active audio.
Waits for `getCurrentState=alertView` and compares calibrated prompt pixels. Sends RIGHT only if seeing "No" selected and ENTER
only after verifying "Yes" selected and view focus. Uses `networkinput/sendSpecialKey`; never calls callback directly.
If language, resolution, layout, focus, or prompt changes, it presses no keys. Calibration is specific to this TV.
Also checks prompt already visible when service starts. On startup, performs at most one A2DP connection to configured device if disconnected and no other audio active.
Does not initiate pairings or repeat connections or keys.

25-second live test with final version: automatic acceptance, audio maintained, and device still connected after completion.
Log contains only native "Yes", without subsequent "No"; user confirmed result. Verified enable → duplicate start
without second process → disable without disconnecting audio → re-enable. First reboot confirmed private process and config, but peripheral did not initiate connection. Added single
A2DP attempt on start: another live test logged exactly one connection, one "Yes", zero "No", and zero disconnections, with audio maintained
and `pairing:false`. Full reboot with this connection logic remains to be repeated. Local tests pass 540 checks on Node 8.12/22, types, lint, formatting, and pages; 38 are Bluetooth.
Module and BMP signatures also tested on real Node 0.12.

Local files: `webos4/bluetooth-accept.js`, `bluetooth.sh`, `25-cleanyourtv-bluetooth`; test `tools/test/webos4bluetooth.test.js`.
On TV: `/media/developer/cleanyourtv/bluetooth/`, log `/tmp/cytv-bluetooth.log`, PID/identity `/tmp/cytv-bluetooth.pid`,
own entry `/var/lib/webosbrew/init.d/25-cleanyourtv-bluetooth`. Transient captures in private directory under `/tmp`
and deleted upon checking; no images saved in repository. Helper, HOME, firmware, and debloat boot remain unchanged.

```sh
sh /media/developer/cleanyourtv/bluetooth/bluetooth.sh status
sh /media/developer/cleanyourtv/bluetooth/bluetooth.sh disable  # removes only its boot and stops only its process
sh /media/developer/cleanyourtv/bluetooth/bluetooth.sh enable   # enables and starts
# With service stopped, trial limits execution to 25 s; start is continuous.
```

`trusted:true` is unsupported by this firmware (error 5); trust state was not changed and pairing was not deleted.
For Luna commands from Node, `spawn` is used with `ignore` stdin (/dev/null), UTF-8 until `close`, response limit, and timeout.
Closing a stdin pipe in first version produced empty responses; do not return to that pattern.

## Continuation: real catalogue and local check, without updater

User requested continuing but keeping this version isolated from software updates. Locally, page already queries
`GET /api/apps` on opening and when entering library. Retains favourites and focus, and maintains last valid list if a failure occurs.
"Update" replaced with "Connection": queries only `GET /api/service` on loopback and displays availability/latency.
No queries for releases, downloads, or installation; normal updater routes remain rejected.
433 tests pass on Node 8/22, types, lint, formatting, build, and Chromium 68/79 checks.
Real list deployed: 25 apps, seven favourites, reachable last row, and valid local connection check (single GET request).
During a read-only capture of HOME code, TV rebooted and cleared `/tmp`; user was away and reason is unknown.
In that incident `reboot` was not sent, HOME was not changed, and no boot entry was added.
After reboot, SSH answers, helper was not started automatically, its file retains checksum, and hook mappings are empty.

Repetition of HOME was stable: opened LG without rebooting, confirmed by user; observed code 773. Two-minute test controller
prepared locally, with rollback and volatile marker; HOME has not been installed or activated on TV.
Subsequently black video reproduced on both sources even from LG, with YouTube in foreground. Recovery reboot performed
using user's prior authorization. User subsequently confirmed both native sources recovered.
Deferred close in page that could execute on returning from an app was removed. Also prepared removal of second
automatic attempt after 2.5 seconds: now a single request to helper, up to ten seconds, without direct fallback.
Both lifecycle changes already deployed, without closing apps, on recovered TV. Helper started manually,
page in foreground with 25 apps, and code verified without closures or fallback. User confirmed first Live TV/HDMI 1 cycle
works in this version. User also confirmed everything works returning from YouTube through Live TV and HDMI 1.
Helper LG Live TV/HDMI commands remain untouched. Unique cause of black screen unproven. Local suite: 450 tests.

## Focus and pending steps for HOME / debloat

Focus translate/scale animation removed to prevent layer changes when selecting cards. Rounded borders
and white ring retained; user confirmed navigation looks good now. Focus change did not alter launch JavaScript or helper.
At that stage connecting real list remained, now completed. Helper boot cycle,
temporary HOME test, and verified recovery remain pending. Inspected hook config still has no mappings.
Original debloat also not directly applicable: uses `systemctl`; TV has Upstart. Candidate inventory only,
without stopping services, editing hosts, changing HOME, or adding boot. Next steps detailed in `docs/webos4.md`.

User subsequently indicated Settings would not open. Read-only queries confirmed `com.palm.app.settings` is installed
but has `visible: false`; helper rejected it when filtering for visible apps. Added exception only for that stock id,
with launch tests without external params, rejection of other hidden apps, and respecting read-only mode.
421 tests pass on Node 8/22, types, lint, and formatting. Corrected helper deployed with backup and `rollback-settings.sh`;
after pressing Settings in UI, LG shows its app running as `overlay`. User confirmed Settings opens and Back works.

## UI refresh: clean look with original icons

User confirmed everything works and requested improving UI only: selected a clean look with real logos and individual app colours.
Approximate SVGs replaced with original icons from installed apps, packaged for offline use. Matte background,
adjusted cards and focus, consistent utility icons, and selection description instead of fixed HDMI status.
Verified on TV (Chromium 53): icons, focus, six library columns, five Inputs columns, and Back in panels.
Helper and full launch and fallback functions remain identical to working version. Previous page backup
and `rollback-ui.sh` script saved on TV. Helper not restarted and HOME, boot, or sources not changed during visual test.
418 local tests, types, lint, and formatting passing; pages also verified in Chromium 68 and 79.

## Restoring Live TV after UI changes

Restored launching without closing other sources: Live TV retains `recent` request captured from LG and HDMI uses id only.
Interface awaits helper confirmation before closing; new design preserved. Tests adapted to that interface:
415 checks pass on Node 8.12 and Node 22, in addition to types, lint, formatting, and generated pages.
Applied to TV helper and page launch functions only, with backup and rollback script.
Helper responded after change, but user confirmed both sources remained black. Full reboot executed with
express authorization; SSH returned and helper did not autostart. User subsequently confirmed Live TV and HDMI 1 work
from LG. Corrected helper started again and CleanYourTV opened: user confirmed Live TV from card and returning
to HDMI 1 with Input work with new interface as well. Helper remains active. No changes to HOME or boot.
This validation occurred after reboot; applying patch alone did not recover video that was already blocked.

## Update: local prototype 0.1.0

The `webos4-compat` branch incorporates initial local implementation of milestone B–D:

- `helper/webos4.js`: minimal isolated API; query by default and manual launch with `--allow-launch`.
- `webos4/src/` and `webos4/app/`: standalone web app, ES5, Flexbox, and remote navigation; cards with names, without icons or advanced features.
- `webos4/service.sh`: manual execution with isolated runtime and stopping own PID; no autostart.
- `python3 webos4/build.py`: generates IPK, helper package, and checksums in `dist/webos4/`.
- Local tests for backend, isolation, origins, stop, interface, and package contents; full suite on Node 8/22 and pages in Chromium 68/79.

Current build and test guide: [`docs/webos4.md`](webos4.md).
**Subsequent live test:** standalone app installed and isolated helper tested on SDK 4.4.0 / Chromium 53 with Node 18.17.1.
Displays 25 apps and browser was opened from a card. Jump to four columns with scrollbar, OK action,
and exact origin of POSTs (`file://com.cleanyourtv.webos4`) fixed. Windows checksums corrected to LF and verified on TV.
User confirms arrows, OK, and Back with physical remote, noting opening stock **Live TV** app yields a black screen.
Helper and page continued responding; LG had placed Live TV in foreground. Returned to HDMI 1 without rebooting. Cause of black
video pending comparison with LG Live TV and antenna reception.
Subsequent notice **Helper unavailable** occurred because test backend had stopped. Started again with `nohup`,
without boot hooks; Refresh retrieves list again and shows **25 apps · Ready**. Helper remains active for manual testing.
Subsequently confirmed HDMI 1 also black and TV worked before tests. Closing/reopening Live TV alone did not
resolve it. Full reboot, expressly authorized, recovered **HDMI and channels**, confirmed by user; SSH also returned.
As temporary protection, `helper/webos4.js` excludes and blocks stock app `com.webos.app.livetv` without invoking Luna. Used from LG.
Exact cause unconfirmed. Reboot stopped manual helper and cleared temp folder; no autostart.
Protected helper subsequently deployed in another temp folder: returns **24 apps**, excludes Live TV, and returns **404** on direct launch attempt,
without executing Luna call. HDMI 1 remained active. Left running manually, without opening prototype or
modifying HOME. **409 checks** pass on Node 8 and Node 22.

**Subsequent fix, validated on TV:** Luna capture showed LG opens Live TV with `reason: "recent"` inside
`params` as well, plus `checkUpdateOnLaunch: false` and `autoInstallation: false`. Prototype sent generic request with `params: {}`.
Exact LG command tested via SSH, via Node bridge, and finally from CleanYourTV card, with authorizations for
tests. User confirmed picture, channel numbers, and return to HDMI 1 working. Capture verified helper request matches
LG's. Temporary Live TV block removed; helper lists **25 apps** again. **410 checks** pass on Node 8/22.
TV not rebooted during this debugging and HOME, INPUT, or boot unchanged. Individual field causing black state
not isolated; complete replacement of launch request validated.
**Pending:** isolate initial cause of freeze, boot, HOME, and port recovery. Current Live TV request and return to
HDMI 1 work in tests. HOME, INPUT, and boot scripts unchanged.
Remainder of this document preserves original investigation and plan; status tables describe starting point.

> **Technical continuity document — 25 October 2026**
> Goal: continue locally the adaptation of [CleanYourTV](https://github.com/lasharor/cleanyourtv-WebOS) to a 2018 LG TV, without repeating diagnostics or blindly applying the original installer.
> **Status: research and partial tests satisfactory; NO CleanYourTV port installed or validated.**

## 0. Quick read: what was achieved

- ✅ SSH as `root` and Homebrew Channel available during latest tests.
- ✅ Node.js **18.17.1** actually running on the TV's ARMv7 via a runtime obtained from a StremCompat IPK, with isolated libraries.
- ✅ `luna-send` functional and queries to LG application APIs confirmed.
- ✅ An *experimental helper* from **Homebar** started with Node 18, served HTTP on `127.0.0.1:8899`, and returned real app list via `luna-send`.
- ❌ Homebar QML package was installed, but was not registered as a launchable application (`errorCode: -101`).
- ❌ **Original CleanYourTV cannot be installed/activated without changes**: requires `systemd`, assumes an installable LG Home at a non-existent path on this TV, and targets webOS 5+.
- 🎯 **Next objective:** a standalone **web** (`index.html`) `.ipk` for CleanYourTV, with an isolated Node 18 backend and without replacing HOME or enabling debloat in the first version.

**Do not confuse:** passing a `--probe` check or starting an HTTP server does **not** mean the interface is integrated into the HOME button, nor that a service will autostart on reboot.

## 1. Test equipment: confirmed data

| Data                           | Value / evidence                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Manufacturer / model           | **LG 65UK6300PLB** (`getSystemInfo`)                                                                         |
| Firmware                       | **05.50.70** (`getSystemInfo`)                                                                               |
| webOS SDK reported by LG       | **4.4.0** (`getSystemInfo`)                                                                                  |
| Version detected by Homebar    | **webOS 4.4.3** (`install.sh --probe`); distinct nomenclature/check, does not replace SDK fact               |
| Year / family                  | UK6300, 2018 generation                                                                                      |
| Architecture                   | `armv7l`                                                                                                     |
| System Node.js                 | **v0.12.2**                                                                                                  |
| libc                           | **glibc 2.24**; `/lib/libc.so.6 -> libc-2.24.so`                                                             |
| Present ELF loader             | `/lib/ld-linux.so.3 -> ld-2.24.so`                                                                           |
| Common ARM hard-float loader   | `/lib/ld-linux-armhf.so.3` **does not exist**                                                                |
| Service init                   | **Upstart**, via `/sbin/initctl`; `systemctl` not found                                                      |
| Observed Upstart processes     | `surface-manager` and `sam` in `start/running` state                                                         |
| Homebrew hook                  | `/var/lib/webosbrew/init.d/` exists                                                                          |
| Access                         | Confirmed SSH sessions under `root` (access experienced an interruption, see §8)                             |
| Input Hook                     | `org.webosbrew.inputhook` **1.5.1** installed with status `installed` (`statusValue: 30`)                    |

**Available capacity in one test:** `/tmp` had ~299.4 MiB free and the volume holding `/media/developer` ~267.3 MiB. **Re-check `df -h`**: these are not permanent values. `/tmp` is temporary and lost on reboot.

Query confirming the model:

```sh
luna-send -n 1 -f   luna://com.webos.service.tv.systemproperty/getSystemInfo   '{"keys":["modelName","firmwareVersion","sdkVersion"]}'
```

Relevant response:

```json
{ "modelName": "65UK6300PLB", "firmwareVersion": "05.50.70", "sdkVersion": "4.4.0", "returnValue": true }
```

### LG's Home is not what newer projects expect

- `/usr/palm/applications/com.webos.app.home/appinfo.json` does not exist.
- `getAppInfo` for `com.webos.app.home` returned `Invalid appId specified OR Unsupported Application Type`.
- QML `find` located, among others, `com.webos.app.livemenu/qml/Controllers/UIController.qml` and `com.webos.app.mystarter/qml/main.qml`.
- **`com.webos.app.mystarter` must NOT be confused with HOME**; `livemenu` is also unconfirmed as a HOME launcher.
- The component that implements and triggers the model's stock HOME has not been unequivocally identified. It may depend on `surface-manager`/native components, but remains an **unproven hypothesis**.
- No evidence that copying/bind-mounting another generation's application at `com.webos.app.home` path will work.

## 2. Repositories and starting files

### Main code

- [lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) — project to port.
- Local source provided: `cleanyourtv-WebOS-main.zip`, **snapshot** whose internal folder is `cleanyourtv-WebOS-main/` and whose Git archive identifier in the ZIP starts with `f5325dc28952...`.
- In **that snapshot**: `helper/helper.js` declares version **1.6.4** and `manager/app/appinfo.json` version **1.4.0**. Do not automatically equate these versions with the repository's latest release.
- The official project documents compatibility with **webOS 5 or newer**. In the snapshot, `compat.json` does not include this firmware.

### Reference projects

- [rawinek/webos-homebar](https://github.com/rawinek/webos-homebar) — used to investigate HOME, QML, and overlay; tested IPK identified app as `org.rawin.launcher`, version **0.16.0**.
- [Simon34545/lginputhook](https://github.com/Simon34545/lginputhook) / [Input Hook on Homebrew](https://repo.webosbrew.org/apps/org.webosbrew.inputhook/) — package installed and detected by Homebar.
- [Alexesmm/stremcompat-lg-webos](https://github.com/Alexesmm/stremcompat-lg-webos) — source of a **Node 18 ARMv7** binary and its libraries packaged in an `.ipk`. Only **files were extracted**; StremCompat was not installed.
- [webOS-ports/webos-systemd-services](https://github.com/webOS-ports/webos-systemd-services) — **does not resolve** missing `systemd` in LG firmware: contains Open webOS/webOS Ports unit definitions, not an installable replacement for TV init.

## 3. Reproduction: modern Node.js on webOS 4

### 3.1 What failed

The official archive was downloaded and extracted:

```text
node-v8.17.0-linux-armv7l.tar.gz
```

Although the executable existed (~30.1 MiB, permissions `-rwxr-xr-x`), running it with full path or `./node -v` failed:

```text
-sh: ./node: not found
```

**Probable interpretation:** ELF interpreter/ABI incompatibility with vendor environment, consistent with absence of `/lib/ld-linux-armhf.so.3`. **`readelf` was not run on the TV**, so specific ELF interpreter required by official binary remains unverified. Being in the `bin` directory and typing only `node -v` ran the **original Node 0.12.2** via `PATH`, not the local file.

**Do not create symlinks in `/lib`, alter global libraries, or overwrite `/usr/bin/node`.**

### 3.2 What worked: binary from StremCompat IPK

Paths used in SSH session:

```text
/media/developer/node-test/stremcompat.ipk
/media/developer/node-test/runtime/usr/palm/services/io.strem.tv.server/bin/node18
/media/developer/node-test/runtime/usr/palm/services/io.strem.tv.server/bin/lib/
```

Inside the IPK we found:

```text
usr/palm/services/io.strem.tv.server/bin/node18
usr/palm/services/io.strem.tv.server/bin/lib/libatomic.so.1
usr/palm/services/io.strem.tv.server/bin/lib/libcares.so.2
usr/palm/services/io.strem.tv.server/bin/lib/libcrypto.so.3
usr/palm/services/io.strem.tv.server/bin/lib/libnghttp2.so.14
usr/palm/services/io.strem.tv.server/bin/lib/libssl.so.3
usr/palm/services/io.strem.tv.server/bin/lib/libstdc++.so.6
usr/palm/services/io.strem.tv.server/bin/lib/libuv.so.1
# and their associated real files / symlinks
```

At first only `node18` and `libstdc++` were extracted; resulted in:

```text
./node18: error while loading shared libraries: libuv.so.1: cannot open shared object file
```

After extracting the **entire `bin/lib/` directory**, Node worked.

**Reference commands to reconstruct extraction** (if `.ipk` exists at indicated path; local operation to test directory, without installing package):

```sh
cd /media/developer/node-test
mkdir -p runtime
ar p stremcompat.ipk data.tar.gz | tar -xzf - -C runtime   usr/palm/services/io.strem.tv.server/bin/node18   usr/palm/services/io.strem.tv.server/bin/lib/
```

**Verified real command:**

```sh
BASE=/media/developer/node-test/runtime/usr/palm/services/io.strem.tv.server/bin
/lib/ld-linux.so.3 --library-path "$BASE/lib:/lib:/usr/lib" "$BASE/node18" -v
# v18.17.1
```

Do not infer compatibility for any other Node from this test: depends on **this binary, its architecture, and these libraries**.

### 3.3 Tested isolated wrapper

Created:

```text
/media/developer/homebar-test/node18-path/node
```

Content:

```sh
#!/bin/sh
BASE=/media/developer/node-test/runtime/usr/palm/services/io.strem.tv.server/bin
exec /lib/ld-linux.so.3 --library-path "$BASE/lib:/lib:/usr/lib" "$BASE/node18" "$@"
```

Confirmed test:

```sh
PATH="/media/developer/homebar-test/node18-path:$PATH" node -v
# v18.17.1
```

**Important for CleanYourTV:** project scripts set `PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH` or run `node` explicitly. The wrapper is only useful when called **by absolute path** or when a process retains an appropriate `PATH`. Do not assume it transfers from installer to automatic boot. Better to prepare a dedicated, stable wrapper for the port, e.g. under `/media/developer/cleanyourtv-webos4/runtime/` (not yet created).

## 4. What Homebar tests taught

Homebar **is not the current goal**; it was a very valuable proof of concept.

### 4.1 Installer compatibility

With `node v0.12.2`:

```text
rawin-launcher: Home panel: does not fit
rawin-launcher:   LG Home is not a QML app (no /usr/palm/applications/com.webos.app.home/qml/main.qml)
rawin-launcher: overlay: does not fit
rawin-launcher:   the helper needs node 8 or newer; this TV has node v0.12.2
```

After installing Input Hook and prepending Node 18 wrapper to `PATH`:

```text
rawin-launcher: overlay: fits
rawin-launcher:   the Homebrew Channel, Input Hook and node v18.17.1 are there
```

**Caution:** that `--probe` did not exercise the service at runtime. Without wrapper, the same `--probe` continued rejecting Node 0.12.

### 4.2 LG native modules problem

Checked:

```text
/usr/lib/node_modules/webos-service
/usr/lib/nodejs/pmloglib.node
/usr/lib/nodejs/webos-sysbus.node
/usr/lib/nodejs/webos.node
/usr/bin/run-js-service
```

Loading `require('webos-service')` with Node 18 produced:

```text
pmloglib.node was compiled using NODE_MODULE_VERSION 14
Node.js 18 requires NODE_MODULE_VERSION 108
```

**These are not interchangeable binary modules.** Do not attempt to fool `run-js-service` by changing Node version without addressing native dependencies.

### 4.3 Experimental helper: partial success

`service.js` was extracted from Homebar IPK, and in its test copy a **replacement module** `node_modules/webos-service/index.js` was created implementing basic Luna calls via `luna-send` executable. Did not register a real Luna service: `register()` was a no-op. Automated features in that copy were partially disabled for test. **Not a production-ready bridge or generic `webos-service` solution.**

Observed results:

```text
GET http://127.0.0.1:8899/ping
{"ok":true,"pid":6058,"rss":23801856,"node":"18.17.1"}

GET http://127.0.0.1:8899/apps
{"returnValue":true,"apps":[{"id":"com.telefonica.app.nux","title":"Movistar Plus+",...}, ...]}
```

List included real apps (Live TV, Netflix, Disney+, Spotify, Movistar Plus+...). **Icons returned empty strings in the sample**; icon cache was not verified.

Subsequent manual test launched another process with PID **6197**; only the PID of that specific execution, **must not be used as a permanent identifier**. Helper may continue running if not stopped. Check `127.0.0.1:8899/ping` before starting another server.

### 4.4 Homebar QML interface could NOT be launched

Installed IPK `org.rawin.launcher` version **0.16.0**. Installer returned `statusValue: 30`, status `installed`, leaving these files:

```text
/media/developer/apps/usr/palm/applications/org.rawin.launcher/appinfo.json
/media/developer/apps/usr/palm/applications/org.rawin.launcher/main.qml
```

Its `appinfo.json` declares:

```json
{
  "id": "org.rawin.launcher",
  "version": "0.16.0",
  "type": "qml",
  "main": "main.qml",
  "defaultWindowType": "overlay",
  "visible": false
}
```

However:

```text
getAppLoadStatus {"appId":"org.rawin.launcher"} -> "exist": false
getAppInfo {"id":"org.rawin.launcher"} -> Unsupported Application Type
launch {"id":"org.rawin.launcher"} -> errorCode: -101, errorText: "not exist"
```

`/usr/bin/qml-runner` exists, **but its presence does not prove** webOS 4 supports launching third-party QML installed in `/media/developer` via the application manager. A safe standalone QML runner was not tested. IPK may remain installed despite being unlaunchable.

**Useful takeaway:** for first CleanYourTV version, prioritise `type: "web"` and HTML interface and **do not** depend on QML.

## 5. CleanYourTV anatomy reviewed in ZIP

### 5.1 Essential files

| Repository path                                     | Purpose / what to change                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `install.sh`                                        | Downloads and installs **manager app**, but blocks webOS 4; not suitable installer for our prototype.              |
| `scripts/bootstrap.sh`                              | Preflight, file copying, boot configuration, launcher copying, bind mount, and reboots. **Do not run without porting.** |
| `scripts/10-cleanyourtv-home`                       | Starts `node helper.js`, prepares HOME mount, uses `systemctl restart sam`; **incompatible**.                       |
| `scripts/stage-home.sh`                             | Generates HOME overlay starting from `/usr/palm/applications/com.webos.app.home`; path **does not exist**.          |
| `scripts/undo-home.sh`, `reload-home.sh`            | Rollback/reload designed for recent version Home; do not assume valid on this TV.                                   |
| `helper/helper.js`                                  | Root Node service (snapshot: version 1.6.4), port `127.0.0.1:8765`.                                                |
| `helper/luna.js`                                    | Uses `luna-send` subprocess and JSON; **no** `require('webos-service')`. A key advantage.                           |
| `helper/paths.js`                                   | State paths; supports environment variables to isolate test runs.                                                   |
| `helper/server.js`                                  | API routes and **`Origin` restrictions**: verify for a new app ID.                                                  |
| `helper/apps.js`, `helper/running.js`               | Inventory, launching, running apps: candidates for first phase.                                                     |
| `helper/config.js`, `helper/tvprofile.js`           | State, TV profile, and compatibility: review default values/side effects.                                           |
| `app/src/index.html`, `app/src/css/`, `app/src/js/` | Frontend sources; edit here, **not only generated `app/index.html`**.                                               |
| `tools/build-pages.js`                              | Builds distributable `app/index.html`.                                                                              |
| `manager/app/appinfo.json`                          | Example real webOS app with `"type":"web"` and `"main":"index.html"`.                                               |
| `ipk/build-ipk.py`                                  | Local IPK generator from directory containing `appinfo.json`.                                                       |
| `tools/check.sh`, `tools/test/`                     | Base for port regressions.                                                                                          |

### 5.2 Specific script blocks

`install.sh` performs a combined check like:

```sh
command -v systemctl >/dev/null && node -e '(()=>1)()' >/dev/null 2>&1   || die "this TV is too old ..."
```

`bootstrap.sh` checks `systemctl` and Node **again**, plus existence of:

```text
/usr/palm/applications/com.webos.app.home/appinfo.json
```

The comment in `bootstrap.sh` itself notes that **`--force` does not bypass hard requirements**. Thus it is not enough to change `PATH`, suppress a check, or install `systemd` configurations from webOS Ports.

`scripts/10-cleanyourtv-home` creates a bind mount of `home-overlay` over `/usr/palm/applications/com.webos.app.home`, restarts `sam` with `systemctl`, and monitors service. This mechanism **is untested and unsuitable** for our TV's native HOME.

### 5.3 API and frontend: potential advantages and risks

- Official API listens only on `127.0.0.1:8765`; useful read endpoints: `/api/version`, `/api/service`, and `/api/apps` (see `docs/api.md`).
- Backend calls Luna via `luna-send` (`helper/luna.js`), so **it should not reproduce Homebar's ABI error with `webos-service`**. Does not prove all endpoints work on webOS 4.
- `helper/helper.js` loads multiple modules and executes `start()` when opening server; may activate checks, settings, or secondary functions. **Do not run as root on TV without prior audit/safe mode.**
- `helper/server.js` authorizes `null` origins and certain `file://<appId>-webos`. If new app identifies as, for example, `com.cleanyourtv.webos4`, **a precise origin policy must be defined**, verifying what `Origin` Chromium 53 sends. Do not open CORS to all HTTP origins or change binding to `0.0.0.0`.
- Launcher CSS uses `display: grid` and `grid-template-columns`; **Chromium 53 predates stable modern CSS Grid support**. Fallback needed (e.g. Flexbox or positioned layout), testing remote control focus, HDMI input, 1920×1080 resolution, fonts, and animations.
- Snapshot internal documentation only explicitly checks Chromium **68 and 79**, not 53. Do not assume frontend webOS 4 compatibility without testing.

## 6. Recommended strategy for local port

### Phase A — prepare local fork (without touching TV)

1. Create `webos4-compat` branch from CleanYourTV snapshot/repo, preserving originals.
2. Clearly document separation between `installer manager`, `helper Node`, and `web frontend`.
3. Create a test mode **without bootstrap** using separate paths, not modifying Home or Input Hook.
4. Maintain a table of compatible, pending, and security-disabled features.
5. Run repository tests on PC (`sh tools/check.sh`) before and after changes; may download runtimes for tests.

### Phase B — minimal isolated backend (without hooks or advanced features)

Goal: Node 18 invoked **via absolute wrapper** returns correct responses to:

```text
GET http://127.0.0.1:8765/api/version
GET http://127.0.0.1:8765/api/service
GET http://127.0.0.1:8765/api/apps
```

Required work:

- Use `CYTV_DIR` and other variables from `helper/paths.js` for a test directory **not shared** with an official installation.
- Audit `helper/helper.js`, `manager`, `inputkey`, `notify`, `voice`, `tvprofile`, and any `.start()`; create a **read-only profile** that does not schedule updates, inject hooks, modify hosts, or alter apps.
- Confirm identifiers returned by Luna on webOS 4 can be launched via `com.webos.applicationManager/launch`.
- Manage permissions (`root` only when truly necessary), resource limits, errors, and an explicit script to stop **own PID only**.
- Check any port before binding and preserve logs under a test directory.

**Note:** Homebar HTTP prototype was distinct from CleanYourTV and listened on `8899`. Do not directly reuse that incomplete `webos-service` bridge in this project.

### Phase C — standalone web .ipk

Create, for example, local directory `webos4/app/` with:

```text
webos4/app/
├── appinfo.json
├── index.html
└── icon.png
```

Example **proposed, not installed or tested**:

```json
{
  "id": "com.cleanyourtv.webos4",
  "version": "0.1.0",
  "vendor": "community-port",
  "type": "web",
  "main": "index.html",
  "title": "CleanYourTV webOS 4 (test)",
  "icon": "icon.png",
  "visible": true
}
```

Local build (once contents of `webos4/app/` are prepared):

```sh
python3 ipk/build-ipk.py webos4/app/ com.cleanyourtv.webos4_0.1.0_all.ipk
```

**Minimum validation on TV:** installation `statusValue: 30`, `getAppLoadStatus.exist: true`, `getAppInfo.returnValue: true`, manual launch successful, frontend/backend HTTP without errors, and full remote navigation. Do not assume `statusValue: 30` guarantees app can open (Homebar QML demonstrated otherwise).

### Phase D — visual compatibility with Chromium 53

- Check `app/src` interface in equivalent engine and especially on real TV.
- Replace CSS Grid with progressive layout with fallback; review JS APIs, remote events, and `localStorage` usage.
- Verify opening apps, inputs, and settings does not cause unwanted side effects.
- Measure memory and response times without loading extra services.

### Phase E — boot and HOME (only after A–D work)

- Investigate a single reversible hook in `/var/lib/webosbrew/init.d/` **with a mechanism to disable it prior to next boot**.
- Maintain system Node 0.12 intact; each custom service calls its own absolute wrapper.
- Evaluate HOME button with **LG Input Hook**; do not treat compatible Homebar `--probe` as definitive proof remapping will work.
- Do not modify `surface-manager`, replace `sam`, or mount over non-existent HOME paths.
- Test power off/on, root recovery, and a rollback plan **before** automating anything.

### Features excluded from first prototype

**Debloat, HOME/INPUT changes, auto-update, voice, notifications, IPTV playback, and `/etc/hosts` modifications.** Incorporated, if appropriate, after validating launcher, apps, inputs, and persistence.

## 7. Grouped diagnostic commands (read-only)

To avoid repeating small tests, use this block in a **root** SSH session when resuming work:

```sh
(
  echo '=== IDENTITY / FIRMWARE ==='
  id
  uname -m
  luna-send -n 1 -f     luna://com.webos.service.tv.systemproperty/getSystemInfo     '{"keys":["modelName","firmwareVersion","sdkVersion"]}'

  echo '=== SYSTEM NODE ==='
  node -v
  ls -l /lib/ld-linux.so.3 /lib/libc.so.6

  echo '=== ISOLATED NODE ==='
  BASE=/media/developer/node-test/runtime/usr/palm/services/io.strem.tv.server/bin
  if [ -x "$BASE/node18" ]; then
    /lib/ld-linux.so.3 --library-path "$BASE/lib:/lib:/usr/lib" "$BASE/node18" -v
  else
    echo 'Node 18 runtime not found at previous path'
  fi

  echo '=== BOOT AND HOMEBREW ==='
  command -v initctl
  initctl list | grep -E 'sam|surface-manager' || true
  ls -ld /var/lib/webosbrew/init.d
  ls -l /var/lib/webosbrew/init.d 2>/dev/null

  echo '=== STORAGE ==='
  df -h /tmp /media/developer

  echo '=== EXPERIMENTAL HOMEBAR HELPER STATUS ==='
  wget -q -O - http://127.0.0.1:8899/ping || true
  echo
) 2>&1
```

**Paths are those observed during experiment**. May not exist after wipe, reinstallation, or root recovery. Network IPs replaced with `<IP_TV>` and `<IP_PC>`; no personal data recorded in repository.

## 8. Reboot incident and safety measures

During experiments an **unexpected shutdown/reboot** occurred and Homebrew Channel icon temporarily disappeared, while Developer Mode reappeared. Root SSH session was subsequently recovered and investigation resumed.

**Shutdown cause was not determined.** Do not attribute to `wget`, Node, Homebar, Input Hook, or an exploit without logs proving it.

Rules to avoid repeating incident:

1. **Do not run** stock `install.sh`, `bootstrap.sh install --force`, or `10-cleanyourtv-home` on webOS 4.
2. **Do not install `systemd`**, replace Upstart, restart `sam`/`surface-manager`, write to `/usr`, or link system libraries as a quick fix.
3. Do not start automatic root services or HOME/INPUT hooks before verifying stop and rollback.
4. Do not run uninspected `curl ... | sh` sources. Download identified releases, inspect, and verify checksums if available.
5. Keep modifications in an explicit directory under `/media/developer/`; distinguish persistent tests from files in `/tmp`.
6. Do not expose root ports on network interfaces; prefer **`127.0.0.1`**. Audit frontend origins and mutating endpoints.
7. Record in each test: command, date, file/versions, output, state change, and rollback method.
8. If root is lost, **prioritise recovering previous state** before continuing port. Developer Mode presence alone does not prove root vanished.

### Pending cleanup from Homebar stage

- Non-launchable IPK `org.rawin.launcher` may remain installed.
- Experimental HTTP helper on port `8899` may remain active if subsequent test was not terminated.
- Directories `homebar-test`, `node-test`, and tarballs in `/tmp` may remain.

**Do not blindly delete files or kill processes by name or historical PID**; inspect state first and use appropriate uninstall/cleanup procedures. Official Homebar boot hook was not created during these tests based on executed blocks; verify `init.d` before assuming.

## 9. Validation matrix for future version

| Test                                                        | Current status                 |
| ----------------------------------------------------------- | ------------------------------ |
| Root and webOS 4 tooling                                    | ✅ Confirmed during tests      |
| Node 18 with compatible libraries                           | ✅ Confirmed (`v18.17.1`)      |
| Luna and app list via experimental bridge                   | ✅ Confirmed for Homebar       |
| **CleanYourTV** backend on Node 18                          | ⬜ Untested                    |
| CleanYourTV backend in safe mode, without side effects      | ⬜ Pending implementation      |
| CleanYourTV launcher on Chromium 53                         | ⬜ Untested                    |
| Installable and launchable webOS 4 CleanYourTV `.ipk`       | ⬜ Not built                   |
| Apps, favourites, and HDMI inputs                           | ⬜ Unvalidated on CleanYourTV  |
| HOME button with Input Hook                                 | ⬜ Unvalidated                 |
| Persistent boot / rollback after reboot                     | ⬜ Not implemented or tested   |
| Debloat, IPTV, voice, notifications, updates                | ⬜ Outside initial scope       |

## 10. Next session: start here

1. **On PC:** clone/unpack CleanYourTV snapshot and create `webos4-compat` branch.
2. **On TV:** run grouped diagnostic in §7 and confirm isolated Node 18 runtime still exists.
3. **In code:** review `helper/helper.js`, `helper/apps.js`, `helper/paths.js`, `helper/server.js`, and module `start()` methods. Add safe mode reading info only and answering minimal API.
4. **In code:** prepare `webos4/app/appinfo.json` + `index.html` of type `web`; use `app/src/` as original source and create layout fallback for Chromium 53.
5. **On PC:** build local `.ipk` with `ipk/build-ipk.py` and verify content before deploying to TV.
6. **On TV:** test **without hooks**, without HOME changes, and without debloat. After validating standalone app, design HOME remapping and reversible boot.

**Success criterion for first milestone:** CleanYourTV opens from standard webOS 4 application list, displays real apps, and launches at least one application via isolated backend, without modifying stock LG HOME.

---

### Notes on provenance and scope

This document combines: (1) results of commands actually executed on the TV during conversation, (2) reading `cleanyourtv-WebOS-main.zip` archive, and (3) public documentation of linked repositories. Architecture proposals and build commands for **new** port are plans, **not completed steps**. For significant upstream changes, reverify specific repository revision and run its test suite.

Additional links: [CleanYourTV documentation](https://lasharor.github.io/cleanyourtv-WebOS/), [webOS Homebrew](https://www.webosbrew.org/), [StremCompat](https://github.com/Alexesmm/stremcompat-lg-webos), [Homebar](https://github.com/rawinek/webos-homebar).
