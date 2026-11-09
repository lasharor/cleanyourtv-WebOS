// fetch.js, the service's one HTTP client: everything a download can do wrong on a TV ends with an answer or an error, never a hang.
const fs = require('fs'),
  path = require('path'),
  zlib = require('zlib'),
  crypto = require('crypto');
const { tmp, ok, serve, req, run } = require('./lib');
const fetch = req('fetch');

run(async () => {
  const text = 'line one\nline two\n'.repeat(50);
  const s = await serve((q, r) => {
    const u = q.url;
    if (u === '/plain') return r.end(text);
    if (u === '/go') {
      r.writeHead(302, { location: '/plain' });
      return r.end();
    }
    if (u === '/loop') {
      r.writeHead(302, { location: '/loop' });
      return r.end();
    }
    if (u === '/gz-header') {
      r.writeHead(200, { 'content-encoding': 'gzip' });
      return r.end(zlib.gzipSync(text));
    }
    if (u === '/file.gz') {
      r.writeHead(200, { 'content-type': 'application/gzip' });
      return r.end(zlib.gzipSync(text));
    }
    if (u === '/empty') return r.end();
    if (u === '/missing') {
      r.writeHead(404);
      return r.end('no');
    }
    if (u === '/big') return r.end(Buffer.alloc(5000, 65));
    if (u === '/drop') {
      r.writeHead(200, { 'content-length': '100000' });
      r.write('partial');
      return setTimeout(() => r.socket.destroy(), 100);
    }
    if (u === '/silent') return; // never answers
    if (u === '/echo') {
      let b = '';
      q.on('data', c => (b += c));
      return q.on('end', () => r.end(JSON.stringify({ method: q.method, type: q.headers['content-type'], body: b })));
    }
    r.writeHead(500);
    r.end();
  });
  const u = s.url;
  const t0 = Date.now();

  let r = await fetch.read(u + '/plain');
  ok(r.status === 200 && r.body.toString() === text, 'reads a body');
  r = await fetch.read(u + '/go');
  ok(r.body.toString() === text && /\/plain$/.test(r.url), 'follows a redirect');
  const err = p =>
    p.then(
      () => null,
      e => e
    );
  let e = await err(fetch.read(u + '/loop'));
  ok(e && e.code === 'redirects', 'stops after too many redirects');
  e = await err(fetch.read(u + '/missing'));
  ok(e && e.code === 'status' && e.status === 404 && e.message === 'HTTP 404', 'a status other than 200 is an error with the status');
  e = await err(fetch.read(u + '/missing', { statusText: st => 'server answered ' + st }));
  ok(e && e.message === 'server answered 404', 'the message of a refused status can be chosen');
  r = await fetch.read(u + '/missing', { anyStatus: true });
  ok(r.status === 404 && r.body.toString() === 'no', 'anyStatus returns any status with its body');
  r = await fetch.read(u + '/gz-header');
  ok(r.body.toString() === text, 'a body the server says is gzip is unpacked');
  r = await fetch.read(u + '/file.gz');
  ok(r.body[0] === 0x1f, 'a .gz file is left as it is by default');
  r = await fetch.read(u + '/file.gz', { unzip: 'sniff' });
  ok(r.body.toString() === text, 'with unzip: sniff a gzip file is recognised by its first bytes');
  e = await err(fetch.read(u + '/big', { maxBytes: 1000 }));
  ok(e && e.code === 'big', 'a body over maxBytes is refused');
  e = await err(fetch.read(u + '/drop'));
  ok(e && e.code === 'lost', 'a connection that drops after the headers is an error (' + (e && e.message) + ')');
  e = await err(fetch.read(u + '/silent', { idleMs: 300 }));
  ok(e && e.code === 'timeout', 'a server that does not answer times out');
  e = await err(fetch.read(u + '/silent', { totalMs: 300, totalText: 'no answer from GitHub in time' }));
  ok(e && e.message === 'no answer from GitHub in time', 'an overall time limit with its own message');
  e = await err(fetch.read(u + '/plain', { allowHttp: false }));
  ok(e && e.code === 'http', 'plain http is refused where only https is allowed');
  e = await err(fetch.read('ftp://x/y'));
  ok(e && e.code === 'url', 'only http and https');
  e = await err(fetch.read('not an address'));
  ok(e && e.code === 'url', 'an address that is not one');
  e = await err(fetch.read(u + '/plain', { refuseLocal: true }));
  ok(e && e.code === 'local', 'refuseLocal refuses the TV itself');
  r = await fetch.read(u + '/echo', { body: { a: 1 } });
  const echo = JSON.parse(r.body.toString());
  ok(echo.method === 'POST' && echo.type === 'application/json' && echo.body === '{"a":1}', 'a body is POSTed as JSON');
  const f = path.join(tmp, 'f.txt');
  r = await fetch.toFile(u + '/plain', f);
  ok(
    fs.readFileSync(f, 'utf8') === text && r.sha256 === crypto.createHash('sha256').update(text).digest('hex'),
    'toFile writes the file and returns its SHA-256'
  );
  const st = await fetch.open(u + '/file.gz', { unzip: 'sniff' });
  const lines = await new Promise(res => {
    let b = '';
    st.on('data', c => (b += c));
    st.on('end', () => res(b.split('\n').length));
  });
  ok(lines === 101, 'open gives a stream of the unpacked body');
  r = await fetch.read(u + '/empty', { unzip: 'sniff', totalMs: 2000 });
  ok(r.body.length === 0, 'an empty body ends, also when its first bytes are looked at');
  // connectMs: a server that is off or an address nobody answers is known in that time, not after the whole idle time
  const t1 = Date.now();
  const ce = await fetch.read('http://192.0.2.1:9/', { connectMs: 300, idleMs: 20000, allowHttp: true }).then(
    () => null,
    e => e
  );
  ok(
    ce && (ce.code === 'connect' || /^E[A-Z]+$/.test(ce.code || '')) && Date.now() - t1 < 3000,
    'connectMs ends a connection that is not made (' + (ce && ce.code) + ')'
  );
  ok(Date.now() - t0 < 12000, 'all of this ends quickly');
  s.server.close();
});
