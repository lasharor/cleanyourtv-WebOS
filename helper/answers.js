// Answers for the voice function (voice.js): Home Assistant's Assist, a language model (through OpenRouter, or a self-hosted server
// with the OpenAI-compatible chat API), and a server of yours. Text
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
    })
    .then(r => ({ status: r.status, text: r.body.toString('utf8') }))
    .catch(e => {
      if (e.code === 'timeout') throw new Error('no answer in time');
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

// ---- chat with a language model (text only; the key and the questions go to OpenRouter, or to the server set as base) ----
// base: '' is OpenRouter; otherwise the address of a self-hosted, OpenAI-compatible chat API (Ollama, LM Studio, llama.cpp's
// llama-server, vLLM and others; for example http://<computer>:11434/v1). Such a server usually needs no key, and gets none of
// OpenRouter's extra fields. key is the OpenRouter key and goes only to OpenRouter; serverKey goes only to the server of yours (it
// may be on plain http on the home network).
const orApi = () => process.env.CYTV_OPENROUTER || 'https://openrouter.ai/api/v1'; // overridden only by the tests
const LLM_DEFAULTS = { enabled: false, key: '', model: 'openrouter/auto', system: '', base: '', serverKey: '' };
const llmCfg = () => Object.assign({}, LLM_DEFAULTS, cfg().llm || {});
const llmApi = l => l.base || orApi();
const llmName = l => (l.base ? 'The AI server' : 'OpenRouter');
const llmReady = l => !!(l.enabled && (l.key || l.base)); // OpenRouter needs a key; a server of yours may not
const llmAuth = l => (l.base ? l.serverKey : l.key); // never the OpenRouter key to another server
const DEFAULT_SYSTEM =
  'You are a voice assistant on a television. You have no tools and no internet access: answer from your own knowledge, and say when something may be out of date. The user speaks to you through the remote control and your answer appears as text on the screen, so keep it short: one to three plain sentences, no markdown, no lists, no emoji. If the speech looks like a recognition mistake, answer what was most likely meant.';
let history = [],
  lastTurn = 0;
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
async function askLlm(text) {
  const l = llmCfg();
  if (!l.key && !l.base) throw new Error('no OpenRouter key or AI server address is set');
  if (Date.now() - lastTurn > 600000) history = []; // a new conversation after ten quiet minutes
  const turns = history.concat({ role: 'user', content: text }).slice(-12);
  const system = (l.system || DEFAULT_SYSTEM) + ' Today is ' + new Date().toISOString().slice(0, 10) + '.';
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
    const headers = l.base ? {} : { 'HTTP-Referer': 'https://github.com/lasharor/cleanyourtv-WebOS', 'X-Title': 'CleanYourTV' },
      payload = { model: l.model, messages, max_tokens: 500 };
    if (llmAuth(l)) headers.authorization = 'Bearer ' + llmAuth(l);
    if (!l.base) payload.reasoning = { exclude: true };
    const r = await request(llmApi(l) + '/chat/completions', headers, payload, 60000);
    let o = {};
    try {
      o = JSON.parse(r.text);
    } catch (_) {}
    if (r.status !== 200 || o.error)
      throw new Error(
        (l.base ? 'The AI server: ' : 'OpenRouter: ') +
          String((o.error && (o.error.message || o.error.code || o.error)) || 'HTTP ' + r.status).slice(0, 160)
      );
    const msg = (o.choices && o.choices[0] && o.choices[0].message) || {},
      raw = String(msg.content || '');
    tool = tool || TOOLISH.test(raw) || !!(msg.tool_calls && msg.tool_calls.length);
    answer = cleanAnswer(raw);
    if (tool && !attempt) answer = ''; // retry once, telling the model it has no tools
  }
  if (!answer)
    throw new Error(
      tool ? 'The model tried to use a tool instead of answering. Choose another model.' : llmName(l) + ' returned an empty answer'
    );
  history = turns.concat({ role: 'assistant', content: answer });
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

// ---- the models: of OpenRouter a short list for the TV and everything for the phone; of a server of yours, everything ----
let modelCache = null;
const MAJOR = ['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'deepseek', 'qwen', 'x-ai'];
function models() {
  const l = llmCfg(),
    api = llmApi(l),
    name = l.base ? 'The AI server' : 'OpenRouter';
  if (modelCache && modelCache.api === api && Date.now() - modelCache.at < 3600000) return Promise.resolve(modelCache);
  const headers = { 'User-Agent': 'cleanyourtv-voice' };
  if (l.base && l.serverKey) headers.authorization = 'Bearer ' + l.serverKey;
  return fetch
    .read(api + '/models', {
      headers,
      idleMs: 15000,
      maxBytes: 8 << 20,
      bigText: 'the model list is too large',
      statusText: st => name + ' answered ' + st,
    })
    .catch(e => {
      throw e.code === 'timeout' ? new Error(name + ' did not answer') : e;
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
      if (l.base) {
        all.sort((a, b) => a.id.localeCompare(b.id));
        return (modelCache = { at: Date.now(), api, all, picks: all.slice(0, 40) }); // a server of yours: the models it has
      }
      for (const m of all.slice().sort((a, b) => b.created - a.created)) {
        const prov = m.id.split('/')[0];
        if (m.id.includes(':') || !MAJOR.includes(prov)) continue;
        if ((seen[prov] = (seen[prov] || 0) + 1) <= 3) picks.push(m);
      }
      return (modelCache = { at: Date.now(), api, all: all.sort((a, b) => a.id.localeCompare(b.id)), picks });
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
  haCfg,
  LLM_DEFAULTS,
  HA_DEFAULTS,
  HA_ROUTES,
};
