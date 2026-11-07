// Phone remote: a page on a paired phone that works as a remote control for the TV, over a WebSocket kept open while the phone's browser
// is awake. Nothing is sent to the TV before the phone has paired. It is a catalog add-on (addons/catalog/phoneremote): it runs inside
// the service and gets only its ctx (settings, dataDir, util, luna, log), never the service's own modules.
// The TV's own page (page/index.html) asks this add-on through the loader, at /api/addons/phoneremote followed by (the bare address is the
// loader's own reply about the add-on, so the state has a path of its own):
//   /state      GET: the listener (listenError says why it cannot bind), the pairing window, the paired phones, what the last key did
//   /state      POST {expireDays}: "remove unused phones" (0, 1, 3, 7, 14 or 30 days)
//   /pair       POST {stop?}: opens the pairing window (a 6-digit code, shown on the TV page); called again it keeps it open
//   /revoke     POST {id} or {all:true}: forgets phones, their token stops working at once
//   /access     POST {id, allow}: blocks a phone without forgetting it (it keeps its token), or allows it again
//   /key        POST {key}: presses one remote button as a phone would (to try the key adapter from the TV: curl)
// The mic button on the phone goes to the service's voice API (helper/voice.js) over loopback, on the phone's own connection:
//   {t:'vstat'}       -> {t:'vstat', ok, installed, unsupported, answers, listening}: what the TV can do (ok false: no voice API)
//   {t:'ask', text}   -> {t:'answer', text, answer, via, error}: the text typed or dictated on the phone, as /api/voice/ask
//   {t:'listen'}      -> {t:'vlive', state, ...}: the TV listens on the remote's microphone (/api/voice/listen); state follows the
//                        TV (listening, recognising, thinking with the text) and ends with done {text, answer, via, error} or error {e}
//   {t:'vstop'}       -> nothing: the phone no longer wants the vlive steps (the TV finishes on its own)
// The settings are this add-on's settings in config.json (addons.phoneremote.settings): {expireDays, phones: [{id, name, hash, created,
// seen, blocked}]}. A phone's token is "<id>.<secret>": the phone keeps it, the TV keeps only the SHA-256 of the secret, and it is never
// logged.
// The LAN listener (port 8799) runs only while a phone is paired or the pairing window is open. It serves the phone page, accepts a
// pairing (the code, five tries a minute per address, the window closes after eight wrong ones) and the WebSocket at /ws, where the first
// message must be {t:'hello', token}. The keys themselves are remotekeys.js. The listener's own failure is separate from a request that
// failed: GET reports it as listenError (a port that cannot be bound, say 8799 busy), so the TV page can tell the two apart.
const http = require('http'),
  fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  nodeUrl = require('url');
const tvname = require('./tvname');
const ws = require('./ws'),
  page = require('./page'),
  devicename = require('./devicename');

// the small parts of the service's web helpers and of its Node 8 compatibility layer that a catalog add-on cannot require (it gets only
// its ctx): a JSON reply, a 404, the request body, and http(s) options from an address (Node 8 has no http.get(url, options))
const json = (res, o, code) => {
  res.writeHead(code || 200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(o));
};
const notFound = res => {
  res.writeHead(404);
  res.end();
};
function readBody(req, max) {
  const limit = max || 1 << 20;
  return new Promise(resolve => {
    let b = '',
      big = false;
    req.on('data', c => {
      if (big) return;
      b += c;
      if (b.length > limit) big = true;
    });
    req.on('end', () => {
      if (big) return resolve({});
      try {
        resolve(JSON.parse(b || '{}'));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}
const withUrl = u => {
  const x = nodeUrl.parse(String(u)),
    o = { protocol: x.protocol, hostname: String(x.hostname || '').replace(/^\[|\]$/g, ''), path: x.path };
  if (x.port) o.port = x.port;
  if (x.auth) o.auth = x.auth;
  return o;
};
const get = (lib, u, opts, cb) => lib.get(Object.assign(withUrl(u), opts), cb);
const request = (lib, u, opts, cb) => lib.request(Object.assign(withUrl(u), opts), cb);

const PORT = 8799, // after the Jellyfin page (8798)
  IDLE_MS = 3 * 60 * 1000, // the pairing window closes this long after the manager last asked for it ...
  MAX_PAIR_MS = 30 * 60 * 1000, // ... and at the latest this long after it opened
  MAX_PHONES = 10,
  MAX_SOCKETS = 24,
  HELLO_MS = 5000, // a connection must say who it is within this time
  EXPIRE_DAYS = [1, 3, 7, 14, 30], // "remove phones that are not used": the choices, in days (0 = never)
  EXPIRE_DEFAULT = 14,
  SEEN_MS = 60000, // the phone list shows "seen" to the minute: no more than one write of it a minute
  QUIET_MS = 60000, // the phone's page pings about every 5 seconds; this long without a message and the connection is dropped
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

// opts: {port (0 = any, tests), host, keys (the key adapter, tests), luna (tests), lanIp (tests), api (the loopback address, tests),
//        apiTimeout (the loopback API call's limit in ms, 5000 by default), localAddresses (tests: the TV's own addresses an Origin may name)}
function create(ctx, opts) {
  const o = opts || {};
  const util = ctx.util,
    i18n = util.i18n;
  const API = String(o.api || 'http://127.0.0.1:8765'); // the service's own loopback API (apps, inputs, Live TV, icons)
  const lang = req => i18n.lang(req, ctx.env.lang());
  const lanIp = o.lanIp || util.lanIp;
  const keys = o.keys || require('./remotekeys').create(ctx);
  const L = o.luna || ctx.luna || (() => Promise.resolve({ returnValue: false })); // the TV's IPC (tests hand in a fake)
  // everything this add-on keeps is its own settings (config.json addons.phoneremote.settings): no service config, no files beside it
  const state = () => Object.assign({ phones: [], expireDays: EXPIRE_DEFAULT }, ctx.settings.get());
  const save = fn => {
    const s = state();
    s.phones = (s.phones || []).slice();
    fn(s);
    ctx.settings.set({ phones: s.phones, expireDays: s.expireDays });
  };
  const find = id => state().phones.filter(p => p.id === id)[0] || null;
  // For security a phone that has not been used for this many days is removed by itself (its token stops working): one that was lost,
  // sold or forgotten does not keep the remote for ever. 0 is off, chosen on the add-on's page.
  const expireDays = () => {
    const v = state().expireDays;
    return v === 0 ? 0 : EXPIRE_DAYS.indexOf(v) >= 0 ? v : EXPIRE_DEFAULT;
  };

  let srv = null,
    listenError = '', // why the port could not be bound; status() reports it as listenError, apart from a request that failed
    pair = null,
    scanned = null; // {name, at}: the last pairing window a phone that was already paired closed by scanning the QR code
  const clients = new Set();
  const tries = {}; // address -> times of its pairing tries
  const bad = {}; // address -> {n, until} wrong tokens in a row

  // ---- the pairing window ----
  function newCode() {
    return String(util.randomInt(100000, 1000000));
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
  // the add-on is on or off with the loader's switch (Add-ons > Phone remote), so it only has to listen while a phone is paired or the
  // pairing window is open: a TV without a paired phone and with no one pairing listens on nothing
  const wanted = () => state().phones.length > 0 || !!pair;
  function sync() {
    if (wanted() && !srv) listen();
    else if (!wanted() && srv) unlisten();
  }
  function closePairQuiet() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair = null;
  }
  // Binding the LAN port can fail on its own (8799 taken by another program): that is not a failed request, so it is kept in listenError
  // and reported by status() under that very name, for the manager to show as a busy port.
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
  const lan = () => 'http://' + lanIp() + ':' + port();

  // A page from another site must not talk to the phone remote. Browsers send Origin, and it has to name the TV itself: comparing it
  // with the Host header alone is not enough, because a page using DNS rebinding controls Host. So the origin's host must be one of the
  // TV's own addresses (or localhost) and the same as Host. The token is still needed, so this mainly guards the pairing window.
  const localAddresses = () => {
    const out = ['localhost', '127.0.0.1'];
    try {
      const n = require('os').networkInterfaces();
      for (const k of Object.keys(n))
        for (const a of n[k] || []) if (a && a.family === 'IPv4' && a.address) out.push(String(a.address).toLowerCase());
    } catch (_) {}
    return out;
  };
  const hostOnly = h =>
    String(h || '')
      .replace(/:\d+$/, '')
      .toLowerCase();
  const ownOrigin = (origin, host) => {
    if (!origin) return true; // not a browser (curl, a script, the phone's own app): no Origin to check
    if (origin !== 'http://' + host) return false;
    return (o.localAddresses || localAddresses()).indexOf(hostOnly(host)) >= 0;
  };
  const ip = req => String((req.socket && req.socket.remoteAddress) || '');

  function onRequest(req, res) {
    const send = (code, body, type) => {
      res.writeHead(code, {
        'content-type': type || 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        // the phone page must never be put in a frame: another site could otherwise lay invisible keys over it and press them
        'x-frame-options': 'DENY',
        'content-security-policy': "frame-ancestors 'none'",
      });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const u = req.url.split('?')[0];
    if (req.method === 'GET' && u === '/') {
      // the QR code on the TV carries the pairing code in its address: render it into the page, so it is filled in at once
      const c = /(?:^|&)code=([0-9]{6})(?:&|$)/.exec(String(req.url.split('?')[1] || ''));
      // A scan of the QR code takes it off the TV at once. The window stays open for the phone that scanned it, and for no other, so a
      // new phone can still finish (its name, Pair this device); a phone that was already paired closes it when it connects (login).
      if (c && pair && !pair.scanned && same(c[1], pair.code)) {
        pair.scanned = { at: Date.now(), addr: ip(req) };
        console.log('phoneremote: the pairing code was scanned');
      }
      // the router's name for the phone is the first guess for the name field (devicename.js); the page falls back to what the browser says
      return devicename.routerName(
        ip(req),
        hint => send(200, page.phonePage(i18n, lang(req), c ? c[1] : '', hint), 'text/html; charset=utf-8'),
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
    if (req.method === 'POST' && u === '/api/pair') {
      if (!ownOrigin(req.headers.origin, req.headers.host)) return send(403, { error: 'forbidden' });
      return readBody(req, 2048).then(b => {
        const r = tryPair(ip(req), b, lang(req));
        send(r.status, r.body);
      });
    }
    res.writeHead(404);
    res.end();
  }

  // a phone gives the code from the TV's screen and its name; it gets a token
  function tryPair(addr, b, lang) {
    const now = Date.now();
    const t = (tries[addr] || []).filter(x => now - x < 60000); // only the last minute counts, so the list cannot grow
    if (!t.length) delete tries[addr]; // an old entry is pruned, not kept as an empty array
    if (t.length >= TRIES) return { status: 429, body: { error: i18n.tr(lang, 'Too many tries. Wait a minute.') } };
    t.push(now);
    tries[addr] = t;
    if (!pair)
      return {
        status: 403,
        body: { error: i18n.tr(lang, 'The TV is not waiting for a phone. On the TV, open the Phone remote page and choose Pair a phone.') },
      };
    // once the QR code was scanned, only that phone may finish: the TV no longer shows the code to anyone else
    if (pair.scanned && pair.scanned.addr !== addr)
      return {
        status: 403,
        body: { error: i18n.tr(lang, 'The TV is not waiting for a phone. On the TV, open the Phone remote page and choose Pair a phone.') },
      };
    if (typeof b.code !== 'string' || !same(b.code.trim(), pair.code)) {
      if (++pair.wrong >= WRONG_MAX) closePair();
      return { status: 403, body: { error: i18n.tr(lang, 'That code is not right. Check the 6 digits on the TV screen.') } };
    }
    if (state().phones.length >= MAX_PHONES)
      return { status: 409, body: { error: i18n.tr(lang, 'Too many phones are paired. Remove one on the TV.') } };
    const id = crypto.randomBytes(4).toString('hex'),
      secret = crypto.randomBytes(16).toString('hex'),
      name = devicename.unique(
        cleanName(b.name),
        state().phones.map(p => p.name)
      );
    save(c => {
      c.phones.push({ id, name, hash: sha(secret).toString('hex'), created: now, seen: now, blocked: false });
    });
    pair.code = newCode(); // a code works once
    pair.wrong = 0;
    pair.scanned = null; // the new phone's own connection must not count as a paired phone scanning the code (login)
    pair.paired = { name, at: now };
    console.log('phoneremote: phone ' + id + ' paired');
    return { status: 200, body: { token: id + '.' + secret, name } };
  }

  // ---- connections ----
  function onUpgrade(req, socket, head) {
    const u = req.url.split('?')[0];
    if (u !== '/ws' || clients.size >= MAX_SOCKETS) {
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
      stopWatch(c);
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
    const now = Date.now();
    Object.keys(tries).forEach(a => {
      if (!tries[a].some(x => now - x < 60000)) delete tries[a]; // an address that never came back is not kept for ever
    });
    const days = expireDays();
    if (!days) return;
    const limit = Date.now() - days * 86400000,
      online = {};
    clients.forEach(c => c.id && (online[c.id] = true));
    const old = state().phones.filter(p => !online[p.id] && Math.max(p.seen || 0, p.created || 0) < limit);
    if (!old.length) return;
    save(c => {
      c.phones = c.phones.filter(p => old.every(q => q.id !== p.id));
    });
    console.log('phoneremote: ' + old.length + (old.length === 1 ? ' phone' : ' phones') + ' not used for ' + days + ' days removed');
    sync();
  }
  // (its hourly interval is made in start(), with the one that drops quiet connections)

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
    // a phone that was already paired scanned the QR code: it is connected again, so the pairing window has nothing left to do
    if (pair && pair.scanned && pair.scanned.addr === c.addr) {
      scanned = { name: p.name, at: Date.now() };
      console.log('phoneremote: phone ' + p.id + ' scanned the code while paired; pairing closed');
      closePair();
    }
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
    live: async (m, k) => {
      // Live TV on a channel: Live TV opens as a card opens it ({live:true}), then the channel's number is pressed on the remote's digits,
      // which is how Live TV itself takes a number. The launcher is not asked for anything new.
      const num = parseInt(m.num, 10);
      if (!num || num < 1 || num > 99999) return { ok: false, error: 'bad channel' };
      const r = await apiRequest('POST', '/api/launch', { id: 'com.webos.app.home', params: { live: true } });
      if (r.returnValue) {
        const digits = String(num).split('');
        const t = setTimeout(
          async () => {
            for (const d of digits) {
              await k.press(d);
              await new Promise(res => setTimeout(res, 150));
            }
          },
          o.liveWaitMs === undefined ? 3500 : o.liveWaitMs
        );
        if (t.unref) t.unref();
      }
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
        const r = await L('luna://com.webos.service.tvpower/power/' + c.m, c.a, { wait: 5000 });
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
      const r = await L('luna://com.webos.service.tvpower/power/getPowerState', {}, { wait: 3000 });
      pwrVal = r && typeof r.state === 'string' ? r.state : '';
    } catch (_) {
      pwrVal = '';
    }
    return pwrVal;
  }

  /* the TV's own name for the page's header: LG's "TV Name" (from Apple's HomeKit store, see tvname.js), then the
     model the TV reports, then nothing (the page shows "TV") */
  let nameAt = 0,
    nameVal = '';
  async function tvName() {
    if (nameVal && Date.now() - nameAt < 3600000) return nameVal;
    let name = tvname.read();
    if (!name) {
      try {
        const r = await L('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName'] }, { wait: 3000 });
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

  function apiRequest(method, path, body, ms) {
    return new Promise(resolve => {
      let done = false;
      const settle = v => {
        if (done) return;
        done = true;
        resolve(v || {});
      };
      try {
        const payload = body ? JSON.stringify(body) : '';
        const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
        const r = request(http, API + path, { method, headers }, s => {
          let data = '';
          s.on('data', c => (data += c));
          s.on('end', () => {
            try {
              settle(JSON.parse(data || '{}'));
            } catch (_) {
              settle({});
            }
          });
          // A response that starts and is then cut off (a timeout destroys the request) emits aborted and then ECONNRESET on the
          // response, and nothing at all on the request: each of these has to answer, and the guard lets only the first one through.
          s.on('aborted', () => settle({}));
          s.on('error', () => settle({}));
        });
        r.on('error', () => settle({}));
        r.on('timeout', () => settle({}));
        r.setTimeout(ms || o.apiTimeout || 5000, () => r.destroy());
        r.end(payload);
      } catch (_) {
        settle({});
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

  // the logos already fetched (number -> {at, type, buf}, kept for an hour), so the page does not ask the provider again and again
  const logoCache = {};

  // One channel list serves every logo: when a page of cards draws, it asks for many logos at once, and each one used to download the
  // whole list again. It is kept for 30 seconds through one shared promise: long enough for the page, short enough to follow an edit.
  const LIST_MS = 30000;
  let listAt = 0,
    listPromise = null;
  function channelList() {
    if (listPromise && Date.now() - listAt < LIST_MS) return listPromise;
    listAt = Date.now();
    listPromise = apiRequest('GET', '/api/live/channels').then(r => (Array.isArray(r.channels) ? r.channels : []));
    return listPromise;
  }
  // A channel's logo, fetched by the TV and passed on: the playlist's own addresses (which can carry the provider's key) stay here
  async function channelLogo(num) {
    const channels = await channelList();
    const c = channels.find(x => parseInt(x[0], 10) === num);
    const url = c && String(c[4] || '');
    return /^https?:\/\//i.test(url) ? url : '';
  }

  // The logo itself is not trusted: the body is cut off the moment it goes over the cap (not buffered and checked afterwards), the whole
  // fetch gives up after about four seconds, and up to three redirects are followed (a relative Location is resolved against the address
  // that answered), because a provider's logo often moves.
  const LOGO_MAX = 512 * 1024,
    LOGO_MS = 4000,
    LOGO_HOPS = 3,
    LOGO_REDIRECT = { 301: 1, 302: 1, 303: 1, 307: 1, 308: 1 };
  function fetchLogo(address, hops) {
    return new Promise(resolve => {
      let settled = false,
        following = false, // a redirect was followed: a late error of the redirect's own body must not cancel the new hop
        req = null;
      let timer = null;
      const finish = v => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const lose = () => {
        if (!following) finish(null);
      };
      const stop = () => {
        try {
          if (req) req.destroy();
        } catch (_) {}
      };
      // The timer is not reset per hop: the whole fetch (redirects included) has about four seconds.
      timer = setTimeout(() => {
        stop();
        finish(null);
      }, LOGO_MS);
      if (timer.unref) timer.unref();
      try {
        const lib = String(address).indexOf('https:') === 0 ? require('https') : http; // most provider logos sit on https
        req = get(lib, address, {}, r => {
          if (LOGO_REDIRECT[r.statusCode] && r.headers.location && hops < LOGO_HOPS) {
            following = true;
            r.on('error', () => {}); // the redirect's own body is not read: whatever happens to it is not this logo's answer
            r.on('aborted', () => {});
            r.resume();
            let next;
            try {
              next = nodeUrl.resolve(String(address), String(r.headers.location));
            } catch (_) {
              return finish(null);
            }
            if (!/^https?:\/\//i.test(next)) return finish(null); // a redirect must stay on the web (never file: or the like)
            return fetchLogo(next, hops + 1).then(finish);
          }
          if (r.statusCode !== 200) {
            r.resume();
            return finish(null);
          }
          const chunks = [];
          let size = 0;
          r.on('data', c => {
            size += c.length;
            if (size > LOGO_MAX) {
              stop(); // over the cap: drop the connection, keep nothing
              return finish(null);
            }
            chunks.push(c);
          });
          r.on('end', () => finish(size ? { buf: Buffer.concat(chunks), type: r.headers['content-type'] || 'image/png' } : null));
          r.on('aborted', lose);
          r.on('error', lose);
        });
        req.on('error', lose);
        req.setTimeout(LOGO_MS, () => {
          stop();
          lose();
        });
      } catch (_) {
        return finish(null);
      }
    });
  }
  function logo(res, num, send) {
    if (!num) return send(404, { error: 'no logo' }, 'application/json');
    const hit = logoCache[num];
    if (hit && Date.now() - hit.at < 3600000) {
      res.writeHead(200, { 'content-type': hit.type, 'cache-control': 'max-age=3600' });
      return res.end(hit.buf);
    }
    channelLogo(num)
      .then(url => (url ? fetchLogo(url, 0) : null))
      .then(img => {
        if (!img || !img.buf.length) return send(404, { error: 'no logo' }, 'application/json');
        logoCache[num] = { at: Date.now(), type: img.type, buf: img.buf };
        res.writeHead(200, { 'content-type': img.type, 'cache-control': 'max-age=3600' });
        res.end(img.buf);
      })
      .catch(() => send(404, { error: 'no logo' }, 'application/json'));
  }

  function appIcon(res, id, send) {
    if (!/^[\w.\-]+$/.test(id)) return send(404, { error: 'no icon' }, 'application/json');
    try {
      get(http, API + '/icon/' + encodeURIComponent(id), {}, r => {
        if (r.statusCode !== 200) {
          r.resume();
          return send(404, { error: 'no icon' }, 'application/json');
        }
        res.writeHead(200, { 'content-type': r.headers['content-type'] || 'image/png', 'cache-control': 'max-age=3600' });
        r.pipe(res);
      }).on('error', () => send(404, { error: 'no icon' }, 'application/json'));
    } catch (_) {
      send(404, { error: 'no icon' }, 'application/json');
    }
  }

  // ---- voice: the mic button on the phone ----
  // An answer can take a while (a language model, Home Assistant, then a language model again): the ask waits longer than a key.
  const ASK_MS = o.askTimeout || 45000,
    VOICE_TICK_MS = o.voiceTick || 600,
    VOICE_MAX_MS = 90000; // the TV records 15 s at most; recognising and answering fit well inside this
  async function voiceState() {
    const s = await apiRequest('GET', '/api/voice/status');
    if (typeof s.installed !== 'boolean') return { ok: false }; // a service without voice, or one that did not answer
    const l = s.llm || {},
      h = s.ha || {};
    return {
      ok: true,
      installed: s.installed,
      unsupported: !!s.unsupported,
      answers: !!((l.enabled && (l.hasKey || l.server)) || s.url || h.configured), // something on the TV answers what is asked
      listening: !!s.listening,
    };
  }
  const tell = (c, o) => {
    if (!c.conn.closed) c.conn.send(JSON.stringify(o));
  };
  async function voiceAsk(c, m) {
    const text = String(m.text || '')
      .trim()
      .slice(0, 1000);
    if (!text) return tell(c, { t: 'answer', text: '', answer: '', via: '', error: 'empty' });
    if (c.asking) return tell(c, { t: 'answer', text, answer: '', via: '', error: 'busy' });
    c.asking = true;
    const r = await apiRequest('POST', '/api/voice/ask', { text }, ASK_MS);
    c.asking = false;
    console.log('phoneremote: ask from ' + c.id + (r.error ? ' failed' : ' answered via ' + (r.via || '-')));
    tell(c, {
      t: 'answer',
      text,
      answer: String(r.answer || ''),
      via: String(r.via || ''),
      error: r.error ? String(r.error) : r.text === undefined ? 'no answer' : '',
    });
  }
  function stopWatch(c) {
    clearInterval(c.vtimer);
    c.vtimer = null;
  }
  // the TV listens on the remote's microphone; the phone is told each step the TV goes through until it is done
  async function voiceListen(c) {
    stopWatch(c);
    const t0 = Date.now();
    const r = await apiRequest('POST', '/api/voice/listen');
    if (!r.started) return tell(c, { t: 'vlive', state: 'error', e: String(r.error || 'no answer') });
    console.log('phoneremote: listen from ' + c.id);
    tell(c, { t: 'vlive', state: 'listening' });
    let sent = 'listening',
      busy = false,
      misses = 0;
    c.vtimer = setInterval(async () => {
      if (busy) return;
      busy = true;
      const s = await apiRequest('GET', '/api/voice/status');
      busy = false;
      if (!c.vtimer) return;
      const l = s.last || {},
        mine = (l.at || 0) >= t0 - 1000;
      if (typeof s.listening !== 'boolean') {
        if (++misses >= 5) {
          stopWatch(c);
          tell(c, { t: 'vlive', state: 'error', e: 'no answer' });
        }
        return;
      }
      misses = 0;
      if (!s.listening && mine) {
        stopWatch(c);
        if (l.state === 'heard')
          return tell(c, {
            t: 'vlive',
            state: 'done',
            text: String(l.text || ''),
            answer: String(l.answer || ''),
            via: String(l.via || ''),
            error: String(l.error || ''),
          });
        return tell(c, { t: 'vlive', state: 'error', e: String(l.state === 'error' ? l.error || 'error' : l.state || 'error') });
      }
      if (Date.now() - t0 > VOICE_MAX_MS) {
        stopWatch(c);
        return tell(c, { t: 'vlive', state: 'error', e: 'timed out' });
      }
      const now = l.state === 'heard' ? 'thinking' : l.state === 'recognising' ? 'recognising' : 'listening';
      if (mine && now !== sent) {
        sent = now;
        tell(c, now === 'thinking' ? { t: 'vlive', state: now, text: String(l.text || '') } : { t: 'vlive', state: now });
      }
    }, VOICE_TICK_MS);
    if (c.vtimer.unref) c.vtimer.unref();
  }
  const VOICE = {
    vstat: async c => tell(c, Object.assign({ t: 'vstat' }, await voiceState())),
    ask: voiceAsk,
    listen: voiceListen,
    vstop: async c => stopWatch(c), // the phone closed the voice screen or changed where it listens: no more steps (the TV finishes)
  };

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
    if (VOICE[m.t]) {
      if (c.tokens < 1) return c.conn.send(JSON.stringify({ t: 'err', n: m.n, e: 'slow down' }));
      c.tokens--;
      return VOICE[m.t](c, m);
    }
    const act = ACTIONS[m.t];
    if (!act) return;
    if (c.tokens < 1) return c.conn.send(JSON.stringify({ t: 'err', n: m.n, e: 'slow down' }));
    c.tokens--;
    const r = ORDERED[m.t] ? await runOrdered(c, act, m) : await runAct(act, m);
    if (m.n !== undefined && !c.conn.closed) c.conn.send(JSON.stringify({ t: 'ack', n: m.n, ok: !!r.ok, e: r.ok ? '' : r.error }));
  }

  // drop what has gone quiet (a phone that lost the network does not close its connection): the interval is made in start()

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
    return {
      expireDays: expireDays(),
      listening: !!(srv && srv.listening),
      port: port(),
      url: lanIp() ? lan() : '', // the address a phone types, for the TV page also while no window is open ('' = the TV has no network)
      listenError: listenError,
      pairing: pair
        ? {
            code: pair.code,
            url: lan(),
            qr: lan() + '/?code=' + pair.code, // the code travels in the address, so a phone that scans it fills it in by itself
            seconds: Math.max(0, Math.round((pair.until - now) / 1000)),
            paired: pair.paired,
            scanned: pair.scanned ? pair.scanned.at : 0, // a phone opened the QR code: the TV page takes it off the screen
          }
        : null,
      scanned: scanned, // {name, at}: a paired phone scanned the code and so closed the window (the TV page says it is connected)
      phones: state().phones.map(p => ({
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
  // The add-on's own API, under /api/addons/phoneremote: `sub` is what the loader found after the id ('/state', '/pair', ...). The bare
  // address is the loader's (it answers with the add-on's info), so the state has its own path.
  async function handle(req, res, sub, body) {
    const u = sub || '/';
    if ((u === '/' || u === '/state') && req.method === 'POST') {
      const b = await body(req);
      if (b.expireDays !== undefined) {
        const d = b.expireDays;
        if (d !== 0 && EXPIRE_DAYS.indexOf(d) < 0) return json(res, { error: 'Choose 1, 3, 7, 14 or 30 days, or 0 for never.' }, 400);
        save(c => {
          c.expireDays = d;
        });
        sweep();
      }
      sync();
      await new Promise(r => setTimeout(r, 50)); // the port is listening (or not) by the time the answer is made
      return json(res, status());
    }
    if (u === '/' || u === '/state') return json(res, status());
    if (u === '/pair' && req.method === 'POST') {
      const b = await body(req);
      if (b.stop) {
        closePair();
        return json(res, status());
      }
      openPair();
      await new Promise(r => setTimeout(r, 50));
      return json(res, status());
    }
    if (u === '/revoke' && req.method === 'POST') {
      const b = await body(req);
      if (b.all === true) {
        const ids = state().phones.map(p => p.id);
        save(c => {
          c.phones = [];
        });
        ids.forEach(kick);
      } else if (typeof b.id === 'string' && find(b.id)) {
        save(c => {
          c.phones = c.phones.filter(p => p.id !== b.id);
        });
        kick(b.id);
      } else return json(res, { error: 'This phone is not paired.' }, 404);
      sync();
      return json(res, status());
    }
    if (u === '/access' && req.method === 'POST') {
      const b = await body(req);
      if (typeof b.id !== 'string' || !find(b.id)) return json(res, { error: 'This phone is not paired.' }, 404);
      save(c => {
        c.phones.forEach(p => {
          if (p.id === b.id) p.blocked = b.allow === false;
        });
      });
      if (b.allow === false) clients.forEach(c => c.id === b.id && c.conn.close(4403));
      return json(res, status());
    }
    if (u === '/key' && req.method === 'POST') {
      const b = await body(req);
      return json(res, await keys.press(String(b.key || '')));
    }
    notFound(res);
  }

  // the two timers of a running add-on: the quiet connections and the hourly sweep; start() and stop() come in pairs (the loader's live
  // switch calls them), so nothing is left running after a stop
  let beat = null,
    sweeper = null;

  return {
    handle,
    start() {
      if (!beat)
        beat = setInterval(() => {
          const now = Date.now();
          clients.forEach(c => {
            if (now - c.last > QUIET_MS) c.conn.terminate();
          });
          Object.keys(bad).forEach(k => {
            if (now > bad[k].until) delete bad[k];
          });
        }, 20000);
      if (beat.unref) beat.unref();
      if (!sweeper) sweeper = setInterval(sweep, 3600000);
      if (sweeper.unref) sweeper.unref();
      sweep();
      sync();
    },
    stop() {
      closePairQuiet();
      if (srv) unlisten();
      keys.close();
      if (beat) clearInterval(beat);
      if (sweeper) clearInterval(sweeper);
      beat = null;
      sweeper = null;
    },
    address: () => (srv && srv.address()) || null,
  };
}

module.exports = { create, PORT };
