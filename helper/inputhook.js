// Input key: injects the bundled inputhook (see third-party/inputhook) into LG's input processes and binds the remote's
// Input button (id 241) to scripts/inputkey.sh, which opens the Inputs picker overlay. Removing our bind gives the key
// back to LG's own picker. Other binds in keybinds.json are left alone.
const fs = require('fs'),
  nc = require('./netcompat'),
  exec = require('./exec'),
  P = require('./paths');
const D = P.D,
  HOOK = P.HOOK,
  CFGDIR = P.HOOK_CFG,
  BINDS = CFGDIR + '/keybinds.json';
// The processes the hook goes into. LG's input service (lginput2) is where the remote's keys arrive on webOS 5 and newer, and the
// only one hooked when it runs. The others are only for firmware without it: in micomservice the hook replaces write(), and that
// process also passes the remote's keys on to HDMI-CEC devices and the soundbar; hooked there, CEC control and eARC stopped
// working after a boot (issue 23).
const PRIMARY = 'lginput2',
  FALLBACK = ['RELEASE', 'micomservice', 'tvservice', 'testapp'];
const TARGETS = [PRIMARY].concat(FALLBACK);
const DEFAULT_KEY = '241',
  COMMAND = 'sh ' + D + '/inputkey.sh',
  VOICE_COMMAND = 'sh ' + D + '/voicekey.sh',
  GUIDE_COMMAND = 'sh ' + D + '/guidekey.sh',
  REMAP_COMMAND = 'sh ' + D + '/remapkey.sh '; // + the code: one bind per remapped key (remap.js). 241: the Input button on the remote this was written with; learned in the setup

function procs() {
  const out = [];
  let all = [];
  try {
    all = fs.readdirSync(P.PROC);
  } catch (_) {}
  for (const p of all) {
    if (!/^\d+$/.test(p)) continue;
    try {
      const n = fs.readFileSync(P.PROC + '/' + p + '/comm', 'utf8').trim();
      if (TARGETS.includes(n)) out.push({ pid: p, name: n });
    } catch (_) {}
  }
  const primary = out.filter(x => x.name === PRIMARY);
  return primary.length ? primary : out;
}
const hooked = pid => {
  try {
    return fs.readFileSync(P.PROC + '/' + pid + '/maps', 'utf8').includes('libinputhookpp');
  } catch (_) {
    return false;
  }
};

function writeBinds(on, key, vkey, gkey, rkeys) {
  let b = {};
  try {
    b = JSON.parse(fs.readFileSync(BINDS, 'utf8'));
  } catch (_) {}
  const before = JSON.stringify(b);
  for (const k of Object.keys(b))
    if (
      b[k] &&
      ((b[k].command === COMMAND && (!on || k !== key)) ||
        (b[k].command === VOICE_COMMAND && (!vkey || k !== vkey)) ||
        (b[k].command === GUIDE_COMMAND && (!gkey || k !== gkey)) ||
        (typeof b[k].command === 'string' && b[k].command === REMAP_COMMAND + k && rkeys.indexOf(k) < 0))
    )
      delete b[k]; // our binds only, wherever they were
  if (on) b[key] = { action: 'exec', command: COMMAND };
  if (vkey) b[vkey] = { action: 'exec', command: VOICE_COMMAND };
  if (gkey) b[gkey] = { action: 'exec', command: GUIDE_COMMAND };
  // a remapped key never takes over a key that already does something of ours
  for (const k of rkeys) if (k !== key && k !== vkey && k !== gkey) b[k] = { action: 'exec', command: REMAP_COMMAND + k };
  if (JSON.stringify(b) === before) return;
  nc.mkdirp(CFGDIR);
  fs.writeFileSync(BINDS + '.tmp', JSON.stringify(b));
  fs.renameSync(BINDS + '.tmp', BINDS);
}

let busy = false;
// Idempotent: call at start and every so often (LG's input service restarts now and then and loses the hook).
let voiceFn = () => ''; // the key bound to the voice function, or '' (set by the service)
const setVoiceKey = f => {
  voiceFn = f;
};
let guideFn = () => ''; // the key bound to the Live TV guide, or '' (Live TV off or no key learned)
const setGuideKey = f => {
  guideFn = f;
};
let remapFn = () => []; // the codes of the remapped keys (remap.js)
const setRemapKeys = f => {
  remapFn = f;
};
function ensure(enabled, key) {
  const vkey = voiceFn(),
    gkey = guideFn(),
    rkeys = remapFn().map(String);
  try {
    writeBinds(enabled, String(key || DEFAULT_KEY), vkey ? String(vkey) : '', gkey ? String(gkey) : '', rkeys);
  } catch (e) {
    console.error('inputhook: keybinds:', e.message);
  }
  if (!(enabled || vkey || gkey || rkeys.length) || busy || !fs.existsSync(HOOK + '/ezinject')) return;
  const todo = procs().filter(p => !hooked(p.pid));
  if (!todo.length) return;
  busy = true;
  try {
    fs.chmodSync(HOOK + '/ezinject', 0o755);
  } catch (_) {}
  let left = todo.length;
  for (const p of todo) {
    const log = '/tmp/lginput-hook-' + p.name + '.log';
    try {
      fs.writeFileSync(log, '');
    } catch (_) {}
    exec.execFile(HOOK + '/ezinject', ['-l', log, p.pid, HOOK + '/libinputhookpp.so'], { timeout: 20000 }, e => {
      if (e) console.error('inputhook: inject ' + p.name + ':', e.message);
      if (--left === 0) busy = false;
    });
  }
}
const HOOKLOG = P.HOOK_LOG;
// What the hook reports about itself: did it find LG's input function and install?
function hookInfo() {
  let t = '';
  try {
    t = fs.readFileSync(HOOKLOG, 'utf8');
  } catch (_) {}
  return {
    attached: /InputHook initialized/.test(t) && /lib_main returned: 0/.test(t),
    sawKeys: /lginput_uinput_send_button called/.test(t),
    errors: t
      .split('\n')
      .filter(l => /\[(ERRO|FAIL|WARN)/.test(l))
      .slice(0, 5),
  };
}
const status = key => ({
  hooked:
    procs()
      .filter(p => ['lginput2', 'micomservice'].includes(p.name))
      .every(p => hooked(p.pid)) && procs().length > 0,
  bound: (() => {
    try {
      const b = JSON.parse(fs.readFileSync(BINDS, 'utf8'));
      const k = String(key || DEFAULT_KEY);
      return !!(b[k] && b[k].command === COMMAND);
    } catch (_) {
      return false;
    }
  })(),
  hook: hookInfo(),
});

// ---- learning a key: the code of the next button press, read from the hook's log ----
const IGNORE = {
  input: [28, 103, 105, 106, 108, 272, 273, 274, 352, 412],
  home: [28, 103, 105, 106, 108, 272, 273, 274, 352],
  voice: [28, 103, 105, 106, 108, 272, 273, 274, 352, 412],
  guide: [28, 103, 105, 106, 108, 272, 273, 274, 352, 412],
  remap: [28, 103, 105, 106, 108, 272, 273, 274, 352, 412],
}; // arrows, OK, pointer, Back
let learn = null;
const markSaved = () => {
  if (learn && learn.result) learn.result.saved = true;
};
function startLearn(name) {
  let size = 0;
  try {
    size = fs.statSync(HOOKLOG).size;
  } catch (_) {}
  learn = { name, size, at: Date.now(), result: null };
}
function learnState() {
  if (!learn) return { state: 'idle' };
  if (learn.result) return Object.assign({ state: 'got', name: learn.name }, learn.result);
  if (!hookInfo().attached) return { state: 'unsupported', name: learn.name };
  let t = '';
  try {
    const fd = fs.openSync(HOOKLOG, 'r'),
      st = fs.fstatSync(fd),
      n = Math.max(0, st.size - learn.size);
    const b = Buffer.alloc(Math.min(n, 65536));
    fs.readSync(fd, b, 0, b.length, learn.size);
    fs.closeSync(fd);
    t = b.toString('utf8');
  } catch (_) {}
  const re = /keyid=(\d+), state=1 uinput_code=(\d+)/g;
  let m;
  if (Date.now() - learn.at > 1200) {
    // ignore the OK press that started the step
    while ((m = re.exec(t))) {
      if ((IGNORE[learn.name] || []).indexOf(+m[2]) < 0) {
        learn.result = { code: m[2], keyid: m[1] };
        return Object.assign({ state: 'got', name: learn.name }, learn.result);
      }
    }
  }
  return {
    state: Date.now() - learn.at > 45000 ? 'timeout' : 'waiting',
    name: learn.name,
    seconds: Math.round((Date.now() - learn.at) / 1000),
  };
}
module.exports = {
  setVoiceKey,
  setGuideKey,
  setRemapKeys,
  ensure,
  status,
  markSaved,
  startLearn,
  learnState,
  hookInfo,
  procs,
  DEFAULT_KEY,
};
