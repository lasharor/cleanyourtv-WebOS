# Phone remote

Use a phone on your Wi-Fi as the TV's remote control: arrows and OK, Back, Home, volume, mute, channel, play/pause, the colour keys,
number keys, a touchpad (swipe to move around, tap for OK, tap with two fingers for Back) and a text box that types into the field open on
the TV. A phone has to **pair once** with a code shown on the TV; after that it reconnects by itself whenever its browser is awake. Turning the TV **on** again after standby
depends on how far it went down: see [Turning the TV on](#turning-the-tv-on).

!!! note "What was checked on a real TV"
    On an LG 65UR91006LB (webOS 10) all 34 buttons were accepted by the TV, and the effect was seen for the arrows, Back, Menu, Mute and
    **Turn off** (the `POWER` key: standby, and every port closed). Typing into a text field has **not** been tried on a TV yet. The touchpad moves the TV's real pointer on this TV (through the TV's own `ws://` pointer socket, see below). The volume keys do nothing
    when the TV's sound goes out over optical or to an external amplifier, because the TV does not control that volume. If a key does
    nothing, `curl -X POST localhost:8765/api/addons/phoneremote/key -d '{"key":"HOME"}'` (and the status `keys` field of
    `/api/addons/phoneremote`) say which step failed; please report it in an issue with the Share log.
    The wake packet was tried on this TV as well: in standby, with every port closed, a packet brought it back in about a second, with the
    same boot (Quick Start+). The packet came from a computer on the network.
    The power drawer was tried on this TV, one row at a time: **Screen off** left it in `Screen Off` with every port still open, **Standby**
    left it in `Active Standby` (Quick Start+ keeps the network up, and the `POWER` key woke it in a couple of seconds), **Restart** put it
    in `Reboot` and it was back on, awake, about a minute later with its uptime reset, and **Shut down** switched it off completely: after
    that it answers nothing on the network and a Wake-on-LAN packet does not bring it back, so its own remote is the only way on.

The phone page has four tabs: **Remote**, **Touchpad**, **Apps** and **Live**. The Remote has a round pad with a large OK and Menu, **123**, Back and Home in its four corners, then volume, Mute and channel, and one playback bar. **123** opens a sheet with the number keys, Exit and the four colour keys. The last row of both the Remote and the Touchpad holds **Inputs** (the TV's ports) and **Keyboard** (a drawer, below). When the TV
cannot be reached the line under the TV name says so ("Can't reach the TV": it may be off, or the phone may be on another network) and the page retries by itself. Every short message (opening an app, not connected, the TV did not come on) shows in that line for a few seconds and then goes back to the real status: nothing is drawn over the keys. The page is always left to right,
also in an Arabic or Hebrew phone, so the arrows do not swap sides.

**Touchpad.** A swipe moves the TV's pointer as you move, a tap is OK, a tap with two fingers is Back, and two fingers moving scroll. The rail on the right of the pad scrolls too: drag its thumb up or down, and it springs back to the middle when you let go. Both work with a mouse as well (drag, click, wheel; a right click is Back). The first time, the TV asks you to **allow** the connection on its screen: allow it once and the key is kept in the add-on's own data
folder (`/media/developer/cleanyourtv/addon-data/phoneremote/ssap-key`, mode 600). Until it is allowed (or if the TV refuses) the pad
falls back to the arrow keys, at a slower pace.

**Keyboard.** The **Keyboard** button (last row of the Remote and the Touchpad) opens a drawer (the same kind as Inputs and Numbers) and brings up the phone's keyboard. What you type goes to the TV as you type, and the line under the TV name says "Typing live on TV". **Clear**, **Delete** (hold to repeat) and **Enter** (sends Enter to the TV and closes the drawer) sit under the box.

## Set up

It is an add-on from the catalog, not part of the package: the phone remote opens a port on your network and lets a paired phone control
the TV, so you install it on purpose. In the manager app, **Add-ons**, find **Phone remote**, install it and switch it **On**. Nothing
listens on the network until then, and switching it off again closes the port.

1. Open the add-on's page: in the manager, **Add-ons > Phone remote**, turn on **Page of the book** (or press 2 on Home afterwards): the
   page has **Pair a phone**, the paired phones, and **Remove unused phones**.
2. Choose **Pair a phone**. The TV shows a QR code, the address (`http://<tv address>:8799`) and a 6-digit code.
3. On the phone (same Wi-Fi) scan the code, or type the address. The code it shows is in the address the QR carries, so scanning it
   pairs by itself; typed in, the same code is entered on the page. The code works once
   and expires a few minutes after you leave the page. **A scan takes the code off the TV at once**: the TV says "Code scanned. Finish
   on the phone." and keeps the window open only for the phone that scanned it, until it has paired. A phone that is already paired
   and scans the code again just connects: the TV closes the window and says it is connected.
4. Press Back on the TV. The phone page now shows **Connected**. Add it to the home screen for a one-tap remote.

The page draws the QR with the generator that ships with CleanYourTV (`/addon/qrcode.js`, one copy in the repository: a catalog add-on
brings no copy of its own).

The phone keeps a token in the browser (`localStorage`). It has to be the same address every time, so give the TV a fixed address in
your router; if the address changes, pair again.

## The name of a device

The pairing page starts with a name in **Name of this device**; it can be changed before pairing, and it is what the manager app lists. The first
guess, best source first:

1. **An app around the page** (see [Other clients](#other-clients)): the name set in Android settings, or the maker and model (for example `Samsung SM-S918B`).
2. **The router's name for the phone.** The TV looks up the address the page was opened from (a reverse lookup, from the router's list of
   devices), so a computer shows its own name. It is used only when it is a name: nothing, an address, a MAC address, `wlan0` and
   `android-` followed by random characters are thrown away, and the domain after the name (`.lan`) is cut off. Phones that use a private
   (random) address often give nothing useful here. Only private addresses are looked up, the lookup waits 0.7 seconds at most and is
   remembered for ten minutes.
3. **The browser:** `iPhone`, `iPad` (also when it asks for the desktop site), `Android phone`, `Android tablet`, `Chromebook`, or the browser and the
   system of a computer, such as `Edge on Windows` or `Safari on Mac`.
4. `Device`.

A name that another paired phone already has gets ` 2`, ` 3` after it. A browser cannot tell a page the name of a computer or the model of a
phone, so there is nothing more to read there.

## Staying connected

While the page is open and the phone is awake, it keeps a live connection (a WebSocket) to the TV. It pings the TV every five seconds and
gives the connection up when no answer comes within four — so the power button says **On** only while the TV really answers. In the app the page also
checks the TV's port every three seconds, and drops the connection and shows **Off** only after two failed checks in a row (about six
seconds): one slow check on a phone that saves power is not taken for a TV that is off. It reconnects at once when the phone wakes up, the Wi-Fi comes back or the TV's
service restarts (with a growing pause of up to ten seconds in between). The token is checked again on every connection, so nothing needs to be scanned again. A phone that was
removed on the TV is told so and goes back to the pairing screen; a blocked one waits and tries again every 15 seconds.

## Logging out of a TV

The TV's name at the top of the remote (web page and app) is a button, with a small arrow. It opens **This remote**: the name the phone
paired with, the day it was paired and the TV's address. **Log out of this TV** asks first (**Stay paired** or **Log out**) and says what
goes: this phone stops controlling the TV, it is removed from the TV's list of paired phones, and everything it stored about the TV is deleted; to use it
again it pairs with a new code.

Logging out tells the TV (`{"t":"logout"}` on the connection; the TV answers `{"t":"bye"}`) and removes the phone from its list at once. What decides this is whether the
TV can be reached, not whether its screen is on: a TV on standby that still answers is told. When the page's own connection is closed it opens a short one of
its own, and waits three seconds at most. If the TV cannot be reached the phone still logs out and a note says the TV still lists it
(remove it on the TV, on the add-on's page, **Paired phones**). The result shows as a toast at the top of the pairing screen: three seconds when the TV was told, ten seconds when it was not. On the phone, the page deletes the token and every `cytv` entry it kept, and the Android app
forgets the TV's address, the network card address and the saved page, and returns to its start page.

## The apps on the TV

The page has four tabs: **Remote**, **Touchpad**, **Apps** and **Live**. The last one shows the TV's own app list — the icon and title of
every app the launcher shows — and a tap opens that app on the TV. The list and the icons come from the launcher's API on the TV (loopback
only), passed on by the phone remote's own server and only with the paired phone's token; opening an app goes over the phone's connection,
like a key press. A channel chosen on the **Live** tab opens Live TV, as a card does, and then presses the channel's number on the TV's digits, which is
how Live TV takes a number (the launcher is not asked for anything the phone remote needs: it is an [add-on](development/addons.md#the-phone-remote-the-phoneremote-add-on)).

## Control who has access

The page's top bar shows the TV's own name. On webOS 10 the name the user sets (Settings > General > Devices > TV Name) is not in the
settings store — it lives in Apple's HomeKit store, `/var/lib/airplay/HomeKitStore/00.00` (eight bytes of header, then the name,
NUL-terminated), which only root can read; `addons/catalog/phoneremote/tvname.js` reads its first 64 bytes (the header and the name, never
the pairing material that follows) and never writes to it. When there is no name there, the page shows
the model the TV reports (`getSystemInfo`), and **TV** only if even that cannot be read.

The phone remote has no screens in the manager: its own page on the TV does this (add it to the book: **Add-ons > Phone remote > Page of
the book**, then press 2 on Home):

| On the page | What it does |
|---|---|
| **Pair a phone** | The stage on the left becomes the pairing window: the QR code, the address and the 6-digit code, with how long it still works (**Expires in 2:47 · works once.**). When it runs out the code reads **Code expired** and **Get a new code** opens a new window; **Close** or Back closes it |
| **Remove unused phones** | One row at the bottom of the phones, with the current choice (**After 2 weeks ›**). For security: a phone that is not connected and has not been used for 1 day, 3 days, 1 week, 2 weeks (the default) or 1 month is removed by itself, and its token stops working. OK opens a list of the six choices; **Never** switches it off after a confirm, and the row then shows **Never** in amber. A phone that is close to being removed says so on its card (**Last used 12 days ago · removed in 2 days**), and its Manage sheet always says when (**Removed in 9 days if not used.**). When there are more phones than fit, the list slides with the focus and a line under it says how many more there are |
| **Phones** | Every phone that is paired (connected first), with whether it is connected or blocked and when it was last used; OK on a phone opens **Manage** |
| **Manage** > **Block this phone** / **Allow this phone** | It stays paired but sends nothing until you allow it (or the other way round); it applies at once |
| **Manage** > **Remove phone** | After a confirm (Cancel is first): its token stops working; it has to pair again |
| **Remove all phones**, below the list (two phones or more) | After a confirm: every token stops working |

Switching the add-on on or off is in the manager's Add-ons screen, as for every add-on: off closes the port and every connection, and
paired phones stay paired and work again when it is switched on. A service add-on's switch takes effect at the next start of the service.

The list shows when each phone was last used and whether it is connected. Up to 10 phones can be paired; the 11th is refused until one is removed. The **last used** time is saved at most once a minute per phone, so it
is accurate to about a minute.

**Remove unused phones** is a security setting: a phone that was lost, sold or forgotten would otherwise be able to control the TV for ever. The
service checks when it starts and every hour; a phone that is connected is never removed, and one that is removed can pair again with a new code.
Choosing **Never** turns it off and asks first, and the screen says what it means: a lost phone keeps the remote until someone removes it by hand.

## Turning the TV on

**Turn off** sends the TV's power key: standby, so Quick Start+ and Wake-on-LAN keep working. Turning it **on** again depends on how far the
TV went down: with Quick Start+ the system stays partly up with the screen off, the page still reaches it, and the same POWER key brings the
screen back. Only when the TV stops answering altogether (deep standby) is a Wake-on-LAN packet needed: its service, the app manager and
telnet are all asleep with the panel, and only the network chip listens, and only for a **Wake-on-LAN packet**.

A page in a browser cannot send that packet (a page cannot send UDP), so without a client that can, the page presses POWER only while the
TV answers. It shows the TV's address, and `ready.mac` and `ready.wol` (the TV's network card address, and whether Wake-on-LAN is on) are
there for a client that can send the packet. Send it from Home Assistant, a router, a Wake-on-LAN app or a Shortcut (below), or from an
app that wraps the page (see [Other clients](#other-clients)).

### Other clients

The phone page is the main client. A native app can wrap it in a WebView and add what a browser cannot do, such as sending the
Wake-on-LAN packet; the page looks for an object called `window.CYTV_APP` and uses it when it is there (`wake`, `setMac`, `deviceName`,
`buzz`, `up`, `forget`). A browser has none of these and the page works without them. No app is part of this project. The LAN protocol,
and what a wrapper can rely on, is written down for anyone who builds a client of their own:
[the phone remote protocol](phone-remote-api.md).

### If you already have something that wakes machines

Any of these sends the same packet to the TV:

| What you have | What to do |
|---|---|
| Home Assistant | a `wake_on_lan` switch with the TV's address, on the dashboard or as a button |
| A router | UniFi, OpenWrt, Fritz!Box and others have a Wake-on-LAN button in the device list |
| An app or a Shortcut | any Wake-on-LAN app; iOS Shortcuts and Android automation apps send it too |

### If the TV does not wake

- **Wake-on-LAN must be on** on the TV: **Settings > General > Devices > External Devices > TV On With Mobile**. The status line says so
  when the TV reports it off.
- Wired is the surest; on Wi-Fi the TV can leave the network in standby. Quick Start+ wakes it quickly, without it the TV cold-boots.
- The phone must be on the same Wi-Fi as the TV when you tap it.
- A TV switched off at the wall cannot be woken.
- The TV takes a few seconds. The power button shows a ring and **Turning on** or **Turning off** until the TV's own state matches, and the
  keys dim meanwhile. After 8 seconds the status line says it is slow. After 45 seconds the page
  stops waiting and says **Can't reach the TV** for a few seconds; it does not claim the TV is off. A second tap while it waits does nothing.
- The TV's network card address changes when it moves between cable and Wi-Fi: a client that sends the packet has to learn the new one
  (`ready.mac`) while the TV is on.

## How it works

- **Pairing.** The pairing window opens only while the add-on's page shows it (and closes 3 minutes after it was left). The code is
  random, works once, and a wrong guess is counted: an address gets five tries a minute and the window closes after eight wrong codes.
  A pairing from a web page on another site is refused, and the `Origin` has to name the TV's own address (or `localhost`), not merely
  match the `Host` header a page using DNS rebinding controls. The phone gets a random token (`<id>.<128-bit secret>`); the TV keeps
  only the SHA-256 of the secret in the add-on's settings (`config.json`, `addons.phoneremote.settings`, readable by root only), compares
  it in constant time and never writes tokens or codes in the log.
- **Before pairing nothing is accepted.** A connection that does not start with `{"t":"hello","token":…}` within 5 seconds, or sends
  anything else first, is closed. Unknown tokens count against the address; too many and it is shut out for a minute. A phone can send
  about 40 messages a second (a burst of 60); past that the TV answers "slow down".
- **The port.** 8799 listens on the local network **only** while the add-on is on and a phone is paired or the pairing window is
  open. It serves the phone page, the pairing call and the WebSocket (`/ws`), nothing else. It is plain HTTP; see [Security](security.md).
- **Typing.** `text`, `del` and `enter` are handled one after another for each connection, in the order they arrive, so typed text, a
  delete and Enter cannot overtake each other; a call that hangs for 8 seconds is given up so the rest still goes. Other keys are not
  queued behind them.
- **The keys.** Buttons go in through the TV's own `luna://com.webos.service.networkinput/sendSpecialKey` (`{"key":"HOME"}`), which
  is what moved the focus on a real TV. `controls/play`, `pause`, `stop`, `rewind`, `fastForward`, `channelUp` and `channelDown` are
  tried for the keys it does not take; if neither works the pointer socket (`getPointerInputSocket`, lines like `type:button`) is
  tried, and the volume and mute keys then fall back to `com.webos.service.audio`. The touchpad uses the pointer socket (`type:move`,
  `type:click`, `type:scroll`). The luna call `getPointerInputSocket` returns a Unix socket on webOS 10 that accepts the lines and ignores
  them, so the service asks the TV's SSAP service (`ws://127.0.0.1:3000`, `ssap://com.webos.service.networkinput/getPointerInputSocket`) instead: it
  gives a `ws://` address that works. That needs a client key, got once with the on-screen prompt and kept, mode 600, in the add-on's data
  folder (`addon-data/phoneremote/ssap-key`); the add-on has its own small WebSocket in `addons/catalog/phoneremote/ws.js`, as Node.js 8
  has none. The page batches moves every 33 ms and, if the pointer socket refuses, plays arrow keys instead for 30 seconds. Text goes
  through `com.webos.service.ime` (`insertText`, `deleteCharacters`, `sendEnterKey`). The code is
  `addons/catalog/phoneremote/remotekeys.js` behind a small interface, and each key's result is logged
  (`phoneremote: key HOME ok via special`).
- **Power.** The button in the page's top bar shows the TV's own power state — the remote asks `tvpower` for it when it connects and every five seconds, so **On** means the TV is `Active` or on its `Screen Saver`, not merely that a port answers — and a tap while the remote is connected sends the TV's power key (`POWER`, the standby of the remote's own key, so Quick Start+ and Wake-on-LAN keep working) without opening anything: it turns the TV off, and turns the screen back on from Quick Start+ standby. A **hold** on that button (about half a second) while the TV is on opens the **Power** drawer — the same sheet as the Inputs and the Numbers — with the four things the TV's power service can be told to do, one call to `luna://com.webos.service.tvpower/power/` each: **Screen off** (`turnOffScreen`: the picture goes dark and the TV keeps running, with the network up), **Standby** (`powerOff`, the soft off, which this page wakes again), **Restart** (`reboot`) and **Shut down** (`shutDown`, the hard off, after which only the TV's own remote turns it back on). Each call carries a reason, which is how the TV is told what caused it: `remoteKey` is the remote of the TV, and it refuses any other word with "Invalid reason", so the page sends nothing that the TV would not hear from its own keys. What the TV answers is what the phone shows; a restart and a shut down cannot be taken back, so they want a second tap within four seconds and say so while they wait for it. With the TV not answering the sheet does not open: in the app a tap on the button wakes the TV with a Wake-on-LAN packet, and a browser can only try to connect again, since a page cannot send UDP; see [Turning the TV on](#turning-the-tv-on). The status line says when the TV's own Wake-on-LAN setting (`wolwowlOnOff`) is off: turn it on in **Settings > General > Devices > External Devices > TV On With Mobile**. A full power-off through the service (`/api/power/off`) is not used here: afterwards the TV no longer wakes over the network.

## From a shell

```sh
curl -s localhost:8765/api/addons/phoneremote/state                               # state, paired phones (names, last seen), last key result
curl -X POST localhost:8765/api/addons/phoneremote/state -d '{"expireDays":7}'    # remove phones unused for 7 days (1, 3, 7, 14, 30; 0 = never)
curl -X POST localhost:8765/api/addons/phoneremote/key -d '{"key":"VOLUMEUP"}'    # press one key as a phone would, to try the way into the TV
curl -X POST localhost:8765/api/addons/phoneremote/access -d '{"id":"<id>","allow":false}'   # block / allow
curl -X POST localhost:8765/api/addons/phoneremote/revoke -d '{"id":"<id>"}'      # or {"all":true}
curl -X POST localhost:8765/api/addons/phoneremote/pair -d '{"stop":true}'        # close the pairing window
```

The add-on is switched on and off in the manager's Add-ons screen (`POST /api/addons/phoneremote/enable` with `{"enabled":true}` or
`false`, which takes effect at the next start of the service).

The keys: `UP DOWN LEFT RIGHT ENTER BACK HOME MENU EXIT INFO VOLUMEUP VOLUMEDOWN MUTE CHANNELUP CHANNELDOWN PLAY PAUSE STOP REWIND FASTFORWARD RED GREEN YELLOW BLUE 0`-`9`.

## Troubleshooting

- **The page does not open:** phone and TV must be on the same network, and the phone remote must be On with a phone paired or the
  pairing screen open. Some routers isolate Wi-Fi clients from each other ("AP isolation").
- **Connected, but keys do nothing:** the TV refused the way in. In the service log (Share log) lines start with `phoneremote:`. Try the
  `curl` above; the reply has the failing step. Tell us the result and your TV model.
- **"The TV did not answer":** the address changed, the TV is off, or the service restarted. The page retries by itself, and **Turn on**
  wakes the TV again when it still answers; from deep standby it needs a Wake-on-LAN packet ([Turning the TV on](#turning-the-tv-on)).

To undo everything: switch **Phone remote** off in Add-ons, or use **Remove all phones** on its page. Removing the add-on deletes its code
and keeps its settings; they go with `config.json` when CleanYourTV is uninstalled.
