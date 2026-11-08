// Open an app on an Android box instead of on the TV. For each app listed in the settings (the TV's app id, e.g. "plex"), launching it
// from the launcher switches the TV to the HDMI input the box is on and starts the box's app over ADB (network, port 5555).
//   GET  /api/androidbox        the settings, whether the key exists, what the last start did, and the phone page's state
//   POST /api/androidbox        {host, port, input, apps: {<TV app id>: <Android package>}} saves the settings; an empty host switches it off
//   GET  /api/androidbox/apps   the TV's apps with whether each opens on the box, its package, and a suggested package where it is known
//   POST /api/androidbox/app    {id, on, pkg?} one app on or off the box (the package: given, else the one saved, else the suggestion)
//   POST /api/androidbox/test   connects to the box and asks for its model, without switching the input
//   POST /api/androidbox/pair   {stop?} opens (or closes) the phone page on the LAN, port 8793, with a code shown on the TV
// The settings are kept in config.json (androidBox), apart from the launcher's own keys. The box must have network debugging on; the first
// connection makes it ask once to allow this TV (the key is made on the TV and kept in the service folder, adb/adbkey). The talking to
// the box is adbclient.js: no adb program is needed. Every value is checked before it is used.
const http = require('http'),
  path = require('path');
const P = require('../../paths'),
  web = require('../../web'),
  i18n = require('../../i18n'),
  nc = require('../../netcompat'),
  adbclient = require('./adbclient'),
  page = require('./page');

const HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9][A-Za-z0-9.\-]{0,62})$/;
const APP = /^[\w.\-]{1,100}$/;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const INPUT = /^com\.webos\.app\.hdmi\d{1,2}$/;
const MAX_APPS = 20;
const PAIR_PORT = 8793, // after the Cards page (8792)
  PAIR_MS = 10 * 60 * 1000;
const KEY_FILE = () => path.join(P.D, 'adb', 'adbkey'); // the key the box allows; a key copied from a computer (~/.android/adbkey) works too

// The usual Android package of well-known apps, found by the TV app's id or title. It is only a suggestion that the person can change;
// an app that is not on the box is reported when it is opened.
const KNOWN = [
  { re: /plex/i, pkg: 'com.plexapp.android' },
  { re: /netflix/i, pkg: 'com.netflix.ninja' },
  { re: /youtube/i, pkg: 'com.google.android.youtube.tv' },
  { re: /disney/i, pkg: 'com.disney.disneyplus' },
  { re: /prime video|^amazon /i, pkg: 'com.amazon.amazonvideo.livingroom' },
  { re: /spotify/i, pkg: 'com.spotify.tv.android' },
  { re: /twitch/i, pkg: 'tv.twitch.android.app' },
  { re: /kodi/i, pkg: 'org.xbmc.kodi' },
  { re: /jellyfin/i, pkg: 'org.jellyfin.androidtv' },
];
function suggest(app) {
  const text = (app.id || '') + ' ' + (app.title || '');
  for (const k of KNOWN) if (k.re.test(text)) return k.pkg;
  return '';
}
function suggestions(list) {
  const out = {};
  list.forEach(x => {
    const s = suggest(x);
    if (s) out[x.id] = s;
  });
  return out;
}

// the settings as they may be stored: only what is valid, or null when the box is not set up
function clean(b) {
  const o = b && typeof b === 'object' ? b : {};
  const host = typeof o.host === 'string' ? o.host.trim() : '';
  if (!HOST.test(host)) return null;
  const port = Math.round(Number(o.port) || 5555);
  if (!INPUT.test(o.input || '')) return null;
  const apps = {};
  const src = o.apps && typeof o.apps === 'object' && !Array.isArray(o.apps) ? o.apps : {};
  Object.keys(src)
    .slice(0, MAX_APPS)
    .forEach(id => {
      if (APP.test(id) && typeof src[id] === 'string' && PACKAGE.test(src[id])) apps[id] = src[id];
    });
  return { host, port: port > 0 && port < 65536 ? port : 5555, input: o.input, apps };
}

// what is wrong with a request that is not valid, for the person typing it
function why(o) {
  if (!HOST.test(typeof o.host === 'string' ? o.host.trim() : '')) return 'The address of the box is not valid.';
  if (!INPUT.test(o.input || '')) return 'Choose the HDMI input the box is on.';
  return 'The Android package of an app is not valid, for example ' + page.PLEX + '.';
}

function create(ctx) {
  const { config, luna } = ctx;
  let savedAt = 0; // when the settings last changed, for the manager to see that the phone saved
  let last = null; // what the last start did: {at, app, ok, step, error}
  let busy = 0; // the time a start began; a second tap meanwhile is ignored

  const settings = () => clean(config.get().androidBox);

  const failure = (step, error) => ({ ok: false, step, error });

  // connect and run one shell command on the box; resolves {ok, step, error, out}
  async function onBox(cfg, command) {
    let key;
    try {
      key = await adbclient.ensureKey(KEY_FILE());
    } catch (e) {
      return failure('key', e.message);
    }
    return adbclient.run({ host: cfg.host, port: cfg.port, command, key, authMs: Number(process.env.CYTV_ADB_AUTH_MS) || 30000 });
  }

  // the TV's own input app is launched, like a pinned input (apps.js)
  const switchInput = cfg => luna('luna://com.webos.applicationManager/launch', { id: cfg.input, params: {} });

  async function startOnBox(cfg, id) {
    const pkg = cfg.apps[id];
    // wake the box, then start the app by its launcher entry (no need to know the activity name)
    // (an app made only for Android TV has no LAUNCHER entry, just a LEANBACK_LAUNCHER one: try that when the first finds nothing)
    const start = 'monkey -p ' + pkg + ' -c android.intent.category.';
    const r = await onBox(
      cfg,
      'input keyevent KEYCODE_WAKEUP; o=$(' +
        start +
        'LAUNCHER 1 2>&1); case "$o" in *"No activities found"*) o=$(' +
        start +
        'LEANBACK_LAUNCHER 1 2>&1);; esac; echo "$o"'
    );
    let res = r;
    const name = await titleOf(id);
    if (r.ok && /No activities found|monkey aborted/i.test(r.out))
      res = failure('launch', name + ' is not installed on the box (' + pkg + ')');
    last = { at: Date.now(), app: id, ok: res.ok, step: res.step, error: res.error };
    // the TV shows the box's screen by now, so say on it what went wrong
    if (!res.ok) {
      tell(
        res.step === 'launch'
          ? name + ' is not installed on the Android box. Install it there, or move it back to the TV under Android box > Choose apps.'
          : name + ' could not open on the Android box: ' + res.error
      );
    }
    console.log('androidbox: ' + id + ' -> ' + pkg + (res.ok ? ' started' : ' failed at ' + res.step + ': ' + res.error));
    return res;
  }

  // the name of a TV app as the person knows it (the id when the TV does not say)
  async function titleOf(id) {
    try {
      const a = ctx.feature && ctx.feature('apps');
      const hit = ((a && (await a.apps())) || []).filter(x => x.id === id)[0];
      return (hit && hit.title) || id;
    } catch (_) {
      return id;
    }
  }

  // a message over whatever is on the TV (the notification window), best effort
  function tell(text) {
    try {
      const n = ctx.feature && ctx.feature('notify');
      if (n && n.show)
        Promise.resolve(n.show({ title: 'Android box', text: String(text || '').slice(0, 200), seconds: 8 }, true)).catch(() => {});
    } catch (_) {}
  }

  const handles = id => !!(settings() && settings().apps[id]);

  // switch the input now; the app is started on the box in the background (adb takes seconds), and the result is in /api/androidbox
  async function open(id) {
    const cfg = settings();
    if (!cfg || !cfg.apps[id]) return null;
    if (busy && Date.now() - busy < 60000) return { returnValue: true, androidBox: 'busy' }; // the box may be waiting for its owner to answer
    busy = Date.now();
    const sw = await switchInput(cfg);
    startOnBox(cfg, id)
      .catch(e => console.error('androidbox: ' + ((e && e.stack) || e)))
      .then(() => {
        busy = 0;
      });
    return { returnValue: sw.returnValue !== false, androidBox: 'starting' };
  }

  async function status() {
    return {
      configured: !!settings(),
      settings: settings(),
      key: { ready: adbclient.keyExists(KEY_FILE()), path: KEY_FILE() },
      last,
      pairing: !!pair,
      savedAt,
    };
  }

  async function save(b) {
    const o = b && typeof b === 'object' ? b : {};
    const off = typeof o.host === 'string' && !o.host.trim();
    const next = off ? null : clean(o);
    const asked = o.apps && typeof o.apps === 'object' ? Object.keys(o.apps).length : 0;
    if (!off && (!next || (asked && !Object.keys(next.apps).length))) return { error: why(o) };
    config.update('androidbox', c => {
      if (next) c.androidBox = next;
      else delete c.androidBox;
    });
    savedAt = Date.now();
    return status();
  }

  async function test() {
    const cfg = settings();
    if (!cfg) return { ok: false, step: 'settings', error: 'the box is not set up' };
    const r = await onBox(cfg, 'getprop ro.product.model');
    return { ok: r.ok, step: r.step, error: r.error, model: r.ok ? r.out.split('\n')[0] : '' };
  }

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function startPair() {
    stopPair();
    const code = String(nc.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => phone(req, res, code, () => ++bad));
    pair = { code, srv, url: 'http://' + web.lanIp() + ':' + PAIR_PORT, timer: setTimeout(stopPair, PAIR_MS) };
    const out = { url: pair.url, code, qr: pair.url + '/#' + code, seconds: PAIR_MS / 1000 };
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve(out));
    });
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    const until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, until - Date.now());
  }
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
      if (pair.srv.closeIdleConnections) pair.srv.closeIdleConnections(); // Node 18.2 and newer
    } catch (_) {}
    pair = null;
  }
  async function installedApps() {
    const a = ctx.feature && ctx.feature('apps');
    const list = a ? await a.apps() : [];
    return list.filter(x => !x.input && !x.sys && x.id !== 'com.cleanyourtv.manager').map(x => ({ id: x.id, title: x.title }));
  }
  // the TV's apps for choosing: on = opens on the box, pkg = its package there, suggest = the usual package where the app is known
  async function choices() {
    const cfg = settings();
    const have = (cfg && cfg.apps) || {};
    const list = (await installedApps()).map(x => ({
      id: x.id,
      title: x.title,
      on: !!have[x.id],
      pkg: have[x.id] || '',
      suggest: suggest(x),
    }));
    Object.keys(have).forEach(id => {
      if (!list.some(x => x.id === id)) list.push({ id, title: id, on: true, pkg: have[id], suggest: '' });
    });
    return list;
  }
  // one app on or off the box; the other choices stay. Needs a box that is set up.
  async function toggle(b) {
    const cfg = settings();
    if (!cfg) return { error: 'Set up the box first.' };
    const id = b && typeof b.id === 'string' ? b.id : '';
    if (!APP.test(id)) return { error: 'This app is not valid.' };
    const apps = Object.assign({}, cfg.apps);
    if (b.on === false) delete apps[id];
    else {
      const known = (await choices()).filter(x => x.id === id)[0];
      const pkg = typeof b.pkg === 'string' && b.pkg.trim() ? b.pkg.trim() : apps[id] || (known && known.suggest) || '';
      if (!pkg) return { error: 'This app needs its Android package: type it on your phone (Set up from your phone).' };
      if (!PACKAGE.test(pkg)) return { error: 'The Android package of this app is not valid.' };
      if (!apps[id] && Object.keys(apps).length >= MAX_APPS) return { error: 'Up to ' + MAX_APPS + ' apps can open on the box.' };
      apps[id] = pkg;
    }
    config.update('androidbox', c => {
      c.androidBox = Object.assign({}, cfg, { apps });
    });
    savedAt = Date.now();
    return status();
  }
  async function phone(req, res, code, wrong) {
    // a page that was closed (or replaced by a newer one) answers nothing, also on a connection a phone kept open
    if (!pair || pair.code !== code) {
      res.writeHead(410, { 'cache-control': 'no-store' });
      return res.end();
    }
    const u = req.url.split('?')[0],
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(page.phonePage(i18n.lang(req, config.get().lang)));
    }
    if (u.indexOf('/api/') !== 0) return web.notFound(res);
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    if (u === '/api/state') return json({ settings: settings(), apps: await installedApps(), suggest: suggestions(await installedApps()) });
    if (u === '/api/save' && req.method === 'POST') {
      const r = await save(await web.body(req, 65536));
      return json(r.error ? { error: i18n.tr(i18n.lang(req, config.get().lang), r.error) } : { ok: true, settings: r.settings });
    }
    json({ error: 'not found' }, 404);
  }

  async function handle(req, res, u, body) {
    if (u === '/api/androidbox' && req.method === 'POST') {
      const r = await save(await body(req));
      return web.json(res, r, r.error ? 400 : 200);
    }
    if (u === '/api/androidbox') return web.json(res, await status());
    if (u === '/api/androidbox/apps') return web.json(res, { apps: await choices() });
    if (u === '/api/androidbox/app' && req.method === 'POST') {
      const r = await toggle(await body(req));
      return web.json(res, r, r.error ? 400 : 200);
    }
    if (u === '/api/androidbox/test' && req.method === 'POST') return web.json(res, await test());
    if (u === '/api/androidbox/pair' && req.method === 'POST') {
      const b = await body(req);
      return web.json(res, b.stop ? (stopPair(), {}) : await startPair());
    }
    web.notFound(res);
  }

  // the add-on's own part: /api/androidbox... is answered through its manifest "routes" (addon.json), and the launch hook in
  // helper/apps.js asks for handles() and open()
  return { handle, handles, open };
}

module.exports = { create, clean, suggest };
