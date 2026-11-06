// The tool scheme, discovery, registry and invocation of the agent add-on (addons/catalog/agent). The add-on knows no app
// or add-on by name. Instead it reads small declarations that the installed apps and add-ons sign: a tools.json in the app's
// or add-on's folder, or one dropped into the add-on's registration directory. A declaration is
//
//   { "tools": [ { "name", "description", "inputSchema", "confirm"?, "invoke" } ] }
//
// and a tool's "invoke" names how to run it (see README.md). The registry turns the declarations into MCP tools (list and
// call over JSON-RPC 2.0), so the voice assistant or any MCP client can use them.
//
// Every file that declares tools is a source. A source gives no tools until the person approves it (the add-on's phone page);
// the approvals are this add-on's settings. A tool marked "confirm" runs only with {confirmed: true}, which the voice assistant
// passes after the person said yes. Calls to the TV itself (127.0.0.1, localhost, its own address) are refused: the service's
// API is root, and an add-on tool reaches only its own add-on's paths.
//
// Node 8.12 (webOS 5/6): no optional chaining, no nullish coalescing, no object spread, no fs.promises, no global URL.
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/; // a tool name: a letter, then letters, digits, _ and - (what OpenAI-style tools accept)
const KINDS = ['app', 'addon', 'http'];
const MAX_PER_SOURCE = 16;
const MAX_RESULT = 4000;
const RESERVED = ['catalog', 'install', 'remove', 'sdk', 'book', 'preview', 'repos', 'update']; // paths of the loader, not add-ons
const SERVICE_URL = process.env.CYTV_AGENT_SERVICE_URL || 'http://127.0.0.1:8765'; // where the add-on kind calls another add-on
const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];

const has = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// replace {arg} in a declaration value with the tool argument; a value that is exactly "{arg}" keeps the argument's type.
// enc: the value goes into an address (a path or a query), so the argument is encoded and keeps no type
function interp(v, args, enc) {
  const put = x => (enc ? encodeURIComponent(String(x)) : String(x));
  if (typeof v === 'string') {
    const one = /^\{([A-Za-z0-9_]+)\}$/.exec(v);
    if (one && !enc) return has(args, one[1]) ? args[one[1]] : v;
    return v.replace(/\{([A-Za-z0-9_]+)\}/g, (all, k) => (has(args, k) ? put(args[k]) : all));
  }
  if (Array.isArray(v)) return v.map(x => interp(x, args, enc));
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => {
      o[k] = interp(v[k], args, enc);
    });
    return o;
  }
  return v;
}

// the TV itself: loopback, any-address, and the TV's own LAN address (lanIp)
function isSelf(host, lanIp) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (process.env.CYTV_AGENT_LOOPBACK === '1') return false; // only the tests, whose stand-in servers are on 127.0.0.1
  return (
    h === 'localhost' ||
    /\.localhost$/.test(h) ||
    /^127\./.test(h) ||
    h === '0.0.0.0' ||
    h === '0' ||
    h === '::' ||
    h === '::1' ||
    /^::ffff:127\./.test(h) ||
    (!!lanIp && h === lanIp)
  );
}

// the arguments against a tool's inputSchema: the required ones are there, and the simple types and enums match. '' when fine
function checkArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'the arguments must be an object';
  const props = (schema && schema.properties) || {};
  const req = (schema && schema.required) || [];
  for (let i = 0; i < req.length; i++) if (!has(args, req[i]) || args[req[i]] === null) return req[i] + ' is required';
  const keys = Object.keys(args);
  for (let i = 0; i < keys.length; i++) {
    const p = props[keys[i]],
      v = args[keys[i]];
    if (!p || typeof p !== 'object') continue;
    const t = p.type;
    if (t === 'string' && typeof v !== 'string') return keys[i] + ' must be text';
    if ((t === 'number' || t === 'integer') && (typeof v !== 'number' || !isFinite(v))) return keys[i] + ' must be a number';
    if (t === 'integer' && Math.floor(v) !== v) return keys[i] + ' must be a whole number';
    if (t === 'boolean' && typeof v !== 'boolean') return keys[i] + ' must be true or false';
    if (Array.isArray(p.enum) && p.enum.indexOf(v) < 0) return keys[i] + ' must be one of ' + p.enum.join(', ');
  }
  return '';
}

// one tool declaration -> {tool} or {error}
function cleanTool(t, source) {
  const err = m => ({ error: (source ? source + ': ' : '') + m });
  if (!t || typeof t !== 'object' || Array.isArray(t)) return err('a tool must be an object');
  if (!NAME.test(String(t.name || ''))) return err('a tool name must start with a letter and use letters, digits, _ or -');
  if (typeof t.description !== 'string' || !t.description.trim() || t.description.length > 300)
    return err('a tool needs a description (at most 300 characters)');
  const s = t.inputSchema;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return err('a tool needs an inputSchema object');
  if (s.type !== undefined && s.type !== 'object') return err("inputSchema.type must be 'object'");
  const props = s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties) ? s.properties : {};
  const pk = Object.keys(props);
  if (pk.length > 12) return err('a tool takes at most 12 arguments');
  for (let i = 0; i < pk.length; i++) {
    const p = props[pk[i]];
    if (!/^[A-Za-z0-9_]{1,40}$/.test(pk[i]) || !p || typeof p !== 'object' || (p.type !== undefined && TYPES.indexOf(p.type) < 0))
      return err('argument ' + String(pk[i]).slice(0, 40) + ' needs a name of letters, digits or _ and a JSON type');
  }
  if (t.confirm !== undefined && typeof t.confirm !== 'boolean') return err('confirm must be true or false');
  const inv = t.invoke;
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) return err('a tool needs an invoke object');
  if (KINDS.indexOf(inv.kind) < 0) return err('invoke.kind must be app, addon or http');
  if (inv.kind === 'app') {
    if (typeof inv.id !== 'string' || !/^[\w.-]{2,80}$/.test(inv.id)) return err("an app tool needs invoke.id, the app's id");
  } else if (inv.kind === 'addon') {
    if (typeof inv.addon !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(inv.addon) || RESERVED.indexOf(inv.addon) >= 0)
      return err("an addon tool needs invoke.addon, the add-on's id");
    if (typeof inv.path !== 'string' || inv.path.charAt(0) !== '/' || /\.\.|[\s?#]/.test(inv.path.replace(/\{[A-Za-z0-9_]+\}/g, '')))
      return err('an addon tool needs invoke.path starting with / (no .., spaces, ? or #)');
  } else if (inv.kind === 'http') {
    // the scheme and host are fixed in the declaration: an argument can only go into the path and the query
    const m = typeof inv.url === 'string' ? /^https?:\/\/([^/?#{}\s]+)([/?#]\S*)?$/.exec(inv.url) : null;
    if (!m) return err('an http tool needs invoke.url starting with http:// or https://, with no {argument} in the host');
    const host = url.parse(inv.url.replace(/\{[A-Za-z0-9_]+\}/g, 'x')).hostname;
    if (isSelf(host)) return err('an http tool may not call the TV itself');
  }
  if (inv.method !== undefined && !/^(GET|POST|PUT|PATCH|DELETE)$/i.test(String(inv.method)))
    return err('invoke.method must be GET, POST, PUT, PATCH or DELETE');
  return {
    tool: {
      name: String(t.name),
      description: String(t.description).trim(),
      inputSchema: {
        type: 'object',
        properties: props,
        required: Array.isArray(s.required) ? s.required.filter(x => typeof x === 'string') : [],
      },
      confirm: t.confirm === true,
      invoke: inv,
    },
  };
}

// a tools.json -> {tools} or {error}
function cleanDeclaration(doc, source) {
  const err = m => ({ error: (source ? source + ': ' : '') + m });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return err('a tools.json must be an object');
  if (!Array.isArray(doc.tools)) return err('a tools.json needs a "tools" list');
  if (doc.tools.length > MAX_PER_SOURCE) return err('a tools.json declares at most ' + MAX_PER_SOURCE + ' tools');
  const tools = [];
  for (let i = 0; i < doc.tools.length; i++) {
    const r = cleanTool(doc.tools[i], source);
    if (r.error) return r;
    if (tools.some(x => x.name === r.tool.name)) return err('two tools are named ' + r.tool.name);
    tools.push(r.tool);
  }
  return { tools };
}

function readTools(file) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { error: 'could not read ' + file + ': ' + e.message };
  }
  return cleanDeclaration(doc, file);
}

// each subfolder of dir that holds a tools.json is a source: {key, kind, id, file, tools, error}
function scanDir(dir, kind, out) {
  let names;
  try {
    names = fs.readdirSync(dir).sort();
  } catch (_) {
    return out;
  }
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (n.charAt(0) === '.') continue;
    const f = path.join(dir, n, 'tools.json');
    if (!fs.existsSync(f)) continue;
    const key = kind + ':' + n;
    if (out.some(s => s.key === key)) continue; // a bundled add-on wins over an installed one with the same id, as in the loader
    const r = readTools(f);
    out.push({ key: key, kind: kind, id: n, file: f, tools: r.tools || [], error: r.error || '' });
  }
  return out;
}

function text(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return { content: [{ type: 'text', text: s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + '…' : s }], isError: false };
}
function failTool(m, extra) {
  return Object.assign({ content: [{ type: 'text', text: String(m) }], isError: true }, extra || {});
}
// an add-on's or an address's reply: JSON when it parses, its text otherwise
function parseReply(r) {
  const body = r && r.body ? r.body.toString('utf8') : '';
  try {
    return { status: r && r.status, json: JSON.parse(body) };
  } catch (_) {
    return { status: r && r.status, text: body.slice(0, MAX_RESULT) };
  }
}
const noBreaks = h => {
  const o = {};
  Object.keys(h || {}).forEach(k => {
    o[String(k).replace(/[\r\n:]/g, '')] = String(h[k]).replace(/[\r\n]/g, ' ');
  });
  return o;
};

function registry(ctx) {
  ctx = ctx || {};
  const here = path.dirname(ctx.dir || __dirname); // the folder installed add-ons live in (ctx.dir is this add-on's own)
  const roots = {
    bundled: process.env.CYTV_ADDONS_BUNDLED || path.join(path.dirname(here), 'addons-bundled'),
    addons: process.env.CYTV_ADDONS || here,
    apps: process.env.CYTV_APPS || '/media/developer/apps/usr/palm/applications',
  };
  const registrationDir = path.join(ctx.dataDir || path.join(path.dirname(here), 'addon-data', 'agent'), 'tools');
  const deps = {
    luna: ctx.luna || null,
    fetch: ctx.fetch || null,
    log: ctx.log || (() => {}),
    lanIp: () => {
      try {
        return ctx.util && ctx.util.lanIp ? ctx.util.lanIp() : '';
      } catch (_) {
        return '';
      }
    },
  };
  const approvals = () => {
    const s = ctx.settings && ctx.settings.get ? ctx.settings.get() : {};
    return s && s.approved && typeof s.approved === 'object' ? s.approved : {};
  };

  let sources = []; // every declaration found, approved or not
  let index = {}; // name -> {tool, source} of the approved sources
  let errors = [];

  function discover() {
    const found = [];
    scanDir(roots.bundled, 'addon', found);
    scanDir(roots.addons, 'addon', found);
    scanDir(roots.apps, 'app', found);
    let regs = [];
    try {
      regs = fs.readdirSync(registrationDir).sort();
    } catch (_) {}
    for (let i = 0; i < regs.length; i++) {
      const m = /^([A-Za-z0-9_.-]{1,60})\.json$/.exec(regs[i]);
      if (!m) continue;
      const f = path.join(registrationDir, regs[i]);
      const r = readTools(f);
      found.push({ key: 'file:' + m[1], kind: 'file', id: m[1], file: f, tools: r.tools || [], error: r.error || '' });
    }
    const ok = approvals();
    index = {};
    errors = found.filter(s => s.error).map(s => s.error);
    sources = found;
    for (let i = 0; i < found.length; i++) {
      if (found[i].error || ok[found[i].key] !== true) continue;
      for (let j = 0; j < found[i].tools.length; j++) {
        const t = found[i].tools[j];
        if (index[t.name]) {
          errors.push('tool ' + t.name + ' is declared twice (' + index[t.name].source + ' and ' + found[i].key + '); the first is kept');
          continue;
        }
        index[t.name] = { tool: t, source: found[i].key };
      }
    }
    return { count: Object.keys(index).length, sources: found.length, errors: errors.slice() };
  }

  // the tools as MCP lists them: name, description, inputSchema, and destructiveHint for the ones that ask to confirm
  function list() {
    return Object.keys(index)
      .sort()
      .map(name => {
        const t = index[name].tool;
        const m = { name: name, description: t.description, inputSchema: t.inputSchema };
        if (t.confirm) m.annotations = { destructiveHint: true };
        return m;
      });
  }

  // every source, for the phone page: what it declares and whether it is approved
  function sourceList() {
    const ok = approvals();
    return sources.map(s => ({
      key: s.key,
      kind: s.kind,
      id: s.id,
      approved: ok[s.key] === true,
      error: s.error,
      tools: s.tools.map(t => ({ name: t.name, description: t.description, confirm: t.confirm, kind: t.invoke.kind })),
    }));
  }

  // approve or withdraw a source; the tools follow at once
  function approve(key, on) {
    if (!sources.some(s => s.key === key)) return { error: 'no such source' };
    const next = Object.assign({}, approvals());
    if (on) next[key] = true;
    else delete next[key];
    if (ctx.settings && ctx.settings.set) ctx.settings.set({ approved: next });
    discover();
    return { ok: true, sources: sourceList() };
  }

  async function invoke(name, args, opts) {
    const e = index[name];
    if (!e) return failTool('unknown tool: ' + name);
    const t = e.tool;
    const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const bad = checkArgs(t.inputSchema, a);
    if (bad) return failTool(bad);
    if (t.confirm && !(opts && opts.confirmed === true))
      return failTool('needs confirmation: the person must say yes before ' + name + ' runs', { confirm: true });
    try {
      const inv = t.invoke;
      if (inv.kind === 'app') {
        if (!deps.luna) return failTool('launching an app needs the luna permission');
        const r = await deps.luna(
          'luna://com.webos.applicationManager/launch',
          { id: inv.id, params: interp(inv.params || {}, a) },
          { wait: 10000 }
        );
        return r && r.returnValue !== false
          ? text({ launched: true, id: inv.id })
          : failTool((r && r.errorText) || 'the app did not launch');
      }
      const method = String(inv.method || 'GET').toUpperCase();
      const body = inv.body !== undefined ? interp(inv.body, a) : undefined;
      if (inv.kind === 'addon') {
        if (!deps.fetch) return failTool('calling an add-on needs the network permission');
        const p = interp(inv.path, a, true);
        if (/\.\./.test(p)) return failTool('the path may not contain ..');
        const r = await deps.fetch.read(SERVICE_URL + '/api/addons/' + inv.addon + p, {
          method: method,
          headers: { 'content-type': 'application/json' },
          body: body,
          maxBytes: 1 << 20,
          idleMs: 30000,
          anyStatus: true,
          redirects: 0,
        });
        return text(parseReply(r));
      }
      // http: the host is the declaration's; check it again with the TV's address now known
      if (!deps.fetch) return failTool('calling an address needs the network permission');
      const u = interp(inv.url, a, true);
      if (isSelf(url.parse(u).hostname, deps.lanIp())) return failTool('an http tool may not call the TV itself');
      const r = await deps.fetch.read(u, {
        method: method,
        headers: noBreaks(interp(inv.headers || {}, a)),
        body: body,
        maxBytes: 1 << 20,
        idleMs: 30000,
        anyStatus: true,
        redirects: 0, // a redirect could point back at the TV
      });
      return text(parseReply(r));
    } catch (e2) {
      return failTool(String((e2 && e2.message) || e2));
    }
  }

  function reply(id, result) {
    return { jsonrpc: '2.0', id: id === undefined ? null : id, result: result };
  }
  function errReply(id, code, message) {
    return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code: code, message: message } };
  }

  // JSON-RPC from an MCP client: a confirm tool is never confirmed this way (the person says yes on the TV, through the voice assistant)
  async function rpc(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return errReply(msg && msg.id, -32600, 'invalid request');
    const method = msg.method;
    if (method === 'initialize')
      return reply(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'cleanyourtv-agent', version: '1.1.0' },
      });
    if (method === 'notifications/initialized') return undefined; // a notification: no reply
    if (method === 'ping') return reply(msg.id, {});
    if (method === 'tools/list') return reply(msg.id, { tools: list() });
    if (method === 'tools/call') {
      const p = msg.params && typeof msg.params === 'object' ? msg.params : {};
      const r = await invoke(p.name, p.arguments);
      return reply(msg.id, { content: r.content, isError: r.isError });
    }
    return errReply(msg.id, -32601, 'method not found');
  }

  discover();
  return {
    list,
    call: invoke,
    rpc,
    reload: discover,
    discover,
    sources: sourceList,
    approve,
    errors: () => errors.slice(),
  };
}

module.exports = {
  registry,
  cleanTool,
  cleanDeclaration,
  checkArgs,
  interp,
  isSelf,
  scanDir,
  readTools,
  NAME,
  KINDS,
  SERVICE_URL,
  MAX_PER_SOURCE,
};
