// Answers for the voice function (voice.js): Home Assistant's Assist, language models (OpenRouter and self-hosted servers with the
// OpenAI-compatible chat API, in the order you set, each taking over when the one before fails), and a server of yours. Text
// goes in, text comes out; the settings are the voice section of config.json (voice.js passes them in with init).
const fetch = require('./fetch'),
  { URL } = require('./netcompat');

let cfg = () => ({});
const init = f => {
  cfg = f;
};

// POST JSON; resolves {status, text}. Redirects are not followed.
function request(url, headers, payload, ms, extra) {
  return fetch
    .read(url, {
      method: payload === undefined ? 'GET' : 'POST', // no payload: a GET
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      idleMs: ms || 30000,
      redirects: 0,
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
// voice.llm = { enabled, system, providers: [{ id, type, name, base, key, model, waitS, off }] }
const orApi = () => process.env.CYTV_OPENROUTER || 'https://openrouter.ai/api/v1'; // overridden only by the tests
const LLM_DEFAULTS = { enabled: false, system: '', providers: [] };
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
  return { enabled: !!c.enabled, system: String(c.system || ''), providers: providersOf(c) };
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
// one provider, one question; resolves the answer, or fails with a short reason and its stage (connect, auth, answer, empty, tool)
async function askOne(p, turns, system, ms, maxTokens) {
  let answer = '',
    tool = false;
  for (let attempt = 0; attempt < 2 && !answer; attempt++) {
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
    const or = p.type === 'openrouter',
      headers = or ? { 'HTTP-Referer': 'https://github.com/lasharor/cleanyourtv-WebOS', 'X-Title': 'CleanYourTV' } : {},
      payload = { model: p.model, messages, max_tokens: maxTokens || 500 };
    if (p.key) headers.authorization = 'Bearer ' + p.key; // its own key, never another provider's
    if (or) payload.reasoning = { exclude: true };
    let r;
    try {
      r = await request(apiOf(p) + '/chat/completions', headers, payload, ms, { totalMs: ms, connectMs: CONNECT_MS });
    } catch (e) {
      if (e.code === 'connect' || UNREACHABLE.test(e.code || '')) throw failed('could not connect', 'connect');
      throw failed(e.message, e.code === 'timeout' ? 'answer' : 'connect');
    }
    let o = {};
    try {
      o = JSON.parse(r.text);
    } catch (_) {}
    if (r.status === 401 || r.status === 403) throw failed('refused the key', 'auth');
    if (r.status !== 200 || o.error)
      throw failed(String((o.error && (o.error.message || o.error.code || o.error)) || 'HTTP ' + r.status).slice(0, 160), 'answer');
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
// answered.
async function askLlm(text) {
  const l = llmCfg(),
    list = l.providers.filter(usable);
  if (!list.length) throw new Error(l.providers.length ? 'every AI provider is switched off or has no model' : 'no AI provider is set up');
  if (Date.now() - lastTurn > 600000) history = []; // a new conversation after ten quiet minutes
  const turns = history.concat({ role: 'user', content: text }).slice(-12);
  const system = (l.system || DEFAULT_SYSTEM) + ' Today is ' + new Date().toISOString().slice(0, 10) + '.';
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
      const answer = await askOne(p, turns, system, Math.min(p.waitS * 1000, left));
      note(p, true, Date.now() - t0);
      lastVia = p.id;
      history = turns.concat({ role: 'assistant', content: answer });
      lastTurn = Date.now();
      return { answer, via: p.id, name: p.name, tried };
    } catch (e) {
      note(p, false, Date.now() - t0, e);
      tried.push({ id: p.id, name: p.name, error: e.message });
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
    // for readers from before providers (version 1.6: the manager, scripts): an OpenRouter key is saved, the model that answers first
    hasKey: l.providers.some(p => p.type === 'openrouter' && !!p.key),
    model: (l.providers.filter(usable)[0] || l.providers[0] || { model: 'openrouter/auto' }).model,
  };
};

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
const modelCache = {};
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
          }));
      } catch (e) {
        throw new Error('the model list could not be read');
      }
      const picks = [],
        seen = {};
      if (p.type === 'server') {
        all.sort((a, b) => a.id.localeCompare(b.id));
        return (modelCache[ck] = { at: Date.now(), all, picks: all.slice(0, 40) }); // a server of yours: the models it has
      }
      for (const m of all.slice().sort((a, b) => b.created - a.created)) {
        const prov = m.id.split('/')[0];
        if (m.id.includes(':') || !MAJOR.includes(prov)) continue;
        if ((seen[prov] = (seen[prov] || 0) + 1) <= 3) picks.push(m);
      }
      return (modelCache[ck] = { at: Date.now(), all: all.sort((a, b) => a.id.localeCompare(b.id)), picks });
    });
}

// a new conversation: forget what was said to the model and Assist's conversation
function forget() {
  history = [];
  haConv = null;
}
const forgetHa = () => {
  haConv = null;
};

module.exports = {
  init,
  toServer,
  askLlm,
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
