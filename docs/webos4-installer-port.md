# Extending the original installer to webOS 4

## Confirmed goal and actual status

The confirmed goal is to adapt the original CleanYourTV workflow to webOS 4, preserving its UI and compatible features.
Installing the original UI app separately enables validating components without replacing the stable HOME.
An experimental `--webos4` branch already exists in the original entry points for this TV. It installs and controls a
separate candidate with the original UI and six original modules. The generic installer block remains intact: webOS 5+
setup as a whole is not treated as compatible, nor has the stable HOME been replaced.

An explicit check was added to the original installer, without altering the normal installation path:

```sh
sh install.sh --check
sh scripts/bootstrap.sh check
```

Requires local checkout files. Do not use an upstream-downloaded original installer assuming it already contains these
changes. The check mode exits before any downloads, writes, mounts, reboots, or configuration changes. It is not a simulation
of a complete installation nor a guarantee that installing will work.

## First check on the TV — 30 October 2026 (historical)

The TV resumed responding over SSH. The backup was saved to the PC, streaming the tar with low priority without creating an archive file on the TV.
Full gzip, tar entries, and SHA-256 were verified: **231 entries**. Includes deployment, isolated runtime, app registered at its
verified real path, boot scripts, and relevant configurations. The hashes of the stable helper, HOME controller, patch, and shutdown fix
did not change during the transfer. An application/configuration backup is not a firmware image and does not guarantee root recovery.

The new inventory command was executed via stdin, without copying scripts to the TV or executing installation. Result:

| Fact read | Result |
| --- | --- |
| SDK | 4.4.0 |
| Service init | Upstart |
| System Node | 0.12.2 |
| Validated helper already installed | Isolated Node 18.17.1, loopback 8765, operational |
| Original installer without port | Not supported |
| Foreground source when backup completed | HDMI 1; query only, not a new visual test |

The backup and private test archives are in `dist/webos4/backups/20261030-171302/`, outside Git. The local marker
`dist/webos4/latest-verified-backup.txt` indicates the verified copy. No private data was published.
The candidate was not installed, bootstrap install was not executed, no service was restarted, HOME was not altered, and boot was not changed.

## Differences identified at the start (historical)

| Original component | Required difference for webOS 4 |
| --- | --- |
| Preflight and profile | Detect SDK 4/Upstart and isolated runtime; do not bypass the block with --force |
| Manager service | Do not run it with Node 0.12; select and verify the isolated runtime without replacing system Node |
| Copying/updating | Versioned staging with manifest, without overwriting the validated deployment during testing |
| HOME | Reuse the verified RAM mount and configd reload; no systemctl/sam or graphics restart |
| Launches | Preserve captured Live TV payload, id-only HDMI, and a single request without retries or source cleanup |
| Input/notifications/debloat | Activate only proven capabilities; preserve existing Bluetooth and debloat during trial |
| Verification and rollback | Do not use HTTP as a video check or automatically reboot the TV after a timeout |
| UI/features | Validate original modules and Chromium 53 in the candidate; integrate activation into installer later |
| Updates | Keep the port isolated until compatible packages and rollback are available; no upstream auto-updates |

Switching systemctl to initctl or accepting SDK 4 is not enough: original bootstrap overwrites the stable directory, installs hooks,
restarts services, changes HOME, and can schedule a reboot if its check fails. Those branches require joint adaptation.

## Test sequence and recovery

1. Verified backup and reading current state: completed.
2. Build and test the webOS 4 branch of the original installer in a simulated filesystem; cover changes, failures, and rollback.
3. Validate original UI and modules in a separate deployment, without altering HOME or stable services.
4. With picture/sound/remote confirmed, test activation of the adapted installer and its exact rollback.

For the separate candidate, HOME continues pointing to the stable app, and stopping its backend does not touch the existing installation.
The backup is not extracted blindly over `/`: any restore must select specific files and configuration.
Faced with black video or uncertain response, testing stops and evidence is preserved; launches or reboots are never chained.
The full port will not be claimed as working until installation and rollback have also been validated on this TV.

## Initial verification (historical)

874 checks pass across 37 files on Node 8.12 and Node 22, types/lint/formatting, and Chromium 68/79.
Five regressions cover both original entry points, unknown SDK, and modern TV prerequisites without executing mutations.
On the TV, exactly `scripts/check-tv.sh` was run via stdin; the dispatchers `install.sh --check` and `bootstrap.sh check`
were tested in the local environment, without deploying the checkout to the TV. The review found no mutations in the check branch and no changes
to the default installation flow. The check reports incompatibility; exit status 0 means the inventory could be read successfully.
These tests do not constitute validation of a future full installer for webOS 4.

## Implemented and deployed branch — 30 October

The kit is built with `python3 webos4/build-original.py`. It includes original entry points, profile, bootstrap branch,
SHA-256 manifest, and local artifacts. It does not download a remote release or updater code. The verified runtime can
be bundled with `python3 webos4/build-original.py --runtime <local-copy-of-verified-runtime>`.

```sh
sh install.sh --webos4 check
sh install.sh --webos4 install
sh install.sh --webos4 start
sh install.sh --webos4 status
sh install.sh --webos4 show
sh install.sh --webos4 stop
```

These run from the extracted kit, not from an upstream installer lacking the artifacts. `check` does not install. `install` verifies SDK,
runtime, verifies checksums, rejects unsafe paths/symlinks, and extracts strictly into
`/var/lib/webosbrew/cleanyourtv-original/`. It installs `com.cleanyourtv.webos4.original` once, verifies its registration, and does not start the
backend until `start` is requested. An uncertain installation or read is not retried. Changing releases requires a future
upgrade path: this mode does not overwrite an existing candidate with another package.

`start` confirms its own PID, path, start time, and API; it does not restart LG services. `stop` checks the same identity,
sends TERM only to that process, and preserves files/configuration. A lock serialises mutating actions; a pending lock
is preserved for inspection. `show` sends a single launch request to the candidate's ID, without activating a native source.
No watchdog, boot hook, Input Hook, updater, HOME script, or debloat is installed. No other app is closed, and graphics are not restarted.

The candidate retains original modules for apps, inputs, customisation, themes, wallpapers, cards, and IPTV, with isolated state.
Its Recents menu is informational only; app closing and uninstallation are excluded. The original manager that schedules
reboots, hook changes, and incompatible updates is not loaded. Themes are validated data; their files may vary without invalidating
the immutable code check. Native launches remain delegated to the isolated bridge with their captured payloads.

If the validated helper exists on port 8765, it is reused without modification. On a fresh installation, `start` hosts the same bridge code
`helper/webos4.js` inside the candidate's process. A port occupied by another service blocks the operation; its owner is never killed.
`stop` terminates its own process and therefore its integrated bridge; it does not stop a reused external bridge.
Promotion to normal HOME and persistent autostart of the original UI remain outside this validation deployment.

### Current evidence

- The extended original installer completed `check`, `install`, `start`, `status`, and a `show` launch on the TV.
- App registration verified; backend running on Node 18.17.1. The four protected hashes for HOME/helper/patch/shutdown match
  the prior backup. System Node was not replaced, compositor was not restarted, and boot was not altered.
- The API returned 25 real apps and LG inputs; the frontend adds its virtual IPTV input and displays 26 loaded tiles/icons.
- Real Chromium 53 showed a complete, visible document without error toast, API on 8764, and flex grid. A private screenshot was saved.
- The user confirmed the UI/icons and physical sequence YouTube → candidate → native LG TV → HDMI 1, with picture, sound, and remote control.
  The top "Live TV" button of the original corresponds to IPTV; native antenna is opened via the LG app.
- `config.update` saved a clock preference solely in the test state; verified on disk and restored to its prior value.
- Subsequent menu checking was halted without sending keys because the candidate was no longer open in the inspector. It was not relaunched
  as an automated response. The physical sequence was confirmed afterwards by the user, with automation stopped.

Complete local tests passed on Node 8/22, types/lint/formatting, and Chromium 68/79. There are additionally 23 targeted cases across both Node
versions covering installation, idempotency, process ownership, foreign start clock, different release, invalid SDK/package/path, occupied
port, unretried failure/uncertain registration, altered code, lock handling, installation without prior helper, and preservation of stable deployment.
Persistent autostart of the candidate, full backup restoration, and profile-excluded services have not yet been tested.

## Installing Node on a TV that does not include it

The TV ships with Node 0.12.2; that interpreter only runs the ES5 bootstrap `webos4/runtime-install.js`. It cannot run the original backend.
[Reproducible runtime preparation](webos4-runtime.md) pins the public source IPK and enables extracting the files without installing
or executing StremCompat. Its download was matched against the TV runtime: all 14 files match byte for byte.
The kit with `--runtime` contains 32-bit ARM Node 18.17.1 and its 13 verified libraries/aliases. `runtime-manifest.json` pins the
size and SHA-256 of all 14 files, and its own hash is pinned in the profile. A binary is never picked from an unverified URL.

```sh
sh install.sh --webos4 runtime-install
sh install.sh --webos4 install
```

`install` also prepares the runtime if missing. It extracts into private staging, rejects symlinks/unexpected paths or files,
verifies all bytes and ARM ELF, and tests `--version` using the system loader. Only then is it published by
renaming into `/var/lib/webosbrew/cleanyourtv-runtime/node-v18.17.1-armv7/`. An external destination is not overwritten. No changes are made to `/usr/bin/node`,
libc, firmware, or the prior research runtime. `check` requires this runtime; the prior inventory check without installing is `--check`.

On this TV, `runtime-install` was actually executed via Node 0.12.2: it installed Node 18.17.1 and all libraries into that new path.
Protected hashes of the stable installation matched before and after. Nine regressions cover installation, repetition,
checksum verification, unknown SDK, loader failure, incomplete libraries, symlinks, foreign manifest, and existing destination.

The physically validated candidate retains its previous release and reuses the stable bridge; it has not been overwritten to test
the integrated bridge. That fresh installation mode has local tests, not a physical test on a second TV.
The profile accepts only SDK 4.4.0: it does not declare all webOS 4 versions compatible. Binaries remain in `dist/`, outside Git;
before redistributing a runtime publicly, its provenance must be documented and component licenses fulfilled.
