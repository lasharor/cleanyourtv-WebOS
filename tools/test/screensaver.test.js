// The screen saver: our page replaces LG's screen saver app (docs/screensaver.md). What can be checked without a TV: the manifest the
// page runs under, the way the takeover is chosen, the API the page uses to get its photos and to close itself, the idle rule the
// service follows before it opens the page by itself, and the two boot scripts that put the page in place.
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  cp = require('child_process');
const { root, ok, call, req, run } = require('./lib');
const tv = req('tvprofile');
const saver = req('screensaver');
const P = req('paths');

// write a file, creating the folders above it (fs.mkdirSync's own "recursive" is newer than Node 8.12)
function writeF(file, data) {
  const missing = [];
  let d = path.dirname(file);
  while (!fs.existsSync(d)) {
    missing.unshift(d);
    d = path.dirname(d);
  }
  for (const m of missing) fs.mkdirSync(m);
  fs.writeFileSync(file, data);
}

run(async () => {
  // ---- the way the takeover is chosen (helper/tvprofile.js) ----
  ok(
    tv.decide({ saver: 'com.webos.app.screensaver native' }, []).saverTakeover === 'none',
    'a native screen saver is not replaced in this version (no way for it was tried on a TV)'
  );
  ok(
    tv.decide({ saver: 'com.webos.app.screensaver qml' }, []).saverTakeover === 'mount',
    'a QML screen saver uses the folder mount (the app manager has to read the new manifest)'
  );
  ok(tv.decide({ saver: 'com.webos.app.screensaver web' }, []).saverTakeover === 'mount', 'a web screen saver uses the folder mount');
  ok(tv.decide({}, []).saverTakeover === 'mount', 'a TV that reports no screen saver kind uses the folder mount');
  // supported: the folder mount is read by the app manager restart of the Home takeover's own folder mount, the way tried on a TV;
  // the Home stand-in (LG's native Home) does no such restart, so those TVs keep LG's screen saver in this version
  ok(
    saver.supported({ saverTakeover: 'mount', homeTakeover: 'mount' }) &&
      saver.supported({ saverTakeover: 'mount', homeTakeover: 'standin' }, 'mount') &&
      !saver.supported({ saverTakeover: 'mount', homeTakeover: 'standin' }) &&
      !saver.supported({ saverTakeover: 'none', homeTakeover: 'mount' }) &&
      !saver.supported({}),
    "supported only where the saver's folder can share the Home takeover's app manager restart (also with home-method mount)"
  );

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
      a.defaultWindowType === 'screenSaver' && a.transparent === false,
      "it keeps LG's screenSaver window type: tvpowerd only counts that as the screen saver"
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
  // what Home has behind it, changed by each case below: the config (Wallpapers on or off), the resolved theme, an add-on's scenes
  let libNow = ['u/aa', 's/immich/bb', 'l/unsplash', 'x/zz'],
    cfgNow = { wall: { on: true } },
    themeNow = null,
    scenesNow = { scenes: [] },
    askedCc = null;
  const ctx = {
    config: { get: () => cfgNow },
    luna: async uri => {
      calls.push(uri);
      if (/listRunningApps/.test(uri)) return { returnValue: true, running: [{ id: 'com.webos.app.screensaver' }] };
      return { returnValue: true };
    },
    // an upload, a photo of a source add-on, a live source (the page asks /api/wallpapers/live/<add-on> for its photo, as Home does)
    // and an id of a kind the page does not know
    feature: n => {
      if (n === 'wallpapers')
        return {
          list: () => libNow,
          stamp: () => '2:ab',
          liveCurrent: async id =>
            id === 'unsplash' ? { url: 'https://images.example.com/now.jpg', credit: 'Photo by D' } : { error: 'not a live source' },
        };
      if (n === 'theme') return { resolved: () => themeNow };
      if (n === 'scenes')
        return {
          list: async cc => {
            askedCc = cc;
            return scenesNow;
          },
        };
      return null;
    },
  };
  const f = saver.create(ctx);
  let x = await call(f, '/api/screensaver/photos');
  ok(
    x.code === 200 &&
      x.j.photos.join(',') === 'u/aa,s/immich/bb,l/unsplash' &&
      x.j.from === 'wallpapers' &&
      x.j.stamp === undefined &&
      x.j.every === 25,
    'GET /api/screensaver/photos with Wallpapers on: the library as Home has it (uploads, source photos, live sources), 25 s each'
  );
  // the other things Home can have behind it, in Home's order (scenes, then Wallpapers, then the theme's wallpaper)
  themeNow = { id: 'still', wallpaper: { id: 'still', file: 'lake.jpg', dim: 0.4 } };
  x = await call(f, '/api/screensaver/photos');
  ok(x.j.photos.join(',') === 'u/aa,s/immich/bb,l/unsplash', 'Wallpapers on wins over the theme wallpaper, as on Home');
  // Wallpapers on with nothing in the library: Home's wall.js switches its layer off and the theme's wallpaper shows, so the saver
  // shows that too (it showed black)
  libNow = [];
  x = await call(f, '/api/screensaver/photos');
  ok(
    x.j.photos.join(',') === '/api/theme/wallpaper/still/lake.jpg' && x.j.from === 'theme',
    "Wallpapers on with an empty library: the theme's wallpaper, as on Home, not black"
  );
  libNow = ['u/aa', 's/immich/bb', 'l/unsplash', 'x/zz'];
  cfgNow = { wall: { on: false } };
  x = await call(f, '/api/screensaver/photos');
  ok(
    x.j.photos.join(',') === '/api/theme/wallpaper/still/lake.jpg' && x.j.from === 'theme',
    "Wallpapers off: the theme's own wallpaper, the one Home shows"
  );
  themeNow = { id: 'plain' };
  x = await call(f, '/api/screensaver/photos');
  ok(x.j.photos.length === 0 && x.j.from === '', 'no wallpaper on Home: nothing, so the page shows the clock on black');
  themeNow = { id: 'couchtv', scenes: { set: 'couch', secs: 20 }, wallpaper: { id: 'couchtv', file: 'x.jpg', dim: 0.4 } };
  cfgNow = { wall: { on: true } };
  x = await call(f, '/api/screensaver/photos?cc=nl');
  ok(
    x.j.photos.join(',') ===
      '/api/screensaver/scene/night,/api/screensaver/scene/golden,/api/screensaver/scene/water,/api/screensaver/scene/fog,/api/screensaver/scene/dawn' &&
      x.j.from === 'scenes' &&
      askedCc === 'NL',
    "the couch scenes take the place of Wallpapers and the theme wallpaper, as on Home: the launcher's five landscapes"
  );
  scenesNow = { addon: 'seasons', scenes: [{ id: 'w1', credit: 'Photo: A' }, { id: 'w2' }] };
  x = await call(f, '/api/screensaver/photos?cc=NL');
  ok(
    x.j.photos.join(',') === '/api/scenes/photo/seasons/w1/image,/api/scenes/photo/seasons/w2/image' &&
      x.j.credits['/api/scenes/photo/seasons/w1/image'] === 'Photo: A',
    "an add-on's scenes stand in for the five landscapes (asked with the TV's country), with their credit line"
  );
  themeNow = {
    id: 'mine',
    scenes: { set: 'custom', secs: 20, id: 'mine', lib: [{ id: 'a', image: 'a.jpg', glass: 'a-g.jpg' }] },
  };
  x = await call(f, '/api/screensaver/photos');
  ok(x.j.photos.join(',') === '/api/theme/scene/mine/a.jpg', "a theme's own scenes: its scene images");
  // the launcher's landscapes are handed out by name, only these five
  {
    const appDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-scene-')), 'app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.join(appDir, 'scene-fog.jpg'), 'jpg');
    const was = P.APP;
    P.APP = appDir;
    const a = await call(f, '/api/screensaver/scene/fog'),
      b = await call(f, '/api/screensaver/scene/beach'),
      c = await call(f, '/api/screensaver/scene/..');
    P.APP = was;
    ok(
      a.code === 200 && String(a.out) === 'jpg' && b.code === 404 && c.code === 404,
      'GET /api/screensaver/scene/<id>: a couch scene, nothing else'
    );
  }
  x = await call(f, '/api/screensaver/live/unsplash');
  ok(
    x.j.url === 'https://images.example.com/now.jpg' && x.j.credit === 'Photo by D',
    "GET /api/screensaver/live/<add-on>: the live photo Home has now (the wallpapers part's liveCurrent)"
  );
  cfgNow = { wall: { on: true } };
  themeNow = null;

  // the page asks for each kind of id the way Home's wall.js does: a file from the library, or the live source's current photo
  {
    const html = fs.readFileSync(path.join(root, 'screensaver', 'app', 'index.html'), 'utf8');
    const src = html.slice(html.indexOf('function photoRequest'), html.indexOf('/* end photoRequest */'));
    const sandbox = { API: 'http://127.0.0.1:8765' };
    require('vm').runInNewContext(src, sandbox);
    ok(
      sandbox.photoRequest('/api/screensaver/scene/fog').photo === 'http://127.0.0.1:8765/api/screensaver/scene/fog',
      'a path from the service (a scene, the theme wallpaper) is loaded as it is'
    );
    const u = sandbox.photoRequest('u/aa'),
      s = sandbox.photoRequest('s/immich/bb'),
      l = sandbox.photoRequest('l/unsplash');
    ok(
      u.photo === 'http://127.0.0.1:8765/api/wallpapers/photo/u/aa' &&
        s.photo === 'http://127.0.0.1:8765/api/wallpapers/photo/s/immich/bb' &&
        l.live === 'http://127.0.0.1:8765/api/screensaver/live/unsplash' &&
        !l.photo,
      'the page loads a library photo directly and asks a live source for its current photo (the same photo as Home)'
    );
  }
  x = await call(f, '/api/screensaver/dismiss', 'POST');
  ok(
    x.code === 200 && calls.some(u => /webappmanager\/killApp/.test(u)),
    'POST /api/screensaver/dismiss: the page is closed through webapp-mgr'
  );
  {
    // the timer while the saver is replaced (helper/screensaver.js tick): no two checks at once, and while the page is down the
    // running list is read every third tick (30 s), not every ten seconds all day
    const procDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-proc-'));
    fs.writeFileSync(path.join(procDir, 'mounts'), 'x ' + P.SCREENSAVER_APP + ' ext4 rw 0 0\n');
    const wasProc = P.PROC;
    P.PROC = procDir;
    let lists = 0,
      release = null;
    const slow = saver.create({
      config: { get: () => ({}) },
      luna: async uri => {
        if (/listRunningApps/.test(uri)) {
          lists++;
          if (release === null) await new Promise(r => (release = r)); // the first reading hangs until released
          return { running: [] };
        }
        return { returnValue: true, appId: 'x' };
      },
      feature: () => null,
    });
    const first = slow.tick();
    await slow.tick(); // while the first check still waits for luna
    release();
    await first;
    ok(lists === 1, 'a tick that comes while the previous check still runs does nothing (one reading, not ' + lists + ')');
    lists = 0;
    for (let i = 0; i < 6; i++) await slow.tick();
    ok(lists === 2, 'with the page down, the running list is read every third tick: 2 readings in 6 ticks (' + lists + ')');
    P.PROC = wasProc;
  }
  {
    // the safety close (a page the system left behind): only when the TV reads as on an app again at two checks in a row, after the
    // first minute; one reading without "Screen Saver" in processing (another build, a moment between states) closes nothing
    const procDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-proc-'));
    fs.writeFileSync(path.join(procDir, 'mounts'), 'x ' + P.SCREENSAVER_APP + ' ext4 rw 0 0\n');
    const wasProc = P.PROC;
    P.PROC = procDir;
    const realNow = Date.now;
    let now = realNow(),
      power = {},
      kills = 0;
    Date.now = () => now;
    const g = saver.create({
      config: { get: () => ({}) },
      luna: async uri => {
        if (/listRunningApps/.test(uri)) return { running: [{ id: 'com.webos.app.screensaver' }] };
        if (/getPowerState/.test(uri)) return power;
        if (/killApp/.test(uri)) kills++;
        return { returnValue: true };
      },
      feature: () => null,
    });
    try {
      await g.tick(); // the page is up: the minute starts
      now += 61000;
      power = { state: 'Active' };
      await g.tick();
      ok(kills === 0, 'one reading of "Active" without the screen saver in processing closes nothing');
      power = { state: 'Active', processing: 'Screen Saver Ready' };
      await g.tick();
      power = { state: 'Active' };
      await g.tick();
      ok(kills === 0, 'a reading with "Screen Saver Ready" in between starts the count again');
      await g.tick();
      ok(kills === 1, 'two readings in a row of "Active" without the screen saver close the page');
    } finally {
      Date.now = realNow;
      P.PROC = wasProc;
    }
  }
  {
    // webapp-mgr's killApp failing must not stop the app manager's own way out, nor turn the dismissal into an error
    const seen = [];
    const g = saver.create({
      config: { get: () => ({}) },
      luna: async uri => {
        seen.push(uri);
        if (/killApp/.test(uri)) throw new Error('killApp refused');
        return { returnValue: true };
      },
      feature: () => null,
    });
    const d = await call(g, '/api/screensaver/dismiss', 'POST');
    ok(
      d.code === 200 && seen.some(u => /closeByAppId/.test(u)),
      'dismiss: closeByAppId still runs when killApp fails, and the page gets {returnValue: true}'
    );
  }
  x = await call(f, '/api/screensaver/active', 'POST');
  ok(
    x.code === 200 && x.j.returnValue === true && f.lastActive() > 0,
    'POST /api/screensaver/active: the launcher reports a key, so the service knows the TV is in use'
  );
  // the rule the fallback timer follows: "Home is in front" is not "idle" (a TV being browsed with the remote is Home all evening)
  const now = 1000000;
  ok(
    !saver.mayOpen(now, now - 130000, 0) &&
      saver.mayOpen(now, now - 130000, now - 121000) &&
      !saver.mayOpen(now, now - 130000, now - 60000) &&
      !saver.mayOpen(now, now - 30000, now - 300000),
    'the page is opened by the service only over an idle launcher: no report is no reason to open it, and a key holds it back for two minutes'
  );
  x = await call(f, '/api/screensaver');
  ok(x.code === 200 && x.j.running === true && x.j.photos === 3, 'GET /api/screensaver: what is replaced and whether the page is up');
  ok(x.j.failed === undefined && x.j.method === undefined, 'GET /api/screensaver: no stand-in fields (method, failed) any more');
  {
    const menu = fs.readFileSync(path.join(root, 'manager', 'src', 'js', 'menu.js'), 'utf8');
    ok(
      (menu.match(/fn: openSaver/g) || []).length === 2 && /supported === false/.test(menu) && /not available on this TV yet/.test(menu),
      'both manager rows say when this TV cannot have our screen saver, instead of offering the switch'
    );
    const mgr = fs.readFileSync(path.join(root, 'helper', 'manager.js'), 'utf8');
    ok(/supported: saver\.supported\(/.test(mgr) && !/SA_FAILED/.test(mgr), "the manager's status carries saver.supported");
  }
  x = await call(f, '/api/screensaver/nothing');
  ok(x.code === 404, 'an unknown path of the part is a 404, not a crash');
  ok(saver.replaced() === false, 'without a mount, nothing is reported as replaced');

  // ---- the files of the boot takeover ----
  if (process.platform !== 'win32') {
    for (const s of ['10-cleanyourtv-home', '20-cleanyourtv-screensaver', 'stage-screensaver.sh', 'undo-screensaver.sh']) {
      const n = cp.spawnSync('sh', ['-n', path.join(root, 'scripts', s)]);
      ok(n.status === 0, s + ' is valid shell');
    }
  }
  // ---- the manager: every "Screen saver" row (CleanYourTV as Home, Features) opens the switch's confirm screen ----
  {
    const menu = fs.readFileSync(path.join(root, 'manager', 'src', 'js', 'menu.js'), 'utf8');
    const rows = menu.split("label: 'Screen saver'").slice(1);
    ok(
      rows.length === 2 &&
        rows.every(r => /^[\s\S]{0,400}?fn: openSaver/.test(r)) &&
        /function openSaver\(\) \{[\s\S]{0,400}?push\('confirm-saver'\)/.test(menu),
      'both "Screen saver" rows of the manager open the confirm screen of the switch (rows: ' + rows.length + ')'
    );
  }

  const boot = fs.readFileSync(path.join(root, 'scripts', 'bootstrap.sh'), 'utf8');
  ok(
    !/ln -sf \$D\/20-cleanyourtv-screensaver/.test(boot) && !/20-cleanyourtv-screensaver setup/.test(boot),
    'the setup neither links the screen saver script into the boot scripts nor runs it: only 10-cleanyourtv-home calls it'
  );
  ok(/screensaver-appinfo\.orig\.json/.test(boot), "the setup saves LG's screen saver manifest before it is replaced");
  ok(/stage-screensaver\.sh/.test(boot), 'an update puts the new page in the mounted folder');
  const homeBoot = fs.readFileSync(path.join(root, 'scripts', '10-cleanyourtv-home'), 'utf8');
  ok(
    /20-cleanyourtv-screensaver prepare/.test(homeBoot),
    'the Home boot script mounts the screen saver before it restarts the app manager'
  );
  // off by default (the maintainer's review): the screen saver is replaced only while SCREENSAVER-ON is there, which only the manager's
  // switch writes; without it the Home boot script does not even start the screen saver script, so a boot is as without this feature
  ok(
    /\[ -e \$L\/SCREENSAVER-ON \] && sh \$L\/20-cleanyourtv-screensaver prepare/.test(homeBoot),
    'the Home boot script calls the screen saver script only while SCREENSAVER-ON is there'
  );
  {
    const mgr = fs.readFileSync(path.join(root, 'helper', 'manager.js'), 'utf8');
    ok(
      /enabled: fs\.existsSync\(P\.SA_ON\)/.test(mgr) && !/SA_DISABLE/.test(mgr),
      "the manager's switch is the SCREENSAVER-ON file: absent (a new install, an update) means LG's screen saver"
    );
    ok(P.SA_ON === P.D + '/SCREENSAVER-ON' && P.SA_DISABLE === undefined, 'paths.js names SCREENSAVER-ON, not DISABLE-SCREENSAVER');
  }
  // A setup over a running install (bootstrap.sh install from the manager) copies the new page and calls this script while the folder
  // is already mounted: the page has to be staged then too, as 10-cleanyourtv-home stages Home before it looks whether it is replaced.
  // Seen on the 65UR91006LB: the mounted folder kept the page of the build before.
  const saverBoot = fs.readFileSync(path.join(root, 'scripts', '20-cleanyourtv-screensaver'), 'utf8');
  const stageAt = saverBoot.search(/^sh \$L\/stage-screensaver\.sh/m),
    notReplacedAt = saverBoot.indexOf('grep -q " $H " $MOUNTS && exit 0');
  ok(
    stageAt >= 0 && notReplacedAt >= 0 && stageAt < notReplacedAt,
    'the screen saver boot script stages the page on every run, also when the folder is already mounted'
  );

  // ---- scripts/stage-screensaver.sh, run against a folder that stands in for the TV's root (CYTV_TEST_ROOT) ----
  if (process.platform !== 'win32') {
    const R = path.join(tmp, 'tv'),
      L = path.join(R, 'media/developer/cleanyourtv'),
      H = path.join(R, 'usr/palm/applications/com.webos.app.screensaver'),
      S = path.join(L, 'screensaver-overlay'),
      page = '<!doctype html><p>the screen saver page</p>';
    const stager = manifest => writeF(path.join(L, 'backup/screensaver-appinfo.orig.json'), JSON.stringify(manifest));
    writeF(path.join(H, 'appinfo.json'), JSON.stringify({ id: 'com.webos.app.screensaver', type: 'flutter', main: 'saver' }));
    writeF(path.join(H, 'icon.png'), 'png');
    writeF(path.join(L, 'jtool.js'), fs.readFileSync(path.join(root, 'scripts', 'jtool.js'), 'utf8'));
    writeF(path.join(L, 'screensaver/app/index.html'), page);
    stager({ id: 'com.webos.app.screensaver', type: 'flutter', main: 'saver', defaultWindowType: 'screenSaver', version: '1.0.0' });
    const stage = () =>
      cp.spawnSync('sh', [path.join(root, 'scripts', 'stage-screensaver.sh')], {
        encoding: 'utf8',
        timeout: 60000,
        env: Object.assign({}, process.env, { CYTV_TEST_ROOT: R }),
      });
    const staged = () => JSON.parse(fs.readFileSync(path.join(S, 'appinfo.json'), 'utf8'));
    let s = stage();
    ok(
      s.status === 0 && staged().type === 'web' && staged().main === 'index.html' && staged().defaultWindowType === 'screenSaver',
      "stage-screensaver.sh stages the folder that goes over LG's app: a web app that keeps LG's window type" +
        (s.status ? ': ' + s.stderr : '')
    );
    ok(fs.readFileSync(path.join(S, 'index.html'), 'utf8') === page, 'the page is staged next to the manifest');
    ok(fs.readFileSync(path.join(S, 'icon.png'), 'utf8') === 'png', "LG's own icons are copied, so the derived manifest finds them");
    ok(!fs.existsSync(path.join(L, 'wam-launch-saver.json')), 'no request for webapp-mgr is written any more (that was the stand-in)');
    // an update that changes the derived manifest and not the page: the shortcut may not skip the stage (it compared index.html only)
    stager({ id: 'com.webos.app.screensaver', type: 'flutter', main: 'saver', defaultWindowType: 'screenSaver', version: '2.0.0' });
    s = stage();
    ok(s.status === 0 && staged().version === '2.0.0', 'a changed derived manifest is staged too, when the page itself did not change');
    ok(!fs.existsSync(path.join(L, '.stage-screensaver')), 'the folder jtool writes into is cleaned up');
  }

  // ---- scripts/20-cleanyourtv-screensaver itself, in a folder that stands in for the TV, with fake mount, systemctl and luna-send ----
  // (the $SAM / prepare coordination with 10-cleanyourtv-home and the setup is what these runs check; not on Windows: no sh there)
  if (process.platform !== 'win32') {
    // opts: kind (LG's screen saver: flutter, qml, native), args, on (SCREENSAVER-ON, default true), mounted (the folder is already)
    const saverRun = opts => {
      const R = fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-saverboot-'));
      const L = path.join(R, 'media/developer/cleanyourtv'),
        H = path.join(R, 'usr/palm/applications/com.webos.app.screensaver'),
        BIN = path.join(R, 'bin'),
        MOUNTS = path.join(R, 'mounts'),
        CALLS = path.join(R, 'calls');
      const exe = path.join(H, 'ScreenSaver');
      writeF(path.join(H, 'appinfo.json'), '{}');
      writeF(exe, 'LG');
      const stock = { id: 'com.webos.app.screensaver', type: opts.kind, main: opts.kind === 'native' ? exe : 'qml/main.qml' };
      writeF(path.join(L, 'backup', 'screensaver-appinfo.orig.json'), JSON.stringify(stock));
      writeF(path.join(L, 'screensaver', 'app', 'index.html'), '<p>saver</p>');
      fs.copyFileSync(path.join(root, 'helper', 'tvprofile.js'), path.join(L, 'tvprofile.js'));
      for (const s of ['jtool.js', 'stage-screensaver.sh']) fs.copyFileSync(path.join(root, 'scripts', s), path.join(L, s));
      writeF(path.join(R, 'tmp', '.keep'), '');
      if (opts.on !== false) writeF(path.join(L, 'SCREENSAVER-ON'), '');
      writeF(MOUNTS, opts.mounted ? 'x ' + H + ' ext4 rw 0 0\n' : '');
      const fake = (n, body) => {
        writeF(path.join(BIN, n), '#!/bin/sh\n' + body + '\n');
        fs.chmodSync(path.join(BIN, n), 0o755);
      };
      // a fake mount that notes the call and the mount; systemctl and luna-send only note that they were called (they never should be)
      fake('mount', 'echo "mount $*" >> "$CYTV_CALLS"; echo "x $3 ext4 rw 0 0" >> "$CYTV_MOUNTS"');
      fake('systemctl', 'echo "systemctl $*" >> "$CYTV_CALLS"; exit 0');
      fake('luna-send', 'echo "luna $*" >> "$CYTV_CALLS"; echo \'{"returnValue": true}\'');
      const r = cp.spawnSync('sh', [path.join(root, 'scripts', '20-cleanyourtv-screensaver')].concat(opts.args || []), {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { CYTV_TEST_ROOT: R, CYTV_TEST_BIN: BIN, CYTV_MOUNTS: MOUNTS, CYTV_CALLS: CALLS }),
      });
      const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
      const out = {
        status: r.status,
        calls: read(CALLS),
        mounts: read(MOUNTS),
        log: read(path.join(R, 'tmp', 'cleanyourtv-boot.log')),
        H,
        exe,
      };
      rmrf(R);
      return out;
    };
    const mounted = (o, p) => o.mounts.indexOf(' ' + p + ' ') >= 0;

    // the script is called only by 10-cleanyourtv-home ("prepare"), right before the app manager restart of its Home takeover, and
    // never restarts the app manager itself: the way that was tried on a TV (one restart reads both folders)
    const noRestart = o => !/systemctl/.test(o.calls);
    let o = saverRun({ kind: 'qml', args: ['prepare'], on: false });
    ok(!mounted(o, o.H) && noRestart(o) && o.mounts === '', 'switched off (no SCREENSAVER-ON, the default): nothing is mounted');
    o = saverRun({ kind: 'flutter', args: ['prepare'] });
    ok(
      mounted(o, o.H) && noRestart(o),
      "prepare, a Flutter screen saver (the tested TV's): the folder is mounted for the Home takeover's restart, none of its own"
    );
    o = saverRun({ kind: 'qml', args: ['prepare'] });
    ok(mounted(o, o.H) && noRestart(o), 'prepare, a QML screen saver: the folder is mounted, no restart of its own');
    o = saverRun({ kind: 'qml' });
    ok(
      !mounted(o, o.H) && noRestart(o),
      "run by itself (an old boot-script link, or by hand): nothing is mounted without the Home takeover's restart"
    );
    o = saverRun({ kind: 'native', args: ['prepare'] });
    ok(
      !mounted(o, o.H) && !mounted(o, o.exe) && noRestart(o) && /native program/.test(o.log),
      'a native screen saver: not replaced in this version, and the boot log says so'
    );
    o = saverRun({ kind: 'qml', args: ['prepare'], mounted: true });
    ok(!/mount --bind/.test(o.calls) && noRestart(o), 'already mounted (a setup over a running install): staged, not mounted twice');
  }

  rmrf(tmp);
});

// remove a folder and what is in it (fs.rmSync and the "recursive" options are newer than Node 8.12; "rm -rf" is not on Windows)
function rmrf(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch (_) {
    return;
  }
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) rmrf(path.join(p, f));
    fs.rmdirSync(p);
  } else fs.unlinkSync(p);
}
