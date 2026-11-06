// Every tool on the TV in one place, as an MCP server: the service's own (coretools.js) and those of the running, switched-on add-ons
// that provide "tools" (the agent add-on gives the ones that apps and add-ons sign, after the person approved them). The voice
// assistant (answers.js) is one consumer; anything else on the TV can ask too:
//   POST /api/mcp   JSON-RPC 2.0: initialize, ping, tools/list, tools/call
// Like the rest of the API it answers on 127.0.0.1 only (server.js). Switched on in the manager (More > MCP on the network), the same
// server also answers on the LAN, port 8790, with a token (config.json: mcp {lan, port, token}). A tool marked destructive is never run
// from either: only the voice assistant runs it, after the person said yes on the TV.
const http = require('http'),
  crypto = require('crypto');
const web = require('./web');

const MAX_TOOLS = 40;
const PORT = 8790; // the network port, after the share-log range (8768 and up) and before the phone pages (8791 and up)
const LAN_DEFAULTS = { lan: false, port: PORT, token: '' };
const MAX_BODY = 64 * 1024,
  PER_MINUTE = 60;
const PAGE_MS = 10 * 60 * 1000; // how long the page behind the QR code works
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

// a tool's arguments against its inputSchema: the required ones are there and the simple types and enums match; '' when fine
function checkArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'the arguments must be a JSON object';
  const props = (schema && schema.properties) || {},
    req = (schema && Array.isArray(schema.required) && schema.required) || [];
  for (const k of req) if (args[k] === undefined || args[k] === null) return k + ' is required';
  for (const k of Object.keys(args)) {
    const p = props[k],
      v = args[k];
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'string' && typeof v !== 'string') return k + ' must be text';
    if ((p.type === 'number' || p.type === 'integer') && (typeof v !== 'number' || !isFinite(v))) return k + ' must be a number';
    if (p.type === 'boolean' && typeof v !== 'boolean') return k + ' must be true or false';
    if (Array.isArray(p.enum) && p.enum.indexOf(v) < 0) return k + ' must be one of ' + p.enum.join(', ');
  }
  return '';
}

// the tools of the providers, merged: {map: name -> {provider, name, schema, description, confirm}, names}. A name taken twice gets
// its provider's id in front (spotify__next); at most 40 tools
async function merge(providers) {
  const map = {},
    names = [];
  for (const p of providers || []) {
    if (!p || !p.tools || typeof p.tools.list !== 'function' || typeof p.tools.call !== 'function') continue;
    let list = [];
    try {
      list = (await p.tools.list()) || [];
    } catch (e) {
      console.error('tools: the tools of ' + p.id + ' could not be listed: ' + e.message);
      continue;
    }
    for (const t of Array.isArray(list) ? list : []) {
      if (names.length >= MAX_TOOLS) break;
      if (!t || !TOOL_NAME.test(t.name || '') || typeof t.description !== 'string') continue;
      let name = t.name;
      if (map[name]) name = (String(p.id || 'x').replace(/[^A-Za-z0-9_]/g, '_') + '__' + t.name).slice(0, 64);
      if (map[name] || !TOOL_NAME.test(name)) continue;
      map[name] = {
        provider: p,
        name: t.name,
        schema:
          t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
            ? t.inputSchema
            : { type: 'object', properties: {} },
        description: String(t.description).slice(0, 300),
        confirm: t.confirm === true || !!(t.annotations && t.annotations.destructiveHint),
      };
      names.push(name);
    }
  }
  return { map, names };
}

const fail = (m, extra) => Object.assign({ content: [{ type: 'text', text: String(m) }], isError: true }, extra || {});

function create(ctx) {
  const core = require('./coretools').create(ctx);
  // the service's own tools first, then the add-ons'
  const providers = () => {
    const a = ctx.feature && ctx.feature('addons');
    const more = a && a.providers ? a.providers('tools') : [];
    return [core].concat(more.map(p => ({ id: p.id, name: p.name, tools: p.mod && p.mod.tools })));
  };

  async function list() {
    const m = await merge(providers());
    return m.names.map(n => {
      const e = m.map[n];
      const t = { name: n, description: e.description, inputSchema: e.schema };
      if (e.confirm) t.annotations = { destructiveHint: true };
      return t;
    });
  }
  async function call(name, args) {
    const m = await merge(providers()),
      e = m.map[name];
    if (!e) return fail('unknown tool: ' + String(name).slice(0, 64));
    const a = args === undefined ? {} : args;
    const bad = checkArgs(e.schema, a);
    if (bad) return fail(bad);
    if (e.confirm) return fail('needs confirmation: ' + name + ' runs only after the person says yes on the TV', { confirm: true });
    try {
      const r = await e.provider.tools.call(e.name, a, {});
      return r && Array.isArray(r.content) ? { content: r.content, isError: !!r.isError } : fail('the tool gave no answer');
    } catch (err) {
      return fail(String((err && err.message) || err).slice(0, 200));
    }
  }

  const reply = (id, result) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, result });
  const error = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
  async function rpc(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return error(msg && msg.id, -32600, 'invalid request');
    if (msg.method === 'initialize')
      return reply(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'cleanyourtv', version: ctx.version || '' },
      });
    if (typeof msg.method === 'string' && msg.method.indexOf('notifications/') === 0) return undefined; // no reply to a notification
    if (msg.method === 'ping') return reply(msg.id, {});
    if (msg.method === 'tools/list') return reply(msg.id, { tools: await list() });
    if (msg.method === 'tools/call') {
      const p = msg.params && typeof msg.params === 'object' ? msg.params : {};
      const r = await call(p.name, p.arguments);
      return reply(msg.id, { content: r.content, isError: r.isError });
    }
    return error(msg.id, -32601, 'method not found');
  }

  // ---- the network: an MCP client on another computer (Claude Desktop, Cursor, Home Assistant), off until switched on ----
  // POST http://<tv>:8790/mcp with "Authorization: Bearer <token>". The same tools, the same refusals (destructive tools never run from
  // here). A request that carries an Origin (a web page in a browser) is refused, so a site cannot drive the TV through someone's browser.
  const cfg = () => Object.assign({}, LAN_DEFAULTS, ctx.config.get().mcp || {});
  const save = n =>
    ctx.config.update('mcp', c => {
      c.mcp = n;
    });
  const fails = new Map(),
    hits = new Map();
  let srv = null,
    tokenPage = null; // {path, until}: the page behind the manager's QR code, with the address and the token

  function lanHandler(req, res) {
    const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
    const send = (c, o) => {
      res.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(o));
    };
    const n = cfg(),
      u = req.url.split('?')[0];
    if (req.method === 'GET' && tokenPage && Date.now() < tokenPage.until && u === '/t/' + tokenPage.path) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(tokenHtml(n));
    }
    if (req.headers.origin !== undefined) return send(403, { error: 'requests from web pages are refused' });
    const now = Date.now(),
      f = fails.get(ip) || { n: 0, t: now };
    if (now - f.t > 600000) {
      f.n = 0;
      f.t = now;
    }
    if (f.n >= 10) return send(429, { error: 'too many wrong tokens; wait ten minutes' });
    const h = String(req.headers.authorization || ''),
      a = Buffer.from(h.indexOf('Bearer ') === 0 ? h.slice(7).trim() : ''),
      b = Buffer.from(n.token || '');
    if (!n.token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      f.n++;
      fails.set(ip, f);
      return send(401, { error: 'bad or missing token' });
    }
    const r = hits.get(ip) || { n: 0, t: now };
    if (now - r.t > 60000) {
      r.n = 0;
      r.t = now;
    }
    if (++r.n > PER_MINUTE) {
      hits.set(ip, r);
      return send(429, { error: 'at most ' + PER_MINUTE + ' requests a minute' });
    }
    hits.set(ip, r);
    if (u !== '/mcp') return send(404, { error: 'the MCP endpoint is /mcp' });
    if (req.method !== 'POST') return send(405, { error: 'POST JSON-RPC 2.0 to /mcp' }); // no event stream: every reply is JSON
    let data = '',
      big = false;
    req.on('data', c => {
      data += c;
      if (data.length > MAX_BODY) {
        big = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (big) return;
      let msg;
      try {
        msg = JSON.parse(data || '{}');
      } catch (_) {
        return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'the body must be JSON' } });
      }
      rpc(msg).then(
        out => {
          if (out === undefined) {
            res.writeHead(202);
            return res.end();
          }
          send(200, out);
        },
        e => send(500, { error: String((e && e.message) || e) })
      );
    });
  }
  function tokenHtml(n) {
    const addr = web.esc('http://' + web.lanIp() + ':' + n.port + '/mcp'),
      t = web.esc(n.token);
    return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>CleanYourTV MCP</title>
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{font:18px/1.45 system-ui,sans-serif;max-width:640px;margin:28px auto;padding:0 18px}h1{font-size:24px;margin:0 0 4px}small,p{color:#777}
.box{border:1px solid #8884;border-radius:12px;padding:12px 14px;margin:6px 0 14px;word-break:break-all;font:16px/1.4 ui-monospace,Menlo,monospace;user-select:all;white-space:pre-wrap}button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid #8886;background:#8882;color:inherit}
label{display:block;margin-top:16px;font-weight:600}</style>
<h1>CleanYourTV MCP</h1><p>An MCP client on your network can use the TV's tools at this address (Streamable HTTP). The token is a secret: anyone who has it can open apps and switch inputs on the TV.</p>
<label>Address</label><div class=box id=a>${addr}</div><button onclick="cp('a')">Copy</button>
<label>Header</label><div class=box id=h>Authorization: Bearer ${t}</div><button onclick="cp('h')">Copy</button>
<label>For a client that starts a local bridge (mcp-remote)</label><div class=box id=c>{"mcpServers":{"tv":{"command":"npx","args":["mcp-remote","${addr}","--allow-http","--header","Authorization: Bearer ${t}"]}}}</div><button onclick="cp('c')">Copy</button>
<p><small>This page works for ten minutes after the code was shown on the TV. Tools that turn the TV off are never run from the network.</small></p>
<script>function cp(i){var e=document.getElementById(i),r=document.createRange();r.selectNodeContents(e);var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy')}catch(x){}}</script>`;
  }
  function stopLan() {
    if (srv) {
      try {
        srv.close();
      } catch (_) {}
      srv = null;
    }
    tokenPage = null;
  }
  // make the listener match the settings: at start and after every change
  function sync() {
    const n = cfg();
    if (!n.lan) return stopLan();
    if (!n.token) {
      n.token = crypto.randomBytes(24).toString('hex');
      save(n);
    }
    if (srv) return;
    const s = http.createServer(lanHandler);
    s.setTimeout(30000);
    s.on('error', e => {
      console.error('mcp: the network port could not open: ' + e.message);
      if (srv === s) srv = null;
    });
    s.listen(n.port, '0.0.0.0');
    srv = s;
  }
  const lanInfo = () => {
    const n = cfg();
    return { lan: !!n.lan, port: n.port, token: n.token, ip: web.lanIp(), listening: !!srv };
  };
  function lanSet(o) {
    const n = cfg();
    if (typeof o.lan === 'boolean') n.lan = o.lan;
    if (o.regenerate || (n.lan && !n.token)) n.token = crypto.randomBytes(24).toString('hex');
    save(n);
    sync();
    if (o.page && n.lan && srv) {
      tokenPage = { path: crypto.randomBytes(12).toString('hex'), until: Date.now() + PAGE_MS };
      return Object.assign(lanInfo(), {
        pageUrl: 'http://' + web.lanIp() + ':' + n.port + '/t/' + tokenPage.path,
        pageSeconds: PAGE_MS / 1000,
      });
    }
    return lanInfo();
  }

  async function handle(req, res, u, body) {
    // the network settings, for the manager: GET {lan, port, token, ip, listening}; POST {lan?, regenerate?, page?}
    if (u === '/api/mcp/lan') return web.json(res, req.method === 'POST' ? lanSet((await body(req)) || {}) : lanInfo());
    if (req.method !== 'POST') return web.json(res, { error: 'POST JSON-RPC 2.0 here' }, 405);
    const out = await rpc(await body(req));
    if (out === undefined) {
      res.writeHead(202);
      return res.end();
    }
    return web.json(res, out);
  }

  return {
    name: 'mcp',
    paths: ['/api/mcp', '/api/mcp/lan'],
    handle,
    start: sync,
    stop: stopLan,
    providers,
    list,
    call,
    rpc,
    lanInfo,
    lanSet,
  };
}

module.exports = { create, merge, checkArgs, MAX_TOOLS, LAN_DEFAULTS };
