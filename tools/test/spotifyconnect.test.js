// Spotify Connect devices on the network (spotifyconnect.js): reading the answer of a device to the mDNS question, which addresses are
// asked, and the sealed token of addUser (a device-side stand-in opens it with the key it shares with the service).
const crypto = require('crypto');
const { ok, run } = require('./lib');
const sc = require('../../helper/spotifyconnect');

function name(s) {
  const out = [];
  s.split('.').forEach(p => out.push(Buffer.from([p.length]), Buffer.from(p)));
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}
function rr(type, data) {
  const h = Buffer.alloc(10);
  h.writeUInt16BE(type, 0);
  h.writeUInt16BE(1, 2);
  h.writeUInt16BE(data.length, 8);
  return Buffer.concat([name('Kitchen speaker._spotify-connect._tcp.local'), h, data]);
}

run(async () => {
  ok(
    sc.isLan('10.1.2.3') && sc.isLan('192.168.0.9') && sc.isLan('172.20.0.1') && sc.isLan('169.254.1.1'),
    'private and link-local addresses are asked'
  );
  ok(
    !sc.isLan('8.8.8.8') && !sc.isLan('172.32.0.1') && !sc.isLan('example.com') && !sc.isLan('') && !sc.isLan(undefined),
    'others are not'
  );

  const ptr = rr(12, name('Kitchen speaker._spotify-connect._tcp.local'));
  const srv = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x20, 0x08]), name('host.local')]);
  const txtOk = Buffer.concat([Buffer.from([9]), Buffer.from('CPath=/zc')]);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(3, 6);
  const msg = Buffer.concat([head, ptr, rr(33, srv), rr(16, txtOk)]);
  const d = sc.parse(msg, '10.0.0.9');
  ok(
    d && d.host === '10.0.0.9' && d.port === 8200 && d.path === '/zc' && /^Kitchen speaker\._spotify-connect/.test(d.instance),
    'the answer of a device gives its address, port and the path of its web server'
  );
  const bad = Buffer.concat([head, ptr, rr(33, srv), rr(16, Buffer.concat([Buffer.from([20]), Buffer.from('CPath=/zc?x=1&y=2 ../..')]))]);
  ok(sc.parse(bad, '10.0.0.9') === null, 'a path with odd characters is refused');
  ok(sc.parse(Buffer.from([1, 2, 3]), '10.0.0.9') === null, 'a broken message gives nothing');

  // the device: it has a key pair in the same group, and opens the blob like a Spotify Connect device does
  const dev = crypto.createDiffieHellman(sc.PRIME, Buffer.from([2]));
  dev.generateKeys();
  const sealed = sc.seal(dev.getPublicKey().toString('base64'), 'THE-ACCESS-TOKEN');
  const secret = dev.computeSecret(Buffer.from(sealed.clientKey, 'base64'));
  const base = crypto.createHash('sha1').update(secret).digest();
  const ck = crypto.createHmac('sha1', base).update('checksum').digest();
  const ek = crypto.createHmac('sha1', base).update('encryption').digest().slice(0, 16);
  const raw = Buffer.from(sealed.blob, 'base64');
  const iv = raw.slice(0, 16),
    enc = raw.slice(16, raw.length - 20),
    mac = raw.slice(raw.length - 20);
  const d2 = crypto.createDecipheriv('aes-128-ctr', ek, iv);
  ok(
    crypto.createHmac('sha1', ck).update(enc).digest().equals(mac) &&
      Buffer.concat([d2.update(enc), d2.final()]).toString() === 'THE-ACCESS-TOKEN',
    'the device opens the blob with the key it shares with the service: its checksum fits and the token comes out'
  );
  ok(
    !sealed.blob.includes('THE-ACCESS-TOKEN') && sealed.blob !== sc.seal(dev.getPublicKey().toString('base64'), 'THE-ACCESS-TOKEN').blob,
    'the token is not in the clear, and every blob is new'
  );

  ok(
    sc.seal('', 'x') === null && sc.seal('!!!', 'x') === null && sc.seal(Buffer.alloc(200, 1).toString('base64'), 'x') === null,
    'a key that is not one is no blob, not an exception'
  );
  ok(
    (await sc.wake({ host: '8.8.8.8', port: 80, path: '/zc' }, 'u', 't', 'id')) === false,
    'a device outside the local network is not woken'
  );
  ok((await sc.info({ host: '8.8.8.8', port: 80, path: '/zc' })) === null, 'a device outside the local network is not asked');
});
