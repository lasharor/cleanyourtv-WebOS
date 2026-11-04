// Preloaded apps (preload.js, issues 105 and 148): a stand-in for LG's preload manager that behaves as the one on a real TV did when
// tried (an omitted isEnabled becomes false, mode and type are not checked, isAllowed cannot be changed).
const path = require('path');
const { ok, call, tmp, memoryConfig, req, run } = require('./lib');

const mk = (id, extra) =>
  Object.assign(
    { id, isEnabled: true, isAllowed: true, preloadMode: 'partial', preloadType: 'periodic', requiredMemory: 100, extPolicy: null },
    extra
  );
function tv() {
  const apps = [
    mk('youtube.leanback.v4', { preloadMode: 'semi-full', requiredMemory: 135 }),
    mk('netflix'),
    mk('com.webos.app.browser', { preloadType: 'oneshot' }),
    mk('com.webos.app.home', { extPolicy: [{ preloadMode: 'full', requiredMemory: 50 }] }),
    mk('vudu', { isAllowed: false }),
  ];
  const t = { apps, sets: [], closed: [], running: ['youtube.leanback.v4', 'netflix'], front: 'netflix' };
  t.luna = async (uri, p) => {
    const m = uri.split('/').pop();
    if (m === 'getPreloadPolicy') return { returnValue: true, applications: JSON.parse(JSON.stringify(apps)) };
    if (m === 'setPreloadPolicy') {
      const a = apps.filter(x => x.id === p.application.id)[0];
      if (!a) return { returnValue: false, errorText: 'Cannot find invalid' };
      t.sets.push(JSON.stringify(p));
      a.isEnabled = p.application.isEnabled === true; // omitted: false
      if (p.application.preloadMode) a.preloadMode = p.application.preloadMode;
      if (p.application.preloadType) a.preloadType = p.application.preloadType;
      return { returnValue: true };
    }
    if (m === 'running') return { returnValue: true, running: t.running.map(id => ({ id })) };
    if (m === 'getForegroundAppInfo') return { returnValue: true, appId: t.front };
    if (m === 'closeByAppId') {
      t.closed.push(p.id);
      return { returnValue: true };
    }
    return { returnValue: false };
  };
  return t;
}
const get = (t, id) => t.apps.filter(a => a.id === id)[0];

run(async () => {
  let t = tv();
  const conf = memoryConfig();
  const P = req('preload');
  let pre = P.create({ config: conf, luna: t.luna, baseFile: path.join(tmp, 'base.json') });
  let x = await call(pre, '/api/preload');
  ok(x.j.available && x.j.apps.length === 5 && x.j.modes.indexOf('criu') >= 0, 'GET lists every app of the policy');
  ok(
    x.j.apps[0].mode === 'semi-full' && x.j.apps[0].memory === 135 && x.j.apps[3].managed && !x.j.apps[4].allowed,
    'with mode, memory, managed and allowed'
  );

  // switched off: pushed with isEnabled sent, saved, and closed when it runs in the background
  x = await call(pre, '/api/preload', 'POST', { id: 'youtube.leanback.v4', enabled: false });
  ok(
    get(t, 'youtube.leanback.v4').isEnabled === false && get(t, 'youtube.leanback.v4').preloadMode === 'semi-full',
    'off: the mode is kept'
  );
  ok(/"isEnabled":false/.test(t.sets[0]) && /"permanent":false/.test(t.sets[0]), 'the request always carries isEnabled');
  ok(t.closed.join() === 'youtube.leanback.v4', 'a disabled app that runs in the background is closed');
  ok(conf.options().preloadPolicy['youtube.leanback.v4'].enabled === false && x.j.apps[0].saved, 'the choice is saved');

  // the app in front is not closed; a mode change keeps the type and stays on
  x = await call(pre, '/api/preload', 'POST', { id: 'netflix', enabled: false });
  ok(t.closed.length === 1, 'the app in front is not closed');
  x = await call(pre, '/api/preload', 'POST', { id: 'com.webos.app.browser', mode: 'full' });
  const b = get(t, 'com.webos.app.browser');
  ok(b.preloadMode === 'full' && b.preloadType === 'oneshot' && b.isEnabled, 'a mode change keeps the type and stays on');

  // refused: values the daemon would accept but must not, and apps that cannot change
  const n = t.sets.length;
  x = await call(pre, '/api/preload', 'POST', { id: 'netflix', mode: 'bogus' });
  ok(x.code === 400 && t.sets.length === n, 'an unknown mode is refused before the TV sees it');
  x = await call(pre, '/api/preload', 'POST', { id: 'netflix', type: 'sometimes' });
  ok(x.code === 400, 'an unknown type is refused');
  x = await call(pre, '/api/preload', 'POST', { id: 'netflix', enabled: 'no' });
  ok(x.code === 400, 'enabled must be a boolean');
  x = await call(pre, '/api/preload', 'POST', { id: 'vudu', enabled: true });
  ok(/does not allow/.test(x.j.error) && t.sets.length === n, 'an app LG does not allow is left alone');
  x = await call(pre, '/api/preload', 'POST', { id: 'com.webos.app.home', enabled: false });
  ok(/manages/.test(x.j.error) && t.sets.length === n, 'an app with an extPolicy (Home) is left alone');
  x = await call(pre, '/api/preload', 'POST', { id: 'no.such.app', enabled: false });
  ok(/no preload policy/.test(x.j.error), 'an app the TV does not list is refused');

  // LG sets it back (or the TV rebooted): the service sets the saved choices again, and closes nothing on the periodic check
  get(t, 'youtube.leanback.v4').isEnabled = true;
  t.running.push('youtube.leanback.v4');
  const closed = t.closed.length;
  let r = await pre.apply(false);
  ok(r.changed.indexOf('youtube.leanback.v4') >= 0 && get(t, 'youtube.leanback.v4').isEnabled === false, 'the saved choice is set again');
  ok(t.closed.length === closed, 'the periodic check does not close an app');
  t.front = 'x';
  r = await pre.apply(true);
  ok(
    t.closed.length > closed && t.closed.indexOf('youtube.leanback.v4') >= 0,
    'the check after the boot closes the disabled app that runs'
  );
  r = await pre.apply(false);
  ok(r.changed.length === 0, 'nothing is pushed when the TV already has it');

  // reset: the TV's own values from the boot
  x = await call(pre, '/api/preload', 'POST', { id: 'youtube.leanback.v4', reset: true });
  ok(
    get(t, 'youtube.leanback.v4').isEnabled === true && !conf.options().preloadPolicy['youtube.leanback.v4'],
    'reset: back to the boot value and forgotten'
  );

  // the older list closePreloaded counts as disabled
  t = tv();
  t.front = 'x';
  pre = P.create({
    config: memoryConfig({ options: { closePreloaded: ['netflix', 'youtube.leanback.v4'] } }),
    luna: t.luna,
    baseFile: path.join(tmp, 'base2.json'),
  });
  r = await pre.apply(true);
  ok(!get(t, 'netflix').isEnabled && t.closed.sort().join() === 'netflix,youtube.leanback.v4', 'closePreloaded: disabled and closed');

  // no preload manager (older webOS): the older list still closes what runs
  t = tv();
  t.front = 'x';
  pre = P.create({
    config: memoryConfig({ options: { closePreloaded: ['netflix'] } }),
    luna: async (u, p) => (/preloadmanager/.test(u) ? { returnValue: false, errorText: 'no service' } : t.luna(u, p)),
    baseFile: path.join(tmp, 'base3.json'),
  });
  r = await pre.apply(true);
  ok(r.closed.join() === 'netflix' && /no service/.test(r.error), 'without the preload manager the older list still works');
  x = await call(pre, '/api/preload');
  ok(x.j.available === false, 'and the screen says it is not available');

  // a wake from standby (the wall clock jumps, Node's timers do not): LG sets its policy again, the choices come back at once
  t = tv();
  t.front = 'x';
  pre = P.create({
    config: memoryConfig({ options: { preloadPolicy: { netflix: { enabled: false, mode: 'partial', type: 'periodic' } } } }),
    luna: t.luna,
    baseFile: path.join(tmp, 'base4.json'),
  });
  await pre.apply(false);
  ok(pre.tick(1000) === false && pre.tick(11000) === false, 'wake: ticks 10 s apart are no wake');
  get(t, 'netflix').isEnabled = true; // what LG does at the wake
  ok(pre.tick(20000000) === true, 'wake: a long gap is a wake');
  await new Promise(r => setTimeout(r, 50));
  ok(get(t, 'netflix').isEnabled === false, 'wake: the saved choice is set again at once');

  // the baseline of LG's policy is taken over from the older file in /tmp, then kept in its own file
  t = tv();
  const oldF = path.join(tmp, 'old-base.json'),
    newF = path.join(tmp, 'new-base.json');
  require('fs').writeFileSync(oldF, JSON.stringify({ netflix: { enabled: true, mode: 'partial', type: 'periodic' } }));
  pre = P.create({ config: memoryConfig(), luna: t.luna, baseFile: newF, oldBaseFile: oldF });
  x = await call(pre, '/api/preload');
  ok(
    x.j.apps.filter(a => a.id === 'netflix')[0].base.enabled === true && require('fs').existsSync(newF),
    'baseline: the older file of /tmp is taken over'
  );
  require('fs').unlinkSync(oldF);
  x = await call(pre, '/api/preload');
  ok(x.j.apps.filter(a => a.id === 'netflix')[0].base.enabled === true, 'baseline: kept after the older file is gone');
});
