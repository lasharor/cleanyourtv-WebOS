// Remote key remapping (remap.js): the saved keys are checked, a learned button runs its action, and the hook's binds follow the settings.
const fs = require('fs'),
  path = require('path');
const { ok, call, sleep, req, memoryConfig, run } = require('./lib');

run(async () => {
  const mod = req('remap'),
    hook = req('inputhook');
  const BINDS = path.join(process.env.CYTV_HOOK_CFG, 'keybinds.json');
  const CMD = code => 'sh ' + process.env.CYTV_DIR + '/remapkey.sh ' + code;
  const binds = () => {
    try {
      return JSON.parse(fs.readFileSync(BINDS, 'utf8'));
    } catch (_) {
      return {};
    }
  };

  // ---- one saved key ----
  ok(
    JSON.stringify(mod.clean({ type: 'app', id: 'netflix', label: 'Netflix' })) === '{"type":"app","id":"netflix","label":"Netflix"}',
    'an app key is kept as it is'
  );
  ok(
    JSON.stringify(mod.clean({ type: 'live', id: 'x; reboot', junk: 1 })) === '{"type":"live"}',
    'Live TV needs no app id: extra fields are dropped'
  );
  ok(mod.clean({ type: 'app', id: 'a b; reboot' }) === null, 'an app id with shell characters is refused');
  ok(mod.clean({ type: 'app' }) === null && mod.clean({ type: 'input' }) === null, 'an app or input key needs an id');
  ok(mod.clean({ type: 'exec', id: 'x' }) === null && mod.clean(null) === null, 'an unknown action is refused');
  ok(mod.clean({ type: 'home', label: '  ' }).label === undefined, 'an empty label is dropped');

  // ---- the feature ----
  const conf = memoryConfig({ remap: {}, keys: { input: '', home: '777', voice: '', guide: '' } });
  const launched = [];
  let front = ''; // the app in front, as the app manager says
  const luna = async (uri, payload) => {
    launched.push(uri.split('/').pop() + ' ' + JSON.stringify(payload));
    return /getForegroundAppInfo/.test(uri) ? { returnValue: true, appId: front } : { returnValue: true };
  };
  let ensured = 0;
  const boxApps = {},
    box = { handles: id => !!boxApps[id], open: async id => ({ returnValue: true, box: id }) };
  const f = mod.create({
    config: conf,
    luna,
    comeBack: [100, 300, 500],
    inputhook: hook,
    /* the shape the service gives: the Input key module, and the add-ons loader (the Android box is a bundled add-on, not a feature) */
    feature: n => {
      if (n === 'inputkey') return { ensure: () => (ensured++, hook.ensure(true, '241')), on: () => true };
      if (n === 'addons') return { module: id => (id === 'androidbox' ? box : null) };
      return null;
    },
  });
  f.start();
  let r = await call(f, '/api/remap');
  ok(r.code === 200 && JSON.stringify(r.j.keys) === '{}' && r.j.types.length === 5, 'nothing is remapped at first');
  ok(r.j.enabled === false, 'the feature is off until it is switched on');

  // ---- off: nothing runs, nothing is bound ----
  r = await call(f, '/api/remap', 'POST', { code: '403', type: 'app', id: 'netflix', label: 'Netflix' });
  ok(r.code === 400 && r.j.error === 'off' && !conf.get().remap['403'], 'a key cannot be added while the feature is off');
  r = await call(f, '/api/remap/learn', 'POST', {});
  ok(r.code === 400 && r.j.error === 'off', 'a button cannot be learned while the feature is off');
  r = await call(f, '/api/remap', 'POST', { enabled: true });
  ok(
    r.code === 200 && conf.get().remapOn === true && (await call(f, '/api/remap')).j.enabled === true,
    'switching it on is kept in config.json'
  );

  r = await call(f, '/api/remap', 'POST', { code: '403', type: 'app', id: 'netflix', label: 'Netflix' });
  ok(r.code === 200 && r.j.keys['403'].id === 'netflix', 'a key is saved');
  ok(conf.get().remap['403'].type === 'app', 'it is kept in config.json');
  ok(
    ensured > 0 && binds()['403'] && binds()['403'].command === CMD('403'),
    "the hook gets a bind for it, with the code as the command's argument"
  );
  ok(binds()['241'] && binds()['241'].command.indexOf('inputkey.sh') > 0, 'the Input key bind is still there');

  const bads = [
    { code: 'abc', type: 'home' },
    { code: '', type: 'home' },
    { code: '12345', type: 'home' },
    { code: '5', type: 'nope' },
    { code: '5', type: 'app', id: '../x y' },
  ];
  for (const bad of bads) {
    r = await call(f, '/api/remap', 'POST', bad);
    ok(r.code === 400 && r.j.error, 'refused: ' + JSON.stringify(bad));
  }
  r = await call(f, '/api/remap', 'POST', { code: '241', type: 'home' });
  ok(r.code === 400 && r.j.error === 'taken', 'the Input key (default 241) cannot be remapped');
  r = await call(f, '/api/remap', 'POST', { code: '777', type: 'home' });
  ok(r.code === 400 && r.j.error === 'taken', 'a learned Home key cannot be remapped');
  ok(!binds()['777'], 'and gets no bind');
  // the Input key handed back to LG is no longer ours, so its code can be used
  const off = mod.create({
    config: memoryConfig({ remapOn: true, options: { inputKey: false }, remap: {} }),
    luna,
    inputhook: hook,
    feature: n => (n === 'inputkey' ? { ensure: () => {}, on: () => false } : null),
  });
  r = await call(off, '/api/remap', 'POST', { code: '241', type: 'home' });
  ok(r.code === 200 && r.j.keys['241'] && r.j.keys['241'].type === 'home', 'with the Input key off, its code can be remapped');

  // ---- running the actions ----
  const act = async (code, entry) => {
    await call(f, '/api/remap', 'POST', Object.assign({ code }, entry));
    launched.length = 0;
    return (await call(f, '/api/remap/fire', 'POST', { code })).j;
  };
  launched.length = 0;
  r = await call(f, '/api/remap/fire', 'POST', { code: '403' });
  ok(r.j.returnValue === true && launched[0] === 'launch {"id":"netflix","params":{}}', 'the key opens its app');
  r = await call(f, '/api/remap/fire', 'POST', { code: '403' });
  ok(r.j.repeat === true && launched.length === 1, 'a held button (repeats within a moment) runs once');
  r = await act('404', { type: 'input', id: 'com.webos.app.hdmi2', label: 'HDMI 2' });
  ok(r.returnValue && launched[0] === 'launch {"id":"com.webos.app.hdmi2","params":{}}', 'an input key opens the input');
  r = await act('405', { type: 'live' });
  ok(
    r.returnValue && launched[0] === 'launch {"id":"com.webos.app.home","params":{"live":true}}',
    'the Live TV key opens Live TV in the launcher'
  );
  r = await act('406', { type: 'home' });
  ok(r.returnValue && launched[0] === 'launch {"id":"com.webos.app.home","params":{}}', 'the Home key goes to Home');
  // where LG's Home is the native program (scripts/home-standin.sh), the launcher takes its parameters from this file, not from the launch
  const P = req('paths');
  fs.writeFileSync(path.join(P.PROC, 'uptime'), '123.45 100.00\n');
  P.STANDIN = path.join(process.env.CYTV_DIR, 'home-standin');
  fs.writeFileSync(P.STANDIN, '/usr/bin/standin');
  r = await act('408', { type: 'live' });
  ok(
    r.returnValue && fs.readFileSync(P.HOME_PARAMS, 'utf8') === '123.45 {"live":true}',
    'on the stand-in Home, Live TV writes the parameters scripts/home-standin.sh passes on'
  );
  // a code typed with a leading zero is the same button the hook reports ("103", not "0103")
  r = await call(f, '/api/remap', 'POST', { code: '0700', type: 'home' });
  ok(r.code === 200 && conf.get().remap['700'] && !conf.get().remap['0700'], 'a zero-padded code is saved as the hook reports it');
  boxApps.plex = true;
  r = await act('407', { type: 'app', id: 'plex' });
  ok(r.returnValue && launched.length === 0, 'an app set up to open on an Android box goes to the box, not to the TV');
  r = await call(f, '/api/remap/fire', 'POST', { code: '999' });
  ok(r.j.error && launched.length === 0, 'a key without an action does nothing');
  r = await call(f, '/api/remap/fire', 'POST', { code: '4;ls' });
  ok(r.j.error === 'bad code', 'only digits are accepted as a code');
  const bad = mod.create({
    config: memoryConfig({ remapOn: true, remap: { 9: { type: 'app', id: 'gone' } } }),
    luna: async () => ({ returnValue: false, errorText: 'no such app' }),
    inputhook: hook,
  });
  r = (await call(bad, '/api/remap/fire', 'POST', { code: '9' })).j;
  ok(r.returnValue === false && /no such app/.test(r.error), 'an app that cannot start is reported');
  r = (await call(f, '/api/remap')).j;
  ok(
    r.types.length === 5 && r.max === 12 && r.hook === false,
    'the manager gets the actions, the 12 limit and whether the hook is attached'
  );

  // ---- limits ----
  for (let i = 0; i < 20; i++) await call(f, '/api/remap', 'POST', { code: String(500 + i), type: 'home' });
  ok(Object.keys(conf.get().remap).length === 12, 'at most 12 keys');
  r = await call(f, '/api/remap', 'POST', { code: '403', type: 'home' });
  ok(r.code === 200 && conf.get().remap['403'].type === 'home', 'a key that is already there can still be changed when the list is full');

  // ---- giving keys back ----
  // ---- off again: the keys are kept, their binds and actions are not ----
  await call(f, '/api/remap', 'POST', { code: '403', type: 'app', id: 'netflix', label: 'Netflix' });
  r = await call(f, '/api/remap', 'POST', { enabled: false });
  ok(
    r.code === 200 && conf.get().remapOn === undefined && Object.keys(conf.get().remap).length === 12,
    'switching it off keeps the saved keys'
  );
  ok(!Object.keys(binds()).some(k => /remapkey/.test(binds()[k].command)), 'but every remap bind leaves the hook');
  ok(binds()['241'] && binds()['241'].command.indexOf('inputkey.sh') > 0, 'the Input key bind stays');
  launched.length = 0;
  r = await call(f, '/api/remap/fire', 'POST', { code: '403' });
  ok(r.j.error === 'off' && launched.length === 0, 'a button does nothing while the feature is off');
  await call(f, '/api/remap', 'POST', { enabled: true });
  ok(binds()['403'] && binds()['403'].command === CMD('403'), 'switching it on again brings the binds back');

  r = await call(f, '/api/remap', 'POST', { code: '403', remove: true });
  ok(r.code === 200 && !conf.get().remap['403'] && !binds()['403'], 'a removed key loses its action and its bind');
  r = await call(f, '/api/remap', 'POST', { clear: true });
  const left = Object.keys(binds()).filter(k => /remapkey/.test(binds()[k].command));
  ok(r.code === 200 && !conf.get().remap && !left.length, 'giving every key back removes all the remap binds');
  ok(binds()['241'] && binds()['241'].command.indexOf('inputkey.sh') > 0, 'the Input key bind stays');
  fs.writeFileSync(BINDS, JSON.stringify({ 100: { action: 'exec', command: 'echo mine' }, 600: { action: 'exec', command: CMD('600') } }));
  hook.ensure(false, '241');
  ok(binds()[100] && !binds()[600], 'old remap binds go away, other binds stay');

  // ---- learning ----
  r = await call(f, '/api/remap/learn-state');
  ok(r.j.state === 'idle', 'not learning at first');
  fs.writeFileSync(process.env.CYTV_HOOK_LOG, 'InputHook initialized\nlib_main returned: 0\n');
  await call(f, '/api/remap/learn', 'POST', {});
  await sleep(1300); // the press that started the step is ignored
  fs.appendFileSync(
    process.env.CYTV_HOOK_LOG,
    'keyid=1, state=1 uinput_code=103\nkeyid=9, state=1 uinput_code=241\nkeyid=5, state=1 uinput_code=403\n'
  );
  r = await call(f, '/api/remap/learn-state');
  ok(r.j.state === 'taken' && r.j.code === '241', 'a button that already does something of ours is reported, not learned');
  await call(f, '/api/remap/learn', 'POST', {});
  await sleep(1300);
  fs.appendFileSync(process.env.CYTV_HOOK_LOG, 'keyid=1, state=1 uinput_code=108\nkeyid=7, state=1 uinput_code=403\n');
  r = await call(f, '/api/remap/learn-state');
  ok(r.j.state === 'got' && r.j.code === '403' && r.j.existing === null, 'the next button that is not an arrow, OK or Back is learned');
  ok(!conf.get().keys['403'] && conf.get().keys.input === '', 'a learned remap button is not saved as the Input, Home, voice or Guide key');
  // the button's own action covers the manager: the service brings it back, and the code is kept for it
  await sleep(900);
  const back = () =>
    launched.filter(l => l.indexOf('launch {"id":"com.cleanyourtv.manager","params":{"open":"remaplearned"}}') === 0).length;
  ok(back() === 3, 'the manager is opened again once a button is learned, and again while something else is in front: ' + back());
  r = await call(f, '/api/remap/learn-state');
  ok(r.j.resume === true && r.j.code === '403', 'the learned button waits for the manager to resume');
  // when the manager is already in front it is not opened again (it would be reset under the person's hands)
  front = 'com.cleanyourtv.manager';
  launched.length = 0;
  await call(f, '/api/remap/learn', 'POST', {});
  await sleep(1300);
  fs.appendFileSync(process.env.CYTV_HOOK_LOG, 'keyid=7, state=1 uinput_code=404\n');
  await call(f, '/api/remap/learn-state');
  await sleep(900);
  ok(back() === 1, 'the later looks leave the manager alone when it is in front: ' + back());
  front = '';

  // ---- the name of a button ----
  const kn = req('keynames');
  const line = (t, name) =>
    t.toISOString().replace('Z', '123Z') +
    ' [1.0] user.info lginput2 [] lginput2 NL_BUTTON_CLICK {"remote_type":"LGE MR23","button_type":"' +
    name +
    '"} \n';
  ok(kn.label('KEY_NETFLIX') === 'Netflix' && kn.label('KEY_AMAZON') === 'Prime Video', 'a known key name has its own text');
  ok(kn.label('KEY_SENIORTV_HELP') === 'Seniortv help' && kn.label('KEY_5') === '5', 'any other key name is spelled out from the name');
  ok(
    kn.label('netflix') === '' && kn.label('KEY_x; reboot') === '' && kn.label(null) === '',
    'something that is not a key name gives no text'
  );
  const t0 = new Date(),
    old = new Date(t0.getTime() - 60000);
  ok(kn.fromLog(line(t0, 'KEY_AMAZON'), t0.getTime(), 6000) === 'KEY_AMAZON', 'the newest button click in the log names the button');
  ok(kn.fromLog(line(old, 'KEY_AMAZON'), t0.getTime(), 6000) === '', 'a click from a minute ago is not the button that was just pressed');
  ok(kn.fromLog(line(old, 'KEY_RED') + line(t0, 'KEY_AMAZON'), t0.getTime(), 6000) === 'KEY_AMAZON', 'older clicks are passed over');
  ok(
    kn.fromLog(line(t0, 'KEY_AMAZON') + line(t0, 'KEY_OK'), t0.getTime(), 6000) === '',
    'an OK or arrow press after the button is not taken for it'
  );
  ok(kn.fromLog('garbage\n', t0.getTime(), 6000) === '' && kn.fromLog('', t0.getTime(), 6000) === '', 'a log without clicks names nothing');
  fs.writeFileSync(process.env.CYTV_SYSLOG, line(new Date(), 'KEY_DISNEY'));
  await call(f, '/api/remap/learn', 'POST', {});
  await sleep(1300);
  fs.appendFileSync(process.env.CYTV_HOOK_LOG, 'keyid=8, state=1 uinput_code=555\n');
  r = await call(f, '/api/remap/learn-state');
  ok(
    r.j.state === 'got' && r.j.code === '555' && r.j.key === 'KEY_DISNEY' && r.j.button === 'Disney+',
    'a learned button comes with its name from the system log'
  );
  r = await call(f, '/api/remap', 'POST', { code: '555', type: 'home', key: r.j.key });
  ok(
    r.code === 200 && r.j.keys['555'].key === 'KEY_DISNEY' && r.j.keys['555'].name === 'Disney+',
    'the name is saved with the button and shown'
  );
  r = await call(f, '/api/remap', 'POST', { code: '555', type: 'picker' });
  ok(r.j.keys['555'].type === 'picker' && r.j.keys['555'].name === 'Disney+', 'changing what a button does keeps its name');
  r = await call(f, '/api/remap', 'POST', { code: '556', type: 'home', key: 'KEY_X; reboot' });
  ok(
    r.code === 200 && r.j.keys['556'].key === undefined && r.j.keys['556'].name === undefined,
    'a name that is not a key name is not saved'
  );
  await call(f, '/api/remap', 'POST', { code: '556', remove: true });
  fs.writeFileSync(process.env.CYTV_SYSLOG, '');
  await call(f, '/api/remap/learn', 'POST', {});
  await sleep(1300);
  fs.appendFileSync(process.env.CYTV_HOOK_LOG, 'keyid=76, state=1 uinput_code=1038\n');
  r = await call(f, '/api/remap/learn-state');
  ok(
    r.j.code === '1038' && r.j.key === 'KEY_AMAZON' && r.j.button === 'Prime Video',
    'a button seen on a real TV is named even when the log has nothing'
  );
  await call(f, '/api/remap', 'POST', { code: '555', remove: true });

  // the Input key module hands its code to the hook even while it is off: that code must not keep a remap off the keybinds
  off.start();
  hook.ensure(false, '241');
  ok(
    binds()['241'] && binds()['241'].command === CMD('241'),
    'with the Input key off, the hook binds its code for the remap, not for the Inputs list'
  );
});
