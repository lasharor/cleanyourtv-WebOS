// The Spotify add-on: the service part of the Now playing card (cards/nowplaying/) and the phone page where Spotify is connected.
// What plays comes from Spotify's Web API (nowplaying.js: the person's own Spotify developer app, sign-in with PKCE, tokens in this
// add-on's settings, never logged or sent anywhere but to Spotify). The card asks for its data every few seconds (cards.feed): the
// answer carries the cover as a data: address, because the card's frame has no network. Its buttons (previous, play or pause, next)
// arrive as actions. The phone page (settings(): a short-lived server on the LAN, port 8797, needs the code shown on the TV in every
// request, header x-code) is where the Client ID is entered and the sign-in finished. Written from the Now playing card of the pull
// request that first added it to the launcher (Edenik, #127).
const http = require('http');
const phone = require('./phone');
const nowplaying = require('./nowplaying');

const PAIR_PORT = 8797, // after the Unsplash page (8796)
  PAIR_MS = 10 * 60 * 1000;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COVER_MAX = 90 * 1024; // a cover as a data: address stays well below what the card's feed may carry

function create(ctx) {
  const util = ctx.util,
    i18n = util.i18n;
  const np = nowplaying.create({ settings: ctx.settings, fetch: ctx.fetch, log: ctx.log });
  const lang = req => i18n.lang(req || null, ctx.env.lang());
  const T = s => i18n.tr(lang(), s);

  // ---- the card ----
  let cover = { key: '', uri: '' };
  async function coverOf(key) {
    if (!key) return '';
    if (cover.key === key) return cover.uri;
    const a = await np.art(key);
    const uri =
      a && a.body && a.body.length <= COVER_MAX ? 'data:' + String(a.type).split(';')[0] + ';base64,' + a.body.toString('base64') : '';
    cover = { key, uri };
    return uri;
  }
  async function feed() {
    const n = await np.now(false);
    const out = {
      connected: n.connected !== false,
      playing: !!n.playing,
      paused: !!n.paused,
      title: n.title || '',
      artist: n.artist || '',
      progress: n.progress || 0,
      duration: n.duration || 0,
      at: Date.now(),
    };
    if (n.error) out.error = T(n.error);
    if (n.connected === false) out.hint = T('Spotify is not connected: set it up from Add-ons > Spotify now playing.');
    if (n.rejected) out.rejected = n.rejected;
    if (n.title) out.cover = await coverOf(n.art);
    return out;
  }
  async function action(id, opt, name) {
    const n = await np.now(false);
    const what = name === 'prev' ? 'previous' : name === 'next' ? 'next' : name === 'toggle' ? (n.playing ? 'pause' : 'play') : '';
    if (!what) return { error: 'no such action' };
    const r = await np.control(what);
    return r.error ? { error: T(r.error) } : { ok: true };
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
    // (the answers carry their errors in English: translated here, for the phone)
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
      if (u === '/api/state') return json(said(np.status()));
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = await body(req);
      if (u === '/api/prepare') return json(said(np.prepare(b.clientId, b.redirect)));
      if (u === '/api/finish') return json(said(await np.finish(b.address)));
      if (u === '/api/disconnect') return json(said(np.disconnect()));
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

  return { cards: { feed, action }, settings, handle: (q, r) => r.end('{}'), np, handlePhone };
}

module.exports = { create, PAIR_PORT };
