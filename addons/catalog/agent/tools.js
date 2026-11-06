// The tool scheme, discovery, registry and invocation of the agent add-on (addons/catalog/agent). The add-on knows no app
// or add-on by name. Instead it reads small declarations that the installed apps and add-ons sign: a tools.json in the app's
// or add-on's folder, or one dropped into the add-on's registration directory. A declaration is
//
//   { "tools": [ { "name", "description", "inputSchema", "confirm"?, "invoke" } ] }
//
// and a tool's "invoke" names how to run it (see README.md). The registry turns the declarations into MCP tools (list and
// call over JSON-RPC 2.0), so the voice assistant or any MCP client can use them.
//
// Node 8.12 (webOS 5/6): no optional chaining, no nullish coalescing, no object spread, no fs.promises.
'use strict';
const fs = require('fs');
const path = require('path');

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/; // a tool name: a letter, then letters, digits, _ and -
const KINDS = ['app', 'addon', 'http'];
const SERVICE_URL = process.env.CYTV_AGENT_SERVICE_URL || 'http://127.0.0.1:8765'; // where the add-on kind calls another add-on

const has = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// replace {arg} in a declaration value with the tool argument; a value that is exactly "{arg}" keeps the argument's type
function interp(v, args) {
  if (typeof v === 'string') {
    const one = /^\{([A-Za-z0-9_]+)\}$/.exec(v);
    if (one) return has(args, one[1]) ? args[one[1]] : v;
    return v.replace(/\{([A-Za-z0-9_]+)\}/g, (all, k) => (has(args, k) ? String(args[k]) : all));
  }
  if (Array.isArray(v)) return v.map(x => interp(x, args));
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => {
      o[k] = interp(v[k], args);
    });
    return o;
  }
  return v;
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
  if (t.confirm !== undefined && typeof t.confirm !== 'boolean') return err('confirm must be true or false');
  const inv = t.invoke;
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) return err('a tool needs an invoke object');
  if (KINDS.indexOf(inv.kind) < 0) return err('invoke.kind must be app, addon or http');
  if (inv.kind === 'app') {
    if (typeof inv.id !== 'string' || !/^[\w.-]{2,80}$/.test(inv.id)) return err("an app tool needs invoke.id, the app's id");
  } else if (inv.kind === 'addon') {
    if (typeof inv.addon !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(inv.addon))
      return err("an addon tool needs invoke.addon, the add-on's id");
    if (typeof inv.path !== 'string' || inv.path.charAt(0) !== '/') return err('an addon tool needs invoke.path starting with /');
  } else if (inv.kind === 'http') {
    if (typeof inv.url !== 'string' || !/^https?:\/\/[^\s]+$/.test(inv.url))
      return err('an http tool needs invoke.url starting with http:// or https://');
  }
  return {
    tool: {
      name: String(t.name),
      description: String(t.description).trim(),
      inputSchema: {
        type: 'object',
        properties: s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties) ? s.properties : {},
        required: Array.isArray(s.required) ? s.required.filter(x => typeof x === 'string') : [],
      },
      confirm: t.confirm === true,
      invoke: inv,
    },
  };
}

// a tools.json -> {tools} or {error}
function cleanDeclaration(doc, source) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    return { error: (source ? source + ': ' : '') + 'a tools.json must be an object' };
  if (!Array.isArray(doc.tools)) return { error: (source ? source + ': ' : '') + 'a tools.json needs a "tools" list' };
  const tools = [];
  for (let i = 0; i < doc.tools.length; i++) {
    const r = cleanTool(doc.tools[i], source);
    if (r.error) return r;
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

// each subfolder of dir that holds a tools.json contributes its tools; a bad file is collected, not fatal
function scanDir(dir, out) {
  let names;
  try {
    names = fs.readdirSync(dir).sort();
  } catch (_) {
    return out;
  }
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (n.charAt(0) === '.') continue;
    const p = path.join(dir, n);
    let isDir = false;
    try {
      isDir = fs.statSync(p).isDirectory();
    } catch (_) {}
    if (!isDir) continue;
    const f = path.join(p, 'tools.json');
    if (!fs.existsSync(f)) continue;
    const r = readTools(f);
    if (r.error) out.errors.push(r.error);
    else out.tools.push({ source: f, tools: r.tools });
  }
  return out;
}

function text(v) {
  return { content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }], isError: false };
}
function failTool(m) {
  return { content: [{ type: 'text', text: String(m) }], isError: true };
}
// an add-on's or an address's reply: JSON when it parses, its text otherwise
function parseReply(r) {
  const body = r && r.body ? r.body.toString('utf8') : '';
  try {
    return { status: r && r.status, json: JSON.parse(body) };
  } catch (_) {
    return { status: r && r.status, text: body.slice(0, 4000) };
  }
}

function registry(ctx) {
  const D = process.env.CYTV_DIR || '/media/developer/cleanyourtv';
  const roots = {
    bundled: process.env.CYTV_ADDONS_BUNDLED || D + '/addons-bundled',
    addons: process.env.CYTV_ADDONS || D + '/addons',
    apps: process.env.CYTV_APPS || '/media/developer/apps/usr/palm/applications',
    sysapps: '/usr/palm/applications',
  };
  const registrationDir = path.join(process.env.CYTV_ADDON_DATA || D + '/addon-data', 'agent', 'tools');
  const deps = {
    luna: ctx && ctx.luna ? ctx.luna : null,
    fetch: ctx && ctx.fetch ? ctx.fetch : null,
    log: ctx && ctx.log ? ctx.log : () => {},
  };

  let index = {}; // name -> {tool, source}
  let errors = [];

  function add(name, tool, source) {
    if (index[name]) {
      errors.push('tool ' + name + ' is declared twice (' + index[name].source + ' and ' + source + '); the first is kept');
      return;
    }
    index[name] = { tool: tool, source: source };
  }

  function discover() {
    index = {};
    errors = [];
    const found = { tools: [], errors: [] };
    scanDir(roots.bundled, found);
    scanDir(roots.addons, found);
    scanDir(roots.apps, found);
    scanDir(roots.sysapps, found);
    let regs = [];
    try {
      regs = fs.readdirSync(registrationDir).sort();
    } catch (_) {}
    for (let i = 0; i < regs.length; i++) {
      if (!/\.json$/.test(regs[i])) continue;
      const r = readTools(path.join(registrationDir, regs[i]));
      if (r.error) found.errors.push(r.error);
      else found.tools.push({ source: path.join(registrationDir, regs[i]), tools: r.tools });
    }
    for (let i = 0; i < found.tools.length; i++)
      for (let j = 0; j < found.tools[i].tools.length; j++)
        add(found.tools[i].tools[j].name, found.tools[i].tools[j], found.tools[i].source);
    errors = errors.concat(found.errors);
    return { count: Object.keys(index).length, errors: errors.slice() };
  }

  // the tools as MCP lists them: name, description, inputSchema, and destructiveHint for the ones that ask to confirm
  function list() {
    const out = [];
    Object.keys(index)
      .sort()
      .forEach(name => {
        const t = index[name].tool;
        const m = { name: name, description: t.description, inputSchema: t.inputSchema };
        if (t.confirm) m.annotations = { destructiveHint: true };
        out.push(m);
      });
    return out;
  }

  async function invoke(name, args) {
    const e = index[name];
    if (!e) return failTool('unknown tool: ' + name);
    const t = e.tool;
    const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    try {
      const inv = t.invoke;
      if (inv.kind === 'app') {
        if (!deps.luna) return failTool('launching an app needs the luna permission');
        const id = interp(inv.id, a);
        const params = interp(inv.params || {}, a);
        const r = await deps.luna('luna://com.webos.applicationManager/launch', { id: id, params: params }, { wait: 10000 });
        return r && r.returnValue !== false ? text({ launched: true, id: id }) : failTool((r && r.errorText) || 'the app did not launch');
      }
      if (inv.kind === 'addon') {
        if (!deps.fetch) return failTool('calling an add-on needs the network permission');
        const id = interp(inv.addon, a);
        const p = interp(inv.path, a);
        const method = String(inv.method || 'GET').toUpperCase();
        const body = inv.body !== undefined ? interp(inv.body, a) : undefined;
        const r = await deps.fetch.read(SERVICE_URL + '/api/addons/' + id + p, {
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
      // http
      if (!deps.fetch) return failTool('calling an address needs the network permission');
      const url = interp(inv.url, a);
      const method = String(inv.method || 'GET').toUpperCase();
      const headers = interp(inv.headers || {}, a);
      const body = inv.body !== undefined ? interp(inv.body, a) : undefined;
      const r = await deps.fetch.read(url, {
        method: method,
        headers: headers,
        body: body,
        maxBytes: 1 << 20,
        idleMs: 30000,
        anyStatus: true,
        redirects: 3,
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

  async function rpc(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return errReply(msg && msg.id, -32600, 'invalid request');
    const method = msg.method;
    if (method === 'initialize')
      return reply(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'cleanyourtv-agent', version: '1.0.0' },
      });
    if (method === 'notifications/initialized') return undefined; // a notification: no reply
    if (method === 'ping') return reply(msg.id, {});
    if (method === 'tools/list') return reply(msg.id, { tools: list() });
    if (method === 'tools/call') {
      const p = msg.params && typeof msg.params === 'object' ? msg.params : {};
      return reply(msg.id, await invoke(p.name, p.arguments));
    }
    return errReply(msg.id, -32601, 'method not found');
  }

  discover();
  return { list, call: invoke, rpc, reload: discover, discover, errors: () => errors.slice() };
}

module.exports = { registry, cleanTool, cleanDeclaration, interp, scanDir, readTools, NAME, KINDS, SERVICE_URL };
