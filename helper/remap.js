// Remote key remapping: a button on the remote (the Netflix or Prime key, a colour key, ...) opens an app, an input, Live TV, Home or
// the Inputs list, or nothing at all (the button's own action is blocked). The code of a button is learned from the TV (inputhook.js, as for the Input, Guide and voice keys), never assumed.
//   GET  /api/remap              {enabled, keys, ...}: whether the feature is on, the remapped keys, and the actions the manager can offer
//   POST /api/remap              {enabled: true|false} switches the feature on or off (off by default);
//                                {code, type, id?, label?} sets (or changes) a key's "everywhere" entry; add app: "<app id>" (and appName?) to set the
//                                entry for that app only; {code, remove: true} removes the key; {code, remove: true, app} removes that app's entry;
//                                {clear: true} removes all
//   POST /api/remap/learn        starts listening for the next button press
//   GET  /api/remap/learn-state  {state: idle|waiting|got|timeout|unsupported|taken, code?}
//   POST /api/remap/fire         {code} runs the key's action (the entry of the app in front, else the "everywhere" entry); scripts/remapkey.sh calls it when the hook reports the key
// The feature is off until the manager switches it on (config.json: remapOn). While it is off nothing runs: no binds in the hook, the hook is
// not injected for it, a button press does nothing. The saved keys are kept, so switching it on again brings them back.
// The keys are kept in config.json (remap: {"<code>": {type, id, label, key, apps}}; key is LG's name of the button, KEY_AMAZON, found when it was
// learned (keynames.js) and only used to show "Prime Video"). type, id and label are the "everywhere" entry, as they always were; apps is an
// optional list of entries for one app each ({app, appName, type, id, label}). A press runs the entry of the app in front, else the everywhere
// entry. A button always has an everywhere entry (a button with only app entries cannot be saved), so a press is never lost: where the person
// wants nothing to happen, the everywhere entry is "none", chosen on purpose. A button saved before this (one action) is that everywhere entry.
// The app in front is asked of the app manager at the press (getForegroundAppInfo), not taken from the list of running apps, which lags by seconds.
// An action is one of the names in ACTIONS below, chosen from that fixed list: app (id: the TV's app id), input (id: the
// input's app id, com.webos.app.hdmiN), live (Live TV in the launcher), home (the Home screen), picker (the Inputs list), none (the press is taken and nothing happens),
// and the fixed calls of EXTRA: mute, volume_up, volume_down, screen_off, standby, settings. No command, path, address or method comes from the config or the request.
// Nothing under /usr, /etc or the firmware changes: the binds live in the hook's keybinds.json and the buttons in config.json. The binds
// only work while the hook is in LG's input service, so a reboot without the boot scripts gives every key back to LG.
const P = require('./paths'),
  web = require('./web'),
  exec = require('./exec'),
  keynames = require('./keynames');

// the actions with fixed calls of their own (the same calls the phone remote's keys and Power drawer make, addons/catalog/phoneremote)
const AUDIO = 'luna://com.webos.service.audio/master/',
  POWER = 'luna://com.webos.service.tvpower/power/',
  SETTINGS_APP = 'com.palm.app.settings';
const EXTRA = ['mute', 'volume_up', 'volume_down', 'screen_off', 'standby', 'settings'];
const TYPES = ['app', 'input', 'live', 'home', 'picker', 'none'].concat(EXTRA);
// what the tool remote_buttons press may not run: it works from the network and from a model, and these turn the TV off or change the sound
const NOT_FROM_TOOLS = ['mute', 'volume_up', 'volume_down', 'screen_off', 'standby'];
const MAX_APPS = 8; // entries for one app each, per button
const NEEDS_ID = { app: /^[\w.\-]{1,100}$/, input: /^[\w.\-]{1,100}$/ };
const CODE = /^\d{1,4}$/;
const norm = c => String(parseInt(c, 10)); // "0103" and "103" are the same button
const MAX_KEYS = 12;
const HOME = 'com.webos.app.home';
const REPEAT_MS = 700; // a held button repeats: one press runs the action once
const REPEAT_VOLUME_MS = 250; // a volume key may be tapped quickly
const FRONT_RETRY_MS = 150; // the app manager sometimes answers with no app in front for a moment

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

// one entry for one app: the entry as clean() keeps it, with the app id and the app's name (shown as "Only in <name>")
function cleanApp(e, app) {
  const out = clean(e);
  if (!out || typeof app !== 'string' || !NEEDS_ID.app.test(app)) return null;
  delete out.key; // the button's name belongs to the button, not to an entry
  const r = { app };
  if (typeof e.appName === 'string' && e.appName.replace(/[\u0000-\u001f]/g, ' ').trim())
    r.appName = e.appName
      .replace(/[\u0000-\u001f]/g, ' ')
      .trim()
      .slice(0, 60);
  return Object.assign(r, out);
}

// a saved button: its everywhere entry (the flat fields, as before) and the entries for one app each; null when it has no valid everywhere entry
function cleanButton(raw) {
  const out = clean(raw);
  if (!out) return null;
  const apps = [];
  if (Array.isArray(raw.apps))
    for (const a of raw.apps) {
      const e = a && cleanApp(a, a.app);
      if (e && !apps.some(x => x.app === e.app) && apps.length < MAX_APPS) apps.push(e);
    }
  if (apps.length) out.apps = apps;
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
      const e = CODE.test(k) && cleanButton(r[k]);
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

  // the launcher on its stand-in Home (scripts/home-standin.sh) takes its parameters from a file
  const homeParams = require('./nativehome').homeParams;
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
    // the extra actions: each is its own fixed call, the one the phone remote makes for the same key
    if (e.type === 'volume_up') return luna(AUDIO + 'volumeUp', {});
    if (e.type === 'volume_down') return luna(AUDIO + 'volumeDown', {});
    if (e.type === 'mute') {
      const v = await luna(AUDIO + 'getVolume', {});
      const s = (v && v.volumeStatus) || v || {};
      return luna(AUDIO + 'setMuted', { muted: !s.muteStatus });
    }
    if (e.type === 'screen_off') return luna(POWER + 'turnOffScreen', {}); // the picture goes dark, the TV keeps running
    if (e.type === 'standby') return luna(POWER + 'powerOff', { reason: 'remoteKey' }); // the soft off of the remote's own power key
    if (e.type === 'settings') return luna('luna://com.webos.applicationManager/launch', { id: SETTINGS_APP, params: {} });
    // the Inputs list, as the Input key shows it
    exec.detached('sh ' + P.D + '/inputkey.sh');
    return { returnValue: true };
  }
  // the app in front, asked of the app manager now (its list of running apps lags by seconds); '' when it cannot say
  async function inFront() {
    for (let i = 0; i < 2; i++) {
      try {
        const fg = await luna('luna://com.webos.applicationManager/getForegroundAppInfo', {});
        if (fg && fg.returnValue !== false && typeof fg.appId === 'string' && fg.appId) return fg.appId;
      } catch (_) {}
      if (i === 0) await new Promise(r => setTimeout(r, FRONT_RETRY_MS));
    }
    return '';
  }
  // the entry a press runs: the first one for the app in front, else the everywhere entry (a button always has one)
  async function pick(btn) {
    if (!btn.apps || !btn.apps.length) return btn;
    const front = await inFront();
    return (front && btn.apps.filter(a => a.app === front)[0]) || btn;
  }
  const warned = {}; // a failing action is logged once per kind and reason, not at every press
  // opts.tool: the press comes from the remote_buttons tool (the network, a model): what turns the TV off or changes the sound is refused
  async function fire(code, opts) {
    if (!enabled()) return { error: 'off' };
    const c = norm(code),
      btn = table()[c];
    if (!btn) return { error: 'no action for this key' };
    const now = Date.now();
    const quick = [btn].concat(btn.apps || []).some(x => x.type === 'volume_up' || x.type === 'volume_down');
    if (last[c] && now - last[c] < (quick ? REPEAT_VOLUME_MS : REPEAT_MS)) return { returnValue: true, repeat: true };
    last[c] = now;
    let r, e;
    try {
      e = await pick(btn);
      if (opts && opts.tool && NOT_FROM_TOOLS.indexOf(e.type) >= 0)
        return { returnValue: false, error: 'this button turns the TV off or changes the sound: press it on the remote' };
      r = await run(e);
    } catch (x) {
      r = { error: x.message };
    }
    const good = !!r && r.returnValue !== false && !r.error;
    if (!good) {
      const why = (r && (r.error || r.errorText)) || 'no answer',
        kind = (e ? e.type : '?') + ':' + why;
      if (!warned[kind]) {
        warned[kind] = true;
        console.error('remap: key ' + c + ' (' + (e ? e.type + (e.id ? ' ' + e.id : '') : '?') + ') failed: ' + why);
      }
    }
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
    const app = b.app === undefined || b.app === null || b.app === '' ? '' : b.app; // '' is the everywhere entry
    if (b.remove === true && !app) {
      config.update('manager', c => {
        if (c.remap) delete c.remap[code];
      });
      sync();
      return { returnValue: true };
    }
    if (b.remove === true) {
      const was = table()[code];
      if (!was || !(was.apps || []).some(a => a.app === app)) return { error: 'no such entry' };
      const rest = was.apps.filter(a => a.app !== app);
      config.update('manager', c => {
        c.remap = Object.assign({}, c.remap);
        const n = Object.assign({}, was);
        delete n.apps;
        if (rest.length) n.apps = rest;
        c.remap[code] = n;
      });
      sync();
      return { returnValue: true };
    }
    if (app) {
      // an entry for one app; the button must already have its everywhere entry, so that a press anywhere else is not lost
      const ent = cleanApp(b, app);
      if (!ent) return { error: typeof app === 'string' && NEEDS_ID.app.test(app) ? 'bad action' : 'bad app' };
      const was = table()[code];
      if (!was) return { error: 'no fallback' };
      if (!enabled()) return { error: 'off' };
      const apps = (was.apps || []).filter(a => a.app !== app);
      if (apps.length >= MAX_APPS) return { error: 'too many entries' };
      apps.push(ent);
      config.update('manager', c => {
        c.remap = Object.assign({}, c.remap);
        c.remap[code] = Object.assign({}, was, { apps });
      });
      sync();
      return { returnValue: true };
    }
    const e = clean(b);
    if (!e) return { error: 'bad action' };
    const old = table()[code]; // changing what a button does keeps the name found when it was learned, and its entries for one app
    if (old && old.apps) e.apps = old.apps;
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
        maxApps: MAX_APPS,
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
    // the remapped buttons with their names, and whether remapping is on, for the remote_buttons tool
    buttons: () => ({ on: enabled(), keys: shown() }),
    // the same moves a remapped button makes, for the navigate tool: home, live_tv (the launcher's Live TV) or input_list
    go: to => run({ type: to === 'live_tv' ? 'live' : to === 'home' ? 'home' : 'inputs' }),
    // for the tests
    table,
    fire,
    set,
  };
}

module.exports = { create, clean, cleanButton, TYPES, EXTRA, NOT_FROM_TOOLS };
