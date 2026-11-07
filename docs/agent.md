# Tools for the assistant (MCP)

The TV can give a language model **tools**: things it may do on the TV, such as open an app, switch an input or skip a song. The
service serves every tool over the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), so the voice assistant and any
other MCP client on the TV use the same list.

Where the tools come from:

| Source | What it gives | Needs |
|---|---|---|
| The service itself (`helper/coretools.js`) | The table below | Nothing: always there |
| Add-ons that provide `tools` | Whatever the add-on's service returns (see [Add-ons](development/addons.md#tools-for-the-assistant)) | The add-on installed and switched on |
| Apps and add-ons that **sign** a `tools.json` | The tools they declare | The **Agent tools (MCP)** add-on, and your approval of that app or add-on |

### The service's own tools

| Tool | What it does | Arguments |
|---|---|---|
| `list_apps` | The installed apps (id and name) | `query?`: words of the name |
| `launch_app` | Opens an app | `id` |
| `list_inputs` | The HDMI ports and Live TV, with their names and whether something is connected | |
| `switch_input` | Switches to an input | `input`: `HDMI_1`, `1` or its name |
| `show_notification` | A card on the screen | `title`, `text?`, `image?` (http or https), `seconds?` (2-60, 10), `position?` (`top-right`, `bottom-center` and the other seven) |
| `get_current_app` | The app or input on the screen now (Home is called Home) | |
| `list_running_apps` | The apps that are open, and background services | |
| `close_app` | Closes one running app (never Home) | `id` |
| `navigate` | Goes to Home, the launcher's Live TV, or the Inputs list, as a remapped button does; LG's screen saver is closed first (the Inputs list would open under it) | `to`: `home`, `live_tv`, `input_list` |
| `get_volume` | The volume, mute, the maximum and the sound output | |
| `tv_info` | Model, webOS (SDK) version, firmware, CleanYourTV version, power state, whether an update is available (from the last check; it does not check) | |
| `most_used_apps` | The apps used most, from the launcher's usage counts | `limit?` (1-20, 5) |
| `get_weather` | The weather now and the next days (Open-Meteo); without a place, the place of a card on Home (the weather card first, else a downloaded forecast card) | `place?`, `unit?`: `c` or `f` |
| `new_conversation` | The voice assistant forgets the conversation so far | |
| `theme` | The look of Home: `list` the themes and the one in use, `set` one (downloaded from GitHub first, as on the phone page), `revert` to the one before | `action`: `list`, `set`, `revert`; `id?`, `accent?` (a colour such as `#4c8dff`) |
| `remote_buttons` | The remote buttons remapped on this TV: `list` them and what each does, or `press` one (it runs only while remapping is on) | `action`: `list`, `press`; `code?` |
| `power_off` | Turns the TV off (destructive: only by voice, after a yes) | |

The tools that change what is on screen (`launch_app`, `switch_input`, `close_app`, `navigate`, `show_notification`, `remote_buttons`) first close LG's
screen saver if it is on: it starts when nobody has pressed a key for a while, and the Inputs list and cards would open under it.

### The add-ons' tools

Each add-on gives one tool with an `action`, so the tools stay under the 40 the service sends. They are there while the add-on is
installed and switched on.

| Add-on | Tool | Actions |
|---|---|---|
| Spotify now playing | `spotify` | `now_playing` (the track, the artist, the device), `play`, `pause`, `next`, `previous`, `devices` (the Spotify Connect devices, by name), `open_on_tv` (the Spotify app of the TV on what plays). The controls need Spotify Premium. Moving the music to another device is not a tool: it can wake a speaker in another room |
| Live TV (IPTV, bundled) | `iptv` | `status` (set up, how many channels, a guide), `find_channel` (`query`: words of the name or a number), `whats_on` and `schedule` (`channel`: now and next, or the next eight programmes), `favourites`, `set_favourite` (`channel`, `on`), `check_stream` (does the stream answer), `refresh` (load the playlist and guide again). No answer holds a stream or playlist address: they can carry the playlist's user name and password |

## The voice assistant uses them

In the manager app, **Features > AI agents (MCP) > Let the voice assistant act on the TV** (or the box on the voice setup page) lets the AI use the tools. The
same screen holds the network access below, so everything the tools may reach is switched in one place. It is off by
default; off, the AI only answers questions as before. Then:

1. Home Assistant still answers first when the routing says so ([Voice](voice.md#home-assistant-assist)).
2. Otherwise the question goes to OpenRouter with the tools (at most 40). The model may ask for tools; the TV runs them, sends back
   what they answered and asks again, at most five rounds. The card on the screen says which tool runs.
3. The model's last words are the answer on the card.

A tool that turns something off or deletes something (`power_off`, or a signed tool with `"confirm": true`) never runs on the
model's word. The TV shows **Turn the TV off? Say yes within 30 seconds to go ahead.** Hold the mic and say "yes" (also "yeah",
"ok", "do it", "go ahead"): the TV runs it without asking the model again. Anything else, or 30 seconds of silence, drops it.

Some OpenRouter models cannot use tools. The voice setup page marks the ones that can (**can act**). With a model that cannot, the TV
asks once more without tools and the AI only answers.

## The MCP endpoint

`POST /api/mcp` on the service answers JSON-RPC 2.0: `initialize`, `ping`, `tools/list`, `tools/call`. It lists the tools of the
service and of every add-on that provides them; a name that two sources use gets the add-on's id in front (`spotify__next`).

```sh
# on the TV (ssh)
curl -X POST localhost:8765/api/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -X POST localhost:8765/api/mcp \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"switch_input","arguments":{"input":"HDMI_1"}}}'
```

`tools/list` answers `{tools: [{name, description, inputSchema}]}`; a destructive tool also has `annotations: {destructiveHint: true}`.
`tools/call` answers `{content: [{type: "text", text}], isError}`. The arguments are checked against the tool's `inputSchema` first. A
destructive tool is refused here (`isError: true`): only the voice assistant runs it, after you said yes on the TV.

Like the rest of the service API, the endpoint answers on `127.0.0.1` only: programs on the TV can use it. For an agent on another
computer, switch on the network access (below).

## MCP on the network

In the manager app, **Features > AI agents (MCP) > Accept MCP clients from the network** lets MCP clients on other computers (any
agent or app that supports MCP, or a script) use the same tools at `http://<tv>:8802/mcp`. Off by default. Everything is managed on that screen;
there is no page on Home for it.

**Connecting an agent.** **Connect an agent** shows a QR code, its address and a 6-digit code. Open the address on a phone or a computer:
**Connect an agent to the TV** has a ready prompt with **Copy the prompt**. Paste it to your agent. The agent pairs once:

```sh
curl -s -X POST http://<tv>:8802/pair -H "content-type: application/json" -d '{"code":"123456","name":"My agent"}'
# {"token":"<id>.<secret>","name":"My agent","mcp":"http://<tv>:8802/mcp"}
```

and then adds the server to its own MCP settings: a remote (Streamable HTTP) server named `tv` at `http://<tv>:8802/mcp` with the header
`Authorization: Bearer <token>`. The prompt names no app: any MCP client works, in its own way of adding a server. Many take
`{"mcpServers":{"tv":{"url":"http://<tv>:8802/mcp","headers":{"Authorization":"Bearer <token>"}}}}`. A client that only starts local
programs uses the `mcp-remote` bridge:

```json
{ "mcpServers": { "tv": { "command": "npx",
    "args": ["mcp-remote", "http://<tv>:8802/mcp", "--allow-http", "--header", "Authorization: Bearer <token>"] } } }
```

An agent that already has a server `tv` sends its token with the pair request (`Authorization: Bearer <token>`). If that token still
works, the TV answers `{"connected":true,"name":…,"message":…}` instead of a new token: the agent keeps its settings and uses the session it
has, and no second entry is made (the QR screen still closes). A token that no longer works pairs as new; a blocked one is refused.

The TV shows a card with the agent's name when it connects (**<name> connected**: "This AI agent can now control the TV.", or "This AI
agent was already connected.") and when it logs out or disconnects itself (**<name> disconnected**: "This AI agent can no longer control
the TV."). Removing a device on the TV shows no card.

The code works once and for ten minutes; Back on the TV takes it off. The page turns green when the agent has paired, and says
**Connected** after its first call. The token is the agent's own and is shown only once.

**Managing the devices.** **Connected devices** on the same screen ("2 paired · 1 in use") opens the list of every paired agent:

| Row | What it does |
|---|---|
| Each paired device | Its name, **In use now**, **Last used 3 h ago**, or **Blocked**; a warning when it is removed within three days. OK opens **Manage the device**: **Block this device** / **Allow this device** (at once), **Remove this device** (asks first; its token stops working) |
| **Remove unused devices** | A device not used for 1 day, 3 days, 1 week, 2 weeks (the default) or 1 month is removed by itself, and its token stops working; one in use is never removed. **Never** asks first |
| **Remove all devices** | Asks first: every token stops working and each device has to pair again |

Up to 10 agents can be paired. An agent can also leave by itself: the network side offers it a tool of its own,
`disconnect_from_tv` (it is in `tools/list` there, not on the TV's own `/api/mcp`), and `POST http://<tv>:8802/logout` with its header
does the same.

**What the agent learns from the server.** The pasted prompt only pairs and adds the server. Everything else comes from the server on every
connection, so a new session knows it too: `tools/list` has every tool with its description and arguments, and the `initialize` reply carries
`instructions` with the rules (destructive tools are refused from the network; 401 means pair again with a new code; 403 means blocked; at
most 60 requests a minute; `disconnect_from_tv` to leave).

**Remembering the TV.** The prompt's last step asks the agent to save a short note in its own persistent memory (whatever its app calls
it), so a new chat knows the TV can be controlled through the server `tv`. The note never holds the token, which stays in the MCP settings.
Pairing again keeps the note; disconnecting deletes it. An agent without a persistent memory says so and skips the step. Port 8802
is open only while the switch is on and an agent is paired or a code is shown; if another program on the TV holds it, the switch's row says
so.

- It speaks MCP over HTTP (Streamable HTTP, every reply is JSON, no event stream).
- Tools that turn something off or delete something are never run from the network; only your spoken yes on the TV runs them.
- A request from a web page (it carries an `Origin`) is refused. Ten wrong codes or tokens lock an address out for ten minutes; a code may be
  tried five times a minute per address, and eight wrong codes take it off. At most 60 requests a minute. It is plain HTTP, so use it on
  a network you trust. See [Security](security.md#mcp-on-the-network).

## Signing tools: the agent add-on

The **Agent tools (MCP)** add-on (manager app, **Add-ons**) lets an app or add-on give tools without changing the service: it signs
a `tools.json`. The add-on knows no app by name; it reads the declarations and gives the approved ones to the service.

### The scheme

```json
{
  "tools": [
    {
      "name": "recipes__open",
      "description": "Open the recipe app at a dish.",
      "inputSchema": { "type": "object", "properties": { "dish": { "type": "string" } }, "required": ["dish"] },
      "invoke": { "kind": "app", "id": "com.example.recipes", "params": { "dish": "{dish}" } }
    }
  ]
}
```

- `name`: a letter, then letters, digits, `_` or `-` (64 at most). `description`: what it does, for the model (300 characters).
- `inputSchema`: a JSON Schema object; at most 12 arguments, each with a JSON type.
- `confirm`: `true` for a tool that turns something off or deletes something: it then runs only after a yes.
- At most 16 tools in one file.

A `{name}` in the invoke is replaced by that argument. In a `path` or `url` the argument is URL-encoded; elsewhere a value that is
exactly `{name}` keeps the argument's type.

| kind | Fields | What it does |
|---|---|---|
| `app` | `id`, `params` | Launches the app with launch parameters. |
| `addon` | `addon`, `path`, `method`, `body` | Calls that add-on's own endpoint, `/api/addons/<addon><path>`. The loader's paths (`install`, `remove`, `repos`, `update`, `catalog`) and `..` are refused. |
| `http` | `url`, `method`, `headers`, `body` | Calls an address. The scheme and host are fixed in the file (no `{argument}` there); the TV itself (127.0.0.1, localhost, its own address) is refused, and redirects are not followed. |

### Where it looks

| Place | Source |
|---|---|
| `addons-bundled/<id>/tools.json`, `addons/<id>/tools.json` in the service folder | `addon:<id>` |
| `/media/developer/apps/usr/palm/applications/<id>/tools.json` | `app:<id>` |
| `addon-data/agent/tools/<name>.json` in the service folder | `file:<name>` (a declaration dropped by a script or an installer) |

### Approving

Every file is a **source**, and a source gives no tools until you switch it on: manager app, **Add-ons > Agent tools (MCP) > Set up
from your phone** (port 8803, a 6-digit code on the TV, ten minutes). The page lists each source with its tools and errors. The
approvals are the add-on's settings in `config.json`.

The add-on's own endpoints, on the TV:

| Request | |
|---|---|
| `POST /api/addons/agent/mcp` | JSON-RPC for the signed tools alone |
| `GET /api/addons/agent/tools` | The approved tools |
| `GET /api/addons/agent/sources` | Every source: `{key, kind, id, approved, error, tools}` |
| `POST /api/addons/agent/approve {source, approved}` | Switch a source on or off |
| `POST /api/addons/agent/reload` | Read the files again |

## Security

The tools act as the service does: as root. What keeps that in hand:

- The assistant uses tools only while **Let the voice assistant act on the TV** is on, and signed tools only from sources you approved.
- Destructive tools need your spoken yes on the TV; neither the model nor an MCP client can give it.
- Signed tools cannot call the service's API or anything else on the TV, and an add-on tool reaches only that add-on's own paths.
- The agent add-on asks for `net.fetch` and one LG call, `applicationManager/launch`. An add-on's own tools run with that add-on's
  permissions.
- Every round is capped: five rounds, 500 tokens a reply, 40 tools, tool results cut to 2,000 characters, 30 seconds a tool.
