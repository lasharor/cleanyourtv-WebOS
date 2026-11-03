// The WebSocket (ws.js): the handshake of RFC 6455, masked frames, fragments, ping/pong, size limit, close, and the client talking to the server.
const http = require('http'),
  net = require('net');
const { ok, run, sleep } = require('./lib');
const ws = require('../../helper/addons-bundled/phoneremote/ws');

// a masked client frame, built by hand
function frame(op, payload, opts) {
  const o = opts || {};
  const p = Buffer.from(payload);
  const key = Buffer.from([1, 2, 3, 4]);
  const head =
    p.length < 126
      ? Buffer.from([(o.nofin ? 0 : 0x80) | op, (o.unmasked ? 0 : 0x80) | p.length])
      : Buffer.from([(o.nofin ? 0 : 0x80) | op, 0x80 | 126, p.length >> 8, p.length & 255]);
  const body = Buffer.from(p);
  if (!o.unmasked) for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
  return Buffer.concat([head, o.unmasked ? Buffer.alloc(0) : key, body]);
}

run(async () => {
  ok(ws.accept('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=', 'the accept key is the one of the RFC example');

  const got = [];
  let server = null;
  const srv = http.createServer((q, r) => r.end());
  srv.on('upgrade', (q, socket, head) => {
    const c = ws.upgrade(q, socket, head, { maxBytes: 200, origin: o => !o || o === 'http://ok' });
    if (!c) return;
    server = c;
    c.on('message', m => {
      got.push(m);
      c.send('echo:' + m);
    });
    c.on('close', code => got.push('closed ' + code));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'ws://127.0.0.1:' + srv.address().port + '/x';

  // ---- the client against the server ----
  const c = await ws.connect(base);
  const echoes = [];
  c.on('message', m => echoes.push(m));
  c.send('hello');
  c.send('x'.repeat(150)); // longer than 125: a 16-bit length
  await sleep(100);
  ok(got[0] === 'hello' && got[1].length === 150, 'a client and a server exchange text, also with a 16-bit length');
  ok(echoes[0] === 'echo:hello' && echoes[1].length === 155, 'the server answers unmasked frames the client reads');
  let pong = 0;
  c.on('pong', () => pong++);
  c.ping();
  await sleep(50);
  ok(pong === 1, 'a ping is answered with a pong');
  c.send('é€😀');
  await sleep(50);
  ok(got.indexOf('é€😀') >= 0, 'UTF-8 text survives');
  // too long: the server closes with 1009
  c.send('y'.repeat(300));
  await sleep(150);
  ok(got.indexOf('closed 1009') >= 0 && c.closed, 'a message over the limit closes the connection (1009)');

  // ---- raw frames ----
  const raw = (frames, origin) =>
    new Promise(resolve => {
      const s = net.connect(srv.address().port, '127.0.0.1');
      let buf = Buffer.alloc(0);
      s.on('connect', () =>
        s.write(
          'GET /x HTTP/1.1\r\nHost: t\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            (origin ? 'Origin: ' + origin + '\r\n' : '') +
            '\r\n'
        )
      );
      s.on('data', d => {
        buf = Buffer.concat([buf, d]);
        if (!s.sent && buf.indexOf('\r\n\r\n') >= 0 && /^HTTP\/1.1 101/.test(buf.toString())) {
          s.sent = true;
          frames.forEach(f => s.write(f));
        }
      });
      setTimeout(() => {
        s.destroy();
        resolve(buf.toString('latin1'));
      }, 250);
    });
  got.length = 0;
  let out = await raw([frame(1, 'frag', { nofin: true }), frame(0, 'ment')]);
  ok(/Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/.test(out) && got[0] === 'fragment', 'a message in two fragments arrives whole');
  got.length = 0;
  out = await raw([frame(1, 'plain', { unmasked: true })]);
  ok(got.indexOf('plain') < 0 && got.indexOf('closed 1002') >= 0, 'an unmasked frame from a client is refused (1002)');
  got.length = 0;
  out = await raw([frame(9, 'abc'), frame(1, 'after ping')]);
  ok(
    out.indexOf(Buffer.from([0x8a, 3]).toString('latin1') + 'abc') >= 0 && got[0] === 'after ping',
    'the server answers a ping with the same bytes'
  );
  got.length = 0;
  out = await raw([frame(8, Buffer.from([0x03, 0xe8]))]);
  ok(
    out.indexOf(Buffer.from([0x88, 2, 3, 0xe8]).toString('latin1')) >= 0 && got.indexOf('closed 1000') >= 0,
    'a close frame is answered and the connection ends'
  );
  out = await raw([], 'http://evil');
  ok(/^HTTP\/1.1 403/.test(out), 'a page from another origin is refused');
  out = await raw([], 'http://ok');
  ok(/^HTTP\/1.1 101/.test(out), 'the allowed origin is accepted');

  // a request that is not a WebSocket one
  const code = await new Promise(resolve => {
    const s = net.connect(srv.address().port, '127.0.0.1');
    let b = '';
    s.on('connect', () => s.write('GET /x HTTP/1.1\r\nHost: t\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'));
    s.on('data', d => (b += d));
    setTimeout(() => {
      s.destroy();
      resolve(b);
    }, 150);
  });
  ok(/^HTTP\/1.1 400/.test(code), 'a handshake without a key is a 400');

  // a server that does not upgrade
  const plain = http.createServer((q, r) => r.end('no'));
  await new Promise(r => plain.listen(0, '127.0.0.1', r));
  let err = '';
  await ws.connect('ws://127.0.0.1:' + plain.address().port + '/').catch(e => (err = e.message));
  ok(/refused with 200/.test(err), 'the client reports a server that does not upgrade');
  err = '';
  await ws.connect('ws://127.0.0.1:1/').catch(e => (err = e.message));
  ok(err !== '', 'the client reports a server that is not there');
  err = '';
  await ws.connect('ftp://x').catch(e => (err = e.message));
  ok(err === 'bad address', 'the client refuses other addresses');
  plain.close();
  srv.close();
  if (server) server.terminate();
});
