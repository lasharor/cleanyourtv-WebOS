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
  fs.unlinkSync(exe);
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
});
