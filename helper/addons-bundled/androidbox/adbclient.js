// A small ADB client: connects to an Android device over the network (classic "network debugging", port 5555), signs in with an RSA key
// and runs one shell command. No adb program and no adb server are needed. It follows the public protocol description of Android's
// adb (system/core/adb: protocol.txt, auth.cpp, android_pubkey.cpp); the code is our own.
//   ensureKey(file)  the key the box has to allow (made on first use)  -> {pem, n, e}
//   run({host, port, command, key, ...})  -> {ok, step, error, out}   step: connect | authorize | shell
//   encodePublicKey(key)  the key in the form the box shows its "Allow?" question for
// Node 8 (webOS 5 and 6) has no BigInt and cannot make RSA keys itself: the two big numbers the box wants are worked out below with
// 32-bit words, and a key is made with Node's own generator where it exists, else with openssl, else it has to be copied to the TV.
const fs = require('fs'),
  net = require('net'),
  path = require('path'),
  crypto = require('crypto');
const exec = require('../../exec');

const VERSION = 0x01000000, // protocol version 1: every packet carries a checksum of its data
  MAXDATA = 4096,
  MAX_PACKET = 1 << 20;
const SHA1_PREFIX = Buffer.from('3021300906052b0e03021a05000414', 'hex'); // DigestInfo for SHA-1: the box sends the token already hashed
const WORDS = 64; // a 2048-bit modulus in 32-bit words
const TWO32 = 4294967296;

// ---- reading an RSA private key (PEM, PKCS#1 or PKCS#8) far enough to get the modulus and the exponent ----
function readDer(buf, pos) {
  const tag = buf[pos];
  let len = buf[pos + 1],
    at = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[at++];
  }
  if (at + len > buf.length) throw new Error('the key file is damaged');
  return { tag, start: at, end: at + len };
}
function derChildren(buf, node) {
  const out = [];
  for (let p = node.start; p < node.end; ) {
    const c = readDer(buf, p);
    out.push(c);
    p = c.end;
  }
  return out;
}
function parseKey(pem) {
  const m = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(String(pem));
  if (!m || /ENCRYPTED/.test(m[1])) throw new Error('not an unencrypted RSA private key');
  let der = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  let top = derChildren(der, readDer(der, 0));
  if (top.length >= 3 && top[1].tag === 0x30) {
    // PKCS#8: version, algorithm, then an OCTET STRING that holds the PKCS#1 key
    der = der.slice(top[2].start, top[2].end);
    top = derChildren(der, readDer(der, 0));
  }
  if (top.length < 3 || top[1].tag !== 0x02 || top[2].tag !== 0x02) throw new Error('not an RSA key');
  let n = der.slice(top[1].start, top[1].end);
  while (n.length && n[0] === 0) n = n.slice(1);
  const eb = der.slice(top[2].start, top[2].end);
  let e = 0;
  for (let i = 0; i < eb.length; i++) e = e * 256 + eb[i];
  if (n.length !== 256) throw new Error('the key must be 2048 bits');
  return { pem: String(pem), n, e };
}

// ---- the public key as Android wants it: {64, n0inv, n, R*R mod n, e} in little-endian words, base64 ----
function words(nBE) {
  const w = [];
  for (let i = 0; i < WORDS; i++) w.push(nBE.readUInt32BE(nBE.length - 4 * (i + 1)));
  return w;
}
function geq(a, b) {
  for (let i = WORDS - 1; i >= 0; i--) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
function minus(a, b) {
  let borrow = 0;
  for (let i = 0; i < WORDS; i++) {
    let d = a[i] - b[i] - borrow;
    borrow = d < 0 ? 1 : 0;
    if (d < 0) d += TWO32;
    a[i] = d;
  }
}
// 2^4096 mod n, by doubling 4096 times (every step stays below n)
function rrOf(n) {
  const x = [1];
  for (let i = 1; i < WORDS; i++) x.push(0);
  for (let step = 0; step < 2 * WORDS * 32; step++) {
    let carry = 0;
    for (let i = 0; i < WORDS; i++) {
      const v = x[i] * 2 + carry;
      carry = v >= TWO32 ? 1 : 0;
      x[i] = carry ? v - TWO32 : v;
    }
    if (carry || geq(x, n)) minus(x, n);
  }
  return x;
}
function encodePublicKey(key, name) {
  const n = words(key.n);
  const n0 = n[0];
  let inv = n0; // Newton's steps: every one doubles the number of right bits
  for (let i = 0; i < 5; i++) inv = Math.imul(inv, (2 - Math.imul(n0, inv)) | 0);
  const out = Buffer.alloc(4 + 4 + 4 * WORDS + 4 * WORDS + 4);
  out.writeUInt32LE(WORDS, 0);
  out.writeUInt32LE(-inv >>> 0, 4);
  const rr = rrOf(n);
  for (let i = 0; i < WORDS; i++) {
    out.writeUInt32LE(n[i], 8 + 4 * i);
    out.writeUInt32LE(rr[i], 8 + 4 * WORDS + 4 * i);
  }
  out.writeUInt32LE(key.e, 8 + 8 * WORDS);
  return out.toString('base64') + ' ' + (name || 'cleanyourtv@tv');
}
function sign(key, token) {
  return crypto.privateEncrypt({ key: key.pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.concat([SHA1_PREFIX, token]));
}

// ---- the key file ----
function pemFromGenerator() {
  if (typeof crypto.generateKeyPairSync !== 'function') return null; // Node before 10.12
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
}
async function ensureKey(file) {
  try {
    return parseKey(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('the key ' + file + ' cannot be used: ' + e.message);
  }
  let pem = pemFromGenerator();
  if (!pem) {
    const tmp = file + '.new';
    const r = await exec.run('openssl', ['genrsa', '-out', tmp, '2048'], { timeout: 120000 });
    if (r.ok && fs.existsSync(tmp)) {
      pem = fs.readFileSync(tmp, 'utf8');
      fs.unlinkSync(tmp);
    }
  }
  if (!pem) throw new Error('this TV cannot make the key: copy ~/.android/adbkey from a computer to ' + file);
  try {
    fs.mkdirSync(path.dirname(file));
  } catch (_) {}
  fs.writeFileSync(file, pem, { mode: 0o600 });
  return parseKey(pem);
}
const keyExists = file => {
  try {
    parseKey(fs.readFileSync(file, 'utf8'));
    return true;
  } catch (_) {
    return false;
  }
};

// ---- packets: 24 bytes (command, arg0, arg1, length of data, sum of the data, command xor 0xffffffff) and the data ----
function packet(cmd, a0, a1, data) {
  const d = data || Buffer.alloc(0);
  const h = Buffer.alloc(24);
  h.write(cmd, 0, 4, 'ascii');
  h.writeUInt32LE(a0 >>> 0, 4);
  h.writeUInt32LE(a1 >>> 0, 8);
  h.writeUInt32LE(d.length, 12);
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i];
  h.writeUInt32LE(sum >>> 0, 16);
  h.writeUInt32LE((h.readUInt32LE(0) ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, d]);
}
// packets from a stream of chunks; throws on something that is not ADB
function reader(onPacket) {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 24) {
      const len = buf.readUInt32LE(12);
      if ((buf.readUInt32LE(0) ^ 0xffffffff) >>> 0 !== buf.readUInt32LE(20) || len > MAX_PACKET) throw new Error('not an ADB answer');
      if (buf.length < 24 + len) return;
      const p = { cmd: buf.toString('ascii', 0, 4), a0: buf.readUInt32LE(4), a1: buf.readUInt32LE(8), data: buf.slice(24, 24 + len) };
      buf = buf.slice(24 + len);
      onPacket(p);
    }
  };
}

const NET_ERRORS = {
  ECONNREFUSED: 'the box refused the connection: is network debugging on?',
  ETIMEDOUT: 'no answer from the box',
  EHOSTUNREACH: 'the box cannot be reached',
  ENETUNREACH: 'the box cannot be reached',
  ECONNRESET: 'the box closed the connection',
};

// connect, sign in, run one shell command, resolve {ok, step, error, out}. Never rejects.
//   opts: host, port, command, key ({pem, n, e}); connectMs (5000), authMs (30000: time to answer the box's question), runMs (15000)
function run(opts) {
  return new Promise(resolve => {
    const key = opts.key;
    let done = false,
      step = 'connect',
      signed = false,
      keySent = false,
      remote = 0,
      timer = null;
    const out = [];
    const sock = new net.Socket();
    const finish = (ok, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ ok, step, error: error || '', out: Buffer.concat(out).toString('utf8').trim() });
    };
    const limit = (ms, what) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(false, what), ms);
    };
    const send = (cmd, a0, a1, data) => sock.write(packet(cmd, a0, a1, data));

    const onPacket = p => {
      if (p.cmd === 'AUTH' && p.a0 === 1) {
        step = 'authorize';
        if (!signed) {
          signed = true;
          send('AUTH', 2, 0, sign(key, p.data));
        } else if (!keySent) {
          keySent = true; // the box does not know this key yet: it asks its owner
          send('AUTH', 3, 0, Buffer.concat([Buffer.from(encodePublicKey(key), 'ascii'), Buffer.from([0])]));
          limit(opts.authMs || 30000, 'the box has not allowed this TV: accept the question on the box');
        } else finish(false, 'the box did not accept the key');
      } else if (p.cmd === 'CNXN') {
        step = 'shell';
        limit(opts.runMs || 15000, 'the box did not answer the command in time');
        send('OPEN', 1, 0, Buffer.from('shell:' + opts.command + '\0', 'utf8'));
      } else if (p.cmd === 'OKAY') remote = p.a0;
      else if (p.cmd === 'WRTE') {
        out.push(p.data);
        send('OKAY', 1, p.a0);
      } else if (p.cmd === 'CLSE') {
        if (!remote && !out.length) finish(false, 'the box refused the command');
        else {
          send('CLSE', 1, remote);
          finish(true);
        }
      }
    };
    const feed = reader(onPacket);
    sock.on('data', chunk => {
      try {
        feed(chunk);
      } catch (e) {
        finish(false, e.message);
      }
    });
    sock.on('error', /** @param {NodeJS.ErrnoException} e */ e => finish(false, NET_ERRORS[e.code || ''] || e.message));
    sock.on('close', () => {
      const got = step === 'shell' && out.length > 0; // some boxes close the connection without a CLSE once the output is sent
      finish(got, got ? '' : 'the box closed the connection');
    });
    limit(opts.connectMs || 5000, 'no answer from the box');
    sock.connect(opts.port, opts.host, () => {
      limit(opts.connectMs || 5000, 'the box did not answer');
      send('CNXN', VERSION, MAXDATA, Buffer.from('host::\0', 'ascii'));
    });
  });
}

module.exports = { ensureKey, keyExists, run, encodePublicKey, parseKey, packet, reader, sign, SHA1_PREFIX, VERSION };
