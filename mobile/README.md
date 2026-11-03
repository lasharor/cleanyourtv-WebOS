# The phone remote as an Android app

`mobile/android` is the phone remote as an app, and almost all of it is not an app: the page, the pairing, the keys and the Power sheet
are the TV's own page (`http://<tv>:8798/`), loaded in a WebView. The app adds exactly the two things a browser cannot do:

- **send the Wake-on-LAN packet**, so "Turn on" works with the TV off — no extra device on the network;
- **open at all while the TV is off**: the TV's page cannot load then, so the app shows the last copy of it that it kept on the phone (the
  remote, with its On/Off button). Only when it never loaded the page does a small bundled page take over (`mobile/web/start.html` to
  type the address, `mobile/web/off.html` as the last resort).

That is the whole design: one activity (Java, no libraries, no AndroidX, no Gradle), two small bundled pages, and a short hook in the TV's page
(`helper/phoneremotepage.js`).

## Build

```sh
powershell -ExecutionPolicy Bypass -File mobile/android/build.ps1
```

Needs Java 8+ (`javac`, `keytool`) and the Android SDK (`ANDROID_HOME`, or the usual place on Windows). It uses the SDK's own `aapt2`,
`javac`, `d8`, `zipalign` and `apksigner` — nothing is downloaded, and Gradle is not used. The result is
`mobile/app/tv-remote.apk` (about 25 KB, handed to the phone as **TV Remote.apk**), signed with a local key made on the first build and kept in
`mobile/android/build-keystore/` (so a rebuild installs over the previous app instead of being refused).

`-Sdk <path>` and `-JavaHome <path>` override where it looks.

## The TV hands the app out

The package ships that APK (`ipk/build.py` puts it in `service/mobile/`, `scripts/bootstrap.sh` copies it next to the service), and the
phone remote serves it on its own port: **`http://<tv>:8798/app.apk`**. In the manager app, **Features › Phone remote › Install the app (Android)**
shows a QR code for exactly that address: scan it, open the download, install. No computer, no cable, and the phone never leaves the
network the TV is on.

The APK in `mobile/app/` is a build artifact that is committed on purpose: it is what the QR code points at. Rebuild it and commit it with
any change to the app, otherwise the TV keeps handing out the old one.

## Install and set up

1. On the TV, in the manager app: **Features › Phone remote › Install the app (Android)**, and scan the code with the phone's camera. Open the download and install it
   (allow the browser to install apps). The same file is `mobile/app/tv-remote.apk`, also reachable at `http://<tv>:8798/app.apk`,
   so a phone without a camera app can just type that address; `adb install` works too.
2. On the TV: **Features › Phone remote** must be on, with the pairing screen open (it shows the address, e.g. `http://192.168.1.50:8798`, and a
   6-digit code).
3. Open the app, tap **Find my TV** (or **Type the address instead** and type the TV's address), and the TV's page asks for the 6-digit code it shows. The
   other way round: scan the code on the TV with the **phone's camera** — the app opens itself with the address and the code already in
   place, so nothing has to be typed.

   The address must be written as numbers: a private or link-local IPv4 address (`10.x.x.x`, `172.16.x.x` to `172.31.x.x`, `192.168.x.x`,
   `169.254.x.x`), with a port if it is not 8798. Names such as `lgwebostv.local`, public addresses and IPv6 are refused, with a message.
   The page lets the app open nothing else, because the page has a bridge to the phone.

   If a scanned code names a TV other than the one the app already has, the app asks **Connect to `<address>`?** with **Connect** and
   **Cancel**. Nothing is saved and nothing is paired until you tap Connect. A link whose address is not a private IPv4 address is ignored
   with a message.
4. Done. The page hands the TV's network address to the app over the bridge when it connects, so the app can wake the TV later without any
   setup of its own.

The app asks for two permissions and no more: `INTERNET`, and `VIBRATE`, which makes a key press answer with a short tick under the thumb
(a WebView cannot vibrate from the page itself, and a browser only gets the old `navigator.vibrate` attempt, which most phones ignore).

After that: open the app → the TV comes up and the remote is there. If the TV does not answer, the app shows the remote it kept (or, if it
never loaded the page, **Turn on the TV**); the power button sends the packet and opens the TV as soon as it answers. When the TV's page
fails to load, the app tries again after 0, 1, 2, 4 and 8 seconds, then every 10 seconds, instead of in a tight loop. The page's Power sheet works exactly as in a browser (Turn off sends the TV's power key).

## What it keeps on the phone

| What | Where | Why |
|---|---|---|
| the TV's address (`192.168.1.50:8798`) | app settings (SharedPreferences) | to open the page and to check the TV came back |
| the TV's MAC address | app settings | for the Wake-on-LAN packet |
| (nothing) | | the name set in Android settings, or the maker and model, is read only to fill the pairing page's name field (`deviceName()`); it can be changed there and is not stored by the app |
| the phone remote's token | the WebView's `localStorage`, under the TV's own address | this is the browser's, not the app's: pairing lives in the page |

Nothing is sent anywhere but the TV. There is no analytics and no account.

## Limits to know

- **Android only** for now. The same shell on iOS would need its own Xcode project; the start page and the bridge names are shared, so the
  page side is already done.
- The APK is signed with a local debug key: fine for sideloading, not for the Play Store. The app has a launcher icon of its own
  (`mobile/android/res/drawable/icon.xml`).
- Plain HTTP to the LAN is enabled on purpose (`usesCleartextTraffic`), because that is how the TV serves its page.
- The app only lets the WebView load the TV's own address and its start page; anything else opens in the browser. That matters because a
  JavaScript bridge is exposed to whatever the WebView loads.
- The TV must have **TV On With Mobile** (Wake-on-LAN) on — the Power sheet says so when the TV reports it off — and the phone must be on
  the same Wi-Fi when you tap Turn on.
- Switching the TV between cable and Wi-Fi changes its MAC: use the app once with the TV on and it learns the new one.

## Files

```
mobile/web/start.html                 the start screens: this one asks for the TV, off.html is the TV-off screen (one source each; the build copies them into the APK's assets)
mobile/web/off.html                   the last resort when no copy of the TV's page was ever kept: a power button
mobile/android/AndroidManifest.xml    one activity, two permissions (INTERNET, VIBRATE), the launcher icon
mobile/android/build.ps1              the whole build, with the SDK's tools
mobile/android/java/com/cleanyourtv/phone/
  MainActivity.java                   the WebView, the bridge (getAddr/setAddr/getMac/setMac/wake/discover), error → start page
  Store.java                          the address and the MAC, and their parsing (the address goes through Addr)
  Addr.java                           the only addresses the app opens: a literal private or link-local IPv4 address, optional port
  Backoff.java                        the wait before the next reload of the TV's page: 0, 1, 2, 4, 8, then 10 s
  Wake.java                           the magic packet, to the limited and the subnet broadcasts, ports 9 and 7
  Discover.java                       SSDP: finds the TV's address on the network
  Reach.java                          "is the TV's page there?" (one TCP connection)
```

## Tests

`tools/test/mobile.test.js` checks the start page against the bridge and the address, wake packet and back-off rules. It does not build or
run the app: that needs the Android SDK and a phone.
