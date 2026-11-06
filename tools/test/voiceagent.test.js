// The voice assistant as an agent (answers.js with llm.agent, coretools.js, the confirm turn in voice.js): a stand-in for OpenRouter
// that answers from a script, tool providers in memory, and the service's own tools against a stand-in of apps.js.
const http = require('http');
const { ok, call, serve, req, memoryConfig, run } = require('./lib');

run(async () => {
  // ---- OpenRouter: each request takes the next scripted reply; the requests are kept ----
  const sent = [];
  let script = [];
  const ai = await serve((q, r) => {
    let b = '';
    q.on('data', c => (b += c));
    q.on('end', () => {
      sent.push(JSON.parse(b));
      const next = script.length ? script.shift() : { content: 'Fine.' };
      const st = next.status || 200;
      r.writeHead(st, { 'content-type': 'application/json' });
      r.end(JSON.stringify(st === 200 ? { choices: [{ message: next }] } : { error: { message: next.error } }));
    });
  });
  process.env.CYTV_OPENROUTER = ai.url;
  const tc = (name, args, id) => ({ id: id || 'c_' + name, type: 'function', function: { name, arguments: JSON.stringify(args || {}) } });

  // ---- providers in memory ----
  const calls = [];
  const mkProvider = (id, tools) => ({
    id,
    name: id,
    tools: {
      list: () => tools,
      call: async (name, args, opts) => {
        calls.push({ id, name, args, opts });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, name }) }], isError: false };
      },
    },
  });
  const sw = {
    name: 'switch_input',
    description: 'Switch the input.',
    inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
  };
  const off = {
    name: 'power_off',
    description: 'Turn the TV off.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { destructiveHint: true },
  };
  let providers = [
    mkProvider('core', [sw, off]),
    mkProvider('spotify', [{ name: 'switch_input', description: 'Another.', inputSchema: {} }]),
  ];

  const A = req('answers');
  let llm = { enabled: true, key: 'k', model: 'm', agent: false };
  A.init(() => ({ llm }), { tools: () => providers });
  const reset = () => {
    A.forget();
    sent.length = 0;
    calls.length = 0;
  };

  // ---- switched off: today's request, no tools ----
  script = [{ content: 'Hello.' }];
  ok((await A.askLlm('hi')) === 'Hello.' && sent[0].tools === undefined, 'with the switch off no tools are sent');

  // ---- the loop ----
  llm = Object.assign({}, llm, { agent: true });
  reset();
  script = [{ content: null, tool_calls: [tc('switch_input', { input: 'HDMI_1' })] }, { content: 'Switched to HDMI 1.' }];
  const seen = [];
  let a = await A.askLlm('switch to hdmi 1', { onTool: n => seen.push(n) });
  ok(a === 'Switched to HDMI 1.', 'the final answer comes after the tool ran: ' + a);
  ok(
    sent[0].tools.length === 3 && sent[0].tool_choice === 'auto' && sent[0].tools[0].function.name === 'switch_input',
    'the tools go to OpenRouter as functions'
  );
  ok(sent[0].tools[2].function.name === 'spotify__switch_input', 'a name taken twice gets its provider in front');
  ok(!/no tools/.test(sent[0].messages[0].content), 'the instructions no longer say there are no tools');
  ok(calls.length === 1 && calls[0].id === 'core' && calls[0].args.input === 'HDMI_1', 'the tool ran with the arguments');
  ok(seen.join() === 'switch_input', 'the card is told which tool runs');
  const tm = sent[1].messages.filter(m => m.role === 'tool')[0];
  ok(tm && tm.tool_call_id === 'c_switch_input' && /"ok":true/.test(tm.content), 'the result goes back as a tool message');
  ok(
    sent[1].messages.some(m => m.role === 'assistant' && m.tool_calls),
    "the model's own tool calls are sent back with it"
  );

  reset();
  script = [{ content: null, tool_calls: [tc('spotify__switch_input', {})] }, { content: 'Done.' }];
  await A.askLlm('other one');
  ok(calls.length === 1 && calls[0].id === 'spotify' && calls[0].name === 'switch_input', 'a prefixed name calls its own provider');

  reset();
  script = [{ content: null, tool_calls: [tc('format_disk', {})] }, { content: 'I cannot.' }];
  a = await A.askLlm('format');
  ok(
    a === 'I cannot.' && calls.length === 0 && /no tool named/.test(sent[1].messages.filter(m => m.role === 'tool')[0].content),
    'an unknown tool is answered with an error for the model'
  );

  reset();
  script = [{ content: null, tool_calls: [tc('switch_input', {})] }, { content: 'Which input?' }];
  await A.askLlm('switch');
  ok(
    calls.length === 0 && /input is required/.test(sent[1].messages.filter(m => m.role === 'tool')[0].content),
    'missing arguments are refused'
  );

  reset();
  script = [{ status: 404, error: 'No endpoints found that support tool use' }, { content: 'Plain answer.' }];
  a = await A.askLlm('switch to hdmi 2');
  ok(a === 'Plain answer.' && sent.length === 2 && sent[1].tools === undefined, 'a model without tools falls back to a plain question');

  reset();
  script = [{ content: '<tool_call>{"name":"x"}</tool_call>' }, { content: 'Plain again.' }];
  a = await A.askLlm('hello');
  ok(a === 'Plain again.' && sent[1].tools === undefined, 'a tool call written as text falls back too');

  reset();
  script = [1, 2, 3, 4, 5, 6].map(i => ({ content: null, tool_calls: [tc('switch_input', { input: 'HDMI_' + i }, 'c' + i)] }));
  let err = '';
  try {
    await A.askLlm('loop');
  } catch (e) {
    err = e.message;
  }
  ok(/too many tools/.test(err) && sent.length === 5, 'the loop stops after five rounds');

  // ---- confirm ----
  reset();
  script = [{ content: null, tool_calls: [tc('power_off', {})] }];
  a = await A.askLlm('turn off the tv');
  ok(/Say yes within 30 seconds/.test(a) && calls.length === 0, 'a destructive tool is not run: the TV asks first: ' + a);
  ok(A.pendingConfirm() && A.pendingConfirm().name === 'power_off', 'the call waits for the answer');
  ok((await A.confirmPending('no thanks')) === 'Okay, I did not do that.' && calls.length === 0, '"no" drops it');
  ok(A.pendingConfirm() === null && (await A.confirmPending('yes')) === null, 'after that nothing waits');
  script = [{ content: null, tool_calls: [tc('power_off', {})] }];
  await A.askLlm('turn off the tv');
  ok((await A.confirmPending('Yes please')) === 'Done.', '"yes" runs it');
  ok(calls.length === 1 && calls[0].name === 'power_off' && calls[0].opts.confirmed === true, 'with confirmed: true, without the model');

  // ---- the service's own tools ----
  const launched = [];
  let poweredOff = 0;
  const apps = {
    listApps: async () => [
      { id: 'youtube.leanback.v4', title: 'YouTube' },
      { id: 'netflix', title: 'Netflix' },
      { id: 'com.webos.app.hdmi1', title: 'PlayStation', input: 1 },
    ],
    inputs: async () => ({
      devices: [
        { id: 'HDMI_1', appId: 'com.webos.app.hdmi1', label: 'PlayStation', port: 1, hdmiPlugIn: true },
        { id: 'HDMI_2', appId: 'com.webos.app.hdmi2', label: 'HDMI 2', port: 2, hdmiPlugIn: false },
      ],
    }),
    launch: async id => {
      launched.push(id);
      return { returnValue: true };
    },
    powerOff: () => {
      poweredOff++;
      return { returnValue: true };
    },
  };
  const shown = [];
  // an add-on that provides tools, as the loader hands it over
  const addonTools = mkProvider('demo', [
    { name: 'demo_hello', description: 'Say hello.', inputSchema: {} },
    { name: 'launch_app', description: 'A name the service has too.', inputSchema: {} },
  ]).tools;
  let hub = null;
  const freePort = await new Promise(res => {
    const t = http.createServer().listen(0, '127.0.0.1', () => {
      const p = t.address().port;
      t.close(() => res(p));
    });
  });
  const ctx = {
    config: memoryConfig({ mcp: { port: freePort } }),
    version: '9.9.9',
    feature: n =>
      n === 'apps'
        ? apps
        : n === 'addons'
          ? { providers: w => (w === 'tools' ? [{ id: 'demo', name: 'Demo', mod: { tools: addonTools } }] : []) }
          : n === 'mcp'
            ? hub
            : null,
    notify: { show: async o => shown.push(o) },
  };
  hub = req('toolhub').create(ctx);
  const C = req('coretools').create(ctx).tools;
  const txt = r => r.content[0].text;
  ok(
    C.list()
      .map(t => t.name)
      .join() === 'list_apps,launch_app,list_inputs,switch_input,show_notification,power_off',
    'the core tools'
  );
  let r = await C.call('list_apps', { query: 'tube' });
  ok(JSON.parse(txt(r)).length === 1 && /youtube/.test(txt(r)), 'list_apps filters by name and leaves inputs out');
  await C.call('switch_input', { input: '2' });
  await C.call('switch_input', { input: 'playstation' });
  await C.call('switch_input', { input: 'hdmi 1' });
  ok(launched.join() === 'com.webos.app.hdmi2,com.webos.app.hdmi1,com.webos.app.hdmi1', 'switch_input finds a port by number, name or id');
  r = await C.call('switch_input', { input: 'xbox' });
  ok(r.isError && /PlayStation/.test(txt(r)), 'an unknown input lists the ones there are');
  r = await C.call('launch_app', { id: 'netflix' });
  ok(!r.isError && launched[launched.length - 1] === 'netflix', 'launch_app opens the app');
  r = await C.call('show_notification', { title: 'Hi', text: 'There' });
  ok(!r.isError && shown[0].title === 'Hi', 'show_notification shows a card');
  r = await C.call('power_off', {});
  ok(r.isError && r.confirm && poweredOff === 0, 'power_off does not run without the yes');
  r = await C.call('power_off', {}, { confirmed: true });
  ok(!r.isError && poweredOff === 1, 'and runs with it');

  // ---- /api/mcp: the same tools for any MCP client on the TV ----
  const rpc = async b => (await call(hub, '/api/mcp', 'POST', b)).j;
  r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  ok(r.result.serverInfo.name === 'cleanyourtv' && r.result.capabilities.tools, 'mcp: initialize');
  r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = r.result.tools.map(t => t.name);
  ok(
    names.indexOf('switch_input') >= 0 && names.indexOf('demo_hello') >= 0 && names.indexOf('demo__launch_app') >= 0,
    "mcp: tools/list has the service's tools and the add-ons', a name taken twice prefixed: " + names.join()
  );
  ok(r.result.tools.filter(t => t.name === 'power_off')[0].annotations.destructiveHint === true, 'mcp: power_off is marked destructive');
  calls.length = 0;
  r = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'demo_hello', arguments: {} } });
  ok(r.result.isError === false && calls[0].id === 'demo', "mcp: tools/call runs an add-on's tool");
  const lb = launched.length;
  r = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'launch_app', arguments: { id: 'netflix' } } });
  ok(r.result.isError === false && launched.length === lb + 1, "mcp: and the service's own");
  r = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'launch_app', arguments: {} } });
  ok(r.result.isError === true && /id is required/.test(r.result.content[0].text), 'mcp: the arguments are checked');
  const po = poweredOff;
  r = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'power_off', arguments: {} } });
  ok(r.result.isError === true && poweredOff === po, 'mcp: a destructive tool never runs from here');
  r = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } });
  ok(r.result.isError === true && /unknown tool/.test(r.result.content[0].text), 'mcp: an unknown tool is an error result');
  r = await rpc({ jsonrpc: '2.0', id: 8, method: 'resources/list' });
  ok(r.error && r.error.code === -32601, 'mcp: an unknown method is a JSON-RPC error');
  r = await call(hub, '/api/mcp', 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' });
  ok(r.code === 202, 'mcp: a notification gets 202 and no body');
  r = await call(hub, '/api/mcp', 'GET');
  ok(r.code === 405, 'mcp: only POST');

  // ---- through voice.js: the confirm turn ----
  const cards = [];
  const v = req('voice').create({
    config: memoryConfig({ voice: { llm: { enabled: true, key: 'k', model: 'm', agent: true } } }),
    notify: { show: async o => cards.push(o) },
    feature: ctx.feature,
  });
  const vask = (act, body) => call(v, '/api/voice/' + act, 'POST', body);
  sent.length = 0;
  script = [{ content: null, tool_calls: [tc('power_off', {})] }];
  r = await vask('ask', { text: 'turn the tv off' });
  ok(r.j.via === 'ai' && /Say yes/.test(r.j.answer) && poweredOff === 1, 'voice: the TV asks before turning off');
  ok(
    sent[0].tools.some(t => t.function.name === 'switch_input'),
    "voice: the service's own tools are offered"
  );
  ok(cards[cards.length - 1].title === 'Confirm' && cards[cards.length - 1].seconds === 30, 'voice: the card asks for 30 seconds');
  const before = sent.length;
  r = await vask('ask', { text: 'yes' });
  ok(r.j.answer === 'Done.' && poweredOff === 2 && sent.length === before, 'voice: "yes" turns it off without asking the model');
  r = await call(v, '/api/voice/status', 'GET');
  ok(r.j.llm.agent === true, 'voice: the status says whether the AI may act');
  r = await vask('set', { llm: { agent: false } });
  ok(r.j.llm.agent === false, 'voice: the switch can be turned off');

  // ---- MCP on the network: off until switched on, a token, no web pages, no destructive tools ----
  const lan = (method, p, body, headers) =>
    new Promise(resolve => {
      const q = http.request(
        {
          host: '127.0.0.1',
          port: freePort,
          path: p,
          method,
          headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
        },
        rs => {
          let b = '';
          rs.on('data', c => (b += c));
          rs.on('end', () => {
            let j = null;
            try {
              j = JSON.parse(b);
            } catch (_) {}
            resolve({ code: rs.statusCode, j, text: b });
          });
        }
      );
      q.on('error', e => resolve({ code: 0, error: e.code }));
      q.end(body === undefined ? undefined : JSON.stringify(body));
    });
  r = await call(hub, '/api/mcp/lan', 'GET');
  ok(r.j.lan === false && r.j.listening === false, 'lan: off by default');
  hub.start();
  ok((await lan('POST', '/mcp', {})).code === 0, 'lan: nothing listens while it is off');
  r = await call(hub, '/api/mcp/lan', 'POST', { lan: true });
  const token = r.j.token;
  ok(r.j.lan === true && /^[0-9a-f]{48}$/.test(token) && r.j.port === freePort, 'lan: switching it on makes a token');
  ok(ctx.config.get().mcp.lan === true, 'lan: the setting is kept in config.json (mcp)');
  await new Promise(x => setTimeout(x, 50));
  const auth = { authorization: 'Bearer ' + token };
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  ok((await lan('POST', '/mcp', list)).code === 401, 'lan: no token, no answer');
  ok((await lan('POST', '/mcp', list, { authorization: 'Bearer nope' })).code === 401, 'lan: a wrong token is refused');
  ok(
    (await lan('POST', '/mcp', list, Object.assign({ origin: 'http://evil.example' }, auth))).code === 403,
    'lan: a web page cannot call it'
  );
  ok((await lan('GET', '/mcp', undefined, auth)).code === 405, 'lan: only POST');
  r = await lan('POST', '/mcp', list, auth);
  ok(r.code === 200 && r.j.result.tools.some(t => t.name === 'switch_input'), 'lan: tools/list answers with the token');
  const pb = poweredOff;
  r = await lan('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'power_off', arguments: {} } }, auth);
  ok(r.j.result.isError === true && poweredOff === pb, 'lan: turning the TV off is never run from the network');
  const lb2 = launched.length;
  r = await lan(
    'POST',
    '/mcp',
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'launch_app', arguments: { id: 'netflix' } } },
    auth
  );
  ok(r.j.result.isError === false && launched.length === lb2 + 1, 'lan: a tool runs');
  r = await call(hub, '/api/mcp/lan', 'POST', { page: true });
  const pagePath = (/\/t\/[0-9a-f]+$/.exec(r.j.pageUrl || '') || [''])[0];
  r = await lan('GET', pagePath);
  ok(pagePath && r.code === 200 && r.text.indexOf(token) >= 0, 'lan: the page behind the QR code shows the token');
  r = await call(hub, '/api/mcp/lan', 'POST', { regenerate: true });
  ok(r.j.token !== token && (await lan('POST', '/mcp', list, auth)).code === 401, 'lan: a new token ends the old one');
  r = await call(hub, '/api/mcp/lan', 'POST', { lan: false });
  await new Promise(x => setTimeout(x, 50));
  ok(
    r.j.lan === false && (await lan('POST', '/mcp', list, { authorization: 'Bearer ' + r.j.token })).code === 0,
    'lan: switched off, the port closes'
  );
  hub.stop();

  ai.server.close();
});
