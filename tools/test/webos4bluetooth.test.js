'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  crypto = require('crypto');
const { root, tmp, ok, run, sleep } = require('./lib');
const bt = require('../../webos4/bluetooth-accept');
const service = 'com.webos.service.btaudiosrc';
const target = { name: 'Test audio', address: '00:00:00:00:00:01' };
const device = () => ({ name: target.name, address: target.address, paired: true, pairing: false, connectedProfiles: ['a2dp', 'avrcp'] });
const action = button => ({ serviceURI: 'luna://' + service + '/', serviceMethod: 'onClickListener', launchParams: { type: 3, button } });
const alert = id => ({
  returnValue: true,
  alertAction: 'open',
  alertInfo: {
    sourceId: service,
    alertId: service + '-' + id,
    message: '[' + target.name + '] wants to connect',
    buttons: [{ action: action(4) }, { action: action(5) }],
    onCloseAction: action(4),
  },
});
function harness(override, capture, clock) {
  const calls = [],
    logs = [];
  let visible = 'no';
  const ctl = bt.create(
    target,
    (method, payload, done) => {
      calls.push({ method, payload });
      if (override) return override(method, payload, done);
      if (method.endsWith('/getStatus')) done(null, { returnValue: true, devices: [device()] });
      else if (method.endsWith('/getConnectedDevice')) done(null, { returnValue: true, connected: true, name: target.name });
      else if (method.endsWith('/getCurrentState')) done(null, { returnValue: true, currentState: 'alertView' });
      else {
        visible = payload.key === 'RIGHT' ? 'yes' : 'no';
        done(null, { returnValue: true });
      }
    },
    e => logs.push(e),
    capture ? done => capture(done, visible) : done => done(null, visible),
    clock
  );
  return { ctl, calls, logs };
}
function fakeClock() {
  let now = 0,
    next = 0;
  const jobs = new Map();
  return {
    setTimeout(fn, delay) {
      const id = ++next;
      jobs.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      jobs.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const due = Array.from(jobs)
          .filter(entry => entry[1].at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        jobs.delete(due[0]);
        due[1].fn();
      }
      now = end;
    },
  };
}
function bmp(color) {
  const b = Buffer.alloc(102, color);
  b.write('BM');
  b.writeUInt32LE(102, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(4, 18);
  b.writeInt32LE(4, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(0, 30);
  return b;
}
const no = bmp(0),
  yes = bmp(7);
const ui = {
  width: 4,
  height: 4,
  crop: { x: 1, y: 1, width: 2, height: 2 },
  no: crypto.createHash('sha256').update(Buffer.alloc(12, 0)).digest('hex'),
  yes: crypto.createHash('sha256').update(Buffer.alloc(12, 7)).digest('hex'),
};
run(async () => {
  ok(
    bt.validTarget(target) &&
      !bt.validTarget({ name: 'bad\nname', address: target.address }) &&
      !bt.validTarget({ name: 'audio', address: ';reboot' }),
    'invalid identities cannot configure root input automation'
  );
  ok(bt.matches(alert(1), target.name) && !bt.matches(alert(1), 'Other'), 'only the exact native device prompt matches');
  for (const change of [
    a => {
      a.alertInfo.sourceId = 'other';
    },
    a => {
      a.alertAction = 'close';
    },
    a => {
      a.alertInfo.buttons.reverse();
    },
    a => {
      a.alertInfo.buttons[1].action.serviceURI = 'luna://other/';
    },
    a => {
      a.alertInfo.onCloseAction = action(5);
    },
    a => {
      a.alertInfo.buttons = [null, null];
    },
  ]) {
    const a = alert(1);
    change(a);
    ok(!bt.matches(a, target.name), 'wrong source, close behavior or button order is rejected');
  }
  for (const change of [
    d => {
      d.paired = false;
    },
    d => {
      d.pairing = true;
    },
    d => {
      d.address = '00:00:00:00:00:02';
    },
    d => {
      d.connectedProfiles = [];
    },
  ]) {
    const d = device();
    change(d);
    ok(!bt.connected({ returnValue: true, devices: [d] }, target), 'unpaired, pairing, wrong and disconnected devices cannot trigger keys');
  }
  ok(!bt.connected({ returnValue: true, devices: [device(), device()] }, target), 'ambiguous device names are refused');
  ok(bt.pixelState(no, ui) === 'no' && bt.pixelState(yes, ui) === 'yes', 'BMP pixels distinguish the calibrated No and Yes focus');
  const changed = Buffer.from(yes);
  changed[70] ^= 1;
  ok(
    bt.pixelState(changed, ui) === 'other' && bt.pixelState(yes.slice(0, 70), ui) === 'other',
    'changed or truncated screenshots cannot authorize Enter'
  );
  ok(
    !bt.validUi(Object.assign({}, ui, { yes: ui.no })) && !bt.validUi(Object.assign({}, ui, { crop: { x: 4, y: 0, width: 2, height: 2 } })),
    'invalid or indistinguishable calibrations are rejected'
  );
  const normal = harness();
  normal.ctl.handle(alert(1));
  normal.ctl.handle(alert(1));
  normal.ctl.handle(alert(2));
  const keys = normal.calls.filter(c => c.method.endsWith('/sendSpecialKey')).map(c => c.payload.key);
  ok(
    keys.join() === 'RIGHT,ENTER,RIGHT,ENTER' && normal.logs.join() === 'accepted,accepted',
    'distinct reconnections use real Yes buttons once each'
  );
  ok(
    normal.calls.every(c => !c.method.endsWith('/onClickListener')),
    'the direct callback that causes the later No/disconnect is never called'
  );
  const failed = harness((m, p, done) => done(new Error('private failure')));
  failed.ctl.handle(alert(1));
  failed.ctl.handle(alert(1));
  ok(failed.calls.length === 1 && failed.logs.join() === 'skipped-device-state', 'read errors cause no keys, retry or private log output');
  const wrong = harness((m, p, done) =>
    done(
      null,
      m.endsWith('/getStatus') ? { returnValue: true, devices: [device()] } : { returnValue: true, connected: true, name: 'Other' }
    )
  );
  wrong.ctl.handle(alert(1));
  ok(wrong.calls.length === 2 && wrong.logs[0] === 'skipped-active-device', 'other active audio devices block navigation');
  let deferred;
  const cancelled = harness((m, p, done) => {
    deferred = done;
  });
  cancelled.ctl.handle(alert(1));
  cancelled.ctl.handle({ returnValue: true, alertAction: 'close' });
  deferred(null, { returnValue: true, devices: [device()] });
  ok(cancelled.calls.length === 1 && cancelled.logs[0] === 'cancelled', 'closed prompts cancel late callbacks');
  cancelled.ctl.handle(alert(2));
  cancelled.ctl.stop();
  deferred(null, { returnValue: true, devices: [device()] });
  cancelled.ctl.handle(alert(3));
  ok(cancelled.calls.length === 2, 'stop cancels pending and future automation');
  const replaced = harness((m, p, done) => {
    deferred = done;
  });
  replaced.ctl.handle(alert(1));
  const other = alert(3);
  other.alertInfo.sourceId = 'other';
  replaced.ctl.handle(other);
  deferred(null, { returnValue: true, devices: [device()] });
  ok(replaced.calls.length === 1 && replaced.logs[0] === 'cancelled-replaced', 'another alert cancels pending keys');
  const imageClock = fakeClock();
  const badImage = harness(null, done => done(new Error('capture failed')), imageClock);
  badImage.ctl.handle(alert(1));
  imageClock.advance(14999);
  ok(
    !badImage.calls.some(c => c.method.endsWith('/sendSpecialKey')) && badImage.logs.length === 0,
    'capture failures are observed passively until the bounded confirmation deadline'
  );
  imageClock.advance(1);
  ok(
    !badImage.calls.some(c => c.method.endsWith('/sendSpecialKey')) && badImage.logs[0] === 'timeout-before-key-image',
    'persistent capture errors expire without sending global keys'
  );
  let draws = 0;
  const late = harness(null, (done, visible) => done(null, ++draws === 1 ? 'other' : visible));
  late.ctl.handle(alert(1));
  await sleep(650);
  ok(
    late.logs[0] === 'accepted' && late.calls.filter(c => c.method.endsWith('/sendSpecialKey')).length === 2,
    'initial incomplete rendering waits for an exact visible prompt'
  );
  const alreadyYes = harness(null, done => done(null, 'yes'));
  alreadyYes.ctl.handle(alert(1));
  ok(
    alreadyYes.calls
      .filter(c => c.method.endsWith('/sendSpecialKey'))
      .map(c => c.payload.key)
      .join() === 'ENTER',
    'a visibly selected Yes is accepted directly without moving selection'
  );
  const raceClock = fakeClock();
  let snapshots = 0;
  const changedFocus = harness(null, (done, visible) => done(null, ++snapshots === 1 ? 'yes' : visible), raceClock);
  changedFocus.ctl.handle(alert(1));
  ok(
    !changedFocus.calls.some(c => c.method.endsWith('/sendSpecialKey')),
    'a stale Yes image is checked again after device verification before Enter'
  );
  raceClock.advance(500);
  ok(
    changedFocus.calls
      .filter(c => c.method.endsWith('/sendSpecialKey'))
      .map(c => c.payload.key)
      .join() === 'RIGHT,ENTER',
    'a changed selection is navigated only after a fresh No, then confirmed only after a fresh Yes'
  );
  const delayedClock = fakeClock();
  let focused = false,
    picture = 'no',
    stillPaired = true;
  const delayed = harness(
    (method, payload, done) => {
      if (method.endsWith('/getStatus')) {
        const d = device();
        d.paired = stillPaired;
        done(null, { returnValue: true, devices: [d] });
      } else if (method.endsWith('/getConnectedDevice')) done(null, { returnValue: true, connected: true, name: target.name });
      else if (method.endsWith('/getCurrentState')) done(null, { returnValue: true, currentState: focused ? 'alertView' : 'none' });
      else {
        if (payload.key === 'RIGHT') focused = false;
        done(null, { returnValue: true });
      }
    },
    done => done(null, picture),
    delayedClock
  );
  delayed.ctl.handle(alert(1));
  delayedClock.advance(2000);
  ok(!delayed.calls.some(c => c.method.endsWith('/sendSpecialKey')), 'a boot-time missing focus is waited out without keys');
  focused = true;
  delayedClock.advance(500);
  delayedClock.advance(2000);
  ok(
    delayed.calls
      .filter(c => c.method.endsWith('/sendSpecialKey'))
      .map(c => c.payload.key)
      .join() === 'RIGHT',
    'focus lost after Right is waited out without another Right or blind Enter'
  );
  focused = true;
  delayedClock.advance(1000);
  ok(delayed.calls.filter(c => c.method.endsWith('/sendSpecialKey')).length === 1, 'an accepted Right that still shows No is not repeated');
  picture = 'yes';
  delayedClock.advance(500);
  ok(
    delayed.logs[0] === 'accepted' &&
      delayed.calls
        .filter(c => c.method.endsWith('/sendSpecialKey'))
        .map(c => c.payload.key)
        .join() === 'RIGHT,ENTER',
    'confirmation resumes only after focus and the calibrated Yes image return'
  );
  delayed.ctl.handle(alert(2));
  ok(delayed.logs.length === 2, 'a distinct already-Yes prompt remains independently actionable');
  const pairingClock = fakeClock();
  picture = 'no';
  focused = true;
  const changedDevice = harness(
    (method, payload, done) => {
      if (method.endsWith('/getStatus')) {
        const d = device();
        d.paired = stillPaired;
        done(null, { returnValue: true, devices: [d] });
      } else if (method.endsWith('/getConnectedDevice')) done(null, { returnValue: true, connected: true, name: target.name });
      else if (method.endsWith('/getCurrentState')) done(null, { returnValue: true, currentState: 'alertView' });
      else {
        stillPaired = false;
        picture = 'yes';
        done(null, { returnValue: true });
      }
    },
    done => done(null, picture),
    pairingClock
  );
  changedDevice.ctl.handle(alert(1));
  ok(
    changedDevice.calls
      .filter(c => c.method.endsWith('/sendSpecialKey'))
      .map(c => c.payload.key)
      .join() === 'RIGHT' && changedDevice.logs[0] === 'skipped-device-state',
    'paired-device ownership is checked again before Enter after a Right'
  );
  stillPaired = true;
  const stuckClock = fakeClock(),
    stuck = harness(null, done => done(null, 'no'), stuckClock);
  stuck.ctl.handle(alert(1));
  stuckClock.advance(15000);
  stuck.ctl.handle(alert(1));
  ok(
    stuck.calls
      .filter(c => c.method.endsWith('/sendSpecialKey'))
      .map(c => c.payload.key)
      .join() === 'RIGHT' && stuck.logs[0] === 'timeout-after-right-image',
    'a stuck No expires after one Right and duplicate notifications cannot retry it'
  );
  const stoppedClock = fakeClock(),
    stoppedWait = harness(null, done => done(null, 'other'), stoppedClock);
  stoppedWait.ctl.handle(alert(1));
  stoppedWait.ctl.stop();
  const stoppedCount = stoppedWait.calls.length;
  stoppedClock.advance(15000);
  ok(stoppedWait.calls.length === stoppedCount && stoppedWait.logs.length === 0, 'stop cancels both polling and the confirmation deadline');
  const expiryClock = fakeClock();
  let lateCapture;
  const expired = harness(
    null,
    done => {
      lateCapture = done;
    },
    expiryClock
  );
  expired.ctl.handle(alert(1));
  expiryClock.advance(15000);
  lateCapture(null, 'yes');
  ok(
    !expired.calls.some(c => c.method.endsWith('/sendSpecialKey')) && expired.logs[0] === 'timeout-before-key-image',
    'a late Yes capture cannot act after the deadline'
  );
  let uncertainCount = 0;
  const uncertain = harness((m, p, done) => {
    if (m.endsWith('/getStatus')) done(null, { returnValue: true, devices: [device()] });
    else if (m.endsWith('/getConnectedDevice')) done(null, { returnValue: true, connected: true, name: target.name });
    else if (m.endsWith('/getCurrentState')) done(null, { returnValue: true, currentState: 'alertView' });
    else {
      uncertainCount++;
      done(new Error('uncertain'));
    }
  });
  uncertain.ctl.handle(alert(1));
  uncertain.ctl.handle(alert(1));
  ok(uncertainCount === 1 && uncertain.logs[0] === 'uncertain', 'an uncertain key is never retried or followed by Enter');
  const existing = harness();
  existing.ctl.existing();
  ok(existing.logs[0] === 'accepted', 'a boot-time existing prompt still requires device and pixel verification');
  for (const mode of ['off', 'pairing', 'other-audio', 'unavailable', 'uncertain']) {
    const startup = harness((method, payload, done) => {
      if (method.endsWith('/getStatus')) {
        const d = device();
        d.connectedProfiles = [];
        d.pairing = mode === 'pairing';
        const devices = [d];
        if (mode === 'other-audio') devices.push({ name: 'Other', connectedProfiles: ['a2dp'] });
        done(null, { returnValue: true, devices });
      } else done(mode === 'uncertain' ? new Error('uncertain') : null, { returnValue: mode !== 'unavailable' });
    });
    startup.ctl.existing();
    const connects = startup.calls.filter(c => c.method.endsWith('/a2dp/connect'));
    ok(
      connects.length === (mode === 'pairing' || mode === 'other-audio' ? 0 : 1) &&
        connects.every(c => c.payload.address === target.address) &&
        !startup.calls.some(c => c.method.endsWith('/sendSpecialKey')),
      'startup connects the known paired peer once, without pairing, takeover or automatic retries: ' + mode
    );
  }
  ok(
    cp.spawnSync('sh', ['-n', path.join(root, 'webos4/bluetooth.sh')]).status === 0 &&
      cp.spawnSync('sh', ['-n', path.join(root, 'webos4/25-cleanyourtv-bluetooth')]).status === 0,
    'controller and isolated boot entry parse'
  );
  ok(
    /CONFIG=\/var\/lib\/webosbrew\/cleanyourtv-bluetooth.json/.test(fs.readFileSync(path.join(root, 'webos4/bluetooth.sh'), 'utf8')),
    'private config is outside the developer tree whose permissions change at boot'
  );
  const config = path.join(tmp, 'device.json'),
    exe = path.join(tmp, 'luna-send'),
    marker = path.join(tmp, 'keys'),
    focus = path.join(tmp, 'focus'),
    opened = path.join(tmp, 'open');
  fs.writeFileSync(config, JSON.stringify(Object.assign({}, target, { ui })), { mode: 0o600 });
  fs.writeFileSync(
    exe,
    '#!' +
      process.execPath +
      '\n' +
      `
 var fs=require('fs'),args=process.argv;
 if(!fs.fstatSync(0).isCharacterDevice())process.exit(8);
 function out(v){console.log(JSON.stringify(v));}
 if(args.indexOf('-i')!==-1){
 out({returnValue:true,subscribed:true});
 setTimeout(function(){fs.writeFileSync(${JSON.stringify(opened)},'1');out(${JSON.stringify(alert(10))});out(${JSON.stringify(alert(10))});},200);
 setTimeout(function(){fs.writeFileSync(${JSON.stringify(opened)},'1');out(${JSON.stringify(alert(11))});},1500);
 setInterval(function(){},1000);
 }else{
 var uri=args[args.length-2],p=JSON.parse(args[args.length-1]);
 if(/device\\/getStatus$/.test(uri))out({returnValue:true,devices:[${JSON.stringify(device())}]});
 else if(/getConnectedDevice$/.test(uri))out({returnValue:true,connected:true,name:${JSON.stringify(target.name)}});
 else if(/getCurrentState$/.test(uri))out({returnValue:true,currentState:fs.existsSync(${JSON.stringify(opened)})?'alertView':'none'});
 else if(/captureCompositorOutput$/.test(uri)){
 fs.writeFileSync(p.output,Buffer.from(fs.existsSync(${JSON.stringify(focus)})?${JSON.stringify(yes.toString('hex'))}:${JSON.stringify(no.toString('hex'))},'hex'));
 out({returnValue:true,output:p.output});
 }else if(/sendSpecialKey$/.test(uri)){
 fs.appendFileSync(${JSON.stringify(marker)},p.key+'\\n');
 if(p.key==='RIGHT')fs.writeFileSync(${JSON.stringify(focus)},'1');
 else {fs.unlinkSync(${JSON.stringify(focus)});fs.unlinkSync(${JSON.stringify(opened)});}
 out({returnValue:true});
 }else process.exit(9);
 }`,
    { mode: 0o700 }
  );
  const program = path.join(root, 'webos4/bluetooth-accept.js');
  const child = cp.spawn(process.execPath, [program, config, '--trial'], {
    env: Object.assign({}, process.env, { PATH: tmp + ':' + process.env.PATH }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    closed = false;
  child.stdout.on('data', d => {
    output += d;
  });
  child.on('close', () => {
    closed = true;
  });
  try {
    for (let i = 0; i < 160 && (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim().split('\n').length < 4) && !closed; i++)
      await sleep(50);
    ok(
      fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === 'RIGHT\nENTER\nRIGHT\nENTER',
      'real processes verify BMPs and /dev/null stdin before each pair of keys'
    );
    ok(!closed && /READY/.test(output), 'bounded trials remain subscribed for multiple reconnections');
  } finally {
    child.kill('SIGTERM');
    for (let i = 0; i < 40 && !closed; i++) await sleep(25);
    if (!closed) child.kill('SIGKILL');
  }
  ok(closed && /STOPPED/.test(output), 'termination cleans subscriptions and private capture files');
  fs.chmodSync(config, 0o644);
  ok(cp.spawnSync(process.execPath, [program, config]).status === 1, 'public device configuration is refused');
});
