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
const lanPort = () => +process.env.CYTV_MCP_PORT || PORT;
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
    if (e.confirm)
      return fail('needs confirmation: ' + name + ' runs only from the voice assistant, after the person says yes on the TV', {
        confirm: true,
      });
    try {
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
    "This server controls the user's LG TV (CleanYourTV). Use its tools when the user asks for something on the TV; tools/list has what it offers now, and it changes when the user approves an add-on's tools.",
    'Tools marked destructive (such as power_off) are always refused from the network: do not retry them; the user can do it with the voice assistant on the TV.',
    'An answer 401 means the TV removed you (by hand, or because you were not used for a while): ask the user for a new code (Features > AI agents (MCP) > Connect an agent on the TV) and pair again with POST /pair.',
    'An answer 403 "blocked" means the user blocked you on the TV: tell them, and wait until they allow you again.',
    'At most 60 requests a minute.',
    'When the user asks you to disconnect from the TV, call disconnect_from_tv: the TV forgets you and your token stops working; then remove this server from your MCP settings (Claude Code: claude mcp remove tv).',
  ].join(' ');
  // a tool only the network side has: the agent removes itself (what POST /logout does)
  const DISCONNECT = {
    name: 'disconnect_from_tv',
    description:
      'Disconnect from this TV: the TV forgets you and your token stops working. Use it when the user asks you to disconnect or log out from the TV. To connect again you need a new code from the TV.',
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
        setTimeout(sync, 100); // after this reply has gone out: the port closes when nobody is left
        return reply(msg.id, {
          content: [{ type: 'text', text: 'Disconnected: the TV forgot this agent. Remove the server from your MCP settings now.' }],
          isError: false,
        });
      }
      const r = await call(p.name, p.arguments);
      return reply(msg.id, { content: r.content, isError: r.isError });
    }
    return error(msg.id, -32601, 'method not found');
  }

  // ---- the network: MCP clients on other computers (Claude Code, Claude Desktop, Cursor, a script), off until switched on ----
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
    const pageOpen = req.method === 'GET' && page && Date.now() < page.until;
    if (pageOpen && u === '/t/' + page.path) {
      return tokenHtml(page.code).then(
        html => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(html);
        },
        () => send(500, { error: 'the page could not be made' })
      );
    }
    // the page asks every few seconds whether an agent has paired through it, and then whether it has used the tools
    if (pageOpen && u === '/t/' + page.path + '/status') {
      const p = pairedOn(),
        d = p ? devices.list().filter(x => x.id === p.id)[0] : null;
      return send(200, { paired: p ? { name: p.name, ip: p.ip, at: p.at } : null, used: !!(d && d.seen > p.at) });
    }
    if (req.headers.origin !== undefined) return send(403, { error: 'requests from web pages are refused' });
    if (!guard(ip, send)) return;
    if (u === '/pair') {
      if (req.method !== 'POST') return send(405, { error: 'POST {"code","name"} to /pair' });
      return readJson(req, send, b => {
        const r = devices.pair(String(b.code || ''), b.name, ip);
        if (r.error) {
          if (r.status === 403) wrong(ip);
          return send(r.status, { error: r.error });
        }
        console.log('mcp: an agent paired: ' + r.name + ' from ' + ip);
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

  // the text a person pastes into their agent: how to pair with the code, how to add the server, what it may do there
  async function promptFor(code) {
    const base = 'http://' + web.lanIp() + ':' + lanPort(),
      addr = base + '/mcp',
      head = 'Authorization: Bearer <token>',
      mins = Math.max(1, Math.round(((page ? page.until : Date.now()) - Date.now()) / 60000));
    return [
      'You can control my LG TV (CleanYourTV) through its MCP server. Pair with it once, set it up as an MCP server for yourself, then use its tools when I ask.',
      '',
      '1. Pair. The code works once, in the next ' + mins + (mins === 1 ? ' minute:' : ' minutes:'),
      '   POST ' + base + '/pair with {"code":"' + code + '","name":"<a short name for you, such as Claude Code on my laptop>"}',
      '   curl -s -X POST ' +
        base +
        '/pair -H "content-type: application/json" -d \'{"code":"' +
        code +
        '","name":"<a short name for you>"}\'',
      '   (Windows PowerShell: use curl.exe, or Invoke-RestMethod)',
      '   The answer is {"token":"<id>.<secret>", ...}. It is shown only once: keep it in your MCP settings and do not repeat it in your replies.',
      '',
      '2. Add the server, with the token in place of <token>:',
      '- Claude Code: claude mcp add --scope user --transport http tv ' +
        addr +
        ' --header "' +
        head +
        '" (the tools appear in your next session)',
      '- Clients that only start local programs (Claude Desktop, Cursor) use the mcp-remote bridge in their MCP settings:',
      '  {"mcpServers":{"tv":{"command":"npx","args":["mcp-remote","' + addr + '","--allow-http","--header","' + head + '"]}}}',
      '- Without MCP settings, call it yourself: POST ' +
        addr +
        ' with the header and {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"<your name>","version":"1"}}}, then tools/list and tools/call.',
      '',
      'Transport: MCP Streamable HTTP (JSON-RPC 2.0 over POST; every reply is JSON, there is no event stream).',
      '',
      'After this, the server itself tells you the rest: its rules come with initialize (instructions), and tools/list has every tool, including disconnect_from_tv.',
      '',
      'Then check that it works: POST {"jsonrpc":"2.0","id":1,"method":"tools/list"} to ' +
        addr +
        ' with the header (use curl if your MCP tools only appear in a new session), and tell me which tools you have.',
    ].join('\n');
  }
  // the page behind the QR code: the prompt with a Copy button, and a line that turns green when an agent pairs and uses the tools
  async function tokenHtml(code) {
    const addr = web.esc('http://' + web.lanIp() + ':' + lanPort() + '/mcp'),
      prompt = web.esc(await promptFor(code)),
      st = '/t/' + page.path + '/status';
    return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Connect an agent to the TV</title>
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{font:17px/1.45 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:22px 16px 48px}h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:22px 0 6px}p,small{color:#888}
ol{padding-left:20px;margin:6px 0}li{margin:4px 0}textarea{width:100%;min-height:260px;font:13px/1.45 ui-monospace,Menlo,monospace;border:1px solid #8885;border-radius:12px;padding:10px;background:transparent;color:inherit;resize:vertical}
button{font:inherit;font-weight:600;padding:12px 16px;border-radius:12px;border:0;background:#2563eb;color:#fff;width:100%;margin:8px 0}
.st{display:flex;align-items:center;padding:12px 14px;border-radius:12px;background:#8881;margin:10px 0;word-break:break-all}.st i{width:12px;height:12px;border-radius:50%;background:#e0a100;margin-right:10px;flex:none}
.st.ok{background:#16a34a22}.st.ok i{background:#16a34a}.code{font:600 28px ui-monospace,Menlo,monospace;letter-spacing:.12em}</style>
<h1>Connect an agent to the TV</h1>
<p>Let an AI agent on a computer in your home (Claude Code, Claude Desktop, Cursor) use the TV's tools.</p>
<ol><li>Copy the prompt below.</li><li>Paste it to your agent on a computer on the same network.</li><li>Keep this page open: it turns green when the agent has paired with the TV.</li></ol>
<p>Code <span class=code>${web.esc(code)}</span> · works once</p>
<div class=st id=st><i></i><span id=stt>Waiting for an agent at ${addr}</span></div>
<h2>Prompt for your agent</h2>
<textarea id=p readonly>${prompt}</textarea>
<button id=cp>Copy the prompt</button>
<small>The prompt holds a code that works once: the agent trades it for a token of its own. The code works for ten minutes, or until Back is pressed on the TV.</small>
<script>
var done=0,B=document.getElementById('cp');
B.onclick=function(){var t=document.getElementById('p'),done=function(){B.textContent='Copied';setTimeout(function(){B.textContent='Copy the prompt'},2000)},old=function(){t.focus();t.select();try{document.execCommand('copy')}catch(e){}done()};
 if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t.value).then(done,old);else old()};
function poll(){var x=new XMLHttpRequest();x.open('GET','${st}');x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}
 if(x.status!==200){if(!done){document.getElementById('st').className='st';document.getElementById('stt').textContent='This code is closed. Show a new one on the TV: Connect an agent.'}return}
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
      s.once('error', e => {
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
      page = { path: crypto.randomBytes(12).toString('hex'), until: w.until, win: w.id, code: w.code };
      if (closer) clearTimeout(closer);
      closer = setTimeout(() => {
        page = null;
        sync();
      }, PAGE_MS + 1000);
      extra = { pageUrl: 'http://' + web.lanIp() + ':' + lanPort() + '/t/' + page.path, code: w.code, pageSeconds: PAGE_MS / 1000 };
    }
    await sync();
    if (extra.pageUrl && !(srv && srv.listening)) extra = {};
    return Object.assign(lanInfo(), extra);
  }

  async function handle(req, res, u, body) {
    // the network settings and the agents, for the manager: GET lanInfo(); POST lanSet()
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
    paths: ['/api/mcp', '/api/mcp/lan'],
    handle,
    start,
    stop,
    providers,
    list,
    call,
    rpc,
    lanInfo,
    lanSet,
  };
}

module.exports = { create, merge, checkArgs, MAX_TOOLS, LAN_DEFAULTS, PORT };
