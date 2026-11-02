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
  const conf = memoryConfig({ keys: { input: '', home: '777', voice: '', guide: '' } });
  const launched = [];
  const luna = async (uri, payload) => {
    launched.push(uri.split('/').pop() + ' ' + JSON.stringify(payload));
    return { returnValue: true };
  };
  let ensured = 0;
  const boxApps = {};
  const f = mod.create({
    config: conf,
    luna,
    inputhook: hook,
    feature: n =>
      n === 'inputkey'
        ? { ensure: () => (ensured++, hook.ensure(true, '241')) }
        : n === 'androidbox'
          ? { handles: id => !!boxApps[id], open: async id => ({ returnValue: true, box: id }) }
          : null,
  });
  f.start();
  let r = await call(f, '/api/remap');
  ok(r.code === 200 && JSON.stringify(r.j.keys) === '{}' && r.j.types.length === 5, 'nothing is remapped at first');

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
  boxApps.plex = true;
  r = await act('407', { type: 'app', id: 'plex' });
  ok(r.returnValue && launched.length === 0, 'an app set up to open on an Android box goes to the box, not to the TV');
  r = await call(f, '/api/remap/fire', 'POST', { code: '999' });
  ok(r.j.error && launched.length === 0, 'a key without an action does nothing');
  r = await call(f, '/api/remap/fire', 'POST', { code: '4;ls' });
  ok(r.j.error === 'bad code', 'only digits are accepted as a code');
  const bad = mod.create({
    config: memoryConfig({ remap: { 9: { type: 'app', id: 'gone' } } }),
    luna: async () => ({ returnValue: false, errorText: 'no such app' }),
    inputhook: hook,
  });
  r = (await call(bad, '/api/remap/fire', 'POST', { code: '9' })).j;
  ok(r.returnValue === false && /no such app/.test(r.error), 'an app that cannot start is reported');
  r = (await call(f, '/api/remap')).j;
  ok(r.last && r.last.code === '407', 'the manager can see what the last key did');

  // ---- limits ----
  for (let i = 0; i < 20; i++) await call(f, '/api/remap', 'POST', { code: String(500 + i), type: 'home' });
  ok(Object.keys(conf.get().remap).length === 12, 'at most 12 keys');
  r = await call(f, '/api/remap', 'POST', { code: '403', type: 'home' });
  ok(r.code === 200 && conf.get().remap['403'].type === 'home', 'a key that is already there can still be changed when the list is full');

  // ---- giving keys back ----
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
});
