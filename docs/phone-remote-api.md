# Phone remote protocol

This page is for anyone who builds their own client for the [Phone remote](phone-remote.md): an app for a phone or a watch, a Home Assistant
integration, a script, a microcontroller with buttons. The project ships the phone page and does not maintain a native app. The protocol
below is what the phone page itself uses, so whatever the page can do, a client can do.

Everything runs on the TV's **LAN address, port 8799** (`http://<tv address>:8799`), served by the add-on `phoneremote` — a catalog add-on,
installed from the manager's **Add-ons** screen and switched on there. While it is off nothing listens. Nothing on this port is encrypted: use
it on a network you trust.

## Overview

1. **Pair once.** The TV shows a 6-digit code. The client sends it to `POST /api/pair` and keeps the **token** it gets back.
2. **Connect.** The client opens a WebSocket at `/ws` and sends the token in the first message.
3. **Send actions** (keys, pointer moves, text, launching an app) and read the answers.
4. For the lists of apps, inputs and Live channels, and for pictures, use the plain HTTP calls with the token in the address (`?t=`).

## Pairing

On the TV: the add-on's own page (**Add-ons > Phone remote**, then its page of the book on Home: **Pair a phone**). The TV shows the address
and a code. The code works once and the pairing window closes a few minutes after the page is left (at most 30 minutes after it opened), or
after 8 wrong codes. Opening `GET /?code=<the code>` (what the QR code carries) counts as a scan: the TV takes the code off its screen
(`pairing.scanned` in the state), and from then on only that address may pair with it. When a phone that is already paired connects from
that address, the window closes (`scanned: {name, at}` in the state). Programs on the TV can open the same window without the page:
`POST http://127.0.0.1:8765/api/addons/phoneremote/pair` (loopback only; see [On the TV itself](#on-the-tv-itself)).

```
POST /api/pair
content-type: application/json

{"code": "123456", "name": "Kitchen tablet"}
```

| Answer | Meaning |
|---|---|
| `200 {"token": "<id>.<secret>", "name": "Kitchen tablet"}` | Paired. The token is `<8 hex digits>.<32 hex digits>`. Keep it; it is shown only now. The TV keeps a hash of it, not the token. The name can come back with ` 2`, ` 3` after it when another phone already has it |
| `403 {"error": ...}` | The code is wrong, or the TV is not waiting for a phone |
| `409 {"error": ...}` | 10 phones are paired already; remove one on the TV |
| `429 {"error": ...}` | More than 5 tries from this address in a minute |

The `Origin` header must be **absent, or name the TV itself** (`http://<tv address>:8799`, or `localhost`). A request from a page on another
web site is refused with `403`; a native app, a script or a Home Assistant integration sends no `Origin` and is fine. This is what keeps a
web page you happen to visit from pairing with your TV. The address has to be one the TV has, not merely the same as its `Host` header (a
page using DNS rebinding controls that), so a client written as a web page has to be served from the TV's own address.

Up to 10 phones can be paired. A phone is removed on the add-on's page (**Paired phones**), by itself when it has not been used for
the chosen time (2 weeks by default), or when it logs out (below). After that its token stops working and it has to pair again.

## The WebSocket

Connect to `ws://<tv address>:8799/ws`. Text messages only, each one a JSON object with a `t` field, at most **4096 bytes**. If the client
sends an `Origin` header it must be the TV's own address, as for pairing. The first message must be the token, within **5 seconds**:

```json
{"t": "hello", "token": "1a2b3c4d.0123456789abcdef0123456789abcdef"}
```

The TV answers with `ready`, or with `denied` and closes the connection.

| From the TV | Fields | When |
|---|---|---|
| `ready` | `name` (this phone's name), `tv` (the TV's name), `keys` (the key names that `key` accepts), `mac`, `wol` (the TV's network card address and whether Wake-on-LAN can be used, for a client that sends the wake packet itself), `seen` (when this phone was last used, ms), `created` (when it paired, ms) | the token is good |
| `denied` | `reason`: `revoked` (the token is unknown or was removed) or `blocked` (the phone is blocked on the TV) | the token is not accepted; the TV then closes with code 4401 or 4403 |
| `pong` | | answer to `ping` |
| `power` | `state`: what the TV says about itself (`Active`, `Screen Saver`, `Screen Off`, `Active Standby`, ...), or an empty string | answer to `power` |
| `ack` | `n`, `ok` (true or false), `e` (the reason when `ok` is false) | answer to an action that carried an `n` |
| `err` | `n`, `e: "slow down"` | the client sent too fast, the action was **not** run |
| `bye` | | answer to `logout`; the connection closes |

| Close code | Meaning |
|---|---|
| `4401` | the token is unknown or was removed, or something other than `hello` came first. Pair again |
| `4403` | the phone is blocked on the TV. Try again later (the phone page tries every 15 seconds) |
| `4408` | no `hello` within 5 seconds |
| `1000` | normal close after `logout` |

An HTTP `503` on the upgrade means 24 connections are open already (the add-on itself takes no more); `429` means too many wrong tokens from
this address (10 in a minute). While the add-on is off, or nothing is paired and no window is open, nothing listens on 8799 at all.

### Messages from the client

| Message | Fields | Does |
|---|---|---|
| `ping` | | keeps the connection alive. The TV drops a connection that has been quiet for 60 seconds; the phone page pings every 5 seconds |
| `power` | | asks for the TV's power state; answered with `power` |
| `logout` | | removes this phone from the TV's list and closes. Use it when the user logs out |
| `key` | `k`: one of the names in `ready.keys` | presses a remote button |
| `move` | `dx`, `dy`: numbers | moves the TV's pointer (the touchpad) |
| `click` | | clicks the pointer (OK) |
| `scroll` | `dy`: number | scrolls |
| `text` | `s`: the text | types into the text field that is open on the TV |
| `del` | `c`: how many characters | deletes characters in that field |
| `enter` | | presses Enter in that field |
| `launch` | `id`: an app id (`[\w.-]+`, from `GET /api/apps`) | opens an app. The launcher's own Home counts as an app |
| `live` | `num`: a channel number, 1 to 99999 | opens Live TV and keys in the channel number (about 3.5 seconds later) |
| `liveSetup` | | opens Live TV on the TV, where a playlist is added |
| `tvpower` | `a`: `off` (screen off, TV keeps running), `standby`, `reboot` or `shutdown` | the power drawer's four calls. After `shutdown` the TV answers nothing and only its own remote brings it back |

Add `"n": <number>` to any action to get an `ack` for it. Without `n` the TV runs the action and says nothing. The typing actions (`text`, `del`, `enter`) are run **one after the other** in the order they were sent, so typed text arrives in order (a
single action gives up after a time-out and answers `timed out`). The other actions are not queued.

The key names are: `UP DOWN LEFT RIGHT ENTER BACK HOME MENU EXIT INFO POWER VOLUMEUP VOLUMEDOWN MUTE CHANNELUP CHANNELDOWN PLAY PAUSE STOP REWIND FASTFORWARD RED GREEN YELLOW BLUE 0 1 2 3 4 5 6 7 8 9`. Read the list from `ready.keys` rather than copying it: a newer TV build may have more.

**Limits.** A connection may send 40 messages a second, with a burst of 60. Beyond that an action gets `err` (`slow down`) and is not run,
so a touchpad client should send moves at about 30 a second at most, adding up the movement in between. `ping` does not count. Large
messages close the connection.

A client should reconnect by itself with a growing pause (the phone page goes up to 10 seconds), and on `denied` with `revoked` go back to
pairing instead of retrying.

Example, in JavaScript (Node 22 or a browser page served from the TV):

```js
const ws = new WebSocket('ws://192.168.1.50:8799/ws');
ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }));
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.t === 'ready') ws.send(JSON.stringify({ t: 'key', k: 'VOLUMEUP', n: 1 }));
  if (m.t === 'ack') console.log(m.n, m.ok, m.e);
};
```

## HTTP calls with the token

These need the token in the address, as `?t=<token>`, and answer `403 {"error": "forbidden"}` without a good one (or for a blocked phone).
Do not log these addresses: they hold the token.

| Call | Answer |
|---|---|
| `GET /api/apps?t=…` | `{"apps": [{"id", "title"}, ...]}`: the apps the launcher shows. Icons come from `/icon/<id>` |
| `GET /api/inputs?t=…` | `{"inputs": [{"appId", "title", "tuner", "off"}, ...]}`: the TV's ports (`appId` is what `launch` takes; `off` is true when nothing is plugged in) |
| `GET /api/live?t=…` | `{"channels": [{"num", "name", "group", "logo"}, ...]}`: the channels of the user's own Live TV playlist (without the stream addresses). `logo` says whether `/api/logo/<num>` has a picture |
| `GET /api/logo/<n>?t=…` | the logo of channel `n` (an image, cached for an hour) |
| `GET /icon/<app id>?t=…` | the app's icon (an image, cached for an hour) |

## On the TV itself

The add-on's page on the TV uses these calls on `http://127.0.0.1:8765` (loopback only), under `/api/addons/phoneremote`: `GET /state` (the
status: the pairing window, the paired phones, the last key's result), `POST /state {expireDays}`, `/pair {stop?}`, `/revoke {id}` or
`{all:true}`, `/access {id, allow}`, and `/key {key}` (press one key as a phone would, to test the TV's side without a phone). The bare
address `/api/addons/phoneremote` is the loader's own reply about the add-on, not this state. The add-on is switched on and off with
`POST /api/addons/phoneremote/enable {enabled}`, as any add-on is.

## The page's `window.CYTV_APP` hooks

A native app (not part of this project) can wrap the phone page in a WebView and give it an object called `window.CYTV_APP`, for what a
browser cannot do. The page uses it only when it is there, so these seven names are the contract between the page and a wrapper: `wake`,
`setMac`, `deviceName`, `buzz`, `up`, `forget`, `setName`.

| Hook | What the page expects |
|---|---|
| `wake()` | send the Wake-on-LAN packet to the address the page last gave with `setMac`, and return whether it was sent |
| `setMac(address)` | the TV's network card address (the page learns it from `ready.mac`), kept by the app for the next wake |
| `deviceName()` | the name of this phone, the first guess in the pairing form (before the router's name and the browser's) |
| `buzz()` | a short vibration when a key is sent or a pairing works; a browser has none and the page works without it |
| `up()` | whether the app can reach the TV right now (its own check), for the "On"/"Off" line |
| `forget(reason)` | delete everything the app kept about this TV, on **Log out of this TV**: `reason` is `'left'` or `'removed'` (the TV removed this phone) |
| `setName(tv)` | the TV's own name, as the TV reported it (empty when it has none), so the app can show it where it lists the TV |

A browser has none of these hooks and the page works without them: `wake` and `up` fall back to the page's own connection, and `buzz`,
`setMac`, `deviceName`, `setName` and `forget` do nothing. A wrapper that adds a hook must keep to this table: the page may use it on any
screen.

## Security

- Anyone on the network who has a token controls the TV. Treat a token like a password and give each device its own (pair it again).
- A token can be removed on the TV at any time; the next connection of that device gets `denied` (`revoked`).
- Wrong tokens and wrong codes are slowed down per address; a code is good for one pairing only.
- See [Security](security.md#phone-remote) for what the add-on can and cannot do on the TV.
