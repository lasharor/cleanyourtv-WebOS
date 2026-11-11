// The voice assistant as an agent (answers.js with llm.agent, coretools.js, the confirm turn in voice.js): a stand-in for OpenRouter
// that answers from a script, tool providers in memory, and the service's own tools against a stand-in of apps.js.
const http = require('http');
const { ok, call, serve, req, memoryConfig, run } = require('./lib');

run(async () => {
  // a free port for the network side (the TV's is 8802; helper/toolhub.js reads CYTV_MCP_PORT)
  const freePort = await new Promise(res => {
    const t = http.createServer().listen(0, '127.0.0.1', () => {
      const p = t.address().port;
      t.close(() => res(p));
    });
  });
  process.env.CYTV_MCP_PORT = String(freePort);
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
  ok((await A.askLlm('hi')).answer === 'Hello.' && sent[0].tools === undefined, 'with the switch off no tools are sent');

  // ---- the loop ----
  llm = Object.assign({}, llm, { agent: true });
  reset();
  script = [{ content: null, tool_calls: [tc('switch_input', { input: 'HDMI_1' })] }, { content: 'Switched to HDMI 1.' }];
  const seen = [];
  let a = (await A.askLlm('switch to hdmi 1', { onTool: n => seen.push(n) })).answer;
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
  a = (await A.askLlm('format')).answer;
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
  a = (await A.askLlm('switch to hdmi 2')).answer;
  ok(a === 'Plain answer.' && sent.length === 2 && sent[1].tools === undefined, 'a model without tools falls back to a plain question');

  reset();
  script = [{ content: '<tool_call>{"name":"x"}</tool_call>' }, { content: 'Plain again.' }];
  a = (await A.askLlm('hello')).answer;
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
  a = (await A.askLlm('turn off the tv')).answer;
  ok(/Say yes within 30 seconds/.test(a) && calls.length === 0, 'a destructive tool is not run: the TV asks first: ' + a);
  ok(A.pendingConfirm() && A.pendingConfirm().name === 'power_off', 'the call waits for the answer');
  ok((await A.confirmPending('no thanks')) === 'Okay, I did not do that.' && calls.length === 0, '"no" drops it');
  ok(A.pendingConfirm() === null && (await A.confirmPending('yes')) === null, 'after that nothing waits');
  script = [{ content: null, tool_calls: [tc('power_off', {})] }];
  await A.askLlm('turn off the tv');
  ok((await A.confirmPending('Yes please')) === 'Done.', '"yes" runs it');
  ok(calls.length === 1 && calls[0].name === 'power_off' && calls[0].opts.confirmed === true, 'with confirmed: true, without the model');
  for (const said of ["okay what's the weather", 'sure, why not', 'yes turn it up']) {
    script = [{ content: null, tool_calls: [tc('power_off', {})] }];
    await A.askLlm('turn off the tv');
    ok(
      (await A.confirmPending(said)) === 'Okay, I did not do that.' && calls.length === 1,
      'a yes with more after it is not a yes: ' + said
    );
  }
  script = [{ content: null, tool_calls: [tc('power_off', {})] }];
  await A.askLlm('turn off the tv');
  ok((await A.confirmPending('Okay.')) === 'Done.' && calls.length === 2, 'a plain "okay." is');

  // ---- with the AI providers (#208): every provider gets the tools, and a tool that ran is not done again by the next one ----
  const srv = { id: 'p1', type: 'server', base: ai.url, model: 'srv' },
    orp = { id: 'p2', type: 'openrouter', key: 'k', model: 'm' };
  llm = { enabled: true, agent: true, providers: [srv, orp] };
  reset();
  script = [{ content: 'From the server.' }];
  let r2 = await A.askLlm('hi');
  ok(
    r2.answer === 'From the server.' &&
      r2.via === 'p1' &&
      sent.length === 1 &&
      sent[0].model === 'srv' &&
      !!sent[0].tools &&
      sent[0].tools.length > 0 &&
      sent[0].reasoning === undefined,
    'a server of yours gets the tools (and not the OpenRouter-only reasoning option)'
  );
  llm = { enabled: true, agent: true, providers: [orp, srv] };
  reset();
  script = [
    { content: null, tool_calls: [tc('switch_input', { input: 'HDMI_1' })] },
    { status: 500, error: 'overloaded' },
  ];
  let e2 = null;
  try {
    await A.askLlm('switch to hdmi 1');
  } catch (e) {
    e2 = e;
  }
  ok(
    e2 && calls.length === 1 && sent.length === 2 && sent.every(x => x.model === 'm'),
    'after a tool ran, a failure is not handed to the next provider: the tool runs once'
  );
  reset();
  script = [{ status: 500, error: 'overloaded' }, { content: 'The server answers.' }];
  r2 = await A.askLlm('switch to hdmi 1');
  ok(
    r2.via === 'p1' && r2.answer === 'The server answers.' && !!sent[0].tools && !!sent[1].tools && calls.length === 0,
    'before any tool ran, the next provider answers, with the tools too'
  );
  // a server whose model takes no tools (Ollama: HTTP 400 "does not support tools") is asked again without them
  llm = { enabled: true, agent: true, providers: [srv, orp] };
  reset();
  script = [{ status: 400, error: 'registry.ollama.ai/library/x does not support tools' }, { content: 'Plain answer.' }];
  r2 = await A.askLlm('hi');
  ok(
    r2.via === 'p1' && r2.answer === 'Plain answer.' && sent.length === 2 && !!sent[0].tools && sent[1].tools === undefined,
    'a model that takes no tools is asked again without them'
  );
  // a provider type added later gets the tools too: askLlm decides nothing by the type of a provider
  ok(
    !/\.type|openrouter/.test(String(A.askLlm)),
    'askLlm does not look at the type of a provider: every provider, now or later, gets the tools'
  );
  llm = { enabled: true, key: 'k', model: 'm', agent: true };

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
  const ctx = {
    config: memoryConfig({}),
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
      .join() ===
      'list_apps,launch_app,list_inputs,switch_input,show_notification,get_current_app,list_running_apps,close_app,navigate,get_volume,tv_info,most_used_apps,get_weather,new_conversation,theme,remote_buttons,power_off',
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

  // ---- the tool settings hold for the voice assistant too (manager: AI agents (MCP) > Tools) ----
  {
    await call(hub, '/api/mcp/tools', 'GET');
    await call(hub, '/api/mcp/tools', 'POST', { key: 'apps.list_apps', on: false });
    A.init(() => ({ llm }), { tools: () => providers, merged: () => hub.merged() });
    reset();
    script = [{ content: null, tool_calls: [tc('list_apps', {})] }, { content: 'I cannot.' }];
    await A.askLlm('which apps do I have');
    const names2 = sent[0].tools.map(t => t.function.name);
    ok(
      names2.indexOf('list_apps') < 0 && names2.indexOf('launch_app') >= 0,
      'voice: a tool that is off on the TV is not offered to the model'
    );
    const tm2 = sent[1].messages.filter(m => m.role === 'tool')[0];
    ok(tm2 && /turned off on the TV/.test(tm2.content), 'voice: a call to it is refused as turned off: ' + (tm2 && tm2.content));
    await call(hub, '/api/mcp/tools', 'POST', { key: 'apps.list_apps', on: true });
    A.init(() => ({ llm }), { tools: () => providers, merged: null }); // back to the stand-ins (init keeps what it is not given)
    // the model's extra arguments are dropped before the tool runs
    reset();
    script = [{ content: null, tool_calls: [tc('switch_input', { input: 'HDMI_2', evil: 'rm -rf' })] }, { content: 'Done.' }];
    await A.askLlm('hdmi 2');
    ok(
      calls.length === 1 && JSON.stringify(calls[0].args) === '{"input":"HDMI_2"}',
      'voice: a tool gets only its declared arguments: ' + JSON.stringify(calls[0] && calls[0].args)
    );
  }

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

  // ---- MCP on the network: off until switched on; agents pair with a one-time code and get a token each ----
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
  const lanSet = b => call(hub, '/api/mcp/lan', 'POST', b);
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const bearer = t => ({ authorization: 'Bearer ' + t });

  r = await call(hub, '/api/mcp/lan', 'GET');
  ok(r.j.lan === false && r.j.listening === false && r.j.agents.length === 0, 'lan: off by default, no agents');
  ok(req('toolhub').PORT === 8802, 'lan: the TV uses port 8802');
  await hub.start();
  r = await lanSet({ lan: true });
  ok(r.j.lan === true && r.j.listening === false, 'lan: on, but nothing listens while no agent is paired and no code is shown');
  ok((await lan('POST', '/pair', { code: '1' })).code === 0, 'lan: the port is closed');
  ok(JSON.stringify(ctx.config.get().mcp).indexOf('token') < 0, 'lan: no shared token any more');

  // Connect an agent: the code
  r = await lanSet({ page: true });
  const code = r.j.code,
    pagePath = (/\/[a-z2-9]{8}$/.exec(r.j.pageUrl || '') || [''])[0],
    r0url = r.j.pageUrl;
  ok(/^\d{6}$/.test(code) && r.j.listening === true && r.j.pairing === true, 'lan: Connect an agent opens the port with a 6-digit code');
  r = await lan('GET', pagePath);
  ok(
    r.code === 200 &&
      r.text.indexOf(code) >= 0 &&
      /\/pair/.test(r.text) &&
      /Authorization: Bearer TOKEN/.test(r.text) &&
      /connected already/.test(r.text) &&
      /Bearer OLDTOKEN/.test(r.text) &&
      /Step 4\. Remember the connection/.test(r.text) &&
      /Never put the token in the note/.test(r.text) &&
      !/claude|cursor/i.test(r.text),
    'lan: the page has a prompt with the code, how to pair (always, with a new token) and how to add the server, naming no app'
  );
  ok(!/^<!doctype/i.test(r.text) && /^You can control my LG TV/.test(r.text), 'lan: an agent sent the link gets the prompt as plain text');
  const html = await lan('GET', pagePath, undefined, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' });
  ok(
    /^<!doctype/i.test(html.text) && /send your agent the address of this page/.test(html.text) && html.text.indexOf(code) >= 0,
    'lan: a browser gets the page, which says the link alone is enough'
  );
  ok(!/Bearer [0-9a-f]{8}\./.test(r.text), 'lan: the page holds no token');
  ok(
    /instructions/.test(r.text) && /disconnect_from_tv/.test(r.text) && !/Rules:/.test(r.text),
    'lan: the prompt only pairs and sets up; the rest comes from the server'
  );
  ok((await lan('GET', pagePath + '/status')).j.paired === null, 'lan: no agent yet');
  ok(/^http:\/\/[^/]+\/[a-z2-9]{8}$/.test(r0url), 'lan: the page address is short: the host, the port and 8 characters');
  ok((await lan('GET', '/zzzzzzzz')).code === 404, 'lan: a wrong page address is answered 404 (and counted as a wrong try)');

  // pairing
  ok((await lan('POST', '/pair', { code: '000000', name: 'x' })).code === 403, 'lan: a wrong code is refused');
  ok((await lan('POST', '/pair', { code, name: 'x' }, { origin: 'http://evil.example' })).code === 403, 'lan: a web page cannot pair');
  r = await lan('POST', '/pair', { code, name: 'Claude Code' });
  const tok = r.j.token;
  ok(
    r.code === 200 && /^[0-9a-f]{8}\.[0-9a-f]{32}$/.test(tok) && r.j.name === 'Claude Code',
    'lan: the code gives the agent a token of its own'
  );
  await new Promise(x => setImmediate(x));
  ok(
    shown.some(c => c.title === 'Claude Code connected' && /can now control the TV/.test(c.text)),
    'lan: the TV shows a card when an agent connects'
  );
  ok((await lan('POST', '/pair', { code, name: 'y' })).code === 403, 'lan: the code works once');
  r = await lan('GET', pagePath + '/status');
  ok(r.j.paired && r.j.paired.name === 'Claude Code' && r.j.used === false, 'lan: the page sees the agent paired');
  r = await call(hub, '/api/mcp/lan', 'GET');
  ok(
    r.j.paired && r.j.paired.name === 'Claude Code',
    'lan: the manager sees who paired with the code on screen (it closes the QR screen then)'
  );

  // using it
  ok((await lan('POST', '/mcp', list)).code === 401, 'lan: no token, no answer');
  ok((await lan('POST', '/mcp', list, bearer('00000000.00000000000000000000000000000000'))).code === 401, 'lan: a wrong token is refused');
  ok(
    (await lan('POST', '/mcp', list, Object.assign({ origin: 'http://evil.example' }, bearer(tok)))).code === 403,
    'lan: a web page cannot call it'
  );
  ok((await lan('GET', '/mcp', undefined, bearer(tok))).code === 405, 'lan: only POST');
  r = await lan('POST', '/mcp', list, bearer(tok));
  ok(r.code === 200 && r.j.result.tools.some(t => t.name === 'switch_input'), 'lan: tools/list answers with the token');
  ok(
    r.j.result.tools.some(t => t.name === 'disconnect_from_tv'),
    'lan: the network side offers disconnect_from_tv'
  );
  r = await lan('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, bearer(tok));
  const ins = (r.j.result && r.j.result.instructions) || '';
  ok(
    /401/.test(ins) && /403/.test(ins) && /disconnect_from_tv/.test(ins) && /refused from the network/.test(ins),
    'lan: initialize carries the rules as instructions'
  );
  r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  ok(r.result.instructions === undefined, 'mcp: the TV itself (/api/mcp) gets no network instructions');
  r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  ok(!r.result.tools.some(t => t.name === 'disconnect_from_tv'), 'mcp: and no disconnect_from_tv');
  ok((await lan('GET', pagePath + '/status')).j.used === true, 'lan: the page turns green once the agent used the tools');
  const pb = poweredOff;
  r = await lan('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'power_off', arguments: {} } }, bearer(tok));
  ok(r.j.result.isError === true && poweredOff === pb, 'lan: turning the TV off is never run from the network');
  const lb2 = launched.length;
  r = await lan(
    'POST',
    '/mcp',
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'launch_app', arguments: { id: 'netflix' } } },
    bearer(tok)
  );
  ok(r.j.result.isError === false && launched.length === lb2 + 1, 'lan: a tool runs');

  // the list, block, allow
  r = await call(hub, '/api/mcp/lan', 'GET');
  const ag = r.j.agents[0];
  ok(
    r.j.agents.length === 1 && ag.name === 'Claude Code' && ag.active === true && ag.blocked === false,
    'lan: the manager lists the agent, in use'
  );
  ok(r.j.expireDays === 14 && ag.removesIn > 13 * 864e5, 'lan: unused agents go after two weeks by default');
  await lanSet({ block: ag.id });
  ok((await lan('POST', '/mcp', list, bearer(tok))).code === 403, 'lan: a blocked agent is refused');
  await lanSet({ allow: ag.id });
  ok((await lan('POST', '/mcp', list, bearer(tok))).code === 200, 'lan: and allowed again');
  ok(
    (await lanSet({ expireDays: 5 })).code === 400 && (await lanSet({ expireDays: 3 })).j.expireDays === 3,
    'lan: the choices for unused agents'
  );
  ok((await lanSet({ remove: 'ffffffff' })).code === 400, 'lan: removing an unknown agent says so');

  // closing the code: the port stays while an agent is paired
  r = await lanSet({ pair: false });
  ok(r.j.pairing === false && r.j.listening === true, 'lan: Back closes the code; the port stays open for the paired agent');
  r = await lan('GET', pagePath + '/status');
  ok(
    r.code === 200 && r.j.paired.name === 'Claude Code' && r.j.used === true,
    'lan: a code that was used keeps its page, so the phone still shows Connected'
  );
  r = await lanSet({ page: true });
  const unused = (/\/[a-z2-9]{8}$/.exec(r.j.pageUrl || '') || [''])[0];
  ok(r.j.paired === null, 'lan: a new code has no agent yet');
  await lanSet({ pair: false });
  ok((await lan('GET', unused)).code !== 200, 'lan: an unused code closed with Back takes its page with it');

  // an agent that is connected already and pairs again with its token: told to keep its session; the QR screen still closes
  r = await lanSet({ page: true });
  r = await lan('POST', '/pair', { code: r.j.code, name: 'Other name' }, bearer(tok));
  ok(
    r.code === 200 && r.j.connected === true && !r.j.token && r.j.name === 'Claude Code' && /current session/.test(r.j.message),
    'lan: pairing with a token that works says it is connected already, with no new token'
  );
  await new Promise(x => setImmediate(x));
  ok(
    shown.some(c => c.title === 'Claude Code connected' && /was already connected/.test(c.text)),
    'lan: and the TV shows a card for it'
  );
  r = await call(hub, '/api/mcp/lan', 'GET');
  ok(r.j.agents.length === 1 && r.j.paired && r.j.paired.name === 'Claude Code', 'lan: no second entry, and the manager learns who it was');
  await lanSet({ pair: false });

  // a second agent, then logout and remove all
  r = await lanSet({ page: true });
  const t2 = (await lan('POST', '/pair', { code: r.j.code, name: 'Claude Code' })).j.token;
  r = await call(hub, '/api/mcp/lan', 'GET');
  ok(r.j.agents.length === 2 && r.j.agents.some(a => a.name === 'Claude Code 2'), 'lan: a second agent with the same name gets " 2"');
  r = await lan(
    'POST',
    '/mcp',
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'disconnect_from_tv', arguments: {} } },
    bearer(t2)
  );
  ok(r.j.result.isError === false && /Disconnected/.test(r.j.result.content[0].text), 'lan: an agent can disconnect itself with the tool');
  await new Promise(x => setImmediate(x));
  ok(
    shown.some(c => c.title === 'Claude Code 2 disconnected' && /can no longer control/.test(c.text)),
    'lan: the TV shows a card when an agent leaves'
  );
  ok((await lan('POST', '/logout', {}, bearer(t2))).code === 401, 'lan: and its token is gone (logout says 401)');
  ok(
    (await lan('POST', '/mcp', list, bearer(t2))).code === 401 && (await call(hub, '/api/mcp/lan', 'GET')).j.agents.length === 1,
    'lan: and is gone'
  );
  await lanSet({ pair: false });
  // logout: the same card
  shown.length = 0;
  r = await lan('POST', '/logout', {}, bearer(tok));
  await new Promise(x => setImmediate(x));
  ok(
    r.j.bye === true && shown.some(c => c.title === 'Claude Code disconnected' && /can no longer control/.test(c.text)),
    'lan: logout says bye, and the TV shows a card'
  );
  await lanSet({ pair: false });
  r = await lanSet({ removeAll: true });
  ok(r.j.agents.length === 0 && r.j.listening === false, 'lan: remove all: no agents, and the port closes');
  ok((await lan('POST', '/mcp', list, bearer(tok))).code !== 200, 'lan: the old token gets nothing');

  // the port held by another program: the reply says so
  const squat = http.createServer();
  await new Promise(x => squat.listen(freePort, '0.0.0.0', x));
  r = await lanSet({ page: true });
  ok(r.j.listening === false && /port \d+ is used by another program/.test(r.j.error) && !r.j.pageUrl, 'lan: a busy port is reported');
  await new Promise(x => squat.close(x));
  await lanSet({ pair: false });
  r = await lanSet({ lan: false });
  ok(r.j.lan === false && r.j.listening === false, 'lan: switched off');
  hub.stop();

  ai.server.close();
});
