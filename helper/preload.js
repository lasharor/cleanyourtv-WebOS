// Preloaded apps (issues 105, 148). LG's webos-preload-manager starts apps in the background (YouTube, Netflix, the browser, Home, the
// inputs) so they open faster, and looks again every 5 minutes. On a TV with little memory that costs more than it saves. The daemon
// has a policy per app: isEnabled (on/off), preloadMode (partial, semi-full, full, criu: how much of the app is started) and
// preloadType (periodic: again and again, oneshot: once). The manager app (Experimental) shows every app of that policy and lets
// you change it; options.preloadPolicy in config.json keeps the choices as {id: {enabled, mode, type}}.
// Facts from a real TV (webOS 25), see docs/debloat.md:
//  - setPreloadPolicy {application:{id, ...}, permanent} changes the policy at run time only, nothing is kept over a reboot, so the
//    service sets it again after every boot, every wake from standby and every 5 minutes (LG may reset it);
//  - an omitted isEnabled becomes false, so isEnabled is always sent; mode and type the daemon never checks ("bogus" was stored), so
//    they are checked here; isAllowed cannot be changed through the API, only read;
//  - an app with an extPolicy (Home) is managed by LG and is left alone.
// options.closePreloaded (older versions: app ids to close once after boot) still works: an app on it is a disabled one.
//   GET  /api/preload                             the policy as the TV has it, with the saved choices
//   POST /api/preload {id, enabled, mode, type}   any of the three: saved, set at once; a disabled app that runs in the background closes
//   POST /api/preload {id, reset: true}           back to what the TV had at its boot
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const web = require('./web');
const paths = require('./paths');

const SVC = 'luna://com.webos.service.preloadmanager/';
const AM = 'luna://com.webos.applicationManager/';
const MODES = ['partial', 'semi-full', 'full', 'criu'];
const TYPES = ['periodic', 'oneshot'];
const DELAY = 90000; // after boot, once the apps have finished starting: set the policy and close what already runs
const EVERY = 300000; // the daemon looks every 5 minutes
const TICK = 10000; // the wake check
const WAKE = 45000; // a gap this long between two ticks: the TV was suspended
const WAKE_AGAIN = 30000; // LG may set its policy a while after the wake
const SAFE = /^com\.(cleanyourtv\.|webos\.app\.(home|hdmi|livetv|tvhotkey))/; // never Home, inputs, Live TV or our own apps are closed

const isId = id => typeof id === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(id);
// the ids from a request: strings that look like app ids, once each, never one of SAFE
const clean = list => (Array.isArray(list) ? list : []).filter((id, i, a) => isId(id) && !SAFE.test(id) && a.indexOf(id) === i);

// ctx.baseFile: where LG's own policy is kept, written once at the first reading, before the service changed anything. It lives in the
// service folder, so it stays over reboots, standby and updates (it was in /tmp, which a restart of the service or a reboot loses and
// the next reading would then record what the service had set). The file of /tmp is taken over once.
function create(ctx) {
  const { luna, config } = ctx;
  const baseFile = ctx.baseFile || paths.PRELOAD_BASE;
  const oldFile = ctx.oldBaseFile || path.join(os.tmpdir(), 'cytv-preload-base.json');

  // the policy as the TV has it: {apps: [{id, enabled, allowed, mode, type, memory, managed}]}, or {error}
  async function read() {
    const r = await luna(SVC + 'getPreloadPolicy', {});
    if (!r || !Array.isArray(r.applications)) return { error: (r && r.errorText) || 'the preload manager did not answer' };
    return {
      apps: r.applications
        .filter(a => a && isId(a.id))
        .map(a => ({
          id: a.id,
          enabled: a.isEnabled === true,
          allowed: a.isAllowed === true,
          mode: String(a.preloadMode || ''),
          type: String(a.preloadType || ''),
          memory: +a.requiredMemory || 0,
          managed: Array.isArray(a.extPolicy) && a.extPolicy.length > 0,
        })),
    };
  }

  // what each app had before the service changed anything: the file kept by the first reading ever (or the older one of /tmp)
  function base(apps) {
    const load = f => {
      try {
        const x = JSON.parse(fs.readFileSync(f, 'utf8'));
        return x && typeof x === 'object' && Object.keys(x).length ? x : null;
      } catch (_) {
        return null;
      }
    };
    let b = load(baseFile);
    if (b) return b;
    b = load(oldFile);
    if (b) {
      try {
        fs.writeFileSync(baseFile, JSON.stringify(b));
      } catch (_) {}
      return b;
    }
    b = {};
    apps.forEach(a => (b[a.id] = { enabled: a.enabled, mode: a.mode, type: a.type }));
    try {
      fs.writeFileSync(baseFile, JSON.stringify(b));
    } catch (_) {}
    return b;
  }

  // the choices: options.preloadPolicy, and the ids of the older closePreloaded as disabled
  function saved() {
    const o = config.options() || {},
      s = {};
    const p = o.preloadPolicy && typeof o.preloadPolicy === 'object' ? o.preloadPolicy : {};
    for (const id of Object.keys(p)) if (isId(id)) s[id] = p[id];
    for (const id of clean(o.closePreloaded)) if (!s[id]) s[id] = { enabled: false };
    return s;
  }

  // the value to set: what the TV has, changed by what was chosen, only values that are allowed
  function want(app, c) {
    const w = { enabled: app.enabled, mode: app.mode, type: app.type };
    if (c && typeof c.enabled === 'boolean') w.enabled = c.enabled;
    if (c && MODES.indexOf(c.mode) >= 0) w.mode = c.mode;
    if (c && TYPES.indexOf(c.type) >= 0) w.type = c.type;
    return w;
  }
  const same = (a, w) => a.enabled === w.enabled && a.mode === w.mode && a.type === w.type;

  async function push(app, w) {
    const r = await luna(SVC + 'setPreloadPolicy', {
      application: { id: app.id, isEnabled: w.enabled, isAllowed: app.allowed, preloadMode: w.mode, preloadType: w.type },
      permanent: false,
    });
    return r && r.returnValue === true ? '' : (r && r.errorText) || 'the preload manager refused';
  }

  // apps running in the background but not in front are closed (never one of SAFE)
  async function close(ids) {
    const closed = [];
    const todo = ids.filter(id => isId(id) && !SAFE.test(id));
    if (!todo.length) return closed;
    const r = await luna(AM + 'running', {});
    if (!r || !Array.isArray(r.running)) return closed;
    const fg = await luna(AM + 'getForegroundAppInfo', {});
    const front = fg && fg.appId;
    for (const id of todo) {
      if (id === front || !r.running.some(x => x && (x.id || x.appId) === id)) continue;
      let c = await luna(AM + 'closeByAppId', { id });
      if (c.returnValue !== true) c = await luna(AM + 'close', { id });
      if (c.returnValue === true) closed.push(id);
    }
    if (closed.length) console.log('preload: closed ' + closed.join(', '));
    return closed;
  }

  let busy = Promise.resolve(); // one change at a time
  const queue = fn => (busy = busy.then(fn, fn));

  // sets every saved choice the TV does not have; closeNow: also closes the disabled apps that run (once, after the boot)
  function apply(closeNow) {
    return queue(async () => {
      const p = await read();
      const s = saved();
      if (p.error) {
        // no preload manager (older webOS): the older list is still closed
        const legacy = Object.keys(s).filter(id => s[id].enabled === false);
        return { changed: [], closed: closeNow ? await close(legacy) : [], error: p.error };
      }
      base(p.apps);
      const changed = [],
        off = [];
      let error = '';
      for (const a of p.apps) {
        if (!s[a.id] || a.managed || !a.allowed) continue;
        const w = want(a, s[a.id]);
        if (!same(a, w)) {
          const e = await push(a, w);
          if (e) error = e;
          else changed.push(a.id);
        }
        if (!w.enabled) off.push(a.id);
      }
      if (changed.length) console.log('preload: policy set for ' + changed.join(', '));
      const closed = closeNow ? await close(off) : [];
      return error ? { changed, closed, error } : { changed, closed };
    });
  }

  async function status(error) {
    const p = await read();
    if (p.error) return { available: false, error: p.error, apps: [], modes: MODES, types: TYPES };
    const b = base(p.apps),
      s = saved();
    return Object.assign(
      {
        available: true,
        modes: MODES,
        types: TYPES,
        apps: p.apps.map(a => Object.assign({}, a, { saved: !!s[a.id], base: b[a.id] || null })),
      },
      error ? { error } : {}
    );
  }

  async function handle(req, res, u, body) {
    if (req.method !== 'POST') return web.json(res, await status());
    const b = await body(req);
    if (!isId(b.id)) return web.json(res, { error: 'id must be an app id' }, 400);
    if (b.mode !== undefined && MODES.indexOf(b.mode) < 0) return web.json(res, { error: 'mode must be one of ' + MODES.join(', ') }, 400);
    if (b.type !== undefined && TYPES.indexOf(b.type) < 0) return web.json(res, { error: 'type must be one of ' + TYPES.join(', ') }, 400);
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return web.json(res, { error: 'enabled must be true or false' }, 400);
    const result = await queue(async () => {
      const p = await read();
      if (p.error) return p.error;
      const app = p.apps.filter(a => a.id === b.id)[0];
      if (!app) return 'the TV has no preload policy for ' + b.id;
      if (!app.allowed) return 'LG does not allow ' + b.id + ' to be preloaded on this TV';
      if (app.managed) return 'LG manages the preloading of ' + b.id + ' itself';
      const w = b.reset === true ? base(p.apps)[b.id] || want(app) : want(app, b);
      const e = await push(app, w);
      if (e) return e;
      config.update('manager', c => {
        c.options = c.options || {};
        const pp = Object.assign({}, c.options.preloadPolicy);
        if (b.reset === true) delete pp[b.id];
        else pp[b.id] = w;
        c.options.preloadPolicy = pp;
        // the older list would disable it again
        if (b.reset === true && Array.isArray(c.options.closePreloaded))
          c.options.closePreloaded = c.options.closePreloaded.filter(x => x !== b.id);
      });
      if (!w.enabled) await close([b.id]);
      return '';
    });
    web.json(res, await status(result));
  }

  const run = closeNow => () => apply(closeNow).catch(e => console.error('preload: ' + e.message));
  // A TV in standby is suspended and Node's timers do not count that time, so the 5 minute check above comes 5 awake minutes after a
  // wake, while LG sets its own policy again at the wake. A jump of the wall clock is a wake: set the choices at once, and once more
  // when LG has finished.
  let last = 0;
  function tick(now) {
    const woke = last && now - last > WAKE;
    last = now;
    if (!woke) return false;
    console.log('preload: the TV woke up, setting the policy');
    run(false)();
    const t = setTimeout(run(false), WAKE_AGAIN);
    if (t.unref) t.unref();
    return true;
  }
  const start = () => {
    for (const t of [setTimeout(run(false), 20000), setTimeout(run(true), DELAY)]) if (t.unref) t.unref();
    for (const i of [setInterval(run(false), EVERY), setInterval(() => tick(Date.now()), TICK)]) if (i.unref) i.unref();
    tick(Date.now());
  };
  return { name: 'preload', paths: ['/api/preload'], handle, start, apply, status, tick };
}

module.exports = { create, clean, MODES, TYPES };
