# Add-ons

An add-on is a feature that is loaded, installed and removed on its own. Live TV and the Android box are bundled add-ons: they ship in the package (`helper/addons-bundled/iptv/` and
`helper/addons-bundled/androidbox/`) and still answer their old paths (`/api/live/...`, `/api/androidbox...`), so the launcher and the
manager did not change for them. A bundled add-on gets the service's own ctx as well as its add-on fields. Other add-ons come from a catalog in this repository and are installed from the manager (**Add-ons**).

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
  It has no `exec` or `luna`. This is a convention, not a sandbox: the code runs in the service, which is why a service add-on is
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
