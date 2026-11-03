// The keys of the phone remote (service.js) reach the TV here, behind one small interface so that the way in can change without
// touching the rest:
//   press(name)        a remote button, one of KEYS (UP, ENTER, VOLUMEUP, ...)
//   move(dx, dy)       moves the pointer (the touchpad), click(), scroll(dy)
//   text(s), del(n), enter()   typing into the text field that is open on the TV
//   status()           {backend, ok, error, at}: what the last key did
// Buttons go in by the TV's own luna calls of com.webos.service.networkinput: sendSpecialKey {key} (UP, ENTER, HOME, VOLUMEUP, RED, 1 ...),
// and controls/play, pause, stop, rewind, fastForward, channelUp, channelDown for the keys it does not know. If neither takes a key, the
// pointer socket is tried: getPointerInputSocket gives a socket and lines like "type:button / name:HOME" are sent to it. The pointer
// socket is also how the touchpad moves, clicks and scrolls. Text goes through luna://com.webos.service.ime, and volume keys fall back to
// luna://com.webos.service.audio.
// Checked on an LG 65UR91006LB (webOS 10): sendSpecialKey moves the focus on Home and its POWER key puts the TV in standby (it woke again
// with a Wake-on-LAN packet, the same boot); getPointerInputSocket answers with a Unix socket,
// /tmp/netinput.pointer.sock, which accepts a connection and the lines, but a "type:button" line did not change anything there. The
// pointer moves, ime and a ws:// socket address are not checked yet. POST /api/phoneremote/key on the TV presses one key without a phone and
// says which step failed. The tests use a fake luna, a fake socket and a real Unix socket (not on Windows).
const fs = require('fs');
const net = require('net');
const ws = require('./ws');
const paths = require('../../paths');
const KEY_FILE = paths.D + '/ssap-key'; // private, never shown or shared

// the buttons a phone may press (the names the pointer socket knows); nothing else is passed on
const KEYS = [
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'HOME', 'MENU', 'EXIT', 'INFO', 'POWER',
  'VOLUMEUP', 'VOLUMEDOWN', 'MUTE', 'CHANNELUP', 'CHANNELDOWN',
  'PLAY', 'PAUSE', 'STOP', 'REWIND', 'FASTFORWARD',
  'RED', 'GREEN', 'YELLOW', 'BLUE',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
]; // prettier-ignore
const SPECIAL = 'luna://com.webos.service.networkinput/sendSpecialKey';
const CONTROLS_URI = 'luna://com.webos.service.networkinput/controls/';
const CONTROLS = {
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  REWIND: 'rewind',
  FASTFORWARD: 'fastForward',
  CHANNELUP: 'channelUp',
  CHANNELDOWN: 'channelDown',
};
const SOCKET_URI = 'luna://com.webos.service.networkinput/getPointerInputSocket';
const AUDIO = 'luna://com.webos.service.audio/master/';
// The TV's control service (SSAP, what the LG ThinQ app talks to) hands out the pointer socket that really moves the pointer; the same
// call over luna gives a Unix socket that takes the lines and does nothing with them. This service signs in to SSAP on the loopback with
// a key of its own: the first time the TV asks on screen to allow it (the key is then kept in KEY_FILE).
const SSAP_URL = 'ws://127.0.0.1:3000';
const SSAP_URI = 'ssap://com.webos.service.networkinput/getPointerInputSocket';
const SSAP_MANIFEST = {
  manifestVersion: 1,
  appVersion: '1.0',
  permissions: ['CONTROL_MOUSE_AND_KEYBOARD', 'CONTROL_INPUT_TEXT', 'CONTROL_INPUT_TV', 'CONTROL_INPUT_JOYSTICK', 'READ_INPUT_DEVICE_LIST'],
}; // prettier-ignore

const num = (n, lim) => Math.max(-lim, Math.min(lim, Math.round(Number(n) || 0)));

// ctx.luna is the service's luna(); opts.connect replaces the WebSocket client (tests)
function create(ctx, opts) {
  const luna = ctx.luna;
  // the TV answers with a Unix socket (/tmp/netinput.pointer.sock: the lines go in as they are); LG's phone app reaches it through a
  // WebSocket (ws://...) the TV's SSAP service offers, so an address of that kind is opened as a WebSocket
  const unix = path =>
    new Promise((resolve, reject) => {
      const s = net.connect(path);
      const c = {
        closed: false,
        on: (ev, fn) => s.on(ev, fn),
        send: text => (c.closed || !s.writable ? false : (s.write(text), true)),
        terminate() {
          c.closed = true;
          s.destroy();
        },
      };
      s.on('close', () => (c.closed = true));
      s.once('error', reject);
      s.once('connect', () => resolve(c));
    });
  const useSsap = opts && opts.ssap !== undefined ? !!opts.ssap : !(opts && opts.connect); // tests say ssap: false for a fake luna and a real socket
  let ssapConn = null,
    pairing = null;
  const connect = (opts && opts.connect) || ((a, o) => (a.charAt(0) === '/' ? unix(a) : ws.connect(a, o)));
  let loggedAt = 0,
    conn = null,
    connecting = null,
    last = { backend: 'pointer', ok: null, error: '', at: 0 };

  const note = (ok, error, backend) => {
    last = { backend: backend || 'pointer', ok, error: error || '', at: Date.now() };
    return { ok, error: error || '' };
  };

  const readKey = () => {
    try {
      return fs.readFileSync(KEY_FILE, 'utf8').trim();
    } catch (_) {
      return '';
    }
  };
  // one request on an SSAP connection: resolves with the message of the same id that is of the wanted type (or an error)
  const ssapAsk = (c, msg, until, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('the TV did not answer')), ms);
      const onMsg = text => {
        let j;
        try {
          j = JSON.parse(text);
        } catch (_) {
          return;
        }
        if (j.id !== msg.id) return;
        if (j.type === 'error') return done(new Error(j.error || 'the TV refused'));
        if (j.type === until) done(null, j);
      };
      const onClose = () => done(new Error('the TV closed the control connection'));
      const done = (err, j) => {
        clearTimeout(timer);
        c.removeListener('message', onMsg);
        c.removeListener('close', onClose);
        return err ? reject(err) : resolve(j);
      };
      c.on('message', onMsg);
      c.on('close', onClose);
      c.send(JSON.stringify(msg));
    });
  // signs in (the first time the TV shows a prompt: waits for it) and asks for the pointer socket; the connection stays open, the TV
  // closes the pointer socket with it
  async function ssapSocket(waitMs) {
    if (ssapConn && !ssapConn.closed) {
      const s = await ssapAsk(ssapConn, { type: 'request', id: 'p' + Date.now(), uri: SSAP_URI }, 'response', 4000);
      if (s.payload && s.payload.socketPath) return String(s.payload.socketPath);
    }
    const c = await ws.connect((opts && opts.ssapUrl) || SSAP_URL, { timeout: 4000, maxBytes: 1 << 20 });
    try {
      const key = readKey();
      const payload = { forcePairing: false, pairingType: 'PROMPT', manifest: SSAP_MANIFEST };
      if (key) payload['client-key'] = key;
      const reg = await ssapAsk(c, { type: 'register', id: 'r1', payload }, 'registered', waitMs);
      const got = reg.payload && reg.payload['client-key'];
      if (got && got !== key) fs.writeFileSync(KEY_FILE, got, { mode: 0o600 });
      const s = await ssapAsk(c, { type: 'request', id: 'p1', uri: SSAP_URI }, 'response', 4000);
      if (!s.payload || !s.payload.socketPath) throw new Error('the TV gave no pointer socket');
      c.on('close', () => {
        if (ssapConn === c) ssapConn = null;
      });
      ssapConn = c;
      return String(s.payload.socketPath);
    } catch (e) {
      c.terminate();
      throw e;
    }
  }
  async function viaSsap() {
    if (readKey() || ssapConn) return ssapSocket(5000);
    // no key yet: the TV shows "allow this app" on screen. That can take a while, so it goes on in the background and this call says so
    if (!pairing) {
      pairing = ssapSocket(60000)
        .catch(() => {})
        .then(() => {
          pairing = null;
        });
    }
    throw new Error('Allow the connection on the TV screen, then try again');
  }

  // the socket's address, as the TV gives it; a name the TV does not resolve is tried again as the loopback address
  async function open() {
    if (conn && !conn.closed) return conn;
    if (connecting) return connecting;
    connecting = (async () => {
      let first = '';
      if (useSsap) first = await viaSsap();
      let r = null;
      if (!first) {
        r = await luna(SOCKET_URI, {});
        if (!r || r.returnValue === false || !r.socketPath) throw new Error((r && r.errorText) || 'the TV gave no pointer socket');
      }
      const tries = [first || String(r.socketPath)];
      const local = tries[0].replace(/^(wss?:\/\/)[^/:]+/, '$1127.0.0.1');
      if (local !== tries[0]) tries.push(local);
      let err = null;
      for (const a of tries) {
        try {
          const c = await connect(a, { timeout: 4000, rejectUnauthorized: false, maxBytes: 4096 }); // a TV's own certificate; loopback
          c.on('close', () => {
            if (conn === c) conn = null;
          });
          c.on('error', () => {});
          conn = c;
          return c;
        } catch (e) {
          err = e;
        }
      }
      throw new Error('the pointer socket did not open: ' + ((err && err.message) || 'unknown'));
    })();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }

  async function sendSocket(lines) {
    // a socket the TV closed meanwhile is found out by the failed write: open it once more
    for (let attempt = 0; attempt < 2; attempt++) {
      const c = await open();
      const body = lines.join('\n') + '\n\n';
      if (c.send(body)) return;
      c.terminate();
      conn = null;
    }
    throw new Error('the pointer socket does not take keys');
  }

  async function viaAudio(name) {
    if (name === 'VOLUMEUP') return luna(AUDIO + 'volumeUp', {});
    if (name === 'VOLUMEDOWN') return luna(AUDIO + 'volumeDown', {});
    if (name === 'MUTE') {
      const v = await luna(AUDIO + 'getVolume', {});
      const s = (v && v.volumeStatus) || v || {};
      return luna(AUDIO + 'setMuted', { muted: !s.muteStatus });
    }
    throw new Error('no other way for ' + name);
  }

  async function guard(fn, backend) {
    try {
      await fn();
      return note(true, '', backend);
    } catch (e) {
      const msg = String((e && e.message) || e);
      // a touchpad moves many times a second: say once every few seconds (a button logs its own result)
      if (backend !== 'special' && Date.now() - loggedAt > 5000) {
        loggedAt = Date.now();
        console.log('phoneremote: ' + (backend || 'pointer') + ' failed (' + msg + ')');
      }
      return note(false, msg, backend);
    }
  }

  return {
    KEYS,
    press(name) {
      if (KEYS.indexOf(name) < 0) return Promise.resolve({ ok: false, error: 'unknown key' });
      let via = '';
      return guard(async () => {
        const fails = [];
        const r = await luna(SPECIAL, { key: name });
        if (r && r.returnValue !== false) return (via = 'special');
        fails.push('special: ' + ((r && r.errorText) || 'refused'));
        if (CONTROLS[name]) {
          const c = await luna(CONTROLS_URI + CONTROLS[name], {});
          if (c && c.returnValue !== false) return (via = 'controls');
          fails.push('controls: ' + ((c && c.errorText) || 'refused'));
        }
        try {
          await sendSocket(['type:button', 'name:' + name]);
          return (via = 'socket'); // accepted by the socket; whether the TV acts on it is not known
        } catch (e) {
          fails.push('socket: ' + e.message);
        }
        if (/^VOLUME|^MUTE$/.test(name)) {
          const v = await viaAudio(name);
          if (!v || v.returnValue !== false) return (via = 'audio');
          fails.push('audio: ' + (v.errorText || 'refused'));
        }
        throw new Error(fails.join('; '));
      }, 'special').then(res => {
        console.log('phoneremote: key ' + name + (res.ok ? ' ok via ' + via : ' failed (' + res.error + ')'));
        return res;
      });
    },
    move: (dx, dy) => guard(() => sendSocket(['type:move', 'dx:' + num(dx, 200), 'dy:' + num(dy, 200), 'down:0'])),
    click: () => guard(() => sendSocket(['type:click'])),
    scroll: dy => guard(() => sendSocket(['type:scroll', 'dx:0', 'dy:' + num(dy, 200)])),
    text: s =>
      guard(async () => {
        const r = await luna('luna://com.webos.service.ime/insertText', { text: String(s).slice(0, 200), replace: 0 });
        if (r && r.returnValue === false) throw new Error(r.errorText || 'no text field is open on the TV');
      }, 'ime'),
    del: n =>
      guard(async () => {
        const r = await luna('luna://com.webos.service.ime/deleteCharacters', {
          count: Math.max(1, Math.min(50, Math.round(Number(n) || 1))),
        });
        if (r && r.returnValue === false) throw new Error(r.errorText || 'no text field is open on the TV');
      }, 'ime'),
    enter: () =>
      guard(async () => {
        const r = await luna('luna://com.webos.service.ime/sendEnterKey', {});
        if (r && r.returnValue === false) throw new Error(r.errorText || 'no text field is open on the TV');
      }, 'ime'),
    status: () => Object.assign({}, last),
    close() {
      if (conn) conn.terminate();
      conn = null;
      if (ssapConn) ssapConn.terminate();
      ssapConn = null;
    },
  };
}

module.exports = { create, KEYS };
