// The shell side: the scripts parse, and the setup keeps the options the user chose (issues 6 and 7).
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, run, sleep } = require('./lib');

run(async () => {
  const scripts = fs
    .readdirSync(path.join(root, 'scripts'))
    .filter(f => !/\.js$/.test(f))
    .map(f => path.join('scripts', f))
    .concat(['install.sh', 'uninstall.sh', 'tools/diagnose.sh']);
  for (const f of scripts) {
    const r = cp.spawnSync('sh', ['-n', path.join(root, f)], { encoding: 'utf8' });
    ok(r.status === 0, 'shell syntax ' + f + (r.status ? ': ' + r.stderr : ''));
  }
  const jt = path.join(root, 'scripts', 'jtool.js'),
    cfg = path.join(tmp, 'config.json');
  const opts = function () {
    return cp.spawnSync(process.execPath, [jt, 'options', cfg].concat([].slice.call(arguments)), { encoding: 'utf8' });
  };
  fs.writeFileSync(cfg, JSON.stringify({ options: { inputKey: false, debloat: false, liveTv: false }, keep: 1 }));
  let r = opts('', '');
  let c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  ok(
    r.status === 0 && c.options.inputKey === false && c.options.debloat === false && c.options.liveTv === false && c.keep === 1,
    'an update (no values) keeps Input key, Debloat and Live TV as they were'
  );
  ok(/\(kept\)/.test(r.stdout), 'the setup log says the options were kept');
  r = opts('1', '1');
  c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  ok(
    c.options.inputKey === true && c.options.debloat === true && /were/.test(r.stdout),
    'setup with values sets them and says what they were'
  );
  fs.writeFileSync(cfg, '{}');
  opts('', '');
  c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  ok(c.options.inputKey === true && c.options.debloat === true, 'a first install without values defaults both to on');
  // the stand-in way (LG's native Home): the program it is mounted over, and the request to webapp-mgr
  const jtool = args => cp.spawnSync(process.execPath, [jt].concat(args), { encoding: 'utf8' });
  const prog = path.join(tmp, 'lg-home-program'),
    nat = path.join(tmp, 'native-home.json');
  fs.writeFileSync(prog, '');
  fs.writeFileSync(nat, JSON.stringify({ id: 'com.webos.app.home', type: 'native', main: prog }));
  r = jtool(['exe', nat]);
  ok(r.status === 0 && r.stdout.trim() === prog, "jtool exe: the program of LG's native Home");
  fs.writeFileSync(nat, JSON.stringify({ id: 'com.webos.app.home', type: 'native', main: path.join(tmp, 'missing') }));
  ok(jtool(['exe', nat]).status === 1, 'jtool exe: a missing program is reported, so the mount way is used instead');
  const ov = path.join(tmp, 'overlay.json'),
    req = path.join(tmp, 'wam-launch.json');
  fs.writeFileSync(ov, JSON.stringify({ id: 'com.webos.app.home', type: 'web', main: 'index.html' }));
  jtool(['wamlaunch', ov, '/media/developer/cleanyourtv/home-overlay', req]);
  const q = JSON.parse(fs.readFileSync(req, 'utf8')),
    qs = JSON.parse(fs.readFileSync(req + '.str', 'utf8'));
  ok(
    q.appDesc.id === 'com.webos.app.home' &&
      q.appDesc.type === 'web' &&
      q.appDesc.folderPath === '/media/developer/cleanyourtv/home-overlay' &&
      JSON.parse(qs.appDesc).folderPath === q.appDesc.folderPath,
    'jtool wamlaunch: webapp-mgr opens the launcher folder as com.webos.app.home (also with the description as a string)'
  );
  // bootstrap.sh run for real against a folder that stands in for the TV's root (CYTV_TEST_ROOT), with stand-ins for luna-send and systemctl
  const R = path.join(tmp, 'root'),
    S = path.join(tmp, 'pkg'),
    BIN = path.join(tmp, 'bin');
  const write = (f, data, mode) => {
    cp.spawnSync('mkdir', ['-p', path.dirname(f)]);
    fs.writeFileSync(f, data);
    if (mode) fs.chmodSync(f, mode);
  };
  const copyDir = (from, to, filter) => {
    cp.spawnSync('mkdir', ['-p', to]);
    for (const n of fs.readdirSync(from)) if (!filter || filter(n)) fs.copyFileSync(path.join(from, n), path.join(to, n));
  };
  copyDir(path.join(root, 'helper'), path.join(S, 'helper'), n => /\.js$/.test(n));
  copyDir(path.join(root, 'scripts'), path.join(S, 'scripts'), n => n !== 'bootstrap.sh');
  fs.copyFileSync(path.join(root, 'scripts', 'bootstrap.sh'), path.join(S, 'bootstrap.sh'));
  write(path.join(S, 'inputhook', 'ezinject'), '', 0o755);
  write(path.join(S, 'inputhook', 'libinputhookpp.so'), '');
  fs.copyFileSync(path.join(root, 'compat.json'), path.join(S, 'compat.json'));
  fs.copyFileSync(path.join(root, 'config.example.json'), path.join(S, 'config.example.json'));
  write(path.join(S, 'payload', 'app', 'index.html'), '<!doctype html>');
  fs.copyFileSync(path.join(root, 'app', 'version.json'), path.join(S, 'payload', 'app', 'version.json'));
  write(
    path.join(R, 'usr/palm/applications/com.webos.app.home/appinfo.json'),
    JSON.stringify({ id: 'com.webos.app.home', type: 'flutter' })
  );
  const NA = path.join(R, 'media/developer/apps/usr/palm/applications/com.cleanyourtv.notify/appinfo.json');
  write(NA, JSON.stringify({ id: 'com.cleanyourtv.notify', defaultWindowType: 'topui' }));
  cp.spawnSync('mkdir', ['-p', path.join(R, 'var/lib/webosbrew/init.d')]);
  write(
    path.join(BIN, 'luna-send'),
    '#!/bin/sh\necho \'{"returnValue": true, "modelName": "OLED55CX3LA", "firmwareVersion": "04.30.10", "sdkVersion": "5.4.3"}\'\n',
    0o755
  );
  write(path.join(BIN, 'systemctl'), '#!/bin/sh\nexit 0\n', 0o755);
  const boot = args =>
    cp.spawnSync('sh', [path.join(S, 'bootstrap.sh')].concat(args), {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { PATH: process.env.PATH + ':' + BIN, CYTV_TEST_ROOT: R }),
      timeout: 60000,
    });
  const D = path.join(R, 'media/developer/cleanyourtv');
  let b = boot(['install', '--no-start', '--no-input-key']);
  const out1 = b.stdout + b.stderr;
  ok(b.status === 0, 'bootstrap.sh install runs to the end (' + (b.status === 0 ? 'ok' : out1.slice(-400)) + ')');
  ok(
    /webOS SDK 5\.4\.3/.test(out1) && /not in the compatibility list; continuing because LG's Home is the flutter or web kind/.test(out1),
    'it reads the TV and accepts a flutter Home that is not in the list'
  );
  ok(
    JSON.parse(fs.readFileSync(NA, 'utf8')).defaultWindowType === 'overlay' && /use the overlay window/.test(out1),
    'on SDK 5 the notification app gets the overlay window (tvprofile.js)'
  );
  ok(
    fs.existsSync(path.join(D, 'helper.js')) &&
      fs.existsSync(path.join(D, 'tvprofile.js')) &&
      fs.existsSync(path.join(D, 'app', 'version.json')),
    'the service files and the launcher are in place'
  );
  let conf = JSON.parse(fs.readFileSync(path.join(D, 'config.json'), 'utf8'));
  ok(conf.options.inputKey === false && conf.options.debloat === true, 'the setup stores the chosen options');
  const initd = path.join(R, 'var/lib/webosbrew/init.d');
  ok(
    fs.lstatSync(path.join(initd, '10-cleanyourtv-home')).isSymbolicLink() &&
      fs.lstatSync(path.join(initd, '15-cleanyourtv-debloat')).isSymbolicLink(),
    'the boot scripts are linked'
  );
  const stdinFlag = path.join(D, 'luna-stdin-open');
  fs.writeFileSync(stdinFlag, '');
  b = boot(['update', '1.6.0', '--no-start']);
  const out2 = b.stdout + b.stderr;
  conf = JSON.parse(fs.readFileSync(path.join(D, 'config.json'), 'utf8'));
  ok(
    b.status === 0 && conf.options.inputKey === false && /options: .*\(kept\)/.test(out2),
    'an update keeps the Input key switched off (issues 6 and 7)'
  );
  ok(fs.existsSync(path.join(D, 'backup', 'service-prev.tgz')), 'an update keeps the previous service files for a rollback');
  ok(fs.existsSync(stdinFlag), 'an update preserves the Luna stdin opt-in flag');
  fs.writeFileSync(
    path.join(R, 'usr/palm/applications/com.webos.app.home/appinfo.json'),
    JSON.stringify({ id: 'com.webos.app.home', type: 'native' })
  );
  fs.unlinkSync(path.join(D, 'backup', 'home-appinfo.orig.json'));
  b = boot(['install', '--no-start']);
  ok(
    b.status !== 0 && /Set up anyway/.test(b.stderr),
    'a native Home that is not in the list stops the setup with the hint to set up anyway'
  );
  b = boot(['install', '--no-start', '--force']);
  ok(b.status === 0 && /continuing because of --force/.test(b.stderr), 'with --force it continues');

  // bootstrap.sh asks tvprofile.js for the per-TV decisions instead of deciding itself
  const bootText = fs.readFileSync(path.join(root, 'scripts', 'bootstrap.sh'), 'utf8');
  const stop = fs.readFileSync(path.join(root, 'scripts', 'debloat-stop.sh'), 'utf8'),
    undo = fs.readFileSync(path.join(root, 'scripts', 'debloat-undo.sh'), 'utf8');
  ok(
    /mount --bind \/tmp\/cleanyourtv-hosts \/etc\/hosts/.test(stop) && /umount \/etc\/hosts/.test(undo),
    'where /etc/hosts is read-only (issue 11) the ad servers go into a copy in RAM, and the undo removes it'
  );
  // the undo unmounts /etc/hosts only when the RAM copy is what it shows: a table mounted over it later (Glasshouse) stays
  const line = undo.split('\n').filter(l => /^if \[ -e \/tmp\/cleanyourtv-hosts\.mounted \]/.test(l))[0];
  ok(!!line && /\/etc\/hosts -ef \/tmp\/cleanyourtv-hosts/.test(line), 'the undo checks that the RAM copy is the top /etc/hosts mount');
  const ours = path.join(tmp, 'hosts-ours'),
    top = path.join(tmp, 'hosts-top'),
    etc = path.join(tmp, 'hosts-etc'),
    mark = path.join(tmp, 'hosts-mounted'),
    log = path.join(tmp, 'umount.log');
  const undoHosts = () => {
    fs.writeFileSync(log, '');
    const code = line
      .replace(/\/etc\/hosts/g, etc)
      .replace(/\/tmp\/cleanyourtv-hosts\.mounted/g, mark)
      .replace(/\/tmp\/cleanyourtv-hosts/g, ours);
    cp.spawnSync('/bin/sh', ['-c', 'umount() { echo "$1" >> "$LOG"; return 0; }; ' + code], {
      env: Object.assign({}, process.env, { LOG: log }),
    });
    return { umounted: fs.readFileSync(log, 'utf8').trim(), copy: fs.existsSync(ours), marker: fs.existsSync(mark) };
  };
  for (const f of [ours, top, etc, mark]) if (fs.existsSync(f)) fs.unlinkSync(f);
  fs.writeFileSync(ours, '127.0.0.1 x # cleanyourtv-debloat\n');
  fs.linkSync(ours, etc); // the same file: our copy is what /etc/hosts shows
  fs.writeFileSync(mark, '');
  let h = undoHosts();
  ok(h.umounted === etc && !h.copy && !h.marker, 'our RAM copy on top: unmounted and removed');
  for (const f of [ours, etc, mark]) if (fs.existsSync(f)) fs.unlinkSync(f);
  fs.writeFileSync(ours, '127.0.0.1 x # cleanyourtv-debloat\n');
  fs.writeFileSync(etc, '0.0.0.0 ads.example\n'); // another table on top (a different file)
  fs.writeFileSync(mark, '');
  h = undoHosts();
  ok(h.umounted === '' && h.copy && h.marker, 'another table on top: nothing is unmounted and the marker stays');
  fs.unlinkSync(mark);
  h = undoHosts();
  ok(h.umounted === '', 'without the marker nothing is unmounted');
  // admanager is not stubbed (HBO Max and Disney+ stay on their loader without it, issue 47); a stub of an older version is lifted
  ok(
    /on ads && bins="\$bins adoverlay-service"/.test(stop) &&
      !/bins="\$bins[^"]*admanager/.test(stop) &&
      /cmp -s \/usr\/sbin\/admanager \$L\/stub-noop; then umount \/usr\/sbin\/admanager/.test(stop) &&
      /admanager adoverlay-service/.test(undo),
    'the ads group leaves admanager running (issue 47), lifts the stub that versions before 1.6.11 mounted, and the undo still removes it'
  );
  ok(
    /TV="node \$S\/helper\/tvprofile\.js"/.test(bootText) &&
      /\$TV get notifyWindow/.test(bootText) &&
      /\$TV get testedNote/.test(bootText) &&
      /\$TV get homeSupported/.test(bootText) &&
      !/TESTED_SDK/.test(bootText),
    'the setup takes the window type and the compatibility list from tvprofile.js'
  );
  // the stand-in way that does not bring the launcher up (CRIU, issues 72 and 84): the setup tries the mount way once, and remembers it
  const vstart = bootText.indexOf('verify() {'),
    verifyText = bootText.slice(vstart, bootText.indexOf('finish() {'));
  ok(
    /wait_home && return 0/.test(verifyText) &&
      /\$TV get homeTakeover --home "\$HOMEKIND"\)" = standin/.test(verifyText) &&
      /"\$\(cat \$D\/home-method[^)]*\)" != mount/.test(verifyText) &&
      /echo mount > \$D\/home-method; RETRIED=1/.test(verifyText) &&
      /sh \$D\/10-cleanyourtv-home <\/dev\/null/.test(verifyText) &&
      /debloat-stop\.sh/.test(verifyText) &&
      /\[ -n "\$RETRIED" \] && rm -f \$D\/home-method/.test(verifyText) &&
      verifyText.indexOf('wait_home && return 0') < verifyText.indexOf('rolling back'),
    'when the stand-in does not bring the launcher up the setup tries the mount way once, keeps it in home-method, and only then rolls back'
  );
  ok(cp.spawnSync('sh', ['-n', path.join(root, 'scripts', 'bootstrap.sh')]).status === 0, 'bootstrap.sh is valid shell');

  // the watchdog (watchdog.sh): starts a service that has stopped again, keeps the logs of the runs that ended, starts less often a
  // service that stops at once, survives its own file being replaced by an update, and ends when CleanYourTV is gone.
  // A stand-in service counts its starts and writes "run <n>" to its log; the address the watchdog asks answers nothing. Everything
  // waits for what it expects (up to 15 s) instead of for a fixed time, so a slow machine does not fail it.
  const waitFor = async (cond, ms) => {
    for (let t = 0; t < (ms || 15000) && !cond(); t += 100) await sleep(100);
    return cond();
  };
  const watch = (dir, script) => {
    const w = cp.spawn('sh', [script], {
      env: Object.assign({}, process.env, {
        CYTV_DIR: dir,
        CYTV_BOOT_LOG: path.join(dir, 'boot.log'),
        CYTV_SERVICE_LOG: path.join(dir, 'helper.log'),
        CYTV_SERVICE_URL: 'http://127.0.0.1:9/none',
        CYTV_WATCH_SECS: '1',
        WD_MARK: path.join(dir, 'starts'),
      }),
      stdio: 'ignore',
    });
    w.gone = false;
    w.on('exit', () => (w.gone = true));
    return w;
  };
  const countStarts = dir =>
    fs.existsSync(path.join(dir, 'starts')) ? fs.readFileSync(path.join(dir, 'starts'), 'utf8').split('\n').filter(Boolean).length : 0;
  const text = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

  // 1. a service that keeps running
  const W = path.join(tmp, 'wd');
  fs.mkdirSync(W);
  fs.writeFileSync(
    path.join(W, 'helper.js'),
    "const fs = require('fs'); fs.appendFileSync(process.env.WD_MARK, 'start\\n');" +
      " console.log('run ' + fs.readFileSync(process.env.WD_MARK, 'utf8').split('\\n').filter(Boolean).length); setInterval(function () {}, 1000);\n"
  );
  fs.writeFileSync(path.join(W, 'helper.log'), 'the run that ended\n');
  fs.copyFileSync(path.join(root, 'scripts', 'watchdog.sh'), path.join(W, 'watchdog.sh')); // a copy, so the test can replace it
  const killService = dir => cp.spawnSync('pkill', ['-f', dir + '/helper.js']);
  const wd = watch(W, path.join(W, 'watchdog.sh'));
  await waitFor(() => countStarts(W) >= 1 && /start 1 in a row/.test(text(path.join(W, 'boot.log'))));
  await sleep(2500); // a service that runs is left alone
  ok(
    countStarts(W) === 1 &&
      /watchdog: the service had stopped; starting it again/.test(text(path.join(W, 'boot.log'))) &&
      /the run that ended/.test(text(path.join(W, 'helper.crash.log'))),
    'the watchdog starts a stopped service once, says so in the boot log and keeps the log of the run that ended'
  );
  // an update copies a new watchdog.sh over the running one: the running copy goes on
  fs.writeFileSync(path.join(W, 'watchdog.sh'), '#!/bin/sh\necho replaced > "$0.was-run"\n');
  killService(W);
  const again = await waitFor(() => countStarts(W) >= 2);
  const crash = text(path.join(W, 'helper.crash.log'));
  ok(
    again && /the run that ended/.test(crash) && /run 1/.test(crash),
    'it starts the service again each time it stops, also after its own file was replaced, and the crash log keeps every run'
  );
  fs.unlinkSync(path.join(W, 'helper.js'));
  ok(await waitFor(() => wd.gone, 10000), 'the watchdog ends when CleanYourTV is no longer installed');
  killService(W);
  if (!wd.gone) wd.kill();
  ok(!fs.existsSync(path.join(W, 'watchdog.sh.was-run')), 'the replaced file was not run by the running watchdog');

  // 1b. not while bootstrap.sh runs (a setup or an update starts and stops the service itself), but a command line that only mentions
  // the name does not count
  const S2 = path.join(tmp, 'wd-boot');
  fs.mkdirSync(S2);
  fs.writeFileSync(
    path.join(S2, 'helper.js'),
    "require('fs').appendFileSync(process.env.WD_MARK, 'start\\n'); setInterval(function () {}, 1000);\n"
  );
  fs.writeFileSync(path.join(S2, 'bootstrap.sh'), 'sleep 4\n');
  const bootRun = cp.spawn('sh', [path.join(S2, 'bootstrap.sh'), 'update'], { stdio: 'ignore' });
  const w2 = watch(S2, path.join(root, 'scripts', 'watchdog.sh'));
  await sleep(2500);
  const early = countStarts(S2);
  const late = await waitFor(() => countStarts(S2) >= 1);
  ok(early === 0 && late, 'the watchdog leaves the service alone while bootstrap.sh runs and starts it afterwards');
  bootRun.kill();
  const mention = cp.spawn('sh', ['-c', 'sleep 30 # ' + path.join(S2, 'bootstrap.sh')], { stdio: 'ignore' });
  killService(S2);
  ok(await waitFor(() => countStarts(S2) >= 2), 'a command that only mentions bootstrap.sh does not hold the watchdog back');
  mention.kill();
  fs.unlinkSync(path.join(S2, 'helper.js'));
  await waitFor(() => w2.gone, 10000);
  killService(S2);
  if (!w2.gone) w2.kill();

  // 2. a service that stops at once is started less and less often (without that it would be 1 start a second)
  const B = path.join(tmp, 'wd-crash');
  fs.mkdirSync(B);
  fs.writeFileSync(path.join(B, 'helper.js'), "require('fs').appendFileSync(process.env.WD_MARK, 'start\\n'); console.log('crash');\n");
  const wb = watch(B, path.join(root, 'scripts', 'watchdog.sh'));
  await waitFor(() => countStarts(B) >= 2);
  await sleep(6000);
  const n = countStarts(B);
  ok(n >= 2 && n <= 5, 'a service that keeps stopping is started less and less often (' + n + ' starts in about 7 seconds)');
  ok(
    (text(path.join(B, 'helper.crash.log')).match(/=== the service log of a run that ended/g) || []).length === n - 1,
    'every start leaves the log of the run before it in the crash log'
  );
  fs.unlinkSync(path.join(B, 'helper.js'));
  await waitFor(() => wb.gone, 10000);
  if (!wb.gone) wb.kill();
});
