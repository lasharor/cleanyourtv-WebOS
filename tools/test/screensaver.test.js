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
  let cfgNow = { wall: { on: true } },
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
          list: () => ['u/aa', 's/immich/bb', 'l/unsplash', 'x/zz'],
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
      x.j.stamp === '2:ab' &&
      x.j.every === 25,
    'GET /api/screensaver/photos with Wallpapers on: the library as Home has it (uploads, source photos, live sources), 25 s each'
  );
  // the other things Home can have behind it, in Home's order (scenes, then Wallpapers, then the theme's wallpaper)
  themeNow = { id: 'still', wallpaper: { id: 'still', file: 'lake.jpg', dim: 0.4 } };
  x = await call(f, '/api/screensaver/photos');
  ok(x.j.photos.join(',') === 'u/aa,s/immich/bb,l/unsplash', 'Wallpapers on wins over the theme wallpaper, as on Home');
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
  x = await call(f, '/api/screensaver/nothing');
  ok(x.code === 404, 'an unknown path of the part is a 404, not a crash');
  ok(saver.replaced() === false, 'without a mount and without the stand-in, nothing is reported as replaced');

  // ---- the files of the boot takeover ----
  if (process.platform !== 'win32') {
    for (const s of [
      '10-cleanyourtv-home',
      '20-cleanyourtv-screensaver',
      'screensaver-standin.sh',
      'stage-screensaver.sh',
      'undo-screensaver.sh',
    ]) {
      const n = cp.spawnSync('sh', ['-n', path.join(root, 'scripts', s)]);
      ok(n.status === 0, s + ' is valid shell');
    }
  }
  // ---- the manager: every "Screen saver" row (CleanYourTV as Home, Features) opens the switch's confirm screen ----
  {
    const menu = fs.readFileSync(path.join(root, 'manager', 'src', 'js', 'menu.js'), 'utf8');
    const rows = menu.split("label: 'Screen saver'").slice(1);
    ok(
      rows.length === 2 && rows.every(r => /^[\s\S]{0,400}?push\('confirm-saver'\)/.test(r)),
      'both "Screen saver" rows of the manager open the confirm screen of the switch (rows: ' + rows.length + ')'
    );
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
  // A setup over a running install (bootstrap.sh install from the manager) copies the new page and calls this script while the folder
  // is already mounted: the page has to be staged then too, as 10-cleanyourtv-home stages Home before it looks whether it is replaced.
  // Seen on the 65UR91006LB: the mounted folder kept the page of the build before.
  const saverBoot = fs.readFileSync(path.join(root, 'scripts', '20-cleanyourtv-screensaver'), 'utf8');
  const stageAt = saverBoot.search(/^sh \$L\/stage-screensaver\.sh/m),
    notReplacedAt = saverBoot.indexOf('if ! replaced; then');
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
    ok(
      JSON.parse(fs.readFileSync(path.join(L, 'wam-launch-saver.json'), 'utf8')).appDesc.id === 'com.webos.app.screensaver',
      'and the request webapp-mgr gets on a TV whose screen saver is a native program'
    );
    // an update that changes the derived manifest and not the page: the shortcut may not skip the stage (it compared index.html only)
    stager({ id: 'com.webos.app.screensaver', type: 'flutter', main: 'saver', defaultWindowType: 'screenSaver', version: '2.0.0' });
    s = stage();
    ok(s.status === 0 && staged().version === '2.0.0', 'a changed derived manifest is staged too, when the page itself did not change');
    ok(!fs.existsSync(path.join(L, '.stage-screensaver')), 'the folder jtool writes into is cleaned up');
  }

  // ---- scripts/screensaver-standin.sh with a luna-send that answers like the TV (the running list lags by seconds after a start) ----
  if (process.platform !== 'win32') {
    const R = path.join(tmp, 'standin'),
      L = path.join(R, 'media/developer/cleanyourtv'),
      BIN = path.join(R, 'bin'),
      LOG = path.join(R, 'boot.log'),
      N = path.join(R, 'readings');
    writeF(path.join(L, 'wam-launch-saver.json'), JSON.stringify({ appDesc: { id: 'com.webos.app.screensaver' }, folderPath: L }));
    writeF(
      path.join(BIN, 'luna-send'),
      [
        '#!/bin/sh',
        'for a in "$@"; do case "$a" in luna://*) uri=$a ;; esac; done',
        'case "$uri" in',
        '  *launchApp*) echo \'{"returnValue": true}\' ;;',
        '  *)',
        '    n=$(cat "$SS_N" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "$SS_N"',
        '    if [ "$n" -ge 2 ] && [ "$n" -le 3 ]; then echo \'{"running": [{"id": "com.webos.app.screensaver"}]}\'',
        '    else echo \'{"running": []}\'; fi ;;',
        'esac',
        '',
      ].join('\n')
    );
    fs.chmodSync(path.join(BIN, 'luna-send'), 0o755);
    const t0 = Date.now();
    const s = cp.spawnSync('sh', [path.join(root, 'scripts', 'screensaver-standin.sh')], {
      encoding: 'utf8',
      timeout: 60000,
      env: Object.assign({}, process.env, {
        PATH: BIN + ':' + process.env.PATH,
        CYTV_DIR: L,
        CYTV_BOOT_LOG: LOG,
        CYTV_SS_SECS: '1',
        SS_N: N,
      }),
    });
    const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
    ok(
      s.status === 0 && /the page is listed/.test(log) && /the page is gone/.test(log),
      'the stand-in waits for the page to be listed and only then calls the screen saver over: ' + log.trim().split('\n').pop()
    );
    ok(Date.now() - t0 >= 2000, 'it did not decide from the first reading of the running apps (the list lags by seconds after a start)');
  }

  cp.spawnSync('rm', ['-rf', tmp]);
});
