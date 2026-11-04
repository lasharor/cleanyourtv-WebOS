# Add-ons

An add-on is a feature that is loaded, installed and removed on its own. Live TV and the Android box are bundled add-ons: they ship in the package (`helper/addons-bundled/iptv/` and
`helper/addons-bundled/androidbox/`) and still answer their old paths (`/api/live/...`, `/api/androidbox...`), so the launcher and the
manager did not change for them. A bundled add-on gets the service's own ctx as well as its add-on fields. Every add-on, bundled or not, also gets `util` (`lanIp`, `randomInt`, `mkdirp`, `i18n`) and `env` (`lang()`: the Language setting, or while that follows the TV the language Home is shown in, as the launcher says with the requests of the cards; `wallpaperSize()`). Other add-ons come from a catalog in this repository and are installed from the manager (**Add-ons**).

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
- `routes` and `enabledOption` are for bundled add-ons only.

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
and its **buttons** send the add-on **actions**. The frame stays closed: no network, no access to the launcher or the service, no keys.

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
drawn on top of Home). A strip on Home shows what each page is called and which button turns to it. Its look and place are the theme's (`strip.*`, see
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
| Back (Home key) | back to Home |

A page is loaded when you turn to it and unloaded when you turn away (its video and timers stop). A page that needs some of those
keys for itself lists them in `claims`: `digits` (the number buttons), `colors` (the colour buttons) and `back` (the page handles
Back itself, for example to close its own menus first, then asks for Home with `{cytvAddon: 'close'}`). Live TV claims all three:
digits tune channels and the colour buttons open its menus, so inside Live TV you leave with Back (and then turn to another page).
Other pages include `/addon/sdk.js`: Back goes to Home, the number and colour buttons switch pages, and `CYTV.api(path, body)` calls
`/api/addons/<id>/<path>`. Write the page in ES5 (Chromium 68, webOS 5). The launcher sends the page its language, clock format and
theme colours as query parameters and a message.

The service accepts a page's requests (their origin is the service itself) only from the loopback address, only for `/addon/...`
and for `/api/addons/<id>/...` with that add-on's own page as the Referer. Install and remove are not open to pages.

### Choosing the pages

In the manager (**Add-ons**), each page add-on has **Page of the book** (on or off), **Move earlier** and **Move later**, and the
Add-ons screen has **Page strip on Home** (on or off) and **Page strip position**: the theme's own place, or one of six places (bottom or
top, left, centre or right) that you choose, which wins over the theme. The buttons follow the order: the first page after Home is green and 2, and so on. The
choice is stored in `config.json` (`book`: `order`, `hidden`, `strip`, `position`) and written with `POST /api/addons/book`. A page that is
left out stays installed and running but has no button.

## API

| Request | Reply |
|---|---|
| `GET /api/addons` | `{addons: [{id, name, version, kind, description, about, preview, permissions, enabled, status, error, bundled, tile, page}], paused}`; `status` is `running`, `off`, `paused` or `failed` |
| `GET /api/addons/preview/<id>` | The add-on's picture (`image/jpeg`, `png` or `webp`): from its folder when it is on the TV, else from the catalog; 404 without one |
| `GET /api/addons/catalog` | `{addons: [{id, name, version, description, about, preview, kind, permissions, installed, bundled, update}], error}` |
| `POST /api/addons/book {order, hidden, strip, position}` | The pages of the launcher's book: ids in order, ids left out, whether the strip shows and where (`''`, `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`). Unknown ids and places are dropped. `{book}` |
| `POST /api/addons/install {id}` | Downloads each file named in the index, refuses the whole install if one does not match its hash, then moves the folder in. `{id, version, restartNeeded}` |
| `POST /api/addons/remove {id}` | Deletes an installed add-on. `restartNeeded` when its service part was loaded. |
| `POST /api/addons/<id>/enable {enabled}` | Stored in `config.json` (or, for an add-on with `enabledOption`, in that option). A page add-on follows at once, a service add-on at the next start. |
| `/api/addons/<id>/...` | Answered by the add-on's `service.js`. |
| `GET /addon/<id>/<file>`, `GET /addon/sdk.js` | The page and the helper script. |

## What the catalog has

| Add-on | What it is |
|---|---|
| `bigclock` | A full-screen clock (a page add-on, the smallest example). |
| `dnscheck` | Asks the TV's own resolver for the hosts the debloat blocks and shows each as Blocked or Reachable (issue 92). A host that does not exist, or resolves to 0.0.0.0, 127.x or ::, counts as blocked; a control host (example.com) tells whether DNS works at all, and when it does not, no host is called blocked. Add your own hosts with `curl -X POST localhost:8765/api/addons/dnscheck/hosts -d '{"hosts":["ads.example.net"]}'` on the TV. |
| `sysinfo` | Memory, swap, load and uptime of the TV, live, from `/proc`. |
| `immich` | Photos from your Immich albums as the Home wallpaper, a photo source (see above): the sync, the albums and the phone page (port 8795) moved here from Wallpapers. A TV that had Immich before hands its settings and photos to it once. |
| `unsplash` | A new random photo from Unsplash as the Home wallpaper, a live photo source (see above): the Access Key, the 3-minute pace, the credit line and the phone page (port 8796). Pictures stay on Unsplash's host; nothing is saved on the TV. |
| `weather` | The **Weather forecast** card for Home, a card of an add-on (see above): the weather at a city you choose on the phone page, with buttons for the remote (Now, Hours, Days). From Open-Meteo, no key; only the coordinates leave the TV, at most every 30 minutes. |
| `spotify` | The **Spotify now playing** card for Home, a card of an add-on (see above): the cover, title and artist of what plays on your Spotify account, with previous, play or pause, next and the output as buttons for the remote (Premium); the cover opens the Spotify app on the song (permission `luna`), the output button answers with a menu of the devices (the add-on also wakes the speakers of the network that Spotify does not list, over mDNS, as the Spotify apps do). Your own Spotify developer app (its Client ID; sign-in with PKCE), set up from your phone (page on port 8797): Add-ons > Spotify now playing > Set up from your phone. The tokens stay in the add-on's settings. |
| `jellyfin` | The **Continue watching** card for Home, a card of an add-on (see above): the films and episodes you did not finish on your Jellyfin server (and, as an option, the next episode of a series you follow), with their pictures (wide stills or posters) and a bar for how far you got. Each one is a button: OK opens your Jellyfin app (the official one, Litefin or Moonfin: the first one installed, or the one chosen in the card's options) with `{itemId, serverId, tmdbId, mediaType, title}` as launch parameters. Litefin opens the title by its TMDB id (after 2.0.20); the other apps read no launch parameters on webOS and open on their Home. Set up from your phone (page on port 8798): the address, user name and password; only the access token is kept, in the add-on's settings. The permission `luna` is for `getAppInfo` and `launch`. Needs service 1.6.17. |
| `seasons` | **Seasons**: photos for the couch scenes that follow the calendar, an add-on that provides scenes (see above): Christmas lights and snowy villages from 6 to 27 December, fireworks until 2 January, then five photos of the season (winter from 21 December, spring from 20 March, summer from 21 June, autumn from 23 September); south of the equator the seasons turn around, and the tulip fields of spring show only in the Netherlands and Belgium (by the country the launcher sends). The photos are from Unsplash (free to use under the Unsplash License), with the photographer in the corner; the list is in `photos.js`. It keeps the set in use and the first two of every set on the TV (about 8 MB, so each set shows at least two without network) and contacts Unsplash's image host only while it is installed and switched on: at its start, every six hours and when the set or the country changes. `GET /api/addons/seasons/status` says what it has. |
| `tuner` | **TV guide (LG tuner)**: a guide for the TV's own tuner (antenna, cable): the channels, what is on now and next and the schedule of the selected channel, read from the data LG's own guide uses; OK opens LG's Live TV on the channel. A page add-on of its own, with the permission `luna` for three LG services. Its page is built from the same guide code as Live TV (`addons/catalog/tuner/src/index.html` includes the files of `helper/addons-bundled/iptv/src`), so the two guides stay alike; it needs neither Live TV nor a playlist. Needs service 1.6.17. |

## Versions

A launcher that shows add-on pages needs a service that serves them: `app/version.json` names the oldest service it works with
(`minService`), and the manager offers the service update first. Raise it when the launcher starts to need something new from the service.

## Adding a catalog add-on

1. Put it in `addons/catalog/<id>/` with an `addon.json`.
2. `node tools/addon-index.js`, and commit the new `addons/index.json`.
3. Once merged, it is offered in the manager (the catalog is read from the repository's `main` branch, or the branch named in
   `/media/developer/cleanyourtv/source`).

## Recovery

Create `/media/developer/cleanyourtv/DISABLE-ADDONS` (or `addons/DISABLE`) and restart the service: no add-on loads, each shows as
`paused`. Live TV is then off as well. Remove the file to get it back.
