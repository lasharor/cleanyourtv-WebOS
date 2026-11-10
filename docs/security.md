# Security

## What this changes on a TV

CleanYourTV runs a service **as root** on a rooted TV. It listens on `127.0.0.1:8765` only. A few short-lived pages open on the
local network on request, and an optional notification endpoint is off by default.

| Port | What | When it is open |
|---|---|---|
| 8765 (`127.0.0.1` only) | The service API | Always; see [Service API](api.md) |
| 8766 | Live TV pairing page | While you set up Live TV: a 6-digit code shown on the TV, ten minutes |
| 8767 | Network notifications | Only when you switch it on in the manager app; needs a token |
| 8768 and up | Share-log page | Ten minutes, at a random address, with a masked report |
| 8769 | Voice setup page | Ten minutes, at a random 128-bit address, closed after saving |
| 8791 | Wallpapers page | While the QR screen is open in the manager app: a 6-digit code shown on the TV, at most an hour; see [Wallpapers](wallpapers.md) |
| 8793 | Android box page | Ten minutes while its QR screen is open in the manager app: a 6-digit code shown on the TV; see [Android box](android-box.md) |
| 8792 | Cards page | The same, for the options of the cards on Home; see [Cards](launcher.md#cards) |
| 8794 | App icons page | The same, for choosing a picture for an app; see [Your own icon](launcher.md#your-own-icon) |
| 8795 | Immich page | The same, for the Immich add-on (address, API key, albums); see [Wallpapers](wallpapers.md#immich-add-on) |
| 8796 | Unsplash page | The same, for the Unsplash add-on (Access Key, search words); see [Wallpapers](wallpapers.md#unsplash-add-on) |
| 8797 | Spotify page | The same, for the Spotify add-on (the Client ID of your own Spotify app, the sign-in); see [Spotify now playing](#spotify-now-playing) |
| 8801 | Stocks and crypto page | The same, for the Stocks and crypto add-on (the Twelve Data API key); see [Cards](launcher.md#cards) |
| 8800 | Add-on repositories page | The same, for adding a repository of add-ons from your phone (ten minutes); see [Add-on repositories](development/addon-repos.md) |
| 8802 | MCP on the network | Only when you switch it on in the manager app (Features > AI agents (MCP)); needs a token; see [MCP on the network](#mcp-on-the-network) |
| 8803 | Agent tools page | The same, for the agent add-on: which apps and add-ons may give the voice assistant their tools; see [Agent tools](agent.md) |
| 8798 | Jellyfin page | The same, for the Jellyfin add-on (server address, user name and password; the TV keeps only the access token); see [Cards](launcher.md#cards) |
| 8799 | Phone remote (a catalog add-on) | Only while the add-on is on **and** a phone is paired or its pairing screen is open; every phone needs a token from a one-time code; see [Phone remote](phone-remote.md) |

What the setup changes on the TV is listed in [What it changes on the TV](tv-changes.md).

## Network notifications

Off until switched on in the manager app. It then listens on port 8767 for `POST /notify` with `Authorization: Bearer <token>`
(a random 192-bit token kept in `config.json`, readable by root only). It exposes only the notification call. Wrong tokens lock
an address out for ten minutes, requests are limited to 20 a minute and 32 KB, and an optional `allow` list restricts addresses.
It is plain HTTP: the token can be read by anyone who can watch the traffic on your network.

**Show as QR code** in the manager makes the same port serve one more page, `GET /t/<24 random characters>`, for ten minutes: it shows the address and the
token so a phone can copy them. The address is created when the code is shown (96 bits of randomness), follows the same allow list, and stops
working after ten minutes, when notifications are switched off or the service restarts. Anyone who sees the code on the screen, or can read
the traffic, can read the token while it is open; **New token** replaces it.

## MCP on the network

Off until switched on in the manager app (**Features > AI agents (MCP) > Accept MCP clients from the network**). Port 8802 then listens
only while an agent is paired or **Connect an agent** shows a code. An agent pairs with that code (6 digits, works once, ten minutes; five
tries a minute per address, eight wrong codes take it off) and gets a token of its own (`<id>.<128-bit secret>`). The TV keeps only a
SHA-256 of each secret, in `config.json` (`mcp.agents`, readable by root only), compares it in constant time and never logs it. With its
token an agent can call `POST /mcp` (MCP over HTTP, JSON-RPC 2.0): **open apps, switch inputs, show cards and use the tools of the add-ons
you approved**, nothing else of the service. Tools that turn something off or delete something (`power_off`, and every signed tool that is not a plain read: a method other than GET, or `"confirm": true`) are refused from the network: they run only from the voice assistant, after you say a plain "yes" on the TV. The remote's remapped buttons (`remote_buttons press`) can only open an app, an input, Live TV, Home or the picker; none turns the TV off. A signed tool reaches only the add-on that declared it, and an address it calls is refused when it stands for the TV itself, whatever name it is written as.
Each agent is listed in that screen's **Connected devices** menu and can be blocked, allowed or removed there, all at once with **Remove all devices**; an agent not used
for two weeks (the default; 1 day to 1 month, or never) is removed by itself. A request that carries an `Origin` header (a web page in a
browser) is refused, ten wrong codes or tokens lock an address out for ten minutes, and requests are limited to 60 a minute and 64 KB. It is plain
HTTP: anyone who can watch your network can read a token, the pairing code and the page behind the QR code, so use it on a network you trust. The agent add-on's own page (port 8803, for approving sources) listens on the network the same way while you have it open, behind its code; it is a short-lived page like the other add-on pages. The per-address counters (wrong tries, requests a minute) keep at most 500 addresses. The page behind the QR code shows the code,
not a token. Its address is short to type (`http://<tv>:8802/` and 8 letters and digits, about 40 bits); a wrong address counts as a wrong try, so ten misses shut an address out for ten minutes. Its status (`/<8 characters>/status`, while it is open) tells only the name and address of the agent that paired, when, and whether it has made a call.

## Themes

The manager downloads the theme list, screenshots, theme files and wallpapers from `raw.githubusercontent.com` (the `main` branch of this
repository) over HTTPS, when you open **Theme** or choose a theme. They are data only: the service checks every value against its list,
limits the sizes (theme 32 KB, wallpaper 1.5 MB, screenshot 600 KB), checks that images are images and refuses anything else. There is
no script or CSS in a theme. Anything merged into `main` becomes available to every TV, which is the same trust you place in the
releases of this repository; there is no signature.

## Weather card

Only with a weather card on Home. The service asks `api.open-meteo.com` over HTTPS for the weather at the card's place, at most every
30 minutes, and keeps the last answer in `weather.json`; the request carries the place's coordinates (rounded to about a kilometre) and
nothing else. Searching a place on the phone page sends the name you type to `geocoding-api.open-meteo.com`. No account or key.

## Home Assistant cards

They use the Home Assistant address and token set under **More** > **Home Assistant**, the same ones Voice uses; nothing else is stored. The service reads the states with one
request every 20 seconds at most, switches only lights, switches, fans, input booleans and automations (and runs scenes and scripts)
when you press OK on a card, and passes a camera's picture to the launcher. Locks, alarms and covers are never switched.

## Spotify now playing

Optional, and only with the Spotify now playing add-on (it asks for the permissions `net.fetch` and `luna`, the second only for the call that starts the Spotify app of the TV). You bring your own Spotify app: the service uses its **Client ID** (not a secret) and
the sign-in code flow with PKCE, so no client secret is ever needed or stored. The sign-in happens on its own phone page (port
8797, opened from the manager app, ten minutes to an hour, plain HTTP like the other phone pages: the address you paste back and the Client ID are visible on
your Wi-Fi while you type them). The service then asks `accounts.spotify.com` for the tokens and `api.spotify.com` for what plays,
over HTTPS, and fetches the cover from `*.scdn.co`. The scopes are `user-read-currently-playing` and `user-read-playback-state`
(what plays) and `user-modify-playback-state` (the card's buttons: play, pause, next, previous, and the seek that puts a song back where it was when the cover opens the Spotify app; the output button lists the
devices of the account and moves the music to the one you choose; and, only if you switch on **Wake speakers on my network** on the set-up page, the permission **streaming**, used to wake a speaker of your network that Spotify does not list (see below); nothing else is changed, no playlist, no library, no volume). The service sends these only when you press a button or the cover on the card. The access token (valid an hour) and the refresh token (about six months) are
kept in `config.json` under `spotify`, readable by root only; they are never written to the log, never returned by the service
(the launcher's settings leave `spotify` out) and `tools/diagnose.sh` hides them and the Client ID. **Disconnect Spotify** deletes them;
you can also remove the app's access at spotify.com/account/apps.

Waking a speaker is off by default: the sign-in asks for the **streaming** permission, and the service looks for speakers on the network, only after you switch on **Wake speakers on my network** on the set-up page and sign in again (switching it off means disconnecting and signing in again). When it is on and you choose a speaker that Spotify does not list, the TV first asks **Sign in on this device?** and sends nothing until you answer yes. The service asks the local network with mDNS for Spotify Connect devices (UDP 5353, multicast) and, for the one you choose, sends it your account's access token over plain HTTP on the local network, encrypted for that device with a Diffie-Hellman key exchange (as the Spotify apps do; the AES and HMAC keys come from the first 16 bytes of the SHA-1 of the shared secret). Only private addresses are asked, and the device that answers must report the id that was listed. Any device of your network can answer the discovery, though, and calls itself what it likes: the token goes to the one you choose, so choose a device that you recognise. The token is valid for an hour and you can revoke the app's access at spotify.com/account/apps.

## Voice

Optional and off by default. Installing it downloads files over HTTPS from PyPI, Ubuntu's archive and Moonshine's model server (on a
TV with a 32-bit ARM kernel: PyPI, Ubuntu's archive and Hugging Face, at a fixed revision); each file is checked against a SHA-256
value written in the code, and a mismatch stops the install. The recogniser is a 64-bit program (a 32-bit hard-float one on a 32-bit
ARM kernel) started by the root service with its own copy of the C library; it reads audio from a pipe and prints text.

- Audio from the remote's microphone is held in memory only while recognising.
- Only the recognised text is sent, and only to the address you set (plain `http://` is possible: the token is then visible on
  your network) and, if you switch on AI chat, to the AI providers you set, in their order, until one answers: `openrouter.ai`
  over HTTPS with your OpenRouter key (OpenRouter and the model's provider see the text), and a self-hosted server of yours at
  the address you gave (over plain `http://` if you give one). Each key goes only to its own provider; the OpenRouter key never
  reaches your server.
- The phone setup page is a short-lived page on the local network (port 8769, a random 128-bit address, ten minutes, closed after
  saving, plain HTTP: the key is visible on the network while it is typed).
- With **Home Assistant recognises the speech** switched on (off by default, `voice.stt`), the audio of each phrase (at most 30 seconds,
  16 kHz mono PCM, held in memory, never written to disk) goes to your Home Assistant over its WebSocket API (`ws://` or `wss://`
  at the address you set, with the same token, sent once in the sign-in message; a self-signed certificate only when you switched
  that on). Nothing else is sent to anyone for it. If Home Assistant fails, the recogniser on the TV is used when installed.
- With Home Assistant set up, the recognised text goes to the address you set, with your long-lived access token (plain `http://` is
  possible: the token is then visible on your network; a self-signed certificate is accepted only when you switch that on).
- The keys and the token are kept in `config.json` (readable by root only) and are never returned by the service.
- Pausing LG's voice assistant sends it SIGSTOP; nothing of LG's is modified.

## Trust

Everything it installs comes from this repository's GitHub releases and runs as root. Releases carry a SHA-256 file, which
detects corruption but **not a compromised repository**. Download only from the release page of this repository.

## Dev builds

The manager's **Update channel** can follow the dev builds: the pre-release named `dev` that GitHub Actions publishes for each
push to the `dev` branch. It is opt-in and off by default; the stable updater only reads the latest non-pre-release. A dev build is
downloaded over HTTPS from the repository the TV already updates from and checked against the `.sha256` file in the same release,
so the check protects against a damaged download, not against someone who can publish to the repository (the same is true of
stable releases, which are not signed yet). The only pre-release the updater reads is the one tagged `dev`, and the files must be
the package and launcher names the updater already expects.

## Phone remote

A phone that pairs can press the TV's remote keys, so the pairing is strict. It is a catalog add-on, off until a person installs it and
switches it on (Add-ons), because it opens a port on the LAN; that port (8799) listens on the network only while a phone is paired or the
pairing screen of the add-on's page is open. Pairing needs the 6-digit code shown on the TV (the QR code carries it in its address, so a
phone that scans the screen pairs without typing; that is the same information as the digits, and a photograph of the screen already gave
it away): it works once, an address gets five tries a minute, the window closes after eight wrong codes and three minutes after the
pairing screen was left, and a pairing request from a web page of another site is refused: the `Origin` has to name the TV's own
address (or `localhost`), not merely match the `Host` header, which a page using DNS rebinding controls. The phone gets a random 128-bit
token; the TV keeps only its SHA-256 in the add-on's settings (`config.json`, `addons.phoneremote.settings`, root only), compares in
constant time, and never logs tokens, hashes or codes. Nothing is accepted from a connection before
it shows a valid token (first message, 5 seconds), wrong tokens shut an address out for a minute, a connection may send 40 messages a
second, and a page from another origin cannot open the WebSocket. Phones can be blocked or removed on the add-on's page and are cut off
at once. It is plain HTTP: anyone who can watch your Wi-Fi traffic can read the token and the keys (and could pair only with a code from
the screen, but could replay a stolen token), as for the other phone pages. A paired phone can also put the TV in standby with the TV's
own power key (`POWER`, not the service's full power-off, so Wake-on-LAN keeps working); turning it on again from deep standby needs a Wake-on-LAN packet (see [Turning the TV on](phone-remote.md#turning-the-tv-on)).
## An app around the phone page

A native app (not part of this project) can load the phone page in a WebView and expose a bridge object, `window.CYTV_APP`, for what a
browser cannot do, such as sending the Wake-on-LAN packet. The page uses the bridge only if it is there, and calls only `wake`, `setMac`,
`deviceName`, `buzz`, `up` and `forget`. The TV does not hand out an app and trusts such an app no more than a browser: it has the same
token, the same rate limit and the same pairing code. An app that exposes a bridge should load only the TV's own address and its own
pages, because the bridge is open to whatever the WebView loads.
- Waking the TV needs no secret: the packet carries no key, and any device that knows the TV's MAC can send it, before or after it is removed
  from the paired phones. That is true of every Wake-on-LAN setup, including LG's own. The app does not change it.
- Everything else — pairing, tokens, blocking, the keys — is the phone remote's, described above. Uninstalling the app leaves the pairing on
  the TV; remove it in the manager if you want it gone.

## Limits to know about

- Any app on the TV can already run root commands through the Homebrew Channel; apps are not a security boundary on a rooted TV.
- `/media/developer` is world-writable on webOS. The setup removes group and other write access from this project's files and
  keeps the playlist and settings files owner-only, but the parent folder remains writable.
- The service API refuses requests from web pages (any `http(s)` origin); local apps and scripts are accepted.

!!! tip "Move from telnet to SSH"
    A rooted TV often has an unauthenticated telnet server open on the local network. Turn telnet off and SSH on in the
    Homebrew Channel's settings.

## Reporting

Open a private security advisory on the [GitHub repository](https://github.com/lasharor/cleanyourtv-WebOS/security/advisories),
or an issue that does not include exploit details.
