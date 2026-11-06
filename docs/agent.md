# Tools for the assistant (MCP)

The TV can give a language model **tools**: things it may do on the TV, such as open an app, switch an input or skip a song. The
service serves every tool over the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), so the voice assistant and any
other MCP client on the TV use the same list.

Where the tools come from:

| Source | What it gives | Needs |
|---|---|---|
| The service itself (`helper/coretools.js`) | `list_apps`, `launch_app`, `list_inputs`, `switch_input`, `show_notification`, `power_off` | Nothing: always there |
| Add-ons that provide `tools` | Whatever the add-on's service returns (see [Add-ons](development/addons.md#tools-for-the-assistant)) | The add-on installed and switched on |
| Apps and add-ons that **sign** a `tools.json` | The tools they declare | The **Agent tools (MCP)** add-on, and your approval of that app or add-on |

## The voice assistant uses them

In the manager app, **Voice > AI acts on the TV** (or the box on the voice setup page) lets the AI use the tools. It is off by
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
computer, switch on **MCP on the network** (below).

## MCP on the network

In the manager app, **More > MCP on the network > Accept MCP clients from the network** opens port 8790 on your network. An MCP client
on another computer (Claude Desktop, Cursor, Home Assistant, a script) then reaches the same tools at `http://<tv>:8790/mcp` with the
header `Authorization: Bearer <token>`. Off by default.

- **How to connect** shows the address and the token; **Show as QR code** opens a page on your phone with **Copy** buttons (ten minutes);
  **New token** replaces the token and the old one stops working.
- It speaks MCP over HTTP (Streamable HTTP, every reply is JSON, no event stream). A client that only starts local programs can use the
  `mcp-remote` bridge:

  ```json
  { "mcpServers": { "tv": { "command": "npx",
      "args": ["mcp-remote", "http://<tv>:8790/mcp", "--allow-http", "--header", "Authorization: Bearer <token>"] } } }
  ```

- Tools that turn something off or delete something are never run from the network; only your spoken yes on the TV runs them.
- A request from a web page (it carries an `Origin`) is refused. Ten wrong tokens lock an address out for ten minutes; at most 60
  requests a minute. It is plain HTTP, so use it on a network you trust. See [Security](security.md#mcp-on-the-network).

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
from your phone** (port 8799, a 6-digit code on the TV, ten minutes). The page lists each source with its tools and errors. The
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

- The assistant uses tools only while **AI acts on the TV** is on, and signed tools only from sources you approved.
- Destructive tools need your spoken yes on the TV; neither the model nor an MCP client can give it.
- Signed tools cannot call the service's API or anything else on the TV, and an add-on tool reaches only that add-on's own paths.
- The agent add-on asks for `net.fetch` and one LG call, `applicationManager/launch`. An add-on's own tools run with that add-on's
  permissions.
- Every round is capped: five rounds, 500 tokens a reply, 40 tools, tool results cut to 2,000 characters, 30 seconds a tool.
