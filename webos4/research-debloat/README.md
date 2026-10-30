# Exact tested debloat: research snapshot

These two scripts preserve the version installed and user-validated on the research TV on 29 October 2026.
They are not a generic installer. No package runs or enables them. The scripts at `webos4/debloat-stop.sh` and
`webos4/debloat-undo.sh` are a different public revision with hosts bind mounts and ownership guards; do not mix their undo paths.

The tested version uses Upstart, stops remotelogger, mounts no-op stubs over acr2/admanager and adds two marked ad-blocking hosts lines.
Its existing deployment uses `/media/developer/cleanyourtv/` and backup directory `backup/debloat-20261026`.
The recorded boot entry `15-cleanyourtv-debloat` reapplies it unless `DISABLE-DEBLOAT` exists; that TV-specific entry is not installed
or recreated by these snapshots. The investigation recorded this wrapper template (not a new readback of the deployed boot file):

```sh
#!/bin/sh
[ -e /media/developer/cleanyourtv/DISABLE-DEBLOAT ] && exit 0
(sleep 60; sh /media/developer/cleanyourtv/debloat-stop.sh) </dev/null >/dev/null 2>&1 &
```

It checks the disable marker before its delay. An already scheduled application is not cancelled by creating that marker;
do not use this template as an improved lifecycle controller. No executable boot wrapper is supplied or enabled here.

For that existing deployment, the recorded undo is:

```sh
touch /media/developer/cleanyourtv/DISABLE-DEBLOAT
sh /media/developer/cleanyourtv/debloat-undo.sh
```

Keep the original private backup and deployed undo in place. This legacy undo restores hosts from its recorded backup, which can
overwrite later hosts edits; it also lacks the public revision's mount ownership guards and restarts remotelogger unconditionally.
Do not run it over another tool's mounts, a new hosts configuration or the newer public revision. Do not infer safety for another TV
from the successful recorded session. Exact snapshots remain here to make the investigation reproducible and distinguish the code
that was physically tested from code tested only on the desktop. No firmware, calibration, private log or TV address is included.
