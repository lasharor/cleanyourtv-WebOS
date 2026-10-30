# Troubleshooting

- **Black screen after switching or rebooting.** Wait a minute; if it stays black, restart the TV. If the new Home does not come
  up, the setup removes the boot scripts and restarts the TV with LG's Home by itself.
- **The Home button opens LG's full-screen Home, not CleanYourTV.** Some TVs have a Home Style setting. Set TV Settings > General >
  Home Settings > Home Style to Basic.
- **Apps do not open, an HDMI input has no picture or the remote no longer controls HDMI-CEC devices (webOS 5 to 23).** These
  followed the restart of the app manager on TVs with LG's native Home (issues 14, 23 and 24). From service 1.6.6 such a TV takes
  over Home without that restart. **Share log** shows the steps under *Boot steps*; open an issue with it if the problem stays.
- **An app is missing from the grid.** Check **Hidden apps** in Customise. Apps without a launch icon are not listed.
- **After a firmware update removed root.** Re-root, then run the [install command](install.md#1-install-the-manager-app) and the setup again.
- **The Input key opens LG's picker.** Check the Input key switch in the manager app and run **Learn the Input key**.
- **A loading circle appears every half minute and the remote stops responding until you hold Back.** The Input key can show the
  Inputs list over the running app with a small app that the service starts in the background. On webOS 6.5 (reports) the TV closes that
  app again and it keeps the remote. From v1.5.13 webOS before 10 starts the app only when the key is pressed and closes it after use,
  and on any TV the service switches to that when it had to start the background app three times in ten minutes
  (`picker.mode: ondemand` in `config.json`). **Input key** > **Input key shows** chooses by hand; switching the Input key off entirely
  gives the key back to LG.
- **The manager list does not show Share log or Uninstall.** Before v1.5.13 the list could not scroll; update, then move down: the
  list scrolls and fades where more rows are hidden.
- **Text appears twice in menus or the Live TV list on webOS 5 (blurred, overlapping).** webOS 5's browser (Chromium 68) can keep the old
  text when a list is redrawn. From v1.5.13 the launcher swaps the list for a fresh element there instead of rewriting it.
- **The service restarts by itself.** On some TVs Node.js 8 stops with `uv_close: Assertion ... failed`. From v1.5.13 the service
  logs its last operations when it finds that the previous run ended without a clean exit; they appear in **Share log** under the
  service log, so a report names the cause.
- **`FAILED_IPKG_INSTALL`.** Remove the `com.cleanyourtv.manager` entry marked `half-installed` from
  `/media/developer/apps/var/lib/opkg/status` and install again.
- **Live TV shows the setup code again.** The playlist address was reset or never saved; run the pairing again, or send it with
  `POST /api/live/settings` ([Live TV](live-tv.md#setting-it-up)).
- **Something is broken after an update.** A launcher or service that does not start is replaced by the previous version
  automatically. **Go back to launcher** in the manager returns to the previous launcher by hand.
- **The TV does not wake from the network (Wake-on-LAN) after it was switched off.** LG has two ways to switch off. With
  the TV's **Quick Start+** setting on, the remote and
  `luna://com.webos.service.tvpower/power/powerOff` only suspend the TV: Wake-on-LAN wakes it in a few seconds and CleanYourTV is
  already Home, since the boot scripts do not run again. `luna://com.webos.service.tvpower/power/shutDown` switches it off
  completely: it uses less power, but Wake-on-LAN no longer wakes it (the remote and HDMI-CEC from a device on an input still do), and
  the next start is a cold boot, with LG's Home until the boot scripts have run. Checked on webOS 22 (65QNED866QA). Use `powerOff`
  in scripts that must wake the TV again.
- **Back to LG's Home right now.** In the manager, **CleanYourTV as Home** off, or `sh /media/developer/cleanyourtv/undo-home.sh`
  over SSH.

## App icons remain text labels after boot

Home can show its cached layout before the local helper is ready. Previously,
an icon request that failed at that point stayed as a cached text fallback even
after the helper recovered; an unchanged app list did not rebuild the tile.
After a successful app-list request, failed helper icons now retry, including
when the layout is unchanged. Text stays visible until an image loads. Each
cached tile gets at most two retries, so genuinely missing icons do not create
an endless request loop. The embedded Live TV icon is not requested from the
helper.

## Luna replies disappear on webOS 7.6.0

On one LG 70UQ7070ZUD running firmware 04.60.90 (webOS 7.6.0, Node 12.21.0),
`luna-send` could exit without executing or returning a reply when stdin reached
EOF. Closed stdin remains the default; this is not an automatic SDK-wide rule.
To opt in on an affected TV, create the flag over root SSH before setup:

```sh
mkdir -p /media/developer/cleanyourtv
touch /media/developer/cleanyourtv/luna-stdin-open
```

The helper, foreground probe, Share log, optional voice capture and shell scripts
read this flag. It survives updates and reboots without editing installed scripts.
Remove it to undo the workaround (subsequent calls use closed stdin):

```sh
rm -f /media/developer/cleanyourtv/luna-stdin-open
```

For developers, `CYTV_LUNA_STDIN=open` or `closed` overrides the flag; an explicit
per-call `keepStdinOpen` boolean overrides both in `helper/luna.js`. Node calls hold
their input pipe until exit; one-shot calls retain their Luna wait and child
deadline. Synchronous Share log calls and the shell wrapper use an immediately
unlinked private FIFO, scoped to the call, with no feeder or descriptor inherited
by other children. Native Home registration and optional voice remain subscriptions
with their existing lifetimes. If the shell helper is missing after a partial copy,
scripts fall back to closed stdin rather than aborting on the missing file.

This option does not bypass installation compatibility checks or make an
unsupported takeover safe. Equivalent handling was checked in a separately
managed native deployment; this exact branch's generic install/reboot/update
cycle and other firmware have not yet been device-validated.

## Reporting a problem

An AI assistant can help you read the report and find the cause: see [Working on problems with an AI assistant](ai.md).


Open an [issue](https://github.com/lasharor/cleanyourtv-WebOS/issues) and attach the output of **Share log**
(manager app, see [The manager app](manager.md#share-log)). It is masked, so it does not contain your addresses or keys. Say which
TV and firmware you have and what you expected.
