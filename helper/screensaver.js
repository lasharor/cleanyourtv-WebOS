// The screen saver: our page in place of LG's screen saver app (scripts/20-cleanyourtv-screensaver, docs/screensaver.md). This module
// serves that page, closes it again, and opens it over an idle launcher when tvpowerd did not:
//   GET  /api/screensaver          {replaced, method, running, photos, every}
//   GET  /api/screensaver/photos?cc=<country>   {photos, credits, from, every}   what Home has behind it (background() below):
//        photos are library ids ('u/<id>', 's/<add-on>/<id>', 'l/<add-on>') or paths on this service; from: scenes, wallpapers, theme
//   GET  /api/screensaver/scene/<night|golden|water|fog|dawn>   a couch scene of the launcher (app/scene-<id>.jpg)
//   GET  /api/screensaver/live/<add-on>   {url, credit}: the photo a live source (Unsplash) gave Home last, so the saver shows the same
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
  GRACE_MS = 60000,
  EVERY_S = 25; // the seconds each photo stays on the page

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
// the couch scenes that ship with the launcher (app/scene-<id>.jpg, the list in app/src/js/scenes.js): the page is another app and
// cannot load the launcher's files by their relative names, so this module hands them out (only these names)
const COUCH = ['night', 'golden', 'water', 'fog', 'dawn'];
function mayOpen(now, homeSince, activeAt) {
  return !!activeAt && now - Math.max(homeSince, activeAt) >= IDLE_MS;
}

function create(ctx) {
  const { luna, config } = ctx;
  const wp = () => ctx.feature('wallpapers');
  // the library as Home shows it: uploads (u/<id>) and the photos of source add-ons (s/<add-on>/<id>), which the page loads from
  // /api/wallpapers/photo/, and live sources (l/<add-on>, Unsplash), whose current photo the page asks /api/wallpapers/live/<add-on>
  // for, as Home's wall.js does. An id of another kind is left out: the page would not know how to show it.
  const photos = () => {
    const w = wp();
    try {
      return w ? w.list().filter(id => /^[usl]\//.test(id)) : [];
    } catch (_) {
      return [];
    }
  };
  // What Home has behind it now, in Home's own order (app/src/js/scenes.js, wall.js, theme.js), so the saver shows the same:
  //   1. the theme's scenes: an add-on's scenes where one provides them (Seasons), else the five landscapes of the launcher (couch),
  //      or the theme's own scenes (custom); they take the place of the wallpaper and of Wallpapers, as on Home
  //   2. Wallpapers switched on and something in the library: the library (uploads, source add-ons, live sources)
  //   3. the theme's wallpaper
  //   4. nothing: the clock on black
  // An entry is a library id, or a path on this service that the page loads as it is; credits holds the line a photo comes with.
  async function background(cc) {
    const c = config.get() || {};
    const th = ctx.feature('theme');
    let t = null;
    try {
      t = th ? th.resolved() : null;
    } catch (_) {}
    if (t && t.scenes) {
      if (t.scenes.set === 'custom' && Array.isArray(t.scenes.lib) && t.scenes.lib.length)
        return {
          photos: t.scenes.lib.map(s => '/api/theme/scene/' + t.scenes.id + '/' + s.image),
          credits: {},
          from: 'scenes',
        };
      const sc = ctx.feature('scenes');
      try {
        const r = sc ? await sc.list(cc) : null;
        if (r && r.addon && r.scenes && r.scenes.length) {
          const credits = {};
          const list = r.scenes.map(s => {
            const p = '/api/scenes/photo/' + r.addon + '/' + s.id + '/image';
            if (s.credit) credits[p] = String(s.credit);
            return p;
          });
          return { photos: list, credits, from: 'scenes' };
        }
      } catch (_) {}
      return { photos: COUCH.map(id => '/api/screensaver/scene/' + id), credits: {}, from: 'scenes' };
    }
    // Wallpapers on with an empty library: Home's wall.js switches its layer off (sync() -> off()) and the theme's wallpaper shows
    if (c.wall && c.wall.on) {
      const lib = photos();
      if (lib.length) return { photos: lib, credits: {}, from: 'wallpapers' };
    }
    if (t && t.wallpaper)
      return { photos: ['/api/theme/wallpaper/' + t.wallpaper.id + '/' + t.wallpaper.file], credits: {}, from: 'theme' };
    return { photos: [], credits: {}, from: '' };
  }
  async function running() {
    const r = await luna(WEBMGR + 'listRunningApps', {});
    return JSON.stringify(r).indexOf('"' + SA + '"') >= 0;
  }
  async function close() {
    // killApp is what closes a page webapp-mgr opened for us; closeByAppId is the app manager's own way (webOS 6 needed it for Home).
    // Each is tried on its own: one that fails must not keep the other from running.
    try {
      await luna(WEBMGR + 'killApp', { appId: SA });
    } catch (_) {}
    try {
      await luna(AM + 'closeByAppId', { id: SA });
    } catch (_) {}
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
  // One check at a time: a check whose luna calls are slow (the app manager restarting) must not be joined by the next tick.
  let busy = false,
    wasUp = false,
    strikes = 0; // readings in a row that say the TV is on an app again (the safety close)
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await step();
    } finally {
      busy = false;
    }
  }
  async function step() {
    // nothing to watch when LG's screen saver is not replaced: no luna call every ten seconds on those TVs
    if (!replaced()) {
      since = 0;
      homeSince = 0;
      return;
    }
    // While the page is down the running list is read every third tick (30 s): the idle timer and a page that just came up do not
    // need it every ten seconds, all day. While the page is up it is read at every tick (the safety close counts on it).
    if (!wasUp) {
      tickN++;
      if ((tickN - 1) % 3 !== 0) return;
    }
    let up = false;
    try {
      up = await running();
    } catch (_) {
      return;
    }
    wasUp = up;
    if (!up) {
      since = 0;
      strikes = 0;
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
      // itself, not one the system left behind (on the tested TV the state stays Active while our page is up). That rests on
      // one string of LG's (docs/screensaver.md > Limits): a single reading without it decides nothing, two in a row close.
      if (pw.state !== 'Active' || /screen saver/i.test(String(pw.processing || ''))) {
        strikes = 0;
        return;
      }
      strikes++;
      if (strikes < 2) return;
      console.log('screensaver: the TV is on an app again; closing the page');
      strikes = 0;
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
    if (u === '/api/screensaver/photos') {
      // ?cc=<country>: the page passes the TV's country, as the launcher does for the scenes of an add-on (Seasons picks by it)
      const m = /[?&]cc=([A-Za-z]{2,3})(?:&|$)/.exec(req.url || '');
      const b = await background(m ? m[1].toUpperCase() : '');
      return json({ photos: b.photos, credits: b.credits, from: b.from, every: EVERY_S });
    }
    // a live source's photo: the one Home has now (wallpapers.js liveCurrent), not the next one the source would hand out
    const lm = /^\/api\/screensaver\/live\/([a-z][a-z0-9-]{1,31})$/.exec(u);
    if (lm) {
      const w = wp();
      return json(w && w.liveCurrent ? await w.liveCurrent(lm[1]) : { error: 'no wallpapers' });
    }
    const sm = /^\/api\/screensaver\/scene\/([a-z]+)$/.exec(u);
    if (sm && COUCH.indexOf(sm[1]) >= 0) {
      let b = null;
      try {
        b = fs.readFileSync(P.APP + '/scene-' + sm[1] + '.jpg');
      } catch (_) {}
      if (!b) return web.notFound(res);
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=600' });
      return res.end(b);
    }
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
      return json({ replaced: replaced(), method, running: await running(), photos: photos().length, every: EVERY_S });
    }
    web.notFound(res);
  }

  // tick and lastActive are for the tests (tools/test/screensaver.test.js): the timer's step, and when the launcher last reported a key
  return { name: 'screensaver', prefix: '/api/screensaver', handle, start, photos, close, active, tick, lastActive: () => activeAt };
}

module.exports = { create, replaced, mayOpen };
