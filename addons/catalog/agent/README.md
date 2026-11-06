# The agent add-on and its scheme

The add-on knows **no app or add-on by name**. It reads the abilities that the installed apps and add-ons *sign* with a small
declaration file, and turns each ability into an MCP tool that a language model can call. Nothing is hardcoded here.

## The scheme: a `tools.json` file

A declaration is a JSON file named `tools.json`:

```json
{
  "tools": [
    {
      "name": "launch_demo",
      "description": "Open the demo app on the TV.",
      "inputSchema": { "type": "object", "properties": {}, "required": [] },
      "confirm": false,
      "invoke": { "kind": "app", "id": "com.example.demo" }
    }
  ]
}
```

Every tool has a `name` (a letter, then letters, digits, `_` or `-`), a `description` (what it does, for the model), an
`inputSchema` (a JSON Schema for the arguments), an optional `confirm` (mark the tool as destructive, so the caller asks first)
and an `invoke` that names how to run it. `{name}` in a string of the invoke is replaced by that argument; a value that is
exactly `{name}` keeps the argument's type.

## The three ways to run a tool (`invoke`)

| kind | Fields | What it does |
|---|---|---|
| `app` | `id`, `params` | Launches an installed app, with the given launch parameters. |
| `addon` | `addon`, `path`, `method`, `body` | Calls another service add-on's own endpoint (`/api/addons/<addon>/<path>`). |
| `http` | `url`, `method`, `headers`, `body` | Calls an address (an external service, a phone, your Home Assistant…). |

```json
{ "invoke": { "kind": "addon", "addon": "spotify", "path": "/control", "method": "POST", "body": { "action": "play_pause" } } }
{ "invoke": { "kind": "http", "url": "https://example.com/weather?city={city}", "method": "GET" } }
```

## Where the add-on looks

- `/media/developer/cleanyourtv/addons-bundled/<id>/tools.json` — the add-ons that ship with CleanYourTV
- `/media/developer/cleanyourtv/addons/<id>/tools.json` — add-ons installed from the catalog
- `/media/developer/apps/usr/palm/applications/<id>/tools.json` and `/usr/palm/applications/<id>/tools.json` — installed apps
- `/media/developer/cleanyourtv/addon-data/agent/tools/<anything>.json` — the registration directory, for a declaration dropped at
  runtime (an app's installer, a script, another add-on's start)

A `tools.json` that does not parse is ignored and reported; a tool name declared twice keeps the first.

## The MCP endpoint

`POST /api/addons/agent/mcp` answers JSON-RPC 2.0: `initialize`, `ping`, `tools/list`, `tools/call`. See `docs/agent.md` for the
frames and for how the voice assistant or a desktop MCP client reaches them.
