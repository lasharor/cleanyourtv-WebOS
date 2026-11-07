# Service API

The service runs as root on `127.0.0.1:8765` and answers JSON. It is what the launcher, the manager and the other apps use, and
you can call it from a shell on the TV (for example over SSH).

!!! note "Who may call it"
    Requests from web pages with an `http(s)` origin are refused, so a page opened in the TV's browser cannot drive the service.
    Local apps and scripts (no `Origin` header) are accepted.

| Endpoint | Purpose |
|---|---|
| `GET /api/apps` | Installed apps, config, usage, version, `stamp` (see below), and `tuner: true` when LG's own Live TV is installed and shown; an app with a picture of its own has `iv`, the picture's version, and `it: 1` when it is shown as Full tile; while the App icons add-on runs and Home's Live TV tile has a picture of its own, `liveIcon` `{iv, it?}` carries the same for that tile (it is not an app, so it is not in `apps`) |
| `GET /api/apps/stamp` | `{stamp}`: a number that changes whenever the list of apps changes. The service follows the app manager's changes (`listApps` with `subscribe`); the launcher checks the stamp every 5 seconds and reads the list again when it changed, so an app installed from the Homebrew Channel or the LG store shows up on Home by itself |
| `POST /api/launch` `{id, params}` | Launch an app |
| `POST /api/power/off` | Switch the TV off completely (`tvpower/power/shutDown`: a cold start next time, no Wake-on-LAN), unlike the remote's standby |
| `GET /api/inputs` | The inputs: the HDMI ports and their state, and LG's own Live TV (the tuner, `{appId, tuner: true}`) while its app is installed and the manager's **Show LG's own Live TV** is on |
| `GET /api/running`, `POST /api/running/close` `{id}` or `{all: true}` | The running apps the launcher can close, and closing them (only listed apps; never Home, the picker or notify app; the manager is listed). Background services of installed apps that run are listed with `background: true` and the app's title; closing one stops its process (never the Homebrew Channel's or CleanYourTV's) |
| `POST /api/notify` | Picture notification (on the network: `POST :8767/notify` with the token) |
| `GET /api/voice/status`, `POST /api/voice/install`, `/uninstall`, `/set`, `/listen`, `/ask`, `/forget`, `/ha-test`, `/ha-agents`; `/pair` `{only?: "ha"}` | Optional voice function and AI chat; `llm.agent` lets the AI use tools ([Tools for the assistant](agent.md)) |
| `GET`/`POST /api/mcp/lan` `{lan?, page?, pair: false, block?, allow?, remove?, removeAll?, expireDays?}` | MCP on the network, port 8802: `{lan, port, ip, listening, error, agents: [{id, name, created, seen, ip, blocked, active, removesIn}], max, expireDays, pairing}`. `page: true` opens a pairing code and adds `{pageUrl, code, pageSeconds}`; `pair: false` closes it; `block`/`allow`/`remove` take an agent id; `expireDays` is 0, 1, 3, 7, 14 or 30. On the network: `POST /pair {code, name}` gives `{token, name, mcp}`, `POST /mcp` and `POST /logout` take `Authorization: Bearer <token>`; on the network `initialize` adds `instructions` and `tools/list` adds `disconnect_from_tv` |
| `GET`/`POST /api/mcp/tools` `{newTools?, key?, on?, group?, keys?, seen?}` | The tool settings (manager: AI agents (MCP) > Tools): `{newTools, groups: [{id, name, kind, tool, off, items: [{key, name, label, on, fresh, confirm}]}], on, all}`. `newTools` is `on` or `off`; `{key, on}` switches one tool; `{group, on, keys}` a whole group; `{seen, keys}` clears the New badges of a group |
| `POST /api/mcp` | MCP (JSON-RPC 2.0: `initialize`, `ping`, `tools/list`, `tools/call`): every tool of the service and of the add-ons that provide them; destructive ones are refused here ([Tools for the assistant](agent.md)) |
| `GET /api/theme/list`, `POST /api/theme/set`, `/revert` | Themes for the home screen; see [Themes](themes.md) |
| `POST /api/cards/status`, `/set` `{slot, type}`, `/pair` `{stop?}`, `/weather` `{lat, lon, unit}`, `/ha` `{ids}`, `/ha/toggle` `{id}`; `GET /api/cards/ha/camera/<camera.id>` | Cards: the phone page for their options, the weather card's weather (Open-Meteo, kept 30 minutes), Home Assistant states (kept 20 seconds), switching an entity, a camera's picture; see [Cards](launcher.md#cards) |
| `POST /api/cards/options` `{type, set}`, `/api/cards/places` `{type, q}` | The launcher's generic card settings (Customise > Top & cards, a row for any card that declares `settings`): `set` (`place`, `lat`, `lon`, `unit`, `look`, only options the card declares) is applied to every place that holds a card of that type, `{error}` for a value the card does not offer or a city without coordinates; `places` asks the service of the add-on that owns the card `type` (its optional `cards.places(q, lang)` hook) and answers `{places: [{name, area, lat, lon}]}`, empty when the add-on has no such hook (the phone page's own `/api/places` is separate). |
| `POST /api/cards/feed` `{slot, lang}`, `/api/cards/action` `{slot, name, arg, lang}` | A card of an add-on: its data from the add-on (at most 128 KB, `{error}` when it fails), and the action of one of its buttons (only a name the card declared). The options come from the card in that place, never from the request. `lang` is the language Home is shown in: while the Language setting follows the TV, add-ons translate into it (`env.lang()`) |
| `GET /api/wallpapers/status`, `/list`, `/photo/u/<id>`; `POST /api/wallpapers/set` `{size}`, `/pair`, `/remove-uploads`, `/disconnect` (removes the old Immich data of an earlier version) | Wallpapers: the photo library and the phone page; see [Wallpapers](wallpapers.md) |
| `POST /api/scenes` `{cc}`; `GET /api/scenes/photo/<add-on>/<id>/<image\|glass>` | Scenes from an add-on for the couch scenes: `{addon, scenes: [{id, credit, darkSky}]}` of the first running add-on that provides scenes (`{scenes: []}` without one), and a photo or its blurred copy; see [Add-ons](development/addons.md#providing-something-to-the-service-scenes) |
| `GET /api/wallpapers/live/<add-on>`, `GET /api/wallpapers/push` (a photo a live source has waiting for Home, once: `{id, url, credit}`, empty when none); `POST /api/wallpapers/source/<add-on>/settings` `{stop}`; `GET /api/wallpapers/photo/s/<add-on>/<id>` | Photo sources that add-ons provide: a live photo `{url, credit}` (the source's next one; right after the service starts, the one the screen saver fetched first, once), the source's phone settings page (or closing it), and a source's photo file |
| `GET /api/screensaver`, `/photos?cc=<country>`, `/scene/<night\|golden\|water\|fog\|dawn>`, `/live/<add-on>`; `POST /api/screensaver/active`, `/dismiss` | The page that replaces LG's screen saver: its state (`{replaced, running, photos, every}`), what Home has behind it (`{photos, credits, from, every}`: the theme's scenes, the wallpaper library or the theme's wallpaper, in Home's order), a couch scene of the launcher, the live photo Home has now (not the next one), the launcher's word that a key arrived (so the page is only opened over an idle launcher), and the way it closes; see [Screen saver](screensaver.md) |
| `GET /api/androidbox`; `POST /api/androidbox` `{host, port, input, apps}`, `/api/androidbox/test`, `/api/androidbox/pair` (the phone page) | Apps that open on an Android box over ADB instead of on the TV; see [Android box](android-box.md) |
| `/api/addons/phoneremote/...` | The Phone remote, a catalog add-on (nothing of it is in the service): its page on the TV uses `GET /state`, `POST /state {expireDays}`, `/pair {stop?}`, `/revoke {id}` or `{all: true}`, `/access {id, allow}` and `/key {key}` (press one key as a phone would). The phone itself speaks the protocol of [Phone remote protocol](phone-remote-api.md); see [Phone remote](phone-remote.md). Its status has `listenError` when the phone port (8799) could not be opened, for example because another program uses it |
| `GET /api/cards/catalog`, `/api/cards/packs`, `/api/cards/preview/<id>`; `POST /api/cards/install` `{id}`, `/remove` `{id}` | Downloadable cards (`helper/cardcatalog.js`): the catalog from GitHub with what is installed, the installed cards as the launcher draws them, a card's picture, and install (every file checked against its hash) and remove; `/api/apps` carries `cardPacks` while any is installed; see [Making a card](development/cards.md) |
| `GET /api/icons/status`; `POST /api/icons/pair` `{app?, scale?, stop?}`, `/reset` `{id}`; `GET /icon/<app id>` | App icons (the bundled add-on icons, only while it runs; `/api/apps` then carries `icons: true`): the phone page where a picture is chosen for an app (Full tile or Icon), and back to the app's own icon; `pair` answers with `sizes`, the picture sizes that fit the theme's tiles at `scale` (the screen's pixels per CSS pixel); `/icon/<app id>` sends the app's picture of its own first; see [Your own icon](launcher.md#your-own-icon) |
| `GET /api/remap`; `POST /api/remap` `{enabled}` / `{code, type, id?, label?, key?}` / `{code, remove}` / `{clear}`, `/api/remap/learn`, `/api/remap/fire` `{code}`; `GET /api/remap/learn-state` | Remote key remapping: learn a button, set its action, run it (called by `remapkey.sh`); see [Key remapping](key-remap.md) |
| `POST /api/book/open` `{id}`; `GET /api/book/open?since=<t>` | Opens a page of the book, also one left out of it (manager > an add-on > **Open page**): Home is launched with `{page, t}`, and the launcher, which waits on `GET`, is told at once. `GET` answers `{id, t, fresh}` when an open newer than `since` comes, else after 25 s; `fresh` is false for an open older than 10 s |
| `POST /api/book/page` `{id}`; `GET /api/book` | The launcher's book: which page shows now (`''` is Home). It is what arms the Home key (the learned code, else 773), only while a page shows; `GET` answers `{page, key}`. The launcher sends it on each turn, every 30 s while a page shows and when it is shown again; see [Add-ons](development/addons.md#pages-home-is-page-1-of-a-book) |
| `GET /api/live/status`, `/api/live/channels`, `/api/live/epg` | Live TV data |
| `POST /api/live/settings`, `/api/live/refresh`, `/api/live/reset` | Live TV setup |
| `GET /api/manager/status` | Versions, updates, options, hook state, the screen saver (`saver: {enabled, replaced, supported}`: switched on, mounted now, possible on this TV) |
| `GET /api/version` | The service's version |
| `GET /api/tv` | What the service found out about this TV and the decisions that follow from it (Input key mode, notification window, tested firmware) |
| `GET /api/service` | The service's version, its Node.js version and which parts are running (a part that failed to load is listed with the reason) |

## Examples

```sh
# launch an app
curl -X POST localhost:8765/api/launch -d '{"id":"com.palm.app.settings"}'

# show a picture notification without a token (from the TV itself)
curl -X POST localhost:8765/api/notify -d '{"title":"Hello","text":"From a shell","seconds":8}'

# the service version and updates
curl -s localhost:8765/api/manager/status
```

See the pages for [Live TV](live-tv.md), [Picture notifications](notifications.md) and [Voice](voice.md) for their bodies.
