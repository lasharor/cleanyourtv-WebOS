// Remote key remapping: a button on the remote (the Netflix or Prime key, a colour key, ...) opens an app, an input, Live TV, Home or
// the Inputs list. The code of a button is learned from the TV (inputhook.js, as for the Input, Guide and voice keys), never assumed.
//   GET  /api/remap              the remapped keys, and the actions the manager can offer
//   POST /api/remap              {code, type, id?, label?} sets (or changes) one key; {code, remove: true} removes it; {clear: true} removes all
//   POST /api/remap/learn        starts listening for the next button press
//   GET  /api/remap/learn-state  {state: idle|waiting|got|timeout|unsupported|taken, code?}
//   POST /api/remap/fire         {code} runs the key's action; scripts/remapkey.sh calls it when the hook reports the key
// The keys are kept in config.json (remap: {"<code>": {type, id, label}}). An action is one of: app (id: the TV's app id), input (id: the
// input's app id, com.webos.app.hdmiN), live (Live TV in the launcher), home (the Home screen), picker (the Inputs list).
// Nothing is changed on the TV's disk: the binds live in the hook's keybinds.json, which only works while the hook is in LG's input
// service, so a reboot without the boot scripts gives every key back to LG.
const fs = require('fs');
const P = require('./paths'),
  web = require('./web'),
  exec = require('./exec');

const TYPES = ['app', 'input', 'live', 'home', 'picker'];
const NEEDS_ID = { app: /^[\w.\-]{1,100}$/, input: /^[\w.\-]{1,100}$/ };
const CODE = /^\d{1,4}$/;
const MAX_KEYS = 12;
const HOME = 'com.webos.app.home';
const REPEAT_MS = 700; // a held button repeats: one press runs the action once

// one saved entry, or null when it is not valid
function clean(e) {
  if (!e || typeof e !== 'object' || TYPES.indexOf(e.type) < 0) return null;
  const out = { type: e.type };
  if (NEEDS_ID[e.type]) {
    if (typeof e.id !== 'string' || !NEEDS_ID[e.type].test(e.id)) return null;
    out.id = e.id;
  }
  if (typeof e.label === 'string' && e.label.replace(/[\u0000-\u001f]/g, ' ').trim())
    out.label = e.label
      .replace(/[\u0000-\u001f]/g, ' ')
      .trim()
      .slice(0, 60);
  return out;
}

function create(ctx) {
  const { config, luna } = ctx;
  const inputhook = ctx.inputhook || require('./inputhook');
  const feature = n => (ctx.feature ? ctx.feature(n) : null);
  const last = {}; // code -> when it last ran
  let fired = null; // what the last key press did, for the manager and Share log

  const table = () => {
    const r = config.get().remap,
      out = {};
    if (!r || typeof r !== 'object') return out;
    for (const k of Object.keys(r)) {
      const e = CODE.test(k) && clean(r[k]);
      if (e) out[k] = e;
    }
    return out;
  };
  const codes = () => Object.keys(table());
  // the keys that already do something of ours
  const taken = () => {
    const k = config.keys(),
      t = [String(k.input || '241')];
    for (const n of ['home', 'voice', 'guide']) if (k[n]) t.push(String(k[n]));
    return t;
  };
  const sync = () => {
    const ik = feature('inputkey');
    if (ik && ik.ensure) ik.ensure();
  };

  // the launcher on its stand-in Home (scripts/home-standin.sh) takes its parameters from this file
  function homeParams(params) {
    if (!fs.existsSync(P.STANDIN)) return;
    try {
      const up = fs.readFileSync(P.PROC + '/uptime', 'utf8').split(' ')[0];
      fs.writeFileSync('/tmp/cleanyourtv-home-params', up + ' ' + JSON.stringify(params));
    } catch (_) {}
  }
  async function launch(id, params) {
    const box = feature('androidbox'); // an app set up to open on an Android box switches the input instead
    if (box && box.handles(id)) {
      const moved = await box.open(id);
      if (moved) return moved;
    }
    return luna('luna://com.webos.applicationManager/launch', { id, params: params || {} });
  }
  async function run(e) {
    if (e.type === 'app' || e.type === 'input') return launch(e.id);
    if (e.type === 'home') {
      homeParams({});
      return launch(HOME);
    }
    if (e.type === 'live') {
      const p = { live: true };
      homeParams(p);
      return launch(HOME, p);
    }
    // the Inputs list, as the Input key shows it
    exec.detached('sh ' + P.D + '/inputkey.sh');
    return { returnValue: true };
  }
  async function fire(code) {
    const e = table()[code];
    if (!e) return { error: 'no action for this key' };
    const now = Date.now();
    if (last[code] && now - last[code] < REPEAT_MS) return { returnValue: true, repeat: true };
    last[code] = now;
    let r;
    try {
      r = await run(e);
    } catch (x) {
      r = { error: x.message };
    }
    const good = !!r && r.returnValue !== false && !r.error;
    fired = { code, type: e.type, id: e.id || '', ok: good, at: now };
    if (!good)
      console.error(
        'remap: key ' + code + ' (' + e.type + (e.id ? ' ' + e.id : '') + ') failed: ' + ((r && (r.error || r.errorText)) || 'no answer')
      );
    return good ? { returnValue: true } : { returnValue: false, error: (r && (r.error || r.errorText)) || 'no answer' };
  }

  function set(b) {
    if (b.clear === true) {
      config.update('manager', c => {
        delete c.remap;
      });
      sync();
      return { returnValue: true };
    }
    const code = String(b.code || '');
    if (!CODE.test(code)) return { error: 'bad code' };
    if (b.remove === true) {
      config.update('manager', c => {
        if (c.remap) delete c.remap[code];
      });
      sync();
      return { returnValue: true };
    }
    const e = clean(b);
    if (!e) return { error: 'bad action' };
    if (taken().indexOf(code) >= 0) return { error: 'taken' };
    if (!table()[code] && codes().length >= MAX_KEYS) return { error: 'too many keys' };
    config.update('manager', c => {
      c.remap = Object.assign({}, c.remap);
      c.remap[code] = e;
    });
    sync();
    return { returnValue: true };
  }

  // learning: the next button press that is not an arrow, OK or Back; a code that is already in use is reported, not taken
  function learnState() {
    const l = inputhook.learnState();
    if (l.state !== 'got' || l.name !== 'remap') return l;
    if (taken().indexOf(String(l.code)) >= 0) return Object.assign({}, l, { state: 'taken' });
    return Object.assign({}, l, { existing: table()[l.code] || null });
  }

  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    if (u === '/api/remap/learn-state') return json(learnState());
    if (u === '/api/remap' && req.method !== 'POST')
      return json({ keys: table(), types: TYPES, max: MAX_KEYS, hook: inputhook.hookInfo().attached, last: fired });
    if (req.method !== 'POST') return json({ error: 'POST expected' }, 405);
    const b = (await body(req)) || {};
    if (u === '/api/remap/learn') {
      inputhook.startLearn('remap');
      return json({ returnValue: true });
    }
    if (u === '/api/remap/fire') {
      const code = String(b.code || '');
      return json(CODE.test(code) ? await fire(code) : { error: 'bad code' });
    }
    const r = set(b);
    return json(r.error ? r : Object.assign({ keys: table() }, r), r.error ? 400 : 200);
  }

  function start() {
    inputhook.setRemapKeys(codes);
    setTimeout(sync, 1000);
  }

  return {
    name: 'remap',
    paths: ['/api/remap', '/api/remap/learn', '/api/remap/learn-state', '/api/remap/fire'],
    handle,
    start,
    // for the tests
    table,
    fire,
    set,
  };
}

module.exports = { create, clean, TYPES };
