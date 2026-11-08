// The manager app's API (/api/manager/*): status, updates (updates.js), options, learning remote buttons, the update channel, LG's
// Home or ours, and uninstalling. Also POST /api/frontend-ok (a new launcher reports that it started) and POST /api/undo (the
// launcher's "LG's Home" button).
const fs = require('fs');
const P = require('./paths'),
  web = require('./web'),
  exec = require('./exec'),
  debloat = require('./debloat');

// the TV comes back to its last app after a restart; that must not be one of ours
function fixLastApp() {
  try {
    if (fs.readFileSync(P.LASTAPP, 'utf8').includes('cleanyourtv')) fs.writeFileSync(P.LASTAPP, '{"lastAppId":"com.webos.app.home"}');
  } catch (_) {}
}
// Switching between LG's Home and ours needs a restart: LG's Home does not come back reliably while the system is running.
function setHome(enabled) {
  if (enabled) {
    try {
      fs.unlinkSync(P.DISABLE);
    } catch (_) {}
  } else {
    fs.writeFileSync(P.DISABLE, '');
    fixLastApp();
  }
  exec.detached('sleep 3; reboot');
}
const KEY_NAMES = ['home', 'voice', 'guide'];
const PICKER_MODES = ['overlay', 'ondemand', 'launcher'];

function create(ctx) {
  const { config } = ctx;
  const updates = require('./updates').create(ctx);
  const inputhook = ctx.inputhook || require('./inputhook');
  // the Input key part may be missing (failed to load): fall back to plain rules
  const inputkey = () =>
    ctx.feature('inputkey') || {
      mode: () => 'overlay',
      on: () => config.options().inputKey,
      syncMode() {},
      pickerShownAt: () => 0,
    };
  const keys = () => {
    const k = config.keys();
    return Object.assign(k, { inputIsDefault: !k.input, input: k.input || '241' });
  };
  const ensureHook = code => inputhook.ensure(inputkey().on(), code || keys().input);

  function status() {
    const opts = config.options(),
      voice = ctx.feature('voice'),
      napi = ctx.feature('notifyapi'),
      wp = ctx.feature('wallpapers'),
      ad = ctx.feature('addons');
    let ours = false;
    try {
      const mounts = fs.readFileSync(P.PROC + '/mounts', 'utf8');
      // the launcher's folder over LG's Home app, or the stand-in over LG's native Home program (scripts/home-standin.sh)
      const standin = fs.existsSync(P.STANDIN) ? fs.readFileSync(P.STANDIN, 'utf8').trim() : '';
      ours = mounts.includes(' ' + P.HOME_APP + ' ') || (!!standin && mounts.includes(' ' + standin + ' '));
    } catch (_) {}
    return Object.assign(updates.status(), {
      options: opts,
      picker: Object.assign({}, config.get().picker || {}, { mode: inputkey().mode(), released: !!opts.inputKey && !inputkey().on() }),
      voice: voice ? (v => ({ installed: v.installed, enabled: v.enabled, ha: v.ha.configured }))(voice.status()) : null,
      notifyApi: napi ? { enabled: napi.info().enabled, port: napi.info().port } : { enabled: false },
      wallpapers: wp ? (w => ({ total: w.total, uploads: w.uploads }))(wp.status()) : null,
      icons: !!(ad && ad.module && ad.module('icons')), // the App icons add-on runs
      lang: config.get().lang || '', // the Language setting: '' follows the TV
      home: { enabled: !fs.existsSync(P.DISABLE), fullhome: fs.existsSync(P.FULLHOME_APP), ours },
      inputhook: inputhook.status(keys().input),
      keys: keys(),
      job: updates.job(),
      repo: updates.repo(),
    });
  }

  async function setOptions(o) {
    const cur = config.options();
    const next = Object.assign({}, cur);
    for (const k of ['debloat', 'inputKey', 'liveTv', 'tuner']) if (typeof o[k] === 'boolean') next[k] = o[k];
    if (require('./audio').THEMES.indexOf(o.volumeTheme) >= 0) next.volumeTheme = o.volumeTheme;
    if (Array.isArray(o.debloatOff)) next.debloatOff = debloat.cleanOff(o.debloatOff);
    if (Array.isArray(o.closePreloaded)) next.closePreloaded = require('./preload').clean(o.closePreloaded);
    config.update('manager', c => {
      // the language of every screen: a two-letter code, or '' to follow the TV
      if (typeof o.lang === 'string' && /^([a-z]{2})?$/.test(o.lang)) {
        if (o.lang) c.lang = o.lang;
        else delete c.lang;
      }
      if (typeof o.pickerPrewarm === 'boolean')
        c.picker = Object.assign(
          {},
          c.picker,
          o.pickerPrewarm ? { prewarm: true } : { prewarm: false, reason: 'switched off in the manager', at: Date.now() }
        );
      if (PICKER_MODES.indexOf(o.pickerMode) >= 0)
        c.picker = Object.assign({}, c.picker, {
          mode: o.pickerMode,
          prewarm: o.pickerMode === 'overlay' ? true : (c.picker || {}).prewarm,
          reason: 'chosen in the manager',
          at: Date.now(),
        });
      c.options = next;
    });
    inputkey().syncMode();
    if (next.debloat !== cur.debloat) await debloat.apply(next.debloat);
    else if (next.debloat) await debloat.change(debloat.cleanOff(cur.debloatOff), debloat.cleanOff(next.debloatOff));
    if (next.volumeTheme !== cur.volumeTheme && ctx.audio && ctx.audio.syncStockVolumeOSD) {
      ctx.audio.syncStockVolumeOSD(next.volumeTheme);
    }
    if (next.closePreloaded && next.closePreloaded.length && String(next.closePreloaded) !== String(cur.closePreloaded))
      ((ctx.feature('preload') || {}).apply || (() => Promise.resolve()))(true).catch(() => {});
    ensureHook();
    return next;
  }

  // the code of the key just pressed while learning; saved here once it arrives ('learned' is set when the Input flow ends: keys-done)
  function learnState() {
    const l = inputhook.learnState();
    if (l.state === 'got' && !l.saved) {
      config.update('manager', c => {
        c.keys = Object.assign({ input: '241', home: '', voice: '' }, c.keys || {});
        c.keys[l.name] = l.code;
        // a button that becomes one of ours cannot stay remapped: the hook binds a code once, to the Input/Guide/voice key. Remove its
        // action here (and log it) so the manager does not keep showing a button that no longer does what it says.
        if (c.remap && c.remap[l.code]) delete c.remap[l.code];
      });
      if (inputhook.markSaved) inputhook.markSaved();
      if (l.name === 'input') ensureHook(l.code);
      else if (l.name === 'voice' || l.name === 'guide') ensureHook();
    }
    return l;
  }
  // forget a learned code: Input goes back to the default, the others to none
  function clearKey(name) {
    config.update('manager', c => {
      c.keys = Object.assign({ input: '', home: '', voice: '', guide: '' }, c.keys || {});
      c.keys[name] = '';
      if (name === 'input') c.keys.learned = false;
    });
    if (name !== 'home') ensureHook();
  }

  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    if (u === '/api/frontend-ok' && req.method === 'POST') {
      const b = await body(req);
      updates.frontendLoaded(String(b.version || ''));
      return json({ returnValue: true });
    }
    if (u === '/api/undo' && req.method === 'POST') {
      // LG's Home, kept until switched back on in the manager; restarts the TV
      setHome(false);
      return json({ returnValue: true });
    }
    const act = u.replace('/api/manager/', '');
    const napi = ctx.feature('notifyapi');
    if (act === 'status') {
      if (updates.stale()) updates.check();
      return json(status());
    }
    if (act === 'learn-state') return json(learnState());
    if (act === 'notify-api' && req.method === 'GET') return json(napi ? napi.info() : { enabled: false });
    if (act === 'test-key') return json({ pickerShownAt: inputkey().pickerShownAt(), now: Date.now() });
    if (act === 'tests') return json(await updates.tests());
    if (req.method !== 'POST') return json({ error: 'POST expected' }, 405);
    const b = await body(req);
    if (act === 'check') {
      await updates.check();
      return json(status());
    }
    if (act === 'channel') {
      const err = await updates.setChannel(b.tag);
      if (err) return json({ error: err }, err === 'unknown channel' ? 400 : 409);
      return json(status());
    }
    if (act === 'notify-api') return json(napi ? napi.set(b) : { enabled: false });
    if (act === 'learn-key') {
      inputhook.startLearn(KEY_NAMES.includes(b.name) ? b.name : 'input');
      return json({ returnValue: true });
    }
    if (act === 'clear-key') {
      clearKey(KEY_NAMES.includes(b.name) ? b.name : 'input');
      return json({ returnValue: true });
    }
    if (act === 'keys-done') {
      config.update('manager', c => {
        c.keys = Object.assign({ input: '241', home: '' }, c.keys || {}, { learned: true });
      });
      return json({ returnValue: true });
    }
    if (act === 'options') {
      await setOptions(b);
      return json(status());
    }
    if (act === 'home') {
      setHome(b.enabled !== false);
      return json({ returnValue: true });
    }
    if (act === 'restore') {
      setHome(false);
      return json({ returnValue: true });
    }
    if (act === 'uninstall') {
      exec.detached('sleep 1; sh ' + P.D + '/uninstall.sh');
      return json({ returnValue: true });
    }
    if (['update-frontend', 'rollback-frontend', 'update-service'].includes(act)) {
      if (updates.busy()) return json({ error: 'busy', job: updates.job() }, 409);
      const ver = String(b.version || '').replace(/[^0-9.]/g, '');
      if (act === 'update-frontend') updates.updateFrontend(ver);
      else if (act === 'update-service') updates.updateService(ver);
      else updates.rollbackFrontend();
      return json({ returnValue: true, job: updates.job() });
    }
    return json({ error: 'unknown action' }, 404);
  }

  return {
    name: 'manager',
    prefix: '/api/manager/',
    paths: ['/api/frontend-ok', '/api/undo'],
    handle,
    start: () => {
      return setInterval(updates.watchPackage, 120000);
    },
    check: updates.check,
    status,
    frontendLoaded: updates.frontendLoaded,
    useLgHome: () => setHome(false),
  };
}

module.exports = { create };
