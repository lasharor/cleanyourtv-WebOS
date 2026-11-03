// The Jellyfin add-on: the Continue watching card for Home (cards/continue/) and the phone page where the server is signed in to.
// The card shows where you were in films and episodes (and, when you want, the next episode of a series you follow) with their
// pictures and how far you got; OK on one opens your Jellyfin app on the TV. The data comes straight from your Jellyfin server
// (jellyfin.js); the pictures go to the card as data: addresses, because the card's frame has no network. Which app opens: the
// official Jellyfin app, Litefin or Moonfin (the ones of LG's store and the Homebrew Channel), the first one installed or the one
// chosen in the card's options. Every app gets the title in its launch parameters ({itemId, serverId, tmdbId, mediaType, title}):
// Litefin opens that title by its TMDB id (from its version after 2.0.20); the others open on their own Home, as their apps do not
// read launch parameters on webOS. The phone page (settings(): a short-lived server on the LAN, port 8798, the code shown on the TV in
// every request, header x-code) takes the address, user name and password; only the access token Jellyfin answers is kept.
const http = require('http');
const phone = require('./phone');
const jellyfin = require('./jellyfin');

const PAIR_PORT = 8798, // after the Spotify page (8797)
  PAIR_MS = 10 * 60 * 1000;
const APPS = ['org.jellyfin.webos', 'org.litefin.app', 'org.moonfin.webos'];
const FEED_PICS = 110 * 1024; // the pictures of one answer together; the feed may carry 128 KB
const PIC_MAX = 40 * 1024;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function create(ctx) {
  const util = ctx.util,
    i18n = util.i18n;
  const jf = jellyfin.create({ settings: ctx.settings, fetch: ctx.fetch });
  const lang = req => i18n.lang(req || null, ctx.env.lang());
  const T = s => i18n.tr(lang(), s);

  // ---- the card ----
  const style = opt => (opt && opt.style === 'poster' ? 'poster' : 'wide');
  const count = opt => {
    const n = parseInt(opt && opt.count, 10);
    return n >= 1 && n <= 6 ? n : 0;
  };
  // pictures already made into data: addresses, by image and tag (a picture changes only with its tag)
  let pics = {},
    picKeys = [];
  async function pic(ref, st) {
    if (!ref) return '';
    const key = st + '|' + ref.id + '|' + ref.type + '|' + (ref.index || 0) + '|' + (ref.tag || '');
    if (pics[key] !== undefined) return pics[key];
    let uri = '';
    try {
      const p = await jf.picture(ref, st);
      if (p && p.body.length <= PIC_MAX) uri = 'data:' + p.type + ';base64,' + p.body.toString('base64');
    } catch (_) {}
    pics[key] = uri;
    picKeys.push(key);
    while (picKeys.length > 40) delete pics[picKeys.shift()];
    return uri;
  }
  // what each card showed last, so a button opens the title that was on screen
  const shown = {};
  async function feed(id, opt) {
    const s = jf.status();
    if (!s.connected)
      return {
        connected: false,
        hint: T('Jellyfin is not connected: set it up from Add-ons > Jellyfin continue watching > Set up from your phone.'),
        at: Date.now(),
      };
    let items;
    try {
      items = await jf.list(count(opt) || (style(opt) === 'poster' ? 6 : 4), !opt || opt.nextup !== 'off');
    } catch (e) {
      return { connected: true, error: T(String(e.message || e)), items: [], at: Date.now() };
    }
    shown[id] = items;
    const st = style(opt),
      out = [];
    let room = FEED_PICS;
    for (const i of items) {
      let p = await pic(st === 'poster' ? i.poster : i.wide, st);
      if (p.length > room) p = '';
      room -= p.length;
      out.push({
        title: i.title,
        sub: i.sub,
        pct: i.pct,
        left: i.left ? T(i.left + ' min left') : i.next ? T('Next episode') : '',
        pic: p,
      });
    }
    return { connected: true, style: st, count: count(opt), items: out, empty: out.length ? '' : T('Nothing to continue'), at: Date.now() };
  }

  // the app that opens: the one chosen, or the first of the three that is installed (asked of LG's app manager, kept 10 minutes)
  let installed = { at: 0, list: [] };
  async function apps() {
    if (Date.now() - installed.at < 600000) return installed.list;
    const list = [];
    for (const a of APPS) {
      const r = ctx.luna ? await ctx.luna('luna://com.webos.applicationManager/getAppInfo', { id: a }).catch(() => null) : null;
      if (r && r.returnValue !== false && r.appInfo) list.push(a);
    }
    installed = { at: Date.now(), list };
    return list;
  }
  async function launchParams(i) {
    const c = ctx.settings.get() || {},
      p = { itemId: i.id };
    if (c.serverId) p.serverId = c.serverId;
    const tmdb = i.kind === 'episode' ? (await jf.seriesTmdb([i.seriesId]))[i.seriesId] : i.kind === 'movie' ? i.tmdb : '';
    if (/^\d+$/.test(tmdb || '')) {
      p.tmdbId = +tmdb;
      p.mediaType = i.kind === 'episode' ? 'tv' : 'movie';
      p.title = i.title;
    }
    return p;
  }
  async function action(id, opt, name) {
    const m = /^open([1-6])$/.exec(name || '');
    if (!m) return { error: 'no such action' };
    let list = shown[id];
    if (!list) {
      await feed(id, opt);
      list = shown[id] || [];
    }
    const i = list[+m[1] - 1];
    if (!i) return { error: T('Nothing to continue') };
    const have = await apps();
    const app = opt && APPS.indexOf(opt.app) >= 0 ? opt.app : have[0];
    if (!app || have.indexOf(app) < 0) return { error: T('No Jellyfin app is installed: Jellyfin, Litefin or Moonfin.') };
    const r = await ctx.luna('luna://com.webos.applicationManager/launch', { id: app, params: await launchParams(i) });
    return r && r.returnValue !== false ? { ok: true, app } : { error: T('The Jellyfin app did not open.') };
  }

  // ---- the phone page ----
  let pair = null;
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, pair.until - Date.now());
  }
  function body(req) {
    return new Promise((resolve, reject) => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > 4096) {
          reject(new Error('too large'));
          req.destroy();
        } else b.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(b).toString('utf8') || '{}'));
        } catch (_) {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }
  async function handlePhone(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      l = lang(req),
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    const said = o => (o.error ? Object.assign({}, o, { error: i18n.tr(l, o.error) }) : o);
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phone.page(i18n, esc, l));
    }
    if (u.indexOf('/api/') !== 0) {
      res.writeHead(404);
      return res.end();
    }
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    try {
      if (u === '/api/state') return json(jf.status());
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = await body(req);
      if (u === '/api/signin') {
        const r = await jf.signIn(b.url, b.user, b.password);
        if (!r.error) {
          pics = {};
          picKeys = [];
          Object.keys(shown).forEach(k => delete shown[k]);
        }
        return json(said(r));
      }
      if (u === '/api/signout') return json(said(await jf.signOut()));
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }
  function settings(o) {
    stopPair();
    if (o && o.stop) return {};
    const code = String(util.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => handlePhone(req, res, code, () => ++bad));
    pair = { code, srv, until: Date.now() + PAIR_MS, timer: setTimeout(stopPair, PAIR_MS) };
    const url = 'http://' + util.lanIp() + ':' + PAIR_PORT;
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve({ url, code, qr: url + '/#' + code, seconds: PAIR_MS / 1000 }));
    });
  }

  return { cards: { feed, action }, settings, handle: (q, r) => r.end('{}'), jf, handlePhone, stopPair };
}

module.exports = { create, PAIR_PORT, APPS };
