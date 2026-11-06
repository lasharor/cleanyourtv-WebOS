// The agent add-on's service: an MCP server for the tools that the installed apps and add-ons sign (see README.md and
// tools.js). Requests:
//   POST /api/addons/agent/mcp      JSON-RPC 2.0: initialize, ping, tools/list, tools/call
//   GET  /api/addons/agent/tools     the tools as the registry lists them (a quick look, without JSON-RPC)
//   POST /api/addons/agent/reload    read the declarations again
// A language model reaches it through the voice assistant, or an MCP client reaches it on the network, as docs/agent.md says.
'use strict';
const tools = require('./tools');

function json(res, o, code) {
  res.writeHead(code || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(o));
}
function notFound(res) {
  json(res, { error: 'not found' }, 404);
}

function create(ctx) {
  const reg = tools.registry(ctx);

  async function handle(req, res, p, body) {
    // p is what follows /api/addons/agent
    if (req.method === 'GET' && p === '/tools') return json(res, { tools: reg.list() });
    if (req.method === 'POST' && p === '/reload') return json(res, Object.assign({ reloaded: true }, reg.reload()));
    if (req.method === 'POST' && p === '/mcp') {
      let msg = {};
      try {
        msg = (await body(req)) || {};
      } catch (_) {}
      const out = await reg.rpc(msg);
      if (out === undefined) {
        res.writeHead(202, { 'content-type': 'application/json' });
        return res.end('');
      }
      return json(res, out);
    }
    notFound(res);
  }

  return { handle: handle, start: () => reg.reload(), tools: reg };
}

module.exports = { create };
