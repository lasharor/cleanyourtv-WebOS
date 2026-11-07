// Every tool on the TV in one place, as an MCP server: the service's own (coretools.js) and those of the running, switched-on add-ons
// that provide "tools" (the agent add-on gives the ones that apps and add-ons sign, after the person approved them). The voice
// assistant (answers.js) is one consumer; anything else on the TV can ask too:
//   POST /api/mcp   JSON-RPC 2.0: initialize, ping, tools/list, tools/call
// Like the rest of the API it answers on 127.0.0.1 only (server.js). Switched on in the manager (Features > AI agents (MCP)), the same
// server also answers on the LAN, port 8802, with a token per paired agent (config.json: mcp {lan, agents, expireDays}). A tool marked destructive is never run
// from either: only the voice assistant runs it, after the person said yes on the TV.
const http = require('http'),
  crypto = require('crypto');
const web = require('./web');

const MAX_TOOLS = 40;
const PORT = 8802; // the network port: after the phone pages (8791-8800); the tests move it with CYTV_MCP_PORT
const LAN_DEFAULTS = { lan: false };
const MAX_AGENTS = 10;
// the address of the page behind the QR code: 8 characters a person can type, without the ones that look alike (0 o 1 l i)
const PAGE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789',
  PAGE_PATH = /^\/([a-z2-9]{8})(\/status)?$/;
const shortPath = () => Array.prototype.map.call(crypto.randomBytes(8), b => PAGE_CHARS.charAt(b % PAGE_CHARS.length)).join('');
const lanPort = () => +process.env.CYTV_MCP_PORT || PORT;
const MAX_BODY = 64 * 1024,
  PER_MINUTE = 60;
const PAGE_MS = 10 * 60 * 1000; // how long the page behind the QR code works
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const OFF_TEXT = ' is turned off on the TV (CleanYourTV manager: Features > AI agents (MCP) > Tools). Tell the user if they want it.';

// only the arguments a tool's inputSchema declares (an extra key a model or an agent sends is dropped, so no tool gets what it did not
// ask for); a schema that allows more (additionalProperties: true) or declares nothing at all gets them as they are
function declaredArgs(schema, args) {
  const props = schema && schema.properties;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  if (!props || typeof props !== 'object' || schema.additionalProperties === true) return args;
  const out = {};
  for (const k of Object.keys(args)) if (Object.prototype.hasOwnProperty.call(props, k)) out[k] = args[k];
  return out;
}

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

// the tools of the providers, merged: {map: name -> {provider, name, schema, description, confirm}, names, lists}. A name taken twice
// gets its provider's id in front (spotify__next). lists: what each provider gave, for the tool settings (toolprefs.js)
async function merge(providers) {
  const map = {},
    names = [],
    lists = [];
  for (const p of providers || []) {
    if (!p || !p.tools || typeof p.tools.list !== 'function' || typeof p.tools.call !== 'function') continue;
    let list = [];
    try {
      list = (await p.tools.list()) || [];
    } catch (e) {
      console.error('tools: the tools of ' + p.id + ' could not be listed: ' + e.message);
      continue;
    }
    lists.push({ provider: p, core: !!p.core, tools: (Array.isArray(list) ? list : []).filter(t => t && TOOL_NAME.test(t.name || '')) });
    for (const t of Array.isArray(list) ? list : []) {
      if (names.length >= 200) break;
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
        // the tool changes what is on screen (true), or only some of its actions do: LG's screen saver is closed before
        onScreen: t.onScreen === true || (Array.isArray(t.onScreen) && t.onScreen.map(String)),
        confirm: t.confirm === true || !!(t.annotations && t.annotations.destructiveHint),
      };
      names.push(name);
    }
  }
  return { map, names, lists };
}

const fail = (m, extra) => Object.assign({ content: [{ type: 'text', text: String(m) }], isError: true }, extra || {});

function create(ctx) {
  const core = Object.assign(require('./coretools').create(ctx), { core: true });
  const toolprefs = require('./toolprefs'),
    prefs = toolprefs.create(ctx);
  // the service's own tools first, then the add-ons'
  const providers = () => {
    const a = ctx.feature && ctx.feature('addons');
    const more = a && a.providers ? a.providers('tools') : [];
    return [core].concat(more.map(p => ({ id: p.id, name: p.name, tools: p.mod && p.mod.tools })));
  };

  // with "new tools stay off", a card says which part has tools waiting
  function tellNew(added) {
    const by = {};
    added.forEach(x => (by[x.g.name] = (by[x.g.name] || 0) + 1));
    Object.keys(by).forEach(n =>
      tell(n + ' has ' + by[n] + (by[n] === 1 ? ' new tool' : ' new tools'), 'Turn them on in AI agents (MCP) > Tools.')
    );
  }
  // the tools with the settings applied (manager: AI agents (MCP) > Tools): a tool that is off is left out; an add-on tool keeps
  // only the actions that are on; at most 40 of the tools that are on. Tools seen for the first time get their state here, before
  // anyone is given the list.
  async function current() {
    const m = await merge(providers());
    const groups = toolprefs.groupsOf(m.lists);
    const added = prefs.sync(groups);
    if (added.length && prefs.newTools() === 'off') tellNew(added);
    const itemsOf = {};
    groups.forEach(g =>
      g.items.forEach(it => {
        const k = (g.kind === 'service' ? '' : g.id) + '|' + it.tool;
        (itemsOf[k] = itemsOf[k] || []).push(it);
      })
    );
    const names = [];
    for (const n of m.names) {
      const e = m.map[n],
        its = itemsOf[(e.provider.core ? '' : e.provider.id) + '|' + e.name] || [],
        on = its.filter(it => prefs.isOn(it.key));
      if (its.length && !on.length) {
        e.off = true;
        continue;
      }
      if (on.length < its.length && on.every(it => it.action)) {
        e.allowed = on.map(it => it.action);
        const props = (e.schema && e.schema.properties) || {};
        e.schema = Object.assign({}, e.schema, {
          properties: Object.assign({}, props, { action: Object.assign({}, props.action, { enum: e.allowed }) }),
        });
      }
      if (names.length < MAX_TOOLS) names.push(n);
    }
    return { map: m.map, names, groups };
  }

  async function list() {
    const m = await current();
    return m.names.map(n => {
      const e = m.map[n];
      const t = { name: n, description: e.description, inputSchema: e.schema };
      if (e.confirm) t.annotations = { destructiveHint: true };
      return t;
    });
  }
  async function call(name, args) {
    const m = await current(),
      e = m.map[name];
    if (e && e.off) return fail(name + OFF_TEXT);
    if (!e || m.names.indexOf(name) < 0) return fail('unknown tool: ' + String(name).slice(0, 64));
    const a = declaredArgs(e.schema, args === undefined ? {} : args);
    if (e.allowed && a && typeof a === 'object' && typeof a.action === 'string' && e.allowed.indexOf(a.action) < 0)
      return fail(name + ' ' + a.action.slice(0, 40) + OFF_TEXT);
    const bad = checkArgs(e.schema, a);
    if (bad) return fail(bad);
    if (e.confirm)
      return fail('needs confirmation: ' + name + ' runs only from the voice assistant, after the person says yes on the TV', {
        confirm: true,
      });
    try {
      if (e.onScreen && e.provider !== core && (e.onScreen === true || e.onScreen.indexOf(String(a.action)) >= 0)) await core.wake();
      const r = await e.provider.tools.call(e.name, a, {});
      return r && Array.isArray(r.content) ? { content: r.content, isError: !!r.isError } : fail('the tool gave no answer');
    } catch (err) {
      return fail(String((err && err.message) || err).slice(0, 200));
    }
  }

  const reply = (id, result) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, result });
  const error = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
  // the rules an agent on the network gets with every connection (MCP initialize: instructions), so it knows them in every session
  const NET_INSTRUCTIONS = [
    "This server controls the user's LG TV (CleanYourTV). Use its tools when the user asks for something on the TV. tools/list shows what it offers now; the list changes when the user approves an add-on's tools.",
    'A tool marked destructive (such as power_off) is always refused from the network. Do not retry it: tell the user to ask the voice assistant on the TV.',
    'HTTP 401 means the TV removed you (by hand, or because you were not used for a while). Ask the user for a new code (CleanYourTV manager on the TV: Features > AI agents (MCP) > Connect an agent), pair again with POST /pair on this port, and put the new token in your MCP settings. Keep your memory note about this TV: only the token changes. If the user does not want to connect again, delete the note. This server has no OAuth sign-in.',
    'HTTP 403 "blocked" means the user blocked you on the TV: tell them, and stop until they allow you again.',
    'HTTP 429: wait as long as the error says. At most 60 requests a minute.',
    'Keep your token in your MCP settings only. Never show it in your replies.',
    "If you have a persistent memory and no note about this TV yet, save one: the MCP server tv at this address controls the user's LG TV, and disconnect_from_tv logs out. Never put the token in it.",
    'When the user asks you to disconnect from the TV, call disconnect_from_tv, then remove this server (tv) from your MCP settings and delete your memory note about this TV.',
  ].join(' ');
  // a card on the TV when an agent connects or leaves by itself (notify.js, the same as show_notification); never fails a request
  function tell(title, text) {
    const n = ctx.notify || (ctx.feature && ctx.feature('notify'));
    if (!n || !n.show) return;
    Promise.resolve()
      .then(() => n.show({ title: title.slice(0, 80), text, seconds: 8 }))
      .catch(e => console.log('mcp: no card: ' + ((e && e.message) || e)));
  }
  // a tool only the network side has: the agent removes itself (what POST /logout does)
  const DISCONNECT = {
    name: 'disconnect_from_tv',
    description:
      'Disconnect from this TV: the TV forgets you and your token stops working. Use it only when the user asks you to disconnect or log out from the TV. To connect again, the user must show a new code on the TV.',
    inputSchema: { type: 'object', properties: {} },
  };
  // net: {device} for a request from the network (the paired agent that sent it); none for /api/mcp on the TV itself
  async function rpc(msg, net) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return error(msg && msg.id, -32600, 'invalid request');
    if (msg.method === 'initialize')
      return reply(
        msg.id,
        Object.assign(
          {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'cleanyourtv', version: ctx.version || '' },
          },
          net ? { instructions: NET_INSTRUCTIONS } : {}
        )
      );
    if (typeof msg.method === 'string' && msg.method.indexOf('notifications/') === 0) return undefined; // no reply to a notification
    if (msg.method === 'ping') return reply(msg.id, {});
    if (msg.method === 'tools/list') return reply(msg.id, { tools: (await list()).concat(net ? [DISCONNECT] : []) });
    if (msg.method === 'tools/call') {
      const p = msg.params && typeof msg.params === 'object' ? msg.params : {};
      if (net && p.name === DISCONNECT.name) {
        devices.remove(net.device.id);
        console.log('mcp: an agent disconnected itself: ' + net.device.name);
        tell(net.device.name + ' disconnected', 'This AI agent can no longer control the TV.');
        setTimeout(sync, 100); // after this reply has gone out: the port closes when nobody is left
        return reply(msg.id, {
          content: [
            {
              type: 'text',
              text: 'Disconnected: the TV forgot this agent and the token no longer works. Now remove this server (tv) from your MCP settings, delete your memory note about this TV, and tell the user it is done.',
            },
          ],
          isError: false,
        });
      }
      const r = await call(p.name, p.arguments);
      return reply(msg.id, { content: r.content, isError: r.isError });
    }
    return error(msg.id, -32601, 'method not found');
  }

  // ---- the network: any MCP client on another computer, or a script, off until switched on ----
  // An agent pairs once: the TV opens a window (Connect an agent) with a code that works once; the agent sends it to POST /pair and
  // gets a token of its own (helper/devices.js: kept as a hash, listed on the TV, blocked or removed there, removed by itself when it
  // is not used). Then POST /mcp with "Authorization: Bearer <token>": the same tools and refusals as /api/mcp (destructive tools never
  // run from here). POST /logout with the token removes the agent. A request that carries an Origin (a web page) is refused. The port
  // is open only while the switch is on and an agent is paired or the window is open.
  const cfg = () => Object.assign({}, LAN_DEFAULTS, ctx.config.get().mcp || {});
  const devices = require('./devices').create(
    {
      get: () => {
        const m = cfg();
        return { devices: m.agents, expireDays: m.expireDays };
      },
      set: o =>
        ctx.config.update('mcp', c => {
          c.mcp = Object.assign({}, LAN_DEFAULTS, c.mcp, { agents: o.devices, expireDays: o.expireDays });
          delete c.mcp.token; // the one shared token of before: every agent has its own now
        }),
    },
    { max: MAX_AGENTS, windowMs: PAGE_MS, label: 'agent' }
  );
  const saveLan = on =>
    ctx.config.update('mcp', c => {
      c.mcp = Object.assign({}, LAN_DEFAULTS, c.mcp, { lan: on });
      delete c.mcp.token;
    });
  const fails = new Map(),
    hits = new Map();
  let srv = null,
    lanError = '', // why the port did not open (another program has it), for the manager
    page = null, // {path, until, win}: the page behind the manager's QR code, for one pairing window
    sweeper = null,
    closer = null;

  // too many wrong tokens from an address: shut out for ten minutes. Returns true when the address may go on
  function guard(ip, send) {
    const now = Date.now(),
      f = fails.get(ip) || { n: 0, t: now };
    if (now - f.t > 600000) {
      f.n = 0;
      f.t = now;
    }
    fails.set(ip, f);
    if (f.n >= 10) {
      send(429, { error: 'too many wrong codes or tokens: wait ten minutes' });
      return false;
    }
    return true;
  }
  const wrong = ip => (fails.get(ip) || { n: 0 }).n++;
  // the device behind the Authorization header, or an answer already sent
  function who(req, ip, send) {
    const h = String(req.headers.authorization || ''),
      v = devices.verify(h.indexOf('Bearer ') === 0 ? h.slice(7).trim() : '', ip);
    if (v.error === 'blocked') {
      send(403, { error: 'this agent is blocked on the TV' });
      return null;
    }
    if (v.error) {
      const f = fails.get(ip) || { n: 0, t: Date.now() };
      f.n++;
      fails.set(ip, f);
      send(401, { error: 'bad or missing token: pair again (Connect an agent on the TV)' });
      return null;
    }
    return v.device;
  }
  function readJson(req, send, then) {
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
      then(msg);
    });
  }

  function lanHandler(req, res) {
    const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
    const send = (c, o) => {
      res.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(o));
    };
    const u = req.url.split('?')[0];
    // the page behind the QR code: http://<tv>:8802/<8 characters>, and its status. A wrong address counts as a wrong try, so the
    // short address cannot be guessed (ten wrong tries shut the address out for ten minutes)
    const pm = req.method === 'GET' ? PAGE_PATH.exec(u) : null;
    if (pm) {
      if (!guard(ip, send)) return;
      if (!page || Date.now() >= page.until || pm[1] !== page.path) {
        wrong(ip);
        return send(404, { error: 'this page is closed: show a new code on the TV' });
      }
    }
    // an agent that was sent the link (curl and the like ask for no HTML) gets the prompt itself, as plain text
    if (pm && !pm[2] && !/text\/html/.test(String(req.headers.accept || ''))) {
      return promptFor(page.code).then(
        t => {
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          res.end(t + '\n');
        },
        () => send(500, { error: 'the page could not be made' })
      );
    }
    if (pm && !pm[2]) {
      return tokenHtml(page.code).then(
        html => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(html);
        },
        () => send(500, { error: 'the page could not be made' })
      );
    }
    // the page asks every few seconds whether an agent has paired through it, and then whether it has used the tools
    if (pm && pm[2]) {
      const p = pairedOn(),
        d = p ? devices.list().filter(x => x.id === p.id)[0] : null;
      return send(200, { paired: p ? { name: p.name, ip: p.ip, at: p.at } : null, used: !!(d && d.seen > p.at) });
    }
    if (req.headers.origin !== undefined) return send(403, { error: 'requests from web pages are refused' });
    if (!guard(ip, send)) return;
    if (u === '/pair') {
      if (req.method !== 'POST') return send(405, { error: 'POST {"code","name"} to /pair' });
      return readJson(req, send, b => {
        const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || '')),
          r = devices.pair(String(b.code || ''), b.name, ip, bearer ? bearer[1] : '');
        if (r.error) {
          if (r.status === 403 && !r.blocked) wrong(ip);
          return send(r.status, { error: r.error });
        }
        if (r.already) {
          console.log('mcp: an agent is connected already: ' + r.name + ' from ' + ip);
          tell(r.name + ' connected', 'This AI agent was already connected.');
          return send(200, {
            connected: true,
            name: r.name,
            mcp: 'http://' + web.lanIp() + ':' + lanPort() + '/mcp',
            message:
              'You are already connected to this TV as ' +
              r.name +
              ', and your token still works. Do not pair again or change your MCP settings: keep your server tv and its token, and use its tools in your current session.',
          });
        }
        console.log('mcp: an agent paired: ' + r.name + ' from ' + ip);
        tell(r.name + ' connected', 'This AI agent can now control the TV.');
        send(200, { token: r.token, name: r.name, mcp: 'http://' + web.lanIp() + ':' + lanPort() + '/mcp' });
      });
    }
    const r = hits.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - r.t > 60000) {
      r.n = 0;
      r.t = Date.now();
    }
    hits.set(ip, r);
    if (++r.n > PER_MINUTE) return send(429, { error: 'at most ' + PER_MINUTE + ' requests a minute' });
    if (u === '/logout') {
      if (req.method !== 'POST') return send(405, { error: 'POST to /logout' });
      const d = who(req, ip, send);
      if (!d) return;
      devices.remove(d.id);
      console.log('mcp: an agent logged out: ' + d.name);
      tell(d.name + ' disconnected', 'This AI agent can no longer control the TV.');
      send(200, { bye: true });
      return sync();
    }
    if (u !== '/mcp') return send(404, { error: 'the MCP endpoint is /mcp' });
    if (req.method !== 'POST') return send(405, { error: 'POST JSON-RPC 2.0 to /mcp' }); // no event stream: every reply is JSON
    const agent = who(req, ip, send);
    if (!agent) return;
    readJson(req, send, msg =>
      rpc(msg, { device: agent }).then(
        out => {
          if (out === undefined) {
            res.writeHead(202);
            return res.end();
          }
          send(200, out);
        },
        e => send(500, { error: String((e && e.message) || e) })
      )
    );
  }

  // the text a person pastes into their agent: how to pair with the code, add the server and check it. The rules and the tools come
  // from the server itself afterwards (initialize: instructions; tools/list)
  async function promptFor(code) {
    const BASE = 'http://' + web.lanIp() + ':' + lanPort(),
      ADDR = BASE + '/mcp',
      MINS = String(Math.max(1, Math.round(((page ? page.until : Date.now()) - Date.now()) / 60000))),
      put = s => s.split('{BASE}').join(BASE).split('{ADDR}').join(ADDR).split('{CODE}').join(code).split('{MINS}').join(MINS);
    return [
      'You can control my LG TV (CleanYourTV) through its MCP server on my home network. Set it up once with the four steps below, then use its tools when I ask.',
      'This is a standard MCP server: it works with any agent or app that supports MCP, including the one you are running in. Do not install, search for or switch to another app.',
      'If you cannot run commands or edit your MCP settings yourself, tell me exactly what to run or paste, one step at a time.',
      '',
      'Step 1. Pair with the code below. Replace NAME with your own name and the name of this computer (for example: <your app> on <computer name>; not a name from another app), and send:',
      '   curl -s -X POST {BASE}/pair -H "content-type: application/json" -d \'{"code":"{CODE}","name":"NAME"}\'',
      '   On Windows PowerShell use instead:',
      '   Invoke-RestMethod -Method Post -Uri {BASE}/pair -ContentType application/json -Body \'{"code":"{CODE}","name":"NAME"}\'',
      '   The code works one time, for about {MINS} more minutes, and closes early if Back is pressed on the TV.',
      '   If you already have a server named tv for this TV, send its token too, so the TV can tell you are connected already:',
      '   add -H "Authorization: Bearer OLDTOKEN" to curl, or -Headers @{Authorization=\'Bearer OLDTOKEN\'} to Invoke-RestMethod.',
      '   If the answer is {"connected":true,...}, you are connected already and your token works: keep your MCP settings as they are, skip steps 2 and 3, and use the tv tools in your current session.',
      '   Otherwise the answer is JSON: {"token":"...","name":"...","mcp":"{ADDR}"}. Read the token from it. The TV shows it only this once.',
      '   Keep the token only in your MCP settings (step 2). Do not show it in your replies to me. Do not pair again: the code is used up.',
      '',
      'Step 2. Add the server to your own MCP settings, the way your app documents it (a settings file, a command or a settings screen), with the token in place of TOKEN:',
      '   name: tv',
      '   type: remote server over HTTP (MCP Streamable HTTP; apps call it "http", "streamable-http" or a server "url"; not SSE)',
      '   URL: {ADDR}',
      '   header: Authorization: Bearer TOKEN',
      '   Many apps take JSON in this shape: {"mcpServers":{"tv":{"url":"{ADDR}","headers":{"Authorization":"Bearer TOKEN"}}}}',
      '   If a server named tv exists already, remove it and add it again with the new token: do not keep using an old token. New servers usually appear after the app restarts or in a new session.',
      '- If your app can only start local programs (stdio servers), start the mcp-remote bridge instead (needs Node.js):',
      '   command: npx   arguments: -y mcp-remote {ADDR} --allow-http --header "Authorization:${TV_AUTH}"   environment: TV_AUTH=Bearer TOKEN',
      '- If you have no MCP support, call the server yourself: POST JSON-RPC 2.0 to {ADDR} with the headers "Authorization: Bearer TOKEN" and "content-type: application/json". Send initialize first, then tools/list and tools/call.',
      '',
      'Step 3. Check it now, without waiting for a restart:',
      '   curl -s -X POST {ADDR} -H "Authorization: Bearer TOKEN" -H "content-type: application/json" -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'',
      '   Then tell me the names of the tools you have.',
      '',
      'Step 4. Remember the connection, so you know about the TV in every new chat. Save a short note in your persistent memory (whatever your app calls it: memory, saved notes, user or project instructions), for example:',
      '   "The user has an LG TV (CleanYourTV) that I can control through the MCP server named tv at {ADDR}. Its rules come with initialize. To log out, call disconnect_from_tv."',
      '   Never put the token in the note: it stays only in your MCP settings.',
      '   If you pair again later, keep the note: only the token changes. When you disconnect, or I do not want to connect again, delete the note.',
      '   If you have no persistent memory, tell me, and skip this step.',
      '',
      'If something fails, stop and tell me. Do not retry in a loop: wrong codes and tokens lock your address out for ten minutes.',
      '- Connection refused or no answer: the TV must be on, on the same network as you, with the network switch on (Features > AI agents (MCP) in the CleanYourTV manager on the TV). The port also closes when the code has expired and no agent is paired.',
      '- 403 "wrong code", "no code is open" or "used already": ask me for a new code (Features > AI agents (MCP) > Connect an agent), and use the new prompt.',
      '- 409: ten agents are paired already. Ask me to remove one on the TV.',
      '- 429: wait as long as the error says.',
      '- 401 from /mcp: the token is wrong or the TV removed it. Pair again with a new code. This server has no sign-in (OAuth): do not start one.',
      '',
      'The server is MCP Streamable HTTP: every reply is JSON, and there is no event stream (GET answers 405, which is normal).',
      'After you connect, the server gives its rules in the initialize reply (instructions), and tools/list includes disconnect_from_tv. Follow them.',
    ]
      .map(put)
      .join('\n');
  }
  // the page behind the QR code: the prompt with a Copy button, and a line that turns green when an agent pairs and uses the tools
  async function tokenHtml(code) {
    const addr = web.esc('http://' + web.lanIp() + ':' + lanPort() + '/mcp'),
      prompt = web.esc(await promptFor(code)),
      st = '/' + page.path + '/status';
    return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Connect an agent to the TV</title>
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{font:17px/1.45 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:22px 16px 48px}h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:22px 0 6px}p,small{color:#888}
ol{padding-left:20px;margin:6px 0}li{margin:4px 0}textarea{width:100%;min-height:260px;font:13px/1.45 ui-monospace,Menlo,monospace;border:1px solid #8885;border-radius:12px;padding:10px;background:transparent;color:inherit;resize:vertical}
button{font:inherit;font-weight:600;padding:12px 16px;border-radius:12px;border:0;background:#2563eb;color:#fff;width:100%;margin:8px 0}
.st{display:flex;align-items:center;padding:12px 14px;border-radius:12px;background:#8881;margin:10px 0;word-break:break-all}.st i{width:12px;height:12px;border-radius:50%;background:#e0a100;margin-right:10px;flex:none}
.st.ok{background:#16a34a22}.st.ok i{background:#16a34a}.code{font:600 28px ui-monospace,Menlo,monospace;letter-spacing:.12em}</style>
<h1>Connect an agent to the TV</h1>
<p>Let an AI agent on a computer in your home (any app that supports MCP) use the TV's tools.</p>
<ol><li>Copy the prompt below and paste it to your agent on a computer on the same network as the TV.</li><li>Or send your agent the address of this page: it can read the prompt itself.</li><li>Keep this page open: it turns green when the agent has paired with the TV.</li></ol>
<p>AI agent reading this page: the prompt below is for you. Follow its steps.</p>
<p>Code <span class=code>${web.esc(code)}</span> · works once</p>
<div class=st id=st><i></i><span id=stt>Waiting for an agent at ${addr}</span></div>
<h2>Prompt for your agent</h2>
<textarea id=p readonly>${prompt}</textarea>
<button id=cp>Copy the prompt</button>
<small>The code in the prompt works once: the agent trades it for a token of its own. It closes after ten minutes, when Back is pressed on the TV, or after 8 wrong tries.</small>
<script>
var done=0,B=document.getElementById('cp');
B.onclick=function(){var t=document.getElementById('p'),done=function(){B.textContent='Copied';setTimeout(function(){B.textContent='Copy the prompt'},2000)},old=function(){t.focus();t.select();try{document.execCommand('copy')}catch(e){}done()};
 if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t.value).then(done,old);else old()};
function poll(){var x=new XMLHttpRequest();x.open('GET','${st}');x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}
 if(x.status!==200){if(!done){document.getElementById('st').className='st';document.getElementById('stt').textContent='This code is closed. Show a new one on the TV: Features > AI agents (MCP) > Connect an agent.'}return}
 if(j.paired){done=1;var a=j.paired;document.getElementById('st').className='st ok';document.getElementById('stt').textContent=(j.used?'Connected: ':'Paired: ')+a.name+' from '+a.ip+' at '+new Date(a.at).toLocaleTimeString()+(j.used?'':'. Waiting for its first call…')}
 if(!j.used)setTimeout(poll,2000)};x.onerror=function(){setTimeout(poll,4000)};x.send()}
poll();
</script>`;
  }

  function stopLan() {
    if (srv) {
      try {
        srv.close();
      } catch (_) {}
      srv = null;
    }
  }
  // make the listener match the settings: open while the switch is on and an agent is paired or the window is open. Resolves once
  // the port is open or has failed
  function sync() {
    const n = cfg();
    if (!n.lan || (!devices.count() && !devices.windowOpen())) {
      if (!n.lan) lanError = '';
      stopLan();
      return Promise.resolve();
    }
    if (srv) return Promise.resolve();
    const s = http.createServer(lanHandler);
    s.setTimeout(30000);
    return new Promise(resolve => {
      s.once('error', (/** @type {NodeJS.ErrnoException} */ e) => {
        lanError =
          e && e.code === 'EADDRINUSE'
            ? 'port ' + lanPort() + ' is used by another program on the TV'
            : 'the port could not open: ' + String((e && e.message) || e).slice(0, 120);
        console.error('mcp: ' + lanError);
        resolve();
      });
      s.once('listening', () => {
        srv = s;
        lanError = '';
        s.on('error', e => console.error('mcp: ' + ((e && e.message) || e)));
        resolve();
      });
      s.listen(lanPort(), '0.0.0.0');
    });
  }
  // remove the agents nobody used for the chosen time (at start and every hour)
  function sweep() {
    const gone = devices.sweep();
    if (gone.length) {
      console.log('mcp: removed agents not used for ' + devices.expireDays() + ' days: ' + gone.join(', '));
      sync();
    }
    return gone;
  }
  function start() {
    sweep();
    if (!sweeper) {
      sweeper = setInterval(sweep, 3600 * 1000);
      if (sweeper.unref) sweeper.unref();
    }
    return sync();
  }
  function stop() {
    stopLan();
    if (sweeper) clearInterval(sweeper);
    if (closer) clearTimeout(closer);
    sweeper = closer = null;
  }
  // who paired with the code that is (or was) on screen
  const pairedOn = () => (page ? page.paired || devices.windowState(page.win).paired : null);
  const lanInfo = () => {
    const n = cfg();
    return {
      lan: !!n.lan,
      port: lanPort(),
      ip: web.lanIp(),
      listening: !!(srv && srv.listening),
      error: n.lan ? lanError : '',
      agents: devices.list().map(d => Object.assign(d, { removesIn: devices.removesIn(d.id) })),
      max: MAX_AGENTS,
      expireDays: devices.expireDays(),
      pairing: !!(page && devices.windowOpen()),
      // the agent that paired with the code on screen: the manager closes its QR screen when it sees one
      paired: (p => (p ? { name: p.name, ip: p.ip, at: p.at } : null))(pairedOn()),
    };
  };
  // {lan?, page?, pair: false, block: id, allow: id, remove: id, removeAll, expireDays}
  async function lanSet(o) {
    if (typeof o.lan === 'boolean') saveLan(o.lan);
    if (o.lan === false) {
      devices.closeWindow();
      page = null;
    }
    if (typeof o.block === 'string' && !devices.setBlocked(o.block, true)) return { error: 'no such agent' };
    if (typeof o.allow === 'string' && !devices.setBlocked(o.allow, false)) return { error: 'no such agent' };
    if (typeof o.remove === 'string' && !devices.remove(o.remove)) return { error: 'no such agent' };
    if (o.removeAll === true) devices.removeAll();
    if (o.expireDays !== undefined && !devices.setExpire(o.expireDays)) return { error: 'expireDays is 0, 1, 3, 7, 14 or 30' };
    if (o.pair === false) {
      // a code that was used keeps its page a while, so the phone still shows Connected; an unused one goes at once
      const p = pairedOn();
      devices.closeWindow();
      if (page && p) page.paired = p;
      else page = null;
    }
    let extra = {};
    if (o.page && cfg().lan) {
      const w = devices.openWindow();
      page = { path: shortPath(), until: w.until, win: w.id, code: w.code };
      if (closer) clearTimeout(closer);
      closer = setTimeout(() => {
        page = null;
        sync();
      }, PAGE_MS + 1000);
      extra = { pageUrl: 'http://' + web.lanIp() + ':' + lanPort() + '/' + page.path, code: w.code, pageSeconds: PAGE_MS / 1000 };
    }
    await sync();
    if (extra.pageUrl && !(srv && srv.listening)) extra = {};
    return Object.assign(lanInfo(), extra);
  }

  async function handle(req, res, u, body) {
    // the network settings and the agents, for the manager: GET lanInfo(); POST lanSet()
    // the tool settings, for the manager: GET the groups and their items; POST a change (toolprefs.set), then the groups again
    if (u === '/api/mcp/tools') {
      if (req.method === 'POST') {
        const r = prefs.set((await body(req)) || {});
        if (r.error) return web.json(res, r, 400);
      }
      const m = await current(),
        a = ctx.feature && ctx.feature('addons'),
        names = {};
      ((a && a.list && a.list()) || []).forEach(x => (names[x.id] = x.name));
      return web.json(res, prefs.status(m.groups, names));
    }
    if (u === '/api/mcp/lan') {
      if (req.method !== 'POST') return web.json(res, lanInfo());
      const r = await lanSet((await body(req)) || {});
      return web.json(res, r, r.error ? 400 : 200);
    }
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
    paths: ['/api/mcp', '/api/mcp/lan', '/api/mcp/tools'],
    handle,
    start,
    stop,
    providers,
    // the tools with the settings applied, for the voice assistant (answers.js): {map, names, groups}; a tool that is off is not in
    // names and has off: true in map
    merged: current,
    list,
    call,
    rpc,
    lanInfo,
    lanSet,
  };
}

module.exports = { create, merge, checkArgs, declaredArgs, OFF_TEXT, MAX_TOOLS, LAN_DEFAULTS, PORT };
