# Updating and uninstalling

## Updating

Open **CleanYourTV**. The **launcher** (the home screen) and the **service** (the background part) update separately from the
latest GitHub release, each checked against its SHA-256 file.

- A launcher that does not start is replaced by the previous one, and a service that does not start by the previous files.
- **Go back to launcher** returns to the previous launcher version after an update.
- Before the setup, the app offers a newer package by itself.
- Running the [install command](install.md#1-install-the-manager-app) again also updates.
- An update from the [Homebrew Channel](install.md#from-the-homebrew-channel) (or `ares-install`) installs the package only; the
  service notices the new package within about four minutes and takes it into use, as an update from the app does. A version whose
  start failed once is not tried again.

## Update channel

**Update channel** in the manager app chooses where updates come from.

| Channel | What it follows |
|---|---|
| **Stable releases** | The latest published release: at most one a day, early in the morning (planned for 04:00 Amsterdam time; GitHub can start it a few hours late), and only when something changed. This is the default. |
| **Dev builds** | Every change, as soon as it is on the `dev` branch: for people who want fixes early or are asked to try one. |

### Dev builds

All work lands on the `dev` branch. Every push to it builds the package (`.github/workflows/dev-build.yml`) and publishes it as
the **pre-release** named `dev`, replacing the one before. Once a day the release workflow turns what is on `dev` into the
next stable release. The stable updater never sees pre-releases.

| | |
|---|---|
| Follow the dev builds | **Update channel** > **Dev builds** (it shows the commit and date), then install with the **Launcher** and **Service** rows. Expect updates several times a day. |
| Back to the stable releases | **Update channel** > **Stable releases**. The stable release is offered again, also when it is older than the dev build. |
| Install from scratch | `ssh root@<tv-ip> 'curl -fsSL https://raw.githubusercontent.com/lasharor/cleanyourtv-WebOS/main/install.sh \| CYTV_CHANNEL=dev sh'`. The manager then follows the dev builds. |
| Same version number | A dev build records its commit in a `BUILD` file, so a newer push of the same version is still offered. |
| Old test builds | Before service 1.6.9 every branch had its own test build (`test-<branch>`). A TV that followed one follows the dev builds now. |

!!! warning "A dev build can be less finished than a release"
    It is checked against its SHA-256 file like any release, but nobody has signed it. See [Security](security.md#dev-builds).

## Switching between LG's Home and the launcher

Switching restarts the TV (about a minute).

| Action | How |
|---|---|
| Use LG's Home | **CleanYourTV as Home** off in the manager app. |
| Use the launcher again | **CleanYourTV as Home** on, from LG's app list. |
| Over SSH | `touch /media/developer/cleanyourtv/DISABLE; reboot` for LG's Home, `rm /media/developer/cleanyourtv/DISABLE; reboot` for ours. |
| Failed boot | The Homebrew Channel's failsafe mode skips all boot scripts; reboot again. |

While LG's Home is selected the service still runs, so the manager app and the Input key keep working.

## Uninstalling

**Uninstall** in the manager app, or over SSH:

```sh
sh /media/developer/cleanyourtv/uninstall.sh
```

`--keep-config` keeps your settings and usage history, and `--no-reboot` restores LG's Home right away instead of restarting the TV. Uninstalling removes the apps, boot scripts and Input-key bind and
restarts the TV, which then starts with LG's Home. See [What it changes on the TV](tv-changes.md) for what is removed.

### Native Home restoration safety

Where a script stands in for LG's native Home program, restoring Home verifies
the marker and mounted script belong to the saved native app. It stops that
interpreter and its registration descendants before unmounting, with process
start-time checks to avoid signalling a reused PID. It does not kill unrelated
Luna clients. The separate one-per-boot watchdog remains in place; it checks
whether Home is still replaced after each wait, rather than using takeover generations.

If saved metadata or the marker is missing or stale, restoration falls back to
the mounted script's inode as ownership evidence and tries bounded process cleanup
again. A FIFO or symlink marker is not read. No owned mount means no arbitrary
process signalling or foreign unmount. If process cleanup still fails, the command
warns and makes a best-effort stock restore, rechecking ownership before unmounting.
If unmounting is busy or ownership cannot be established, it reports failure and
retains recovery files instead of claiming stock Home was restored. Do not delete the marker
or force/lazy-unmount an unknown target. The no-reboot uninstaller also handles
native takeover and stops before deleting its runtime if restoration fails.
Keep root SSH available for recovery; a reboot with Homebrew's failsafe skips
the takeover scripts. This does not change the manager switch's normal reboot.
