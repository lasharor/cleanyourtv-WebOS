# Agent tools (MCP)

The **Agent tools (MCP)** add-on turns the abilities of the TV's apps and add-ons into tools a language model can call, over the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP). It does not know any app or add-on by name: each app or add-on
*signs* a small declaration, and the add-on reads those declarations and serves them as MCP tools.

It is a catalog add-on (installed from the manager, **Add-ons**). Nothing runs until you install it.

## The scheme

A declaration is a JSON file named `tools.json`, with a `tools` list. Each tool has a `name`, a `description` (what it does, for
the model), an `inputSchema` (a JSON Schema for its arguments), an optional `confirm` (marks the tool destructive, so a caller
asks first), and an `invoke` that names how to run it:

```json
{
  "tools": [
    {
      "name": "open_demo",
      "description": "Open the demo app on the TV.",
      "inputSchema": { "type": "object", "properties": {}, "required": [] },
      "invoke": { "kind": "app", "id": "com.example.demo" }
    }
  ]
}
```

A `{name}` in a string of the invoke is replaced by that argument when the tool is called; a value that is exactly `{name}` keeps
the argument's type (a number stays a number).

### The three ways to run a tool

| kind | Fields | What it does |
|---|---|---|
| `app` | `id`, `params` | Launches an installed app, with the given launch parameters. |
| `addon` | `addon`, `path`, `method`, `body` | Calls another service add-on's own endpoint, `POST/GET /api/addons/<addon>/<path>`. |
| `http` | `url`, `method`, `headers`, `body` | Calls an address — an external service, a phone, your Home Assistant. |

```json
{ "invoke": { "kind": "addon", "addon": "spotify", "path": "/control", "method": "POST", "body": { "action": "play_pause" } } }
{ "invoke": { "kind": "http", "url": "https://example.com/weather?city={city}", "method": "GET" } }
```

An app that wants to be a tool only has to be launchable: its `tools.json` is `{"kind":"app"}`. A service add-on exposes its own
abilities by pointing at its own `/api/addons/<id>/...` endpoints — the add-on already answers them. Anything else can be an
`http` tool.

### Where the add-on looks

| Place | |
|---|---|
| `/media/developer/cleanyourtv/addons-bundled/<id>/tools.json` | Add-ons that ship with CleanYourTV |
| `/media/developer/cleanyourtv/addons/<id>/tools.json` | Add-ons installed from the catalog |
| `/media/developer/apps/usr/palm/applications/<id>/tools.json` and `/usr/palm/applications/<id>/tools.json` | Installed apps |
| `/media/developer/cleanyourtv/addon-data/agent/tools/<anything>.json` | The registration directory: a declaration dropped at runtime (an installer, a script, another add-on's start) |

A `tools.json` that does not parse is ignored and reported; a tool name declared twice keeps the first.

## The MCP endpoint

`POST /api/addons/agent/mcp` answers JSON-RPC 2.0. `GET /api/addons/agent/tools` lists the same tools without JSON-RPC, and
`POST /api/addons/agent/reload` reads the declarations again.

```sh
# list the tools (what a language model would receive)
curl -X POST localhost:8765/api/addons/agent/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# call one
curl -X POST localhost:8765/api/addons/agent/mcp \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"open_demo","arguments":{}}}'
```

The reply to `tools/list` is `{tools: [{name, description, inputSchema}]}`; a `confirm` tool also carries
`annotations: {destructiveHint: true}`. The reply to `tools/call` is MCP content:
`{content: [{type: "text", text: "..."}], isError: false}`.

## Using the tools

The add-on only *exposes* the tools; it is not a language model itself. Two ways to use them:

- **The voice assistant.** The voice feature already has a language model (OpenRouter) in `helper/answers.js`. A small change
  there can read this add-on's `tools/list`, send the tools to the model, and run the `tools/call` loop, so the remote's voice
  button acts instead of only answering. That change lives in the service, not in this add-on, and is not done here.
- **Any MCP client.** A desktop agent (Claude Desktop, Cursor) or your own server can reach the same endpoint on the LAN, exactly
  like the other short-lived pages (a token, open only while you set it up). The service's origin rules keep the endpoint
  loopback-only by default.

## Security

The add-on is a convention, not a sandbox: it runs in the service as root, like every service add-on. It asks for the least it
needs — `net.fetch` (to call add-ons and addresses) and one `luna` call, `applicationManager/launch` (to launch apps). It can
therefore **launch any app** and **call any address a declaration names**; only install declarations you trust, exactly as you
only install add-ons you trust. A tool that switches the TV off or changes something in your home should set `"confirm": true`,
and the caller must honour it.
