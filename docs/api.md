# Service API

The service runs as root on `127.0.0.1:8765` and answers JSON. It is what the launcher, the manager and the other apps use, and
you can call it from a shell on the TV (for example over SSH).

!!! note "Who may call it"
    Requests from web pages with an `http(s)` origin are refused, so a page opened in the TV's browser cannot drive the service.
    Local apps and scripts (no `Origin` header) are accepted.

| Endpoint | Purpose |
|---|---|
| `GET /api/apps` | Installed apps, config, usage, version, and `tuner: true` when LG's own Live TV is installed and shown; an app with a picture of its own has `iv`, the picture's version, and `it: 1` when it is shown as Full tile |
| `POST /api/launch` `{id, params}` | Launch an app |
| `POST /api/power/off` | Switch the TV off completely (`tvpower/power/shutDown`: a cold start next time, no Wake-on-LAN), unlike the remote's standby |
| `GET /api/inputs` | The inputs: the HDMI ports and their state, and LG's own Live TV (the tuner, `{appId, tuner: true}`) while its app is installed and the manager's **Show LG's own Live TV** is on |
| `GET /api/running`, `POST /api/running/close` `{id}` or `{all: true}` | The running apps the launcher can close, and closing them (only listed apps; never Home or CleanYourTV's own apps) |
| `POST /api/notify` | Picture notification (on the network: `POST :8767/notify` with the token) |
| `GET /api/voice/status`, `POST /api/voice/install`, `/uninstall`, `/set`, `/listen`, `/ask`, `/forget`, `/ha-test`, `/ha-agents`; `/pair` `{only?: "ha"}` | Optional voice function and AI chat |
| `GET /api/theme/list`, `POST /api/theme/set`, `/revert` | Themes for the home screen; see [Themes](themes.md) |
| `POST /api/cards/status`, `/set` `{slot, type}`, `/pair` `{stop?}`, `/weather` `{lat, lon, unit}`, `/ha` `{ids}`, `/ha/toggle` `{id}`; `GET /api/cards/ha/camera/<camera.id>` | Cards: the phone page for their options, the weather card's weather (Open-Meteo, kept 30 minutes), Home Assistant states (kept 20 seconds), switching an entity, a camera's picture; see [Cards](launcher.md#cards) |
| `GET /api/wallpapers/status`, `/list`, `/photo/<u\|i>/<id>`; `POST /api/wallpapers/set` `{size}`, `/pair`, `/sync`, `/remove-uploads`, `/disconnect` | Wallpapers: the photo library, the phone page and the Immich sync; see [Wallpapers](wallpapers.md) |
| `GET /api/androidbox`; `POST /api/androidbox` `{host, port, input, apps}`, `/api/androidbox/test`, `/api/androidbox/pair` (the phone page) | Apps that open on an Android box over ADB instead of on the TV; see [Android box](android-box.md) |
| `GET /api/icons/status`; `POST /api/icons/pair` `{app?, scale?, stop?}`, `/reset` `{id}`; `GET /icon/<app id>` | App icons: the phone page where a picture is chosen for an app (Full tile or Icon), and back to the app's own icon; `pair` answers with `sizes`, the picture sizes that fit the theme's tiles at `scale` (the screen's pixels per CSS pixel); `/icon/<app id>` sends the app's picture of its own first; see [Your own icon](launcher.md#your-own-icon) |
| `GET /api/live/status`, `/api/live/channels`, `/api/live/epg` | Live TV data |
| `POST /api/live/settings`, `/api/live/refresh`, `/api/live/reset` | Live TV setup |
| `GET /api/manager/status` | Versions, updates, options, hook state |
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
