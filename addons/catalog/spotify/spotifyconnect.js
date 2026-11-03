'use strict';
// Spotify Connect devices on the local network that Spotify's own device list does not show (a speaker or a TV that has been idle is
// not registered with Spotify until someone wakes it). The Spotify apps find them with mDNS and wake them with their own small web
// server ("zeroconf"): getInfo tells the device id, addUser hands the device the account's access token, encrypted for that device.
// Node 8 compatible; nothing here is written to disk and no token is logged.
const dgram = require('dgram');
const http = require('http');
const crypto = require('crypto');
const qs = require('querystring');

// the 768-bit Diffie-Hellman group of the Spotify Connect zeroconf protocol (generator 2)
const PRIME = Buffer.from(
  'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a63a3620ffffffffffffffff',
  'hex'
);
const SERVICE = '_spotify-connect._tcp.local';

// only devices on the local network are asked: a private or link-local IPv4 address
function isLan(ip) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(ip || ''));
  if (!m) return false;
  const a = +m[1],
    b = +m[2];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function question(q) {
  const out = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  q.split('.').forEach(p => {
    out.push(p.length);
    for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i));
  });
  out.push(0, 0, 12, 0, 1);
  return Buffer.from(out);
}

// a name in a DNS message, with its compression pointers
function readName(buf, off) {
  const out = [];
  let end = -1;
  for (let n = 0; n < 40 && off < buf.length; n++) {
    const l = buf[off];
    if (l === 0) {
      off++;
      break;
    }
    if ((l & 0xc0) === 0xc0) {
      if (end < 0) end = off + 2;
      off = ((l & 0x3f) << 8) | buf[off + 1];
      continue;
    }
    out.push(buf.toString('utf8', off + 1, off + 1 + l));
    off += 1 + l;
  }
  return { name: out.join('.'), next: end < 0 ? off : end };
}

// the answer of one device: its instance name, port and the path of its web server
function parse(buf, from) {
  const d = { host: from };
  try {
    let off = 12;
    for (let i = buf.readUInt16BE(4); i > 0; i--) off = readName(buf, off).next + 4;
    const rr = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    for (let i = 0; i < rr; i++) {
      off = readName(buf, off).next;
      const type = buf.readUInt16BE(off),
        len = buf.readUInt16BE(off + 8),
        at = off + 10;
      if (type === 12) d.instance = readName(buf, at).name;
      if (type === 33) d.port = buf.readUInt16BE(at + 4);
      if (type === 16) {
        for (let p = at; p < at + len; ) {
          const l = buf[p],
            kv = buf.toString('utf8', p + 1, p + 1 + l);
          if (/^CPath=/.test(kv)) d.path = kv.slice(6);
          p += 1 + l;
        }
      }
      off = at + len;
    }
  } catch (_) {
    return null;
  }
  return d.instance && d.port && /^\/[A-Za-z0-9/_.-]{0,60}$/.test(d.path || '') ? d : null;
}

// who answers on the network within `wait` ms: [{host, port, path}]
function discover(wait) {
  return new Promise(resolve => {
    const found = {};
    let sock;
    const done = () => {
      try {
        sock.close();
      } catch (_) {}
      resolve(Object.keys(found).map(k => found[k]));
    };
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (_) {
      return resolve([]);
    }
    sock.on('error', done);
    sock.on('message', (m, r) => {
      const d = isLan(r.address) ? parse(m, r.address) : null;
      if (d && d.instance.indexOf(SERVICE) > 0) found[d.host + ':' + d.port] = d;
    });
    sock.bind(0, () => {
      const q = question(SERVICE);
      const ask = () => {
        try {
          sock.send(q, 0, q.length, 5353, '224.0.0.251');
        } catch (_) {}
      };
      ask();
      setTimeout(ask, Math.floor(wait / 2));
      setTimeout(done, wait);
    });
  });
}

function request(d, method, query, form) {
  return new Promise(resolve => {
    const body = form ? qs.stringify(form) : '';
    const headers = form ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {};
    const rq = http.request({ host: d.host, port: d.port, path: d.path + (query || ''), method, headers, agent: false }, res => {
      const chunks = [];
      let n = 0;
      res.on('data', c => {
        n += c.length;
        if (n < 16384) chunks.push(c);
      });
      res.on('end', () => {
        let j = null;
        try {
          j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (_) {}
        resolve(j);
      });
      res.on('aborted', () => resolve(null));
    });
    rq.on('error', () => resolve(null));
    rq.setTimeout(4000, () => {
      rq.abort();
      resolve(null);
    });
    rq.end(body);
  });
}

// what the device says about itself: {id, name, type}, or null
async function info(d) {
  if (!isLan(d.host)) return null;
  const j = await request(d, 'GET', '?action=getInfo');
  if (!j || typeof j.deviceID !== 'string' || !/^[0-9A-Za-z._:-]{10,80}$/.test(j.deviceID)) return null;
  const alias = Array.isArray(j.aliases) && j.aliases[0] && j.aliases[0].name;
  const name = String(j.remoteName || alias || String(d.instance).split('.')[0]).slice(0, 60);
  const type = {
    SPEAKER: 'Speaker',
    AUDIO_DONGLE: 'AudioDongle',
    AVR: 'AVR',
    TV: 'TV',
    STB: 'STB',
    COMPUTER: 'Computer',
    SMARTPHONE: 'Smartphone',
  }[String(j.deviceType || '')];
  return { id: j.deviceID, name, type: type || 'Speaker', key: j.publicKey, token: j.tokenType };
}

// the two keys of the blob from the shared secret, as the discovery of librespot (discovery/src/server.rs) derives them on the device's
// side: the HMAC key is the FIRST 16 BYTES of the SHA-1 of the secret (not all 20), the checksum key is HMAC(that, "checksum") and the
// AES key the first 16 bytes of HMAC(that, "encryption")
function keys(secret) {
  const base = crypto.createHash('sha1').update(secret).digest().slice(0, 16);
  return {
    ck: crypto.createHmac('sha1', base).update('checksum').digest(),
    ek: crypto.createHmac('sha1', base).update('encryption').digest().slice(0, 16),
  };
}

// the blob of addUser: the token, encrypted with the key both sides get from the Diffie-Hellman exchange; null when the device's
// key is not one (empty, too short, not base64)
function seal(devKey, token, rnd) {
  const dev = Buffer.from(String(devKey || ''), 'base64');
  if (dev.length < 1 || dev.length > PRIME.length) return null;
  const dh = crypto.createDiffieHellman(PRIME, Buffer.from([2]));
  dh.generateKeys();
  let secret;
  try {
    secret = dh.computeSecret(dev);
  } catch (_) {
    return null;
  }
  const { ck, ek } = keys(secret);
  const iv = rnd || crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-128-ctr', ek, iv);
  const enc = Buffer.concat([c.update(Buffer.from(String(token))), c.final()]);
  const mac = crypto.createHmac('sha1', ck).update(enc).digest();
  return { blob: Buffer.concat([iv, enc, mac]).toString('base64'), clientKey: dh.getPublicKey().toString('base64') };
}

// log the account in on the device, so that it registers with Spotify and shows in its device list. The device that answers now must
// be the one that was listed (same id): the token is not handed to another one.
async function wake(d, user, token, id) {
  const i = await info(d);
  if (!i || i.id !== id || !i.key || i.token !== 'accesstoken') return false;
  const s = seal(i.key, token);
  if (!s) return false;
  const j = await request(d, 'POST', '', {
    action: 'addUser',
    userName: user,
    blob: s.blob,
    clientKey: s.clientKey,
    tokenType: 'accesstoken',
    deviceId: i.id,
    deviceName: i.name,
  });
  return !!j && j.status === 101;
}

module.exports = { discover, info, wake, seal, keys, parse, isLan, PRIME };
