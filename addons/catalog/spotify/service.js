// The Spotify add-on: the service part of the Now playing card (cards/nowplaying/) and the phone page where Spotify is connected.
// What plays comes from Spotify's Web API (nowplaying.js: the person's own Spotify developer app, sign-in with PKCE, tokens in this
// add-on's settings, never logged or sent anywhere but to Spotify). The card asks for its data every few seconds (cards.feed): the
// answer carries the cover as a data: address, because the card's frame has no network. Its buttons (previous, play or pause, next, output)
// arrive as actions, and so does the click on the cover (open the Spotify app on the song). The phone page (settings(): a short-lived server on the LAN, port 8797, needs the code shown on the TV in every
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
  // Spotify takes a few seconds to report what a button did: until it does, the card keeps showing what was asked for (a pause, a play,
  // a new track that Spotify still reports as the old one)
  let want = null, // {playing, until, title?, at}
    shown = null;
  const BAD_ACCOUNT = 'Spotify does not accept your account for this app. Add it under Users Management in your Spotify app.',
    BAD_SIGNIN = 'Spotify no longer accepts the saved sign-in. Sign in again from Add-ons > Spotify now playing.';
  async function feed() {
    const n = await np.now(!!(want && Date.now() < want.until));
    const out = {
      connected: n.connected !== false,
      playing: !!n.playing,
      paused: !!n.paused,
      title: n.title || '',
      artist: n.artist || '',
      device: n.device || '',
      playingOn: T('Playing on'),
      nowPlaying: T('Now playing'),
      progress: n.progress || 0,
      duration: n.duration || 0,
      at: Date.now(),
    };
    if (n.error) out.error = T(n.error);
    if (n.connected === false) out.hint = T('Spotify is not connected: set it up from Add-ons > Spotify now playing.');
    if (n.rejected) {
      out.rejected = n.rejected;
      // one notice each time the TV is on: the card's host shows it, and the service remembers that it was shown
      out.notice = T(n.rejected === 'account' ? BAD_ACCOUNT : BAD_SIGNIN);
      np.tell();
    }
    if (n.title) out.cover = await coverOf(n.art);
    const w = want;
    if (w && Date.now() < w.until && n.title) {
      if (w.title !== undefined && n.title === w.title && n.progress > 5000) {
        // next or previous: still the old track, so the card shows the new one starting from the beginning
        out.progress = Date.now() - w.at;
        out.playing = true;
        out.paused = false;
        if (shown && shown.title === w.title) out.progress = Math.max(out.progress, 0);
      } else if (w.title === undefined && !!n.playing !== w.playing) {
        out.playing = w.playing;
        out.paused = !w.playing;
      } else want = null;
    } else want = null;
    shown = out;
    return out;
  }
  const SPOTIFY_APP = 'spotify-beehive'; // the LG Spotify app (addon.json "luna": starting an app)
  // the cover (OK or a click on it): the Spotify app of the TV, on the song that plays
  async function openApp() {
    if (!ctx.luna) return { error: T('Spotify did not open.') };
    const r = await np.open(target => ctx.luna('luna://com.webos.applicationManager/launch', { id: SPOTIFY_APP, params: target }));
    return r && (r.error || r.returnValue === false) ? { error: T(r.error || 'Spotify did not open.') } : { ok: true };
  }
  // the picture of a device in the output menu, by the kind Spotify gives it
  const icon = type =>
    /^(TV|CastVideo|STB|GameConsole)$/.test(type)
      ? 'devtv'
      : type === 'Computer'
        ? 'devcomputer'
        : /^(Smartphone|Tablet)$/.test(type)
          ? 'devphone'
          : 'devspeaker';
  // the output button: the devices of the account, as a menu the launcher shows; a choice comes back as the action "pick"
  async function outputMenu() {
    const l = await np.devices();
    if (l.error) return { error: T(l.error) };
    const items = l.devices.map(d => ({
      id: d.id,
      // a device that gave no name (or only its id) is shown by its kind
      label: d.name && d.name !== d.id ? d.name : d.type || 'Speaker',
      sub: d.active ? T('Playing here') : d.name && d.name !== d.id ? d.type : '',
      icon: icon(d.type),
      active: d.active,
    }));
    // this TV's Spotify app is listed only while it is open: otherwise a row that does what the cover does
    if (!l.devices.some(d => d.type === 'TV'))
      items.push({ id: 'tv', label: T('This TV'), sub: T('Opens Spotify'), icon: 'devtv', active: false });
    return { menu: { title: T('Play on'), action: 'pick', items } };
  }
  async function pick(id) {
    if (id === 'tv') return openApp();
    const l = await np.devices();
    const d = (l.devices || []).filter(x => x.id === id)[0];
    // the TV is not moved to by a transfer (the app then stays paused): the cover's way takes the music over
    if (d && d.type === 'TV') return openApp();
    const r = await np.transfer(id);
    return r.error ? { error: T(r.error) } : { ok: true, said: T('Playing on') + ' ' + (d ? d.name : '') };
  }
  // what the card shows is what the button acts on (presses in a burst: the second one undoes the first)
  const playingNow = n => (shown && want && Date.now() < want.until ? shown.playing : !!n.playing);
  async function action(id, opt, name, arg) {
    if (name === 'open') return openApp();
    if (name === 'output') return outputMenu();
    if (name === 'pick') return pick(String(arg || ''));
    const n = await np.now(false);
    const what = name === 'prev' ? 'previous' : name === 'next' ? 'next' : name === 'toggle' ? (playingNow(n) ? 'pause' : 'play') : '';
    if (!what) return { error: 'no such action' };
    const r = await np.control(what);
    if (r.error) return { error: T(r.error) };
    const now = Date.now();
    want =
      what === 'play' || what === 'pause'
        ? { playing: what === 'play', until: now + 6000, at: now }
        : { playing: true, until: now + 6000, at: now, title: n.title };
    return { ok: true };
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
