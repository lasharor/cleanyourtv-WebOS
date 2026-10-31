// The screen saver: our page replaces LG's screen saver app (docs/screensaver.md). What can be checked without a TV: the manifest the
// page runs under, the way the takeover is chosen, and the API the page uses to get its photos and to close itself.
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  cp = require('child_process');
const { root, ok, call, req, run } = require('./lib');
const tv = req('tvprofile');
const saver = req('screensaver');

run(async () => {
  // ---- the way the takeover is chosen (helper/tvprofile.js) ----
  ok(
    tv.decide({ saver: 'com.webos.app.screensaver native' }, []).saverTakeover === 'standin',
    'a native screen saver is replaced by the stand-in over its program (the app manager is not restarted)'
  );
  ok(
    tv.decide({ saver: 'com.webos.app.screensaver qml' }, []).saverTakeover === 'mount',
    'a QML screen saver uses the folder mount (the app manager has to read the new manifest)'
  );
  ok(tv.decide({ saver: 'com.webos.app.screensaver web' }, []).saverTakeover === 'mount', 'a web screen saver uses the folder mount');
  ok(tv.decide({}, []).saverTakeover === 'mount', 'a TV that reports no screen saver kind uses the folder mount');

  // ---- the manifest the page runs under (scripts/jtool.js saver) ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-saver-'));
  const stock = path.join(tmp, 'stock.json'),
    out = path.join(tmp, 'appinfo.json');
  fs.writeFileSync(
    stock,
    JSON.stringify({
      id: 'com.webos.app.screensaver',
      type: 'qml',
      main: 'qml/ScreenSaver.qml',
      qmlIncludePath: 'qml',
      splashBackground: 's.png',
      version: '1.0.0',
    })
  );
  const r = cp.spawnSync(process.execPath, [path.join(root, 'scripts', 'jtool.js'), 'saver', stock, out], { encoding: 'utf8' });
  // a sandbox that has no child processes (the agent's own test run) skips this part; CI and a normal checkout run it
  if (r.error) console.log('skip jtool saver: no child processes here (' + r.error.code + ')');
  else {
    ok(r.status === 0, 'jtool saver writes the manifest of the page');
    const a = JSON.parse(fs.readFileSync(out, 'utf8'));
    ok(
      a.id === 'com.webos.app.screensaver' && a.type === 'web' && a.main === 'index.html',
      "it keeps LG's app id (the TV asks for that id) and runs our index.html"
    );
    ok(
      a.defaultWindowType === 'overlay' && a.transparent === false,
      'it is an overlay: closing the page gives the app that was on screen back'
    );
    ok(!a.splashBackground && !a.qmlIncludePath, "the native and splash settings of LG's screen saver are dropped");
    ok(
      a.noSplashOnLaunch === true && a.spinnerOnLaunch === false,
      'no launch splash or spinner: the page paints black itself (a grey loading screen showed for a second on the TV)'
    );
    ok(a.version === '1.0.0', "everything else of LG's manifest is kept");
  }

  // ---- the page's API (helper/screensaver.js) ----
  const calls = [];
  const ctx = {
    config: { get: () => ({}) },
    luna: async uri => {
      calls.push(uri);
      if (/listRunningApps/.test(uri)) return { returnValue: true, running: [{ id: 'com.webos.app.screensaver' }] };
      return { returnValue: true };
    },
    feature: n => (n === 'wallpapers' ? { list: () => ['u/aa', 'i/bb'], stamp: () => '2:ab' } : null),
  };
  const f = saver.create(ctx);
  let x = await call(f, '/api/screensaver/photos');
  ok(
    x.code === 200 && x.j.photos.length === 2 && x.j.stamp === '2:ab' && x.j.every === 25,
    'GET /api/screensaver/photos: the wallpaper library and the seconds between photos'
  );
  x = await call(f, '/api/screensaver/dismiss', 'POST');
  ok(
    x.code === 200 && calls.some(u => /webappmanager\/killApp/.test(u)),
    'POST /api/screensaver/dismiss: the page is closed through webapp-mgr'
  );
  x = await call(f, '/api/screensaver');
  ok(x.code === 200 && x.j.running === true && x.j.photos === 2, 'GET /api/screensaver: what is replaced and whether the page is up');
  x = await call(f, '/api/screensaver/nothing');
  ok(x.code === 404, 'an unknown path of the part is a 404, not a crash');
  ok(saver.replaced() === false, 'without a mount and without the stand-in, nothing is reported as replaced');

  // ---- the files of the boot takeover ----
  if (process.platform !== 'win32') {
    for (const s of ['10-cleanyourtv-home', '20-cleanyourtv-screensaver', 'screensaver-standin.sh', 'stage-screensaver.sh', 'undo-screensaver.sh']) {
      const n = cp.spawnSync('sh', ['-n', path.join(root, 'scripts', s)]);
      ok(n.status === 0, s + ' is valid shell');
    }
  }
  const boot = fs.readFileSync(path.join(root, 'scripts', 'bootstrap.sh'), 'utf8');
  ok(/20-cleanyourtv-screensaver/.test(boot), 'the setup installs the screen saver boot script');
  ok(/screensaver-appinfo\.orig\.json/.test(boot), "the setup saves LG's screen saver manifest before it is replaced");
  ok(/stage-screensaver\.sh/.test(boot), 'an update puts the new page in the mounted folder');
  const homeBoot = fs.readFileSync(path.join(root, 'scripts', '10-cleanyourtv-home'), 'utf8');
  ok(
    /20-cleanyourtv-screensaver prepare/.test(homeBoot),
    'the Home boot script mounts the screen saver before it restarts the app manager'
  );
  ok(/rm -f \$SAM/.test(homeBoot), 'the marker of that restart starts each boot empty');

  cp.spawnSync('rm', ['-rf', tmp]);
});
