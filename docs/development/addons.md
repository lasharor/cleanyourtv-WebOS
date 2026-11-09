# Add-ons

An add-on is a feature that is loaded, installed and removed on its own. Live TV and the Android box are bundled add-ons: they ship in the package (`helper/addons-bundled/iptv/` and
`helper/addons-bundled/androidbox/`) and still answer their old paths (`/api/live/...`, `/api/androidbox...`), so the launcher and the
manager did not change for them. A bundled add-on gets the service's own ctx as well as its add-on fields. Every add-on, bundled or not, also gets `util` (`lanIp`, `randomInt`, `mkdirp`, `i18n`) and `env` (`lang()`: the Language setting, or while that follows the TV the language Home is shown in, as the launcher says with the requests of the cards; `wallpaperSize()`). Other add-ons come from **repositories** (the project's own catalog in this repository is the first; anyone can publish one, see [Add-on repositories](addon-repos.md)) and are installed from the manager (**Add-ons**) or with `cytv-addons`.

What is done, and what is not:

- Done: the loader, pages served by the service and shown over Home, installing and removing from the catalog (every file checked
  against its SHA-256), the manager's Add-ons screen, and Live TV, both its service part and its player and guide.
- Not done, on purpose: voice, wallpapers, the Input key, cards, notifications, themes and the debloat stay parts of the service.
- Not tried on a TV: turning pages with the remote's number and colour buttons, Live TV inside the page, video playing in it, the
  page turn's smoothness on a weak GPU, and installing. The tests cover the service; the launcher with its page strip and the page
  turns were run in a desktop Chromium, not in Chromium 68 or 79.

## Where they are

| Place | What |
|---|---|
| `helper/addons-bundled/<id>/` (the package; `addons-bundled/` beside the service files on the TV) | Add-ons that ship with CleanYourTV. Cannot be removed. May keep answering old API paths (`routes`) and take their on/off switch from an existing option (`enabledOption`). |
| `/media/developer/cleanyourtv/addons/<id>/` | Installed from the catalog, or put there by hand. |
| `/media/developer/cleanyourtv/addon-data/<id>/` | What an add-on stores; kept when it is removed. |
| `addons/catalog/<id>/` and `addons/index.json` (this repository) | The catalog. `node tools/addon-index.js` writes the index with a SHA-256 for every file; a test fails when it is out of date. |

## The manifest

```json
{
  "id": "bigclock",
  "name": "Big clock",
  "version": "1.0.0",
  "minService": "1.6.11",
  "kind": "page",
  "description": "A full-screen clock.",
  "entry": { "page": "index.html" },
  "permissions": [],
  "tile": { "label": "Clock", "icon": "clock", "placement": "page" }
}
```

- `about` (optional, at most 600 characters) is the longer text the manager shows next to the add-on's picture; `description` stays one sentence.
- `preview.jpg` (or `.png`, `.webp`; 800 x 450 and at most 600 KB, like a theme's screenshot) is the add-on's picture in the manager's Add-ons
  tab. A bundled add-on ships it in its folder. A catalog add-on keeps it in `addons/catalog/<id>/`: `node tools/addon-index.js` lists it in the
  index (it is not part of `files`, so it is never installed) and the manager reads it from GitHub and keeps it for a day
  (`GET /api/addons/preview/<id>`).
- `tile.icon` is the icon of the page in the page strip and on its button: `home`, `tv`, `clock`, `chart`, `globe`, `photo`, `music`, `play`, `star`, `heart`, `cards`,
  `grid`, `hdmi`, `settings` or `addon` (the default).
- `kind` is `page` (a web page, no code in the service) or `service` (Node code that runs as root in the service; also needs
  `entry.service`). The folder name is the `id`.
- `service.js` exports `create(ctx)` and returns `{ handle(req, res, path, body), start() }`; `path` is what follows
  `/api/addons/<id>`. `ctx` has `id`, `dir`, `dataDir`, `log(line)`, `settings.get()`/`settings.set(obj)` (in `config.json` under
  `addons.<id>.settings`, logged as `addon:<id>`) and, with the permission, `fetch` (`net.fetch`) and `notify(body)` (`notify`).
  It has no `exec`, and no `luna` unless the manifest asks for it (the permission `luna`, below). This is a convention, not a sandbox: the code runs in the service, which is why a service add-on is
  only installed from the catalog, where every file is pinned by hash and reviewed. The service must run on Node.js 8.12.
- `routes` and `enabledOption` are for bundled add-ons only: an installed add-on is reached through `/api/addons/<id>/...`.
- A service add-on that opens a port or sets a timer also returns `stop()`, which closes them; the switch of a service add-on takes effect at the
  next start of the service. The phone remote keeps its LAN listener and its two timers that way.

## The Android box (the androidbox add-on)

`helper/addons-bundled/androidbox/` holds the service (`service.js`), the ADB client (`adbclient.js`) and the phone page (`page.js`). The
manifest's `routes` is `/api/androidbox` (that path and everything below it). Its settings stay in `config.json` (`androidBox`) and the
key in `adb/adbkey`, where they always were. The launch hook in `helper/apps.js` asks the loader for the add-on
(`addons.module('androidbox')`), so an app set up for the box still switches the input. Switch the add-on off in the manager and its
settings screen has nothing to talk to after the next start; the apps then open on the TV.

## App icons (the icons add-on)

`helper/addons-bundled/icons/` holds the service (`service.js`): the pictures in `icons/` and `icons/tile/`, the phone page on port 8794 and
the reset. The manifest's `routes` is `/api/icons`. Like the Android box, the core reaches it only through the loader
(`addons.module('icons')`): `helper/apps.js` sends the picture first on `/icon/<app id>`, marks the app with `iv` (and `it` for Full tile)
and adds `icons: true` to `/api/apps` while the add-on runs; the launcher offers **Change icon** and **Reset icon** only then, and the
manager's status has `icons` for its **App icons** row. Switched off, every app shows its own icon and the pictures stay on the TV.

## The phone remote (the phoneremote add-on)

`addons/catalog/phoneremote/` holds everything of the [phone remote](../phone-remote.md): the service (`service.js`: pairing, tokens, the
paired phones), its own WebSocket (`ws.js`), the key adapter (`remotekeys.js`), the phone page (`page.js`), the guess for the phone's name
(`devicename.js`, `tvname.js`), and the add-on's own page on the TV (`src/` → `page/index.html`, pairing and the paired phones).

It is **installed from the catalog**, like the Spotify and Jellyfin add-ons: it opens a port on the LAN and lets a paired phone control the
TV, so a person installs it on purpose, and every file is pinned by hash. It gets only its `ctx`: the paired phones and the "remove unused
phones" choice are its settings (`config.json`, `addons.phoneremote.settings`), the SSAP key is `ssap-key` in its data folder
(`addon-data/phoneremote/`), and its calls to LG's services are the ones `addon.json` lists (`networkinput`, `ime`, `audio`, `tvpower`,
`settings`, `systemproperty`). Its API is `/api/addons/phoneremote/...`, answered by `service.js`; the listener on port 8799 is its own and
runs only while a phone is paired or the pairing window is open.

The manager has no screens for it: the add-on's page does that (**Add-ons > Phone remote**, and a page of the book on Home). The launcher
and the Live TV page know nothing of it: a channel chosen on the phone is Live TV opened as a card opens it, then the channel's number
pressed on the remote's digits.

## Live TV (the iptv add-on)

- The service part is `helper/addons-bundled/iptv/service.js`; it answers `/api/live/...` as before (`routes`).
- The player and guide are the page `helper/addons-bundled/iptv/page/index.html`, built by `node tools/build-pages.js` from
  `helper/addons-bundled/iptv/src/` (the same way as the launcher). `js/live.js` there is the player; `js/shim.js` gives it what the
  launcher's script used to (language, clock format, the theme variables); `js/start.js` handles the launcher's messages.
- The launcher's `app/src/js/live.js` is a small object (`LIVE.enter`, `exit`, `key`, `resume`, `toggleGuide`) that turns the book to
  that page (`app/src/js/addons.js`, `PAGER`) and passes calls on, so the Live TV button, the Inputs list and the Guide key work as
  before. The page tells the launcher when to go back to Home.
- **A launcher with Live TV as a page needs a service that serves add-on pages.** At release, `app/version.json` must name that
  service version as `minService`.

## Providing something to the service: photo sources

A service add-on can plug into a part of the service. The manifest says what with `"provides": ["wallpapers"]`; the add-on returns the
matching object from `create()`. For wallpapers, `helper/wallpapers.js` asks every running, switched-on add-on that provides it. The
object is `wallpapers` on the module `create()` returns:

| Member | What it does |
|---|---|
| `label` | The name in the manager (**Wallpapers**). |
| `list()` | Ids of the photos it has now (letters, digits, `-`, `_`, `.`; at most 500). Each is a file it can hand out. |
| `file(id)` | The absolute path of that photo: a JPEG, PNG or WebP. Core serves it at `/api/wallpapers/photo/s/<add-on>/<id>`. |
| `live: true`, `next()` | A live source keeps nothing on the TV. Home asks `next()` each time it shows that entry and gets `{url, credit}`: a plain `https://` address of the picture (it goes into a CSS `url()`, so quotes, brackets and spaces are refused) and a line Home shows in the bottom right corner, such as the photographer. The source decides how often it asks its server. |
| `status()` | `{summary, error}`: one line for the manager (photos, last sync, what went wrong). |
| `settings(o)` | Starts a short-lived page on the LAN for the source's settings and returns `{url, code, qr, seconds}`; `o.stop` closes it. The manager shows the code. A source with its own settings keeps secrets (an API key) in its own settings, never in a reply. |

Core merges the photos with the uploads: `s/<add-on>/<id>` for a file and `l/<add-on>` for a live source. A source that throws offers
nothing and is logged once. `GET /api/wallpapers/status` has a `sources` list only when an add-on provides photos. Core still does the
rotation, the dimming and the Picture size setting; a source only supplies photos.

## Providing something to the service: cards

An add-on with `"provides": ["cards"]` can bring cards for Home. A downloadable card (see [Making a card](cards.md)) is data that the launcher draws; a card
of an add-on is a card with its own page, as a page card is, plus what a closed frame cannot do alone: it gets **data** from the add-on's service,
and its **buttons** send the add-on **actions**. The frame is a sandboxed iframe (`sandbox allow-scripts`) under a policy with `connect-src 'none'`, and it holds no keys. It does not talk to the service: the launcher is the only one that does, for it (the feed, the actions, the options).

`addon.json` lists the cards (at most 4), each checked like a `card.json` with `page` (never `template`), and two more things:

```json
"provides": ["cards"],
"cards": [{
  "id": "nowplaying", "name": "Now playing", "version": "1.0.0", "size": "medium",
  "page": "card.html",
  "poll": 6,
  "actions": [{ "name": "prev", "label": "Previous" }, { "name": "toggle", "label": "Play or pause" }, { "name": "next", "label": "Next" }],
  "options": [{ "key": "title", "kind": "text", "label": "Title", "default": "Now playing" }]
}]
```

- The files of a card are in the add-on's folder, under `cards/<id>/` (`cards/nowplaying/card.html`, its script, a `preview.jpg` of 800 x 450).
  The service serves them from `/card/<id>/` under the same policy as a downloaded page card.
- `id`: as a card's: lower-case letters, digits and hyphens, the card type is `x-<id>`. A downloaded card with the same id wins; the id of a card of
  the launcher itself is refused. The card is offered (in Customise and on the phone page, with its options as the form) only while the add-on runs and
  is switched on, and goes with it; it is not removed from **Cards**.
- `poll`: seconds between two requests for data (2 to 3600; 0 or left out: the card has no data). While Home is on screen the launcher asks at this pace; while it is not (an app in front) at most once a minute. It asks one
  request at a time, and only for a card that is set for a place.
- `actions`: what the card's buttons can do (at most 8): a `name` and a `label`, which is what the remote's focus shows and is in the language of
  the add-on (translate it with the add-on's own words).

The add-on's service answers with `cards` on the object `create()` returns:

```js
cards: {
  // data for the card in a place: a plain object (at most 128 KB: a cover goes as a data: address), the options the person chose
  feed: async (id, opt) => ({ title: opt.title, playing: true }),
  // a button was pressed: the name is one the card declared; arg is a short text or number the page may give (at most 100 characters)
  action: async (id, opt, name, arg) => ({ ok: true }),
}
```

`opt` is what the person set for that place (defaults filled in; a `place` option also gives `opt.lat` and `opt.lon`); it never comes from the launcher's
request, so a page cannot ask for another card's data. A call that fails, or does not answer in 15 seconds, gives the launcher `{error}`.

The page gets the answer in the message the launcher already sends (see [Making a card](cards.md)), as `m.data`, and tells the launcher where its
buttons are:

```js
parent.postMessage({ cytvCard: 'buttons', buttons: [{ name: 'prev', x: 5, y: 60, w: 25, h: 30 }] }, '*');   // percent of the card
```

Each button the card declared becomes a target of the remote in the top row of Home (the focus shows its label); OK sends the add-on the action, and the
card asks for its data again a few times in the seconds after. A name the card did not declare is ignored. Routes: `POST /api/cards/feed {slot}` and
`POST /api/cards/action {slot, name, arg}` ([API](../api.md)).

## Providing something to the service: scenes

An add-on with `"provides": ["scenes"]` brings photos for the couch scenes (a theme with `effects.scenes` `couch`, such as Couch): while
it runs and has scenes, they take the place of the five landscapes that ship with the launcher. `helper/scenes.js` asks the running,
switched-on add-ons that provide it, in order, and takes the first one with a non-empty list. The object is `scenes` on the module
`create()` returns:

| Member | What it does |
|---|---|
| `list({cc})` | The scenes to show now (or a promise of them): `[{id, credit, darkSky}]`, at most 20. `id`: letters, digits, `-`, `_`, `.`; `credit`: a short line Home shows in the bottom corner (the photographer); `darkSky`: a bright sky, so the top buttons turn dark. `cc` is the TV's country as the launcher reads it (two or three letters, or empty). |
| `file(id, kind)` | The absolute path of the photo (`kind` `image`, 1920 x 1080) or of its blurred copy for the glass clock and the glass cards (`glass`): a JPEG, PNG or WebP on the TV, at most 8 MB, or `''`. |

The launcher asks `POST /api/scenes {cc}` when the theme starts the couch scenes and every 30 minutes (every minute while no add-on has
scenes) and draws them as custom scenes: no cut-out, the clock in front of the photo with a darker shade at the top. The photos come
from `GET /api/scenes/photo/<add-on>/<id>/<image|glass>`, so the launcher needs no network for them; an add-on that downloads them keeps
them on the TV. Without such an add-on the list is empty and nothing changes.

### A phone page of the add-on

A service that has a `settings(o)` function (the same contract as a photo source's: it opens a short-lived page on the LAN and answers `{url, code, qr, seconds}`, or closes it
for `{stop: true}`) gets a **Set up from your phone** row on its screen in the manager's Add-ons (`POST /api/addons/<id>/settings`, `settings: true` in the add-on's entry of
`GET /api/addons`). The weather add-on needs none (the city is an option on the Cards page); the Spotify add-on uses it for the sign-in.

### A drawer and settings

A card of an add-on can declare two more things in its `card.json` (or its entry in `addon.json`). The launcher draws neither; it only hosts them, so no code of one add-on is in the launcher:

```json
"drawer": { "page": "drawer.html", "action": "open", "label": "Forecast" },
"settings": { "action": "settings", "title": "Weather" }
```

- `drawer`: `page` is a second page of the card (in the card's folder, served like `card.html`), `action` the name of a button of the card, and `label` its text for the remote's focus. OK or a click on that button opens the **sheet**: the page in a sandboxed frame (`connect-src 'none'`, no keys) at the right edge of Home, with the rest of Home dimmed.
- `settings`: `action` is the name of a button that opens **Customise > Top & cards > `title`**, a panel the launcher builds from the card's `options`: a `place` option becomes a city row (typed with the TV's keyboard, searched, then picked from a list), a `choice` option a row that turns to the next value, and other kinds are set on the phone page (a **More on your phone** row). The panel sets the options for every place that holds the card. The row appears for any card that declares `settings`.
- The `action` names of `drawer` and `settings` belong to the launcher: it answers them itself and they are never sent to the add-on's service. A sheet page cannot trigger them with an `action` message either.

The **sheet protocol**. The page draws; the launcher owns the keys, the focus, Back and, for tabs, Left and Right. The launcher checks the page's `option` and `action` messages: an `action` runs only if its name is one of the card's declared `actions` (and not the `drawer` or `settings` action), and an `option` is sent to the service, which keeps only the options the card declares.

| Direction | Message | Meaning |
|---|---|---|
| launcher -> page | `{cytvCard: ctx}` | The context a card page gets (its options, size, language, `data` from the service) with `ctx.sheet = true`; sent when the page loads, when it says `ready`, and again when something changed (the newest is checked every two seconds). |
| launcher -> page | `{cytvSheet: {select: i}}` | The tab `i` of the tab row was chosen (Left or Right on a tab target, or OK on one). |
| launcher -> page | `{cytvSheet: {act: name}}` | OK on the target `name`, or the page's own `back` or `edges` action. |
| launcher -> page | `{cytvSheet: {key: 'chup' | 'chdown'}}` | CH+ or CH- was pressed (a page may page a list or step to the next item; it may ignore it). |
| launcher -> page | `{cytvSheet: {focus: name}}` | The focus moved to the target `name`. |
| page -> launcher | `{cytvCard: 'ready'}` | The page is loaded: send the context. |
| page -> launcher | `{cytvSheet: 'targets', targets: [{name, x, y, w, h, r, tab}], focus, back, tab, edges}` | Where the things the remote can reach are, in percent of the sheet (`r`: corner radius in pixels, 0 to 60; `tab`: the index in the tab row, or -1 when it is not a tab). At most 24, `name` up to 40 characters. `focus` names the target to focus; without it the focus stays where it was. The launcher moves the focus between targets with the arrows and draws the ring. Optional: `back` is what Back does instead of closing the sheet: a target to press, or an action of the page that is no target (sent as `{act: back}`; the markets drawer goes back from a symbol to its list); `tab` is the tab the page shows, where Up from the page lands in the tab row; `edges: {left, right, up, down}` names the action an arrow sends when no target lies that way (the markets drawer steps to the next symbol past its last range button). |
| page -> launcher | `{cytvSheet: 'option', set: {...}}` | Set options of the card, for every place that holds it (checked like the settings panel's). |
| page -> launcher | `{cytvSheet: 'action', name, arg}` | Run one of the card's `actions` (sent to the service as a button's). |
| page -> launcher | `{cytvSheet: 'close'}` | Close the sheet. |

Back (or a click on the dimmed Home) closes the sheet, and it closes by itself after five minutes.

The city field of the settings panel searches through the service: the `cards` of an add-on can have the optional hook `places(q, lang)`, which answers `{places: [{name, area, lat, lon}]}` (at most 10 are used; `q` is two to 60 characters). `POST /api/cards/places {type, q}` calls it; with no hook the answer is an empty list. The service must know these keys, so raise the add-on's `minService` to the version that brought `drawer` and `settings`.

## The Guide key

An add-on with the permission `key.guide` in its manifest is a guide of its own (the TV guide for LG's tuner is one): while it is running and switched on, the learned
Guide key opens its page, with Live TV (IPTV) on or off, and its screen in the manager's Add-ons has a **Learn the Guide key** row. Without such an add-on the key opens the
Live TV guide, as before.

## Permissions for LG's services

A service add-on has no access to LG's services unless its manifest asks: `"permissions": ["luna"]` and a list of the calls it may make, each
the address of a call (or its beginning) and, when LG's service only answers a named app, the app the call is made as:

```json
"luna": [
  { "uri": "luna://com.webos.service.iepg/getChannelList", "as": "com.webos.service.iepg" },
  { "uri": "luna://com.webos.applicationManager/launch" }
]
```

`ctx.luna(uri, payload, {wait})` then makes only calls that begin with a listed address, as the app that entry names (the add-on cannot choose
one), with a wait of at most 20 seconds; any other call gets `{returnValue: false}`. At most 8 calls. This limits what a catalog add-on can do
by mistake, not what its code could do (it runs in the service): read the list of a catalog add-on before you install it. `applicationManager/launch`
can start any app.

## Pages: Home is page 1 of a book

A page add-on is served at `http://127.0.0.1:8765/addon/<id>/...` while it runs, with a content security policy that lets it load
only its own files (and pictures and media from anywhere) and talk only to the service.

In the launcher, **Home is the first page and the add-ons that have `tile.placement` `page` (or `topbar`, which also adds a button
to the top bar) are the pages after it.** Turning a page moves Home and the page sideways, like a book (a transform only; nothing is
drawn on top of Home). A strip on Home shows what each page is called and which button turns to it; with the pointer (the Magic Remote or a mouse) a click on a page in the strip turns to it as well. Its look and place are the theme's (`strip.*`, see
[themes](../themes.md)): rounded `pills`, book `tabs` or small `dots`, with the names on all pages, only on the current one or none, and
the first four pages in the colour of their button or every page with its number. Classic keeps it at the bottom centre; Bloom lowers
it a little to sit under its glass dock.

| Button | Page |
|---|---|
| number 1, or red | Home |
| number 2, or green | the first add-on page (Live TV) |
| number 3, or yellow | the second |
| number 4, or blue | the third |
| numbers 5 to 9 | the fourth to the eighth page (no colour) |
| Back | back to Home |
| Home | back to Home (see below; the key must be learned once) |

A page is loaded when you turn to it and unloaded when you turn away (its video and timers stop). A page that needs some of those
keys for itself lists them in `claims`: `digits` (the number buttons), `colors` (the colour buttons) and `back` (the page handles
Back itself, for example to close its own menus first, then asks for Home with `{cytvAddon: 'close'}`). Live TV claims all three:
digits tune channels and the colour buttons open its menus, so inside Live TV you leave with Back (and then turn to another page).
Other pages include `/addon/sdk.js`: Back goes to Home, the number and colour buttons switch pages, and `CYTV.api(path, body)` calls
`/api/addons/<id>/<path>`. A page that shows a QR code (the phone remote's pairing screen) includes `/addon/qrcode.js` as well: it is the
one `third-party/qrcode-generator` file, which the package puts beside the helper files and the loader serves. Write the page in ES5
(Chromium 68, webOS 5). The launcher sends the page its language, clock format and theme colours as query parameters and a message.

**The Home key.** When another app is in front, pressing Home relaunches the launcher, which turns back to its first page. A page of the
book is an iframe of the Home app, so webOS sees Home in front and sends no relaunch there: the key would do nothing. The service
therefore binds the remote's Home key in LG's input service only while a page shows (`helper/book.js`, `helper/inputhook.js`), and a
press asks the app manager for Home (`scripts/bookhome.sh`), which is that same relaunch. The code is the one learned in the manager
(**CleanYourTV as Home** > **Learn the Home key**), else 773, what LG's input service reports for the Home button of the usual remotes.
No other button sends 773, so a remote whose Home sends another code loses nothing; learn its code and Home works on a page too (until
then Back is the way back, and the number and colour buttons on a page that does not keep them). A code that is already the Input, voice,
Guide or a remapped button is never taken. The launcher reports the page it shows to `POST /api/book/page` on each turn, every 30 s while
a page shows and when it is shown again, so the bind exists only while a page is open. Leaving for another app with a page open keeps the
bind (some TVs report the launcher hidden while it is on screen); Home there opens Home, as it does anyway.

The service accepts a page's requests (their origin is the service itself) only from the loopback address, only for `/addon/...`
and for `/api/addons/<id>/...` with that add-on's own page as the Referer. Install and remove are not open to pages.

### Choosing the pages

In the manager (**Add-ons**), each page add-on has **Page of the book** (on or off), **Move earlier** and **Move later**, and the
Add-ons screen has **Page strip on Home** (on or off) and **Page strip position**: the theme's own place, or one of six places (bottom or
top, left, centre or right) that you choose, which wins over the theme. The buttons follow the order: the first page after Home is green and 2, and so on. The
choice is stored in `config.json` (`book`: `order`, `hidden`, `strip`, `position`) and written with `POST /api/addons/book`. A page that is
left out stays installed and running but has no button.

Each running page add-on also has **Open page** there (`POST /api/book/open {id}`): the service launches Home with
`{"page": "<add-on id>", "t": <time>}` and Home turns to that page at once, also when it is left out of the book (then it comes after the
last page and Back returns to Home). The launcher does not wait for webOS to tell it about the launch: webOS can hold Home's relaunch and
visibility events for seconds (12 to 40 s on a webOS 25 TV), so the launcher keeps a request open on `GET /api/book/open` and the service
answers it the moment a page is opened. Each `t` turns the page once, so a relaunch that arrives late does not bring the page back after
you left it. Any app can open a page with `luna://com.webos.applicationManager/launch` and `{"id": "com.webos.app.home", "params": {"page":
"<add-on id>"}}` too; then Home turns when webOS delivers the launch.

## API

| Request | Reply |
|---|---|
| `GET /api/addons` | `{addons: [{id, name, version, kind, description, about, preview, permissions, enabled, status, error, bundled, repo, tile, page}], paused}`; `status` is `running`, `off`, `paused` or `failed`; `repo` (not for bundled ones) is the repository it was installed from |
| `GET /api/addons/preview/<id>[?repo=<name>]` | The add-on's picture (`image/jpeg`, `png` or `webp`): from its folder when it is on the TV, else from its repository; 404 without one |
| `GET /api/addons/catalog` | `{addons: [{id, name, version, description, about, preview, kind, permissions, repo, official, installed, bundled, update}], error, errors: [{repo, error}]}`: what every repository offers; `installed` and `update` only on the row of the repository the add-on was installed from |
| `GET /api/addons/repos` | `{repos: [{name, url, official}]}` |
| `POST /api/addons/repos {add, name?, confirm}` or `{remove}` | Adds a repository (`user/repo`, `user/repo@branch/folder` or an https folder) or removes one; `official` cannot be removed (`400`). Adding needs `confirm: true`, else `400 {error, confirm: true}`. `{repos, added}` or `{repos, removed}` |
| `POST /api/addons/repos/phone {}` or `{stop: true}` | Opens the phone page for adding a repository (port 8800): `{url, code, qr, seconds}` |
| `POST /api/addons/update {id?, confirm}` | Installs newer versions of what is installed (one add-on or all), each from the repository it came from. `{updated, failed, restartNeeded, errors}` |
| `POST /api/addons/book {order, hidden, strip, position}` | The pages of the launcher's book: ids in order, ids left out, whether the strip shows and where (`''`, `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`). Unknown ids and places are dropped. `{book}` |
| `POST /api/addons/install {id, repo?, confirm?}` | Downloads each file named in the repository's index, refuses the whole install if one does not match its hash, then moves the folder in. Without `repo`: the repository it was installed from, else the official one, else the only one that has it. A repository other than `official` needs `confirm: true`, else `400 {error, confirm: true, addons: [{repo, id, name, version, kind, can}]}`; an id of the official repository cannot come from another one, and an id that several other repositories have needs `repo`. `{id, version, repo, restartNeeded}` |
| `POST /api/addons/remove {id}` | Deletes an installed add-on. `restartNeeded` when its service part was loaded. |
| `POST /api/addons/<id>/enable {enabled}` | Stored in `config.json` (or, for an add-on with `enabledOption`, in that option). A page add-on follows at once, a service add-on at the next start. |
| `/api/addons/<id>/...` | Answered by the add-on's `service.js`. |
| `GET /addon/<id>/<file>`, `GET /addon/sdk.js`, `GET /addon/qrcode.js` | The page, the helper script, and the QR code generator a page may draw with (one copy in the repository, `third-party/qrcode-generator`). |

## What the catalog has

| Add-on | What it is |
|---|---|
| `bigclock` | A full-screen clock (a page add-on, the smallest example). |
| `dnscheck` | Asks the TV's own resolver for the hosts the debloat blocks and shows each as Blocked or Reachable (issue 92). A host that does not exist, or resolves to 0.0.0.0, 127.x or ::, counts as blocked; a control host (example.com) tells whether DNS works at all, and when it does not, no host is called blocked. Add your own hosts with `curl -X POST localhost:8765/api/addons/dnscheck/hosts -d '{"hosts":["ads.example.net"]}'` on the TV. |
| `sysinfo` | Memory, swap, load and uptime of the TV, live, from `/proc`. |
| `immich` | Photos from your Immich albums as the Home wallpaper, a photo source (see above): the sync, the albums and the phone page (port 8795) moved here from Wallpapers. A TV that had Immich before hands its settings and photos to it once. |
| `unsplash` | A new random photo from Unsplash as the Home wallpaper, a live photo source (see above): the Access Key, the 3-minute pace, the credit line and the phone page (port 8796). Pictures stay on Unsplash's host; nothing is saved on the TV. |
| `weather` | The **Weather forecast** card for Home, a card of an add-on (see above): the weather at a city you choose on the TV (Customise > Top & cards > Weather, where **Look** is Minimal: one number, one icon, one phrase, or Rich: the next hours too) or on the phone page. Its card declares a `drawer` (Now, Hours, Days: the add-on's own page) and `settings` (the city, unit and look), see [A drawer and settings](#a-drawer-and-settings); with no city the whole card is one button that opens the settings. From Open-Meteo, no key; only the coordinates leave the TV, at most every 30 minutes. |
| `markets` | Two cards for Home, cards of an add-on (see above): **Stocks** (shares and ETFs as Twelve Data names them: `AAPL`, `SPY`, `BRK.B`, an exchange after a colon on a paid plan; prices in agorot or pence are shown in shekels or pounds) and **Crypto** (coins by symbol, priced in dollars, euros, shekels or bitcoin). A watchlist is a ready list chosen on the TV (Customise > Top & cards > Stocks or Crypto: **Watchlist**, **Change shown as** or **Priced in**, **Line on the card**, **Look**) or up to 20 symbols typed on the phone page (the `symbols` option). The card adapts to its place: a strip with every symbol (a ticker that scrolls by itself when they do not fit; the remote cannot scroll inside a card), two or three cells, or a panel of rows (Rich: the names and a line for each, as many rows as fit). It is one button: OK opens a drawer on the list of symbols (name, a line, price, today's change; CH+/CH- page by 8 rows). OK on a row opens that symbol on one page: price and today's change, range buttons (1D to 1Y, 24H to 1Y for crypto), the chart (coloured by today's change on 1D, a dashed line at the previous close, the last price tagged, the day's high and low from the quote), the key numbers, and the day and 52-week (24h and all-time) ranges. Left/Right past the range buttons and CH+/CH- step to the previous or next symbol; Back returns to the list on that row. The drawer's range is for browsing: a range other than the card's is asked with the card action `chart` (`AAPL:1y`) and answered in the next data as `chart`; the card's **Line on the card** stays as set. Both sources are official APIs. Stocks come from Twelve Data's `/quote` and `/time_series` with the person's own free API key, set on the add-on's phone page (Add-ons > Stocks and crypto > Set up from your phone, port 8801: **Test key and save** asks one quote with it, **Remove the key**); the key is the add-on's setting (`addons.markets.settings.key`), goes only in the `Authorization` header to Twelve Data (no redirect), shows as its last four characters at most and is never logged or put in a card's answer. Without a key the card says where to set it. The free plan (US shares and ETFs) counts credits, one per symbol of a request, 8 a minute and 800 a day (UTC): `markets.js` counts every one and never asks past either, so a list longer than 8 is asked in parts, one part a minute; prices are asked every max(5, symbols) minutes while the US market is open (Monday to Friday 9:30 to 16:00 in New York), the lines half as often (1M to 1Y every 6 hours), everything every 6 hours while it is closed, and 50 credits of the day are left for the drawer's charts (one credit each). A refused key stops the requests until the key changes, the daily limit until midnight UTC. Crypto comes from CoinGecko's free public API, no key (one request every 2 minutes; 30 days and a year ask once per coin, kept an hour or six). CoinGecko's terms for that API apply: the data is credited (the drawer's **Data by CoinGecko**), and its rate limits are lower than a keyed plan's and can change. Only the symbols leave the TV (and the key, to Twelve Data); the last answers are kept in `markets.json`, so Home shows prices while the internet is away. `cards/crypto/` is a copy of `cards/stocks/` written by `tools/build-pages.js`. Needs service 1.6.18. |
| `spotify` | The **Spotify now playing** card for Home, a card of an add-on (see above): the cover, title and artist of what plays on your Spotify account, with previous, play or pause, next and the output as buttons for the remote (Premium); the cover opens the Spotify app on the song (permission `luna`), the output button answers with a menu of the devices (the add-on also wakes the speakers of the network that Spotify does not list, over mDNS, as the Spotify apps do). Your own Spotify developer app (its Client ID; sign-in with PKCE), set up from your phone (page on port 8797): Add-ons > Spotify now playing > Set up from your phone. The tokens stay in the add-on's settings. |
| `jellyfin` | The **Continue watching** card for Home, a card of an add-on (see above): the films and episodes you did not finish on your Jellyfin server (and, as an option, the next episode of a series you follow), with their pictures (wide stills or posters) and a bar for how far you got. Each one is a button: OK opens your Jellyfin app (the official one, Litefin or Moonfin: the first one installed, or the one chosen in the card's options) with `{itemId, serverId, tmdbId, mediaType, title}` as launch parameters. Litefin opens the title by its TMDB id (after 2.0.20); the other apps read no launch parameters on webOS and open on their Home. Set up from your phone (page on port 8798): the address, user name and password; only the access token is kept, in the add-on's settings. The permission `luna` is for `getAppInfo` and `launch`. Needs service 1.6.17. |
| `seasons` | **Seasons**: photos for the couch scenes that follow the calendar, an add-on that provides scenes (see above): Christmas lights and snowy villages from 6 to 27 December, fireworks until 2 January, then five photos of the season (winter from 21 December, spring from 20 March, summer from 21 June, autumn from 23 September); south of the equator the seasons turn around, and the tulip fields of spring show only in the Netherlands and Belgium (by the country the launcher sends). The photos are from Unsplash (free to use under the Unsplash License), with the photographer in the corner; the list is in `photos.js`. It keeps the set in use and the first two of every set on the TV (about 8 MB, so each set shows at least two without network) and contacts Unsplash's image host only while it is installed and switched on: at its start, every six hours and when the set or the country changes. `GET /api/addons/seasons/status` says what it has. |
| `tuner` | **TV guide (LG tuner)**: a guide for the TV's own tuner (antenna, cable): the channels, what is on now and next and the schedule of the selected channel, read from the data LG's own guide uses; OK opens LG's Live TV on the channel. A page add-on of its own, with the permission `luna` for three LG services. Its page is built from the same guide code as Live TV (`addons/catalog/tuner/src/index.html` includes the files of `helper/addons-bundled/iptv/src`), so the two guides stay alike; it needs neither Live TV nor a playlist. Needs service 1.6.17. |
| `phoneremote` | **Phone remote** (see above): a phone on your Wi-Fi as the TV's remote. A service add-on with a page of its own on the TV (pairing and the paired phones), the permission `luna` for six LG services, and its phone page on port 8799 while a phone is paired or a window is open. Its settings (the paired phones, the unused-phone expiry) stay in its own settings. Needs service 1.6.18. |

## Versions

A launcher that shows add-on pages needs a service that serves them: `app/version.json` names the oldest service it works with
(`minService`), and the manager offers the service update first. Raise it when the launcher starts to need something new from the service.

## Adding a catalog add-on (the project's own repository)

For your own add-ons make a [repository](addon-repos.md) instead; this is for add-ons that ship in the project's `official` repository.

1. Put it in `addons/catalog/<id>/` with an `addon.json`.
2. `node tools/addon-index.js`, and commit the new `addons/index.json`.
3. Once merged, it is offered in the manager (the catalog is read from the repository's `main` branch, or the branch named in
   `/media/developer/cleanyourtv/source`).

## Recovery

Create `/media/developer/cleanyourtv/DISABLE-ADDONS` (or `addons/DISABLE`) and restart the service: no add-on loads, each shows as
`paused`. Live TV is then off as well. Remove the file to get it back.
