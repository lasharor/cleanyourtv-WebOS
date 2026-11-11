# Debloat

An optional clean-up of LG's ads and telemetry. It is on by default in the setup; the [manager app](manager.md) has a **Debloat**
screen with its four groups.

## What it does

About a minute after every boot, the debloat:

| Group | What it does |
|---|---|
| **Ads** | Prevents `adoverlay-service` from starting, and adds `eic.ads.lgtvcommon.com`, `nl.ad.lgsmartad.com` and `nl.info.lgsmartad.com` to `/etc/hosts`, pointing at `127.0.0.1` and `::1` and marked `# cleanyourtv-debloat` (other entries are untouched). |
| **Viewing tracking (LivePlus)** | Prevents `acr2` from starting: it recognises what is on screen and reports it. |
| **Telemetry logs** | Stops the systemd services `remotelogger` and `service-logger`. |
| **Suggestions and nudges** | Stops `contentminer` and `nudge`, and prevents `sportsalarm` from starting. |

A program is prevented from starting by mounting a do-nothing stub over it (in RAM; the real files are not changed). Where
`/etc/hosts` is on the read-only system partition, a copy with the ad lines is kept in RAM (`/tmp/cleanyourtv-hosts`) and mounted
over it until the next restart. Each group can be switched on or off on its own; the ones that are off are listed in
`options.debloatOff` in `config.json`.

Nothing is uninstalled. It applies only while the launcher is Home, because LG's own Home needs some of those services to start;
switching back to LG's Home lifts the debloat first.

## Turning it off

Switch a group off in the manager app (**Debloat**), or **Switch all off**. It starts that group's services again, unmounts its stubs
and, for **Ads**, removes the marked hosts lines. Switching the last group off switches the debloat off. To pause it without the manager, create `/media/developer/cleanyourtv/DISABLE-DEBLOAT`.

## What it does not do

It does not block updates: firmware update blocking (for example with the Homebrew Channel's tools) is separate and is not touched.
It does not claim to remove all tracking. It stops the services listed above and nothing else.

**With Glasshouse.** If you also run [Glasshouse](https://github.com/rorygallagher2024/glasshouse) with its ad blocking on, both
tools put ad servers in `/etc/hosts` and both stop LG's ad services, so the **Ads** group is mostly redundant. To let one tool own
that file, switch the **Ads** group off in the manager (or set up with `--no-debloat`). If you leave it on, the two work side by
side: the debloat adds its two marked lines to the file that is mounted at the time, and its undo removes only its own mount.

**Blocking more on the network.** The **Ads** group blocks three ad servers on the TV itself. A DNS blocker on your network
(Pi-hole, AdGuard Home) can block many more with a community list such as
[hugobatista/lg-tv-ad-block](https://github.com/hugobatista/lg-tv-ad-block). Apply it to the TV only (in Pi-hole, a group with
the TV as its only client): on one network it also blocked Philips Hue, `developers.google.com`, Apple services and parts of
Prime Video for every other device. Its `list-store` variant also blocks the LG Content Store, so apps can no longer be installed or
updated.

## Preloaded apps

LG's preload manager (`webos-preload-manager`) starts some apps in the background so they open faster: YouTube, Netflix, the web
browser, Home, the inputs. It looks again every 5 minutes, so an app you close comes back. On a TV with little memory that can cost
more than it saves.

In the manager app, **Experimental > Preloaded apps** lists every app in the TV's preload policy with the free memory LG wants before it preloads it (the `requiredMemory` the preload manager reports, in MB as far as I know; it is not a measured size of the app).
Select an app to change:

- **State**: *off* (never preloaded) or how much of the app LG starts: *partial*, *semi-full*, *full*, *criu* (restored from a
  snapshot). Press to go to the next one.
- **How often**: *periodic* (again at every check) or *oneshot* (once).
- **Back to the TV's own**: the values the TV had when it started.

An app LG does not allow to be preloaded on your TV, and Home (which LG manages with its own rules), are shown but cannot be changed.
Switching an app off also closes it when it runs in the background and is not in front.

The choices are kept in `options.preloadPolicy` in `config.json`. LG's preload manager keeps nothing over a reboot, so the service
sets them again about 20 seconds after it starts, again every 5 minutes in case LG changed them back, and right after the TV wakes from standby (LG sets its own policy again then; Node does not count standby time, so waiting for the 5 minutes would take 5 awake minutes). The wake check (a look every 10 seconds) only runs while at least one app has a saved choice; a choice made or reset in the manager starts or stops it at once, and with no choices the service has no extra timer. If the preload manager does not answer (early in a cold boot it may not be up yet), the boot, wake and 5 minute sets try again up to 3 times, 5 seconds apart, and log each try; a choice made in the manager app is not retried. Nothing is written to
What LG had set (the value "Reset" goes back to) is read once, before the service changes anything, and kept in `preload-base.json` in the service folder, so it stays over reboots, standby and updates. After a firmware update it is read again (the file is marked with the firmware it was read on), so Reset does not go back to the values of the old firmware. the TV's own files: reset every app, or reboot without the boot scripts, and the TV is as LG ships it.

Older versions had three switches in **Debloat** (`options.closePreloaded`); an app on that list counts as switched off.

How it was found on a webOS 25 TV (`com.webos.service.preloadmanager`): `setPreloadPolicy` changes the policy at run time only; an
omitted `isEnabled` becomes false, so the service always sends it; the daemon accepts any text as a mode, so the service checks it
against the four known ones; `isAllowed` can be read but not changed. Other firmware may differ: if the TV has no preload
manager, the screen says so.
