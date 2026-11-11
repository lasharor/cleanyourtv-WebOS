// Bluetooth devices from Home (bluetooth.js): a stand-in for LG's bluetooth2 service that answers as the one on a real TV did (webOS 25):
// a DualSense and LG's remote paired, connectedProfiles empty for a connected HID device, the state from hid/getStatus; pairing is a
// luna-send -i subscription that answers {subscribed: true}, then {request: "endPairing"}.
const EventEmitter = require('events');
const { ok, call, req, run } = require('./lib');

const PAD = 'aa:bb:cc:00:00:01',
  REMOTE = 'aa:bb:cc:00:00:02',
  PHONES = '00:11:22:33:44:55';
function tv() {
  const t = { connected: {}, calls: [], refuse: false, down: false, accepted: [], pairArgs: null, killed: 0 };
  // what the pair subscription answers: endPairing by default
  t.pairScript = [
    { subscribed: true, returnValue: true },
    { request: 'endPairing', returnValue: true, subscribed: false },
  ];
  const devices = [
    {
      classOfDevice: 9480,
      serviceClasses: [{ mnemonic: 'HID' }],
      paired: true,
      name: 'DualSense Wireless Controller',
      connectedProfiles: [],
      typeOfDevice: 'bredr',
      address: PAD,
    },
    {
      classOfDevice: 7936,
      serviceClasses: [],
      paired: true,
      name: 'LGE MR24',
      connectedProfiles: [],
      typeOfDevice: 'ble',
      address: REMOTE,
    },
    {
      classOfDevice: 0x240404,
      serviceClasses: [],
      paired: true,
      name: 'Headphones',
      connectedProfiles: ['a2dp'],
      typeOfDevice: 'bredr',
      address: PHONES,
    },
    { classOfDevice: 9480, serviceClasses: [], paired: false, name: 'Not paired', connectedProfiles: [], address: '00:00:00:00:00:01' },
  ];
  t.luna = async (uri, p) => {
    const m = uri.split('bluetooth2/').pop();
    t.calls.push(m);
    if (t.down) return { returnValue: false, errorText: 'Service does not exist' };
    if (m === 'device/getStatus') return { returnValue: true, devices: JSON.parse(JSON.stringify(devices)) };
    if (m === 'hid/getStatus') return { returnValue: true, connected: !!t.connected[p.address], connecting: false, address: p.address };
    if (m === 'adapter/startDiscovery' || m === 'adapter/cancelDiscovery') return { returnValue: true };
    if (m === 'adapter/unpair') {
      devices.filter(d => d.address === p.address).forEach(d => (d.paired = false));
      return { returnValue: true };
    }
    if (m === 'adapter/supplyPasskeyConfirmation') {
      t.accepted.push(p.address + ' ' + p.accept);
      return { returnValue: true };
    }
    if (m === 'hid/connect' || m === 'hid/disconnect') {
      if (t.refuse) return { returnValue: false, errorText: 'Failed to connect' };
      t.connected[p.address] = m === 'hid/connect';
      return { returnValue: true };
    }
    return { returnValue: false };
  };
  t.devices = devices;
  // a stand-in for spawning luna-send -i adapter/pair
  t.spawn = (cmd, args) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.kill = () => t.killed++;
    t.pairArgs = args;
    const a = JSON.parse(args[2]).address;
    setTimeout(() => {
      for (const m of t.pairScript) {
        if (m.request === 'endPairing') devices.filter(d => d.address === a).forEach(d => (d.paired = true));
        proc.stdout.emit('data', JSON.stringify(m) + '\n');
      }
    }, 5);
    return proc;
  };
  return t;
}

run(async () => {
  const B = req('bluetooth');
  ok(
    B.kind(9480) === 'gamepad' && B.kind(0x2540) === 'keyboard' && B.kind(0x2580) === 'mouse' && B.kind(0x240404) === 'audio',
    'the kind follows the device class'
  );

  let t = tv();
  const bt = B.create({ luna: t.luna, settle: 0 });
  let x = await call(bt, '/api/bluetooth');
  ok(x.j.available && x.j.devices.length === 2, 'GET lists the paired devices, without LG’s remote and unpaired ones');
  const pad = () => x.j.devices.filter(d => d.address === PAD)[0];
  ok(pad().kind === 'gamepad' && pad().connectable && !pad().connected, 'the controller: a gamepad that can be connected, not connected');
  const phones = x.j.devices.filter(d => d.address === PHONES)[0];
  ok(
    phones.kind === 'audio' && !phones.connectable && phones.connected,
    'headphones: listed as connected from their profiles, not connectable here'
  );

  t.connected[PAD] = true;
  x = await call(bt, '/api/bluetooth');
  ok(pad().connected, 'a connected controller is shown connected although its profiles are empty');

  x = await call(bt, '/api/bluetooth', 'POST', { address: PAD.toUpperCase(), connect: false });
  ok(
    t.calls.indexOf('hid/disconnect') >= 0 && !t.connected[PAD] && !pad().connected && !x.j.error,
    'POST disconnects it and replies with the new state'
  );
  x = await call(bt, '/api/bluetooth', 'POST', { address: PAD, connect: true });
  ok(t.connected[PAD] && pad().connected, 'POST connects it again');

  t.calls = [];
  x = await call(bt, '/api/bluetooth', 'POST', { address: REMOTE, connect: false });
  ok(t.calls.indexOf('hid/disconnect') < 0 && x.j.error, 'LG’s remote is never disconnected');
  x = await call(bt, '/api/bluetooth', 'POST', { address: PHONES, connect: false });
  ok(t.calls.indexOf('hid/disconnect') < 0 && /LG/.test(x.j.error), 'a device that is not HID is left to LG’s settings');
  x = await call(bt, '/api/bluetooth', 'POST', { address: 'x', connect: true });
  ok(x.code === 400, 'a bad address is refused');
  x = await call(bt, '/api/bluetooth', 'POST', { address: PAD, connect: 'yes' });
  ok(x.code === 400, 'connect must be true or false');

  t.refuse = true;
  x = await call(bt, '/api/bluetooth', 'POST', { address: PAD, connect: false });
  ok(x.j.error === 'Failed to connect' && pad().connected, 'a refusal is passed on and the state stays');

  // pairing: the stale pairing of a controller (paired, not connected; a PS5 took it over) is removed first, then paired again
  t = tv();
  const bp = B.create({ luna: t.luna, spawn: t.spawn, settle: 0, pairTime: 500 });
  x = await call(bp, '/api/bluetooth/scan', 'POST', { start: true });
  ok(t.calls.indexOf('adapter/startDiscovery') >= 0 && x.j.discovering, 'scan starts looking and says so');
  const names = x.j.found.map(f => f.name);
  ok(
    names[0] === 'DualSense Wireless Controller' &&
      names.indexOf('Not paired') >= 0 &&
      names.indexOf('LGE MR24') < 0 &&
      names.indexOf('Headphones') < 0,
    'found: the HID devices with a name, the stale controller too, never the remote or headphones'
  );
  t.calls = [];
  x = await call(bp, '/api/bluetooth/pair', 'POST', { address: PAD });
  ok(
    t.calls.indexOf('adapter/cancelDiscovery') >= 0 && t.calls.indexOf('adapter/unpair') >= 0 && t.pairArgs[0] === '-i',
    'pair stops looking, removes the old pairing and subscribes to adapter/pair'
  );
  ok(
    !x.j.error && x.j.devices.some(d => d.address === PAD) && t.killed === 1 && !x.j.pairing,
    'endPairing: paired, the subscription ended'
  );

  t.devices.filter(d => d.address === '00:00:00:00:00:01')[0].paired = false;
  t.calls = [];
  t.pairScript = [
    { subscribed: true, returnValue: true },
    { request: 'confirmPasskey', passkey: 123456 },
    { request: 'endPairing', returnValue: true },
  ];
  x = await call(bp, '/api/bluetooth/pair', 'POST', { address: '00:00:00:00:00:01' });
  ok(
    t.accepted[0] === '00:00:00:00:00:01 true' && t.calls.indexOf('adapter/unpair') < 0 && !x.j.error,
    'a passkey to confirm is accepted; a new device is not unpaired first'
  );

  // the answer to the passkey may fail (the TV's service refuses): that must not be an unhandled rejection
  let unhandled = 0;
  const onUnhandled = () => unhandled++;
  process.on('unhandledRejection', onUnhandled);
  t.devices.filter(d => d.address === '00:00:00:00:00:01')[0].paired = false;
  t.pairScript = [
    { subscribed: true, returnValue: true },
    { request: 'confirmPasskey', passkey: 123456 },
    { request: 'endPairing', returnValue: true },
  ];
  const badLuna = (uri, p) => (/supplyPasskeyConfirmation/.test(uri) ? Promise.reject(new Error('refused')) : t.luna(uri, p));
  x = await call(B.create({ luna: badLuna, spawn: t.spawn, settle: 0, pairTime: 500 }), '/api/bluetooth/pair', 'POST', {
    address: '00:00:00:00:00:01',
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  process.removeListener('unhandledRejection', onUnhandled);
  ok(unhandled === 0 && !x.j.error, 'a failed answer to the passkey is not an unhandled rejection: ' + unhandled);

  t.pairScript = [{ subscribed: true, returnValue: true }, { request: 'enterPinCode' }];
  t.devices.filter(d => d.address === PAD)[0].paired = false;
  x = await call(bp, '/api/bluetooth/pair', 'POST', { address: PAD });
  ok(/code/.test(x.j.error), 'a device that wants a code typed in is left to LG’s settings');

  t.pairScript = [{ subscribed: true, returnValue: true }];
  x = await call(bp, '/api/bluetooth/pair', 'POST', { address: PAD });
  ok(/did not finish/.test(x.j.error), 'a pairing that never ends is given up');
  t.pairScript = [{ returnValue: false, errorText: 'Authentication failed' }];
  x = await call(bp, '/api/bluetooth/pair', 'POST', { address: PAD });
  ok(x.j.error === 'Authentication failed', 'a failed pairing passes on the error');
  x = await call(bp, '/api/bluetooth/pair', 'POST', { address: REMOTE });
  ok(/no device to pair/.test(x.j.error), 'the remote is never paired or touched');

  t.devices.filter(d => d.address === PAD)[0].paired = true;
  x = await call(bp, '/api/bluetooth/remove', 'POST', { address: PAD });
  ok(!x.j.error && !x.j.devices.some(d => d.address === PAD), 'remove unpairs a paired device');
  t.calls = [];
  x = await call(bp, '/api/bluetooth/remove', 'POST', { address: REMOTE });
  ok(t.calls.indexOf('adapter/unpair') < 0 && x.j.error, 'LG’s remote is never removed');
  x = await call(bp, '/api/bluetooth/scan', 'POST', { start: 'x' });
  ok(x.code === 400, 'scan: start must be true or false');

  t = tv();
  t.down = true;
  x = await call(B.create({ luna: t.luna, settle: 0 }), '/api/bluetooth');
  ok(!x.j.available && x.j.devices.length === 0 && x.j.error, 'without the Bluetooth service: not available, with the error');
});
