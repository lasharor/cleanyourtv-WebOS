// Bluetooth devices from Home (the Bluetooth button of the top bar): the paired devices with whether they are connected, connecting or
// disconnecting a game controller, a keyboard or a mouse, and pairing one, without LG's settings, which take several screens for it.
// Facts from a real TV (webOS 25, OLED65C47LA):
//  - bluetooth2/device/getStatus lists every paired device; connectedProfiles stays empty for a connected HID device, so whether it is
//    connected comes from bluetooth2/hid/getStatus {address} (connected, connecting);
//  - LG's remote (Magic Remote, "LGE MR24") is in that list too, as a BLE device of no class. It is never listed here: disconnecting or
//    removing it would leave the TV without its remote;
//  - a DualSense is class 0x2508 (peripheral, gamepad) with the HID service class. It keeps one host only: once it was paired with a
//    PS5 the TV's pairing no longer works, although the TV still lists it as paired. It has to be removed (adapter/unpair) and paired again;
//  - while adapter/startDiscovery runs (it stops by itself after about 20 s), getStatus lists the devices around as well, paired false;
//    most of them are BLE devices without a name;
//  - adapter/pair {address, subscribe: true} pairs while the subscription lasts. A DualSense in pairing mode (Create + PS) asked for no
//    confirmation: the subscription answered {subscribed: true}, then {request: "endPairing", returnValue: true} after about 5 s;
//  - right after pairing a controller is not connected, and hid/connect from the TV is refused: it connects itself when its PS button is
//    pressed (as it does after a disconnect).
// Only HID devices can be connected, disconnected or paired here; others (headphones, speakers) are listed with connectable false, LG's
// settings connect and pair them.
//   GET  /api/bluetooth                        {available, discovering, devices: [{address, name, kind, connectable, connected,
//                                              connecting}], found: [{address, name, kind, paired}]}
//   POST /api/bluetooth {address, connect}     connect (true) or disconnect (false) a listed HID device; replies as GET, with error
//   POST /api/bluetooth/scan {start}           start (true) or stop (false) looking for devices; replies as GET
//   POST /api/bluetooth/pair {address}         pair a found HID device (an old pairing of it is removed first); replies as GET
//   POST /api/bluetooth/remove {address}       remove a paired device; replies as GET
const web = require('./web');
const lunaCompat = require('./luna');

const BT = 'luna://com.webos.service.bluetooth2/';
const ADDR = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const REMOTE = /^LGE?\s*(AN-)?MR\d|magic\s*remote/i;
const SETTLE = 1500; // after a connect or disconnect the state follows a moment later
const PAIR_TIME = 30000; // a pairing that has not ended by then is given up
const SCAN_TIME = 20000; // the TV stops looking after about this long

// the kind of device from its Bluetooth class: major 5 is a peripheral (its minor bits: gamepad, joystick, keyboard, mouse), 4 audio
function kind(cod) {
  const c = +cod || 0,
    major = (c >> 8) & 0x1f,
    minor = (c >> 2) & 0x3f;
  if (major === 5) {
    if ((minor & 0x0f) === 1 || (minor & 0x0f) === 2) return 'gamepad';
    if (minor & 0x10) return 'keyboard';
    if (minor & 0x20) return 'mouse';
    return 'input';
  }
  if (major === 4) return 'audio';
  return 'other';
}
const isHid = d =>
  (Array.isArray(d.serviceClasses) && d.serviceClasses.some(s => s && s.mnemonic === 'HID')) ||
  (((+d.classOfDevice || 0) >> 8) & 0x1f) === 5;
const isRemote = d => REMOTE.test(String(d.name || ''));
const RANK = { gamepad: 0, keyboard: 1, mouse: 1, input: 1, audio: 2, other: 3 };

function create(ctx) {
  const { luna } = ctx;
  const spawn = ctx.spawn || require('child_process').spawn;
  const settle = ctx.settle === undefined ? SETTLE : ctx.settle;
  const pairTime = ctx.pairTime || PAIR_TIME;
  let scanUntil = 0,
    pairing = '';

  // the paired devices and, while looking, the named ones around; LG's remote left out: {devices, found} or {error}
  async function read() {
    const r = await luna(BT + 'device/getStatus', {});
    if (!r || !Array.isArray(r.devices)) return { error: (r && r.errorText) || 'the Bluetooth service did not answer' };
    const all = r.devices.filter(d => d && ADDR.test(String(d.address || '')) && !isRemote(d));
    const devices = [];
    for (const d of all.filter(x => x.paired)) {
      const hid = isHid(d);
      const x = {
        address: String(d.address).toLowerCase(),
        name: String(d.name || d.address).slice(0, 60),
        kind: kind(d.classOfDevice),
        connectable: hid,
        connected: Array.isArray(d.connectedProfiles) && d.connectedProfiles.length > 0,
        connecting: false,
      };
      if (hid) {
        const s = await luna(BT + 'hid/getStatus', { address: x.address });
        if (s && s.returnValue === true) {
          x.connected = s.connected === true;
          x.connecting = s.connecting === true;
        }
      }
      devices.push(x);
    }
    // found: what can be paired here, a HID device with a name; a paired one that is not connected too (it may need pairing again)
    const found = all
      .filter(d => String(d.name || '').trim() && isHid(d))
      .map(d => ({
        address: String(d.address).toLowerCase(),
        name: String(d.name).slice(0, 60),
        kind: kind(d.classOfDevice),
        paired: !!d.paired,
      }))
      .filter(f => !f.paired || devices.some(x => x.address === f.address && !x.connected))
      .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.name.localeCompare(b.name));
    return { devices, found };
  }

  async function status(error) {
    const p = await read();
    const discovering = Date.now() < scanUntil;
    if (p.error) return { available: false, discovering: false, devices: [], found: [], error: p.error };
    return Object.assign({ available: true, discovering, pairing, devices: p.devices, found: p.found }, error ? { error } : {});
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const refused = (r, what) => (r && r.returnValue === true ? '' : (r && r.errorText) || what);

  async function scan(start) {
    const r = await luna(BT + (start ? 'adapter/startDiscovery' : 'adapter/cancelDiscovery'), {});
    const e = refused(r, 'the Bluetooth service refused');
    scanUntil = start && !e ? Date.now() + SCAN_TIME : 0;
    return start ? e : ''; // stopping a search that already ended is no error
  }

  // adapter/pair is a subscription: it pairs while luna-send -i runs, and ends with {request: "endPairing"} or an error. A request to
  // confirm a passkey is accepted (the user chose this device on the TV); one that needs a code typed in is left to LG's settings.
  function pairOnce(address) {
    return new Promise(resolve => {
      let proc,
        done = false,
        buf = '';
      const end = e => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          proc.kill();
        } catch (_) {}
        resolve(e);
      };
      const timer = setTimeout(() => end('the pairing did not finish; is the device in pairing mode?'), pairTime);
      try {
        proc = spawn('luna-send', ['-i', BT + 'adapter/pair', JSON.stringify({ address, subscribe: true })], {
          stdio: [lunaCompat.keepStdinOpen() ? 'pipe' : 'ignore', 'pipe', 'ignore'],
        });
      } catch (e) {
        return end(String(e.message || e));
      }
      proc.stdout.on('data', d => {
        buf += String(d);
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) {
          let m;
          try {
            m = JSON.parse(l);
          } catch (_) {
            continue;
          }
          if (m.returnValue === false) return end(m.errorText || 'the pairing failed');
          if (m.request === 'endPairing') return end('');
          if (m.request === 'confirmPasskey')
            Promise.resolve(luna(BT + 'adapter/supplyPasskeyConfirmation', { address, accept: true })).catch(() => {}); // a refusal ends the pairing by itself
          else if (m.request && /passkey|pin/i.test(m.request) && m.request !== 'displayPasskey')
            return end('this device needs a code: pair it in LG’s settings');
        }
      });
      proc.on('error', e => end(String(e.message || e)));
      proc.on('close', () => end('the pairing ended without an answer'));
    });
  }

  async function pair(address) {
    const p = await read();
    if (p.error) return p.error;
    const f = p.found.filter(x => x.address === address)[0];
    if (!f) return 'no device to pair with that address; is it in pairing mode?';
    pairing = address;
    try {
      await scan(false);
      if (f.paired) await luna(BT + 'adapter/unpair', { address });
      const e = await pairOnce(address);
      console.log('bluetooth: pair a ' + f.kind + (e ? ': ' + e : ''));
      return e;
    } finally {
      pairing = '';
    }
  }

  async function remove(address) {
    const p = await read();
    if (p.error) return p.error;
    const d = p.devices.filter(x => x.address === address)[0];
    if (!d) return 'no paired device with that address';
    const e = refused(await luna(BT + 'adapter/unpair', { address }), 'the Bluetooth service refused');
    console.log('bluetooth: remove a ' + d.kind + (e ? ': ' + e : ''));
    return e;
  }

  async function connect(address, on) {
    const p = await read();
    if (p.error) return p.error;
    const d = p.devices.filter(x => x.address === address)[0];
    if (!d) return 'no paired device with that address';
    if (!d.connectable) return d.name + ' is connected from LG’s settings';
    const e = refused(
      await luna(BT + (on ? 'hid/connect' : 'hid/disconnect'), { address }, { wait: 15000 }),
      'the Bluetooth service refused'
    );
    console.log('bluetooth: ' + (on ? 'connect a ' : 'disconnect a ') + d.kind + (e ? ': ' + e : ''));
    if (!e && settle) await wait(settle);
    return e;
  }

  async function handle(req, res, u, body) {
    if (req.method !== 'POST') return web.json(res, await status());
    const b = await body(req);
    if (u === '/api/bluetooth/scan') {
      if (typeof b.start !== 'boolean') return web.json(res, { error: 'start must be true or false' }, 400);
      return web.json(res, await status(await scan(b.start)));
    }
    if (!ADDR.test(String(b.address || ''))) return web.json(res, { error: 'address must be a Bluetooth address' }, 400);
    const address = String(b.address).toLowerCase();
    if (u === '/api/bluetooth/pair') {
      if (pairing) return web.json(res, await status('a pairing is already running'));
      return web.json(res, await status(await pair(address)));
    }
    if (u === '/api/bluetooth/remove') return web.json(res, await status(await remove(address)));
    if (typeof b.connect !== 'boolean') return web.json(res, { error: 'connect must be true or false' }, 400);
    web.json(res, await status(await connect(address, b.connect)));
  }

  return {
    name: 'bluetooth',
    paths: ['/api/bluetooth', '/api/bluetooth/scan', '/api/bluetooth/pair', '/api/bluetooth/remove'],
    handle,
    status,
  };
}

module.exports = { create, kind };
