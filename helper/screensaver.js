// The screen saver: our page in place of LG's screen saver app (scripts/20-cleanyourtv-screensaver, docs/screensaver.md). This module
// serves that page and closes it again:
//   GET  /api/screensaver          {replaced, method, running, photos, every}
//   GET  /api/screensaver/photos   {photos: ['u/<id>', ...], stamp, every}   the wallpaper library (wallpapers.js)
//   POST /api/screensaver/dismiss  {returnValue}   close the page: the app that was on screen comes back
// The page is an overlay window, so a page that stayed up would keep the remote. The page closes itself on the first key; this module
// closes it as well when the TV is back to Active for a minute while the page is still listed (the system ended the screen saver by
// itself, which stops the program sam started but not necessarily the page in webapp-mgr).
const fs = require('fs');
const P = require('./paths'),
  web = require('./web');

const SA = 'com.webos.app.screensaver',
  WEBMGR = 'luna://com.palm.webappmanager/',
  AM = 'luna://com.webos.applicationManager/',
  CHECK_MS = 10000,
  GRACE_MS = 60000;

// is LG's screen saver replaced now (the app folder, or its program by the stand-in)?
function replaced() {
  try {
    const m = fs.readFileSync(P.PROC + '/mounts', 'utf8');
    let st = '';
    try {
      st = fs.readFileSync(P.SA_STANDIN, 'utf8').trim();
    } catch (_) {}
    return m.indexOf(' ' + P.SCREENSAVER_APP + ' ') >= 0 || (!!st && m.indexOf(' ' + st + ' ') >= 0);
  } catch (_) {
    return false;
  }
}

function create(ctx) {
  const { luna, config } = ctx;
  const wp = () => ctx.feature('wallpapers');
  const photos = () => {
    const w = wp();
    try {
      return w ? w.list() : [];
    } catch (_) {
      return [];
    }
  };
  // the seconds between photos: read from the launcher's wallpapers setting where there is one, else 25
  const every = () => {
    const s = config.get().saver || {};
    return typeof s.every === 'number' && s.every >= 10 ? Math.min(s.every, 3600) : 25;
  };
  async function running() {
    const r = await luna(WEBMGR + 'listRunningApps', {});
    return JSON.stringify(r).indexOf('"' + SA + '"') >= 0;
  }
  async function close() {
    // killApp is what closes a page webapp-mgr opened for us; closeByAppId is the app manager's own way (webOS 6 needed it for Home)
    await luna(WEBMGR + 'killApp', { appId: SA });
    await luna(AM + 'closeByAppId', { id: SA });
    return true;
  }

  // the way out of a page the system left behind: the TV is Active again and the page is still there
  let since = 0;
  async function tick() {
    // nothing to watch when LG's screen saver is not replaced: no luna call every ten seconds on those TVs
    if (!replaced()) {
      since = 0;
      return;
    }
    let up = false;
    try {
      up = await running();
    } catch (_) {
      return;
    }
    if (!up) {
      since = 0;
      return;
    }
    if (!since) {
      since = Date.now();
      return;
    }
    if (Date.now() - since < GRACE_MS) return;
    try {
      const pw = await luna('luna://com.webos.service.tvpower/power/getPowerState', {});
      // "Screen Saver Ready" (or "Screen Saver") in processing: tvpowerd holds the saver slot, so this page is the screen saver
      // itself, not one the system left behind (on the tested TV the state stays Active while our page is up)
      if (pw.state !== 'Active' || /screen saver/i.test(String(pw.processing || ''))) return;
      console.log('screensaver: the TV is on an app again; closing the page');
      await close();
      since = 0;
    } catch (_) {}
  }
  function start() {
    const t = setInterval(tick, CHECK_MS);
    if (t.unref) t.unref();
  }

  async function handle(req, res, u) {
    const json = (o, c) => web.json(res, o, c);
    if (u === '/api/screensaver/photos')
      return json({ photos: photos(), stamp: wp() ? wp().stamp() : '', every: every() });
    if (u === '/api/screensaver/dismiss' && req.method === 'POST') {
      await close();
      return json({ returnValue: true });
    }
    if (u === '/api/screensaver') {
      let method = '';
      try {
        method = String(fs.readFileSync(P.SA_METHOD, 'utf8')).trim();
      } catch (_) {}
      return json({ replaced: replaced(), method, running: await running(), photos: photos().length, every: every() });
    }
    web.notFound(res);
  }

  return { name: 'screensaver', prefix: '/api/screensaver', handle, start, photos, close };
}

module.exports = { create, replaced };
