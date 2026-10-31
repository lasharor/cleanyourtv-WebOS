# Original UI trial with prior backup

The original installer branch has already installed and started **CleanYourTV Original** separately on the SDK 4.4.0 TV.
The user confirmed UI/icons and YouTube → candidate → native LG TV → HDMI 1, with picture, sound, and remote control.
HOME continues to open the stable installation. Persistent activation of the original UI remains pending.
The full status and investigation are in [the installer record](webos4-installer-port.md).

## Backup and recovery

The 30 October backup is verified: full gzip/tar, 231 entries, and SHA-256. It includes the stable deployment, its runtime,
app, boot scripts, and relevant private configurations. The local marker is
`dist/webos4/latest-verified-backup.txt`; copies are kept outside Git. It is not a firmware image.
Page localStorage data is not included in this tar; export it prior to any future permanent promotion.

To take another copy, use `webos4/Backup-TV.cmd` or `python webos4/backup-tv.py --host <tv-address>`.
Requires Python 3, Paramiko, and an SSH key with known identity. Streams to the PC without stopping services or creating a tar on the TV.
Do not restore the archive indiscriminately over `/`; select verified files and destinations.

To exit the candidate, press HOME. To stop only the candidate's own process, from the extracted kit:

```sh
sh install.sh --webos4 stop
```

The installer verifies PID, path, and start time. It does not uninstall apps, delete data, modify HOME, or stop the stable external helper.
On fresh installations, the integrated bridge belongs to the same process and stops with it.

## Original features and limits

The page is built from `app/src/`: layout, clock, catalogue, icons, favourites, customisation, themes, inputs, wallpapers, cards,
and IPTV interface. The backend uses six original modules with isolated state. Chromium 53 receives a flex grid with margins.
Launches pass exactly once to the isolated bridge; native payloads are preserved and client parameters discarded.
Neither the launcher nor any other source is closed as cleanup. The top "Live TV" button is IPTV; antenna is the stock LG app.

The Recents menu is informational only. The manager/updater, app uninstallation, closing sources, Input Hook, and unvalidated background tasks
remain excluded. The trial does not repeat debloat/Bluetooth or modify boot. IPTV, wallpapers, and cards require their configuration data;
playback of all formats and Home Assistant have not been tested.

## Build and new TVs

```sh
python3 webos4/build-original.py --runtime <local-copy-of-verified-runtime>
node tools/test.js webos4original webos4setup webos4runtime
sh tools/check.sh --chromium
```

The kit and its checksums are placed in `dist/webos4-original-trial/`. Use `sh install.sh --webos4 install` from the extracted kit.
It will prepare isolated Node 18.17.1 if missing; system Node 0.12.2 remains intact.
The actual installation of the runtime into a new path was already verified on this TV.
The latest kit can host its own bridge when an earlier one does not exist: that mode has local tests and has not
replaced the physically accepted candidate. The installer rejects other SDKs and another release over an existing candidate.

Persistent boot of this candidate and full backup restoration have not been tested. Desktop Chromium 68/79 does not
substitute for physical tests with Chromium 53. Further remote control testing should be performed with automation stopped.
