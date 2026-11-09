// The agent add-on's service: an MCP server for the tools that the installed apps and add-ons sign (see README.md and
// tools.js), and a tools provider for the voice assistant ("provides": ["tools"]: the loader hands {list, call} to answers.js).
// Requests:
//   POST /api/addons/agent/mcp       JSON-RPC 2.0: initialize, ping, tools/list, tools/call
//   GET  /api/addons/agent/tools      the approved tools as the registry lists them (a quick look, without JSON-RPC)
//   GET  /api/addons/agent/sources    every file that declares tools, approved or not, with its errors
//   POST /api/addons/agent/approve    {source, approved}: let a source's tools in, or take them out
//   POST /api/addons/agent/reload     read the declarations again
// The phone page (port 8803, settings(o)) lists the sources with a switch each; the manager's Add-ons screen opens it.
'use strict';
const http = require('http');
const tools = require('./tools');
const phone = require('./phone');

const PAIR_PORT = 8803, // after the MCP port (8802); 8799 is the phone remote's
  PAIR_MS = 10 * 60 * 1000;

function json(res, o, code) {
  res.writeHead(code || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(o));
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => {
      b += c;
      if (b.length > 16384) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(b || '{}'));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function create(ctx) {
  const reg = tools.registry(ctx);
  const util = ctx.util || {};
  let pair = null;

  async function handle(req, res, p, body) {
    // p is what follows /api/addons/agent
    if (req.method === 'GET' && p === '/tools') return json(res, { tools: reg.list() });
    if (req.method === 'GET' && p === '/sources') return json(res, { sources: reg.sources(), errors: reg.errors() });
    if (req.method === 'POST' && p === '/reload') return json(res, Object.assign({ reloaded: true }, reg.reload()));
    if (req.method === 'POST' && p === '/approve') {
      const b = (await body(req)) || {};
      if (typeof b.source !== 'string' || typeof b.approved !== 'boolean')
        return json(res, { error: 'source and approved (true or false)' }, 400);
      const r = reg.approve(b.source, b.approved);
      return json(res, r, r.error ? 400 : 200);
    }
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
    json(res, { error: 'not found' }, 404);
  }

  // ---- the phone page: the sources and a switch for each, behind a 6-digit code shown on the TV ----
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  async function handlePhone(req, res, code, wrong) {
    const u = req.url.split('?')[0];
    if (req.method === 'GET' && u === '/') {
      const i18n = util.i18n;
      const lang = i18n && i18n.lang && ctx.env ? i18n.lang(req, ctx.env.lang()) : 'en';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phone.page(i18n, esc, lang));
    }
    if (u.indexOf('/api/') !== 0) {
      res.writeHead(404);
      return res.end();
    }
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json(res, { error: 'wrong code' }, 403);
    }
    if (u === '/api/sources') return json(res, { sources: reg.sources() });
    if (u === '/api/approve' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.source !== 'string' || typeof b.approved !== 'boolean') return json(res, { error: 'bad request' }, 400);
      const r = reg.approve(b.source, b.approved);
      return json(res, r, r.error ? 400 : 200);
    }
    if (u === '/api/reload' && req.method === 'POST') {
      reg.reload();
      return json(res, { sources: reg.sources() });
    }
    json(res, { error: 'not found' }, 404);
  }
  function settings(o) {
    stopPair();
    if (o && o.stop) return {};
    const code = String(util.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) =>
      handlePhone(req, res, code, () => ++bad).catch(() => {
        if (!res.headersSent) json(res, { error: 'failed' }, 500);
      })
    );
    pair = { code, srv, timer: setTimeout(stopPair, PAIR_MS) };
    const url = 'http://' + util.lanIp() + ':' + PAIR_PORT;
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve({ url, code, qr: url + '/#' + code, seconds: PAIR_MS / 1000 }));
    });
  }

  // the agent tool: which apps and add-ons give tools, and whether each is approved. Approving is never a tool: the model must not
  // approve tools for itself (only the phone page does it)
  const AGENT_TOOL = {
    name: 'agent',
    description:
      'The apps and add-ons that sign tools for the assistant. action list_sources: each source, whether the user approved it, its tools and any error. Approving a source is done on the phone page only.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list_sources'] } }, required: ['action'] },

    group: 'Agent tools', // the manager's Tools screen (the signed tools are in the same group)
    labels: { list_sources: 'Apps and add-ons that sign tools' },
  };
  function listSources(args) {
    if (!args || args.action !== 'list_sources') return { content: [{ type: 'text', text: 'action is list_sources' }], isError: true };
    const list = reg.sources().map(s => ({
      source: s.key,
      approved: !!s.approved,
      tools: (s.tools || []).map(t => (typeof t === 'string' ? t : t.name)),
      error: s.error || '',
    }));
    return { content: [{ type: 'text', text: JSON.stringify(list.length ? list : 'no app or add-on signs tools yet') }], isError: false };
  }

  return {
    handle: handle,
    start: () => reg.reload(),
    settings: settings,
    // "provides": ["tools"]: what the voice assistant (helper/answers.js) asks
    tools: {
      list: () => [AGENT_TOOL].concat(reg.list().filter(t => t.name !== 'agent')),
      call: (name, args, opts) => (name === 'agent' ? listSources(args) : reg.call(name, args, opts)),
    },
    registry: reg,
  };
}

module.exports = { create, PAIR_PORT };
