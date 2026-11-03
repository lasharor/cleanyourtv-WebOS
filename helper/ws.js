// A small WebSocket (RFC 6455), server and client side, for Node 8 (webOS 5 and 6), which has no WebSocket of its own and no ws package
// on the TV. Text and binary messages, fragments, ping/pong and close; a message larger than maxBytes closes the connection.
//   upgrade(req, socket, head, opts)  answers the HTTP Upgrade request of a browser; resolves a Conn, or null after refusing it
//   connect(address, opts)            opens ws:// or wss:// (the phone remote talks to the TV's own pointer socket this way)
// A Conn is an EventEmitter: 'message' (text), 'binary' (Buffer), 'close' (code), 'error'. send(text), ping(), close(code), terminate().
// The server side requires masked frames and the client side sends them, as the standard says.
const crypto = require('crypto'),
  http = require('http'),
  https = require('https'),
  { EventEmitter } = require('events');
const nc = require('./netcompat');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const accept = key =>
  crypto
    .createHash('sha1')
    .update(String(key) + GUID)
    .digest('base64');

class Conn extends EventEmitter {
  constructor(socket, client, maxBytes) {
    super();
    this.socket = socket;
    this.client = client; // true when we are the client: our frames are masked, the other side's are not
    this.max = maxBytes || 65536;
    this.buf = Buffer.alloc(0);
    this.frag = null; // a message in pieces: {op, parts, bytes}
    this.closed = false;
    this.sentClose = false;
    socket.setNoDelay(true);
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._end(1006));
    socket.on('error', e => {
      if (this.listenerCount('error')) this.emit('error', e);
      this._end(1006);
    });
  }
  _end(code) {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.destroy();
    } catch (_) {}
    this.emit('close', code);
  }
  // a broken peer: say why, let the frame go out, and end
  _fail(code) {
    if (this.closed) return;
    if (!this.sentClose) {
      this.sentClose = true;
      const p = Buffer.alloc(2);
      p.writeUInt16BE(code, 0);
      this._write(8, p);
    }
    try {
      this.socket.end();
    } catch (_) {}
    this.closed = true;
    const t = setTimeout(() => this.socket.destroy(), 500);
    if (t.unref) t.unref();
    this.emit('close', code);
  }
  _data(d) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0,
        op = b[0] & 0x0f,
        masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f,
        off = 2;
      if (b[0] & 0x70) return this._fail(1002); // reserved bits: no extension was agreed
      if (masked === this.client) return this._fail(1002); // a server gets masked frames only, a client unmasked ones
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this._fail(1009);
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (op >= 8 && (!fin || len > 125)) return this._fail(1002); // control frames are short and never split
      if (len > this.max) return this._fail(1009);
      const total = off + (masked ? 4 : 0) + len;
      if (b.length < total) return;
      let payload = b.slice(off + (masked ? 4 : 0), total);
      if (masked) {
        const key = b.slice(off, off + 4);
        payload = Buffer.from(payload); // a copy: unmasking must not change the buffer we still hold
        for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      }
      this.buf = b.slice(total);
      this._frame(fin, op, payload);
      if (this.closed) return;
    }
  }
  _frame(fin, op, payload) {
    if (op === 8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      if (!this.sentClose) this._write(8, payload.slice(0, 2));
      this.sentClose = true;
      return this._end(code);
    }
    if (op === 9) return this._write(10, payload); // ping: answer with the same bytes
    if (op === 10) return this.emit('pong');
    if (op === 0) {
      if (!this.frag) return this._fail(1002);
      this.frag.bytes += payload.length;
      if (this.frag.bytes > this.max) return this._fail(1009);
      this.frag.parts.push(payload);
      if (!fin) return;
      const f = this.frag;
      this.frag = null;
      return this._message(f.op, Buffer.concat(f.parts));
    }
    if (op !== 1 && op !== 2) return this._fail(1002);
    if (this.frag) return this._fail(1002);
    if (!fin) {
      this.frag = { op, parts: [payload], bytes: payload.length };
      return;
    }
    this._message(op, payload);
  }
  _message(op, payload) {
    if (op === 1) this.emit('message', payload.toString('utf8'));
    else this.emit('binary', payload);
  }
  _write(op, payload) {
    if (this.closed || !this.socket.writable) return false;
    const n = payload.length;
    const head = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    head[0] = 0x80 | op;
    const m = this.client ? 0x80 : 0;
    if (n < 126) head[1] = m | n;
    else if (n < 65536) {
      head[1] = m | 126;
      head.writeUInt16BE(n, 2);
    } else {
      head[1] = m | 127;
      head.writeUInt32BE(n, 6);
    }
    let body = payload;
    if (this.client) {
      const key = crypto.randomBytes(4);
      body = Buffer.from(payload);
      for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
      body = Buffer.concat([key, body]);
    }
    this.socket.write(Buffer.concat([head, body]));
    return true;
  }
  send(text) {
    return this._write(1, Buffer.from(String(text), 'utf8'));
  }
  ping() {
    return this._write(9, Buffer.alloc(0));
  }
  // starts the closing handshake; the connection is dropped at once when the other side does not answer within a second
  close(code) {
    if (this.closed) return;
    if (!this.sentClose) {
      this.sentClose = true;
      const p = Buffer.alloc(2);
      p.writeUInt16BE(code || 1000, 0);
      this._write(8, p);
    }
    const t = setTimeout(() => this._end(code || 1000), 1000);
    if (t.unref) t.unref();
  }
  terminate() {
    this._end(1006);
  }
}

function refuse(socket, status, text) {
  try {
    socket.end('HTTP/1.1 ' + status + ' ' + text + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  } catch (_) {}
}

// The server side of the handshake. opts: {maxBytes, origin (function(origin) -> bool: refuse a page from elsewhere)}.
function upgrade(req, socket, head, opts) {
  const o = opts || {},
    h = req.headers;
  const key = h['sec-websocket-key'];
  if (
    req.method !== 'GET' ||
    String(h.upgrade || '').toLowerCase() !== 'websocket' ||
    !/upgrade/i.test(h.connection || '') ||
    h['sec-websocket-version'] !== '13' ||
    typeof key !== 'string' ||
    Buffer.from(key, 'base64').length !== 16
  ) {
    refuse(socket, 400, 'Bad Request');
    return null;
  }
  if (o.origin && !o.origin(h.origin)) {
    refuse(socket, 403, 'Forbidden');
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept(key) + '\r\n\r\n'
  );
  const c = new Conn(socket, false, o.maxBytes);
  if (head && head.length) c._data(head);
  return c;
}

// The client side: resolves a Conn once the server has accepted. opts: {maxBytes, timeout (ms), rejectUnauthorized}.
function connect(address, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new nc.URL(String(address));
    } catch (_) {
      return reject(new Error('bad address'));
    }
    const tls = u.protocol === 'wss:' || u.protocol === 'https:';
    if (!tls && u.protocol !== 'ws:' && u.protocol !== 'http:') return reject(new Error('bad address'));
    const key = crypto.randomBytes(16).toString('base64');
    const lib = tls ? https : http;
    let done = false;
    const fail = e => {
      if (done) return;
      done = true;
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const r = lib.request({
      hostname: u.hostname.replace(/^\[|\]$/g, ''),
      port: u.port || (tls ? 443 : 80),
      path: u.pathname + u.search,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
      rejectUnauthorized: o.rejectUnauthorized !== false,
    });
    const timer = setTimeout(() => {
      fail(new Error('timeout'));
      r.abort();
    }, o.timeout || 5000);
    r.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      if (done) return socket.destroy();
      if (res.headers['sec-websocket-accept'] !== accept(key)) {
        socket.destroy();
        return fail(new Error('bad handshake'));
      }
      done = true;
      const c = new Conn(socket, true, o.maxBytes);
      if (head && head.length) c._data(head);
      resolve(c);
    });
    r.on('response', res => {
      clearTimeout(timer);
      res.resume();
      fail(new Error('refused with ' + res.statusCode));
    });
    r.on('error', e => {
      clearTimeout(timer);
      fail(e);
    });
    r.end();
  });
}

module.exports = { upgrade, connect, accept, Conn };
