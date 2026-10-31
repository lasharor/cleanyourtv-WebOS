# Repository validation — 30 October 2026

Original UI trial and read-only backup preparation are now documented separately in [the trial guide](webos4-original-trial.md).
The TV was unreachable during preparation. After it was turned on, a verified 231-entry backup and the read-only installer inventory
were completed; see [the installer-port record](webos4-installer-port.md). The extended original installer subsequently installed and
started the separate original-UI candidate. The user confirmed its UI/icons and the physical YouTube → candidate → native LG TV → HDMI 1
sequence with picture, sound and remote control. System Node 0.12.2 also installed the verified isolated Node 18.17.1/library tree;
the stable installation hashes remained unchanged. Fresh-install embedded-bridge support is locally tested; that newer kit has not
replaced the physically accepted candidate. Persistent original-HOME activation and a full backup restore remain untested.
The stable version and HOME remain unchanged. The candidate reuses upstream UI/modules in a separate app/state/port, with launches
delegated once to the validated helper; no updater or boot integration is started. Its separate checks include backup archive integrity
and original-page rendering in Chromium 68/79. Physical compatibility and source video/audio remain pending for this new candidate.

Prepared on branch `codex/webos4-port` from upstream snapshot `c0eb94c`, in the Downloads checkout.
The original Desktop research checkout was used as evidence/source and its existing changes were preserved.

## Previous compatibility checks — 29 October 2026

Validation used an isolated Linux copy with LF line endings, Python 3, GCC and the project's existing development dependencies/cache.
This avoids Windows shell/line-ending failures without changing source firmware or connecting to the TV.

| Check                                         | Result                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sh tools/check.sh --chromium`                | Passed                                                                                                                |
| Node 8.12.0 suite                             | 846 checks across 35 files passed                                                                                     |
| Node 22.23.4 suite                            | 846 checks across 35 files passed                                                                                     |
| Original API golden replies                   | Passed without fixture changes                                                                                        |
| Page generation, TypeScript, ESLint, Prettier | Passed                                                                                                                |
| Chromium 68 and 79                            | Launcher, manager, picker and webOS 4 page passed; six columns, offline icons, static focus checked                   |
| `python3 ipk/build.py`                        | Normal package built                                                                                                  |
| `python3 webos4/build.py`                     | Standalone IPK, helper and optional addons archives built with SHA-256 files                                          |
| Final addon allowlist change                  | 17 packaging checks rerun on both Node versions; passed                                                               |
| Shutdown comment correction                   | Seven focused checks rerun; passed                                                                                    |
| HOME generator                                | Known private original produced the expected final digest; no LG file copied into the contribution                    |
| Final HOME reload                             | 23 synthetic checks cover configd reload, both path spellings, original fallback, guards and uncertain-write rollback |
| Robust Bluetooth                              | 51 checks cover bounded focus/pixel waits, fresh device checks before keys, cancellation and no uncertain-key retries |
| UI preservation                               | All 126 interface/theme files matched their pre-change SHA-256 digests byte for byte                                  |
| `git diff --check`                            | Passed                                                                                                                |

The package check verifies separate addons include debloat/undo/HOME generation without firmware, runtime or private state.
The five new debloat checks exercise apply, idempotence, undo, disable marker and foreign mounts against fake commands/files.
HOME boot tests now use synthetic originals/patches/digests, so another clone does not need proprietary firmware to run them.

## Code review

Reviewed the shared-helper changes, their callers, exposed routes, packaging boundaries, HOME generation and debloat rollback.
The newer upstream cards/uninstall/pinned-input logic is retained. Card settings load their optional implementation lazily; the
standalone API cannot reach that settings operation. App cache failures clear the pending request and failed background refreshes
keep their last good catalogue. Origin customization is restricted to the isolated server instance.

The initial review found and resolved packaging dependency drift, proprietary HOME fixture dependencies, stale hosts restoration,
foreign mount handling and misleading shutdown-speed wording. Optional artifacts now use a fixed allowlist rather than directory inclusion.

| Severity | Unresolved findings | Status |
| -------- | ------------------- | ------ |
| Critical | 0                   | pass   |
| High     | 0                   | pass   |
| Medium   | 0                   | pass   |
| Low      | 0                   | pass   |

Verdict: APPROVE for the documented local experimental contribution. Physical limitations remain in [the status matrix](webos4.md).
This is not approval to install, restart TV graphics, enable boot hooks or release general webOS 4 support.

No fresh physical TV checks, TV changes, push, tag, release or PR creation were performed in this repository preparation.
The accepted final research boot retained the initial compositor, served 25 apps and kept the last-source choice without the LG menu.
It recorded a real Bluetooth `accepted` event and the configured peer connected through A2DP. The user confirmed uninterrupted HDMI
picture/audio and that everything worked. The imported HOME and Bluetooth code matches those final validated fixes; the runtime,
private calibration and LG firmware were not imported. The revised public debloat and new deployment layouts still need device validation.
Chromium 68/79 cannot prove Chromium 53 behavior. Hardware observations remain explicitly separated from this repository check run.

## Final compatibility synchronization

Updated this existing Downloads checkout on `codex/webos4-port`, preserving its newer upstream app/card, wallpaper, translation and
manager functionality. The final HOME controller and both pinned key-filter templates are included in the optional addons archive;
all three webOS 4 artifacts have verified checksums. Node 18 remains a separately supplied isolated runtime, with system Node preserved.
No launcher, manager, picker, notification, standalone-page or theme file was edited in this synchronization. Builds/checks ran on an
isolated LF copy, so page generation did not rewrite the user's working UI files. Both normal and standalone packages were rebuilt.
The normal webOS 5+ installer remains unchanged; firmware-specific webOS 4 tools keep their deployment/hash guards and opt-in behavior.
No TV changes or repository publication were performed. AI assistance: OpenAI Codex.

## Completion synchronization — 30 October 2026

The user confirmed that the research installation now works completely and requested the remaining material be added.
Imported the final Up/OK navigation regression and page source, the latest bilingual investigation logs and exact tested debloat/undo
snapshots with provenance checks. Snapshots remain separate from the revised public hosts-mount scripts and are never executed by packaging.
The historical boot-wrapper template and its delayed-disable limitation are documented without creating another executable boot hook.
HOME/helper, last-source startup, Netflix, shutdown guard and robust Bluetooth remain the accepted research-session state.
No TV connection, repeated hardware sequence, installation, restart, commit, push or release was performed for this synchronization.
The earlier UI-preservation statements describe the previous compatibility synchronization; this one deliberately imports the tested
standalone navigation correction and rebuilds its page. Other interface sources and the newer upstream functionality are preserved.

Code review: the navigation change only removes the dock exception for Up; OK/click, Back and native activation remain unchanged.
The addon allowlist now preserves nested archive names for the reference snapshots and includes the Bluetooth guide in the manual bundle.
Snapshot tests verify exact normalized research digests and shell syntax without running them. No new active services or settings are introduced.

Final verification: sh tools/check.sh --chromium passed with 850 checks in 35 files on both Node 8.12.0 and Node 22.23.4,
including original API replies, types, lint, formatting, page generation and Chromium 68/79. Normal and standalone packages rebuilt.
Full output is retained locally in ignored dist/webos4/check-20261030.log. No new hardware tests were requested or performed.

## Original installer and runtime milestone — 30 October 2026

This later milestone supersedes the historical preparation-only status above. The extended original installer completed the separate
candidate installation/start/show on the TV; the user accepted UI/icons and the full physical source sequence. A verified backup
contains 231 entries. System Node 0.12.2 installed the pinned isolated Node 18.17.1 and libraries into their new private version path.
Subsequent read-only `check`/`status` confirmed that the candidate remains running and protected stable hashes still match the backup.

The latest kit also supports an absent research helper by hosting the unchanged native bridge within the original helper process.
Its startup, occupied-port refusal, exact native payloads and shutdown are covered locally; this newer release has not overwritten
the physically accepted candidate. No source automation was mixed with the user's physical validation.

| Check | Result |
| --- | --- |
| `sh tools/check.sh --chromium`, Node 8.12.0 | 910 checks in 39 files passed |
| Same suite, Node 22.23.4 | 910 checks in 39 files passed |
| Types, service/page lint, formatting | Passed |
| Chromium 68/79, including original candidate page | Passed |
| Original candidate/runtime/setup focused cases | 53 passed within each full suite |
| Kit build with verified local runtime | Passed; private artifacts/checksums in ignored `dist/` |
| `git diff --check` | Passed |

Full output: local ignored `dist/webos4/check-original-runtime-20261030.log`.
Review covered installer call sites, process ownership, uncertain-operation handling, runtime staging/checksums, module boundaries,
source payload preservation and documented hardware limits.

### Review summary

| Severity | Count | Status |
| --- | --- | --- |
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: APPROVE for this scoped experimental milestone. Persistent original-HOME activation, a full backup restore, the fresh-owned
bridge on a second TV and excluded feature modules have not been hardware-validated. Public runtime redistribution still needs
documented provenance and component licences. No release, tag, push or PR was created.

## PR preparation — final checkpoint, 30 October 2026

Rebased the contribution onto upstream `dev` at `e40777a2834e52c5ae191c0302eee79653710eaa`, incorporating its 18 newer commits.
The ordinary generated launcher/manager/picker pages and API golden replies have no contribution diff against that base.

| Final check | Result |
| --- | --- |
| `sh tools/check.sh --chromium`, Node 8.12.0 | 948 checks in 40 files passed |
| Same suite, Node 22.23.4 | 948 checks in 40 files passed |
| Types, service/page lint, formatting | Passed |
| Chromium 68 and 79, including original UI | Passed |
| Original installer kit packaging regressions | Passed in both suites; exact payload manifest, exclusions and checksums |
| Standard, standalone/addons and original-with-runtime builds | Passed |
| Zensical 0.0.71, `build --strict` | Passed with no issues; two stale research links corrected |
| Pinned public runtime source | Source IPK and all 14 extracted files match fixed SHA-256 values |
| Python backup/runtime-source tests | Six cases passed, also invoked by both full suites |
| Contribution whitespace/privacy/artifact review | Passed; existing example addresses and a synthetic test peer are not TV data |

The runtime is now reproducible from the fixed public release using `webos4/prepare-runtime.py`; no source app is installed or
executed. Binary outputs remain local and private. App artwork copied during research was moved outside the contribution;
the standalone page reads icons from installed apps through its loopback helper. Redistribution boundaries are documented in
`docs/webos4-runtime.md` and `THIRD-PARTY.md`.

Final review revisited archive trust boundaries, process identity, failure/no-retry behavior, manifest pinning, local icon reads,
packaging exclusions and upstream integration. CRITICAL/HIGH/MEDIUM/LOW: 0/0/0/0. Verdict: APPROVE for an experimental PR.
The latest UI after rebase, helper-served standalone icons and fresh-owned bridge have local validation; no new TV changes or
physical acceptance test were performed for this checkpoint. Earlier user-confirmed source/video results retain their revision limits.
Persistent original-HOME activation, a full restore, revised public debloat and other TVs remain outside the validation claim.

Local full log: ignored `dist/webos4/check-pr-ready-20261030.log`. The ready PR title/body are in `docs/webos4-pr.md`;
the commit is local. No release, tag, push or PR creation was performed.

## PR #97 rebase — 31 October 2026

Rebased onto upstream `dev` at `91a03a15601fa0d741c223607479a316deaa32cd` (release 1.6.12), preserving its 31 newer commits.
The conflict in `tools/test/apps.test.js` was resolved by retaining both upstream's audio/Android-box cases and the port's app-cache
failure/recovery cases. Upstream's HOME/preload fixes, generated pages and API golden replies remain unchanged by this contribution.

The new upstream apps module starts audio automatically. Both isolated entry points supply a disabled audio dependency so no
subscription, volume-OSD setting or audio module is started/shipped there. The original candidate permits the read-only tuner
`getAppInfo` query, while its audio and full-power-off APIs remain blocked. The native launch payloads and lifecycle are unchanged.
Regression checks cover the API refusals and absence of the audio module from the isolated startup; packaging excludes it.

| Rebase verification | Result |
| --- | --- |
| Full suite on Node 8.12.0 | 1,110 checks in 45 files passed |
| Full suite on Node 22.23.4 | 1,114 checks in 45 files passed |
| Types, lint, formatting and Chromium 68/79 | Passed |
| Standard, standalone and original kit packaging | Passed within both full suites |
| Zensical 0.0.71 strict documentation build | Passed |
| Checked source versus final checkout | Hashes match after normalizing Windows line endings |
| Contribution whitespace and conflict-marker review | Passed |

The initial test export used Windows line endings; service-script parsing/stop checks failed in that copy. Repeating from LF text,
matching Git's canonical source, passed. This was a development-checkout issue, with no TV operation.
Node 22 runs four additional upstream ADB key-format/generation checks that Node 8 skips because its newer key APIs are absent.
Review of the conflict resolution and integration changes found no blocking findings (CRITICAL/HIGH/MEDIUM/LOW: 0/0/0/0).
Full local output is kept in ignored `dist/webos4/check-rebase-20261031.log`.
This is local regression validation. The rebased candidate has not been deployed or physically revalidated on a TV.
