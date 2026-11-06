// The agent add-on (addons/catalog/agent): the tool scheme, discovery, the MCP registry and the service's endpoints. Fixture
// tools.json files in temporary app, add-on and registration folders are read; the tools are listed and called (a launch through
// a stub luna, an add-on call and an address through local stand-in servers), and the JSON-RPC surface is checked.
const fs = require('fs'),
  path = require('path');
const { root, ok, fake, serve, req, run, tmp } = require('./lib');

run(async () => {
  process.env.CYTV_ADDONS = path.join(tmp, 'addons');
  process.env.CYTV_ADDONS_BUNDLED = path.join(tmp, 'bundled');
  process.env.CYTV_ADDON_DATA = path.join(tmp, 'addon-data');
  process.env.CYTV_APPS = path.join(tmp, 'apps');
  const nc = req('netcompat');
  const mk = p => nc.mkdirp(p);
  const writeJson = (file, obj) => {
    mk(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  };

  // ---- stand-ins: the "other add-on" the addon kind calls, and an external service the http kind calls ----
  let addonHits = [];
  const addonSrv = await serve((q, res) => {
    let b = '';
    q.on('data', c => (b += c));
    q.on('end', () => {
      addonHits.push({ method: q.method, url: q.url, body: b });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, method: q.method, url: q.url, body: b }));
    });
  });
  let extHits = [];
  const extSrv = await serve((q, res) => {
    extHits.push({ method: q.method, url: q.url });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ temp: 22, unit: 'c' }));
  });
  process.env.CYTV_AGENT_SERVICE_URL = addonSrv.url; // before tools.js is required: SERVICE_URL is read once

  const M = require(path.join(root, 'addons', 'catalog', 'agent', 'tools.js'));
  const S = require(path.join(root, 'addons', 'catalog', 'agent', 'service.js'));

  // ---- the scheme ----
  ok(M.cleanTool({}).error, 'an empty tool is refused');
  ok(
    M.cleanTool({ name: 'ok_name', description: 'd', inputSchema: {}, invoke: { kind: 'app', id: 'com.x.y' } }).tool.name === 'ok_name',
    'a valid app tool is accepted'
  );
  ok(
    !M.cleanTool({ name: '9bad', description: 'd', inputSchema: {}, invoke: { kind: 'app', id: 'x' } }).tool,
    'a name cannot start with a digit'
  );
  ok(M.cleanTool({ name: 'a', description: 'd', inputSchema: {}, invoke: { kind: 'nope' } }).error, 'an unknown invoke kind is refused');
  ok(M.cleanTool({ name: 'a', description: 'd', inputSchema: {}, invoke: { kind: 'app' } }).error, 'an app tool without an id is refused');
  ok(
    M.cleanTool({ name: 'a', description: 'd', inputSchema: { type: 'array' }, invoke: { kind: 'app', id: 'x' } }).error,
    'a non-object schema is refused'
  );
  ok(
    M.cleanTool({ name: 'a', description: 'd', inputSchema: {}, invoke: { kind: 'addon', addon: 'demo', path: '/y' } }).tool,
    'an addon tool needs only the add-on id and a path'
  );
  ok(
    M.cleanTool({ name: 'a', description: 'd', inputSchema: {}, invoke: { kind: 'http', url: 'ftp://x' } }).error,
    'an http tool needs an http(s) address'
  );
  ok(M.interp('{x}', { x: 42 }) === 42, 'an exact {arg} keeps its type (number)');
  ok(M.interp('go to {x}', { x: 'hdmi1' }) === 'go to hdmi1', 'a {arg} inside a string is replaced as text');
  ok(M.interp({ a: '{a}', b: 'x' }, { a: true }).a === true, 'object values are replaced');
  ok(M.interp('{missing}', {}) === '{missing}', 'a missing argument is left alone');

  // ---- fixtures: what the apps and add-ons sign ----
  writeJson(path.join(tmp, 'apps', 'com.example.demo', 'tools.json'), {
    tools: [
      {
        name: 'open_app',
        description: 'Open the demo app.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: [] },
        invoke: { kind: 'app', id: 'com.example.demo', params: { contentId: '{id}' } },
      },
      {
        name: 'tv_off',
        description: 'Turn the TV off.',
        inputSchema: {},
        confirm: true,
        invoke: { kind: 'app', id: 'com.webos.app.poweroff' },
      },
    ],
  });
  writeJson(path.join(tmp, 'addons', 'demo', 'tools.json'), {
    tools: [
      { name: 'demo_hello', description: 'Say hello.', inputSchema: {}, invoke: { kind: 'addon', addon: 'demo', path: '/hello' } },
      {
        name: 'demo_greet',
        description: 'Greet a name.',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        invoke: { kind: 'addon', addon: 'demo', path: '/greet', method: 'POST', body: { name: '{name}' } },
      },
    ],
  });
  writeJson(path.join(tmp, 'addon-data', 'agent', 'tools', 'weather.json'), {
    tools: [
      {
        name: 'weather_now',
        description: 'Weather for a city.',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: [] },
        invoke: { kind: 'http', url: extSrv.url + '/weather?city={city}' },
      },
    ],
  });
  writeJson(path.join(tmp, 'addon-data', 'agent', 'tools', 'dup.json'), {
    tools: [{ name: 'demo_hello', description: 'Duplicate.', inputSchema: {}, invoke: { kind: 'app', id: 'com.other' } }],
  });

  // ---- the registry ----
  let launched = [];
  const ctx = {
    id: 'agent',
    dir: path.join(tmp, 'addons', 'agent'),
    dataDir: path.join(tmp, 'addon-data', 'agent'),
    log: () => {},
    fetch: req('fetch'),
    luna: async (uri, payload) => {
      launched.push({ uri: uri, payload: payload });
      return { returnValue: true };
    },
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => '', wallpaperSize: () => '4k' },
    settings: { get: () => ({}), set: () => {} },
  };
  const reg = M.registry(ctx);
  const r = reg.reload();
  ok(r.count === 5, 'five tools discovered: ' + JSON.stringify(reg.list().map(t => t.name)));
  ok(
    reg
      .list()
      .map(t => t.name)
      .join() === 'demo_greet,demo_hello,open_app,tv_off,weather_now',
    'the tools are the ones the fixtures signed, sorted'
  );
  const off = reg.list().filter(t => t.name === 'tv_off')[0];
  ok(off && off.annotations && off.annotations.destructiveHint === true, 'a confirm tool is marked destructive');
  ok(/declared twice/.test(reg.errors().join()), 'a name declared twice is reported');

  // ---- JSON-RPC ----
  const init = await reg.rpc({ jsonrpc: '2.0', id: 2, method: 'initialize' });
  ok(
    init.result.serverInfo.name === 'cleanyourtv-agent' && init.result.capabilities.tools,
    'initialize answers the server and the tools capability'
  );
  const lr = await reg.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  ok(lr.id === 1 && lr.result.tools.length === 5, 'tools/list answers the registry');
  ok((await reg.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })) === undefined, 'a notification gets no reply');
  const mf = await reg.rpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
  ok(mf.error && mf.error.code === -32601, 'an unknown method is a JSON-RPC error');

  // ---- calling the tools ----
  const a = await reg.call('open_app', { id: 'x9' });
  ok(
    a.isError === false &&
      launched.length === 1 &&
      launched[0].payload.id === 'com.example.demo' &&
      launched[0].payload.params.contentId === 'x9',
    'an app tool launches the app with its bound parameter'
  );
  const hello = await reg.call('demo_hello', {});
  ok(/\"ok\":true/.test(hello.content[0].text), 'an addon tool calls the add-on: ' + hello.content[0].text);
  const greet = await reg.call('demo_greet', { name: 'Ada' });
  const gHit = addonHits.filter(h => h.url === '/api/addons/demo/greet')[0];
  ok(
    greet.isError === false && gHit && gHit.method === 'POST' && JSON.parse(gHit.body).name === 'Ada',
    'an addon tool posts the bound arguments'
  );
  const w = await reg.call('weather_now', { city: 'Berlin' });
  ok(/\"temp\":22/.test(w.content[0].text) && extHits[0].url === '/weather?city=Berlin', 'an http tool calls the address');
  const tr = await reg.rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'demo_hello', arguments: {} } });
  ok(tr.id === 3 && tr.result.content && tr.result.content[0].type === 'text', 'tools/call answers with MCP content');
  const u = await reg.call('nope', {});
  ok(u.isError === true && /unknown tool/.test(u.content[0].text), 'an unknown tool is an error');

  // ---- the service's endpoints ----
  const mod = S.create(ctx);
  const x = fake('/mcp', 'POST');
  await mod.handle(x.req, x.res, '/mcp', async () => ({ jsonrpc: '2.0', id: 7, method: 'tools/list' }));
  const mx = JSON.parse(x.res.out);
  ok(mx.id === 7 && mx.result.tools.length === 5, 'the service answers /mcp with tools/list');
  const y = fake('/tools', 'GET');
  await mod.handle(y.req, y.res, '/tools', async () => ({}));
  ok(JSON.parse(y.res.out).tools.length === 5, 'GET /tools lists them without JSON-RPC');
  const z = fake('/nope', 'GET');
  await mod.handle(z.req, z.res, '/nope', async () => ({}));
  ok(z.res.code === 404, 'anything else is 404');

  // ---- the manifest ----
  const addons = req('addons');
  const man = JSON.parse(fs.readFileSync(path.join(root, 'addons', 'catalog', 'agent', 'addon.json'), 'utf8'));
  const chk = addons.check(man, '1.6.17');
  ok(
    chk.manifest &&
      chk.manifest.permissions.join() === 'net.fetch,luna' &&
      chk.manifest.luna.length === 1 &&
      chk.manifest.entry.service === 'service.js',
    'the manifest is accepted and asks for the network and one luna call'
  );
  ok(addons.check(man, '1.6.16').error, 'it needs the current service version');

  addonSrv.server.close();
  extSrv.server.close();
});
