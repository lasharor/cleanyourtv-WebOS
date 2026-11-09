# The agent add-on and its scheme

The add-on knows **no app or add-on by name**. It reads the abilities that the installed apps and add-ons *sign* with a small
declaration file, turns each into an MCP tool, and gives the approved ones to the service ("provides": ["tools"]): the voice
assistant and the service's MCP endpoint `/api/mcp` then offer them. The full page is `docs/agent.md`.

## The scheme: a `tools.json` file

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

- `name`: a letter, then letters, digits, `_` or `-` (64 at most); `description`: what it does, for the model (300 at most).
- `inputSchema`: a JSON Schema object, at most 12 arguments, each with a JSON type. The arguments are checked against it.
- `confirm: true`: the tool turns something off or deletes something. It runs only with `{confirmed: true}`, which the voice assistant
  passes after the person said yes on the TV; an MCP client cannot pass it. An `addon` or `http` tool with a `method` other than `GET`
  is treated as `confirm: true` whatever the file says.
- At most 16 tools in one file.

`{name}` in the invoke is replaced by that argument: URL-encoded in a `path` or `url`; elsewhere a value that is exactly `{name}`
keeps the argument's type.

## The three ways to run a tool (`invoke`)

| kind | Fields | What it does |
|---|---|---|
| `app` | `id`, `params` | Launches an installed app, with the given launch parameters. |
| `addon` | `addon`, `path`, `method`, `body` | Calls that add-on's own endpoint (`/api/addons/<addon><path>`). `addon` must be the id of the source that declares the tool (`addon:<id>` or `file:<id>`); not the loader's paths, not `agent`, no `..`. |
| `http` | `url`, `method`, `headers`, `body` | Calls an address. The host is fixed in the file; the TV itself is refused, also a name that resolves to it; no redirects. |

## Sources and approval

Each file is a source: `addon:<id>` (`addons-bundled/<id>/tools.json`, `addons/<id>/tools.json`), `app:<id>`
(`/media/developer/apps/usr/palm/applications/<id>/tools.json`) or `file:<name>` (`addon-data/agent/tools/<name>.json`, a declaration
dropped at runtime). A source gives no tools until it is approved on the phone page (`settings(o)`, port 8803) or with
`POST /api/addons/agent/approve {source, approved}`. A file that does not parse is listed with its error; a name used twice keeps the first.

## Endpoints

`POST /api/addons/agent/mcp` (JSON-RPC 2.0 for the signed tools alone), `GET /tools`, `GET /sources`, `POST /approve`, `POST /reload`,
all under `/api/addons/agent`.
