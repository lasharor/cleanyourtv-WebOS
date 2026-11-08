// Volume bar (audio.js): LG's own bar is switched off only for a custom theme, after saving what it was, and put back after;
// the subscription's lines become the status the overlay polls. luna and the luna-send process are stand-ins here.
const fs = require('fs'),
  path = require('path'),
  { EventEmitter } = require('events');
const { ok, call, memoryConfig, run } = require('./lib');
const P = require(path.join(__dirname, '..', '..', 'helper', 'paths'));
const audio = require(path.join(__dirname, '..', '..', 'helper', 'audio'));
const KEY = 'com.webos.surfacemanager.volumeOSD';

function tv(o) {
  const calls = [];
  let value = o.value;
  const luna = async (uri, payload) => {
    calls.push(uri.split('/').pop() + ' ' + JSON.stringify(payload));
    if (/getConfigs$/.test(uri))
      return value === undefined ? { returnValue: true, configs: {} } : { returnValue: true, configs: { [KEY]: value } };
    if (/setConfigs$/.test(uri)) {
      if (o.refuse) return { returnValue: false, errorText: 'refused' };
      value = payload.configs[KEY];
      return { returnValue: true };
    }
    return { returnValue: true };
  };
  const procs = [];
  const spawn = () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.kill = () => {};
    procs.push(p);
    return p;
  };
  return { calls, luna, spawn, procs, value: () => value };
}
const saved = path.join(P.D, 'backup', 'volume-osd.orig');
const wait = () => new Promise(r => setTimeout(r, 20));

run(async () => {
  ok(
    audio.DEFAULT_THEME === 'system' && audio.THEMES.join() === 'pill,capsule,dial,system',
    'LG’s own bar is the default; three custom themes'
  );

  // the default theme touches nothing
  let t = tv({ value: true });
  let a = audio.create({ config: memoryConfig(), luna: t.luna, spawn: t.spawn });
  a.start();
  await a.syncStockVolumeOSD();
  ok(!t.calls.length && !fs.existsSync(saved), 'the default theme asks LG for nothing and saves nothing');

  // a custom theme: save, then switch LG’s bar off
  t = tv({ value: true });
  a = audio.create({ config: memoryConfig(), luna: t.luna, spawn: t.spawn });
  await a.syncStockVolumeOSD('pill');
  ok(fs.readFileSync(saved, 'utf8') === 'true' && t.value() === false, 'LG’s bar is saved as it was, then switched off');
  await a.syncStockVolumeOSD('capsule');
  ok(t.calls.filter(c => /^setConfigs/.test(c)).length === 1, 'another custom theme does not switch it off again');

  // back to system: put back as saved, forget the copy
  await a.syncStockVolumeOSD('system');
  ok(t.value() === true && !fs.existsSync(saved), 'System default puts LG’s bar back and forgets the copy');

  // it was already off before: it stays off after
  t = tv({ value: false });
  a = audio.create({ config: memoryConfig(), luna: t.luna, spawn: t.spawn });
  await a.syncStockVolumeOSD('dial');
  await a.syncStockVolumeOSD('system');
  ok(t.value() === false, 'a bar that was off before is put back off');

  // a service restart with a custom theme: the saved copy is kept, nothing asked again
  t = tv({ value: true });
  a = audio.create({ config: memoryConfig(), luna: t.luna, spawn: t.spawn });
  await a.syncStockVolumeOSD('pill');
  const t2 = tv({ value: false });
  const b = audio.create({ config: memoryConfig(), luna: t2.luna, spawn: t2.spawn });
  await b.syncStockVolumeOSD('pill');
  ok(!t2.calls.length && fs.readFileSync(saved, 'utf8') === 'true', 'after a restart the saved value is not overwritten');
  await b.syncStockVolumeOSD('system');
  ok(t2.value() === true && !fs.existsSync(saved), 'and System default still restores the first value');

  // a TV that does not report the setting, or refuses: nothing changes and no custom bar is shown
  t = tv({});
  a = audio.create({ config: memoryConfig(), luna: t.luna, spawn: t.spawn });
  await a.syncStockVolumeOSD('pill');
  ok(!fs.existsSync(saved) && !t.calls.some(c => /^setConfigs/.test(c)), 'no setting reported: nothing is changed');
  t = tv({ value: true, refuse: true });
  a = audio.create({ config: memoryConfig(), luna: t.luna, spawn: t.spawn });
  await a.syncStockVolumeOSD('pill');
  ok(!fs.existsSync(saved) && t.value() === true, 'a refused change leaves no copy behind');

  // the subscription becomes the status the overlay polls
  t = tv({ value: true });
  a = audio.create({ config: memoryConfig({ options: { volumeTheme: 'pill' } }), luna: t.luna, spawn: t.spawn });
  a.start();
  await wait();
  t.procs[0].stdout.emit(
    'data',
    Buffer.from('{"volumeStatus":{"volume":37,"muteStatus":false,"soundOutput":"external_arc","maxVolume":100}}\n')
  );
  let x = await call(a, '/api/audio/volume');
  ok(
    x.j.volume === 37 && x.j.output === 'external_arc' && x.j.theme === 'pill' && x.j.mute === false,
    'volume, output and theme from the subscription'
  );
  const seq = x.j.seq;
  t.procs[0].stdout.emit('data', Buffer.from('{"volumeStatus":{"volume":40,"muteStatus":true}}\n'));
  x = await call(a, '/api/audio/volume?since=' + seq);
  ok(x.j.volume === 40 && x.j.mute === true && x.j.seq > seq, 'a newer status answers a poll at once');
  a.stop();
});
