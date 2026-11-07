// Voice answers (voice.js): Home Assistant (Assist) and a language model, against local stand-ins for both.
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
  await vask('set', { llm: { key: 'sk-test', enabled: true } });
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
  await vask('set', { llm: { clearKey: true } });
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
  await vask('set', { llm: { key: 'k', model: 'm/one', enabled: true } });
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
    sv.code === 200 && r.j.ha.configured && r.j.ha.url === ha.url && r.j.llm.enabled && r.j.llm.model === 'm/one',
    'saving it sets Home Assistant and keeps the AI settings'
  );
  await sleep(2100); // the page closes itself two seconds after saving
  // the Voice page no longer has the address and token, so saving it keeps them
  r = await vask('pair');
  await sleep(100);
  sv = await form(r.j.url.replace(/^http:\/\/[^/]+/, '') + '/save', { model: 'm/two', enabled: '1', haroute: 'ha-only' });
  r = await vask('status', null, 'GET');
  ok(
    sv.code === 200 && r.j.ha.url === ha.url && r.j.ha.hasToken && r.j.ha.route === 'ha-only',
    'saving the Voice page keeps Home Assistant'
  );
  await sleep(2100);
  // the page has one key field: with an AI server address it is that server's key, without one the OpenRouter key
  r = await vask('pair');
  await sleep(100);
  sv = await form(r.j.url.replace(/^http:\/\/[^/]+/, '') + '/save', {
    base: 'http://127.0.0.1:9/v1',
    key: 'server-key-1',
    model: 'm/two',
    enabled: '1',
    haroute: 'ha-only',
  });
  r = await vask('status', null, 'GET');
  ok(
    sv.code === 200 && r.j.llm.base === 'http://127.0.0.1:9/v1' && r.j.llm.hasServerKey && r.j.llm.hasKey,
    'with an address, the key field is saved as that server key and the OpenRouter key is kept'
  );
  await sleep(2100);
  await vask('set', { llm: { clearKey: true } });
  r = await vask('pair');
  await sleep(100);
  sv = await form(r.j.url.replace(/^http:\/\/[^/]+/, '') + '/save', { key: 'sk-or-2', model: 'm/two', enabled: '1', haroute: 'ha-only' });
  r = await vask('status', null, 'GET');
  ok(
    sv.code === 200 && r.j.llm.base === '' && r.j.llm.hasKey && r.j.llm.hasServerKey && r.j.llm.enabled,
    'without an address, the key field is the OpenRouter key; the server key stays apart'
  );
  await sleep(2100);
  await vask('set', { llm: { clearServerKey: true } });
  // a self-hosted server with the OpenAI-compatible chat API (such as http://<computer>:11434/v1): no key, none of OpenRouter's extra fields
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
  r = await vask('set', { llm: { base: 'ftp://x' } });
  ok(r.code === 400 && /AI server address/.test(r.j.error), 'an AI server address that is not http(s) is refused');
  await vask('set', { llm: { clearKey: true } });
  r = await vask('set', { llm: { enabled: true } });
  ok(r.code === 400, 'no key and no server address: the AI chat cannot be switched on');
  r = await vask('set', { llm: { base: ol.url + '/v1/', model: 'llama3.2:3b', enabled: true }, ha: { route: 'ai-only' } });
  ok(
    r.code === 200 && r.j.llm.base === ol.url + '/v1' && r.j.llm.enabled && !r.j.llm.hasKey,
    'a server address switches the AI chat on without a key; the trailing slash is dropped'
  );
  r = await vask('ask', { text: 'hello there', card: false });
  const chat = olLog.filter(x => x.url === '/v1/chat/completions')[0];
  ok(r.j.answer === 'the server says hi' && r.j.via === 'ai', 'the server of yours answers');
  ok(
    chat && chat.body.model === 'llama3.2:3b' && !chat.body.reasoning && !chat.headers.authorization && !chat.headers['x-title'],
    'it gets the model, no key and none of the OpenRouter fields'
  );
  r = await vask('models', null, 'GET');
  ok(
    r.code === 200 && r.j.count === 2 && r.j.picks[0].id === 'llama3.2:3b' && r.j.picks[1].id === 'qwen2.5:3b',
    'the model list comes from the server of yours, all of it'
  );
  await vask('set', { llm: { key: 'sk-or-secret' } });
  await vask('ask', { text: 'again', card: false });
  ok(!olLog[olLog.length - 1].headers.authorization, 'the OpenRouter key is never sent to the server of yours');
  r = await vask('set', { llm: { serverKey: 'lm-key' } });
  ok(r.j.llm.hasServerKey && JSON.stringify(r.j).indexOf('lm-key') < 0, 'the status says a server key is saved, never which');
  await vask('ask', { text: 'once more', card: false });
  ok(olLog[olLog.length - 1].headers.authorization === 'Bearer lm-key', 'the key of the server of yours is sent to it');
  r = await vask('set', { llm: { base: '' } });
  ok(r.code === 200 && r.j.llm.base === '' && r.j.llm.hasKey, 'an empty address goes back to OpenRouter');
  r = await vask('set', { llm: { clearServerKey: true } });
  ok(!r.j.llm.hasServerKey, 'the server key can be removed');
  ol.server.close();
  ha.server.close();
  ai.server.close();
});
