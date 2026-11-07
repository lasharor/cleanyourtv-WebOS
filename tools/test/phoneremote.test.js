// Phone remote (the phoneremote add-on: service.js, remotekeys.js, page.js): pairing with a one-time code, the token, the rate limit, a phone that
// is blocked or revoked, reconnecting after a restart of the service, and the key adapter against a fake luna and a fake pointer socket.
// Nothing here touches a TV: the keys are a fake, the LAN listener is bound to 127.0.0.1 on a free port.
const http = require('http'),
  fs = require('fs'),
  path = require('path');
const { ok, run, sleep, root, tmp, req } = require('./lib');
const lib = require('./lib');
const tvname = require('../../addons/catalog/phoneremote/tvname');
const ws = require('../../addons/catalog/phoneremote/ws');

// the add-on's API is under /api/addons/phoneremote, and the loader passes what follows the id to handle(): '' is the state, '/pair' the
// pairing window, and so on. The tests keep writing the whole path.
const call = (pr, url, method, body) => lib.call(pr, String(url).replace(/^\/api\/phoneremote/, ''), method, body);
// the ctx a catalog add-on gets from the loader: its settings in memory, a data folder of its own, and the service's small helpers
let ctxs = 0;
function store(initial) {
  let s = Object.assign({}, initial || {});
  return {
    get: () => Object.assign({}, s),
    set: o => {
      s = Object.assign({}, s, o);
    },
    raw: () => Object.assign({}, s),
  };
}
function addonCtx(settings) {
  return {
    settings,
    dataDir: path.join(tmp, 'prdata-' + ++ctxs),
    util: {
      lanIp: () => '127.0.0.1',
      randomInt: req('netcompat').randomInt,
      mkdirp: req('netcompat').mkdirp,
      i18n: req('i18n'),
    },
    env: { lang: () => 'en' },
    log: () => {},
  };
}

// Node 8's writeHead returns undefined (it returns the response from Node 11.10): the fake servers below chain .end() after it
const writeHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function () {
  writeHead.apply(this, arguments);
  return this;
};

function post(port, path, body, origin, hostHeader) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: Object.assign({ 'content-type': 'application/json' }, origin ? { origin } : {}, hostHeader ? { host: hostHeader } : {}),
      },
      res => {
        let t = '';
        res.on('data', d => (t += d));
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(t);
          } catch (_) {}
          resolve({ code: res.statusCode, j, text: t });
        });
      }
    );
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
}
// ms: give up after this long, so a request the service never answers fails the check instead of stopping the test for ever
function get(port, path, ms) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path }, res => {
      let t = '';
      res.on('data', d => (t += d));
      res.on('end', () => resolve({ code: res.statusCode, text: t, headers: res.headers }));
    });
    r.on('error', reject);
    r.setTimeout(ms || 15000, () => {
      reject(new Error('no answer in ' + (ms || 15000) + ' ms'));
      r.destroy();
    });
  });
}
// a phone-remote instance with the phone remote switched on and a phone paired through its LAN listener: the token the other doors need
async function lanPair(PR, settings, opts) {
  const pr = PR.create(addonCtx(settings), opts);
  pr.start();
  const s = await call(pr, '/api/phoneremote/pair', 'POST', {});
  const port = s.j.port;
  const r = await post(port, '/api/pair', { code: s.j.pairing.code, name: 'test' });
  return { pr, port, token: r.j && r.j.token };
}
// a phone: a WebSocket with the messages it got
async function phone(port, token) {
  const c = await ws.connect('ws://127.0.0.1:' + port + '/ws');
  const p = { c, msgs: [], closed: 0 };
  c.on('message', m => p.msgs.push(JSON.parse(m)));
  c.on('close', code => (p.closed = code));
  if (token !== undefined) c.send(JSON.stringify({ t: 'hello', token }));
  return p;
}
// the TV's IPC, for the power drawer: what each of the four calls answers, and what the service asked for
const tvCalls = [];
const fakeLuna = async (uri, params) => {
  tvCalls.push([uri, params]);
  if (/power\/getPowerState$/.test(uri)) return { returnValue: true, state: 'Active' };
  if (/systemproperty\/getSystemInfo$/.test(uri)) return { returnValue: true, modelName: 'Test TV' };
  if (/settings\/getSystemSettings$/.test(uri)) return { returnValue: true, settings: { wolwowlOnOff: 'true' } };
  if (/power\/reboot$/.test(uri) && params.reason !== 'remoteKey') return { returnValue: false, errorText: 'Invalid reason' };
  return { returnValue: true };
};

const fakeKeys = () => {
  const pressed = [];
  const k = {
    KEYS: ['UP', 'ENTER', 'HOME', 'VOLUMEUP', '1', '2', '7'],
    pressed,
    status: () => ({ backend: 'fake', ok: true, error: '', at: 0 }),
    close() {},
  };
  const ret = { ok: true, error: '' };
  ['move', 'click', 'scroll', 'text', 'del', 'enter'].forEach(n => (k[n] = async (...a) => (pressed.push([n].concat(a)), ret)));
  k.press = async n => (k.KEYS.indexOf(n) < 0 ? { ok: false, error: 'unknown key' } : (pressed.push(['key', n]), ret));
  return k;
};

run(async () => {
  const http = require('http');
  const PR = require('../../addons/catalog/phoneremote/service');
  const settings = store({});
  const keys = fakeKeys();
  // the launcher's API that the phone service asks about the TV's apps (loopback in the real thing, an ephemeral port here)
  const launcher = {
    launched: [],
    apps: [
      { id: 'com.webos.app.browser', title: 'Web Browser' },
      { id: 'com.example.tv', title: 'Example' },
    ],
  };
  const voice = { installed: true, listening: false, last: null, asked: [], listens: 0, answer: 'Turned off Kitchen lights.' };
  const stub = http.createServer((req, res) => {
    let d = '';
    req.on('data', c => (d += c));
    req.on('end', () => {
      const vj = o => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (req.url === '/api/voice/status')
        return vj({
          installed: voice.installed,
          unsupported: false,
          listening: voice.listening,
          last: voice.last,
          url: '',
          llm: { enabled: true, hasKey: true },
          ha: { configured: false },
        });
      if (req.url === '/api/voice/ask' && req.method === 'POST') {
        const b = JSON.parse(d || '{}');
        voice.asked.push(b.text);
        return vj({ text: b.text, answer: voice.answer, via: 'ha', error: '' });
      }
      if (req.url === '/api/voice/listen' && req.method === 'POST') {
        if (!voice.installed) return vj({ started: false, error: 'voice is not installed' });
        voice.listens++;
        voice.listening = true;
        voice.last = { at: Date.now(), state: 'listening' };
        setTimeout(() => (voice.last = { at: Date.now(), state: 'recognising' }), 80);
        setTimeout(() => (voice.last = { at: Date.now(), state: 'heard', text: 'what is on tonight' }), 160);
        setTimeout(() => {
          voice.last.answer = 'The match starts at nine.';
          voice.last.via = 'ai';
          voice.listening = false;
        }, 240);
        return vj({ started: true });
      }
      if (req.url === '/api/apps')
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ apps: launcher.apps }));
      if (req.url === '/api/inputs')
        return res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            devices: [
              { id: '1', appId: 'com.webos.app.hdmi1', label: 'PS5 Game console', port: 1, hdmiPlugIn: true },
              { id: '2', appId: 'com.webos.app.hdmi2', port: 2, hdmiPlugIn: false },
              { id: 'TV', appId: 'com.webos.app.livetv', tuner: true },
            ],
          })
        );
      if (req.url.indexOf('/icon/') === 0) return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from([137, 80, 78, 71]));
      if (req.url === '/logo.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from([137, 80, 78, 71]));
      if (req.url === '/api/live/channels')
        return res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            groups: ['News'],
            channels: [[7, 'bbc1', 'BBC One', 'News', launcher.logo, 'https://example/stream?key=secret', 'k7']],
          })
        );
      if (req.url.indexOf('/api/logo/') === 0)
        return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from([137, 80, 78, 71]));
      if (req.url === '/api/launch' && req.method === 'POST') {
        try {
          launcher.lastLaunch = JSON.parse(d || '{}');
          launcher.launched.push(launcher.lastLaunch.id);
        } catch (_) {}
        return res.writeHead(200, { 'content-type': 'application/json' }).end('{"returnValue":true}');
      }
      res.writeHead(404).end('no');
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const api = 'http://127.0.0.1:' + stub.address().port;
  launcher.logo = api + '/logo.png';
  const rev = { name: '' }; // what the stand-in router answers for the phone's address
  const reverse = (a, cb) => cb(rev.name ? null : new Error('ENOTFOUND'), rev.name ? [rev.name] : []);
  const make = () =>
    PR.create(addonCtx(settings), { port: 0, host: '127.0.0.1', keys, api, luna: fakeLuna, reverse, liveWaitMs: 40, voiceTick: 25 });
  let pr = make();
  pr.start();
  let r = await call(pr, '/api/phoneremote');
  ok(
    !r.j.listening && r.j.phones.length === 0 && r.j.pairing === null,
    'nothing listens at first: no phone is paired and no window is open'
  );
  r = await lib.call(pr, '/state');
  ok(
    r.code === 200 && Array.isArray(r.j.phones) && r.j.expireDays !== undefined,
    "the state has its own path (/state): the bare address is the loader's info about the add-on"
  );
  ok(
    typeof r.j.listenError === 'string' && r.j.listenError === '' && !('error' in r.j),
    "the listener's own failure has its own key in the status (listenError, empty when it listened), apart from a failed request (error)"
  );

  r = await call(pr, '/api/phoneremote/pair', 'POST', {});
  const port = r.j.port;
  const code = r.j.pairing.code;
  ok(
    r.j.listening && /^\d{6}$/.test(code) && /:\d+\/\?code=\d{6}$/.test(r.j.pairing.qr),
    'the pairing window opens the port and shows a 6-digit code, and its QR code carries it'
  );
  ok(
    r.j.pairing.qr.indexOf(code) > 0 && !/code/.test(r.j.pairing.url),
    'the QR code carries the code in its address, so scanning it fills the numbers in; the plain address does not'
  );
  ok(
    r.j.url === r.j.pairing.url && /^http:\/\/127\.0\.0\.1:\d+$/.test(r.j.url),
    'the state carries the address a phone types also outside the window (url), so the TV page shows it beside Pair a phone'
  );
  const page = await get(port, '/');
  ok(
    page.code === 200 &&
      /Phone remote/.test(page.text) &&
      /no-store/.test(page.headers['cache-control'] || '') &&
      page.headers['pragma'] === 'no-cache' &&
      /http-equiv=cache-control content=no-store/.test(page.text),
    'the phone page is served, and no cache may keep it (headers and its own meta tags)'
  );
  // the name field: the router's name for the phone is written into the page; a name that is not one is not
  const dn = require('../../addons/catalog/phoneremote/devicename');
  rev.name = 'Danas-iPhone.lan';
  dn.forget();
  let hp = await get(port, '/');
  ok(/var HINT="Danas-iPhone";/.test(hp.text), 'the router’s name for the phone is put in the page, without its domain');
  rev.name = 'wlan0';
  dn.forget();
  hp = await get(port, '/');
  ok(/var HINT="";/.test(hp.text), 'wlan0 is not a name: the hint stays empty and the page uses what the browser says');
  rev.name = 'x</script><script>alert(1)</script>';
  dn.forget();
  hp = await get(port, '/');
  ok(
    !/<script>alert/.test(hp.text) && (hp.text.match(/<\/script>/g) || []).length === 3,
    'a hostile name from the router cannot break out of the page'
  );
  rev.name = '';
  dn.forget();
  // the QR code carries the code in the address: the server writes it into the page, so the boxes are filled before any script runs
  const withCode = await get(port, '/?code=' + code);
  ok(
    withCode.code === 200 &&
      withCode.text.indexOf('value="' + code + '"') > 0 &&
      (withCode.text.match(/<div class=cell>[0-9]<\/div>/g) || []).length === 6,
    'a page opened with the QR code has the numbers filled in already (input and boxes)'
  );
  ok(
    (page.text.match(/<div class=cell><\/div>/g) || []).length === 6 && page.text.indexOf('value=""') > 0,
    'and a page opened without one starts empty'
  );
  ok(!page.text.includes(code), 'the page does not contain the code');
  // no other site may lay this page in a frame and put invisible keys over it: both headers say so, on the page and on every reply
  ok(
    page.headers['x-frame-options'] === 'DENY' && page.headers['content-security-policy'] === "frame-ancestors 'none'",
    'the phone page says it may not be put in a frame (x-frame-options and a frame-ancestors policy)'
  );
  const noToken = await get(port, '/api/apps');
  ok(
    noToken.code === 403 &&
      noToken.headers['x-frame-options'] === 'DENY' &&
      noToken.headers['content-security-policy'] === "frame-ancestors 'none'",
    'and so does a JSON reply (the refusal without a token)'
  );

  // ---- nothing before pairing ----
  let p = await phone(port, undefined);
  p.c.send(JSON.stringify({ t: 'key', k: 'HOME', n: 1 }));
  await sleep(100);
  ok(keys.pressed.length === 0 && p.closed === 4401, 'a key sent before saying who it is is dropped and the connection closed');
  p = await phone(port, 'deadbeef.' + '0'.repeat(32));
  await sleep(100);
  ok(p.msgs[0] && p.msgs[0].t === 'denied' && p.closed === 4401 && keys.pressed.length === 0, 'an unknown token is denied');
  p = await phone(port); // says nothing at all
  await sleep(50);
  ok(p.closed === 0, 'a connection that is silent is given a few seconds');
  p.c.terminate();

  // ---- pairing ----
  r = await post(port, '/api/pair', { code: '000000' === code ? '111111' : '000000', name: 'x' });
  ok(r.code === 403, 'a wrong code is refused');
  r = await post(port, '/api/pair', { code, name: 'Eden <b>phone</b>' }, 'http://evil.example');
  ok(r.code === 403, 'a pairing from a page on another site is refused');
  // DNS rebinding: a page controls the Host header of its own requests, so Origin === Host alone proves nothing. The Origin must name an
  // address the TV itself has.
  r = await post(port, '/api/pair', { code, name: 'rebound' }, 'http://tv.example:8799', 'tv.example:8799');
  ok(r.code === 403, 'an Origin that names a host the TV is not is refused, even when it matches the Host header (DNS rebinding)');
  r = await post(port, '/api/pair', { code, name: 'Eden <b>phone</b>' }, 'http://127.0.0.1:' + port);
  const token = r.j && r.j.token;
  ok(
    r.code === 200 && /^[0-9a-f]{8}\.[0-9a-f]{32}$/.test(token) && r.j.name === 'Eden bphone/b',
    'the right code gives a token; the name is cleaned'
  );
  r = await post(port, '/api/pair', { code, name: 'again' });
  ok(r.code === 403, 'a code works once');
  const stored = JSON.stringify(settings.raw());
  ok(!stored.includes(token.split('.')[1]) && /"hash":"[0-9a-f]{64}"/.test(stored), 'only the hash of the token is stored');
  r = await call(pr, '/api/phoneremote');
  ok(
    r.j.phones.length === 1 && r.j.pairing.code !== code && r.j.pairing.paired.name === 'Eden bphone/b',
    'the new phone is listed and the window shows a new code'
  );
  const id = r.j.phones[0].id;
  r = await post(port, '/api/pair', { code: r.j.pairing.code, name: 'Eden <b>phone</b>' });
  ok(r.code === 200 && r.j.name === 'Eden bphone/b 2', 'a second phone with the same name gets a number, so the two can be told apart');
  r = await call(pr, '/api/phoneremote/revoke', 'POST', { id: (await call(pr, '/api/phoneremote')).j.phones[1].id });
  ok(r.code === 200, 'the second phone is removed again for the rest of the test');

  // ---- connected ----
  p = await phone(port, token);
  await sleep(100);
  ok(p.msgs[0].t === 'ready' && p.msgs[0].name === 'Eden bphone/b', 'a paired phone is let in');
  ok(typeof p.msgs[0].tv === 'string', "the ready message also carries the TV's own name for the page header");
  // LG's "TV Name" comes out of Apple's HomeKit store: 8 bytes of header, then the name, NUL-terminated
  const storeBuf = Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]), Buffer.from('Living room TV'), Buffer.alloc(40)]);
  ok(tvname.parse(storeBuf) === 'Living room TV', "the TV's own name is read out of the HomeKit store");
  ok(tvname.parse(Buffer.alloc(48)) === '', 'a store without a name gives nothing, so the model in the header is used instead');
  ok(
    tvname.parse(Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]), Buffer.from('x'.repeat(80))])) === '',
    'an over-long run is not taken for a name'
  );
  ok(typeof tvname.read() === 'string', 'reading the store never throws, even off a TV');
  // only the store's first 64 bytes are read: what follows the name is the pairing material, which is none of the add-on's business
  {
    const storeFile = path.join(tmp, 'homekit-store');
    fs.writeFileSync(
      storeFile,
      Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]), Buffer.from('Living room TV\u0000'), Buffer.from('PAIRINGSECRET')])
    );
    ok(tvname.read(storeFile) === 'Living room TV', 'the name is read from the first bytes of the HomeKit store');
    fs.writeFileSync(storeFile, Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]), Buffer.alloc(60, 65), Buffer.from('PAIRINGSECRET')]));
    ok(tvname.read(storeFile) === '', 'and a name that starts after the 64th byte is not read at all');
  }
  // the Apps tab: the list and the icons come from the launcher's API, through this server, only with the phone's token
  let ap = await get(port, '/api/apps?t=' + encodeURIComponent(token));
  ok(
    ap.code === 200 && ap.text.indexOf('com.webos.app.browser') > 0 && ap.text.indexOf('Web Browser') > 0,
    "a paired phone gets the TV's apps"
  );
  ap = await get(port, '/api/apps');
  ok(ap.code === 403, 'without the token the app list is refused');
  ap = await get(port, '/icon/com.webos.app.browser?t=' + encodeURIComponent(token));
  ok(ap.code === 200 && /image\/png/.test(ap.headers['content-type'] || ''), 'and the icons come through the same door');
  ap = await get(port, '/api/inputs?t=' + encodeURIComponent(token));
  ok(
    ap.code === 200 && ap.text.indexOf('PS5 Game console') > 0 && ap.text.indexOf('com.webos.app.hdmi2') > 0,
    'and the inputs the TV has now, with the names the TV gives them (an unplugged port says so)'
  );
  ok(ap.text.indexOf('"tuner":true') > 0, 'the tuner entry is marked as such, so the page can call it Live TV instead of "Input"');
  const logo = await get(port, '/api/logo/7?t=' + encodeURIComponent(token));
  ok(
    logo.code === 200 && /image\/png/.test(logo.headers['content-type'] || ''),
    "a channel's logo comes through the same door, fetched by the TV"
  );
  const logoNo = await get(port, '/api/logo/7');
  ok(logoNo.code === 403, 'and without the token it is refused');
  const lv = await get(port, '/api/live?t=' + encodeURIComponent(token));
  ok(
    lv.code === 200 && lv.text.indexOf('BBC One') > 0 && lv.text.indexOf('secret') < 0,
    'and the channels of the playlist, without the stream addresses that hold the provider key'
  );
  p.c.send(JSON.stringify({ t: 'liveSetup', n: 44 }));
  await sleep(250);
  const setupAck = p.msgs.filter(m => m.t === 'ack' && m.n === 44)[0];
  ok(
    setupAck && setupAck.ok && launcher.lastLaunch.params && launcher.lastLaunch.params.live && !launcher.lastLaunch.params.channel,
    'Live TV can be opened at its setup screen, for a TV with no playlist yet'
  );
  keys.pressed.length = 0;
  p.c.send(JSON.stringify({ t: 'live', num: 7, n: 43 }));
  await sleep(300);
  const lvAck = p.msgs.filter(m => m.t === 'ack' && m.n === 43)[0];
  ok(
    lvAck &&
      lvAck.ok &&
      launcher.lastLaunch &&
      launcher.lastLaunch.params &&
      launcher.lastLaunch.params.live &&
      !launcher.lastLaunch.params.channel,
    'Live TV on a channel opens Live TV the way a card does: Home is not told anything new'
  );
  ok(
    keys.pressed.length === 1 && keys.pressed[0][0] === 'key' && keys.pressed[0][1] === '7',
    'and then the number is pressed on the remote, which is how Live TV takes a channel number'
  );
  p.c.send(JSON.stringify({ t: 'live', num: 12, n: 45 }));
  await sleep(500);
  ok(
    keys.pressed
      .slice(1)
      .map(x => x[1])
      .join('') === '12',
    'a number of two digits is two presses, in order'
  );
  p.c.send(JSON.stringify({ t: 'launch', id: 'com.example.tv', n: 42 }));
  await sleep(250);
  const apAck = p.msgs.filter(m => m.t === 'ack' && m.n === 42)[0];
  ok(apAck && apAck.ok && launcher.launched.indexOf('com.example.tv') >= 0, 'opening an app from the phone reaches the TV');

  // ---- the power drawer's four calls ----
  tvCalls.length = 0;
  p.c.send(JSON.stringify({ t: 'tvpower', a: 'reboot', n: 51 }));
  await sleep(200);
  const rbAck = p.msgs.filter(m => m.t === 'ack' && m.n === 51)[0];
  ok(
    rbAck &&
      rbAck.ok &&
      tvCalls.length === 1 &&
      tvCalls[0][0] === 'luna://com.webos.service.tvpower/power/reboot' &&
      tvCalls[0][1].reason === 'remoteKey',
    "a row of the power drawer asks the TV's own power service, with the reason the TV knows"
  );
  p.c.send(JSON.stringify({ t: 'tvpower', a: 'off', n: 52 }));
  p.c.send(JSON.stringify({ t: 'tvpower', a: 'nonsense', n: 53 }));
  await sleep(200);
  const offAck = p.msgs.filter(m => m.t === 'ack' && m.n === 52)[0];
  const badAck = p.msgs.filter(m => m.t === 'ack' && m.n === 53)[0];
  ok(
    offAck && offAck.ok && /power\/turnOffScreen$/.test(tvCalls[1][0]) && badAck && !badAck.ok && tvCalls.length === 2,
    'the screen off is its own call, and an action the page does not have is refused before it reaches the TV'
  );

  // the phone asks the TV what its power state is: the answer comes from the TV, and On/Off is drawn from it
  p.c.send(JSON.stringify({ t: 'power' }));
  for (let i = 0; i < 15 && !p.msgs.filter(m => m.t === 'power').length; i++) await sleep(100);
  const pw = p.msgs.filter(m => m.t === 'power')[0];
  ok(pw && typeof pw.state === 'string', 'the phone can ask the TV for its power state (Active, Screen Saver, Screen Offâ€¦)');
  ok(
    typeof p.msgs[0].mac === 'string' && 'wol' in p.msgs[0],
    'the ready message carries the TV address for Wake-on-LAN (empty when the TV has none)'
  );
  // ---- the mic: what the TV can do, a question from the phone, and the TV listening on its remote ----
  p.c.send(JSON.stringify({ t: 'vstat' }));
  for (let i = 0; i < 20 && !p.msgs.filter(m => m.t === 'vstat').length; i++) await sleep(50);
  const vs = p.msgs.filter(m => m.t === 'vstat')[0];
  ok(
    vs && vs.ok && vs.installed && vs.answers && !vs.unsupported,
    'the phone asks what voice can do on the TV: installed, and something answers (the AI chat)'
  );
  p.c.send(JSON.stringify({ t: 'ask', text: '  turn off the kitchen lights  ', n: 61 }));
  for (let i = 0; i < 20 && !p.msgs.filter(m => m.t === 'answer').length; i++) await sleep(50);
  const va = p.msgs.filter(m => m.t === 'answer')[0];
  ok(
    va &&
      va.text === 'turn off the kitchen lights' &&
      va.answer === 'Turned off Kitchen lights.' &&
      va.via === 'ha' &&
      va.error === '' &&
      voice.asked[0] === 'turn off the kitchen lights',
    "a question typed or dictated on the phone goes to the TV's voice assistant, trimmed, and its answer comes back with who gave it"
  );
  p.c.send(JSON.stringify({ t: 'ask', text: '   ' }));
  for (let i = 0; i < 20 && p.msgs.filter(m => m.t === 'answer').length < 2; i++) await sleep(50);
  ok(
    p.msgs.filter(m => m.t === 'answer')[1].error === 'empty' && voice.asked.length === 1,
    'an empty question is answered at once and never reaches the TV'
  );
  p.c.send(JSON.stringify({ t: 'listen' }));
  for (let i = 0; i < 40 && !p.msgs.filter(m => m.t === 'vlive' && (m.state === 'done' || m.state === 'error')).length; i++)
    await sleep(50);
  const steps = p.msgs.filter(m => m.t === 'vlive');
  const done = steps[steps.length - 1];
  ok(
    voice.listens === 1 &&
      steps[0].state === 'listening' &&
      steps.some(m => m.state === 'recognising') &&
      steps.some(m => m.state === 'thinking' && m.text === 'what is on tonight') &&
      done.state === 'done' &&
      done.text === 'what is on tonight' &&
      done.answer === 'The match starts at nine.' &&
      done.via === 'ai',
    'the TV listens on its remote and the phone is told each step: listening, recognising, thinking with the words, then the answer'
  );
  voice.installed = false;
  p.c.send(JSON.stringify({ t: 'listen' }));
  for (let i = 0; i < 20 && p.msgs.filter(m => m.t === 'vlive' && m.state === 'error').length < 1; i++) await sleep(50);
  const verr = p.msgs.filter(m => m.t === 'vlive' && m.state === 'error')[0];
  ok(
    verr && verr.e === 'voice is not installed' && voice.listens === 1,
    'without voice on the TV the phone is told why, and nothing listens'
  );
  voice.installed = true;

  p.c.send(JSON.stringify({ t: 'key', k: 'HOME', n: 7 }));
  p.c.send(JSON.stringify({ t: 'key', k: 'POWEROFF', n: 8 }));
  p.c.send(JSON.stringify({ t: 'move', dx: 3, dy: -2 }));
  p.c.send(JSON.stringify({ t: 'text', s: 'abc', n: 9 }));
  p.c.send(JSON.stringify({ t: 'del', c: 3, n: 10 }));
  p.c.send(JSON.stringify({ t: 'ping' }));
  await sleep(150);
  ok(
    keys.pressed.some(x => x[0] === 'key' && x[1] === 'HOME') && keys.pressed.some(x => x[0] === 'move' && x[1] === 3 && x[2] === -2),
    'keys and pointer moves reach the key adapter'
  );
  ok(
    keys.pressed.some(x => x[0] === 'text' && x[1] === 'abc'),
    'text reaches the key adapter'
  );
  ok(
    keys.pressed.some(x => x[0] === 'del' && x[1] === 3),
    'a delete reaches the key adapter with its count, not the message number'
  );
  const ack = p.msgs.filter(m => m.t === 'ack' && m.n >= 7 && m.n <= 10);
  ok(ack.length === 4 && ack[0].n === 7 && ack[0].ok && ack[1].n === 8 && !ack[1].ok, 'each key is answered; an unknown key fails');
  ok(
    p.msgs.some(m => m.t === 'pong'),
    'a ping is answered (the phone checks the TV is there)'
  );
  r = await call(pr, '/api/phoneremote');
  ok(r.j.phones[0].online === true, 'the phone shows as online');

  // ---- the rate limit of keys ----
  keys.pressed.length = 0;
  for (let i = 0; i < 200; i++) p.c.send(JSON.stringify({ t: 'click' }));
  await sleep(300);
  ok(
    keys.pressed.length < 120 && keys.pressed.length >= 60 && p.msgs.some(m => m.t === 'err'),
    'a flood of messages is cut off (' + keys.pressed.length + ' of 200 passed)'
  );

  // ---- block, allow ----
  r = await call(pr, '/api/phoneremote/access', 'POST', { id, allow: false });
  await sleep(100);
  ok(r.j.phones[0].blocked === true && p.closed === 4403, 'blocking a phone ends its connection');
  p = await phone(port, token);
  await sleep(100);
  ok(
    p.msgs[0].t === 'denied' && p.msgs[0].reason === 'blocked' && keys.pressed.length < 120,
    'a blocked phone is told so and sends nothing'
  );
  r = await call(pr, '/api/phoneremote/access', 'POST', { id, allow: true });
  p = await phone(port, token);
  await sleep(100);
  ok(p.msgs[0].t === 'ready', 'allowed again, the same token works (no new pairing)');

  // ---- the service restarts: the token still works, nothing else is needed ----
  pr.stop();
  stub.close();
  await sleep(100);
  ok(p.closed !== 0, 'the connection ends when the service stops');
  pr = make();
  pr.start();
  await sleep(150);
  const port2 = pr.address() && pr.address().port;
  ok(!!port2, 'after a restart the port is open again because a phone is paired');
  p = await phone(port2, token);
  await sleep(100);
  ok(p.msgs[0].t === 'ready', 'the paired phone reconnects with its token after the restart');
  r = await get(port2, '/');
  ok(r.code === 200, 'the page is served again');
  r = await post(port2, '/api/pair', { code: '123456', name: 'x' });
  ok(r.code === 403, 'with no pairing window, pairing is refused');

  // ---- revoke ----
  await call(pr, '/api/phoneremote/pair', 'POST', {}); // a window keeps the port open to try the revoked token
  r = await call(pr, '/api/phoneremote/revoke', 'POST', { id });
  await sleep(100);
  ok(r.j.phones.length === 0 && p.closed === 4401, 'revoking a phone ends its connection');
  ok(
    p.msgs.some(m => m.t === 'denied' && m.reason === 'revoked'),
    'and tells it why before closing, so it goes back to its pairing screen instead of "lost the TV"'
  );
  p = await phone(port2, token);
  await sleep(100);
  ok(p.msgs[0].t === 'denied' && p.msgs[0].reason === 'revoked' && p.closed === 4401, 'a revoked token is refused');
  await call(pr, '/api/phoneremote/pair', 'POST', { stop: true });
  await sleep(50);
  r = await call(pr, '/api/phoneremote');
  ok(!r.j.listening, 'with no phone left and no window the port is closed again');
  r = await call(pr, '/api/phoneremote/revoke', 'POST', { id: 'nope' });
  ok(r.code === 404, 'revoking a phone that is not there is a 404');

  // ---- rate limit of pairing ----
  r = await call(pr, '/api/phoneremote/pair', 'POST', {});
  const port3 = r.j.port;
  const wrong = r.j.pairing.code === '111111' ? '222222' : '111111';
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await post(port3, '/api/pair', { code: wrong, name: 'x' })).code);
  ok(
    codes.slice(0, 4).every(c => c === 403) && codes[4] === 429 && codes[6] === 429,
    'an address gets five pairing tries a minute, one was used before (then 429)'
  );
  const right = (await call(pr, '/api/phoneremote')).j.pairing.code;
  r = await post(port3, '/api/pair', { code: right, name: 'x' });
  ok(r.code === 429, 'even the right code is refused while the address is limited');
  // the window closes after eight wrong codes (from any addresses): simulated through the status
  r = await call(pr, '/api/phoneremote/pair', 'POST', { stop: true });
  ok(r.j.pairing === null, 'leaving the QR screen closes the pairing window');

  // ---- many wrong codes close the window ----
  r = await call(pr, '/api/phoneremote/pair', 'POST', {});
  ok(r.j.pairing && r.j.pairing.code !== right, 'a new window has a new code');

  // ---- off: the Add-ons switch stops the add-on, which closes the port and the window ----
  pr.stop();
  r = await call(pr, '/api/phoneremote');
  ok(!r.j.listening && r.j.pairing === null, 'stopped, the port closes and the window with it');
  pr.start();

  // ---- the loopback key call, for trying the adapter from the TV ----
  keys.pressed.length = 0;
  r = await call(pr, '/api/phoneremote/key', 'POST', { key: 'UP' });
  ok(r.j.ok === true && keys.pressed[0][1] === 'UP', 'POST /api/phoneremote/key presses a key as a phone would');

  // ---- typed text keeps its order; a key never waits behind it; "seen" is written at most once a minute ----
  {
    const reached = [];
    const gate = { text1: null };
    const slow = fakeKeys();
    slow.text = async s => {
      reached.push('text:' + s);
      if (s === 'a') await new Promise(r => (gate.text1 = r)); // the first one is slow, the second would finish at once
      if (s === 'boom') throw new Error('luna died');
      return { ok: true, error: '' };
    };
    slow.del = async c => (reached.push('del:' + c), { ok: true, error: '' });
    slow.enter = async () => (reached.push('enter'), { ok: true, error: '' });
    slow.press = async n => (reached.push('key:' + n), { ok: true, error: '' });
    let writes = 0;
    const cfg3 = store({});
    const set3 = cfg3.set;
    cfg3.set = function (o) {
      writes++;
      return set3(o);
    };
    const pr3 = PR.create(addonCtx(cfg3), { port: 0, host: '127.0.0.1', keys: slow, api, luna: fakeLuna });
    pr3.start();
    let r3 = await call(pr3, '/api/phoneremote/pair', 'POST', {});
    const port3 = r3.j.port;
    const pj = await post(port3, '/api/pair', { code: r3.j.pairing.code, name: 'order' });
    const tok3 = pj.j.token;
    const acks = ph => ph.msgs.filter(m => m.t === 'ack').map(m => m.n);
    const ready = async ph => {
      for (let i = 0; i < 40 && !ph.msgs.some(m => m.t === 'ready'); i++) await sleep(25);
    };

    let a = await phone(port3, tok3);
    await ready(a);
    const send = o => a.c.send(JSON.stringify(o));
    send({ t: 'text', s: 'a', n: 1 });
    send({ t: 'text', s: 'b', n: 2 });
    send({ t: 'del', c: 1, n: 3 });
    send({ t: 'enter', n: 4 });
    await sleep(150);
    ok(
      reached.join() === 'text:a' && acks(a).length === 0,
      'a second text waits for the first one to finish: only the first has reached the TV'
    );
    send({ t: 'key', k: 'UP', n: 5 });
    await sleep(100);
    ok(reached.indexOf('key:UP') > 0 && acks(a).join() === '5', 'a key press is not held up behind a slow text, and is acked at once');
    gate.text1();
    await sleep(200);
    ok(
      reached.filter(x => x !== 'key:UP').join() === 'text:a,text:b,del:1,enter',
      'text, delete and enter reach the adapter in the order they arrived'
    );
    ok(acks(a).join() === '5,1,2,3,4', 'and are acked in that order (the key was acked first, as it ran at once)');

    // an action that throws is acked as failed and the next one still runs
    send({ t: 'text', s: 'boom', n: 6 });
    send({ t: 'text', s: 'c', n: 7 });
    await sleep(150);
    const bad = a.msgs.filter(m => m.t === 'ack' && m.n === 6)[0];
    ok(bad && bad.ok === false && /luna died/.test(bad.e), 'a text action that fails is acked as failed');
    ok(reached.slice(-2).join() === 'text:boom,text:c' && acks(a).slice(-1)[0] === 7, 'and the next one still runs and is acked');

    // a connection that closes with a text still pending does not leave the service stuck
    gate.text1 = null;
    send({ t: 'text', s: 'a', n: 8 });
    await sleep(80);
    a.c.terminate();
    await sleep(80);
    gate.text1 && gate.text1();
    const b = await phone(port3, tok3);
    await ready(b);
    b.c.send(JSON.stringify({ t: 'text', s: 'z', n: 1 }));
    await sleep(120);
    ok(
      acks(b).join() === '1' && reached.slice(-1)[0] === 'text:z',
      'a closed connection leaves nothing pending: the next connection types at once'
    );

    // "seen": two logins within a minute are one write of it, not two
    b.c.terminate();
    await sleep(80);
    const before = writes;
    const c1 = await phone(port3, tok3);
    await ready(c1);
    c1.c.terminate();
    await sleep(80);
    const d1 = await phone(port3, tok3);
    await ready(d1);
    d1.c.terminate();
    await sleep(80);
    ok(writes === before, 'logins and closes within a minute of the last one do not rewrite the settings');
    const stale = cfg3.get().phones[0];
    stale.seen = Date.now() - 120000;
    const w0 = writes;
    const e1 = await phone(port3, tok3);
    await ready(e1);
    e1.c.terminate();
    await sleep(80);
    ok(writes > w0 && stale && cfg3.get().phones[0].seen > Date.now() - 60000, 'a "seen" older than a minute is written again');

    // the ready message tells the page when the phone was used before this connection and when it was paired (the "This remote" sheet)
    const lastSeen = cfg3.get().phones[0].seen,
      madeAt = cfg3.get().phones[0].created;
    const f1 = await phone(port3, tok3);
    await ready(f1);
    const rd = f1.msgs.filter(m => m.t === 'ready')[0];
    ok(rd.seen === lastSeen && rd.created === madeAt, 'ready carries the last use before this connection and the day the phone was paired');

    // logging out from the phone: it is removed from the list, told so, and its connection is closed; the token is dead afterwards
    f1.c.send(JSON.stringify({ t: 'logout' }));
    await sleep(150);
    ok(f1.msgs.some(m => m.t === 'bye') && f1.closed === 1000, 'a phone that logs out is told bye and its connection is closed');
    ok(cfg3.get().phones.length === 0, 'and it is gone from the list of paired phones');
    const f2 = await phone(port3, tok3);
    await sleep(100);
    ok(
      f2.msgs.some(m => m.t === 'denied' && m.reason === 'revoked'),
      'its token no longer works'
    );
    pr3.stop();
  }

  // ---- unused phones are removed after the days chosen in the manager (for security), and never while connected ----
  {
    const day = 86400000,
      now = Date.now();
    const mk = (id, seenDaysAgo) => ({
      id,
      name: 'p' + id,
      hash: 'h',
      created: now - 90 * day,
      seen: now - seenDaysAgo * day,
      blocked: false,
    });
    const cfgE = store({ phones: [mk('aaaaaaa1', 40), mk('aaaaaaa2', 10), mk('aaaaaaa3', 2)] });
    const prE = PR.create(addonCtx(cfgE), { port: 0, host: '127.0.0.1', keys, api, luna: fakeLuna });
    prE.start();
    let st = await call(prE, '/api/phoneremote');
    ok(st.j.expireDays === 14, 'with nothing chosen a phone is removed after 14 days without use');
    ok(st.j.phones.map(x => x.id).join() === 'aaaaaaa2,aaaaaaa3', 'a phone unused for 40 days is gone at start, the others stay');
    st = await call(prE, '/api/phoneremote', 'POST', { expireDays: 5 });
    ok(st.code === 400 && /Choose 1, 3, 7, 14 or 30/.test(st.j.error), 'only the offered numbers of days are accepted');
    st = await call(prE, '/api/phoneremote', 'POST', { expireDays: 7 });
    ok(
      st.j.expireDays === 7 && st.j.phones.map(x => x.id).join() === 'aaaaaaa3',
      'choosing 7 days removes the phone unused for 10 days at once'
    );
    st = await call(prE, '/api/phoneremote', 'POST', { expireDays: 0 });
    ok(st.j.expireDays === 0 && st.j.phones.length === 1, 'never keeps every phone');
    cfgE.get().phones[0].seen = now - 200 * day;
    st = await call(prE, '/api/phoneremote', 'POST', { expireDays: 0 });
    ok(st.j.phones.length === 1, 'with "never" even a phone unused for 200 days stays');
    prE.stop();
    // a connected phone is not removed, however old its last use
    const cfgF = store({ expireDays: 1, phones: [] });
    const prF = PR.create(addonCtx(cfgF), { port: 0, host: '127.0.0.1', keys, api, luna: fakeLuna });
    prF.start();
    await call(prF, '/api/phoneremote/pair', 'POST', {});
    const pcode = (await call(prF, '/api/phoneremote')).j.pairing.code;
    const portF = prF.address() && prF.address().port;
    const pr1 = await post(portF, '/api/pair', { code: pcode, name: 'live' });
    const tokF = pr1.j.token;
    const liveP = await phone(portF, tokF);
    await sleep(100);
    cfgF.get().phones[0].seen = cfgF.get().phones[0].created = now - 30 * day;
    await call(prF, '/api/phoneremote', 'POST', { expireDays: 1 });
    ok(cfgF.get().phones.length === 1, 'a phone that is connected is not removed, however long ago it was last used');
    liveP.c.close(1000);
    await sleep(300);
    cfgF.get().phones[0].seen = cfgF.get().phones[0].created = now - 30 * day;
    await call(prF, '/api/phoneremote', 'POST', { expireDays: 1 });
    ok(cfgF.get().phones.length === 0, 'once it is not connected any more it goes');
    prF.stop();
  }

  // ---- the tokens never reach the log ----
  {
    const lines = [];
    const log2 = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    let tok2 = '';
    try {
      const pr2 = PR.create(addonCtx(store({})), { port: 0, host: '127.0.0.1', keys });
      pr2.start();
      const s2 = await call(pr2, '/api/phoneremote/pair', 'POST', {});
      const r2 = await post(s2.j.port, '/api/pair', { code: s2.j.pairing.code, name: 'log' });
      tok2 = (r2.j && r2.j.token) || '';
      pr2.stop();
    } finally {
      console.log = log2;
    }
    ok(tok2 && lines.length > 0 && lines.every(l => !/hash/i.test(l) && l.indexOf(tok2) < 0), 'the log shows no token or hash');
  }
  pr.stop();

  // ---- the logos: one channel list for many of them, a size cap, redirects, and the hour-long image cache ----
  {
    const hit = { channels: 0, ok: 0, big: 0, bigSent: 0, bigClosed: 0 };
    const PNG1 = 'PNGDATA-1',
      PNG2 = 'PNGDATA-2';
    let logoApi = '';
    const logoServer = http.createServer((req, res) => {
      const u = req.url.split('?')[0];
      const sendImg = body => res.writeHead(200, { 'content-type': 'image/png' }).end(body);
      if (u === '/api/live/channels') {
        hit.channels++;
        return res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            // the playlist's addresses stay here: the phone only ever asks for /api/logo/<num>
            channels: [
              [7, 'c7', 'Seven', 'News', logoApi + '/img/ok.png', 'https://example/s?key=secret', 'k'],
              [8, 'c8', 'Eight', 'News', logoApi + '/img/moved', 'https://example/s?key=secret', 'k'],
              [9, 'c9', 'Nine', 'News', logoApi + '/img/big', 'https://example/s?key=secret', 'k'],
              [10, 'c10', 'Ten', 'News', logoApi + '/img/hop0', 'https://example/s?key=secret', 'k'],
              [11, 'c11', 'Eleven', 'News', logoApi + '/img/hop1', 'https://example/s?key=secret', 'k'],
              [12, 'c12', 'Twelve', 'News', logoApi + '/img/two', 'https://example/s?key=secret', 'k'],
            ],
          })
        );
      }
      if (u === '/img/ok.png') {
        hit.ok++;
        return sendImg(PNG1);
      }
      if (u === '/img/two') return sendImg(PNG2);
      if (u === '/img/moved') {
        // a provider that moved its file: a relative Location, which must be resolved against the address that answered
        res.writeHead(302, { location: '/img/ok.png' });
        return res.end();
      }
      if (u.indexOf('/img/hop') === 0) {
        const n = parseInt(u.slice('/img/hop'.length), 10);
        res.writeHead(302, { location: n >= 3 ? '/img/ok.png' : '/img/hop' + (n + 1) });
        return res.end();
      }
      if (u === '/img/big') {
        hit.big++;
        res.writeHead(200, { 'content-type': 'image/png' });
        const chunk = Buffer.alloc(128 * 1024, 7); // five times anything a logo should be
        let left = 40,
          gone = false;
        const t = setInterval(() => {
          if (left-- <= 0) {
            clearInterval(t);
            return res.end();
          }
          hit.bigSent += chunk.length;
          res.write(chunk);
        }, 20);
        const away = () => {
          if (gone) return; // "close" and "aborted" both say the reader left: count it once
          gone = true;
          clearInterval(t);
          hit.bigClosed++;
        };
        res.on('close', away);
        res.on('error', away);
        req.on('aborted', away); // Node 8's server response is not always the first to hear it
        return;
      }
      res.writeHead(404).end('no');
    });
    await new Promise(r => logoServer.listen(0, '127.0.0.1', r));
    logoApi = 'http://127.0.0.1:' + logoServer.address().port;
    const lp = await lanPair(PR, store({}), {
      port: 0,
      host: '127.0.0.1',
      keys: fakeKeys(),
      api: logoApi,
      luna: fakeLuna,
    });
    const ltok = '/api/logo/',
      tok = encodeURIComponent(lp.token);
    let lg = await get(lp.port, ltok + '7?t=' + tok);
    ok(
      lg.code === 200 && lg.text === PNG1 && /image\/png/.test(lg.headers['content-type'] || ''),
      "a channel's logo comes through, fetched by the TV from the playlist's own address"
    );
    lg = await get(lp.port, ltok + '7?t=' + tok);
    ok(
      lg.code === 200 && lg.text === PNG1 && hit.ok === 1,
      'the image is kept for an hour: the second request is answered without asking the provider again'
    );
    lg = await get(lp.port, ltok + '8?t=' + tok);
    ok(lg.code === 200 && lg.text === PNG1, 'a 302 with a relative Location is followed to the image');
    const bigAt = Date.now();
    lg = await get(lp.port, ltok + '9?t=' + tok);
    const bigMs = Date.now() - bigAt;
    for (let i = 0; i < 40 && !hit.bigClosed; i++) await sleep(25); // the provider's socket closes a moment after the cap
    ok(
      lg.code === 404 && bigMs < 2000 && hit.bigClosed > 0 && hit.bigSent < 2 * 1024 * 1024,
      'a logo body over 512 KB is refused (404) and the download is cut off at the cap, not read to the end (' +
        lg.code +
        ', ' +
        (Date.now() - bigAt) +
        ' ms, closed ' +
        hit.bigClosed +
        ', sent ' +
        hit.bigSent +
        ')'
    );
    lg = await get(lp.port, ltok + '10?t=' + tok);
    ok(lg.code === 404, 'a chain of four redirects is refused');
    lg = await get(lp.port, ltok + '11?t=' + tok);
    ok(lg.code === 200 && lg.text === PNG1, 'three redirects are followed, which is the limit');
    lg = await get(lp.port, ltok + '12?t=' + tok);
    ok(
      lg.code === 200 && lg.text === PNG2 && hit.channels === 1,
      'six different logos share one /api/live/channels fetch (the list is kept for 30 seconds), so a page of cards is one download'
    );
    lp.pr.stop();
    logoServer.close();
  }

  // ---- a launcher request that answers and then stalls must still end: the apiTimeout option ----
  {
    const sockets = new Set();
    const stall = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"apps":['); // headers and a part of the body, and then nothing: the answer never ends
    });
    stall.on('connection', s => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await new Promise(r => stall.listen(0, '127.0.0.1', r));
    const stallApi = 'http://127.0.0.1:' + stall.address().port;
    const sp = await lanPair(PR, store({}), {
      port: 0,
      host: '127.0.0.1',
      keys: fakeKeys(),
      api: stallApi,
      luna: fakeLuna,
      apiTimeout: 300,
    });
    const at = Date.now();
    const sr = await get(sp.port, '/api/apps?t=' + encodeURIComponent(sp.token), 8000);
    const ms = Date.now() - at;
    ok(
      sr.code === 200 && sr.text === '{"apps":[]}' && ms < 3000,
      'a launcher response that starts and never ends still answers the phone within the limit (' + ms + ' ms, not for ever)'
    );
    sp.pr.stop();
    sockets.forEach(s => s.destroy());
    stall.close();
  }
  // ---- a scan of the QR code takes it off the TV at once, also when the phone that scanned it is already paired ----
  {
    const sc = await lanPair(PR, store({}), { port: 0, host: '127.0.0.1', keys: fakeKeys(), api, luna: fakeLuna, reverse });
    let s = await call(sc.pr, '/api/phoneremote/pair', 'POST', {});
    ok(s.j.pairing && s.j.pairing.scanned === 0, 'a window that nobody scanned yet shows its QR code (scanned is 0)');
    await get(sc.port, '/?code=' + (s.j.pairing.code === '000000' ? '111111' : '000000'));
    s = await call(sc.pr, '/api/phoneremote');
    ok(s.j.pairing.scanned === 0, 'a page opened with a wrong code does not count as a scan');
    await get(sc.port, '/?code=' + s.j.pairing.code);
    s = await call(sc.pr, '/api/phoneremote');
    ok(s.j.pairing && s.j.pairing.scanned > 0, 'the page opened from the QR code marks the window scanned: the TV page takes the code off');
    const pp = await phone(sc.port, sc.token);
    await sleep(100);
    s = await call(sc.pr, '/api/phoneremote');
    ok(
      pp.msgs[0] && pp.msgs[0].t === 'ready' && s.j.pairing === null && s.j.scanned && s.j.scanned.name === 'test' && s.j.scanned.at > 0,
      'a phone that was already paired scanned it and connected: the window closes and the state says which phone it was'
    );
    pp.c.terminate();
    // a new phone scans, then finishes pairing on the phone: the window stays open for it, and its own connection does not close it
    s = await call(sc.pr, '/api/phoneremote/pair', 'POST', {});
    await get(sc.port, '/?code=' + s.j.pairing.code);
    const np = await post(sc.port, '/api/pair', { code: s.j.pairing.code, name: 'new one' });
    ok(np.code === 200 && np.j.token, 'the phone that scanned the code can still pair with it');
    const np2 = await phone(sc.port, np.j.token);
    await sleep(100);
    s = await call(sc.pr, '/api/phoneremote');
    ok(
      s.j.pairing && s.j.pairing.paired && s.j.pairing.paired.name === 'new one' && s.j.pairing.scanned === 0,
      'the new phone connecting is not taken for a paired phone scanning: the TV page sees it paired (and closes the window itself)'
    );
    np2.c.terminate();
    sc.pr.stop();
  }
  {
    const js = fs.readFileSync(path.join(root, 'addons/catalog/phoneremote/src/js/page.js'), 'utf8');
    ok(
      /function live\(\) \{\s*return !!\(S && S\.pairing && !S\.pairing\.scanned\);/.test(js) &&
        /var p = live\(\) \? S\.pairing : null/.test(js),
      'the TV page shows the code only while nobody has scanned it (live), so a scan takes it off the screen at the next poll'
    );
  }

  // ---- a port that is taken: the status says so under listenError, apart from a request that failed ----
  {
    const busy = http.createServer((req, res) => res.end('busy'));
    await new Promise(r => busy.listen(0, '127.0.0.1', r));
    const busyPort = busy.address().port;
    const bp = PR.create(addonCtx(store({})), { port: busyPort, host: '127.0.0.1', keys: fakeKeys(), luna: fakeLuna });
    bp.start();
    await call(bp, '/api/phoneremote/pair', 'POST', {}); // the window is what opens (and here fails to open) the port
    let bs = await call(bp, '/api/phoneremote');
    for (let i = 0; i < 40 && !bs.j.listenError; i++) {
      await sleep(50);
      bs = await call(bp, '/api/phoneremote');
    }
    ok(
      bs.j.listening === false &&
        typeof bs.j.listenError === 'string' &&
        /could not listen/.test(bs.j.listenError) &&
        bs.j.listenError.indexOf(String(busyPort)) >= 0 &&
        !('error' in bs.j),
      "a port that is already taken says why in listenError (with the port) and listening is false, so the add-on's page can show a busy port"
    );
    bp.stop();
    busy.close();
  }

  // ---- the pairing rate limit: five tries a minute, and pruning the list must not give a sixth ----
  {
    const rl = PR.create(addonCtx(store({})), { port: 0, host: '127.0.0.1', keys: fakeKeys(), luna: fakeLuna });
    rl.start();
    const win = await call(rl, '/api/phoneremote/pair', 'POST', {});
    const rport = win.j.port;
    const wrong = win.j.pairing.code === '111111' ? '222222' : '111111';
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post(rport, '/api/pair', { code: wrong, name: 'x' })).code);
    ok(
      codes.slice(0, 5).every(c => c === 403) && codes[5] === 429,
      'five pairing tries a minute from one address, and the try list being pruned does not start it again (' + codes.join(',') + ')'
    );
    const rightCode = (await call(rl, '/api/phoneremote')).j.pairing.code;
    ok(
      (await post(rport, '/api/pair', { code: rightCode, name: 'x' })).code === 429,
      'and the right code is refused while the address is limited'
    );
    rl.stop();
  }

  // ---- the page ----
  const pg = require('../../addons/catalog/phoneremote/page').phonePage(req('i18n'), 'en');
  ok(
    /localStorage/.test(pg) &&
      /new WebSocket/.test(pg) &&
      /visibilitychange/.test(pg) &&
      /status\('off',t\("Can't reach the TV"\)\)/.test(pg),
    'the page keeps a socket, reconnects on wake and keeps its token'
  );
  ok(
    (pg.match(/class=drawer/g) || []).length === 6 && /\.drawer\{/.test(pg) && /\.drawer \.top button\{/.test(pg),
    'the inputs, the numbers, the keyboard, the power, the "This remote" and the voice drawer are one and the same: one panel, one handle, one title row, one close button'
  );
  ok(
    (pg.match(/class=qmic /g) || []).length === 2 &&
      /class=qin [^]*?class=qmic [^]*?class=qkb /.test(pg) &&
      /var VK='cytv-voice'/.test(pg) &&
      /if\(pick\|\|!vpref\.remember\|\|!vpref\.src\)return vpick\(\)/.test(pg),
    'the mic sits between Inputs and Keyboard on the Remote and the Touchpad; a tap uses the place kept on the phone (cytv-voice), and with none kept it asks'
  );
  ok(
    /id=kvvoice/.test(pg) && /id=kvshow/.test(pg) && /id=kvwarn/.test(pg),
    'This remote has the Voice and Show answers here rows, and says when the TV cannot listen on its remote'
  );
  ok(
    /pullDown\('insheet','xins'\)/.test(pg) &&
      /pullDown\('sheet','xnum'\)/.test(pg) &&
      /pullDown\('pwsheet','xpw'\)/.test(pg) &&
      /pullDown\('kbsheet','xkb'\)/.test(pg) &&
      /if\(dy>72\)/.test(pg),
    'and every one of them closes when it is pulled down, not just the numbers'
  );
  ok(/<b>Numbers<\/b>/.test(pg), 'the numbers drawer has the same title row as the inputs drawer (it had a bare close button)');
  ok(
    /id=bnum/.test(pg) && /id=tabbar/.test(pg) && !/gap:/.test(pg) && !/id=lost/.test(pg) && !/id=retry/.test(pg),
    'the page has the numbers sheet and the tab bar, no flex gap, and no banner over the keys: the status line says it all'
  );
  // the power sheet only has the four things the TV can be told to do: with the TV not answering it does not open, and nothing shows its address
  ok(
    !/id=macv/.test(pg) && !/id=maccp/.test(pg) && !/id=pwhelp/.test(pg) && !/id=relayadd/.test(pg),
    'there is no drawer with the TV address any more, and no relay to set up'
  );
  ok(!/relay/i.test(pg), 'the page has no relay left in it');
  // the power drawer: a hold on the power button, and the TV's own four options inside the drawer everyone else uses
  ok(
    (pg.match(/class=pwrow data-a=/g) || []).length === 4 &&
      /data-a=off/.test(pg) &&
      /data-a=standby/.test(pg) &&
      /data-a=reboot/.test(pg) &&
      /data-a=shutdown/.test(pg) &&
      /id=pwlist/.test(pg),
    'a hold on the power button opens the same drawer with the four things a TV can be told to do: screen off, standby, restart, shut down'
  );
  ok(
    /function pwDown/.test(pg) &&
      /pwT=setTimeout\(function\(\)\{pwHeld=true;buzz\(\);power\(true\)\},480\)/.test(pg) &&
      /if\(pwHeld\)\{pwHeld=false;return\}/.test(pg) &&
      /if\(!\(ready&&onNow\(\)\)\)return/.test(pg),
    'the hold is what opens it, only with the TV on: a tap is still the TV own POWER key, and a hold with the TV off does nothing'
  );
  ok(
    /if\(pwArm!==a\)\{disarm\(\);pwArm=a;b\.className='pwrow arm'/.test(pg) &&
      /Tap again to restart the TV\./.test(pg) &&
      /pwArmT=setTimeout\(disarm,4000\)/.test(pg),
    'a restart and a shut down cannot be taken back, so they want a second tap within four seconds and say so'
  );
  ok(
    /\{t:'tvpower',a:a\}/.test(pg) && /buzz\(\);pendStart\('off'\)\}/.test(pg) && /if\(pend\)pendClear\(\);say\(t\('TV said:'\)/.test(pg),
    'each row sends its own action to the service, and the button and status line show the wait; a refused one ends it'
  );
  ok(
    /function power\(on\)\{disarm\(\);\$\('pws'\)\.className=on\?'scrim':'hide'/.test(pg) && /id=pwlist/.test(pg),
    'the drawer only holds the four things the TV can be told to do'
  );
  ok(
    /class=qin/.test(pg) && /id=inslist/.test(pg) && /function loadInputs\(\)/.test(pg) && !/class=tv>/.test(pg),
    'the header has only the name and Power; an Inputs button, in the last row, lists the ports'
  );
  ok(/i\.tuner \? t\('Live TV'\)/.test(pg), 'the tuner shows as Live TV in the Inputs sheet, the way the TV names it');
  ok(
    /<button class=qin aria-label="[^"]*"><svg[\s\S]{0,400}?<\/svg><span>[^<]+<\/span><\/button>/.test(pg) &&
      !/data-k=INFO/.test(pg) &&
      (pg.match(/class=qkb/g) || []).length === 2 &&
      (pg.match(/class=qin/g) || []).length === 2 &&
      !/id=btx/.test(pg) &&
      !/pastetxt/.test(pg) &&
      /class=playbar/.test(pg) &&
      /class="cn tl"/.test(pg) &&
      /class="cn bl"/.test(pg),
    'Inputs and Keyboard are the last row of the Remote and the Touchpad (a word next to each icon), the tab bar has no Keyboard, there is no Paste, the corners hold Menu, 123, Back and Home, and the Info button is gone'
  );
  ok(
    /if\(id==='ap'\)/.test(pg) &&
      /else if\(!appsIn\)loadApps\(\)/.test(pg) &&
      /function skeleton\(n\)/.test(pg) &&
      /g\.innerHTML=skeleton\(9\)/.test(pg) &&
      /@keyframes sk/.test(pg),
    'a tab that is already filled does not fetch again, and a loading list shows placeholder tiles, not text'
  );
  ok(
    /class=lvi/.test(pg) && /\/api\/logo\//.test(pg) && /im.onerror=function/.test(pg),
    'every channel card carries its logo (from the TV) and falls back to its number when there is none'
  );
  ok(
    /No apps/.test(pg) && /Nothing was found to show here\./.test(pg),
    'the apps list has an empty state of its own, like the channel list'
  );
  ok(
    /var tvDown=false/.test(pg) &&
      /if\(tvDown\)\{appsIn=false;return noTv\(g\)\}/.test(pg) &&
      /if\(id==='ap'\)\{if\(tvDown\)/.test(pg) &&
      /tvDown=off;if\(off\)\{appsIn=false;liveIn=false/.test(pg),
    'a TV that is off replaces whatever the apps and live lists were showing, on the spot and on the next visit'
  );
  ok(
    !/\.dim/.test(pg) && /off\?t\('Off'\)/.test(pg),
    'the keys are never greyed out, and the status line always says Off rather than showing a bare dot'
  );
  ok(
    /function noTv\(g\)/.test(pg) && /onerror=function\(\)\{appsIn=false;noTv\(g\)\}/.test(pg) && /The TV is off/.test(pg),
    'a TV that is off says so in both lists (and the button wakes it in the app)'
  );
  ok(
    /class=lvn>'\+c\.num/.test(pg) && /\.lvgrid \.lvn\{[^}]*font:800 19px/.test(pg),
    'a channel without a logo shows its number where the logo would be, in large type'
  );
  ok(
    /<button class=tab id=blv>/.test(pg) && !/tab hide' id=blv/.test(pg),
    'the Live tab is always in the bar, whether a playlist is set or not'
  );
  ok(
    /class=pstate/.test(pg) && /function setupLive\(\)/.test(pg) && /t:'liveSetup'/.test(pg) && /function pstateInto/.test(pg),
    'with no playlist it shows a message and a button that opens the Live TV setup on the TV'
  );
  ok(
    /function loadLive\(\)/.test(pg) &&
      /function openLive\(/.test(pg) &&
      /liveOk = list.length > 0/.test(pg) &&
      /wakeThen\(go\)/.test(pg) &&
      /say\(t\('The TV did not come on'\),'bad',4000\)/.test(pg),
    'a channel opens through the same wake-first path as an app'
  );
  ok(
    !/toast\(/.test(pg) && !/id=toast/.test(pg) && /function say\(text,tone,ms\)/.test(pg) && /stBase=\[/.test(pg),
    'messages show in the status line under the TV name for a few seconds, and there is no toast over the keys any more'
  );
  ok(
    /function fit\(\)/.test(pg) &&
      /--appH/.test(pg) &&
      /#remote\{height:var\(--appH, 100vh\)\}/.test(pg) &&
      /#remote\{display:flex;flex-direction:column;height:100vh\}/.test(pg) &&
      /\.head\{flex:none/.test(pg) &&
      /#kb,#tp,#ap,#lv\{flex:1;min-height:0;overflow-y:auto/.test(pg) &&
      /\.tabbar\{flex:none/.test(pg),
    'the screen is a column of the full visible height: the top bar and the tab bar are its ends, and only the panel scrolls'
  );
  ok(
    !/pwrFit/.test(pg) && /\.pwr\{[^}]*width:auto;min-width:80px;padding:0 14px/.test(pg),
    'the power button is as wide as its label needs (the browser sizes it, no width is set from the script), with the same padding on both sides'
  );
  ok(
    /id=bap/.test(pg) && /id=apgrid/.test(pg) && /function loadApps\(\)/.test(pg) && /t:'launch'/.test(pg),
    "the Apps tab lists the TV's apps and opens one when it is tapped"
  );
  ok(
    /function openApp\(id,title\)/.test(pg) &&
      /if\(onNow\(\)\)return goNow\(function\(\)\{launchApp\(id,title\)\}\)/.test(pg) &&
      /wakeThen\(function\(\)\{launchApp\(id,title\)\}\)/.test(pg) &&
      /pendStart\('on'\);\s*whenOn/.test(pg),
    'with the TV off, a tap wakes it first and opens the app once the TV says it is on'
  );
  // the screensaver counts as on, but a launch stays hidden behind it: a Back key takes it away first (Live TV setup, a channel, an app)
  ok(
    /function goNow\(go\)\{if\(pwrState!=='Screen Saver'\)return go\(\);if\(!send\(\{t:'key',k:'BACK'\}\)\)return;setTimeout\(go,900\)\}/.test(
      pg
    ) && (pg.match(/if\(onNow\(\)\)return goNow\(go\);/g) || []).length === 2,
    'with the screensaver on, Live TV setup and a channel wake the screen before they open'
  );
  // the launcher and the Live TV page are not changed by the phone remote: it is an add-on that uses what Home already offers
  {
    const rd = f => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
    ok(
      !/p\.channel|LIVE\.tune|wantNum/.test(
        rd('app/src/js/input.js') + rd('app/src/js/live.js') + rd('helper/addons-bundled/iptv/src/js/live.js')
      ),
      'the launcher and the Live TV page know nothing of the phone remote'
    );
  }
  // This remote: the TV's name opens the connection sheet, where a phone logs out after a question; the page then forgets everything
  ok(
    /<div class=who id=who role=button tabindex=0[^>]*><div class=tvrow><div id=tvname>TV<\/div>/.test(pg) &&
      /id=thsheet class=drawer/.test(pg) &&
      /id=kvas/.test(pg) &&
      /id=kvon/.test(pg) &&
      /id=kvad/.test(pg) &&
      /id=lgo class=outb/.test(pg),
    'the TV name is a button that opens the "This remote" sheet: paired as, paired on, the TV address and the log out button'
  );
  ok(
    /\$\('lgo'\)\.onclick=function\(\)\{cfmOpen\(true\)\}/.test(pg) &&
      /id=cfno class=ghostb/.test(pg) &&
      /\$\('cfyes'\)\.onclick=logout/.test(pg) &&
      /ready\?t\('This phone stops controlling the TV\./.test(pg),
    'log out asks first, in words that say what is removed (and what is not, when the TV is off); Stay paired is the other button'
  );
  ok(
    /send\(\{t:'logout'\}\)/.test(pg) &&
      /m\.t==='bye'/.test(pg) &&
      /leaving/.test(pg) &&
      /function wipe\(\)\{pendClear\(\);store\(''\);tok='';/.test(pg) &&
      /\^cytv/.test(pg) &&
      /\$\('code'\)\.value='';\$\('pname'\)\.value=guess\(\);cells\(\)/.test(pg) &&
      /CYTV_APP\.forget\(w\?'removed':'left'\)/.test(pg) &&
      /pnote\(w\?t\('Logged out\. This phone was removed/.test(pg),
    "log out tells the TV, waits for its bye (3 s at most), deletes every cytv key the page kept, tells the app, and ends on the pairing screen with a toast (3 s) saying what happened to the TV's list"
  );
  // a touch the browser takes away (a call, a system gesture) is not a finger lift: the pad must not stay lit with its arrow timer running
  ok(
    /pad\.addEventListener\('touchcancel',function\(\)\{down=0;most=0;pad\.className='pad';stop\(\)\}\)/.test(pg) &&
      /function stop\(\)\{if\(tk\)\{clearInterval\(tk\);tk=null\}ax=ay=px=py=sc=0\}/.test(pg),
    'a cancelled touch clears the pad highlight and stops the arrow-key timer, so nothing keeps pressing after the finger is gone'
  );
  // a second finger lifting first must not make the rest of the gesture jump: the base moves to the finger that stays
  ok(
    /pad\.addEventListener\('touchend',function\(e\)\{e\.preventDefault\(\);if\(e\.touches\.length\)\{x0=e\.touches\[0\]\.clientX;y0=e\.touches\[0\]\.clientY;return\}/.test(
      pg
    ),
    'when one of two fingers lifts the other gets a fresh base, so the cursor does not jump by the distance already moved'
  );
  // a second tap while the first pairing request is in flight would post the same code twice, and the second 403 would land on the remote screen
  ok(
    /var pairing=false;/.test(pg) &&
      /function pair\(\)\{if\(pairing\)return;pairing=true;/.test(pg) &&
      /x\.onload=function\(\)\{pairing=false;/.test(pg) &&
      /x\.onerror=x\.ontimeout=function\(\)\{pairing=false;pnote\(/.test(pg) &&
      /x\.timeout=15000;/.test(pg),
    'the pairing request has an in-flight guard, which both answers clear again (a double tap pairs once)'
  );
  // the ring of a power press waited on its timers: logging out ends them too, or it comes back on the pairing screen
  ok(
    /function pendClear\(\)\{/.test(pg) && /function wipe\(\)\{pendClear\(\);store\(''\);tok='';/.test(pg),
    'logging out clears a waiting power press with the rest, so its ring cannot reappear on the pairing screen'
  );
  // webOS 5's Chromium does not know clamp(): an invalid value would leave the pad with no height at all
  ok(
    pg.indexOf('clamp(') < 0 && /\.pad\{[^}]*height:calc\(100vh - 380px\);min-height:300px;max-height:432px;/.test(pg),
    'the pad height is a plain calc with a min-height and a max-height, not clamp(), which the old Chromium throws away'
  );
  ok(
    (pg.match(/var [^;\n]*padMv/g) || []).length === 1,
    'padMv is declared once: a second declaration reset the tap-to-change-channel state'
  );
  ok(
    /\.replace\('%s',function\(\)\{return \$\('tvname'\)\.textContent\}\)/.test(pg),
    'the log-out question fills the TV name in with a function, so a name containing $ is not read as a replacement pattern'
  );
  // the touchpad fills the room between the header and the tab bar: no dead strip above the bottom buttons
  ok(
    /\.pad\{position:relative;margin:18px auto 0;width:calc\(100% - 40px\);max-width:390px;height:calc\(100vh - 380px\);min-height:300px;max-height:432px;/.test(
      pg
    ) &&
      /class=padhint id=padhint/.test(pg) &&
      /\.sbar\.drag \.sthumb\{background:#ff8a5b\}/.test(pg) &&
      /#tabbar\{flex:none/.test(pg) === false &&
      /id=tabbar/.test(pg) &&
      /\.padrow button\{flex-direction:column;height:64px/.test(pg) &&
      /\.tab\{flex:1;height:60px/.test(pg) &&
      /\.tabbar\{flex:none;display:flex;border-top:1px solid #2e3140;background:#13141a;padding:0 12px 4px\}/.test(pg) &&
      /#remote\{[^}]*height:var\(--appH/.test(pg) &&
      !/position:fixed;left:0;right:0;bottom:0/.test(pg),
    'the touchpad has a solid border and no text inside (the hint is below it), its scroll thumb turns orange while dragged, the buttons are 64px, and the tab bar is 64px (60px buttons and 4px)'
  );
  ok(
    !/class=logo/.test(pg) &&
      !/class=grow/.test(pg) &&
      /#pairbox\{position:relative;overflow:hidden;min-height:100vh;display:flex;flex-direction:column;padding:72px 20px 24px;/.test(pg) &&
      /#pairbox \.actions\{margin-top:auto/.test(pg),
    'the pairing screen has no icon at the top and no spacer: the title sits on a fixed line, 72px from the top, and the actions are at the bottom of the window'
  );
  // a page refreshed from an address that still has the QR code in it must not unseat the phone that is already paired
  ok(
    /function tidy\(\)\{try\{history\.replaceState\(null,'','\/'\)\}/.test(pg) &&
      /if\(tok\|\|ready\)\{tidy\(\);return\}/.test(pg) &&
      /store\(j\.token\);tok=j\.token;blocked=false;delay=1000;tidy\(\);/.test(pg),
    'the code leaves the address after it is used, and a refresh cannot pair again over a phone that is already in'
  );
  ok(
    /function buzz\(\)\{try\{if\(window\.CYTV_APP&&window\.CYTV_APP\.buzz\)/.test(pg) &&
      /function go\(\)\{send\(\{t:'key',k:k\}\);buzz\(\)\}/.test(pg) &&
      /else step\('ENTER'\);buzz\(\)/.test(pg),
    'a key press and a touchpad tap ask the app for a short vibration (the pad does not buzz on every swipe step)'
  );
  ok(
    /bridge\(\$\('pad'\)\);bridge\(\$\('sbar'\)\)/.test(pg) &&
      /addEventListener\('wheel'/.test(pg) &&
      /addEventListener\('contextmenu'/.test(pg),
    'the pad and the scroll strip also work with a mouse: drag, wheel over the pad, right click for Back'
  );
  ok(
    /id=sbar/.test(pg) && /id=sthumb/.test(pg) && /\{t:'scroll',dy:d\}/.test(pg) && /bar\.addEventListener\('touchmove'/.test(pg),
    'the touchpad has a scroll strip at its right: dragging the thumb scrolls the page on the TV (UP and DOWN keys when there is no pointer)'
  );
  ok(
    /setInterval\(tick,ptr\?33:45\)/.test(pg) &&
      /ax=Math\.max\(-5\*lim/.test(pg) &&
      /\{t:'move',dx:dx,dy:dy\}/.test(pg) &&
      /padKeysUntil=Date\.now\(\)\+30000/.test(pg),
    'the touchpad presses at most one arrow key every 45 ms and drops what is beyond five steps, so keys never queue behind the finger'
  );
  ok(
    /if\(app\)status\('off',''\)/.test(pg) && /function mark\(\)/.test(pg) && !/\$\('lost'\)/.test(pg),
    'in the app a lost TV is shown only by the header button (On/Off), with no banner over the keys'
  );
  ok(
    /onclose=function\(e\)/.test(pg) && /why===4401/.test(pg) && /why===4403/.test(pg),
    'a connection the TV closes with 4401 (removed) or 4403 (blocked) is handled by its code: pairing screen, or wait'
  );
  // in an app that wraps the page the phone sends the packet itself: the page hands it the TV's address and calls the bridge
  ok(
    /window\.CYTV_APP/.test(pg) && /CYTV_APP\.setMac\(mac\)/.test(pg) && /CYTV_APP\.wake\(\)/.test(pg),
    'the page hands the TV address to the app and lets the app send the wake packet itself'
  );
  ok(
    /window\.cytvPair=function\(code\)/.test(pg) &&
      /code\.length!==6\|\|ready/.test(pg) &&
      /\$\('code'\)\.value=code;cells\(\);\s*setTimeout\(function\(\)\{var n=\$\('pname'\);try\{n\.focus\(\);n\.select\(\)\}/.test(pg) &&
      !/cells\(\);pair\(\)/.test(pg) &&
      /window\.cytvPair\(m\[1\]\);tidy\(\)/.test(pg),
    'a scanned code (the web QR or the app) fills the code in and stays on the pairing screen with the cursor in the name; it does not pair by itself, and an already connected page ignores it'
  );
  // a backslash in the page's script is an escape of the template it is written in: \d must reach the phone as \d
  ok(
    pg.indexOf('code=(' + '\\' + 'd{6})') > 0 && pg.indexOf('replace(/^' + '\\' + 'd+' + '\\' + 's*/') > 0 && pg.indexOf('(d{6})') < 0,
    'the regular expressions in the page keep their backslashes (the QR code in the address is found; a channel title loses its number)'
  );
  ok(/id=pwrlb/.test(pg) && /function mark\(\)/.test(pg), 'the header button carries the TV state, in the app and in a browser');
  ok(
    /\$\('pwr'\)\.onclick=function\(\)\{if\(pwHeld\)\{pwHeld=false;return\}if\(pwBusy\(\)\)return;if\(ready\)powerPress\(\);else if\(native\(\)\)wakeNow\(\);else\{drop\(\);delay=1000;blocked=false;connect\(\);say\(/.test(
      pg
    ) &&
      /function powerPress\(\)/.test(pg) &&
      /send\(\{t:'key',k:'POWER'\}\)/.test(pg),
    "one button with the state inside: reachable, a tap is the TV's POWER key (both directions), and a hold is the drawer"
  );
  ok(
    /function pendStart\(to\)/.test(pg) &&
      /pend\.slow=true/.test(pg) &&
      /,8000\)/.test(pg) &&
      /,45000\)/.test(pg) &&
      /function pwBusy\(\)\{if\(!pend\)return false/.test(pg) &&
      /id=pwring/.test(pg) &&
      !/id=pwagain/.test(pg),
    'a power press shows a waiting state: ring and label, slow after 8 s, given up after 45 s, a second tap is ignored'
  );
  ok(
    /\(pwrState&&on===\(pend\.to==='on'\)\)/.test(pg) && !/status\('off',t\('Waking the TV…'\)/.test(pg),
    "the wait ends on the TV's own power state, and waking the TV puts no banner over the keys"
  );
  ok(
    /function onNow\(\)\{return pwrState\?\(pwrState==='Active'\|\|pwrState==='Screen Saver'\):ready\}/.test(pg) &&
      /else if\(m\.t==='power'\)\{pwrState=String\(m\.state\|\|''\);mark\(\)\}/.test(pg) &&
      /if\(ready&&Date\.now\(\)-lastAsk>5000\)ask\(\)/.test(pg),
    'On is what the TV says about itself (Active or Screen Saver), asked on connect and every five seconds'
  );
  ok(!/id=offgo/.test(pg), 'the sheet has no Turn off of its own any more');
  ok(
    /A_up&&ready/.test(pg) &&
      /\+\+upFail>=2/.test(pg) &&
      /lastPing>5000/.test(pg) &&
      /lastRx<lastPing&&Date\.now\(\)-lastPing>4000/.test(pg),
    'On means the TV answers: the app asks the phone, a browser asks the TV with a ping, and no answer turns it to Off'
  );
  ok(
    /else if\(native\(\)\)wakeNow\(\)/.test(pg) && !/\$\('retry'\)/.test(pg),
    'when the TV is not there the power button turns it on through the app, instead of only retrying'
  );
  ok(
    !/pmsg/.test(require('../../addons/catalog/phoneremote/page').PHONE_JS.replace(/apmsg/g, '')) &&
      /else pnote\(j\.error\|\|t\('That code is not right\. Check the 6 digits on the TV screen\.'\),'warn',10000\)/.test(
        require('../../addons/catalog/phoneremote/page').PHONE_JS
      ) &&
      /x\.onerror=x\.ontimeout=function\(\)\{pairing=false;pnote\(t\('The TV did not answer\. Check the phone is on the same Wi-Fi as the TV\.'\),'warn',10000\)/.test(
        require('../../addons/catalog/phoneremote/page').PHONE_JS
      ) &&
      /function showPair\(s,k\)\{[^}]*if\(s\)pnote\(s,k\|\|'warn',10000\)\}/.test(
        require('../../addons/catalog/phoneremote/page').PHONE_JS
      ),
    'the pairing screen shows its errors (wrong code, the TV did not answer, removed on the TV) as the timed note at the top, not as a line in the page'
  );
  // ---- a catalog add-on with a page of its own; the manager has no phone remote screens any more ----
  {
    const addon = JSON.parse(fs.readFileSync(path.join(root, 'addons', 'catalog', 'phoneremote', 'addon.json'), 'utf8'));
    ok(
      addon.kind === 'service' && addon.entry && addon.entry.service === 'service.js' && addon.entry.page === 'page/index.html',
      'the add-on is a catalog service add-on with a page of its own'
    );
    ok(
      addon.routes === undefined && addon.live === undefined && addon.enabledOption === undefined,
      'it needs no bundled-only keys: no routes, no live, no enabledOption (the Add-ons switch is the on/off)'
    );
    ok(
      addon.permissions &&
        addon.permissions.indexOf('luna') >= 0 &&
        Array.isArray(addon.luna) &&
        addon.luna.length >= 4 &&
        addon.luna.length <= 8,
      'it declares the luna calls it makes (networkinput, ime, audio, tvpower, settings, systemproperty)'
    );
    ok(addon.tile && addon.tile.placement === 'page' && addon.tile.icon, 'and a tile, so its page is a page of the book on Home');
    ok(/^\d+\.\d+\.\d+$/.test(addon.minService || ''), 'it asks for the service version that gives a catalog add-on its ctx');
  }
  {
    const page = fs.readFileSync(path.join(root, 'addons', 'catalog', 'phoneremote', 'page', 'index.html'), 'utf8');
    ok(
      /<script src="\/addon\/qrcode\.js"><\/script>/.test(page) && /<script src="\/addon\/sdk\.js"><\/script>/.test(page),
      "the page loads the shared QR code script and the SDK (Back to Home, the page's API)"
    );
    ok(
      /\/api\/addons\/phoneremote/.test(page) && /data-k="pair"/.test(page) && /id="expire"/.test(page) && /id="phonelist"/.test(page),
      'it pairs a phone, lists the paired phones and offers when unused ones are removed'
    );
    ok(
      /var I18N = /.test(page) && /data-t="Phone remote"/.test(page) && /function setLang\(/.test(page),
      'its texts go through the translations of the pages'
    );
    // the 10-foot layout: a stage that becomes pairing, a list with one stop per phone, a band; destructive actions ask in a confirm
    const js = fs.readFileSync(path.join(root, 'addons', 'catalog', 'phoneremote', 'src', 'js', 'page.js'), 'utf8');
    ok(
      /id="stage"/.test(page) && /data-t="Pairing"/.test(page) && /data-t="New phone"/.test(page) && !/flex-gap|[;{\s]gap:/.test(page),
      'the page has the stage (Pairing, New phone, Pair a phone as its only primary) and no flex gap (Chromium 68)'
    );
    ok(
      /button\.phone:focus \{[^}]*outline: none;[^}]*box-shadow: inset 0 0 0 2px #e9f0fa;/.test(page),
      'a focused phone card draws its ring inside (border and inset shadow): the clipping list cannot cut it and old Chromium keeps it round'
    );
    ok(
      /t\('Expires in ' \+ mmss\(left\) \+ ' · works once\.'\)/.test(js) && /p\.seconds/.test(js) && /id="rail"/.test(page),
      'while the window is open the code counts down from the seconds the service gives ("Expires in 1:47 · works once.", and a rail)'
    );
    ok(
      /function expire\(\)/.test(js) &&
        /t\('Code expired'\)/.test(js) &&
        /data-k="renew"/.test(page) &&
        /\$\('pairnew'\)\.onclick = pair/.test(js),
      'an ended window stays on the stage, dimmed: "Code expired", and Get a new code opens a new window'
    );
    ok(
      /row = el\('button', 'phone'\)/.test(js) &&
        !/Yes, remove/.test(js) &&
        /data-k="s:access"[\s\S]*data-k="s:remove"[\s\S]*data-k="s:cancel"/.test(page) &&
        /data-k="d:cancel"[\s\S]*data-k="d:ok"/.test(page) &&
        /focusKey\('d:cancel'\)/.test(js),
      'a phone is one stop that opens Manage (Block or Allow first, then Remove phone, Cancel); a remove asks in a confirm with Cancel focused first'
    );
    ok(/cls\(\$\('removeall'\), 'hide', list\.length < 2\)/.test(js), 'Remove all phones shows only with two phones or more');
    // when unused phones are removed: one row at the bottom of the phones (one stop), OK opens a picker with the six choices
    ok(
      /<button class="setrow" id="expire" data-k="exp">/.test(page) &&
        !/class="band"|id="bandtitle"|button\.cell/.test(page) &&
        /<div id="pick" class="sheet pick hide">/.test(page) &&
        /var DAYS = \[1, 3, 7, 14, 30, 0\];/.test(js) &&
        /\$\('expire'\)\.onclick = openPick;/.test(js) &&
        /if \(picking\) return \$\('pick'\);/.test(js) &&
        /else if \(picking\) closePick\(\);/.test(js),
      'the rule is one setting row (one stop, no band of six cells); OK opens the picker, which keeps the focus, and Back closes it'
    );
    ok(
      /if \(days === 0\) \{\s*back = 'o:0';\s*return ask\(/.test(js) && /button\.setrow \{[\s\S]*?margin-top: auto;/.test(page),
      'Never still asks first and Cancel goes back to the list; the row is pinned to the bottom of the column (margin, no flex gap)'
    );
    // the countdown on a card: run the page's own functions on a few phones
    {
      const src = js.slice(js.indexOf('var DAY = '), js.indexOf('function stateCls('));
      const sb = { S: { expireDays: 14 }, t: s => s, Date, Math };
      require('vm').runInNewContext(src + ';this.countdown=countdown;this.removalLeft=removalLeft;', sb);
      const now = Date.now(),
        D = 86400000;
      const cd = p => sb.countdown(Object.assign({ created: now - 100 * D }, p));
      ok(
        cd({ seen: now - 12 * D }) === 'removed in 2 days' &&
          cd({ seen: now - 3 * D }) === '' &&
          cd({ seen: now - 13.7 * D }) === 'removed soon' &&
          cd({ seen: now - 20 * D }) === 'removed soon' &&
          cd({ seen: now - 12 * D, online: true }) === '' &&
          cd({ seen: now - 12 * D, blocked: true }) === '',
        'a card says "removed in N days" only near the end (3 days or the last quarter), "removed soon" under a day, never for a connected or blocked phone'
      );
      sb.S.expireDays = 0;
      ok(cd({ seen: now - 400 * D }) === '' && sb.removalLeft({ seen: now }) === -1, 'with Never no card counts down');
      sb.S.expireDays = 30;
      ok(
        cd({ seen: now - 23 * D }) === 'removed in 7 days' && cd({ seen: now - 21 * D }) === '',
        'with a month, the last quarter (7.5 days) is when the countdown shows'
      );
    }
    // the page's script and the translations are one <script> block (qrcode.js loads before it): without the tags the TV shows only the static text
    ok(
      /<script src="\/addon\/qrcode\.js"><\/script>\s*<script>[\s\S]*var I18N = [\s\S]*function init\(\)[\s\S]*<\/script>/.test(page) &&
        /function init\([\s\S]*<\/script>\s*<script src="\/addon\/sdk\.js"><\/script>/.test(page),
      'the page script is inside a <script> tag after qrcode.js (a build without it leaves the list and the choices empty on the TV)'
    );
  }
  {
    const mgr = ['manager/src/js/menu.js', 'manager/src/js/status.js', 'manager/src/js/share.js', 'manager/src/index.html']
      .map(f => fs.readFileSync(path.join(root, f), 'utf8'))
      .join('\n');
    ok(
      !/phoneremote|\/api\/phoneremote|openPhoneRemote/.test(mgr) && !fs.existsSync(path.join(root, 'manager', 'src', 'js', 'remote.js')),
      'the manager has no phone remote screens: the add-on brings its own page (Add-ons > its entry)'
    );
  }
});
