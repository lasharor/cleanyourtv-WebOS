// Voice (optional): listens through the remote's microphone, turns the speech into text on the TV and sends that text to an
// address you set. Nothing is recorded or uploaded; only the text leaves the TV, and only to your address. The speech
// recogniser is Moonshine (moonshine-voice, MIT licence), downloaded on request into /media/developer/cleanyourtv/voice and
// removable again. On a 64-bit kernel it is a 64-bit program (cytv-asr), so it runs through its own copy of the 64-bit C library, which
// the TV (32-bit userland on a 64-bit kernel) does not have. On a 32-bit ARM kernel (issue 175) the recogniser is cytv-asr32 with
// sherpa-onnx (Apache-2.0) and the Moonshine tiny English model; it is a hard-float program, and the TV's own 32-bit programs are
// soft-float, so it brings its own 32-bit hard-float C library too. API (loopback only): GET /api/voice/status, POST install |
// uninstall | set | listen.
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
  {
    toServer,
    askLlm,
    askHa,
    haTest,
    haAgents,
    models,
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
    haCfg,
    HA_DEFAULTS,
    HA_ROUTES,
  } = answers;
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
// Where LG's voice service puts the remote's audio when its reply does not say: /tmp on the G2; the 65UR91 (webOS 25 on a 2023 board) answers with
// /var/voiceinput/voiceinput_remote1.soc, so the path in the reply always wins.
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

// The 32-bit engine (cytv-asr32, voice/asr32.c): sherpa-onnx's C library and ONNX Runtime (hard-float), the hard-float C library of
// ubuntu-base for armhf, and the Moonshine tiny English model (MIT) as sherpa-onnx publishes it, at a fixed revision.
const SRC32 = {
  wheel: {
    url: 'https://files.pythonhosted.org/packages/2a/d3/6793600ab1d256c57f4f03d08df15e8a56ea96605e4db7b4f96e8275be8a/sherpa_onnx_core-2.0.1-py3-none-manylinux_2_35_armv7l.whl',
    sha256: 'c6ee74dffb4acf81f5fb26e1d45560baa6fd5c34bc192546b50c744005eb9702',
  },
  ubuntu: {
    url: 'https://cdimage.ubuntu.com/ubuntu-base/releases/22.04/release/ubuntu-base-22.04.5-base-armhf.tar.gz',
    sha256: 'fd77cb0659326b75c08ce06b6b8649d2e13ef9a704a8e9212fec32cb97d42add',
  },
  modelBase:
    'https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27/resolve/d1e6c30921780b8508d04b492dfb3ce8a51605d4/',
  model: {
    'encoder_model.ort': '94e90a4654fc45cdfedb77c4c08e1739f48862998e58fada384b25118134f221',
    'decoder_model_merged.ort': 'cf524c4862d36e9e5ab032eddc73637efd822d70e868ac575cf1a46e1e4708a0',
    'tokens.txt': '2870d843e14c1e187bf1913a521562a63b53933814bd7f2145120468f494a049',
  },
};
const UBUNTU_LIBS32 = UBUNTU_LIBS.map(l => (l === 'ld-linux-aarch64.so.1' ? 'ld-linux-armhf.so.3' : l));

const DEFAULTS = { enabled: false, url: '', token: '', suppressLg: false, llm: {}, ha: {} };
let job = { state: 'idle', message: '', at: 0 },
  listening = false,
  last = null;
let ctx = null;
const setJob = (state, message) => {
  job = { state, message, at: Date.now() };
};
const cfg = () => Object.assign({}, DEFAULTS, ctx.config.get().voice || {});
// which recogniser is installed: the 32-bit one (cytv-asr32) or the 64-bit one (cytv-asr)
const is32 = () => fs.existsSync(V + '/cytv-asr32');
const installed = () => fs.existsSync(V + '/installed') && (is32() || fs.existsSync(V + '/cytv-asr'));

// The 64-bit recogniser (cytv-asr) needs a 64-bit kernel: the programs of the TV can be 32-bit (they are on the G2), but a TV whose
// kernel is 32-bit ARM (uname -m: armv7l, as on the 43UP7550PTZ, issue 175) cannot start it at all (the shell then reads the 64-bit
// loader as a script and reports "syntax error: unexpected word"). Such a TV gets the 32-bit recogniser (cytv-asr32), built for ARMv7;
// an older 32-bit ARM core (armv6 and before) cannot run that either, and nothing is downloaded there. The kernel is asked once, before
// anything is downloaded. A kernel that says armv8l or aarch64 is 64-bit (a 32-bit program on a 64-bit kernel is told armv8l); other
// machines (a computer running the tests) are not judged. CYTV_KERNEL_ARCH stands in for uname in the tests.
let kernel = process.env.CYTV_KERNEL_ARCH || '';
function kernelArch() {
  if (kernel) return Promise.resolve(kernel);
  return exec.run('uname', ['-m'], { timeout: 5000 }).then(r => (kernel = r.ok ? r.out.trim() : ''));
}
const kernel32 = k => /^arm(v[1-7]\w*)?$/.test(k || '');
const kernelV7 = k => /^armv7\w*$/.test(k || '');
const unsupported = () =>
  kernel32(kernel) && !kernelV7(kernel)
    ? 'Voice needs an ARMv7 or newer processor. The kernel of this TV is ' + kernel + ', so the speech recogniser cannot run on it.'
    : '';
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
  await downloadModel(SRC);
  await finish('cytv-asr', { engine: 'moonshine-voice 0.1.5', model: 'tiny-streaming-en' });
}
// a 32-bit ARM kernel: sherpa-onnx with Moonshine tiny, and the hard-float C library it needs (the TV's own is soft-float)
async function doInstall32() {
  rmrf(V);
  nc.mkdirp(TMP);
  nc.mkdirp(LIB);
  nc.mkdirp(MODEL);
  setJob('working', 'Downloading the speech engine (9 MB)');
  await download(SRC32.wheel.url, TMP + '/engine.whl', SRC32.wheel.sha256);
  const f = unzip(TMP + '/engine.whl', n => /^sherpa_onnx\/lib\/lib(sherpa-onnx-c-api|onnxruntime)\.so$/.test(n));
  if (Object.keys(f).length !== 2) throw new Error('the engine package has an unexpected layout');
  for (const n of Object.keys(f)) fs.writeFileSync(LIB + '/' + path.basename(n), f[n]);
  rmrf(TMP + '/engine.whl');
  setJob('working', 'Downloading the 32-bit C library (26 MB)');
  await download(SRC32.ubuntu.url, TMP + '/base.tgz', SRC32.ubuntu.sha256);
  const L = 'usr/lib/arm-linux-gnueabihf/';
  await run(
    'tar',
    ['-xzf', TMP + '/base.tgz', '-C', TMP].concat(
      UBUNTU_LIBS32.map(l => L + l),
      L + 'libstdc++.so.6.0.30'
    )
  );
  for (const l of UBUNTU_LIBS32) fs.copyFileSync(TMP + '/' + L + l, LIB + '/' + l); // follows the libstdc++ link
  rmrf(TMP);
  await downloadModel(SRC32);
  await finish('cytv-asr32', { engine: 'sherpa-onnx 2.0.1', model: 'moonshine-tiny-en-quantized-2026-02-27' });
}
async function downloadModel(src) {
  let i = 0;
  for (const name of Object.keys(src.model)) {
    setJob('working', 'Downloading the speech model (' + ++i + ' of ' + Object.keys(src.model).length + ')');
    await download(src.modelBase + name, MODEL + '/' + name, src.model[name]);
  }
}
async function finish(program, info) {
  setJob('working', 'Testing');
  fs.copyFileSync(SERVICE_DIR + '/voice/' + program, V + '/' + program);
  fs.chmodSync(V + '/' + program, 0o755);
  await transcribe(Buffer.alloc(RATE * 2)); // one second of silence: loads the model, so a broken install shows up here
  fs.writeFileSync(V + '/installed', JSON.stringify(Object.assign(info, { at: new Date().toISOString() })));
}
function install() {
  if (job.state === 'working') return;
  setJob('working', 'Starting');
  // the kernel is asked first: nothing is downloaded for a TV that cannot run the recogniser
  kernelArch()
    .catch(() => '')
    .then(() => {
      if (unsupported()) throw new Error(unsupported());
      const program = kernelV7(kernel) ? 'cytv-asr32' : 'cytv-asr';
      if (!fs.existsSync(SERVICE_DIR + '/voice/' + program))
        throw new Error('This package has no voice program (' + program + '); update CleanYourTV first.');
      return program === 'cytv-asr32' ? doInstall32() : doInstall();
    })
    .then(
      () => setJob('done', 'Voice is installed'),
      e => {
        rmrf(V);
        setJob('error', unsupported() || /^This package has no voice program/.test(e.message) ? e.message : 'Install failed: ' + e.message);
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
// both programs start through the loader of their own C library; cytv-asr32 is told two threads (no faster with four on the test TV)
const recogniser = () =>
  is32()
    ? { file: LIB + '/ld-linux-armhf.so.3', args: ['--library-path', LIB, V + '/cytv-asr32', MODEL, '2'] }
    : { file: LIB + '/ld-linux-aarch64.so.1', args: ['--library-path', LIB, V + '/cytv-asr', MODEL] };
function transcribe(pcm) {
  return new Promise((resolve, reject) => {
    const r = recogniser();
    const ch = cp.spawn(r.file, r.args, {
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
  MAX_WINDOWS = 150,
  REFUSED_FOR = 8000, // LG's service refuses the stream until the mic button is held: it is asked again for this long
  CAPTURE_LIMIT = 25000,
  NO_REPLY = 1500;
const HOLD = "Hold the remote's mic button while you speak";

// One reply of the stream subscription (luna-send -i prints one JSON object per line): where the audio is, or that it was refused.
function streamReply(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch (_) {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  if (o.returnValue === false) return { error: ((o.errorCode || '') + ' ' + (o.errorText || '')).trim() || 'refused' };
  return { socket: typeof o.socketPath === 'string' ? o.socketPath : '' };
}

function capture() {
  const spawn = ctx.spawn || cp.spawn,
    connectTo = ctx.connect || net.connect;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let buf = Buffer.alloc(0),
      windows = 0,
      started = -1,
      quiet = 0,
      done = false,
      sock = null,
      tries = 0,
      stream = null,
      socket = '',
      since = 0,
      again = null;
    const stop = () => {
      try {
        stream && stream.kill();
      } catch (_) {}
      stream = null;
    };
    const finish = err => {
      if (done) return;
      done = true;
      clearInterval(retry);
      clearTimeout(again);
      clearTimeout(limit);
      clearTimeout(fallback);
      try {
        sock && sock.destroy();
      } catch (_) {}
      stop();
      if (err) return reject(err);
      resolve(started < 0 ? null : Buffer.concat(chunks).slice(Math.max(0, (started - 3) * WINDOW))); // a little lead-in before the first word
    };
    const t0 = Date.now();
    // the reply says where the audio is; a refusal (errorCode 10000 while the mic button is not held) is asked again for a while
    const open = () => {
      const p = spawn(
        'luna-send',
        ['-i', 'luna://com.webos.service.voiceinput/startStreaming', '{"deviceType":"remote","keyType":"thinQtv","subscribe":true}'],
        { env: ENV, stdio: [luna.keepStdinOpen() ? 'pipe' : 'ignore', 'pipe', 'ignore'] }
      );
      stream = p;
      p.on('error', finish);
      let out = '';
      p.stdout.on('data', d => {
        out += d;
        let i;
        while ((i = out.indexOf('\n')) >= 0) {
          const r = streamReply(out.slice(0, i));
          out = out.slice(i + 1);
          if (!r || done || p !== stream) continue;
          if (r.error) {
            if (socket) continue; // the stream is open already
            refusedOnce = true;
            stop();
            if (Date.now() - t0 < (ctx.refusedFor || REFUSED_FOR)) again = setTimeout(open, 700);
            else finish(new Error(HOLD));
            return;
          }
          if (!socket) {
            socket = r.socket || SOCKET;
            since = Date.now();
          }
        }
      });
    };
    const limit = setTimeout(() => finish(), CAPTURE_LIMIT);
    // no reply that can be read (another luna-send, another firmware): the old fixed place, as before the reply was read
    let refusedOnce = false;
    const fallback = setTimeout(() => {
      if (!socket && !refusedOnce && !done) {
        socket = SOCKET;
        since = Date.now();
      }
    }, NO_REPLY);
    let got = false;
    const connect = () => {
      tries++;
      const s = connectTo(socket);
      s.on('connect', () => {
        sock = s;
      });
      s.on('error', () => {
        if (tries > 20) finish(new Error('the microphone stream did not open (' + socket + ')'));
      });
      // the socket file outlives a session: a connection that is closed again before any audio came means the stream was not started yet
      s.on('close', () => {
        if (!got && !done && Date.now() - since < 10000) {
          sock = null;
          try {
            s.destroy();
          } catch (_) {}
          return;
        }
        finish(got ? null : new Error('no audio came from the microphone stream (' + socket + ')'));
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
      if (socket && !sock && !done) connect();
    }, 600);
    open();
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
    useAi = llmReady(l) && !(useHa && h.route === 'ha-only');
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
  let aiFailed = false;
  if (!out.answer && useAi) {
    try {
      // the cards do not say which provider answers or is asked; the reply does (provider, tried)
      const r = await askLlm(text);
      out.answer = r.answer;
      out.via = 'ai';
      out.provider = r.via;
      out.tried = r.tried;
      if (out.error) out.error = '';
    } catch (e) {
      aiFailed = !!e.tried;
      out.tried = e.tried || [];
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
  else if (out.error)
    await say(
      Object.assign(
        { kind: 'answer', title: 'Not answered', question: text, text: out.error, seconds: aiFailed ? 12 : 10 },
        aiFailed ? { foot: 'Check them in the manager app: Voice › AI providers' } : {}
      )
    );
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
      last = { at: Date.now(), state: 'recognising' }; // the phone remote's mic follows these steps
      const t0 = Date.now(),
        text = await transcribe(pcm),
        ms = Date.now() - t0;
      if (!text) {
        last = { at: Date.now(), state: 'nothing recognised', ms };
        return show({ kind: 'answer', title: 'Voice', text: 'I could not make out any words', seconds: 4 });
      }
      last = { at: Date.now(), state: 'heard', text, ms };
      const r = await respond(text, true);
      Object.assign(last, { sent: !!r.sent, answer: r.answer, via: r.via || '', error: r.error });
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
// The AI providers (answers.js): change or add one (provider), remove one, reorder (order, first), or replace the whole list
// (providers, from the phone page). A key left empty keeps that provider's own saved key, never another provider's. Returns the
// new llm settings, or the reason they are refused. The settings written before providers existed are moved into the list here.
const MAX_PROVIDERS = 8;
const sameAddress = b => String(b).toLowerCase().replace(/\/+$/, '').replace(/\/v1$/, '');
function applyLlm(cur, b) {
  const raw = Object.assign({ enabled: false, system: '' }, cur || {}); // no default list: an old setting has none yet
  let list = providersOf(raw);
  // only fields of this branch's unreleased single-server step are refused; key, model and clearKey (versions 1.6 and before) still work
  for (const k of ['base', 'serverKey', 'clearServerKey'])
    if (b[k] !== undefined) return 'the AI settings are a list of providers now: use "providers" or "provider" (docs/voice.md)';
  const pendingModel = list.some(p => p.type === 'openrouter') ? '' : raw.model || ''; // a model set before the OpenRouter key
  if (typeof b.enabled === 'boolean') raw.enabled = b.enabled;
  if (typeof b.system === 'string') raw.system = b.system.slice(0, 1000);
  const saved = {};
  list.forEach(p => (saved[p.id] = p));
  const newId = taken => {
    let id;
    do id = crypto.randomBytes(2).toString('hex');
    while (saved[id] || taken.some(p => p.id === id));
    return id;
  };
  // one provider: old is its saved settings (none: a new one), d the change
  const change = (old, d, taken) => {
    if (!d || typeof d !== 'object') return 'a provider must be an object';
    if (old && d.type && d.type !== old.type) return 'the type of a provider cannot change';
    if (!old && d.type !== 'openrouter' && d.type !== 'server') return 'the type of a provider must be openrouter or server';
    const p = old
      ? Object.assign({}, old)
      : { id: newId(taken), type: d.type, name: '', base: '', key: '', model: '', waitS: 0, off: false };
    if (typeof d.name === 'string') p.name = d.name.trim().slice(0, 40);
    if (p.type === 'server' && typeof d.base === 'string') {
      const u = d.base.trim().slice(0, 300),
        base = u ? haBase(u) : '';
      if (!base) return 'enter an http:// or https:// address';
      if (old && base !== old.base && old.name === hostOf(old.base) && typeof d.name !== 'string') p.name = ''; // the default name follows the address
      p.base = base;
    }
    if (typeof d.key === 'string' && d.key.trim()) p.key = d.key.trim().slice(0, 300);
    if (d.clearKey) p.key = '';
    if (typeof d.model === 'string' && d.model.trim()) {
      if (!/^[\w.\-:\/~]{1,100}$/.test(d.model.trim())) return 'that model name is not valid';
      p.model = d.model.trim();
    }
    if (d.waitS !== undefined) {
      if (WAITS.indexOf(+d.waitS) < 0) return 'the wait must be one of ' + WAITS.join(', ') + ' seconds';
      p.waitS = +d.waitS;
    }
    if (typeof d.off === 'boolean') p.off = d.off;
    if (p.type === 'openrouter' && !p.key) return 'OpenRouter needs a key';
    if (p.type === 'server' && !p.base) return 'enter the address of your server';
    const q = provider(p);
    q.name = p.name; // kept empty when none was given: the default (OpenRouter, or the server's host) is derived when read, so it follows a new address
    return q;
  };
  // The calls from before providers (scripts, the docs of version 1.6: {"llm":{"key":"sk-or-...","model":"..."}}, clearKey) act on
  // the OpenRouter provider: key adds it or changes its key, clearKey removes it, model changes its model (without one: the
  // first provider's, else it waits for the key).
  const legacyOr = () => list.filter(p => p.type === 'openrouter')[0];
  if (typeof b.model === 'string' && b.model.trim() && !/^[\w.\-:\/~]{1,100}$/.test(b.model.trim())) return 'that model name is not valid';
  const legacyModel = typeof b.model === 'string' ? b.model.trim() : '';
  if (typeof b.key === 'string' && b.key.trim()) {
    const or = legacyOr();
    if (or) list = list.map(p => (p === or ? Object.assign({}, p, { key: b.key.trim().slice(0, 300) }) : p));
    else if (list.length >= MAX_PROVIDERS) return 'at most ' + MAX_PROVIDERS + ' AI providers';
    else
      list = list.concat(
        provider({
          id: newId(list),
          type: 'openrouter',
          key: b.key.trim().slice(0, 300),
          model: legacyModel || pendingModel || 'openrouter/auto',
        })
      );
  }
  if (b.clearKey) {
    list = list.filter(p => p.type !== 'openrouter');
    if (b.enabled === undefined && !list.some(usable)) raw.enabled = false; // as before: no key, no AI chat
  }
  if (legacyModel) {
    const or = legacyOr() || (list.length ? list[0] : null);
    if (or) list = list.map(p => (p === or ? Object.assign({}, p, { model: legacyModel }) : p));
    else raw.model = legacyModel; // kept for when the OpenRouter key comes
  }
  if (Array.isArray(b.providers)) {
    if (b.providers.length > MAX_PROVIDERS) return 'at most ' + MAX_PROVIDERS + ' AI providers';
    const out = [];
    for (const d of b.providers) {
      const old = d && d.id ? saved[d.id] : null;
      if (d && d.id && !old) return 'no such AI provider';
      const r = change(old, d, out);
      if (typeof r === 'string') return r;
      out.push(r);
    }
    list = out;
  }
  if (b.provider) {
    const d = b.provider,
      old = d && d.id ? saved[d.id] : null;
    if (d && d.id && !old) return 'no such AI provider';
    if (!old && list.length >= MAX_PROVIDERS) return 'at most ' + MAX_PROVIDERS + ' AI providers';
    const r = change(old, d, list);
    if (typeof r === 'string') return r;
    list = old ? list.map(p => (p.id === r.id ? r : p)) : list.concat(r);
  }
  if (b.remove !== undefined) {
    if (!list.some(p => p.id === b.remove)) return 'no such AI provider';
    list = list.filter(p => p.id !== b.remove);
  }
  if (b.order !== undefined) {
    const ids = list.map(p => p.id);
    if (!Array.isArray(b.order) || b.order.length !== ids.length || !ids.every(i => b.order.indexOf(i) >= 0))
      return 'the order must name every AI provider once';
    list = b.order.map(i => list.filter(p => p.id === i)[0]);
  }
  if (b.first !== undefined) {
    const p = list.filter(x => x.id === b.first)[0];
    if (!p) return 'no such AI provider';
    list = [p].concat(list.filter(x => x !== p));
  }
  if (list.filter(p => p.type === 'openrouter').length > 1) return 'OpenRouter can be in the list only once';
  const seen = {};
  for (const p of list)
    if (p.type === 'server') {
      if (seen[sameAddress(p.base)]) return 'that address is already in the list';
      seen[sameAddress(p.base)] = 1;
    }
  if (raw.enabled && !list.some(usable)) {
    if (b.enabled === true) return 'add an AI provider first, or switch one on';
    raw.enabled = false; // the last one that could answer was removed or switched off
  }
  raw.providers = list;
  // A service from before providers (after going back to the previous version in the manager) reads llm.key and llm.model: they
  // keep the OpenRouter provider's, so OpenRouter still answers there. This service reads only providers once they exist.
  ['base', 'serverKey'].forEach(k => delete raw[k]);
  const or = list.filter(p => p.type === 'openrouter')[0];
  if (or) {
    raw.key = or.key;
    raw.model = or.model;
  } else delete raw.key;
  return raw;
}
// A provider from the phone page or the API: a saved one by id, with any unsaved values over it (a draft). The key: the draft's own,
// else the saved key of that same provider, never another provider's.
function draftProvider(o) {
  const d = o && typeof o === 'object' ? o : {},
    saved = llmCfg().providers.filter(p => p.id && p.id === d.id)[0];
  const p = Object.assign({}, saved || { type: d.type === 'openrouter' ? 'openrouter' : 'server' });
  if (typeof d.base === 'string' && p.type === 'server') p.base = haBase(d.base.trim()) || '';
  if (typeof d.model === 'string' && /^[\w.\-:\/~]{1,100}$/.test(d.model.trim())) p.model = d.model.trim();
  if (typeof d.key === 'string' && d.key.trim()) p.key = d.key.trim().slice(0, 300);
  else if (!saved) p.key = '';
  if (!saved) p.id = ''; // a draft's result is not kept
  return p;
}

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
  let llm = null;
  if (b.llm && typeof b.llm === 'object') {
    llm = applyLlm(v.llm, b.llm);
    if (typeof llm === 'string') return llm;
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
  if (llm) v.llm = llm;
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
// The phone pages, served on the local network while the setup QR code shows (startPair). The voice page edits the AI providers as
// cards (order, add, remove, a test and the model list of each, read live from that provider) and saves everything at once with
// a JSON POST; keys are never sent to the phone, a key left empty stays as saved. only 'ha': the Home Assistant page of the
// manager (More > Home Assistant), just the address, the token and the certificate. Home Assistant stays in voice.ha: Voice and the
// cards (hacards.js) both use it.
function pairPage(msg, done, token, lang, only) {
  const T = x => esc(i18n.tr(lang, x)); // the phone's language (i18n.js)
  const c = cfg(),
    ha = haCfg(),
    title = only === 'ha' ? 'Home Assistant' : 'Voice setup';
  const head = `<!doctype html><html lang=${lang}><meta name=viewport content="width=device-width,initial-scale=1"><title>${T(title)}</title>
<style>body{font:18px system-ui,sans-serif;background:#111;color:#eee;max-width:560px;margin:32px auto;padding:0 18px}label{display:block;color:#aaa;font-size:15px;margin-top:14px}input,textarea,select,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;margin:6px 0;border-radius:10px;border:1px solid #444;background:#1b1b1f;color:#eee}button{background:#f5f6f8;color:#111;font-weight:600;margin-top:20px}.m{padding:12px;border-radius:10px;background:#1f2a1f}.e{color:#ff9a8a;font-size:14px;margin:2px 0 0}.bad{border-color:#ff9a8a}small{color:#888}h2{margin:0 0 8px}.c{display:flex;gap:10px;align-items:center}.c input{width:auto;margin:0}
.card{border:1px solid #444;border-radius:14px;padding:14px 16px 16px;margin:14px 0;background:#18181c}.card input,.card select{background:#111}.top{display:flex;align-items:center;gap:8px}.n{width:30px;height:30px;border-radius:15px;background:#2a2a31;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:none}.t{flex:1;min-width:0}.t b{display:block}.t span{font-size:13px;color:#aaa}.t span.f{color:#9be3b0}.ib{width:44px;height:44px;padding:0;margin:0;flex:none;background:transparent;color:#eee;font-weight:400}.ib:disabled{opacity:.3}.ask{display:flex;gap:8px;align-items:center;padding:10px 12px;border-radius:10px;background:#2a1b1b;margin-top:10px;font-size:15px}.ask span{flex:1;color:#ff9a8a}.ask button{width:auto;margin:0;padding:8px 14px}.sec{background:transparent;color:#eee;border:1px solid #444}.add{display:flex;gap:10px}.add button{background:transparent;color:#eee;border:1px dashed #666;margin-top:6px}.ok{padding:10px 12px;border-radius:10px;font-size:15px;margin-top:4px;background:#1f2a1f;color:#9be3b0}.no{padding:10px 12px;border-radius:10px;font-size:15px;margin-top:4px;background:#2a1b1b;color:#ff9a8a}</style>
<h2>${T(title)}</h2>${msg ? `<p class=m>${T(msg)}</p>` : ''}`;
  if (done) return head;
  if (only === 'ha')
    return `${head}<form method=post action="/${token}/save">
<label>${T('Home Assistant address')}</label><input name=haurl type=url placeholder="http://homeassistant.local:8123" value="${esc(ha.url)}">
<label>${T('Home Assistant access token')} <small>(${T('a long-lived token from your profile page')}${ha.token ? '; ' + T('one is saved, leave empty to keep it') : ''})</small></label><input name=hatoken type=password autocomplete=off>
<label class=c><input type=checkbox name=hass value=1 ${ha.selfSigned ? 'checked' : ''}> ${T('Accept a self-signed certificate')}</label>
<button>${T('Save')}</button></form>`;
  const l = llmCfg();
  // what the page needs: the providers without their keys, the texts in the phone's language
  const data = {
    token,
    providers: l.providers.map(p => ({
      id: p.id,
      type: p.type,
      name: p.name,
      base: p.base,
      model: p.model,
      waitS: p.waitS,
      off: p.off,
      hasKey: !!p.key,
    })),
    waits: WAITS,
    max: MAX_PROVIDERS,
    s: {},
  };
  [
    'Your own server',
    'OpenRouter',
    'Answers first',
    'If the one above does not answer',
    'Move up',
    'Move down',
    'Remove',
    'Remove this provider?',
    'Yes',
    'No',
    'Address',
    'Name',
    'optional',
    'API key',
    '(one is saved; leave empty to keep it)',
    '(only if your server asks for one; most do not)',
    'usually ends in /v1',
    'Remove the saved key',
    'Model',
    'read from your server',
    'Reading models…',
    'Could not read the model list: %s. Type the model name.',
    'Wait for an answer',
    '%d s',
    'Test',
    'Testing…',
    'Answered in %s s',
    'Use this provider',
    'Enter an http:// or https:// address',
    'This address is already in the list',
    'OpenRouter needs a key',
    'Choose a model',
    'Saved. You can close this page.',
    'No AI provider yet: add OpenRouter or a server of your own.',
    'no connection to the TV',
  ].forEach(k => (data.s[k] = i18n.tr(lang, k)));
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `${head}<div id=main><p style="color:#aaa;font-size:15px;margin:0">${T('AI providers are asked from the top. If one does not answer, the next one is asked.')}</p>
<div id=cards></div>
<div class=add><button type=button id=addor>+ ${T('OpenRouter')}</button><button type=button id=addsrv>+ ${T('Your own server')}</button></div>
<label class=c><input type=checkbox id=enabled ${l.enabled ? 'checked' : ''}> ${T('Answer with the AI')}</label>
<label>${T('Instructions for the AI')} <small>${T('(empty: short plain answers)')}</small></label><textarea id=system rows=3>${esc(l.system)}</textarea>
<label>${T('Which answers first')}${
    haReady(ha)
      ? ''
      : ` <small>${T('Home Assistant is not set up yet: set its address and token in the manager app, More > Home Assistant.')}</small>`
  }</label><select id=haroute>${[
    ['ha-first', 'Home Assistant first, then the AI'],
    ['ha-only', 'Home Assistant only'],
    ['ai-only', 'The AI only'],
  ]
    .map(x => `<option value="${x[0]}"${ha.route === x[0] ? ' selected' : ''}>${T(x[1])}</option>`)
    .join('')}</select>
<label>${T('Send the text to your own server')} <small>${T('(optional)')}</small></label><input id=url type=url placeholder="http://..." value="${esc(c.url)}">
<label>${T('Server token')} <small>(${T('optional')}${c.token ? '; ' + T('one is saved, leave empty to keep it') : ''})</small></label><input id=token type=password autocomplete=off>
<p class=e id=err></p><button type=button id=save>${T('Save')}</button></div>
<script>var D=${json};
(function(){var S=D.s,list=D.providers.map(function(p){return Object.assign({key:'',clearKey:false,models:null,mErr:'',res:null,err:{},ask:false},p)}),n=0;
function tx(k,v){return String(S[k]||k).replace(/%[sd]/,v)}
function el(t,a,k){var e=document.createElement(t);for(var x in a||{}){if(x==='text')e.textContent=a[x];else if(x.slice(0,2)==='on')e.addEventListener(x.slice(2),a[x]);else e.setAttribute(x,a[x])}(k||[]).forEach(function(c){if(c)e.appendChild(c)});return e}
function post(path,body){return fetch('/'+D.token+'/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()})}
function draft(p){return{id:p.id,type:p.type,base:p.base,key:p.key,model:p.model}}
function same(b){return String(b).toLowerCase().replace(/\\/+$/,'').replace(/\\/v1$/,'')}
function check(p){var e={};if(p.type==='server'){if(!/^https?:\\/\\/\\S+$/.test(p.base))e.base=tx('Enter an http:// or https:// address');else if(list.some(function(q){return q!==p&&q.type==='server'&&same(q.base)===same(p.base)}))e.base=tx('This address is already in the list')}
if(p.type==='openrouter'&&!p.key&&(!p.hasKey||p.clearKey))e.key=tx('OpenRouter needs a key');if(!p.model)e.model=tx('Choose a model');p.err=e;return!Object.keys(e).length}
function loadModels(p){if(p.type==='server'&&!/^https?:\\/\\/\\S+$/.test(p.base))return;p.models=null;p.mErr='';p.loading=true;draw();post('models',draft(p)).then(function(r){p.loading=false;if(r.error)p.mErr=r.error;else{p.models=r.models;if(!p.model&&r.models.length)p.model=r.models[0].id}draw()},function(){p.loading=false;p.mErr=tx('no connection to the TV');draw()})}
function field(p,label,hint,input,errKey){return el('div',{},[el('label',{},[document.createTextNode(label+' '),hint?el('small',{text:hint}):null]),input,p.err[errKey]?el('p',{class:'e',text:p.err[errKey]}):null])}
function card(p,i){var srv=p.type==='server',last=list.length-1,c=el('div',{class:'card'});
c.appendChild(el('div',{class:'top'},[el('div',{class:'n',text:String(i+1)}),el('div',{class:'t'},[el('b',{text:srv?tx('Your own server'):tx('OpenRouter')}),el('span',{class:i?'':'f',text:i?tx('If the one above does not answer'):tx('Answers first')})]),
el('button',{type:'button',class:'ib','aria-label':tx('Move up'),text:'\\u25B2',onclick:function(){move(i,-1)}}),el('button',{type:'button',class:'ib','aria-label':tx('Move down'),text:'\\u25BC',onclick:function(){move(i,1)}}),
el('button',{type:'button',class:'ib','aria-label':tx('Remove'),text:'\\u2715',onclick:function(){p.ask=true;draw()}})]));
var b=c.querySelectorAll('.ib');if(!i)b[0].disabled=true;if(i===last)b[1].disabled=true;
if(p.ask)c.appendChild(el('div',{class:'ask'},[el('span',{text:tx('Remove this provider?')}),el('button',{type:'button',text:tx('Yes'),onclick:function(){list.splice(list.indexOf(p),1);draw()}}),el('button',{type:'button',class:'sec',text:tx('No'),onclick:function(){p.ask=false;draw()}})]));
if(srv){c.appendChild(field(p,tx('Address'),tx('usually ends in /v1'),el('input',{type:'url',value:p.base,placeholder:'http://computer:11434/v1',class:p.err.base?'bad':'',oninput:function(e){p.base=e.target.value.trim()},onchange:function(){check(p);p.err={base:p.err.base};if(!p.err.base)delete p.err.base;setTimeout(function(){draw();loadModels(p)},0)}}),'base'));
c.appendChild(field(p,tx('Name'),tx('optional'),el('input',{type:'text',value:p.name||'',oninput:function(e){p.name=e.target.value}}),'name'))}
var kh=p.hasKey&&!p.clearKey?tx('(one is saved; leave empty to keep it)'):srv?tx('(only if your server asks for one; most do not)'):'';
c.appendChild(field(p,tx('API key'),kh,el('input',{type:'password',autocomplete:'off',placeholder:srv?'':'sk-or-...',class:p.err.key?'bad':'',oninput:function(e){p.key=e.target.value.trim()}}),'key'));
if(p.hasKey&&!p.clearKey&&srv)c.appendChild(el('a',{href:'#',style:'font-size:14px;color:#aaa',text:tx('Remove the saved key'),onclick:function(e){e.preventDefault();p.clearKey=true;draw()}}));
var dl='m'+i,mi=el('input',{list:dl,value:p.model,autocomplete:'off',class:p.err.model?'bad':'',oninput:function(e){p.model=e.target.value.trim()}});
var mh=p.loading?tx('Reading models…'):srv?tx('read from your server'):'';
c.appendChild(field(p,tx('Model'),mh,mi,'model'));c.appendChild(el('datalist',{id:dl},(p.models||[]).map(function(m){return el('option',{value:m.id,text:m.price!=null?m.name+' \\u00B7 $'+m.price+'/M':m.name})})));
if(p.mErr)c.appendChild(el('p',{class:'e',text:tx('Could not read the model list: %s. Type the model name.',p.mErr)}));
var w=el('select',{onchange:function(e){p.waitS=+e.target.value}},D.waits.map(function(s){return el('option',{value:s,text:tx('%d s',s)})}));w.value=String(p.waitS);
c.appendChild(field(p,tx('Wait for an answer'),'',w,''));
c.appendChild(el('label',{class:'c'},[el('input',{type:'checkbox',onchange:function(e){p.off=!e.target.checked}}),document.createTextNode(' '+tx('Use this provider'))]));c.querySelector('.c input').checked=!p.off;
c.appendChild(el('button',{type:'button',class:'sec',text:p.testing?tx('Testing…'):tx('Test'),onclick:function(){if(p.testing||!check(p)){draw();return}p.testing=true;p.res=null;draw();post('test',draft(p)).then(function(r){p.testing=false;p.res=r;draw()},function(){p.testing=false;draw()})}}));
if(p.res)c.appendChild(el('div',{class:p.res.ok?'ok':'no',text:p.res.ok?'\\u2713 '+tx('Answered in %s s',(p.res.ms/1000).toFixed(1)):'\\u2717 '+p.res.error}));
return c}
function move(i,d){var j=i+d;if(j<0||j>=list.length)return;var t=list[i];list[i]=list[j];list[j]=t;draw()}
function draw(){var box=document.getElementById('cards');list.forEach(function(q){var k=Object.keys(q.err);if(k.length){check(q);var e={};k.forEach(function(x){if(q.err[x])e[x]=q.err[x]});q.err=e}});var ae=document.activeElement,fs=box.querySelectorAll('input,select,textarea'),fi=-1,cur=null;for(var i=0;i<fs.length;i++)if(fs[i]===ae)fi=i;try{cur=ae&&ae.selectionStart}catch(e){}box.textContent='';if(!list.length)box.appendChild(el('p',{class:'e',style:'color:#aaa',text:tx('No AI provider yet: add OpenRouter or a server of your own.')}));list.forEach(function(p,i){box.appendChild(card(p,i))});var full=list.length>=D.max;document.getElementById('addor').style.display=full||list.some(function(p){return p.type==='openrouter'})?'none':'';document.getElementById('addsrv').style.display=full?'none':'';if(fi>=0){var nf=box.querySelectorAll('input,select,textarea')[fi];if(nf){nf.focus();try{if(cur!=null)nf.setSelectionRange(cur,cur)}catch(e){}}}}
function add(type){var p={id:'',type:type,name:'',base:'',model:type==='openrouter'?'openrouter/auto':'',waitS:type==='openrouter'?30:25,off:false,hasKey:false,key:'',clearKey:false,models:null,mErr:'',res:null,err:{},ask:false};list.push(p);draw();if(type==='openrouter')loadModels(p);var cs=document.querySelectorAll('.card');var last=cs[cs.length-1];last.scrollIntoView({behavior:'smooth',block:'center'});var f=last.querySelector('input');if(f)f.focus()}
document.getElementById('addor').onclick=function(){add('openrouter')};document.getElementById('addsrv').onclick=function(){add('server')};
document.getElementById('save').onclick=function(){var ok=true;list.forEach(function(p){if(!check(p))ok=false});draw();var er=document.getElementById('err');er.textContent='';if(!ok){var b=document.querySelector('.bad');if(b)b.scrollIntoView({block:'center'});return}
var body={llm:{enabled:document.getElementById('enabled').checked,system:document.getElementById('system').value,providers:list.map(function(p){var o={type:p.type,name:p.name,model:p.model,waitS:p.waitS,off:p.off};if(p.id)o.id=p.id;if(p.type==='server')o.base=p.base;if(p.key)o.key=p.key;if(p.clearKey&&!p.key)o.clearKey=true;return o})},ha:{route:document.getElementById('haroute').value},url:document.getElementById('url').value};
var tk=document.getElementById('token').value;if(tk)body.token=tk;
post('save-json',body).then(function(r){if(r.error){er.textContent=r.error;return}document.getElementById('main').innerHTML='<p class=m></p>';document.querySelector('#main .m').textContent=tx('Saved. You can close this page.')},function(){er.textContent=tx('no connection to the TV')})};
draw();list.forEach(function(p){if(p.type==='openrouter'||p.base)loadModels(p)})})();</script>`;
}
function startPair(only) {
  stopPair();
  only = only === 'ha' ? 'ha' : '';
  const token = crypto.randomBytes(16).toString('hex');
  let hits = 0;
  const srv = http.createServer((req, res) => {
    const send = (c, html) => {
      res.writeHead(c, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    };
    if (++hits > 120) return send(429, 'Too many requests');
    const p = req.url.split('?')[0];
    const lg = i18n.lang(req, ctx.config.get().lang);
    if (req.method === 'GET' && p === '/' + token) return send(200, pairPage('', false, token, lg, only));
    const json = (code, o) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(o));
    };
    // the voice page's calls: save everything, test one provider, read one provider's models (a draft: its unsaved values)
    if (req.method === 'POST' && !only && /^\/[0-9a-f]{32}\/(save-json|test|models)$/.test(p) && p.indexOf('/' + token + '/') === 0) {
      let b = '';
      req.on('data', c => {
        b += c;
        if (b.length > 65536) req.destroy();
      });
      req.on('end', () => {
        let o;
        try {
          o = JSON.parse(b);
        } catch (_) {
          return json(400, { error: 'not JSON' });
        }
        const act = p.slice(token.length + 2);
        if (act === 'save-json') {
          const set = { llm: o.llm || {}, url: typeof o.url === 'string' ? o.url : '' };
          if (o.ha && typeof o.ha.route === 'string') set.ha = { route: o.ha.route }; // the routing only when sent
          if (typeof o.token === 'string' && o.token) set.token = o.token;
          const err = applySet(set);
          if (err) return json(400, { error: i18n.tr(lg, err) });
          pairedAt = Date.now();
          json(200, { ok: true });
          return setTimeout(stopPair, 2000);
        }
        const d = draftProvider(o);
        if (act === 'test') return testProvider(d).then(r => json(200, r));
        models(d).then(
          m => json(200, { models: m.all.map(x => ({ id: x.id, name: x.name, price: x.price })) }),
          e => json(200, { error: e.message })
        );
      });
      return;
    }
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
        if (only !== 'ha') return send(404, 'Not found'); // the voice page saves with save-json
        set = { ha: { url: f.get('haurl') || '', selfSigned: f.get('hass') === '1' } };
        if (f.get('hatoken')) set.ha.token = f.get('hatoken');
        const err = applySet(set);
        if (err) return send(400, pairPage(err, false, token, lg, only));
        pairedAt = Date.now();
        send(200, pairPage('Saved. You can close this page.', true, token, lg, only));
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
    unsupported: unsupported(),
    bytes: installed() || job.state === 'working' ? dirSize(V) : 0,
    enabled: !!c.enabled,
    url: c.url,
    hasToken: !!c.token,
    llm: llmStatus(),
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
    kernelArch().catch(() => {}); // for the status: the manager says at once that this TV cannot run voice
    setInterval(syncLg, 20000);
    setTimeout(syncLg, 5000);
  };
  return { name: 'voice', prefix: '/api/voice/', handle, start, status, installed, listen, syncLg, capture };
}
async function handle(req, res, u, body) {
  const json = (o, code) => {
    res.writeHead(code || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  const act = u.replace('/api/voice/', '');
  if (act === 'status') return json(status());
  if (act === 'models') {
    // the models of one provider (?id=), else of the first one, else OpenRouter's
    const id = new URLSearchParams(String(req.url || '').split('?')[1] || '').get('id') || '',
      ps = llmCfg().providers,
      p = id ? ps.filter(x => x.id === id)[0] : ps[0] || provider({ type: 'openrouter' });
    if (!p) return json({ error: 'no such AI provider' }, 404);
    try {
      const m = await models(p);
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
    if (!llmReady(l) && !cfg().url && !haReady(haCfg()))
      return json({ error: 'no destination: set up Home Assistant, switch on the AI chat or set a server address' }, 400);
    const r = await respond(text, b.card !== false);
    return json({
      text: r.text,
      answer: r.answer || '',
      via: r.via || '',
      provider: r.provider || '',
      tried: r.tried || [],
      error: r.error || '',
    });
  }
  if (act === 'test') {
    // one AI provider: a saved one ({id}), or unsaved values over it ({id, base, key, model}) or a new one ({type, base, key, model})
    const b = await body(req);
    if (b.id && !llmCfg().providers.some(p => p.id === b.id)) return json({ error: 'no such AI provider' }, 404);
    return json(await testProvider(draftProvider(b)));
  }
  if (act === 'set') {
    const err = applySet(await body(req));
    return err ? json({ error: err }, 400) : json(status());
  }
  res.writeHead(404);
  res.end();
}
module.exports = { create, streamReply };
