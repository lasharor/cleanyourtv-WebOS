// The service part: Node code that runs as root inside CleanYourTV's service (Node.js 8.12 on webOS 5/6: no ?., ??, fs.promises).
// It is optional: a "kind": "page" add-on has no service.js. The page reaches it as CYTV.api('/hit', body).
// ctx: id, dir, dataDir (a folder that survives updates), log(line), settings.get() / settings.set(obj).
function create(ctx) {
  async function handle(req, res, path, body) {
    // path is what follows /api/addons/hello
    if (path === '/hit' && req.method === 'POST') {
      const n = (ctx.settings.get().hits || 0) + 1;
      ctx.settings.set({ hits: n });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ hits: n }));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
  return { handle };
}

module.exports = { create };
