// Answers for the voice function (voice.js): Home Assistant's Assist, language models (OpenRouter and self-hosted servers with the
// OpenAI-compatible chat API, in the order you set, each taking over when the one before fails), and a server of yours. Text
// goes in, text comes out; the settings are the voice section of config.json (voice.js passes them in with init).
const fetch = require('./fetch'),
  hub = require('./toolhub'),
  { URL } = require('./netcompat');

let cfg = () => ({});
// deps.tools(): the tool providers, [{id, name, tools: {list(), call(name, args, opts)}}] (voice.js: the service's own and the add-ons')
let deps = { tools: () => [] };
const init = (f, d) => {
  cfg = f;
  if (d) deps = Object.assign({}, deps, d);
};

// POST JSON; resolves {status, text}. Redirects are not followed.
function request(url, headers, payload, ms, extra) {
  return fetch
    .read(url, {
      method: payload === undefined ? 'GET' : 'POST', // no payload: a GET
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      idleMs: ms || 30000,
      redirects: 0, // on purpose: a key (Bearer) or a token must never follow a redirect to another address
      anyStatus: true,
      maxBytes: 1 << 20,
      bigText: 'the answer is too large',
      insecure: !!(extra && extra.rejectUnauthorized === false),
      totalMs: extra && extra.totalMs,
      connectMs: extra && extra.connectMs,
    })
    .then(r => ({ status: r.status, text: r.body.toString('utf8') }))
    .catch(e => {
      if (e.code === 'timeout') throw Object.assign(new Error('no answer in time'), { code: 'timeout' });
      if (e.code === 'url')
        throw new Error(/http/.test(e.message) ? 'the address must start with http:// or https://' : 'the address is not valid');
      throw e;
    });
}
// a server of yours: POST {"text": ...}; the answer may be JSON ({"text", "title", "image", "seconds"}) or plain text
async function toServer(c, payload) {
  const r = await request(c.url, c.token ? { authorization: 'Bearer ' + c.token } : {}, payload, 30000);
  if (r.status < 200 || r.status >= 300) throw new Error('your server answered ' + r.status);
  let o = null;
  try {
    o = JSON.parse(r.text);
  } catch (_) {}
  if (o && typeof o === 'object') {
    const text = String(o.text || o.reply || o.answer || o.message || '').trim();
    return text || o.image ? { title: o.title ? String(o.title) : '', text, image: o.image, seconds: o.seconds } : null;
  }
  const t = r.text.trim();
  return t ? { text: t } : null;
}

// ---- chat with a language model: an ordered list of providers, the first answers, the next ones take over when it fails ----
// A provider is OpenRouter (type 'openrouter', at most one) or a self-hosted server with the OpenAI-compatible chat API (type
// 'server': Ollama, LM Studio, llama.cpp's llama-server, vLLM and others; base such as http://<computer>:11434/v1). Each one's key
// goes only to that provider's own address (a server may be on plain http on the home network) and is never returned.
// voice.llm = { enabled, system, agent, providers: [{ id, type, name, base, key, model, waitS, off }] }; agent: the OpenRouter
// provider may use the TV's tools (the agent, below)
const orApi = () => process.env.CYTV_OPENROUTER || 'https://openrouter.ai/api/v1'; // overridden only by the tests
const LLM_DEFAULTS = { enabled: false, system: '', providers: [], agent: false };
const WAITS = [10, 25, 30, 45, 60]; // seconds to wait for one provider's answer (defaults: 25 for a server, 30 for OpenRouter)
const CONNECT_MS = 4000, // a provider that is off or a wrong address is known this fast
  TOTAL_MS = 60000, // all providers of one question together
  SKIP_MS = 60000; // a provider that could not be reached is skipped this long, so a PC that is off costs nothing next time
// the settings written before providers existed (one provider: key = OpenRouter, base + serverKey = a server of yours)
const LEGACY = ['key', 'base', 'serverKey', 'model'];
function legacyProviders(c) {
  const out = [];
  if (c.base)
    out.push({ id: 'p1', type: 'server', base: c.base, key: c.serverKey || '', model: c.model === 'openrouter/auto' ? '' : c.model || '' });
  if (c.key) out.push({ id: out.length ? 'p2' : 'p1', type: 'openrouter', key: c.key, model: (!c.base && c.model) || 'openrouter/auto' });
  return out;
}
const hostOf = b => {
  try {
    return new URL(b).host;
  } catch (_) {
    return String(b || '');
  }
};
// one provider with every field filled in
function provider(p) {
  const or = p.type === 'openrouter';
  return {
    id: String(p.id || ''),
    type: or ? 'openrouter' : 'server',
    name: String(p.name || '').trim() || (or ? 'OpenRouter' : hostOf(p.base) || 'Your own server'),
    base: or ? '' : String(p.base || ''),
    key: String(p.key || ''),
    model: String(p.model || (or ? 'openrouter/auto' : '')),
    waitS: WAITS.indexOf(+p.waitS) >= 0 ? +p.waitS : or ? 30 : 25,
    off: !!p.off,
  };
}
const providersOf = c => (Array.isArray(c.providers) ? c.providers : legacyProviders(c)).map(provider);
const llmCfg = () => {
  const c = cfg().llm || {};
  return { enabled: !!c.enabled, system: String(c.system || ''), agent: !!c.agent, providers: providersOf(c) };
};
// a provider that can be asked: switched on, with its key (OpenRouter) or address (a server) and a model
const usable = p => !p.off && !!p.model && (p.type === 'openrouter' ? !!p.key : !!p.base);
const llmReady = l => !!(l.enabled && l.providers.some(usable));
const apiOf = p => (p.type === 'openrouter' ? orApi() : p.base);

const DEFAULT_SYSTEM =
  'You are a voice assistant on a television. You have no tools and no internet access: answer from your own knowledge, and say when something may be out of date. The user speaks to you through the remote control and your answer appears as text on the screen, so keep it short: one to three plain sentences, no markdown, no lists, no emoji. If the speech looks like a recognition mistake, answer what was most likely meant.';
let history = [],
  lastTurn = 0,
  lastVia = '';
const health = {}; // id -> { last: {at, ok, ms, error}, skipUntil }: in memory only, for the status and the skip
const TOOLISH = /<\|?\s*(?:tool|function|python_tag)|<tool_call|\[TOOL_CALL|<function_call/i; // a model that tries to call a tool instead of answering
function cleanAnswer(t) {
  let x = String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const m = TOOLISH.exec(x);
  if (m) x = x.slice(0, m.index);
  return x
    .replace(/<\|[^|>]*\|>/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}
const failed = (message, stage) => Object.assign(new Error(message), { stage });
const UNREACHABLE = /^(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EADDRNOTAVAIL)$/;
// one request to a provider's chat API; resolves {status, o} (o: the parsed reply), fails with its stage (connect, auth, answer)
async function chat(p, payload, ms) {
  const or = p.type === 'openrouter',
    headers = or ? { 'HTTP-Referer': 'https://github.com/lasharor/cleanyourtv-WebOS', 'X-Title': 'CleanYourTV' } : {};
  if (p.key) headers.authorization = 'Bearer ' + p.key; // its own key, never another provider's
  if (or) payload.reasoning = { exclude: true };
  let r;
  try {
    r = await request(apiOf(p) + '/chat/completions', headers, payload, ms, { totalMs: ms, connectMs: CONNECT_MS });
  } catch (e) {
    // 2. only a connection that was never made is 'connect' (skipped for a minute); an answer that is too large, a connection
    // dropped mid-answer or any other failure is the answer's ('answer'), so a working server is asked again next time
    if (e.code === 'connect' || UNREACHABLE.test(e.code || '')) throw failed('could not connect', 'connect');
    throw failed(e.message, 'answer');
  }
  let o = {};
  try {
    o = JSON.parse(r.text);
  } catch (_) {}
  if (r.status === 401 || r.status === 403) throw failed('refused the key', 'auth');
  return { status: r.status, o };
}
const chatError = (status, o) => String((o.error && (o.error.message || o.error.code || o.error)) || 'HTTP ' + status).slice(0, 160);
// one provider, one question; resolves the answer, or fails with a short reason and its stage (connect, auth, answer, empty, tool)
async function askOne(p, turns, system, ms, maxTokens) {
  let answer = '',
    tool = false;
  const t0 = Date.now();
  for (let attempt = 0; attempt < 2 && !answer; attempt++) {
    const left = ms - (Date.now() - t0); // the retry gets only what is left of this provider's time
    if (left < 1000) throw failed('no answer in time', 'answer');
    const messages = [
      {
        role: 'system',
        content:
          system +
          (attempt
            ? ' You have no tools and cannot search the internet: never call a tool. Answer in plain text from what you know, and say so if it may be out of date.'
            : ''),
      },
    ].concat(turns);
    const { status, o } = await chat(p, { model: p.model, messages, max_tokens: maxTokens || 500 }, left);
    if (status !== 200 || o.error) throw failed(chatError(status, o), 'answer');
    const msg = (o.choices && o.choices[0] && o.choices[0].message) || {},
      raw = String(msg.content || '');
    tool = tool || TOOLISH.test(raw) || !!(msg.tool_calls && msg.tool_calls.length);
    answer = cleanAnswer(raw);
    if (tool && !attempt) answer = ''; // retry once, telling the model it has no tools
  }
  if (!answer)
    throw tool ? failed('tried to use a tool instead of answering; choose another model', 'tool') : failed('empty answer', 'empty');
  return answer;
}
function note(p, ok, ms, e) {
  health[p.id] = {
    last: { at: Date.now(), ok, ms, error: ok ? '' : e.message },
    skipUntil: !ok && e.stage === 'connect' ? Date.now() + SKIP_MS : 0,
  };
}
// The providers in their order: resolves {answer, via, name, tried: [{id, name, error}]}; fails with every reason when none
// answered. With llm.agent, the OpenRouter provider gets the TV's tools (agentOne); once a tool has run, a failure is not handed
// to the next provider, so nothing is done twice.
async function askLlm(text, opts) {
  const l = llmCfg(),
    list = l.providers.filter(usable);
  if (!list.length) throw new Error(l.providers.length ? 'every AI provider is switched off or has no model' : 'no AI provider is set up');
  if (Date.now() - lastTurn > 600000) history = []; // a new conversation after ten quiet minutes
  const turns = history.concat({ role: 'user', content: text }).slice(-12);
  const system = (l.system || DEFAULT_SYSTEM) + today();
  const tools = l.agent && list.some(p => p.type === 'openrouter') ? await gatherTools() : null;
  const start = Date.now(),
    tried = [];
  const skipped = p => (health[p.id] || {}).skipUntil > Date.now();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    // skipped for a minute after it could not be reached, unless every one after it is skipped too
    if (skipped(p) && list.slice(i + 1).some(q => !skipped(q))) {
      tried.push({ id: p.id, name: p.name, error: 'skipped: could not connect a minute ago' });
      continue;
    }
    const left = TOTAL_MS - (Date.now() - start);
    if (left < 2000) {
      tried.push({ id: p.id, name: p.name, error: 'no time left' });
      continue;
    }
    const t0 = Date.now();
    try {
      const ms = Math.min(p.waitS * 1000, left),
        a = tools && tools.names.length && p.type === 'openrouter' ? await agentOne(p, l, turns, tools, ms, opts || {}) : null;
      const answer = a !== null ? a : await askOne(p, turns, system, ms - (Date.now() - t0));
      note(p, true, Date.now() - t0);
      lastVia = p.id;
      history = turns.concat({ role: 'assistant', content: answer });
      lastTurn = Date.now();
      return { answer, via: p.id, name: p.name, tried };
    } catch (e) {
      note(p, false, Date.now() - t0, e);
      tried.push({ id: p.id, name: p.name, error: e.message });
      if (e.acted) break; // a tool ran: the next provider must not do it again
    }
  }
  throw Object.assign(new Error(tried.map(t => t.name + ': ' + t.error).join('\n')), { tried });
}
// one provider (saved, or a draft from the phone page), asked "Say OK"; a saved one's result shows in the status, its skip ends
async function testProvider(p) {
  const q = provider(p);
  if (!q.model) return { ok: false, ms: 0, answer: '', error: 'choose a model', stage: 'answer' };
  if (q.type === 'openrouter' && !q.key) return { ok: false, ms: 0, answer: '', error: 'OpenRouter needs a key', stage: 'auth' };
  if (q.type === 'server' && !q.base) return { ok: false, ms: 0, answer: '', error: 'enter the address of your server', stage: 'connect' };
  const t0 = Date.now();
  try {
    const answer = await askOne(q, [{ role: 'user', content: 'Say OK.' }], 'Answer with one word.', 30000, 20);
    if (q.id) note(q, true, Date.now() - t0);
    return { ok: true, ms: Date.now() - t0, answer: answer.slice(0, 80), error: '', stage: '' };
  } catch (e) {
    if (q.id) note(q, false, Date.now() - t0, e);
    return { ok: false, ms: Date.now() - t0, answer: '', error: e.message, stage: e.stage || 'answer' };
  }
}
// what the status shows of each provider: never the key
const llmStatus = () => {
  const l = llmCfg();
  return {
    enabled: l.enabled,
    system: l.system,
    agent: l.agent,
    providers: l.providers.map(p => {
      const h = health[p.id] || {};
      return {
        id: p.id,
        type: p.type,
        name: p.name,
        base: p.base,
        model: p.model,
        waitS: p.waitS,
        off: p.off,
        hasKey: !!p.key,
        last: h.last || null,
        skippedUntil: h.skipUntil > Date.now() ? h.skipUntil : 0,
      };
    }),
    lastVia,
    // for readers from before providers (version 1.6: scripts): OpenRouter's key and model, as 1.6 reported them; without an
    // OpenRouter provider, the model of the one asked first
    hasKey: l.providers.some(p => p.type === 'openrouter' && !!p.key),
    model: (
      l.providers.filter(p => p.type === 'openrouter')[0] ||
      l.providers.filter(usable)[0] ||
      l.providers[0] || { model: 'openrouter/auto' }
    ).model,
  };
};

// ---- the agent: the model may use the tools the service and the approved add-ons give (llm.agent) ----
const MAX_ROUNDS = 5, // every tool goes with every question (at most toolhub.MAX_TOOLS): they cost prompt tokens on each round
  MAX_RESULT = 2000,
  CONFIRM_MS = 30000,
  TOOL_MS = 30000;
const AGENT_SYSTEM =
  'You are a voice assistant on a television, and you can act on the TV with the tools you are given. Use a tool when the user asks you to do something on the TV, or asks about something a tool can look up; otherwise answer from your own knowledge, and say when something may be out of date. The user speaks to you through the remote control and your answer appears as text on the screen, so keep it short: one to three plain sentences, no markdown, no lists, no emoji. After using a tool, say in one short sentence what you did or found; if a tool fails, say so plainly. If the speech looks like a recognition mistake, answer what was most likely meant.';
const today = () => ' Today is ' + new Date().toISOString().slice(0, 10) + '.';
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|confirm)\b/i;
let pending = null; // {provider, name, args, description, at}: a tool that waits for the person's yes

// the tools of every provider (toolhub.merge: the same names /api/mcp lists), as OpenRouter takes them
async function gatherTools() {
  let providers = [];
  try {
    providers = deps.tools() || [];
  } catch (_) {}
  const m = await hub.merge(providers);
  m.defs = m.names.map(n => ({
    type: 'function',
    function: { name: n, description: m.map[n].description, parameters: m.map[n].schema },
  }));
  return m;
}

// what a tool answered, as text for the model, cut short
function resultText(r) {
  let s;
  if (r && Array.isArray(r.content))
    s = r.content
      .filter(c => c && c.type === 'text')
      .map(c => String(c.text))
      .join('\n');
  else s = typeof r === 'string' ? r : JSON.stringify(r === undefined ? null : r);
  s = (r && r.isError ? 'Error: ' : '') + (s || '');
  return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + '…' : s;
}
function callTool(entry, args, confirmed) {
  let timer;
  const call = Promise.resolve().then(() => entry.provider.tools.call(entry.name, args, confirmed ? { confirmed: true } : {}));
  const late = new Promise(resolve => {
    timer = setTimeout(() => resolve({ content: [{ type: 'text', text: 'the tool did not answer in time' }], isError: true }), TOOL_MS);
  });
  return Promise.race([call, late])
    .catch(e => ({ content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true }))
    .then(r => {
      clearTimeout(timer);
      return r;
    });
}
// the question the TV asks before a tool that turns something off or deletes something
const confirmText = d => String(d).replace(/[.\s]+$/, '') + '? Say yes within 30 seconds to go ahead.';

// the loop with the OpenRouter provider: send the tools, run the calls the model asks for, give it the results, until it answers in
// words. Resolves the answer; null: this model cannot use tools, so the caller asks it without them. ms is the time for the model's
// answers (a tool's own time is not counted). A failure after a tool ran carries acted, so askLlm does not ask the next provider.
async function agentOne(p, l, turns, tools, ms, opts) {
  const system = (l.system ? l.system + ' You can act on the TV with the tools you are given.' : AGENT_SYSTEM) + today();
  const messages = [{ role: 'system', content: system }].concat(turns);
  let spent = 0,
    acted = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const left = ms - spent;
      if (left < 1000) throw failed('no answer in time', 'answer');
      const t0 = Date.now();
      const { status, o } = await chat(p, { model: p.model, messages, tools: tools.defs, tool_choice: 'auto', max_tokens: 500 }, left);
      spent += Date.now() - t0;
      if (status !== 200 || o.error) {
        const m = chatError(status, o);
        if (!round && /tool/i.test(m) && (status === 404 || status === 400)) return null; // no endpoint of this model takes tools
        throw failed(m, 'answer');
      }
      const msg = (o.choices && o.choices[0] && o.choices[0].message) || {},
        calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter(c => c && c.function) : [];
      if (!calls.length) {
        const raw = String(msg.content || '');
        if (!round && TOOLISH.test(raw)) return null; // it wrote a tool call as text: it cannot really use tools
        const answer = cleanAnswer(raw);
        if (!answer) throw failed('empty answer', 'empty');
        return answer;
      }
      messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
      let ask = null;
      for (const c of calls) {
        const name = String(c.function.name || ''),
          entry = tools.map[name];
        let args = null,
          out;
        try {
          args = JSON.parse(c.function.arguments || '{}');
        } catch (_) {}
        const bad = entry ? hub.checkArgs(entry.schema, args) : '';
        if (!entry) out = 'Error: there is no tool named ' + name.slice(0, 64);
        else if (bad) out = 'Error: ' + bad;
        else if (entry.confirm) {
          // never run here: the person says yes on the TV first (confirmPending)
          if (!ask) ask = { provider: entry.provider, name: entry.name, args, description: entry.description, at: Date.now() };
          out = 'Not run: this tool needs the person to say yes first, and the TV is asking them now.';
        } else {
          if (opts.onTool) opts.onTool(name);
          acted = true;
          out = resultText(await callTool(entry, args, false));
        }
        messages.push({ role: 'tool', tool_call_id: String(c.id || name), content: out });
      }
      if (ask) {
        pending = ask;
        return confirmText(ask.description);
      }
    }
    throw failed('used too many tools without answering', 'answer');
  } catch (e) {
    e.acted = acted;
    throw e;
  }
}

// a tool waiting for a yes: whether the words answer it. null: nothing waits (or it waited too long), so the words are a new question
function pendingConfirm() {
  if (pending && Date.now() - pending.at > CONFIRM_MS) pending = null;
  return pending ? { name: pending.name, description: pending.description } : null;
}
async function confirmPending(text) {
  const p = pendingConfirm();
  if (!p) return null;
  const run = pending;
  pending = null;
  let answer;
  if (!YES.test(String(text || '').trim())) answer = 'Okay, I did not do that.';
  else {
    const r = await callTool(run, run.args, true);
    answer =
      r && r.isError
        ? 'That did not work: ' +
          resultText(r)
            .replace(/^Error: /, '')
            .slice(0, 200)
        : 'Done.';
  }
  history = history.concat({ role: 'user', content: String(text) }, { role: 'assistant', content: answer }).slice(-12);
  lastTurn = Date.now();
  return answer;
}

// ---- Home Assistant: the Assist (conversation) API with a long-lived access token ----
const HA_DEFAULTS = { url: '', token: '', selfSigned: false, route: 'ha-first', agent: '' };
const HA_ROUTES = ['ha-first', 'ha-only', 'ai-only'];
const haCfg = () => Object.assign({}, HA_DEFAULTS, cfg().ha || {});
const haReady = h => !!(h.url && h.token);
let haConv = null; // { id, at }: Assist keeps the context of a conversation; a new one starts after ten quiet minutes
// the address without credentials, query or trailing slash; '' when it is not an http(s) address
function haBase(t) {
  let u;
  try {
    u = new URL(String(t).trim());
  } catch (_) {
    return '';
  }
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.protocol + '//' + u.host + u.pathname.replace(/\/+$/, '') : '';
}
// Assist asks for the same text twice only if it did not understand: error code no_intent_match
async function haCall(h, path, payload, ms) {
  const r = await request(
    h.url + path,
    { authorization: 'Bearer ' + h.token },
    payload,
    ms || 30000,
    h.selfSigned && /^https:/.test(h.url) ? { rejectUnauthorized: false } : {}
  );
  if (r.status === 401 || r.status === 403) throw new Error('Home Assistant refused the access token');
  if (r.status === 404) throw new Error('that does not look like Home Assistant (' + path + ' was not found)');
  if (r.status < 200 || r.status >= 300) throw new Error('Home Assistant answered ' + r.status);
  try {
    return JSON.parse(r.text);
  } catch (_) {
    throw new Error('Home Assistant did not answer with JSON');
  }
}
async function askHa(text) {
  const h = haCfg();
  if (!haReady(h)) throw new Error('Home Assistant is not set up');
  if (haConv && Date.now() - haConv.at > 600000) haConv = null;
  const body = { text, language: 'en' };
  if (haConv) body.conversation_id = haConv.id;
  if (h.agent) body.agent_id = h.agent;
  const o = await haCall(h, '/api/conversation/process', body, 30000),
    res = (o && o.response) || {};
  const type = String(res.response_type || ''),
    code = String((res.data && res.data.code) || '');
  const speech = String((res.speech && res.speech.plain && res.speech.plain.speech) || '').trim();
  if (o.conversation_id) haConv = { id: String(o.conversation_id), at: Date.now() };
  return {
    text: speech || (type === 'action_done' ? 'Done' : ''),
    understood: !(type === 'error' && code === 'no_intent_match'),
    type,
    code,
  };
}
async function haTest() {
  const h = haCfg();
  if (!haReady(h)) throw new Error('set the Home Assistant address and token first');
  const c = await haCall(h, '/api/config', undefined, 10000);
  return { name: String(c.location_name || ''), version: String(c.version || '') };
}
// conversation agents show up as conversation.* entities
async function haAgents() {
  const h = haCfg();
  if (!haReady(h)) throw new Error('set the Home Assistant address and token first');
  const all = await haCall(h, '/api/states', undefined, 20000);
  return (Array.isArray(all) ? all : [])
    .filter(e => e && /^conversation\.[\w]+$/.test(e.entity_id || ''))
    .map(e => ({ id: e.entity_id, name: String((e.attributes && e.attributes.friendly_name) || e.entity_id).slice(0, 80) }));
}

// ---- the models of one provider: of OpenRouter a short list for the TV and everything for the phone; of a server, everything ----
const modelCache = {}; // by provider type, address and whether a key is sent; at most 20 (drafts tried on the phone page)
const keepModels = (ck, v) => {
  const ks = Object.keys(modelCache);
  if (ks.length >= 20) delete modelCache[ks.sort((a, b) => modelCache[a].at - modelCache[b].at)[0]];
  return (modelCache[ck] = v);
};
const MAJOR = ['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'deepseek', 'qwen', 'x-ai'];
function models(pIn) {
  const p = provider(pIn || {}),
    api = apiOf(p),
    name = p.type === 'openrouter' ? 'OpenRouter' : 'your server',
    ck = p.type + ' ' + api + ' ' + (p.key ? 'k' : '');
  if (p.type === 'server' && !p.base) return Promise.reject(new Error('enter the address of your server'));
  const c = modelCache[ck];
  if (c && Date.now() - c.at < 3600000) return Promise.resolve(c);
  const headers = { 'User-Agent': 'cleanyourtv-voice' };
  if (p.type === 'server' && p.key) headers.authorization = 'Bearer ' + p.key; // a server's own key; OpenRouter's list needs none
  return fetch
    .read(api + '/models', {
      headers,
      idleMs: 15000,
      connectMs: CONNECT_MS,
      redirects: 0, // a server's key must not follow a redirect to another address
      maxBytes: 8 << 20,
      bigText: 'the model list is too large',
      statusText: st => name + ' answered ' + st,
    })
    .catch(e => {
      if (e.code === 'timeout') throw new Error(name + ' did not answer');
      if (e.code === 'connect' || UNREACHABLE.test(e.code || '')) throw new Error('could not connect to ' + name);
      throw e;
    })
    .then(r => {
      let all;
      try {
        all = JSON.parse(r.body.toString('utf8'))
          .data.filter(
            m =>
              m &&
              /^[\w.\-:\/~]{1,100}$/.test(m.id || '') &&
              !(
                m.architecture &&
                Array.isArray(m.architecture.output_modalities) &&
                m.architecture.output_modalities.some(x => x !== 'text')
              )
          )
          .map(m => ({
            id: m.id,
            name: String(m.name || m.id).slice(0, 80),
            created: m.created || 0,
            price: m.pricing && +m.pricing.prompt >= 0 ? Math.round(+m.pricing.prompt * 1e8) / 100 : null, // dollars per million input tokens
            tools: Array.isArray(m.supported_parameters) && m.supported_parameters.indexOf('tools') >= 0, // it can act on the TV (llm.agent)
          }));
      } catch (e) {
        throw new Error('the model list could not be read');
      }
      const picks = [],
        seen = {};
      if (p.type === 'server') {
        all.sort((a, b) => a.id.localeCompare(b.id));
        return keepModels(ck, { at: Date.now(), all, picks: all.slice(0, 40) }); // a server of yours: the models it has
      }
      for (const m of all.slice().sort((a, b) => b.created - a.created)) {
        const prov = m.id.split('/')[0];
        if (m.id.includes(':') || !MAJOR.includes(prov)) continue;
        if ((seen[prov] = (seen[prov] || 0) + 1) <= 3) picks.push(m);
      }
      return keepModels(ck, { at: Date.now(), all: all.sort((a, b) => a.id.localeCompare(b.id)), picks });
    });
}

// a new conversation: forget what was said to the model and Assist's conversation
function forget() {
  history = [];
  haConv = null;
  pending = null;
}
const forgetHa = () => {
  haConv = null;
};

module.exports = {
  init,
  toServer,
  askLlm,
  confirmPending,
  pendingConfirm,
  askHa,
  haTest,
  haAgents,
  models,
  forget,
  forgetHa,
  haBase,
  haReady,
  llmCfg,
  llmReady,
  llmStatus,
  testProvider,
  provider,
  providersOf,
  usable,
  hostOf,
  WAITS,
  LEGACY,
  haCfg,
  LLM_DEFAULTS,
  HA_DEFAULTS,
  HA_ROUTES,
};
