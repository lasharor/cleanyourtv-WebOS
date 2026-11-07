// Voice answers (voice.js, answers.js): Home Assistant (Assist) and the AI providers with fallback, against local stand-ins.
const { ok, call, serve, req, memoryConfig, run, sleep } = require('./lib');

run(async () => {
  const haLog = [],
    TOKEN = 'secret-ha-token-123';
  const ha = await serve((q, r) => {
    let b = '';
    q.on('data', c => (b += c));
    q.on('end', () => {
      const send = (c, o) => {
        r.writeHead(c, { 'content-type': 'application/json' });
        r.end(JSON.stringify(o));
      };
      if (q.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { message: '401: Unauthorized' });
      if (q.url === '/api/config') return send(200, { location_name: 'Home', version: '2026.10.0' });
      if (q.url === '/api/states')
        return send(200, [
          { entity_id: 'light.x', attributes: {} },
          { entity_id: 'conversation.home_assistant', attributes: { friendly_name: 'Home Assistant' } },
          { entity_id: 'conversation.llm', attributes: {} },
        ]);
      if (q.url !== '/api/conversation/process') return send(404, {});
      const o = JSON.parse(b);
      haLog.push(o);
      const reply = (type, speech, code) =>
        send(200, {
          conversation_id: 'conv-1',
          response: { response_type: type, data: code ? { code } : {}, speech: { plain: { speech } } },
        });
      if (o.text === 'turn on the light') return reply('action_done', 'Turned on the light');
      if (o.text === 'quiet') return reply('action_done', '');
      if (o.text === 'slow') return setTimeout(() => reply('query_answer', 'Finally'), 600);
      reply('error', "Sorry, I couldn't understand that", 'no_intent_match');
    });
  });
  const ai = await serve((q, r) => {
    q.on('data', () => {});
    q.on('end', () => {
      r.writeHead(200, { 'content-type': 'application/json' });
      r.end(JSON.stringify({ choices: [{ message: { content: 'The AI says hello' } }] }));
    });
  });
  process.env.CYTV_OPENROUTER = ai.url;
  const cards = [];
  const v = req('voice').create({ config: memoryConfig(), notify: { show: async o => cards.push(o) } });
  const vask = (act, body, method) => call(v, '/api/voice/' + act, method || 'POST', body);

  let r = await vask('set', { ha: { url: 'ftp://x' } });
  ok(r.code === 400, 'a Home Assistant address that is not http(s) is refused');
  r = await vask('set', { ha: { route: 'sideways' } });
  ok(r.code === 400, 'an unknown routing is refused');
  r = await vask('set', { ha: { url: ha.url + '/', token: 'wrong' } });
  ok(
    r.code === 200 && r.j.ha.url === ha.url && r.j.ha.route === 'ha-first',
    'the address is stored without a trailing slash; the default routing is Home Assistant first'
  );
  ok(JSON.stringify(r.j).indexOf('wrong') < 0 && r.j.ha.hasToken === true, 'the status never contains the token');
  r = await vask('ha-test');
  ok(r.code === 502 && /refused the access token/.test(r.j.error), 'a bad token is reported');
  await vask('set', { ha: { token: TOKEN } });
  r = await vask('ha-test');
  ok(r.j.name === 'Home' && r.j.version === '2026.10.0', 'test connection reads the name and version');
  r = await vask('ha-agents');
  ok(
    r.j.agents.length === 2 && r.j.agents[0].id === 'conversation.home_assistant' && r.j.agents[0].name === 'Home Assistant',
    'agents are the conversation.* entities'
  );
  r = await vask('ask', { text: 'turn on the light', card: false });
  ok(r.j.answer === 'Turned on the light' && r.j.via === 'ha', 'Assist answers an understood command');
  r = await vask('ask', { text: 'quiet', card: false });
  ok(r.j.answer === 'Done', 'an action without speech shows Done');
  ok(haLog[1].conversation_id === 'conv-1' && !haLog[0].conversation_id, 'the conversation id is passed on to the next request');
  r = await vask('ask', { text: 'slow', card: false });
  ok(r.j.answer === 'Finally', 'a slow answer is waited for');
  r = await vask('ask', { text: 'what is love', card: false });
  ok(r.j.answer === "Sorry, I couldn't understand that" && r.j.via === 'ha', "not understood and no AI: Assist's own message is shown");
  r = await vask('set', { llm: { providers: [{ type: 'openrouter', key: 'sk-test' }], enabled: true } });
  let orId = r.j.llm.providers[0].id;
  r = await vask('ask', { text: 'what is love', card: false });
  ok(r.j.answer === 'The AI says hello' && r.j.via === 'ai', 'not understood: the same text goes to the AI');
  r = await vask('ask', { text: 'turn on the light', card: false });
  ok(r.j.via === 'ha', 'understood: the AI is not asked');
  await vask('set', { ha: { route: 'ha-only' } });
  r = await vask('ask', { text: 'what is love', card: false });
  ok(r.j.via === 'ha' && /couldn't understand/.test(r.j.answer), 'Home Assistant only: never the AI');
  await vask('set', { ha: { route: 'ai-only' } });
  const n0 = haLog.length;
  r = await vask('ask', { text: 'turn on the light', card: false });
  ok(r.j.via === 'ai' && haLog.length === n0, 'AI only: Home Assistant is not asked');
  await vask('set', { ha: { route: 'ha-first', agent: 'conversation.llm' } });
  await vask('ask', { text: 'turn on the light', card: false });
  ok(haLog[haLog.length - 1].agent_id === 'conversation.llm', 'the chosen agent is sent');
  await vask('set', { ha: { agent: '' } });
  await vask('forget');
  await vask('ask', { text: 'turn on the light', card: false });
  ok(
    !haLog[haLog.length - 1].conversation_id && !('agent_id' in haLog[haLog.length - 1]),
    'forgetting starts a new conversation; no agent means the default'
  );
  await vask('set', { ha: { url: 'http://127.0.0.1:1' } });
  r = await vask('ask', { text: 'turn on the light', card: false });
  ok(r.j.answer === 'The AI says hello' && r.j.via === 'ai', 'Home Assistant unreachable: the AI answers');
  await vask('set', { llm: { providers: [] } });
  r = await vask('ask', { text: 'turn on the light', card: false });
  ok(!r.j.answer && /Home Assistant:/.test(r.j.error), 'Home Assistant unreachable and no AI: the error is reported');
  await vask('set', { ha: { clear: true } });
  r = await vask('status', null, 'GET');
  ok(r.j.ha.configured === false && r.j.ha.hasToken === false, 'removing Home Assistant clears the address and token');
  // the setup page for a phone (port 8769): it starts, answers with the token only, and stops
  r = await vask('pair');
  ok(r.code === 200 && /^http:\/\/.*:8769\//.test(r.j.url || ''), 'the phone setup page starts (' + JSON.stringify(r.j) + ')');
  if (r.j && r.j.url) {
    const page = await new Promise(res => {
      require('http')
        .get('http://127.0.0.1:8769' + r.j.url.replace(/^http:\/\/[^/]+/, ''), rs => {
          let b = '';
          rs.on('data', c => (b += c));
          rs.on('end', () => res({ code: rs.statusCode, body: b }));
        })
        .on('error', e => res({ code: 0, body: String(e) }));
    });
    ok(page.code === 200 && /Voice setup/.test(page.body), 'the setup page answers at its address');
  }
  r = await vask('pair-stop');
  ok(r.code === 200, 'the setup page stops');
  r = await vask('set', { ha: { token: 'tok' } });
  ok(r.code === 400 && /address too/.test(r.j.error), 'a Home Assistant token without an address is refused');
  // the Home Assistant page (More > Home Assistant): only the address, the token and the certificate; it leaves the AI alone
  r = await vask('set', { llm: { providers: [{ type: 'openrouter', key: 'k', model: 'm/one' }], enabled: true } });
  orId = r.j.llm.providers[0].id; // the list was emptied above: a new one
  const form = (path, data) =>
    new Promise(res => {
      const q = require('http').request({ host: '127.0.0.1', port: 8769, path, method: 'POST' }, rs => {
        let b = '';
        rs.on('data', c => (b += c));
        rs.on('end', () => res({ code: rs.statusCode, body: b }));
      });
      q.on('error', e => res({ code: 0, body: String(e) }));
      q.end(new (require('url').URLSearchParams)(data).toString());
    });
  r = await vask('pair', { only: 'ha' });
  await sleep(100);
  const hp = r.j.url.replace(/^http:\/\/[^/]+/, '');
  const hpage = await new Promise(res => {
    require('http')
      .get('http://127.0.0.1:8769' + hp, rs => {
        let b = '';
        rs.on('data', c => (b += c));
        rs.on('end', () => res(b));
      })
      .on('error', e => res(String(e)));
  });
  ok(
    /name=haurl/.test(hpage) && /name=hatoken/.test(hpage) && !/OpenRouter/.test(hpage),
    'the Home Assistant page asks only for Home Assistant'
  );
  let sv = await form(hp + '/save', { hatoken: 'tok' });
  ok(sv.code === 400 && /address too/.test(sv.body), 'the page refuses a token without an address');
  await sleep(100);
  r = await vask('pair', { only: 'ha' });
  await sleep(100);
  sv = await form(r.j.url.replace(/^http:\/\/[^/]+/, '') + '/save', { haurl: ha.url, hatoken: 'tok' });
  r = await vask('status', null, 'GET');
  ok(
    sv.code === 200 && r.j.ha.configured && r.j.ha.url === ha.url && r.j.llm.enabled && r.j.llm.providers[0].model === 'm/one',
    'saving it sets Home Assistant and keeps the AI settings'
  );
  await sleep(2100); // the page closes itself two seconds after saving
  // the Voice page: the providers as cards, saved at once as JSON; keys are never sent to the phone, an empty key keeps the saved one
  const jpost = (path, o) =>
    new Promise(res => {
      const q = require('http').request(
        { host: '127.0.0.1', port: 8769, path, method: 'POST', headers: { 'content-type': 'application/json' } },
        rs => {
          let b = '';
          rs.on('data', c => (b += c));
          rs.on('end', () => {
            let j = null;
            try {
              j = JSON.parse(b);
            } catch (_) {}
            res({ code: rs.statusCode, j });
          });
        }
      );
      q.on('error', e => res({ code: 0, j: { error: String(e) } }));
      q.end(JSON.stringify(o));
    });
  await vask('set', { llm: { providers: [{ id: orId, key: 'sk-or-page-secret' }] } });
  r = await vask('pair');
  await sleep(100);
  let vp = r.j.url.replace(/^http:\/\/[^/]+/, '');
  const vpage = await new Promise(res => {
    require('http')
      .get('http://127.0.0.1:8769' + vp, rs => {
        let b = '';
        rs.on('data', c => (b += c));
        rs.on('end', () => res(b));
      })
      .on('error', e => res(String(e)));
  });
  ok(/"providers":\[\{"id":"/.test(vpage) && /"hasKey":true/.test(vpage), 'the voice page carries the providers');
  ok(vpage.indexOf('sk-or-page-secret') < 0, 'the voice page never carries a key');
  sv = await jpost(vp + '/save-json', {
    llm: {
      enabled: true,
      providers: [
        { type: 'server', base: 'http://127.0.0.1:9/v1', key: 'server-key-1', model: 'm/local', waitS: 10 },
        { id: orId, type: 'openrouter', model: 'm/two' },
      ],
    },
    ha: { route: 'ha-only' },
  });
  r = await vask('status', null, 'GET');
  let ps = r.j.llm.providers;
  ok(
    sv.code === 200 &&
      ps.length === 2 &&
      ps[0].type === 'server' &&
      ps[0].hasKey &&
      ps[0].waitS === 10 &&
      ps[1].id === orId &&
      ps[1].hasKey &&
      ps[1].model === 'm/two',
    'saving the page sets the list in its order; the OpenRouter key is kept, the server has its own'
  );
  ok(r.j.ha.url === ha.url && r.j.ha.hasToken && r.j.ha.route === 'ha-only', 'saving the Voice page keeps Home Assistant');
  ok(JSON.stringify(r.j).indexOf('server-key-1') < 0 && JSON.stringify(r.j).indexOf('sk-or-page') < 0, 'the status never contains a key');
  await sleep(2100);
  r = await vask('pair');
  await sleep(100);
  vp = r.j.url.replace(/^http:\/\/[^/]+/, '');
  sv = await jpost(vp + '/save-json', { llm: { providers: [{ id: 'nope', type: 'server', base: 'http://a:1/v1', model: 'x' }] } });
  ok(sv.code === 400 && /no such AI provider/.test(sv.j.error), 'the page cannot take over a provider that does not exist');
  sv = await jpost(vp + '/test', { type: 'server', base: 'http://127.0.0.1:9/v1', model: 'm' });
  ok(sv.j && sv.j.ok === false && sv.j.stage === 'connect', 'the page tests a draft: nobody listening is a connection problem');
  await vask('pair-stop');

  // ---- the providers in their order, each taking over when the one before fails ----
  const olLog = [];
  const ol = await serve((q, rs) => {
    let b = '';
    q.on('data', c => (b += c));
    q.on('end', () => {
      olLog.push({ url: q.url, headers: q.headers, body: b ? JSON.parse(b) : null });
      rs.writeHead(200, { 'content-type': 'application/json' });
      if (q.url === '/v1/models')
        return rs.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5:3b' }, { id: 'llama3.2:3b', object: 'model' }] }));
      if (q.url !== '/v1/chat/completions') return rs.end('{}');
      rs.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'the server says hi' } }] }));
    });
  });
  const bad = await serve((q, rs) => {
    q.on('data', () => {});
    q.on('end', () => {
      rs.writeHead(q.headers.authorization === 'Bearer wrong' ? 401 : 500, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ error: { message: 'model not loaded' } }));
    });
  });
  const DEAD = 'http://127.0.0.1:9/v1'; // nobody listens: refused at once
  r = await vask('set', { llm: { providers: [{ type: 'server', base: 'ftp://x', model: 'm' }] } });
  ok(r.code === 400 && /http/.test(r.j.error), 'an address that is not http(s) is refused');
  r = await vask('set', { llm: { providers: [], enabled: true } });
  ok(r.code === 400 && /add an AI provider first/.test(r.j.error), 'with no provider the AI chat cannot be switched on');
  r = await vask('set', { llm: { key: 'sk-old' } });
  ok(r.code === 400 && /list of providers/.test(r.j.error), 'the old single-provider fields are refused with a pointer');
  r = await vask('set', {
    llm: {
      providers: [
        { type: 'server', base: ol.url + '/v1/', model: 'llama3.2:3b' },
        { type: 'server', base: ol.url + '/v1', model: 'x' },
      ],
    },
  });
  ok(r.code === 400 && /already in the list/.test(r.j.error), 'the same address twice is refused');
  r = await vask('set', {
    llm: {
      providers: [
        { type: 'openrouter', key: 'a' },
        { type: 'openrouter', key: 'b' },
      ],
    },
  });
  ok(r.code === 400 && /once/.test(r.j.error), 'OpenRouter can be in the list once');
  r = await vask('set', { llm: { providers: [{ type: 'openrouter' }] } });
  ok(r.code === 400 && /needs a key/.test(r.j.error), 'OpenRouter needs a key');
  r = await vask('set', { llm: { providers: [{ type: 'server', base: ol.url + '/v1', model: 'm', waitS: 7 }] } });
  ok(r.code === 400, 'a wait that is not one of the choices is refused');
  r = await vask('set', {
    llm: {
      enabled: true,
      providers: [
        { type: 'server', name: 'Dead PC', base: DEAD, model: 'm' },
        { type: 'server', base: ol.url + '/v1/', model: 'llama3.2:3b' },
        { type: 'openrouter', key: 'sk-or-secret', model: 'm/or' },
      ],
    },
    ha: { route: 'ai-only' },
  });
  ps = r.j.llm.providers;
  ok(
    r.code === 200 &&
      ps.length === 3 &&
      ps[1].base === ol.url + '/v1' &&
      ps[1].name === ol.url.replace('http://', '') &&
      ps[0].name === 'Dead PC',
    'three providers in their order; the trailing slash is dropped; a server is named after its host unless named'
  );
  const [deadId, olId, or2Id] = ps.map(p => p.id);
  cards.length = 0;
  r = await vask('ask', { text: 'hello there', card: true });
  ok(
    r.j.answer === 'the server says hi' && r.j.provider === olId && r.j.tried.length === 1 && r.j.tried[0].id === deadId,
    'the first cannot be reached: the next one answers, and the reply says who was tried'
  );
  ok(
    cards.some(c => c.kind === 'thinking' && /asking/.test(c.title)) &&
      /via .* · Dead PC did not answer/.test((cards[cards.length - 1] || {}).foot || ''),
    'the cards say a fallback is asked, and which one answered'
  );
  const chat = olLog.filter(x => x.url === '/v1/chat/completions')[0];
  ok(
    chat && chat.body.model === 'llama3.2:3b' && !chat.body.reasoning && !chat.headers.authorization && !chat.headers['x-title'],
    'a server gets its model, no key and none of the OpenRouter fields'
  );
  r = await vask('status', null, 'GET');
  ps = r.j.llm.providers;
  ok(
    ps[0].last && ps[0].last.ok === false && ps[0].skippedUntil > Date.now() && ps[1].last.ok && r.j.llm.lastVia === olId,
    'the status shows each one’s last result; the one that could not be reached is skipped for a while'
  );
  r = await vask('ask', { text: 'and again', card: false });
  ok(r.j.provider === olId && /skipped/.test(r.j.tried[0].error), 'next time the unreachable one is skipped');
  ok(
    olLog
      .filter(x => x.url === '/v1/chat/completions')
      .pop()
      .body.messages.some(m => m.role === 'assistant' && m.content === 'the server says hi'),
    'the conversation goes on across questions'
  );
  ok(
    olLog.every(x => !x.headers.authorization),
    'the OpenRouter key is never sent to a server of yours'
  );
  r = await vask('test', { id: deadId });
  ok(r.j.ok === false && r.j.stage === 'connect', 'test: a provider that cannot be reached');
  r = await vask('test', { id: olId });
  ok(r.j.ok === true && r.j.ms >= 0, 'test: a provider that answers');
  r = await vask('models?id=' + olId, null, 'GET');
  ok(r.code === 200 && r.j.count === 2 && r.j.picks[0].id === 'llama3.2:3b', 'the model list of one provider, all of a server’s');
  // a provider of its own key, and the order changed by the remote
  r = await vask('set', { llm: { provider: { id: olId, key: 'lm-key' } } });
  ok(r.j.llm.providers[1].hasKey && JSON.stringify(r.j).indexOf('lm-key') < 0, 'a server key is saved, the status says only that');
  r = await vask('set', { llm: { first: olId } });
  ok(r.j.llm.providers[0].id === olId, 'make first');
  await vask('ask', { text: 'with a key', card: false });
  ok(olLog[olLog.length - 1].headers.authorization === 'Bearer lm-key', 'a server gets its own key');
  r = await vask('set', { llm: { order: [or2Id, olId] } });
  ok(r.code === 400 && /every AI provider/.test(r.j.error), 'an order that leaves one out is refused');
  r = await vask('set', { llm: { order: [or2Id, deadId, olId] } });
  ok(r.j.llm.providers.map(p => p.id).join() === [or2Id, deadId, olId].join(), 'the order is set');
  r = await vask('ask', { text: 'from openrouter', card: false });
  ok(r.j.provider === or2Id && r.j.answer === 'The AI says hello', 'OpenRouter answers first now');
  // everything fails: one error per provider, and the card says where to look
  r = await vask('set', {
    llm: {
      providers: [
        { type: 'server', name: 'Broken', base: bad.url + '/v1', model: 'm' },
        { type: 'server', name: 'Locked', base: bad.url.replace('127.0.0.1', 'localhost') + '/v1', key: 'wrong', model: 'm' },
      ],
    },
  });
  ok(r.code === 200 && r.j.llm.enabled, 'replacing the list keeps the AI chat on');
  cards.length = 0;
  r = await vask('ask', { text: 'anyone?', card: true });
  ok(
    !r.j.answer && /Broken: model not loaded/.test(r.j.error) && /Locked: refused the key/.test(r.j.error),
    'none answers: every reason is reported'
  );
  const last = cards[cards.length - 1] || {};
  ok(last.title === 'Not answered' && /AI providers/.test(last.foot || ''), 'the error card says where to look');
  r = await vask('status', null, 'GET');
  ps = r.j.llm.providers;
  await vask('set', { llm: { provider: { id: ps[0].id, off: true } } });
  r = await vask('set', { llm: { remove: ps[1].id } });
  ok(
    r.code === 200 && r.j.llm.providers.length === 1 && r.j.llm.enabled === false,
    'removing the last usable one switches the AI chat off'
  );
  ol.server.close();
  bad.server.close();
  ha.server.close();
  ai.server.close();

  // ---- the settings from before providers existed are moved into the list ----
  const v2 = req('voice').create({
    config: memoryConfig({
      voice: { llm: { enabled: true, key: 'sk-or-old', base: 'http://192.0.2.1:11434/v1', serverKey: 'srv-old', model: 'llama3.2:3b' } },
    }),
    notify: { show: async () => {} },
  });
  r = await call(v2, '/api/voice/status', 'GET');
  ps = r.j.llm.providers;
  ok(
    r.j.llm.enabled &&
      ps.length === 2 &&
      ps[0].type === 'server' &&
      ps[0].model === 'llama3.2:3b' &&
      ps[0].hasKey &&
      ps[1].type === 'openrouter' &&
      ps[1].model === 'openrouter/auto' &&
      ps[1].hasKey,
    'an old server setting becomes the first provider, the OpenRouter key the fallback'
  );
  r = await call(v2, '/api/voice/set', 'POST', { llm: { provider: { id: ps[0].id, waitS: 45 } } });
  ok(r.code === 200 && r.j.llm.providers[0].waitS === 45 && r.j.llm.providers[1].hasKey, 'a change writes the list and keeps both keys');
});
