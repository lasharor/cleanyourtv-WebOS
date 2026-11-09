const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, req, run } = require('./lib');

run(async () => {
  const undo = fs.readFileSync(path.join(root, 'scripts/undo-home.sh'), 'utf8');
  ok(
    undo.indexOf('nativehome.js" stop') >= 0 && undo.indexOf('nativehome.js" stop') < undo.indexOf('umount "$EXE"'),
    'native processes stop before their script mount is removed'
  );
  const native = req('nativehome'),
    P = req('paths');
  P.STANDIN = path.join(tmp, 'standin-marker');
  const exe = path.join(tmp, 'native-home'),
    script = path.join(P.D, 'home-standin.sh');
  fs.mkdirSync(path.join(P.D, 'backup'));
  fs.writeFileSync(
    path.join(P.D, 'backup/home-appinfo.orig.json'),
    JSON.stringify({ id: 'com.webos.app.home', type: 'native', main: 'file://' + exe })
  );
  fs.writeFileSync(script, '#!/bin/sh\n');
  fs.linkSync(script, exe);
  fs.writeFileSync(P.STANDIN, exe);
  fs.writeFileSync(path.join(P.PROC, 'mounts'), 'source ' + exe + ' none rw 0 0\n');
  native.validate(exe);
  ok(native.same(script, exe), 'the target must have the owned stand-in inode');
  ok(native.target() === exe, 'the mounted stand-in can be recovered independently of saved metadata');
  fs.unlinkSync(exe);
  fs.writeFileSync(exe, 'foreign program');
  let signals = [],
    refused = false;
  try {
    await native.stop(exe, { kill: (...args) => signals.push(args) });
  } catch (e) {
    refused = /foreign/.test(e.message);
  }
  ok(refused && signals.length === 0, 'a foreign mount is refused before any process is signalled');
  refused = false;
  try {
    native.target();
  } catch (e) {
    refused = /foreign/.test(e.message);
  }
  ok(refused, 'target discovery refuses a marker pointing at a foreign mount');
  // an update rolled back, or an edit, gave home-standin.sh another inode: the mounted copy is still ours by its header, a foreign one is not
  const header = fs
    .readFileSync(path.join(root, 'scripts', 'home-standin.sh'), 'utf8')
    .split('\n')
    .slice(0, 3)
    .join('\n');
  ok(
    header.indexOf("Stands in for LG's Home program on TVs where LG's Home is the native app") >= 0,
    'home-standin.sh still has the header the ownership check looks for'
  );
  fs.unlinkSync(exe);
  fs.writeFileSync(exe, header + '\n');
  fs.unlinkSync(script);
  fs.writeFileSync(script, header + '\n# a later version\n');
  ok(
    !native.same(script, exe) && native.target() === exe && native.ownedMount(exe),
    'a mounted stand-in is still ours after the file in the service folder was replaced'
  );
  fs.unlinkSync(exe);
  fs.writeFileSync(exe, 'foreign program');
  refused = false;
  try {
    native.target();
  } catch (e) {
    refused = /foreign/.test(e.message);
  }
  ok(refused && !native.ownedMount(exe), 'a mount without the inode and without the header stays foreign');
  fs.unlinkSync(exe);
  fs.unlinkSync(script);
  fs.writeFileSync(script, '#!/bin/sh\n');
  fs.linkSync(script, exe);
  const manifest = path.join(P.D, 'backup/home-appinfo.orig.json'),
    saved = fs.readFileSync(manifest);
  for (const value of [null, { id: 'com.webos.app.home', main: exe }, { id: 'com.webos.app.home', type: 'native', main: '/changed' }]) {
    if (value) fs.writeFileSync(manifest, JSON.stringify(value));
    else fs.unlinkSync(manifest);
    ok(native.target() === exe, 'recovery finds the owned mount despite missing/changed manifest');
    const recovered = await native.stop(exe, { recovery: true, processes: () => ({}), sleep: async () => {} });
    ok(recovered.stopped === 0, 'metadata recovery still uses bounded owned-process cleanup');
  }
  fs.writeFileSync(manifest, saved);
  const original = {
    10: { pid: 10, ppid: 1, start: '100', args: ['/bin/sh', exe] },
    11: { pid: 11, ppid: 10, start: '101', args: ['luna-send'] },
    99: { pid: 99, ppid: 1, start: '99', args: ['luna-send', '-i', '-a', 'unrelated'] },
  };
  ok(
    Object.keys(native.tree(original, native.roots(original, exe))).join(',') === '10,11',
    'only the owned interpreter and its descendants are selected'
  );
  const living = Object.assign({}, original);
  await native.stop(exe, {
    processes: () => Object.assign({}, living),
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGTERM') delete living[pid];
    },
    sleep: async () => {},
  });
  ok(
    signals.length > 0 && signals.every(s => s[0] === 10 || s[0] === 11) && living[99],
    'unrelated Luna clients and system processes are not killed'
  );
  let reads = 0;
  signals = [];
  await native.stop(exe, {
    processes: () => (++reads === 1 ? { 10: original[10] } : { 10: { pid: 10, ppid: 1, start: '200', args: ['another-app'] } }),
    kill: (...args) => signals.push(args),
    sleep: async () => {},
  });
  ok(signals.length === 0, 'a recycled root PID is never treated as the old interpreter');
  const recycledChild = { 10: original[10], 11: { pid: 11, ppid: 99, start: '202', args: ['another-app'] }, 99: original[99] };
  reads = 0;
  signals = [];
  await native.stop(exe, {
    processes: () => (++reads === 1 ? original : Object.assign({}, recycledChild)),
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGTERM') delete recycledChild[pid];
    },
    sleep: async () => {},
  });
  ok(
    signals.length > 0 && signals.every(s => s[0] === 10) && recycledChild[11],
    'a recycled descendant PID is never signalled as the old child'
  );
  const stubborn = Object.assign({}, original);
  signals = [];
  await native.stop(exe, {
    processes: () => Object.assign({}, stubborn),
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGKILL') delete stubborn[pid];
    },
    sleep: async () => {},
  });
  ok(
    signals.filter(s => s[1] === 'SIGKILL').length === 2 && stubborn[99],
    'escalation after the grace period remains limited to the same owned tree'
  );
  refused = false;
  try {
    await native.stop(exe, { processes: () => original, kill() {}, sleep: async () => {} });
  } catch (e) {
    refused = /did not stop/.test(e.message);
  }
  ok(refused, 'cleanup fails if an owned process remains after bounded termination');
  signals = [];
  refused = false;
  try {
    await native.stop(exe, {
      processes: () => original,
      kill: (pid, signal) => {
        signals.push([pid, signal]);
        if (signal === 'SIGTERM') {
          const error = new Error('denied');
          error.code = 'EPERM';
          throw error;
        }
      },
      sleep: async () => {},
    });
  } catch (e) {
    refused = /denied/.test(e.message);
  }
  ok(
    refused && signals.filter(s => s[1] === 'SIGCONT').length === 2,
    'a signalling failure resumes the frozen tree before reporting failure'
  );
  fs.writeFileSync(P.STANDIN, '/another/program');
  refused = false;
  try {
    native.validate(exe);
  } catch (_) {
    refused = true;
  }
  ok(refused, 'a mismatched marker is refused');
  ok(native.target() === exe, 'a mismatched marker does not strand an independently owned mount');
  fs.unlinkSync(P.STANDIN);
  fs.symlinkSync(exe, P.STANDIN);
  refused = false;
  try {
    native.validate(exe);
  } catch (_) {
    refused = true;
  }
  ok(refused, 'a symlink marker is refused');
  ok(native.target() === exe, 'recovery does not follow a symlink marker');
  fs.unlinkSync(P.STANDIN);
  const fifo = cp.spawnSync('mkfifo', [P.STANDIN]);
  refused = false;
  try {
    native.validate(exe);
  } catch (_) {
    refused = true;
  }
  ok(fifo.status === 0 && refused, 'a FIFO marker is rejected without reading and blocking on it');
  ok(native.target() === exe, 'recovery does not read a FIFO marker');
  fs.unlinkSync(P.STANDIN);
  ok(native.target() === exe, 'recovery finds an owned mount even without its marker');
  fs.writeFileSync(P.STANDIN, exe);
  const procDir = path.join(P.PROC, '321');
  fs.mkdirSync(procDir);
  const fields = ['S', '10'].concat(Array(17).fill('0'), ['12345']);
  fs.writeFileSync(path.join(procDir, 'stat'), '321 (name with ) spaces) ' + fields.join(' '));
  fs.writeFileSync(path.join(procDir, 'cmdline'), '/bin/sh\0' + exe + '\0');
  const parsed = native.processes()['321'];
  ok(
    parsed.pid === 321 && parsed.ppid === 10 && parsed.start === '12345' && parsed.args[1] === exe,
    'proc parsing reads start time correctly even when the process name contains parentheses'
  );
  fields[0] = 'Z';
  fs.writeFileSync(path.join(procDir, 'stat'), '321 (name) ' + fields.join(' '));
  ok(!native.processes()['321'], 'zombies do not keep cleanup waiting for a dead interpreter');
  const start = undo.indexOf('EXE=$(node'),
    end = undo.indexOf('\nfor m in ', start);
  ok(start >= 0 && end > start, 'exercise the real native undo shell branch');
  const calls = path.join(tmp, 'calls');
  const setup =
    'L="$1"; STANDIN="$2"; CALLS="$3"; TARGET="$4"; sleep() { :; };\n' +
    'node() { case "$2" in target) echo "$TARGET";; stop) echo stop >> "$CALLS"; return "${STOP:-0}";; recover) echo recover >> "$CALLS"; return "${RECOVER:-0}";; owned) echo owned >> "$CALLS"; return "${OWNED:-0}";; esac; };\n' +
    'umount() { echo unmount >> "$CALLS"; return "${UNMOUNT:-1}"; };\n';
  const shellUndo = env => {
    fs.writeFileSync(calls, '');
    return cp.spawnSync('/bin/sh', ['-c', setup + undo.slice(start, end), 'sh', P.D, P.STANDIN, calls, exe], {
      encoding: 'utf8',
      timeout: 5000,
      env: Object.assign({}, process.env, env || {}),
    });
  };
  let result = shellUndo();
  ok(
    result.status !== 0 &&
      fs.existsSync(P.STANDIN) &&
      fs.readFileSync(calls, 'utf8') === 'stop\nowned\nunmount\n' &&
      !/stock Home restored/.test(result.stdout),
    'busy unmount retains its marker and never reports successful restoration'
  );
  result = shellUndo({ STOP: '1', UNMOUNT: '0' });
  ok(
    result.status === 0 &&
      /stock Home restored/.test(result.stdout) &&
      fs.readFileSync(calls, 'utf8') === 'stop\nrecover\nowned\nunmount\n',
    'a failed metadata check falls back and can restore the owned mount'
  );
  fs.writeFileSync(P.STANDIN, exe);
  result = shellUndo({ STOP: '1', RECOVER: '1' });
  ok(
    result.status !== 0 &&
      fs.existsSync(P.STANDIN) &&
      /cleanup incomplete/.test(result.stderr) &&
      !/stock Home restored/.test(result.stdout),
    'failed termination still attempts best effort but reports a busy mount honestly'
  );
  result = shellUndo({ OWNED: '1', UNMOUNT: '0' });
  ok(result.status !== 0 && !/unmount/.test(fs.readFileSync(calls, 'utf8')), 'changed mount ownership prevents unmounting');
  const hook = fs.readFileSync(path.join(root, 'scripts/10-cleanyourtv-home'), 'utf8');
  const watchdog = fs.readFileSync(path.join(root, 'scripts/watchdog.sh'), 'utf8');
  ok(
    !/home-generation/.test(undo + hook) &&
      /watchdog\.sh/.test(hook) &&
      watchdog.indexOf('&& replaced; then') > watchdog.indexOf('sleep "$EVERY"'),
    'obsolete generations are dropped; the separate watchdog rechecks takeover after sleeping'
  );
  const uninstall = fs.readFileSync(path.join(root, 'uninstall.sh'), 'utf8');
  ok(
    /--no-reboot/.test(uninstall) && /undo-home\.sh.*\|\|/.test(uninstall),
    'no-reboot uninstall also handles native takeover and stops on failed undo'
  );
  // the app manager restarts when the TV goes to standby: the stand-in sees its registration end with "is not running", waits until
  // the app manager answers again, has webapp-mgr close the launcher and ends, so the new app manager starts Home afresh (a launcher
  // left open as com.webos.app.home was taken for Home, and nothing came to the front: a black screen with only the pointer)
  {
    const D = path.join(tmp, 'standin-sam');
    fs.mkdirSync(D);
    fs.mkdirSync(path.join(D, 'bin'));
    fs.writeFileSync(
      path.join(D, 'bin', 'luna-send'),
      '#!/bin/sh\nD=' +
        JSON.stringify(D) +
        '\nfor a; do case "$a" in luna://*) m=$a ;; esac; done\necho "$m" >> $D/calls\n' +
        'case "$m" in\n*registerApp) echo \'{"registered":true,"event":"registered"}\'; sleep 1;' +
        ' echo \'{"serviceName":"com.webos.applicationManager","returnValue":false,"errorCode":-1,"errorText":"com.webos.applicationManager is not running."}\'; while :; do sleep 1; done ;;\n' +
        '*/running) n=$(cat $D/asked 2>/dev/null || echo 0); echo $((n+1)) > $D/asked; [ $n -ge 1 ] && echo \'{"returnValue":true,"running":[]}\' ;;\n' +
        '*) echo \'{"returnValue":true}\' ;;\nesac\n'
    );
    fs.chmodSync(path.join(D, 'bin', 'luna-send'), 0o755);
    const t0 = Date.now();
    const r = cp.spawnSync('sh', [path.join(root, 'scripts', 'home-standin.sh'), '{"reason":"preload"}'], {
      env: Object.assign({}, process.env, { PATH: path.join(D, 'bin') + ':' + process.env.PATH, CYTV_BOOT_LOG: path.join(D, 'boot.log') }),
      timeout: 20000,
      encoding: 'utf8',
    });
    cp.spawnSync('pkill', ['-f', D]); // nothing of the stand-in luna-send is left
    const log = fs.readFileSync(path.join(D, 'boot.log'), 'utf8'),
      calls = fs.readFileSync(path.join(D, 'calls'), 'utf8');
    ok(
      (r.status === 0 || r.signal === 'SIGTERM') &&
        Date.now() - t0 < 15000 &&
        /registered with the app manager/.test(log) &&
        /the app manager restarted \(the TV went to standby\); the launcher is closed/.test(log) &&
        calls.indexOf('/running') >= 0 &&
        calls.lastIndexOf('/running') < calls.indexOf('killApp'),
      'after the app manager restarts, the stand-in waits for it, closes the launcher and ends (' + (Date.now() - t0) + ' ms)'
    );
  }
  // Home at power on: when the TV comes back from standby (the power state Active after Active Standby) with LG's setting Home Auto
  // Launch on and an input in front, the stand-in launches Home, as LG's own Home program does; with the setting off, or with an
  // app the TV was turned on with in front, it does not
  const powerOn = (name, setting, fg) => {
    const D = path.join(tmp, name);
    fs.mkdirSync(D);
    fs.mkdirSync(path.join(D, 'bin'));
    fs.writeFileSync(
      path.join(D, 'bin', 'luna-send'),
      '#!/bin/sh\nD=' +
        JSON.stringify(D) +
        '\nfor a; do case "$a" in luna://*) m=$a ;; esac; done\necho "$m" >> $D/calls\n' +
        'case "$m" in\n' +
        '*registerApp) echo \'{"registered":true,"event":"registered"}\'; while :; do sleep 1; done ;;\n' +
        '*getPowerState) for s in Active "Active Standby" Active; do echo "{ \\"subscribed\\": true, \\"returnValue\\": true, \\"state\\": \\"$s\\" }"; sleep 1; done; while :; do sleep 1; done ;;\n' +
        '*getSystemSettings) echo \'{"settings":{"homeAutoLaunch":"' +
        setting +
        '"},"returnValue":true}\' ;;\n' +
        '*getForegroundAppInfo) echo \'{"appId":"' +
        fg +
        '","returnValue":true}\' ;;\n' +
        '*) echo \'{"returnValue":true}\' ;;\nesac\n'
    );
    fs.chmodSync(path.join(D, 'bin', 'luna-send'), 0o755);
    const c = cp.spawn('sh', [path.join(root, 'scripts', 'home-standin.sh'), '{"reason":"preload"}'], {
      env: Object.assign({}, process.env, { PATH: path.join(D, 'bin') + ':' + process.env.PATH, CYTV_BOOT_LOG: path.join(D, 'boot.log') }),
      stdio: 'ignore',
      detached: true,
    });
    return new Promise(res =>
      setTimeout(() => {
        try {
          process.kill(-c.pid);
        } catch (_) {}
        cp.spawnSync('pkill', ['-f', D]);
        const read = f => (fs.existsSync(path.join(D, f)) ? fs.readFileSync(path.join(D, f), 'utf8') : '');
        res({ log: read('boot.log'), calls: read('calls') });
      }, 6000)
    );
  };
  let po = await powerOn('standin-poweron', 'on', 'com.webos.app.hdmi1');
  ok(
    /the TV came on \(com.webos.app.hdmi1\) and Home Auto Launch is on: Home is opened/.test(po.log) &&
      (po.calls.match(/applicationManager\/launch/g) || []).length === 1,
    'back from standby on an input with Home Auto Launch on: Home is launched, once'
  );
  po = await powerOn('standin-poweron-off', 'off', 'com.webos.app.hdmi1');
  ok(
    /Home Auto Launch is off in LG's settings/.test(po.log) && !/applicationManager\/launch/.test(po.calls),
    'with Home Auto Launch off the TV stays on its input'
  );
  po = await powerOn('standin-poweron-app', 'on', 'netflix');
  ok(
    /the TV came on with netflix in front; Home is not opened over it/.test(po.log) && !/applicationManager\/launch/.test(po.calls),
    'an app the TV was turned on with stays in front'
  );
});
