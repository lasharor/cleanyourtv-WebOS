// Voice (optional): listens through the remote's microphone, turns the speech into text on the TV and sends that text to an
// address you set. Nothing is recorded or uploaded; only the text leaves the TV, and only to your address. The speech
// recogniser is Moonshine (moonshine-voice, MIT licence), downloaded on request into /media/developer/cleanyourtv/voice and
// removable again. It is a 64-bit program, so it runs through its own copy of the 64-bit C library, which this TV (32-bit
// userland on a 64-bit kernel) does not have. API (loopback only): GET /api/voice/status, POST install | uninstall | set | listen.
const fs = require('fs'),
  http = require('http'),
  path = require('path'),
  cp = require('child_process'),
  crypto = require('crypto'),
  zlib = require('zlib'),
  net = require('net');
const nc = require('./netcompat'),
  { URL, URLSearchParams } = nc;
const answers = require('./answers'),
  { toServer, askLlm, askHa, haTest, haAgents, models, haBase, haReady, llmCfg, haCfg, LLM_DEFAULTS, HA_DEFAULTS, HA_ROUTES } = answers;
const P = require('./paths'),
  luna = require('./luna'),
  exec = require('./exec'),
  fetch = require('./fetch'),
  web = require('./web'),
  i18n = require('./i18n');
const D = P.D,
  V = D + '/voice',
  LIB = V + '/lib',
  MODEL = V + '/model',
  TMP = V + '/tmp';
const SERVICE_DIR = P.SERVICE_DIR,
  ENV = P.ENV;
const SOCKET = '/tmp/voiceinput_remote1.soc',
  RATE = 16000;

// Everything that is downloaded is pinned to a checksum: a changed file is refused.
const SRC = {
  wheel: {
    url: 'https://files.pythonhosted.org/packages/23/1c/cb821747b2a7b40216dd576a62d1ebc77d04fab97064efc97fa460f137ed/moonshine_voice-0.1.5-py3-none-manylinux_2_31_aarch64.whl',
    sha256: '605300afe33eb7920301e73f11e0ea7493770eb655f389ba65be4aa1db8dedd6',
  },
  ubuntu: {
    url: 'https://cdimage.ubuntu.com/ubuntu-base/releases/22.04/release/ubuntu-base-22.04.5-base-arm64.tar.gz',
    sha256: '075d4abd2817a5023ab0a82f5cb314c5ec0aa64a9c0b40fd3154ca3bfdae979f',
  },
  modelBase: 'https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/',
  model: {
    'adapter.ort': '22ecc949e146c49667fda28d102d4e30749a107dc88a396292aa8f277ef1347c',
    'cross_kv.ort': '143a36667b8d05fd9d04e8c337b7ee121f37ef299aea6b3d82bdb3d3401950b4',
    'decoder_kv.ort': '8852553f312adb6c9aa4d17418015049b30f412209ee569d336548c0044627de',
    'encoder.ort': 'a8414e1a5dedf9f2093d7680601dd8a9b0433e7020260eafe0e370ead91134ca',
    'frontend.model.ort': '5121b561417b638afce0c6c31b760e37c93cf97f80d9b0031aad1fe7b6f25d61',
    'frontend.weights.ort': '217da24ac6f522ebf02da8ef288e77d1ac68d50d4a6821433182e4fbf4204bbd',
    'streaming_config.json': '74fe5ddebd63b17caf59e8a3b18c17547ff7bce1642050edbb1c3962674f8950',
    'tokenizer.bin': '6884b35fd6377d4c4d32336a0bc152f36b64d1e45b6503683cdc238250a8472d',
  },
};
const UBUNTU_LIBS = [
  'ld-linux-aarch64.so.1',
  'libc.so.6',
  'libm.so.6',
  'libdl.so.2',
  'libpthread.so.0',
  'librt.so.1',
  'libstdc++.so.6',
  'libgcc_s.so.1',
];

const DEFAULTS = { enabled: false, url: '', token: '', suppressLg: false, llm: {}, ha: {} };
let job = { state: 'idle', message: '', at: 0 },
  listening = false,
  last = null;
let ctx = null;
const setJob = (state, message) => {
  job = { state, message, at: Date.now() };
};
const cfg = () => Object.assign({}, DEFAULTS, ctx.config.get().voice || {});
const installed = () => fs.existsSync(V + '/installed') && fs.existsSync(V + '/cytv-asr');
const dirSize = d => {
  let n = 0;
  try {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f),
        s = fs.lstatSync(p);
      n += s.isDirectory() ? dirSize(p) : s.size;
    }
  } catch (_) {}
  return n;
};
const rmrf = p => {
  try {
    cp.execFileSync('rm', ['-rf', p], { env: ENV });
  } catch (_) {}
};

// ---- downloading ----
async function download(url, file, sha256) {
  const r = await fetch.toFile(url, file, {
    headers: { 'User-Agent': 'cleanyourtv-voice' },
    allowHttp: false,
    redirects: 6,
    idleMs: 30000,
    statusText: st => 'HTTP ' + st + ' from ' + new URL(url).host,
  });
  if (r.sha256 !== sha256) throw new Error('checksum mismatch for ' + path.basename(file) + '; nothing was installed');
}
// the few files we need out of a .whl (a zip)
function unzip(file, want) {
  const b = fs.readFileSync(file),
    out = {};
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  let p = b.readUInt32LE(e + 16);
  for (let i = 0, n = b.readUInt16LE(e + 10); i < n; i++) {
    const method = b.readUInt16LE(p + 10),
      csize = b.readUInt32LE(p + 20),
      nl = b.readUInt16LE(p + 28),
      xl = b.readUInt16LE(p + 30),
      cl = b.readUInt16LE(p + 32),
      off = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nl);
    if (want(name)) {
      const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28),
        data = b.slice(start, start + csize);
      out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    }
    p += 46 + nl + xl + cl;
  }
  return out;
}
const run = (cmd, args, ms) =>
  exec.run(cmd, args, { timeout: ms || 120000, maxBuffer: 4 << 20 }).then(r => {
    if (!r.ok)
      throw new Error(
        String(r.err || r.error)
          .trim()
          .split('\n')
          .pop()
      );
    return r.out;
  });

async function doInstall() {
  rmrf(V);
  nc.mkdirp(TMP);
  nc.mkdirp(LIB);
  nc.mkdirp(MODEL);
  setJob('working', 'Downloading the speech engine (18 MB)');
  await download(SRC.wheel.url, TMP + '/engine.whl', SRC.wheel.sha256);
  const f = unzip(TMP + '/engine.whl', n =>
    /^moonshine_voice\/libmoonshine\.so$|^moonshine_voice\.libs\/libonnxruntime-[\w]+\.so\.1$/.test(n)
  );
  if (Object.keys(f).length !== 2) throw new Error('the engine package has an unexpected layout');
  for (const n of Object.keys(f)) fs.writeFileSync(LIB + '/' + path.basename(n), f[n]);
  rmrf(TMP + '/engine.whl');
  setJob('working', 'Downloading the 64-bit C library (27 MB)');
  await download(SRC.ubuntu.url, TMP + '/base.tgz', SRC.ubuntu.sha256);
  const members = UBUNTU_LIBS.map(l => 'usr/lib/aarch64-linux-gnu/' + l).concat('usr/lib/aarch64-linux-gnu/libstdc++.so.6.0.30');
  await run('tar', ['-xzf', TMP + '/base.tgz', '-C', TMP].concat(members));
  for (const l of UBUNTU_LIBS) fs.copyFileSync(TMP + '/usr/lib/aarch64-linux-gnu/' + l, LIB + '/' + l); // follows the libstdc++ link
  rmrf(TMP);
  let i = 0;
  for (const name of Object.keys(SRC.model)) {
    setJob('working', 'Downloading the speech model (' + ++i + ' of ' + Object.keys(SRC.model).length + ')');
    await download(SRC.modelBase + name, MODEL + '/' + name, SRC.model[name]);
  }
  setJob('working', 'Testing');
  fs.copyFileSync(SERVICE_DIR + '/voice/cytv-asr', V + '/cytv-asr');
  fs.chmodSync(V + '/cytv-asr', 0o755);
  await transcribe(Buffer.alloc(RATE * 2)); // one second of silence: loads the model, so a broken install shows up here
  fs.writeFileSync(
    V + '/installed',
    JSON.stringify({ engine: 'moonshine-voice 0.1.5', model: 'tiny-streaming-en', at: new Date().toISOString() })
  );
}
function install() {
  if (job.state === 'working') return;
  if (!fs.existsSync(SERVICE_DIR + '/voice/cytv-asr')) {
    setJob('error', 'This package has no voice program (cytv-asr); update CleanYourTV first.');
    return;
  }
  setJob('working', 'Starting');
  doInstall().then(
    () => setJob('done', 'Voice is installed'),
    e => {
      rmrf(V);
      setJob('error', 'Install failed: ' + e.message);
    }
  );
}
function uninstall() {
  if (job.state === 'working') return;
  rmrf(V);
  setJob('idle', '');
  ctx.config.update('voice', c => {
    if (c.voice) c.voice.enabled = false;
  });
  syncLg();
}

// ---- recognising: 16 kHz signed 16-bit mono PCM in, text out ----
function transcribe(pcm) {
  return new Promise((resolve, reject) => {
    const ch = cp.spawn(LIB + '/ld-linux-aarch64.so.1', ['--library-path', LIB, V + '/cytv-asr', MODEL], {
      env: Object.assign({}, ENV, { LD_PRELOAD: '' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    const t = setTimeout(() => ch.kill('SIGKILL'), 45000);
    ch.stdout.on('data', d => (out += d));
    ch.stderr.on('data', d => (err += d));
    ch.on('error', e => {
      clearTimeout(t);
      reject(e);
    });
    ch.on('close', code => {
      clearTimeout(t);
      code === 0
        ? resolve(out.trim())
        : reject(
            new Error(
              'the recogniser stopped (' +
                code +
                '): ' +
                err
                  .split('\n')
                  .filter(l => l && !/onnxruntime|libSegFault|ld\.so/.test(l))
                  .pop()
            )
          );
    });
    ch.stdin.on('error', () => {});
    ch.stdin.end(pcm);
  });
}

// ---- listening: the remote's microphone stream of LG's voice service ----
// Ends when the speech has been followed by a short silence, when nobody speaks for a while, or after a hard limit.
const WINDOW = (RATE / 10) * 2,
  SPEECH_LEVEL = 300,
  QUIET_AFTER = 12,
  WAIT_WINDOWS = 70,
  MAX_WINDOWS = 150;
function capture() {
  return new Promise((resolve, reject) => {
    const stream = cp.spawn(
      'luna-send',
      ['-i', '-f', 'luna://com.webos.service.voiceinput/startStreaming', '{"deviceType":"remote","keyType":"thinQtv","subscribe":true}'],
      { env: ENV, stdio: [luna.keepStdinOpen() ? 'pipe' : 'ignore', 'ignore', 'ignore'] }
    );
    const chunks = [];
    let buf = Buffer.alloc(0),
      windows = 0,
      started = -1,
      quiet = 0,
      done = false,
      sock = null,
      tries = 0;
    const finish = err => {
      if (done) return;
      done = true;
      clearInterval(retry);
      try {
        sock && sock.destroy();
      } catch (_) {}
      try {
        stream.kill();
      } catch (_) {}
      if (err) return reject(err);
      resolve(started < 0 ? null : Buffer.concat(chunks).slice(Math.max(0, (started - 3) * WINDOW))); // a little lead-in before the first word
    };
    stream.on('error', finish);
    const t0 = Date.now();
    let got = false;
    const connect = () => {
      tries++;
      const s = net.connect(SOCKET);
      s.on('connect', () => {
        sock = s;
      });
      s.on('error', () => {
        if (tries > 20) finish(new Error('the microphone stream did not open'));
      });
      // the socket file outlives a session: a connection that is closed again before any audio came means the stream was not started yet
      s.on('close', () => {
        if (!got && !done && Date.now() - t0 < 10000) {
          sock = null;
          try {
            s.destroy();
          } catch (_) {}
          return;
        }
        finish();
      });
      s.on('data', d => {
        got = true;
        buf = Buffer.concat([buf, d]);
        while (buf.length >= WINDOW) {
          const w = buf.slice(0, WINDOW);
          buf = buf.slice(WINDOW);
          chunks.push(w);
          windows++;
          let sum = 0;
          for (let i = 0; i < w.length; i += 2) sum += Math.abs(w.readInt16LE(i));
          if (sum / (w.length / 2) > SPEECH_LEVEL) {
            if (started < 0) started = windows - 1;
            quiet = 0;
          } else if (started >= 0) quiet++;
          if ((started >= 0 && quiet >= QUIET_AFTER) || (started < 0 && windows >= WAIT_WINDOWS) || windows >= MAX_WINDOWS) return finish();
        }
      });
    };
    const retry = setInterval(() => {
      if (!sock && !done) connect();
    }, 600);
  });
}

// cards go through the notification part (notify.js)
const show = o => {
  const n = ctx.notify || (ctx.feature && ctx.feature('notify'));
  return n && n.show ? n.show(o, true).catch(() => {}) : Promise.resolve();
};
const readSeconds = t => Math.min(60, Math.max(8, 6 + String(t || '').length / 12)); // time to read an answer on screen

// What happens with recognised (or typed) text: ask the model if switched on, tell your server if set, show the result.
async function respond(text, card) {
  const c = cfg(),
    l = llmCfg(),
    h = haCfg(),
    out = { text };
  const say = o => (card ? show(o) : Promise.resolve());
  const useHa = haReady(h) && h.route !== 'ai-only',
    useAi = l.enabled && l.key && !(useHa && h.route === 'ha-only');
  if (!useHa && !useAi && !c.url) {
    await say({ kind: 'answer', title: 'You said', text, seconds: readSeconds(text) });
    return out;
  }
  if (useHa || useAi) await say({ kind: 'thinking', title: 'Thinking', question: text, text: '', seconds: 90 });
  let haText = '';
  if (useHa) {
    try {
      const r = await askHa(text);
      haText = r.text;
      if (r.understood && r.text) {
        out.answer = r.text;
        out.via = 'ha';
      }
    } catch (e) {
      out.error = 'Home Assistant: ' + e.message;
    }
  }
  if (!out.answer && useAi) {
    try {
      out.answer = await askLlm(text);
      out.via = 'ai';
      if (out.error) out.error = '';
    } catch (e) {
      out.error = (out.error ? out.error + '; ' : '') + e.message;
    }
  }
  if (!out.answer && haText && !out.error) {
    out.answer = haText;
    out.via = 'ha';
  } // Assist did not understand and nothing else can answer: show what it said
  if (c.url) {
    try {
      const r = await toServer(c, { text, answer: out.answer, source: 'cleanyourtv', language: 'en', time: new Date().toISOString() });
      out.sent = true;
      if (r && !out.answer) {
        out.answer = r.text;
        out.card = r;
      }
    } catch (e) {
      out.error = (out.error ? out.error + '; ' : '') + e.message;
    }
  }
  if (out.answer || (out.card && out.card.image))
    await say(
      Object.assign(
        {
          kind: 'answer',
          title: out.via === 'ha' ? 'Home Assistant' : 'Answer',
          question: text,
          text: out.answer || '',
          seconds: readSeconds(out.answer),
        },
        out.card && out.card.image ? { image: out.card.image } : {},
        out.card && out.card.seconds ? { seconds: out.card.seconds } : {}
      )
    );
  else if (out.error) await say({ kind: 'answer', title: 'Not answered', question: text, text: out.error, seconds: 10 });
  else await say({ kind: 'answer', title: 'You said', text, seconds: readSeconds(text) });
  return out;
}

async function listen() {
  if (listening || job.state === 'working') return { started: false, error: listening ? 'already listening' : 'installing' };
  if (!installed()) return { started: false, error: 'voice is not installed' };
  listening = true;
  last = { at: Date.now(), state: 'listening' };
  (async () => {
    try {
      show({ kind: 'listening', title: 'Listening', seconds: 20 });
      const pcm = await capture();
      if (!pcm) {
        last = { at: Date.now(), state: 'nothing heard' };
        return show({ kind: 'answer', title: 'Voice', text: 'I did not hear anything', seconds: 3 });
      }
      show({ kind: 'thinking', title: 'Recognising', seconds: 60 });
      const t0 = Date.now(),
        text = await transcribe(pcm),
        ms = Date.now() - t0;
      if (!text) {
        last = { at: Date.now(), state: 'nothing recognised', ms };
        return show({ kind: 'answer', title: 'Voice', text: 'I could not make out any words', seconds: 4 });
      }
      last = { at: Date.now(), state: 'heard', text, ms };
      const r = await respond(text, true);
      Object.assign(last, { sent: !!r.sent, answer: r.answer, error: r.error });
    } catch (e) {
      last = { at: Date.now(), state: 'error', error: e.message };
      show({ kind: 'answer', title: 'Voice', text: e.message, seconds: 8 });
    } finally {
      listening = false;
    }
  })();
  return { started: true };
}

// LG's own voice assistant (voiceconductor) reacts to the same button and sends the audio to LG's servers. With the switch on it is
// paused (SIGSTOP) while voice is enabled and resumed when voice or the switch is turned off. A paused process holds no memory
// back and a reboot or "resume" always undoes it.
function lgPids() {
  const out = [];
  try {
    for (const p of fs.readdirSync(P.PROC))
      if (/^\d+$/.test(p)) {
        try {
          if (fs.readFileSync(P.PROC + '/' + p + '/comm', 'utf8').trim() === 'voiceconductor') out.push(+p);
        } catch (_) {}
      }
  } catch (_) {}
  return out;
}
function syncLg() {
  const c = cfg(),
    want = !!(c.enabled && c.suppressLg && installed());
  for (const pid of lgPids()) {
    try {
      process.kill(pid, want ? 'SIGSTOP' : 'SIGCONT');
    } catch (_) {}
  }
  return want;
}
const lgPaused = () =>
  lgPids().some(pid => {
    try {
      return /^State:\s+T/m.test(fs.readFileSync(P.PROC + '/' + pid + '/status', 'utf8'));
    } catch (_) {
      return false;
    }
  });

// ---- the settings, from the API or from the phone page ----
function applySet(b) {
  const v = cfg();
  if (typeof b.enabled === 'boolean') v.enabled = b.enabled && installed();
  if (typeof b.url === 'string') {
    const u = b.url.trim().slice(0, 500);
    if (u && !/^https?:\/\/[^\s]+$/.test(u)) return 'the server address must start with http:// or https://';
    v.url = u;
  }
  if (typeof b.token === 'string') v.token = b.token.trim().slice(0, 300);
  if (typeof b.suppressLg === 'boolean') v.suppressLg = b.suppressLg;
  if (b.llm && typeof b.llm === 'object') {
    const l = Object.assign({}, LLM_DEFAULTS, v.llm || {});
    if (typeof b.llm.enabled === 'boolean') l.enabled = b.llm.enabled;
    if (typeof b.llm.key === 'string' && b.llm.key.trim()) l.key = b.llm.key.trim().slice(0, 300);
    if (b.llm.clearKey) {
      l.key = '';
      l.enabled = false;
    }
    if (typeof b.llm.model === 'string' && b.llm.model.trim()) {
      if (!/^[\w.\-:\/~]{1,100}$/.test(b.llm.model.trim())) return 'that model name is not valid';
      l.model = b.llm.model.trim();
    }
    if (typeof b.llm.system === 'string') l.system = b.llm.system.slice(0, 1000);
    if (l.enabled && !l.key) return 'set the OpenRouter key first';
    v.llm = l;
  }
  if (b.ha && typeof b.ha === 'object') {
    const h = Object.assign({}, HA_DEFAULTS, v.ha || {});
    if (b.ha.clear) Object.assign(h, HA_DEFAULTS);
    if (typeof b.ha.url === 'string') {
      const u = b.ha.url.trim();
      if (u && !haBase(u)) return 'the Home Assistant address must start with http:// or https://';
      h.url = u ? haBase(u) : '';
    }
    if (typeof b.ha.token === 'string' && b.ha.token.trim()) h.token = b.ha.token.trim().slice(0, 2000);
    // a token without an address was saved silently before, and the Home Assistant cards then stayed empty
    if (typeof b.ha.token === 'string' && b.ha.token.trim() && !h.url) return 'set the Home Assistant address too';
    if (typeof b.ha.selfSigned === 'boolean') h.selfSigned = b.ha.selfSigned;
    if (typeof b.ha.route === 'string') {
      if (!HA_ROUTES.includes(b.ha.route)) return 'the routing must be one of ' + HA_ROUTES.join(', ');
      h.route = b.ha.route;
    }
    if (typeof b.ha.agent === 'string') {
      if (!/^[\w.\-]{0,100}$/.test(b.ha.agent.trim())) return 'that agent name is not valid';
      h.agent = b.ha.agent.trim();
    }
    if (b.ha.url !== undefined || b.ha.agent !== undefined || b.ha.clear) answers.forgetHa();
    v.ha = h;
  }
  ctx.config.update('voice', c => {
    c.voice = v;
  });
  syncLg();
  return '';
}

// ---- setting up from a phone: a short-lived page on the local network, opened by scanning a QR code on the TV ----
const PAIR_PORT = 8769,
  PAIR_MS = 10 * 60 * 1000;
let pair = null,
  pairedAt = 0;
const esc = web.esc,
  lanIp = web.lanIp;
// only 'ha': the Home Assistant page of the manager (More > Home Assistant), just the address, the token and the certificate; the
// voice page itself only chooses which answers first. Home Assistant stays in voice.ha: Voice and the cards (hacards.js) both use it.
function pairPage(msg, done, list, token, lang, only) {
  const T = x => esc(i18n.tr(lang, x)); // the phone's language (i18n.js)
  const l = llmCfg(),
    c = cfg(),
    ha = haCfg(),
    title = only === 'ha' ? 'Home Assistant' : 'Voice setup';
  const opts = (list || [])
    .map(m => `<option value="${esc(m.id)}">${esc(m.name)}${m.price != null ? ' · $' + m.price + '/M' : ''}</option>`)
    .join('');
  return `<!doctype html><html lang=${lang}><meta name=viewport content="width=device-width,initial-scale=1"><title>${T(title)}</title>
<style>body{font:18px system-ui,sans-serif;background:#111;color:#eee;max-width:560px;margin:32px auto;padding:0 18px}label{display:block;color:#aaa;font-size:15px;margin-top:14px}input,textarea,select,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;margin:6px 0;border-radius:10px;border:1px solid #444;background:#1b1b1f;color:#eee}button{background:#f5f6f8;color:#111;font-weight:600;margin-top:20px}.m{padding:12px;border-radius:10px;background:#1f2a1f}small{color:#888}h2{margin:0 0 8px}.c{display:flex;gap:10px;align-items:center}.c input{width:auto;margin:0}</style>
<h2>${T(title)}</h2>${msg ? `<p class=m>${T(msg)}</p>` : ''}${
    done
      ? ''
      : only === 'ha'
        ? `<form method=post action="/${token}/save">
<label>${T('Home Assistant address')}</label><input name=haurl type=url placeholder="http://homeassistant.local:8123" value="${esc(ha.url)}">
<label>${T('Home Assistant access token')} <small>(${T('a long-lived token from your profile page')}${ha.token ? '; ' + T('one is saved, leave empty to keep it') : ''})</small></label><input name=hatoken type=password autocomplete=off>
<label class=c><input type=checkbox name=hass value=1 ${ha.selfSigned ? 'checked' : ''}> ${T('Accept a self-signed certificate')}</label>
<button>${T('Save')}</button></form>`
        : `<form method=post action="/${token}/save">
<label>${T('OpenRouter key')} ${l.key ? T('(one is saved; leave empty to keep it)') : ''}</label><input name=key type=password autocomplete=off placeholder="sk-or-...">
<label>${T('Model')} <small>${T('choose from the list or type any OpenRouter model name')}</small></label><input name=model list=ml value="${esc(l.model)}" autocomplete=off><datalist id=ml>${opts}</datalist>
<label class=c><input type=checkbox name=enabled value=1 ${l.enabled ? 'checked' : ''}> ${T('Answer with the AI')}</label>
<label>${T('Instructions for the AI')} <small>${T('(empty: short plain answers)')}</small></label><textarea name=system rows=3>${esc(l.system)}</textarea>
<label>${T('Which answers first')}${
            haReady(ha)
              ? ''
              : ` <small>${T('Home Assistant is not set up yet: set its address and token in the manager app, More > Home Assistant.')}</small>`
          }</label><select name=haroute>${[
            ['ha-first', 'Home Assistant first, then the AI'],
            ['ha-only', 'Home Assistant only'],
            ['ai-only', 'The AI only'],
          ]
            .map(x => `<option value="${x[0]}"${ha.route === x[0] ? ' selected' : ''}>${T(x[1])}</option>`)
            .join('')}</select>
<label>${T('Send the text to your own server')} <small>${T('(optional)')}</small></label><input name=url type=url placeholder="http://..." value="${esc(c.url)}">
<label>${T('Server token')} <small>(${T('optional')}${c.token ? '; ' + T('one is saved, leave empty to keep it') : ''})</small></label><input name=token type=password autocomplete=off>
<button>${T('Save')}</button></form>`
  }`;
}
function startPair(only) {
  stopPair();
  only = only === 'ha' ? 'ha' : '';
  const token = crypto.randomBytes(16).toString('hex');
  let hits = 0,
    list = [];
  const srv = http.createServer((req, res) => {
    const send = (c, html) => {
      res.writeHead(c, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    };
    if (++hits > 120) return send(429, 'Too many requests');
    const p = req.url.split('?')[0];
    const lg = i18n.lang(req, ctx.config.get().lang);
    if (req.method === 'GET' && p === '/' + token) return send(200, pairPage('', false, list, token, lg, only));
    if (req.method === 'POST' && p === '/' + token + '/save') {
      let b = '';
      req.on('data', c => {
        b += c;
        if (b.length > 16384) req.destroy();
      });
      req.on('end', () => {
        const f = new URLSearchParams(b);
        /** @type {any} */
        let set;
        if (only === 'ha') {
          set = { ha: { url: f.get('haurl') || '', selfSigned: f.get('hass') === '1' } };
          if (f.get('hatoken')) set.ha.token = f.get('hatoken');
        } else {
          set = {
            llm: { model: f.get('model') || '', system: f.get('system') || '', enabled: f.get('enabled') === '1' },
            url: f.get('url') || '',
            ha: { route: f.get('haroute') || 'ha-first' },
          };
          if (f.get('key')) set.llm.key = f.get('key');
          if (f.get('token')) set.token = f.get('token');
        }
        const err = applySet(set);
        if (err) return send(400, pairPage(err, false, list, token, lg, only));
        pairedAt = Date.now();
        send(200, pairPage('Saved. You can close this page.', true, [], token, lg, only));
        setTimeout(stopPair, 2000);
      });
      return;
    }
    send(404, 'Not found');
  });
  srv.on('error', () => {
    pair = null;
  });
  srv.listen(PAIR_PORT, '0.0.0.0');
  pair = {
    srv,
    token,
    timer: setTimeout(stopPair, PAIR_MS),
    until: Date.now() + PAIR_MS,
    url: 'http://' + lanIp() + ':' + PAIR_PORT + '/' + token,
  };
  models().then(
    m => {
      list = m.all;
    },
    () => {}
  ); // the page still works without the list
  return { url: pair.url, seconds: PAIR_MS / 1000 };
}
function stopPair() {
  if (pair) {
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
}

const status = () => {
  const c = cfg();
  return {
    installed: installed(),
    bytes: installed() || job.state === 'working' ? dirSize(V) : 0,
    enabled: !!c.enabled,
    url: c.url,
    hasToken: !!c.token,
    llm: (l => ({ enabled: !!l.enabled, hasKey: !!l.key, model: l.model }))(llmCfg()),
    ha: (h => ({ configured: haReady(h), url: h.url, hasToken: !!h.token, selfSigned: h.selfSigned, route: h.route, agent: h.agent }))(
      haCfg()
    ),
    suppressLg: !!c.suppressLg,
    lgPaused: lgPaused(),
    listening,
    job,
    last,
    pairing: !!pair,
    pairedAt,
    engine: 'Moonshine tiny (English)',
  };
};

function create(c) {
  ctx = c;
  answers.init(cfg);
  // the voice key of LG's own remote handling follows our setting (syncLg); checked now and then
  const start = () => {
    setInterval(syncLg, 20000);
    setTimeout(syncLg, 5000);
  };
  return { name: 'voice', prefix: '/api/voice/', handle, start, status, installed, listen, syncLg };
}
async function handle(req, res, u, body) {
  const json = (o, code) => {
    res.writeHead(code || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  const act = u.replace('/api/voice/', '');
  if (act === 'status') return json(status());
  if (act === 'models') {
    try {
      const m = await models();
      return json({ picks: m.picks.map(x => ({ id: x.id, name: x.name, price: x.price })), count: m.all.length });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  if (req.method !== 'POST') {
    res.writeHead(404);
    return res.end();
  }
  if (act === 'install') {
    install();
    return json(status());
  }
  if (act === 'uninstall') {
    uninstall();
    return json(status());
  }
  if (act === 'listen') return json(await listen());
  if (act === 'ha-test') {
    try {
      return json(await haTest());
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  if (act === 'ha-agents') {
    try {
      return json({ agents: await haAgents() });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  if (act === 'forget') {
    answers.forget();
    return json({ returnValue: true });
  }
  if (act === 'pair') return json(startPair((await body(req)).only));
  if (act === 'pair-stop') {
    stopPair();
    return json({ returnValue: true });
  }
  if (act === 'ask') {
    // text in, text out: the same path as speech, for a phone, a script or Home Assistant
    const b = await body(req),
      text = String(b.text || '')
        .trim()
        .slice(0, 1000);
    if (!text) return json({ error: 'send {"text": "..."}' }, 400);
    const l = llmCfg();
    if (!(l.enabled && l.key) && !cfg().url && !haReady(haCfg()))
      return json({ error: 'no destination: set up Home Assistant, switch on the AI chat or set a server address' }, 400);
    const r = await respond(text, b.card !== false);
    return json({ text: r.text, answer: r.answer || '', via: r.via || '', error: r.error || '' });
  }
  if (act === 'set') {
    const err = applySet(await body(req));
    return err ? json({ error: err }, 400) : json(status());
  }
  res.writeHead(404);
  res.end();
}
module.exports = { create };
