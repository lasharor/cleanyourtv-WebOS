# Tested TVs

CleanYourTV is written for rooted LG webOS TVs. Only a few models have been tried, and reports are welcome: open an issue with
the output of **Share log** (see [Troubleshooting](troubleshooting.md#reporting-a-problem)) and say whether it worked.

| TV | Firmware | webOS (SDK) | Status |
|---|---|---|---|
| OLED65G26LA | 33.23.05 | webOS 25 (10.2.2) | **Tested.** The maintainer's TV; everything in these pages was checked on it. |
| 43UT7590PUA | 33.31.75 | webOS 25 (10.3.2) | **Works**, reported in [#10](https://github.com/lasharor/cleanyourtv-WebOS/issues/10): setup with debloat and the Input key on, Home takeover, input hook and service came up cleanly and survived several reboots (service 1.5.16, launcher 1.4.15). |
| 65UT7000PUA | 33.31.75 | webOS 25 (10.3.2) | **Works**, reported in [#11](https://github.com/lasharor/cleanyourtv-WebOS/issues/11): setup completed and the home screen works. The Input key opens the Inputs list in under a second; the TV closed the hidden picker, so it starts on each press. |
| OLED65C54LA | 43.21.77 | webOS 26 (11.2.0) | **Works**, reported in [#3](https://github.com/lasharor/cleanyourtv-WebOS/issues/3): app icons were drawn as small squares in their tiles; fixed since v1.5.9. |
| OLED65C35LA | | webOS 26 | **Problem reported** in [#21](https://github.com/lasharor/cleanyourtv-WebOS/issues/21): no sound to the soundbar over HDMI ARC until `arccontroller` was restarted. Manual controller restart confirmed to restore sound. A targeted post-SAM recovery is implemented; automatic recovery at boot is not yet verified. |
| OLED55G4 | 23.23.30 | webOS 24 (9.2.4) | **Works**, reported in [#25](https://github.com/lasharor/cleanyourtv-WebOS/pull/25): the first version of inputs in the dock was built and tried on it. |
| 43UR75006LK | 23.25.55 | SDK 9.2.2, Node.js 16 | **Problem reported** in [#23](https://github.com/lasharor/cleanyourtv-WebOS/issues/23): no picture on HDMI 1 with service 1.6.4 and 1.6.5, fine with LG's Home. LG's Home is the `native` kind on this TV, so from 1.6.7 it gets the stand-in; not yet reported with 1.6.7. |
| Two models | 23.25.55 | | **Works**, reported (the models were not named). |
| 43UR74006LB | 13.40.90 | webOS 23 (8.4.0, Node.js 12) | **Works**, reported in [#17](https://github.com/lasharor/cleanyourtv-WebOS/issues/17): Home takeover, the service and the input hook came up (service 1.5.16, launcher 1.4.15). LG's Home is the `native` kind: set up then with **Set up anyway**, from 1.6.7 the stand-in. |
| OLED65C26LD | | | **Problem reported** in [#14](https://github.com/lasharor/cleanyourtv-WebOS/issues/14): no picture from a set-top box on HDMI until CleanYourTV was removed. The same kind of problem as [#23](https://github.com/lasharor/cleanyourtv-WebOS/issues/23); not reported again since 1.6.7. |
| OLED55G19LA | 03.53.45 | webOS 6.5 (6.5.3, Node.js 8.12) | **Works**, reported in [#5](https://github.com/lasharor/cleanyourtv-WebOS/issues/5): works since service 1.5.13. LG's Home is the `native` kind. The Inputs list over the running app is started when the Input key is pressed and closed after use. |
| 65NANO753PR | 03.53.45 | webOS 6.5 (6.5.3, Node.js 8.12) | **Works**, reported in [#18](https://github.com/lasharor/cleanyourtv-WebOS/issues/18) (service 1.6.1, launcher 1.5.1). LG's Home is the `native` kind. From a cold start LG's own Home showed for about 30 seconds before CleanYourTV; with **Quick Start+** on, the TV wakes to CleanYourTV. |
| OLED65B16LA | 03.53.45 | webOS 6.5 (6.5.3, Node.js 8.12) | **Works**, reported in [#8](https://github.com/lasharor/cleanyourtv-WebOS/issues/8): menus and lists bounced sideways when moving; fixed in 1.6.0. |
| 55UP7550PVG | 03.53.45 | webOS 6.5 | **Works**, reported in [#12](https://github.com/lasharor/cleanyourtv-WebOS/issues/12): the focus ring did not follow rounded tiles; fixed in 1.6.0. |
| OLED48C16LA | 03.53.45 | webOS 6.5 (6.5.3, Node.js 8.12) | **Works**, reported in [#26](https://github.com/lasharor/cleanyourtv-WebOS/issues/26): a Live TV guide written on one line (Tunarr) showed no programmes; fixed in 1.6.7. |
| OLED CX (the TV hides the exact model) | 04.64.00 | webOS 5.6.2 (Node.js 8.12) | **Works** with 1.6.7, reported in [#23](https://github.com/lasharor/cleanyourtv-WebOS/issues/23): before, after a boot the remote no longer controlled the set-top box over HDMI-CEC and apps did not open. |
| OLED65CX6LA | 04.64.00 | webOS 5.6.2 (Node.js 8.12) | **Works** with 1.6.7, reported in [#24](https://github.com/lasharor/cleanyourtv-WebOS/issues/24): before, Netflix and YouTube hung or did not open while CleanYourTV was Home. |
| 75UN85006LA | 04.64.00 | webOS 5.6.2 | **Works**, reported in [#15](https://github.com/lasharor/cleanyourtv-WebOS/issues/15): the launcher, the service and the input hook work (service 1.5.16, launcher 1.4.15). LG's Home is the `native` kind: set up then with **Set up anyway**, from 1.6.7 the stand-in. |
| 55UN7200PTF | 04.64.00 | webOS 5.6.2 (Node.js 8.12) | **Works**, reported in [#4](https://github.com/lasharor/cleanyourtv-WebOS/issues/4): with the Home Style set to Basic. The notification and layout fixes from that report were released, and the reporter confirmed v1.6.3 works. |
| OLED55CX3LA | 04.41.35 | webOS 5 (5.4.3, Node.js 8.12) | **Works**, reported in [#13](https://github.com/lasharor/cleanyourtv-WebOS/issues/13): the Live TV guide, the jumping channel list (1.6.0) and channels taking 20 to 30 seconds to start (1.6.7) are fixed. |
| OLED55CX9LA | 04.50.53 | webOS 5 (5.5.0, Node.js 8.12) | **Problem open** in [#6](https://github.com/lasharor/cleanyourtv-WebOS/issues/6): Home freezes a few seconds after it starts; holding Back frees it. |
| 43UM7450PLA | 05.40.97 | webOS 4.5 (4.10.0) | **Does not work** ([#2](https://github.com/lasharor/cleanyourtv-WebOS/issues/2)): webOS before 5 has no systemd and a Node.js too old for the service, so the setup stops without changing anything. |

!!! note "What the status words mean"
    *Tested* means the maintainer ran it. *Works* means someone else reported that it works, with the problems they found and
    the version that fixed them. *Problem reported* and *Problem open* mean a report of something that does not work, not yet
    confirmed fixed. *Does not work* means CleanYourTV cannot run there. The rows go from the newest webOS to the oldest. A TV
    that is not on this list may still work: see [unlisted firmware](install.md#unlisted-firmware).

## webOS version numbers

LG names its webOS versions in two ways: a marketing name and the version the TV reports to software. The **SDK version**
(**Settings > About**, or `sdkVersion` in the setup log) is the second one and is what the setup reads.

| Marketing name | First shipped on | SDK version reported |
|---|---|---|
| webOS 5 | 2020 | 5.x |
| webOS 6 | 2021 | 6.x |
| webOS 22 | 2022 | 7.x |
| webOS 23 | 2023 | 8.x |
| webOS 24 | 2024 | 9.x |
| webOS 25 | 2025 | 10.x |
| webOS 26 | 2026 | 11.x |

LG also updates older TVs to newer versions, so the SDK version, not the model year, is what counts. The service avoids features the older versions lack: webOS 5 and 6 ship **Node.js 8** (and Chromium 79 on webOS 6). The
details are in [Internals](development/internals.md#older-webos-versions).

## What differs between webOS versions

All per-TV decisions are made in one place, [`helper/tvprofile.js`](https://github.com/lasharor/cleanyourtv-WebOS/blob/main/helper/tvprofile.js),
from the SDK version and the kind of LG's Home app as it came with the TV. **Share log** and `GET /api/tv` show what was decided.

| | webOS 5 and 6 (SDK 5, 6) | webOS 22 and 23 (SDK 7, 8) | webOS 24 to 26 (SDK 9 to 11) |
|---|---|---|---|
| LG's Home app (reports) | native program | native program | flutter or web app; native on a 43UR75006LK (SDK 9.2.2) |
| How the launcher becomes Home | stand-in over LG's Home program; the app manager is not restarted | stand-in, as on webOS 5 and 6 | launcher folder mounted over LG's Home app and the app manager restarted; the stand-in where LG's Home is native |
| Setup on unlisted firmware | **Set up anyway** needed | **Set up anyway** needed | continues by itself |
| Input key | Inputs list started on each press | started on each press | kept ready over the running app on webOS 25 (SDK 10); started on each press on SDK 9 and 11 |
| Picture notifications window | `overlay` | `overlay` | `topui` from SDK 10, `overlay` on SDK 9 |
| Node.js, browser engine | Node.js 8; Chromium 68 (webOS 5) or 79 (webOS 6) | Node.js 12 (webOS 23 report) | Node.js 16 (webOS 25) |

The Home row follows LG's Home app, not the version number: a TV with a native Home gets the stand-in whatever its version, and a
flutter or web Home gets the mount. How both work is in [What it changes on the TV](tv-changes.md#at-boot).
