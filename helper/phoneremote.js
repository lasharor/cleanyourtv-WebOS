// Phone remote: a page on a paired phone that works as a remote control for the TV, over a WebSocket kept open while the phone's browser
// is awake. Nothing is sent to the TV before the phone has paired.
//   GET  /api/phoneremote          on/off, the listener, the pairing window, the paired phones, what the last key did
//   POST /api/phoneremote          {enabled} switches the phone remote on or off (off closes the port and every connection)
//   POST /api/phoneremote/pair     {stop?} opens the pairing window (a 6-digit code, shown on the TV); called again it keeps it open
//   POST /api/phoneremote/revoke   {id} or {all:true} forgets phones: their token stops working at once
//   POST /api/phoneremote/access   {id, allow} blocks a phone without forgetting it (it keeps its token), or allows it again
//   POST /api/phoneremote/key      {key} presses one remote button as a phone would (to try the key adapter from the TV: curl)
// The settings are config.json "phoneRemote": {enabled, phones: [{id, name, hash, created, seen, blocked}]}. A phone's token is
// "<id>.<secret>": the phone keeps it, the TV keeps only the SHA-256 of the secret, and it is never logged.
// The LAN listener (port 8798) runs only while the phone remote is on AND a phone is paired or the pairing window is open. It serves the
// page, accepts a pairing (the code, five tries a minute per address, the window closes after eight wrong ones) and the WebSocket at /ws,
// where the first message must be {t:'hello', token}. The keys themselves are remotekeys.js.
const http = require('http'),
  fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const tvname = require('./tvname');
const web = require('./web'),
  i18n = require('./i18n'),
  luna = require('./luna'),
  nc = require('./netcompat'),
  ws = require('./ws'),
  P = require('./paths'),
  page = require('./phoneremotepage'),
  devicename = require('./devicename');

// The app, when this build ships one (the package carries mobile/app/tv-remote.apk and bootstrap.sh copies it next to the service):
// the manager screen shows a QR code for it and the phone downloads it from here, so no computer is needed to install it.
const APK = path.join(P.D, 'mobile', 'tv-remote.apk');

const PORT = 8798, // after the Android box page (8793)
  IDLE_MS = 3 * 60 * 1000, // the pairing window closes this long after the manager last asked for it ...
  MAX_PAIR_MS = 30 * 60 * 1000, // ... and at the latest this long after it opened
  MAX_PHONES = 10,
  MAX_SOCKETS = 24,
  HELLO_MS = 5000, // a connection must say who it is within this time
  EXPIRE_DAYS = [1, 3, 7, 14, 30], // "remove phones that are not used": the choices, in days (0 = never)
  EXPIRE_DEFAULT = 14,
  SEEN_MS = 60000, // the phone list shows "seen" to the minute: no more than one write of it a minute
  QUIET_MS = 60000, // a paired phone pings every 15 seconds; this long without a message and the connection is dropped
  TRIES = 5, // pairing tries per address per minute
  WRONG_MAX = 8, // wrong codes after which the window closes
  RATE = { burst: 60, perSecond: 40 }; // messages a connection may send
const TOKEN = /^([0-9a-f]{8})\.([0-9a-f]{32})$/;

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
// the same time whatever the two have in common
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const cleanName = n =>
  String(n || '')
    .replace(/[\u0000-\u001f\u007f<>"&]/g, '')
    .trim()
    .slice(0, 30) || 'Phone';

// opts: {port (0 = any, tests), host, keys (the key adapter, tests)}
function create(ctx, opts) {
  const o = opts || {};
  const API = String(o.api || 'http://127.0.0.1:8765');
  const config = ctx.config;
  const keys = o.keys || require('./remotekeys').create(ctx);
  const L = o.luna || luna; // the TV's IPC (tests hand in a fake)
  const cfg = () => Object.assign({ enabled: false, phones: [] }, config.get().phoneRemote || {});
  const save = fn =>
    config.update('phoneremote', c => {
      c.phoneRemote = Object.assign({ enabled: false, phones: [] }, c.phoneRemote || {});
      c.phoneRemote.phones = (c.phoneRemote.phones || []).slice();
      fn(c.phoneRemote);
    });
  const find = id => cfg().phones.filter(p => p.id === id)[0] || null;
  // For security a phone that has not been used for this many days is removed by itself (its token stops working): one that was lost,
  // sold or forgotten does not keep the remote for ever. 0 is off, chosen in the manager.
  const expireDays = () => {
    const v = cfg().expireDays;
    return v === 0 ? 0 : EXPIRE_DAYS.indexOf(v) >= 0 ? v : EXPIRE_DEFAULT;
  };

  let srv = null,
    listenError = '',
    pair = null;
  const clients = new Set();
  const tries = {}; // address -> times of its pairing tries
  const bad = {}; // address -> {n, until} wrong tokens in a row

  // ---- the pairing window ----
  function newCode() {
    return String(nc.randomInt(100000, 1000000));
  }
  function openPair() {
    const now = Date.now();
    if (!pair) pair = { code: newCode(), opened: now, wrong: 0, paired: null, until: 0 };
    pair.until = Math.min(now + IDLE_MS, pair.opened + MAX_PAIR_MS);
    pair.timer && clearTimeout(pair.timer);
    pair.timer = setTimeout(closePair, pair.until - now);
    if (pair.timer.unref) pair.timer.unref();
    sync();
  }
  function closePair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair = null;
    sync();
  }

  // ---- the listener ----
  const wanted = () => cfg().enabled && (cfg().phones.length > 0 || !!pair);
  function sync() {
    if (wanted() && !srv) listen();
    else if (!wanted() && srv) unlisten();
    if (!cfg().enabled) closePairQuiet();
  }
  function closePairQuiet() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair = null;
  }
  function listen() {
    const s = http.createServer(onRequest);
    s.maxConnections = MAX_SOCKETS + 8;
    s.on('upgrade', onUpgrade);
    s.on('error', e => {
      listenError = 'the phone remote could not listen: ' + e.message;
      console.error('phoneremote: ' + listenError);
      if (srv === s) srv = null;
    });
    srv = s;
    listenError = '';
    s.listen(o.port === undefined ? PORT : o.port, o.host || '0.0.0.0');
  }
  function unlisten() {
    const s = srv;
    srv = null;
    clients.forEach(c => c.conn.terminate());
    clients.clear();
    try {
      s.close();
      if (s.closeIdleConnections) s.closeIdleConnections(); // Node 18.2 and newer
    } catch (_) {}
  }
  const port = () => (srv && srv.address() ? srv.address().port : o.port || PORT);
  const lan = () => 'http://' + web.lanIp() + ':' + port();

  // a page from another site must not talk to the phone remote: browsers send Origin, and it has to be this very address
  const ownOrigin = (origin, host) => !origin || origin === 'http://' + host;
  const ip = req => String((req.socket && req.socket.remoteAddress) || '');

  // the app this build ships, if any: what the manager's QR code points at and what the phone downloads
  function apkFile() {
    try {
      const s = fs.statSync(APK);
      if (s.isFile() && s.size > 0) return { path: APK, size: s.size };
    } catch (_) {}
    return null;
  }

  // every time the phone takes the app: the manager moves on to the pairing screen when this has happened (in memory: a restart forgets it)
  const took = { n: 0, last: 0 };

  function onRequest(req, res) {
    const send = (code, body, type) => {
      res.writeHead(code, {
        'content-type': type || 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const u = req.url.split('?')[0];
    if (req.method === 'GET' && u === '/') {
      // the QR code on the TV carries the pairing code in its address: render it into the page, so it is filled in at once
      const c = /(?:^|&)code=([0-9]{6})(?:&|$)/.exec(String(req.url.split('?')[1] || ''));
      // the router's name for the phone is the first guess for the name field (devicename.js); the page falls back to what the browser says
      return devicename.routerName(
        ip(req),
        hint => send(200, page.phonePage(i18n.lang(req, config.get().lang), c ? c[1] : '', hint), 'text/html; charset=utf-8'),
        opts && opts.reverse
      );
    }
    // The apps on the TV, for the phone's Apps tab: the launcher's API listens on loopback only, so the phone's page asks this server,
    // which passes the question on. Both need the phone's own token, so nobody else on the network can list or open the TV's apps.
    if (
      req.method === 'GET' &&
      (u === '/api/apps' || u === '/api/inputs' || u === '/api/live' || u.indexOf('/api/logo/') === 0 || u.indexOf('/icon/') === 0)
    ) {
      if (!appToken(req)) return send(403, { error: 'forbidden' }, 'application/json');
      if (u === '/api/apps') return appsList().then(list => send(200, { apps: list }, 'application/json'));
      if (u === '/api/inputs') return inputsList().then(list => send(200, { inputs: list }, 'application/json'));
      if (u === '/api/live') return liveList().then(list => send(200, { channels: list }, 'application/json'));
      if (u.indexOf('/api/logo/') === 0) return logo(res, parseInt(u.slice('/api/logo/'.length), 10), send);
      return appIcon(res, u.slice('/icon/'.length), send);
    }
    if (req.method === 'GET' && u === '/app.apk') {
      const f = apkFile();
      if (!f) return send(404, { error: 'this build has no app', text: 'This build of CleanYourTV has no app in it.' }, 'application/json');
      // the same code as the rest of this page: the QR carries it (?code=...), so only someone looking at the TV can take the file. A
      // download has no page to send the header the other phone pages use, so the code travels in the address
      const m = /(?:^|&)code=([^&]*)/.exec(String(req.url.split('?')[1] || ''));
      if (!pair || !same(m ? m[1] : '', pair.code)) {
        if (pair && ++pair.wrong >= WRONG_MAX) closePair();
        return send(403, { error: 'wrong code', text: 'The app needs the code shown on the TV.' }, 'application/json');
      }
      took.n++; // the phone started taking the app: the manager can move on to the pairing screen
      took.last = Date.now();
      res.writeHead(200, {
        'content-type': 'application/vnd.android.package-archive',
        'content-length': f.size,
        'content-disposition': 'attachment; filename="TV Remote.apk"',
        'cache-control': 'no-store',
      });
      return fs
        .createReadStream(f.path)
        .on('error', () => res.end())
        .pipe(res);
    }
    if (req.method === 'POST' && u === '/api/pair') {
      if (!ownOrigin(req.headers.origin, req.headers.host)) return send(403, { error: 'forbidden' });
      return web.body(req, 2048).then(b => {
        const r = tryPair(ip(req), b, i18n.lang(req, config.get().lang));
        send(r.status, r.body);
      });
    }
    res.writeHead(404);
    res.end();
  }

  // a phone gives the code from the TV's screen and its name; it gets a token
  function tryPair(addr, b, lang) {
    const now = Date.now();
    const t = (tries[addr] = (tries[addr] || []).filter(x => now - x < 60000));
    if (t.length >= TRIES) return { status: 429, body: { error: i18n.tr(lang, 'Too many tries. Wait a minute.') } };
    t.push(now);
    if (!pair)
      return {
        status: 403,
        body: { error: i18n.tr(lang, 'The TV is not waiting for a phone. On the TV, open Features > Phone remote > Pair a phone.') },
      };
    if (typeof b.code !== 'string' || !same(b.code.trim(), pair.code)) {
      if (++pair.wrong >= WRONG_MAX) closePair();
      return { status: 403, body: { error: i18n.tr(lang, 'That code is not right. Check the 6 digits on the TV screen.') } };
    }
    if (cfg().phones.length >= MAX_PHONES)
      return { status: 409, body: { error: i18n.tr(lang, 'Too many phones are paired. Remove one on the TV.') } };
    const id = crypto.randomBytes(4).toString('hex'),
      secret = crypto.randomBytes(16).toString('hex'),
      name = devicename.unique(
        cleanName(b.name),
        cfg().phones.map(p => p.name)
      );
    save(c => {
      c.phones.push({ id, name, hash: sha(secret).toString('hex'), created: now, seen: now, blocked: false });
    });
    pair.code = newCode(); // a code works once
    pair.wrong = 0;
    pair.paired = { name, at: now };
    console.log('phoneremote: phone ' + id + ' paired');
    return { status: 200, body: { token: id + '.' + secret, name } };
  }

  // ---- connections ----
  function onUpgrade(req, socket, head) {
    const u = req.url.split('?')[0];
    if (u !== '/ws' || clients.size >= MAX_SOCKETS || !cfg().enabled) {
      socket.end('HTTP/1.1 ' + (u === '/ws' ? 503 : 404) + ' No\r\nConnection: close\r\n\r\n');
      return;
    }
    const addr = ip(req);
    const b = bad[addr];
    if (b && b.n >= 10 && Date.now() < b.until) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return;
    }
    const conn = ws.upgrade(req, socket, head, { maxBytes: 4096, origin: origin => ownOrigin(origin, req.headers.host) });
    if (!conn) return;
    const c = { conn, id: '', addr, last: Date.now(), tokens: RATE.burst, refill: Date.now() };
    clients.add(c);
    const hello = setTimeout(() => {
      if (!c.id) conn.close(4408);
    }, HELLO_MS);
    conn.on('message', m => onMessage(c, m));
    conn.on('close', () => {
      clearTimeout(hello);
      clients.delete(c);
      c.chain = null; // nothing keeps the connection alive: queued actions finish on their own and are not acked
      if (c.id) touchSeen(c.id);
    });
    conn.on('error', () => {});
  }

  // "seen" is only for the list in the manager: a write at most once a minute per phone, not one per login and per close
  function touchSeen(id) {
    const cur = find(id);
    if (!cur) return;
    if (cur.seen && Date.now() - cur.seen >= 0 && Date.now() - cur.seen < SEEN_MS) return;
    save(x => {
      const p = x.phones.filter(q => q.id === id)[0];
      if (p) p.seen = Date.now();
    });
  }

  // Phones that are not connected and were last used (or paired) longer ago than that are removed; one that is connected never is.
  function sweep() {
    const days = expireDays();
    if (!days) return;
    const limit = Date.now() - days * 86400000,
      online = {};
    clients.forEach(c => c.id && (online[c.id] = true));
    const old = cfg().phones.filter(p => !online[p.id] && Math.max(p.seen || 0, p.created || 0) < limit);
    if (!old.length) return;
    save(c => {
      c.phones = c.phones.filter(p => old.every(q => q.id !== p.id));
    });
    console.log('phoneremote: ' + old.length + (old.length === 1 ? ' phone' : ' phones') + ' not used for ' + days + ' days removed');
    sync();
  }
  const sweeper = setInterval(sweep, 3600000);
  if (sweeper.unref) sweeper.unref();

  // the address a Wake-on-LAN packet needs, and whether the TV listens for one (a phone's browser cannot send it itself; the page shows both)
  let netCache = null;
  async function netinfo() {
    if (netCache && Date.now() - netCache.at < 60000) return netCache.v;
    const found = [];
    ['eth0', 'wlan0'].forEach(n => {
      try {
        const a = fs.readFileSync('/sys/class/net/' + n + '/address', 'utf8').trim();
        if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(a) && a !== '00:00:00:00:00:00')
          found.push({ a, up: fs.readFileSync('/sys/class/net/' + n + '/operstate', 'utf8').trim() === 'up' });
      } catch (_) {}
    });
    const pick = found.filter(f => f.up)[0] || found[0];
    let wol = null;
    try {
      const r = await L('luna://com.webos.service.settings/getSystemSettings', { category: 'network', keys: ['wolwowlOnOff'] });
      if (r && r.settings && r.settings.wolwowlOnOff !== undefined) wol = String(r.settings.wolwowlOnOff) === 'true';
    } catch (_) {}
    const v = { mac: pick ? pick.a.toUpperCase() : '', wol };
    netCache = { at: Date.now(), v };
    return v;
  }

  function login(c, token) {
    const m = TOKEN.exec(String(token || ''));
    const p = m && find(m[1]);
    const good = !!p && same(sha(m[2]).toString('hex'), p.hash);
    if (!good) {
      const b = bad[c.addr] && Date.now() < bad[c.addr].until ? bad[c.addr] : (bad[c.addr] = { n: 0, until: 0 });
      b.n++;
      b.until = Date.now() + 60000;
      c.conn.send(JSON.stringify({ t: 'denied', reason: 'revoked' }));
      return c.conn.close(4401);
    }
    if (p.blocked) {
      c.conn.send(JSON.stringify({ t: 'denied', reason: 'blocked' }));
      return c.conn.close(4403);
    }
    c.id = p.id;
    const lastUsed = p.seen; // before this connection counts: the page shows when the phone was used last
    touchSeen(p.id);
    netinfo().then(n => {
      tvName().then(tv => {
        if (c.conn.closed) return;
        c.conn.send(
          JSON.stringify({ t: 'ready', name: p.name, tv, keys: keys.KEYS, mac: n.mac, wol: n.wol, seen: lastUsed, created: p.created })
        );
      });
    });
  }

  // The four things the page's power drawer can ask for, each its own call to the TV's power service (the ones LG's own menus make).
  // "reason" is how the TV is told what caused it: "remoteKey" is the remote of the TV, and any other word it refuses.
  const POWER = {
    off: { m: 'turnOffScreen', a: {} }, // the picture goes dark, the TV keeps running and the network stays up
    standby: { m: 'powerOff', a: { reason: 'remoteKey' } }, // the soft off: standby, which this page wakes again
    reboot: { m: 'reboot', a: { reason: 'remoteKey' } }, // a restart, back in about a minute
    shutdown: { m: 'shutDown', a: { reason: 'remoteKey' } }, // the hard off: fully off, and only the remote of the TV brings it back
  };

  const ACTIONS = {
    key: (m, k) => k.press(String(m.k)),
    move: (m, k) => k.move(m.dx, m.dy),
    click: (m, k) => k.click(),
    scroll: (m, k) => k.scroll(m.dy),
    text: (m, k) => k.text(String(m.s || '')),
    del: (m, k) => k.del(m.c),
    enter: (m, k) => k.enter(),
    liveSetup: async () => {
      // Live TV on the TV, which is where a playlist is added (with no playlist it shows the address to type on a phone)
      const r = await apiRequest('POST', '/api/launch', { id: 'com.webos.app.home', params: { live: true } });
      return { ok: !!r.returnValue, error: r.errorText || '' };
    },
    live: async m => {
      // Live TV on a channel: Home is launched with the channel, the same way {live:true} opens it from a card
      const num = parseInt(m.num, 10);
      if (!num || num < 1) return { ok: false, error: 'bad channel' };
      const r = await apiRequest('POST', '/api/launch', { id: 'com.webos.app.home', params: { live: true, channel: num } });
      return { ok: !!r.returnValue, error: r.errorText || '' };
    },
    launch: async m => {
      const id = String(m.id || '');
      if (!/^[\w.\-]+$/.test(id)) return { ok: false, error: 'bad app' };
      const r = await apiRequest('POST', '/api/launch', { id });
      return { ok: !!r.returnValue, error: r.errorText || '' };
    },
    // one of the power drawer's four calls: what the TV answers is what the phone hears ("Invalid reason" if it did not like it)
    tvpower: async m => {
      const c = POWER[String(m.a || '')];
      if (!c) return { ok: false, error: 'bad action' };
      try {
        const r = await L('luna://com.webos.service.tvpower/power/' + c.m, c.a, { timeout: 5000 });
        pwrAt = 0; // a state change just happened: the next question goes to the TV, not to what it said a moment ago
        return { ok: !!(r && r.returnValue !== false), error: (r && r.errorText) || '' };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
  };
  // What the TV says about itself, not what the socket says: with Quick Start+ the TV keeps answering in standby, so a live connection
  // is not the same as the screen being on. tvpower answers Active, Screen Saver, Screen Off, Active Standby…
  let pwrAt = 0,
    pwrVal = '';
  async function powerState() {
    if (Date.now() - pwrAt < 2000) return pwrVal;
    pwrAt = Date.now();
    try {
      const r = await L('luna://com.webos.service.tvpower/power/getPowerState', {}, { timeout: 3000 });
      pwrVal = r && typeof r.state === 'string' ? r.state : '';
    } catch (_) {
      pwrVal = '';
    }
    return pwrVal;
  }

  /* the TV's own name for the page's header: LG's "TV Name" (from Apple's HomeKit store, see helper/tvname.js), then the
     model the TV reports, then nothing (the page shows "TV") */
  let nameAt = 0,
    nameVal = '';
  async function tvName() {
    if (nameVal && Date.now() - nameAt < 3600000) return nameVal;
    let name = tvname.read();
    if (!name) {
      try {
        const r = await L('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName'] }, { timeout: 3000 });
        name = r && typeof r.modelName === 'string' ? r.modelName : '';
      } catch (_) {
        name = '';
      }
    }
    nameVal = name;
    nameAt = Date.now();
    return nameVal;
  }

  // the phone's token in the address, the way the rest of this page sends it
  function appToken(req) {
    const m = /(?:^|&)t=([^&]*)/.exec(String(req.url.split('?')[1] || ''));
    const x = TOKEN.exec(decodeURIComponent(m ? m[1] : ''));
    const p = x && find(x[1]);
    return !!(p && !p.blocked && same(sha(x[2]).toString('hex'), p.hash)); // the same check the WebSocket's hello does
  }

  function apiRequest(method, path, body) {
    return new Promise(resolve => {
      try {
        const payload = body ? JSON.stringify(body) : '';
        const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
        const r = nc.request(http, API + path, { method, headers }, s => {
          let data = '';
          s.on('data', c => (data += c));
          s.on('end', () => {
            try {
              resolve(JSON.parse(data || '{}'));
            } catch (_) {
              resolve({});
            }
          });
        });
        r.on('error', () => resolve({}));
        r.setTimeout(5000, () => r.destroy());
        r.end(payload);
      } catch (_) {
        resolve({});
      }
    });
  }

  async function appsList() {
    const r = await apiRequest('GET', '/api/apps');
    return (Array.isArray(r.apps) ? r.apps : []).filter(a => a && a.id && a.title).map(a => ({ id: String(a.id), title: String(a.title) }));
  }

  // the inputs the TV has now (HDMI ports and, when it is there, the tuner): the launcher's list, trimmed to what a phone shows
  async function inputsList() {
    const r = await apiRequest('GET', '/api/inputs');
    return (Array.isArray(r.devices) ? r.devices : [])
      .filter(d => d && (d.appId || d.id))
      .map(d => ({
        appId: String(d.appId || d.id),
        title: String(d.label || (d.port ? 'HDMI ' + d.port : '')),
        tuner: !!d.tuner,
        off: d.hdmiPlugIn === false,
      }));
  }

  // the channels of the user's own playlist (Live TV), without the stream addresses: those hold the provider's key
  async function liveList() {
    const r = await apiRequest('GET', '/api/live/channels');
    return (Array.isArray(r.channels) ? r.channels : [])
      .map(c => ({
        num: parseInt(c[0], 10) || 0,
        name: String(c[2] || ''),
        group: String(c[3] || ''),
        logo: /^https?:\/\//i.test(String(c[4] || '')), // the playlist's own logo address, fetched by the TV when the phone asks
      }))
      .filter(c => c.num > 0 && c.name);
  }

  // A channel's logo, fetched by the TV and passed on: the playlist's own addresses (which can carry the provider's key) stay here
  const logoCache = {};
  async function channelLogo(num) {
    const r = await apiRequest('GET', '/api/live/channels');
    const c = (Array.isArray(r.channels) ? r.channels : []).find(x => parseInt(x[0], 10) === num);
    const url = c && String(c[4] || '');
    return /^https?:\/\//i.test(url) ? url : '';
  }
  function logo(res, num, send) {
    if (!num) return send(404, { error: 'no logo' }, 'application/json');
    const hit = logoCache[num];
    if (hit && Date.now() - hit.at < 3600000) {
      res.writeHead(200, { 'content-type': hit.type, 'cache-control': 'max-age=3600' });
      return res.end(hit.buf);
    }
    channelLogo(num).then(url => {
      if (!url) return send(404, { error: 'no logo' }, 'application/json');
      try {
        const mod = url.indexOf('https:') === 0 ? require('https') : http; // most provider logos sit on https
        mod
          .get(url, r => {
            if (r.statusCode !== 200) {
              r.resume();
              return send(404, { error: 'no logo' }, 'application/json');
            }
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => {
              const buf = Buffer.concat(chunks);
              const type = r.headers['content-type'] || 'image/png';
              if (buf.length && buf.length < 512 * 1024) logoCache[num] = { at: Date.now(), type, buf };
              res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=3600' });
              res.end(buf);
            });
          })
          .on('error', () => send(404, { error: 'no logo' }, 'application/json'));
      } catch (_) {
        send(404, { error: 'no logo' }, 'application/json');
      }
    });
  }

  function appIcon(res, id, send) {
    if (!/^[\w.\-]+$/.test(id)) return send(404, { error: 'no icon' }, 'application/json');
    try {
      http
        .get(API + '/icon/' + encodeURIComponent(id), r => {
          if (r.statusCode !== 200) {
            r.resume();
            return send(404, { error: 'no icon' }, 'application/json');
          }
          res.writeHead(200, { 'content-type': r.headers['content-type'] || 'image/png', 'cache-control': 'max-age=3600' });
          r.pipe(res);
        })
        .on('error', () => send(404, { error: 'no icon' }, 'application/json'));
    } catch (_) {
      send(404, { error: 'no icon' }, 'application/json');
    }
  }

  // text, delete and enter must reach the TV in the order they were typed, but each one is its own luna process: they run one after
  // another per connection. Everything else (a held arrow key, the touchpad) stays concurrent and never waits behind them.
  const ORDERED = { text: 1, del: 1, enter: 1 };
  const ORDER_TIMEOUT_MS = 8000; // one stuck call must not hold up the rest of the typing forever
  function runAct(act, m) {
    return Promise.resolve()
      .then(() => act(m, keys))
      .then(
        r => r || { ok: false, error: 'no answer' },
        e => ({ ok: false, error: String((e && e.message) || e || 'failed').slice(0, 120) })
      );
  }
  function runOrdered(c, act, m) {
    const job = () =>
      new Promise(resolve => {
        const t = setTimeout(() => resolve({ ok: false, error: 'timed out' }), ORDER_TIMEOUT_MS);
        if (t.unref) t.unref();
        runAct(act, m).then(r => {
          clearTimeout(t);
          resolve(r);
        });
      });
    const next = (c.chain || Promise.resolve()).then(job);
    c.chain = next.then(
      () => {},
      () => {}
    ); // job never rejects; this keeps the chain alive whatever happens
    return next;
  }

  async function onMessage(c, text) {
    c.last = Date.now();
    let m;
    try {
      m = JSON.parse(text);
    } catch (_) {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (!c.id) return m.t === 'hello' ? login(c, m.token) : c.conn.close(4401); // nothing but hello before a phone has shown its token
    // the phone may have been revoked or blocked since it connected
    const p = find(c.id);
    if (!p || p.blocked) {
      c.conn.send(JSON.stringify({ t: 'denied', reason: p ? 'blocked' : 'revoked' }));
      return c.conn.close(p ? 4403 : 4401);
    }
    const now = Date.now();
    c.tokens = Math.min(RATE.burst, c.tokens + ((now - c.refill) / 1000) * RATE.perSecond);
    c.refill = now;
    if (m.t === 'ping') return c.conn.send('{"t":"pong"}');
    if (m.t === 'logout') {
      // the phone logs itself out (a tap on the TV's name): it is removed from the list like "Remove this phone" in the manager, and told so
      const id = c.id;
      save(x => {
        x.phones = x.phones.filter(q => q.id !== id);
      });
      sync();
      try {
        c.conn.send('{"t":"bye"}');
      } catch (_) {}
      return c.conn.close(1000);
    }
    if (m.t === 'power') return c.conn.send(JSON.stringify({ t: 'power', state: await powerState() }));
    const act = ACTIONS[m.t];
    if (!act) return;
    if (c.tokens < 1) return c.conn.send(JSON.stringify({ t: 'err', n: m.n, e: 'slow down' }));
    c.tokens--;
    const r = ORDERED[m.t] ? await runOrdered(c, act, m) : await runAct(act, m);
    if (m.n !== undefined && !c.conn.closed) c.conn.send(JSON.stringify({ t: 'ack', n: m.n, ok: !!r.ok, e: r.ok ? '' : r.error }));
  }

  // drop what has gone quiet (a phone that lost the network does not close its connection)
  const beat = setInterval(() => {
    const now = Date.now();
    clients.forEach(c => {
      if (now - c.last > QUIET_MS) c.conn.terminate();
    });
    Object.keys(bad).forEach(k => {
      if (now > bad[k].until) delete bad[k];
    });
  }, 20000);
  if (beat.unref) beat.unref();

  // a phone that is removed is told so before its connection is closed: the page then goes back to its pairing screen, not to "lost the TV"
  const kick = id =>
    clients.forEach(c => {
      if (c.id !== id) return;
      try {
        c.conn.send(JSON.stringify({ t: 'denied', reason: 'revoked' }));
      } catch (_) {}
      c.conn.close(4401);
    });

  // ---- the loopback API ----
  function status() {
    const now = Date.now();
    const online = {};
    clients.forEach(c => c.id && (online[c.id] = true));
    const apk = apkFile();
    return {
      enabled: cfg().enabled,
      expireDays: expireDays(),
      listening: !!(srv && srv.listening),
      port: port(),
      error: listenError,
      // the app, for the manager's QR code: the phone downloads it from this port, so no computer is needed. downloads/last tell the
      // manager that the phone has taken it, so it can move on to pairing
      app: {
        available: !!apk,
        size: apk ? apk.size : 0,
        url: lan() + '/app.apk',
        qr: pair ? lan() + '/app.apk?code=' + pair.code : '', // what the manager's QR code points at: the file and the code
        downloads: took.n,
        last: took.last,
      },
      pairing: pair
        ? {
            code: pair.code,
            url: lan(),
            qr: lan() + '/?code=' + pair.code, // the code travels in the address, so a phone that scans it fills it in by itself
            seconds: Math.max(0, Math.round((pair.until - now) / 1000)),
            paired: pair.paired,
          }
        : null,
      phones: cfg().phones.map(p => ({
        id: p.id,
        name: p.name,
        created: p.created,
        seen: p.seen,
        blocked: !!p.blocked,
        online: !!online[p.id],
      })),
      keys: keys.status(),
    };
  }
  async function handle(req, res, u, body) {
    if (u === '/api/phoneremote' && req.method === 'POST') {
      const b = await body(req);
      if (b.expireDays !== undefined) {
        const d = b.expireDays;
        if (d !== 0 && EXPIRE_DAYS.indexOf(d) < 0) return web.json(res, { error: 'Choose 1, 3, 7, 14 or 30 days, or 0 for never.' }, 400);
        save(c => {
          c.expireDays = d;
        });
        sweep();
      }
      if (b.enabled !== undefined)
        save(c => {
          c.enabled = b.enabled === true;
        });
      if (!cfg().enabled) {
        closePairQuiet();
        keys.close();
      }
      sync();
      await new Promise(r => setTimeout(r, 50)); // the port is listening (or not) by the time the answer is made
      return web.json(res, status());
    }
    if (u === '/api/phoneremote') return web.json(res, status());
    if (u === '/api/phoneremote/pair' && req.method === 'POST') {
      const b = await body(req);
      if (b.stop) {
        closePair();
        return web.json(res, status());
      }
      if (!cfg().enabled) return web.json(res, { error: 'Switch the phone remote on first.' }, 400);
      openPair();
      await new Promise(r => setTimeout(r, 50));
      return web.json(res, status());
    }
    if (u === '/api/phoneremote/revoke' && req.method === 'POST') {
      const b = await body(req);
      if (b.all === true) {
        const ids = cfg().phones.map(p => p.id);
        save(c => {
          c.phones = [];
        });
        ids.forEach(kick);
      } else if (typeof b.id === 'string' && find(b.id)) {
        save(c => {
          c.phones = c.phones.filter(p => p.id !== b.id);
        });
        kick(b.id);
      } else return web.json(res, { error: 'This phone is not paired.' }, 404);
      sync();
      return web.json(res, status());
    }
    if (u === '/api/phoneremote/access' && req.method === 'POST') {
      const b = await body(req);
      if (typeof b.id !== 'string' || !find(b.id)) return web.json(res, { error: 'This phone is not paired.' }, 404);
      save(c => {
        c.phones.forEach(p => {
          if (p.id === b.id) p.blocked = b.allow === false;
        });
      });
      if (b.allow === false) clients.forEach(c => c.id === b.id && c.conn.close(4403));
      return web.json(res, status());
    }
    if (u === '/api/phoneremote/key' && req.method === 'POST') {
      const b = await body(req);
      return web.json(res, await keys.press(String(b.key || '')));
    }
    web.notFound(res);
  }

  return {
    name: 'phoneremote',
    paths: ['/api/phoneremote', '/api/phoneremote/pair', '/api/phoneremote/revoke', '/api/phoneremote/access', '/api/phoneremote/key'],
    handle,
    start() {
      sweep();
      sync();
    },
    stop() {
      closePairQuiet();
      if (srv) unlisten();
      clearInterval(beat);
      clearInterval(sweeper);
      keys.close();
    },
    address: () => (srv && srv.address()) || null,
  };
}

module.exports = { create, PORT };
