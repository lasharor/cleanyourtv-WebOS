// The ADB client (adbclient.js): the public key in the form Android wants (against a known answer), the packets, and a command run on a
// stand-in device, with the ways the sign-in can go: key already allowed, key not known yet (the box asks), question not answered,
// no sign-in at all, a refused command, a box that is not there.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  net = require('net');
const { ok, tmp, run } = require('./lib');
const { device, KEY, KEY_ENCODED } = require('./adbdevice');

run(async () => {
  const adb = require(path.join(__dirname, '..', '..', 'helper', 'addons-bundled', 'androidbox', 'adbclient.js'));
  const key = adb.parseKey(KEY);

  // ---- the key ----
  ok(key.e === 65537 && key.n.length === 256, 'a PKCS#8 key gives its modulus (256 bytes) and exponent');
  const t0 = Date.now();
  const enc = adb.encodePublicKey(key, 'tv');
  ok(enc.indexOf(KEY_ENCODED) === 0 && / tv$/.test(enc), 'the public key is encoded exactly as a known-good implementation does');
  ok(Date.now() - t0 < 2000, 'and without a big-number library, in ' + (Date.now() - t0) + ' ms');
  ok(Buffer.from(enc.split(' ')[0], 'base64').length === 524, 'the encoded key is 524 bytes');
  if (typeof crypto.createPrivateKey === 'function') {
    const p1 = crypto.createPrivateKey(KEY).export({ type: 'pkcs1', format: 'pem' });
    const k1 = adb.parseKey(p1);
    ok(k1.n.equals(key.n) && k1.e === key.e, 'a PKCS#1 key (BEGIN RSA PRIVATE KEY) gives the same numbers');
  }
  let bad = '';
  try {
    adb.parseKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----');
  } catch (e) {
    bad = e.message;
  }
  ok(bad !== '', 'something that is not a key is refused: ' + bad);

  // ---- the signature: the token is signed as an already hashed SHA-1 value ----
  const token = crypto.randomBytes(20);
  const sig = adb.sign(key, token);
  const plain = crypto.publicDecrypt({ key: KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, sig);
  ok(sig.length === 256 && plain.equals(Buffer.concat([adb.SHA1_PREFIX, token])), 'the signature opens to the SHA-1 prefix and the token');

  // ---- packets ----
  const pk = adb.packet('OPEN', 1, 0, Buffer.from('shell:id\0'));
  ok(
    pk.length === 24 + 9 && pk.toString('ascii', 0, 4) === 'OPEN' && pk.readUInt32LE(12) === 9,
    'a packet has a 24-byte header and its data'
  );
  ok(pk.readUInt32LE(16) === Buffer.from('shell:id\0').reduce((a, b) => a + b, 0), 'the header holds the sum of the data');
  ok((pk.readUInt32LE(0) ^ 0xffffffff) >>> 0 === pk.readUInt32LE(20), 'the last field is the command xor 0xffffffff');
  const got = [];
  const feed = adb.reader(p => got.push(p));
  feed(pk.slice(0, 10));
  feed(Buffer.concat([pk.slice(10), adb.packet('CLSE', 2, 3)]));
  ok(
    got.length === 2 && got[0].cmd === 'OPEN' && got[0].data.toString() === 'shell:id\0' && got[1].cmd === 'CLSE' && got[1].a0 === 2,
    'packets are put together from pieces'
  );
  let thrown = false;
  try {
    adb.reader(() => {})(Buffer.alloc(24, 7));
  } catch (_) {
    thrown = true;
  }
  ok(thrown, 'bytes that are not ADB are refused');

  // ---- the key file ----
  const file = path.join(tmp, 'keys', 'adbkey');
  if (typeof crypto.generateKeyPairSync === 'function') {
    const made = await adb.ensureKey(file);
    ok(
      made.n.length === 256 && fs.existsSync(file) && (fs.statSync(file).mode & 0o077) === 0,
      'a missing key is made, readable by its owner only'
    );
    const again = await adb.ensureKey(file);
    ok(again.n.equals(made.n) && adb.keyExists(file), 'and used again the next time');
    fs.writeFileSync(file, 'rubbish');
    let msg = '';
    try {
      await adb.ensureKey(file);
    } catch (e) {
      msg = e.message;
    }
    ok(/cannot be used/.test(msg) && adb.keyExists(file) === false, 'a damaged key is reported, not replaced: ' + msg);
  }

  // ---- running a command ----
  let d = await device({ trusted: KEY, reply: c => 'ran: ' + c + '\n' });
  let r = await adb.run({ host: '127.0.0.1', port: d.port, command: 'echo hi; echo ho', key });
  ok(
    r.ok && r.out === 'ran: echo hi; echo ho' && d.seen.commands[0] === 'echo hi; echo ho',
    'a key the box allows: the command runs and its output comes back'
  );
  ok(d.seen.good === 1 && d.seen.keys.length === 0, 'the box accepted the signature, so no question was asked');
  d.close();

  d = await device({ auth: false, reply: () => 'no sign-in' });
  r = await adb.run({ host: '127.0.0.1', port: d.port, command: 'x', key });
  ok(r.ok && r.out === 'no sign-in', 'a box without sign-in works');
  d.close();

  d = await device({ trusted: '', prompt: 'accept', reply: () => 'welcome' });
  r = await adb.run({ host: '127.0.0.1', port: d.port, command: 'x', key });
  ok(
    r.ok && r.out === 'welcome' && d.seen.keys.length === 1,
    'an unknown key: the public key is offered and, once allowed, the command runs'
  );
  ok(d.seen.keys[0].indexOf(KEY_ENCODED) === 0 && /\0$/.test(d.seen.keys[0]), 'the offered key is the encoded one, ended with a zero byte');
  d.close();

  d = await device({ trusted: '', prompt: 'deny' });
  r = await adb.run({ host: '127.0.0.1', port: d.port, command: 'x', key, authMs: 300 });
  ok(!r.ok && r.step === 'authorize' && /accept the question/.test(r.error), 'the question is not answered: ' + r.error);
  d.close();

  d = await device({ auth: false, reply: () => '' });
  r = await adb.run({ host: '127.0.0.1', port: d.port, command: 'input keyevent KEYCODE_WAKEUP', key });
  ok(r.ok && r.out === '' && d.seen.commands.length === 1, 'a command without output is fine');
  d.close();

  d = await device({ auth: false, refuse: true });
  r = await adb.run({ host: '127.0.0.1', port: d.port, command: 'x', key });
  ok(!r.ok && r.step === 'shell' && /refused/.test(r.error), 'a refused command is reported: ' + r.error);
  d.close();

  // nothing listens: take a free port and close it
  const free = await new Promise(res => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  r = await adb.run({ host: '127.0.0.1', port: free, command: 'x', key });
  ok(!r.ok && r.step === 'connect' && /refused/.test(r.error), 'a box that is not there: ' + r.error);

  // something that answers but is not ADB
  const junk = await new Promise(res => {
    const s = net.createServer(c => c.write(Buffer.alloc(64, 1))).listen(0, '127.0.0.1', () => res(s));
  });
  r = await adb.run({ host: '127.0.0.1', port: junk.address().port, command: 'x', key });
  ok(!r.ok && /not an ADB answer/.test(r.error), 'a port that is not ADB is reported: ' + r.error);
  junk.close();
});
