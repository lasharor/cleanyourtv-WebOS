// Remote key remapping: a button on the remote (the Netflix or Prime key, a colour key, ...) opens an app, an input, Live TV, Home or
// the Inputs list, or nothing at all (the button's own action is blocked). The code of a button is learned from the TV (inputhook.js, as for the Input, Guide and voice keys), never assumed.
//   GET  /api/remap              {enabled, keys, ...}: whether the feature is on, the remapped keys, and the actions the manager can offer
//   POST /api/remap              {enabled: true|false} switches the feature on or off (off by default);
//                                {code, type, id?, label?} sets (or changes) one key; {code, remove: true} removes it; {clear: true} removes all
//   POST /api/remap/learn        starts listening for the next button press
//   GET  /api/remap/learn-state  {state: idle|waiting|got|timeout|unsupported|taken, code?}
//   POST /api/remap/fire         {code} runs the key's action; scripts/remapkey.sh calls it when the hook reports the key
// The feature is off until the manager switches it on (config.json: remapOn). While it is off nothing runs: no binds in the hook, the hook is
// not injected for it, a button press does nothing. The saved keys are kept, so switching it on again brings them back.
// The keys are kept in config.json (remap: {"<code>": {type, id, label, key}}; key is LG's name of the button, KEY_AMAZON, found when it was
// learned (keynames.js) and only used to show "Prime Video"). An action is one of: app (id: the TV's app id), input (id: the
// input's app id, com.webos.app.hdmiN), live (Live TV in the launcher), home (the Home screen), picker (the Inputs list), none (the press is taken and nothing happens).
// Nothing under /usr, /etc or the firmware changes: the binds live in the hook's keybinds.json and the buttons in config.json. The binds
// only work while the hook is in LG's input service, so a reboot without the boot scripts gives every key back to LG.
const fs = require('fs');
const P = require('./paths'),
  web = require('./web'),
  exec = require('./exec'),
  keynames = require('./keynames');

const TYPES = ['app', 'input', 'live', 'home', 'picker', 'none'];
const NEEDS_ID = { app: /^[\w.\-]{1,100}$/, input: /^[\w.\-]{1,100}$/ };
const CODE = /^\d{1,4}$/;
const norm = c => String(parseInt(c, 10)); // "0103" and "103" are the same button
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
  if (typeof e.key === 'string' && keynames.NAME.test(e.key)) out.key = e.key; // LG's name of the button (KEY_AMAZON), only to show it
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
  // the keys as the manager shows them: with the button's name ("Prime Video") when LG's name for it is known
  const shown = () => {
    const t = table(),
      out = {};
    for (const c of Object.keys(t)) {
      const n = keynames.label(t[c].key || keynames.CODES[c]);
      out[c] = n ? Object.assign({ name: n }, t[c]) : t[c];
    }
    return out;
  };
  const enabled = () => config.get().remapOn === true;
  const active = () => (enabled() ? codes() : []); // the keys the hook gets binds for
  // the keys that already do something of ours (the Input key only while it is taken over: off, the button is LG's again)
  const taken = () => {
    const k = config.keys(),
      ik = feature('inputkey'),
      t = [];
    if (!ik || !ik.on || ik.on()) t.push(String(k.input || '241'));
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
      fs.writeFileSync(P.HOME_PARAMS, up + ' ' + JSON.stringify(params));
    } catch (_) {}
  }
  async function launch(id, params) {
    // an app set up to open on an Android box switches the input instead; the box is a bundled add-on, as /api/launch (apps.js) reaches it
    const addons = feature('addons'),
      box = addons && addons.module && addons.module('androidbox');
    if (box && box.handles(id)) {
      const moved = await box.open(id);
      if (moved) return moved;
    }
    return luna('luna://com.webos.applicationManager/launch', { id, params: params || {} });
  }
  async function run(e) {
    if (e.type === 'none') return { returnValue: true }; // the bind takes the press away from LG; nothing else
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
    if (!enabled()) return { error: 'off' };
    const c = norm(code),
      e = table()[c];
    if (!e) return { error: 'no action for this key' };
    const now = Date.now();
    if (last[c] && now - last[c] < REPEAT_MS) return { returnValue: true, repeat: true };
    last[c] = now;
    let r;
    try {
      r = await run(e);
    } catch (x) {
      r = { error: x.message };
    }
    const good = !!r && r.returnValue !== false && !r.error;
    if (!good)
      console.error(
        'remap: key ' + c + ' (' + e.type + (e.id ? ' ' + e.id : '') + ') failed: ' + ((r && (r.error || r.errorText)) || 'no answer')
      );
    return good ? { returnValue: true } : { returnValue: false, error: (r && (r.error || r.errorText)) || 'no answer' };
  }

  function set(b) {
    resume = false;
    if (typeof b.enabled === 'boolean') {
      config.update('manager', c => {
        if (b.enabled) c.remapOn = true;
        else delete c.remapOn;
      });
      sync();
      return { returnValue: true, enabled: b.enabled };
    }
    if (b.clear === true) {
      config.update('manager', c => {
        delete c.remap;
      });
      sync();
      return { returnValue: true };
    }
    const raw = String(b.code || '');
    if (!CODE.test(raw)) return { error: 'bad code' };
    const code = norm(raw); // "0103" is saved as "103", which is what the hook reports
    if (b.remove === true) {
      config.update('manager', c => {
        if (c.remap) delete c.remap[code];
      });
      sync();
      return { returnValue: true };
    }
    const e = clean(b);
    if (!e) return { error: 'bad action' };
    const old = table()[code]; // changing what a button does keeps the name found when it was learned
    if (!e.key && old && old.key) e.key = old.key;
    if (!e.key && keynames.CODES[code]) e.key = keynames.CODES[code];
    if (!enabled()) return { error: 'off' };
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
  // The button's own action (Netflix: the app, then LG's store) opens over the manager and the manager comes back reset, losing the code. So the
  // service watches the learning itself and, once a button is caught, brings the manager back; it then resumes with the code (`resume`).
  let resume = false,
    watch = null;
  const MANAGER = 'com.cleanyourtv.manager';
  function watchLearn() {
    clearTimeout(watch);
    const t0 = Date.now();
    (function tick() {
      watch = setTimeout(() => {
        const l = learnState();
        if (l.state === 'got') {
          resume = true;
          // LG's app starts a moment after the press: come back after it (the first time whatever is in front), and look again in case it
          // was slow: the manager is opened again only when something else is in front, so it is not reset under the person's hands
          const COME_BACK = ctx.comeBack || [1200, 4000, 8000];
          COME_BACK.forEach((ms, i) =>
            setTimeout(async () => {
              try {
                if (i > 0) {
                  const fg = await luna('luna://com.webos.applicationManager/getForegroundAppInfo', {});
                  if (fg && fg.appId === MANAGER) return;
                }
                await luna('luna://com.webos.applicationManager/launch', { id: MANAGER, params: { open: 'remaplearned' } });
              } catch (_) {}
            }, ms)
          );
        } else if (l.state === 'waiting' && Date.now() - t0 < 50000) tick();
      }, 500);
    })();
  }
  let named = { code: '', key: '' }; // LG's name for the button just learned; found once, while the system log still has the press
  function learnState() {
    const l = inputhook.learnState();
    if (l.state !== 'got' || l.name !== 'remap') return l;
    const code = String(l.code);
    if (named.code !== code || !named.key) named = { code, key: keynames.nameFor(code) };
    const nm = { key: named.key, button: keynames.label(named.key) };
    if (taken().indexOf(code) >= 0) return Object.assign({}, l, nm, { state: 'taken' });
    return Object.assign({}, l, nm, { existing: shown()[code] || null, resume });
  }

  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    if (u === '/api/remap/learn-state') return json(learnState());
    if (u === '/api/remap' && req.method !== 'POST')
      return json({
        enabled: enabled(),
        keys: shown(),
        types: TYPES,
        max: MAX_KEYS,
        hook: inputhook.hookInfo().attached,
        blind: !!inputhook.hookInfo().blind,
      });
    if (req.method !== 'POST') return json({ error: 'POST expected' }, 405);
    const b = (await body(req)) || {};
    if (u === '/api/remap/learn') {
      if (!enabled()) return json({ error: 'off' }, 400);
      resume = false;
      inputhook.startLearn('remap');
      watchLearn();
      return json({ returnValue: true });
    }
    if (u === '/api/remap/fire') {
      const code = String(b.code || '');
      return json(CODE.test(code) ? await fire(norm(code)) : { error: 'bad code' });
    }
    const r = set(b);
    return json(r.error ? r : Object.assign({ keys: shown() }, r), r.error ? 400 : 200);
  }

  function start() {
    inputhook.setRemapKeys(active);
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
