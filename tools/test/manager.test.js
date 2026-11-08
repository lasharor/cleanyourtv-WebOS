// The manager's options and keys (manager.js, inputkey.js, config.js): what is stored, what is logged, and how the Input key follows.
const fs = require('fs'),
  path = require('path');
const { ok, call, req, run } = require('./lib');
const config = req('config');

run(async () => {
  const lines = [];
  const conf = config.memory({}, l => lines.push(l));
  let ensured = 0,
    keyOn = null,
    mode = 'overlay',
    synced = 0;
  const inputkey = {
    mode: () => (conf.get().picker || {}).mode || mode,
    on: () => conf.options().inputKey && mode !== 'released',
    syncMode: () => synced++,
    pickerShownAt: () => 0,
  };
  const features = { inputkey };
  const m = req('manager').create({
    version: '1.6.0',
    config: conf,
    luna: async () => ({}),
    feature: n => features[n] || null,
    inputhook: {
      status: () => ({}),
      ensure(on) {
        ensured++;
        keyOn = on;
      },
      learnState: () => ({ state: 'got', name: 'guide', code: '362' }),
      markSaved() {},
      startLearn() {},
    },
  });
  const ask = (act, method, body) => call(m, '/api/manager/' + act, method, body);

  let r = await ask('status', 'GET');
  ok(
    r.j.options.liveTv === true && r.j.options.inputKey === true && r.j.options.debloat === true && r.j.keys.guide === '',
    'options are on by default and no Guide key is learned'
  );
  r = await ask('options', 'POST', { liveTv: false });
  ok(
    r.j.options.liveTv === false && conf.get().options.liveTv === false && ensured > 0,
    'switching Live TV off is stored and refreshes the key binds'
  );
  ok(
    lines.some(l => /options\.liveTv true -> false \(manager\)/.test(l)),
    'the change is logged with its source: ' + lines.join(' | ')
  );
  r = await ask('options', 'POST', { tuner: false });
  ok(
    r.j.options.tuner === false && conf.get().options.tuner === false && r.j.options.liveTv === false,
    "Show LG's own Live TV is its own option: it changes alone"
  );
  r = await ask('options', 'POST', { tuner: 'no' });
  ok(r.j.options.tuner === false, 'only a boolean changes the tuner option');
  r = await ask('options', 'POST', { tuner: true });
  ok(r.j.options.tuner === true, "Show LG's own Live TV can be switched on again");
  r = await ask('options', 'POST', { liveTv: 'no' });
  ok(r.j.options.liveTv === false, 'only a boolean changes an option');
  r = await ask('options', 'POST', { inputKey: false });
  ok(r.j.options.inputKey === false && r.j.options.liveTv === false, 'one option does not reset another');
  r = await ask('options', 'POST', { volumeTheme: 'dial' });
  ok(r.j.options.volumeTheme === 'dial' && conf.get().options.volumeTheme === 'dial', 'volumeTheme option is saved');
  r = await ask('options', 'POST', { volumeTheme: 'no-such-theme' });
  ok(r.j.options.volumeTheme === 'dial', 'a theme that does not exist is not saved');

  r = await ask('options', 'POST', { pickerMode: 'overlay' });
  ok(
    r.j.picker.mode === 'overlay' && conf.get().picker.prewarm === true && synced > 0,
    'choosing the overlay is saved and the Input key script is told'
  );
  r = await ask('options', 'POST', { pickerMode: 'ondemand' });
  ok(r.j.picker.mode === 'ondemand', 'choosing the on-demand picker');
  r = await ask('options', 'POST', { pickerMode: 'launcher' });
  ok(r.j.picker.mode === 'launcher', "choosing the launcher's list");
  r = await ask('options', 'POST', { pickerMode: 'sideways' });
  ok(r.j.picker.mode === 'launcher', 'an unknown mode is ignored');
  r = await ask('options', 'POST', { inputKey: true });
  mode = 'released';
  r = await ask('options', 'POST', { liveTv: true });
  ok(
    keyOn === false && r.j.picker.released === true,
    "the Input key is released to LG when its target needs CleanYourTV as Home and LG's Home is selected"
  );

  r = await ask('learn-state', 'GET');
  ok(conf.keys().guide === '362' && conf.keys().input === '241', 'a learned key is saved with the default Input key');
  r = await ask('clear-key', 'POST', { name: 'guide' });
  ok(conf.keys().guide === '', 'a learned key can be cleared');
  r = await ask('keys-done', 'POST');
  ok(conf.keys().learned === true, 'the end of the Input key steps is saved');
  ok(
    lines.some(l => /keys\.guide "" -> "362"|keys\.guide undefined -> "362"/.test(l)),
    'learned keys are logged too'
  );
  r = await ask('nope', 'POST');
  ok(r.code === 404, 'an unknown action');
  r = await ask('options', 'GET');
  ok(r.code === 405, 'a change needs POST');

  // the settings file: one read-modify-write at a time, written atomically, the launcher's part replaced without touching the rest
  const file = path.join(process.env.CYTV_DIR, 'config.json');
  const c = config.create(file, { log: () => {} });
  c.update('setup', x => {
    x.options = { inputKey: false };
    x.dock = ['a'];
  });
  c.update('launcher', x => {
    delete x.dock;
    x.dock = ['b'];
  });
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(
    back.options.inputKey === false && back.dock.join() === 'b' && (fs.statSync(file).mode & 0o777) === 0o600,
    'config.json keeps every section, is replaced atomically and readable by root only'
  );
  fs.writeFileSync(file, '[1,2]');
  ok(JSON.stringify(c.get()) === '{}' && c.options().inputKey === true, 'a broken config.json reads as empty, with the defaults');

  // the debloat's groups: switching one off while the debloat is on undoes only that group; switching it on again applies only it
  const exec = req('exec'),
    realSh = exec.sh,
    ran = [];
  exec.sh = async c => {
    ran.push(c);
    return { ok: true, out: '' };
  };
  r = await ask('options', 'POST', { debloatOff: ['logs', 'nonsense', 'logs'] });
  ok(
    r.j.options.debloat === true &&
      JSON.stringify(r.j.options.debloatOff) === '["logs"]' &&
      ran.length === 1 &&
      /debloat-undo\.sh logs$/.test(ran[0]),
    'a debloat group switched off is stored (known names, once) and only that group is undone: ' + ran.join(' | ')
  );
  r = await ask('options', 'POST', { debloatOff: ['tracking'] });
  ok(
    ran.length === 3 && /debloat-undo\.sh tracking$/.test(ran[1]) && /debloat-stop\.sh logs$/.test(ran[2]),
    'switching groups undoes the newly off ones and applies the ones switched on again: ' + ran.slice(1).join(' | ')
  );
  r = await ask('options', 'POST', { debloat: false, debloatOff: [] });
  ok(ran.length === 4 && /debloat-undo\.sh$/.test(ran[3]), 'the debloat switched off undoes every group');
  r = await ask('options', 'POST', { debloat: true, debloatOff: ['ads', 'logs', 'suggestions'] });
  ok(
    ran.length === 5 && /debloat-stop\.sh$/.test(ran[4]) && JSON.stringify(conf.options().debloatOff) === '["ads","logs","suggestions"]',
    'switched on with groups off: the groups are stored before debloat-stop.sh reads them'
  );
  exec.sh = realSh;

  // preloaded apps (issue 105): the list is cleaned, and only a background app on the list is closed
  r = await ask('options', 'POST', { closePreloaded: ['netflix', 'netflix', 'com.webos.app.home', 'com.cleanyourtv.picker', 'bad id', 7] });
  ok(JSON.stringify(r.j.options.closePreloaded) === '["netflix"]', 'closePreloaded keeps app ids once and never Home or our own apps');
  const calls = [];
  const pre = req('preload').create({
    config: { options: () => ({ closePreloaded: ['netflix', 'youtube.leanback.v4', 'com.webos.app.browser'] }) },
    luna: async (uri, p) => {
      calls.push(uri.split('/').pop() + (p && p.id ? ':' + p.id : ''));
      if (/\/running$/.test(uri)) return { returnValue: true, running: [{ id: 'netflix' }, { id: 'youtube.leanback.v4' }] };
      if (/getForegroundAppInfo$/.test(uri)) return { returnValue: true, appId: 'youtube.leanback.v4' };
      return { returnValue: true };
    },
  });
  const res = await pre.apply(true);
  ok(
    res.closed.join() === 'netflix' &&
      calls.indexOf('closeByAppId:netflix') >= 0 &&
      calls.every(c => !/youtube|browser/.test(c) || !/^close/.test(c)),
    'only a listed app that runs in the background is closed: ' + calls.join(' ')
  );
});
