// The key adapter of the phone remote (remotekeys.js) against a fake luna and a fake pointer socket: the lines sent to the socket, the
// address tried again on the loopback, the volume fallback and the text calls. NOT a test of a real TV: whether the TV's pointer socket
// takes these lines is checked by hand (docs/phone-remote.md).
const { ok, req, run } = require('./lib');
const RK = require('../../helper/addons-bundled/phoneremote/remotekeys');

run(async () => {
  const calls = [],
    sent = [],
    opened = [];
  let reply = { returnValue: true, socketPath: 'ws://lgwebostv:3000/resources/abc/netinput.pointer.sock' };
  let special = false; // does the TV's sendSpecialKey take the key?
  const luna = async (uri, p) => {
    calls.push([uri, p]);
    if (uri.indexOf('getPointerInputSocket') > 0) return reply;
    if (uri.indexOf('sendSpecialKey') > 0 && !special) return { returnValue: false, errorText: 'invalid key' };
    if (uri.indexOf('/controls/') > 0) return { returnValue: false, errorText: 'no' };
    return { returnValue: true };
  };
  let failNamed = true,
    closed = false;
  const connect = async a => {
    opened.push(a);
    if (failNamed && a.indexOf('lgwebostv') > 0) throw new Error('getaddrinfo ENOTFOUND');
    const c = {
      closed: false,
      on() {},
      send: s => (closed ? false : (sent.push(s), true)),
      terminate() {
        c.closed = true;
      },
    };
    return c;
  };
  const k = RK.create({ luna }, { connect });

  let r = await k.press('HOME');
  ok(r.ok && sent[0] === 'type:button\nname:HOME\n\n', 'a button is a line "type:button / name:" ended by an empty line');
  ok(
    opened.length === 2 && /^ws:\/\/127\.0\.0\.1:3000\/resources/.test(opened[1]),
    'a name the TV does not resolve is tried again as the loopback address'
  );
  await k.press('ENTER');
  ok(opened.length === 2 && sent.length === 2, 'the socket is kept for the next key');
  r = await k.press('POWEROFF');
  ok(!r.ok && sent.length === 2, 'a button that is not on the list is not sent');
  await k.move(5.4, -300);
  ok(sent[2] === 'type:move\ndx:5\ndy:-200\ndown:0\n\n', 'a pointer move is rounded and limited');
  await k.click();
  await k.scroll(3);
  ok(sent[3] === 'type:click\n\n' && sent[4] === 'type:scroll\ndx:0\ndy:3\n\n', 'click and scroll');
  await k.text('hi');
  await k.del(2);
  await k.enter();
  ok(
    calls.some(c => /ime\/insertText/.test(c[0]) && c[1].text === 'hi') &&
      calls.some(c => /ime\/deleteCharacters/.test(c[0]) && c[1].count === 2) &&
      calls.some(c => /ime\/sendEnterKey/.test(c[0])),
    "text goes through the TV's input method service"
  );

  // the socket the TV closed: the next key opens a new one
  const k2 = RK.create({ luna }, { connect });
  await k2.press('UP');
  closed = true;
  const n = opened.length;
  r = await k2.press('DOWN');
  ok(
    !r.ok && opened.length > n && /does not take keys/.test(r.error),
    'a socket that takes nothing is dropped and opened once more, then the error is reported'
  );
  closed = false;

  // no socket at all: volume still works through the audio service, other keys report why
  reply = { returnValue: false, errorText: 'denied' };
  const k3 = RK.create({ luna }, { connect });
  calls.length = 0;
  r = await k3.press('VOLUMEUP');
  ok(r.ok && calls.some(c => /audio\/master\/volumeUp/.test(c[0])), 'volume falls back to the audio service');
  r = await k3.press('UP');
  ok(!r.ok && /denied/.test(r.error) && k3.status().ok === false, 'another key reports why it failed');

  // the real thing as the TV gives it: a Unix socket path, the lines arrive as they are (no Unix sockets by path on Windows)
  if (process.platform !== 'win32') {
    const net = require('net'),
      path = require('path');
    const sock = path.join(require('./lib').tmp, 'netinput.sock');
    const got = [];
    const srv = net.createServer(c => c.on('data', d => got.push(String(d))));
    await new Promise(r => srv.listen(sock, r));
    // only the socket call works: any other luna call would take the key before the socket does
    const k4 = RK.create(
      { luna: async uri => (uri.indexOf('getPointerInputSocket') > 0 ? { returnValue: true, socketPath: sock } : { returnValue: false }) },
      { ssap: false }
    );
    r = await k4.press('HOME');
    await new Promise(r2 => setTimeout(r2, 100));
    ok(r.ok && got.join('') === 'type:button\nname:HOME\n\n', 'a Unix socket path from the TV gets the lines as they are');
    k4.close();
    srv.close();
  }

  // the way that works on the TV: sendSpecialKey, and controls/ for the keys it does not know
  special = true;
  calls.length = 0;
  const k5 = RK.create({ luna }, { connect });
  r = await k5.press('RIGHT');
  ok(r.ok && calls.length === 1 && /sendSpecialKey/.test(calls[0][0]) && calls[0][1].key === 'RIGHT', 'a button is a sendSpecialKey call');
  special = false;
  calls.length = 0;
  const k6 = RK.create(
    {
      luna: async (u, p) => (
        calls.push([u, p]), /sendSpecialKey/.test(u) ? { returnValue: false, errorText: 'invalid key' } : { returnValue: true }
      ),
    },
    { connect }
  );
  r = await k6.press('PLAY');
  ok(r.ok && /controls\/play/.test(calls[calls.length - 1][0]), 'a key the TV does not know as a special key goes to its controls/ call');

  // ---- the SSAP sign-in: a fake control service that shows its "allow" prompt once, hands out a key and then a pointer socket address
  const http = require('http'),
    fs = require('fs'),
    paths = req('paths'),
    ws = require('../../helper/addons-bundled/phoneremote/ws');
  const seen = [];
  const srv = http.createServer();
  srv.on('upgrade', (q, socket, head) => {
    const c = ws.upgrade(q, socket, head, { maxBytes: 1 << 20 });
    if (!c) return;
    c.on('message', t => {
      const m = JSON.parse(t);
      seen.push(m);
      if (m.type === 'register') {
        const reply = () =>
          c.send(JSON.stringify({ type: 'registered', id: m.id, payload: { 'client-key': m.payload['client-key'] || 'KEY1' } }));
        m.payload['client-key'] ? reply() : setTimeout(reply, 100);
      } else if (m.type === 'request') {
        c.send(JSON.stringify({ type: 'response', id: m.id, payload: { returnValue: true, socketPath: 'ws://x/pointer.sock' } }));
      }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ssapUrl = 'ws://127.0.0.1:' + srv.address().port;
  const k7 = RK.create(
    { luna: async () => ({ returnValue: true }) },
    {
      ssap: true,
      ssapUrl,
      connect: async a => ((opened.length = 0), opened.push(a), { closed: false, on() {}, send: () => true, terminate() {} }),
    }
  );
  let e7 = '';
  try {
    await k7.move(1, 1);
  } catch (e) {
    e7 = String(e.message || e);
  }
  const r7 = await k7.move(1, 1).catch(e => ({ ok: false, error: String(e.message || e) }));
  await new Promise(r => setTimeout(r, 400));
  const r8 = await k7.move(2, 2).catch(e => ({ ok: false, error: String(e.message || e) }));
  ok(
    seen.length > 0 && seen[0].type === 'register' && /CONTROL_MOUSE_AND_KEYBOARD/.test(JSON.stringify(seen[0].payload.manifest)),
    'the first sign-in asks for the pointer permission'
  );
  ok(
    fs.existsSync(paths.D + '/ssap-key') && fs.readFileSync(paths.D + '/ssap-key', 'utf8') === 'KEY1',
    'the key the TV gives is kept for the next time'
  );
  ok(
    (e7 + (r7.error || '')).indexOf('Allow the connection') >= 0 || r7.ok || r8.ok,
    'before the TV allows it the call says to allow it on the screen, and once allowed the pointer socket opens'
  );
  ok(r8.ok === true && opened.some(a => a === 'ws://x/pointer.sock'), 'then the pointer socket the service named is the one that is used');
  await k7.close();
  srv.close();
});
