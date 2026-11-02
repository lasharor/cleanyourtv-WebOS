// The screen saver: our page in place of LG's screen saver app (scripts/20-cleanyourtv-screensaver, docs/screensaver.md). This module
// serves that page, closes it again, and opens it over an idle launcher when tvpowerd did not:
//   GET  /api/screensaver          {replaced, method, running, photos, every}
//   GET  /api/screensaver/photos   {photos: ['u/<id>', ...], stamp, every}   the wallpaper library (wallpapers.js)
//   POST /api/screensaver/active   {returnValue}   the launcher reports a key: the TV is in use, do not open the page over it
//   POST /api/screensaver/dismiss  {returnValue}   close the page: the app that was on screen comes back
// The page keeps LG's own screen-saver window type, and a page that stayed up would keep the remote. The page closes itself on the
// first key; this module closes it as well when the TV is back to Active for a minute while the page is still listed (the system ended
// the screen saver by itself, which stops the program sam started but not necessarily the page in webapp-mgr).
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

// May this module open the page itself? Only when the launcher has been in front for IDLE_MS since the last key it reported: "Home is
// in front" alone is not "idle" — a TV that is browsed with the remote is Home in front all evening, and LG's own screen saver only
// starts when no key arrives. A launcher that never reported anything (LG's Home in front, a launcher from before this endpoint) is
// no reason to open the page: then tvpowerd's own timer is the way in.
const IDLE_MS = 120000;
function mayOpen(now, homeSince, activeAt) {
  return !!activeAt && now - Math.max(homeSince, activeAt) >= IDLE_MS;
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
  // the seconds between photos: 25, or "saver.every" in config.json when a later version sets it (nothing writes it today; the
  // launcher's own wallpaper rotation, wall.secs, is for Home)
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

  // The way out of a page the system left behind, and a fallback way back in. With LG's own window type (`screenSaver`) tvpowerd
  // arms and relaunches the saver by itself (61 s in the measured cycles), but it did not fire in one cycle out of three, so the
  // service also opens the page — over an idle launcher only (mayOpen), which the launcher page keeps it informed about.
  const HOME = 'com.webos.app.home';
  let since = 0,
    homeSince = 0,
    tickN = 0,
    activeAt = 0,
    saidQuiet = false;
  // a key on the launcher (or the key that dismissed the page): the TV is in use now
  function active() {
    activeAt = Date.now();
    saidQuiet = false;
  }
  async function tick() {
    // nothing to watch when LG's screen saver is not replaced: no luna call every ten seconds on those TVs
    if (!replaced()) {
      since = 0;
      homeSince = 0;
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
      tickN++;
      if (tickN % 3 !== 0) return; // an idle timer does not need a luna call every ten seconds
      try {
        const fg = await luna(AM + 'getForegroundAppInfo', {});
        if (fg.appId !== HOME) {
          homeSince = 0;
          return;
        }
        if (!homeSince) {
          homeSince = Date.now();
          return;
        }
        if (!mayOpen(Date.now(), homeSince, activeAt)) {
          if (!activeAt && !saidQuiet) {
            saidQuiet = true;
            console.log('screensaver: the launcher has not reported a key yet; leaving the page to tvpowerd');
          }
          return;
        }
        homeSince = 0;
        console.log('screensaver: the launcher has been idle for two minutes; opening the page');
        await luna(AM + 'launch', { id: SA });
      } catch (_) {}
      return;
    }
    homeSince = 0;
    tickN = 0;
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
    if (u === '/api/screensaver/photos') return json({ photos: photos(), stamp: wp() ? wp().stamp() : '', every: every() });
    if (u === '/api/screensaver/active' && req.method === 'POST') {
      active();
      return json({ returnValue: true });
    }
    if (u === '/api/screensaver/dismiss' && req.method === 'POST') {
      active(); // the key that closed the page is the last thing the user did
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

  return { name: 'screensaver', prefix: '/api/screensaver', handle, start, photos, close, active, lastActive: () => activeAt };
}

module.exports = { create, replaced, mayOpen };
