# Add experimental SDK 4.4.0 support with the original UI and isolated runtime

webOS 4 uses Upstart, Chromium 53 and system Node 0.12.2, so the regular CleanYourTV setup cannot run unchanged.
This adds an explicit branch of the original installer that installs the original UI and six upstream modules separately,
using a verified private Node runtime. The regular webOS 5+ installation path and API golden replies are preserved.

## Changes

- Add `install.sh --check` for a read-only inventory and `--webos4 install|start|stop|status|show` for the SDK 4.4.0 candidate.
  Installation checks hashes/archive paths, sends one package request, preserves uncertain outcomes and verifies registration.
  Manual process control verifies PID, executable path and start time; another release never overwrites an existing candidate.
- Bootstrap pinned Node 18.17.1 and libraries with ES5 code running on system Node 0.12.2. Check the complete manifest, ARM ELF
  and loader version before publishing a private directory. Preserve system Node, libc and the earlier deployment.
- Include a PC-only extractor for a pinned public StremCompat release. Its 14 runtime files reproduced the TV-validated files
  byte for byte. Runtime binaries and private state are excluded from Git and normal releases.
- Build the original UI with a Chromium 53 flex layout and isolated state/API. Reuse upstream apps, running-list, theme,
  wallpaper, card and IPTV modules; exclude unvalidated manager/updater/input-hook and destructive operations.
- Preserve one native source request: captured LG Live TV payload, id-only HDMI, discarded caller parameters and no automatic
  retry, fallback or delayed close/hide. Reuse a compatible bridge or host the same bridge in the candidate's own process.
- Retain the standalone research launcher and opt-in HOME, Upstart debloat, shutdown, Netflix and calibrated Bluetooth tools
  separately, with their firmware guards, undo paths and research history. App artwork is read from installed TV apps.
- Fix app-cache rejection recovery and allow a scoped loopback origin policy; add packaging/runtime/process/source regressions.

## Validation

The branch is based on upstream `dev` at `91a03a15601fa0d741c223607479a316deaa32cd` (release 1.6.12).

- `sh tools/check.sh --chromium`: tests on Node 8.12.0 and Node 22.23.4, API golden replies, types, lint, formatting and Chromium 68/79.
- Standard package, standalone package/addons and original installer kit with the verified runtime built locally.
- Pinned public IPK download reproduced all runtime file hashes; six Python backup/extraction cases cover integrity and refusals.
- Documentation built with CI's Zensical 0.0.71 in strict mode; contribution diff checked for whitespace and private artifacts.

The final counts and review are recorded in [the validation record](webos4-validation.md).

## Hardware evidence and limits

On the owner's SDK 4.4.0 TV, the earlier candidate was installed and started through the extended original installer.
The user confirmed UI/icons and YouTube → original candidate → native LG TV → HDMI 1 with picture, sound and remote control.
System Node 0.12.2 also installed the isolated runtime into its new directory; protected stable HOME/helper/shutdown hashes stayed
unchanged. A verified 231-entry application/configuration backup remains private.

The post-rebase UI, newly helper-served standalone icons and fresh-install bridge ownership have local tests, not a new physical
acceptance run. Upstream's new audio subscription/OSD is disabled in this isolated profile, and its full-power-off API remains blocked.
Persistent original-UI HOME takeover, full backup restore, revised public hosts-mount debloat and other SDKs/models
are not validated. Earlier research HOME/Bluetooth/debloat acceptance is recorded separately and does not validate every public layout.
The unique low-level cause of historical native-source blackouts remains unresolved.

This is experimental, firmware-scoped support. Normal manager/updater and unvalidated features remain excluded. Public runtime
binary distribution requires the component provenance/notices described in [the runtime record](webos4-runtime.md); this PR adds
source, manifests and local build tools. It does not add runtime artifacts to the normal release workflow.

Investigation, failed approaches, recovery constraints and exact native payloads are retained in [the port guide](webos4.md),
[installer record](webos4-installer-port.md) and linked research logs. AI assistance: OpenAI Codex; physical observations supplied
and confirmed by the TV owner.
