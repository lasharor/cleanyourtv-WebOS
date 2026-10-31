'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');
run(async () => {
  const compiler = cp.spawnSync('gcc', ['--version']);
  if (compiler.status !== 0) return ok(true, 'skipped: gcc is not installed for the native HOME diagnostic');
  const binary = path.join(tmp, 'home-input');
  const built = cp.spawnSync(
    'gcc',
    ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', path.join(root, 'webos4/home-input.c'), '-o', binary],
    { encoding: 'utf8' }
  );
  ok(built.status === 0, 'the native HOME diagnostic compiles without warnings: ' + (built.status ? built.stderr : 'ok'));
  if (built.status) return;
  const self = cp.spawnSync(binary, ['--self-test'], { encoding: 'utf8' });
  ok(
    self.status === 0 && /self-test-passed/.test(self.stdout),
    'native checks preserve other keys/repeats, suppress HOME down/up/repeat and reject a lost or unsupported stream'
  );
  if (!fs.existsSync('/dev/input/event1')) {
    const probe = cp.spawnSync(binary, ['--probe'], { encoding: 'utf8' });
    const error = JSON.parse(probe.stderr.trim());
    ok(
      probe.status === 1 && error.event === 'error' && error.stage === 'probe' && error.proxyResolved === false,
      'a missing input reports failure without claiming a resolved replacement device'
    );
    ok(JSON.parse(probe.stdout.trim()).hadGrab === false, 'a failed probe never takes the remote');
  }
  for (const args of [[], ['--trial'], ['--filter-only', 'extra']]) {
    const result = cp.spawnSync(binary, args, { encoding: 'utf8' });
    ok(
      result.status === 2 && !result.stdout.includes('ready'),
      'an unrecognized command cannot start an input takeover: ' + args.join(' ')
    );
  }
  const source = fs.readFileSync(path.join(root, 'webos4/home-input.c'), 'utf8');
  ok(
    !/luna-send|closeByAppId|system\(|execv|mount\(/.test(source),
    'the initial filter diagnostic never launches/closes apps, restarts services or mounts firmware'
  );
  ok(cp.spawnSync('sh', ['-n', path.join(root, 'webos4/build-home-input.sh')]).status === 0, 'the separate ARM build script parses');
  ok(
    cp.spawnSync('sh', ['-n', path.join(root, 'webos4/home-input-trial.sh')]).status === 0,
    'the owned-PID stop/watchdog controller parses'
  );
  const ctl = path.join(tmp, 'home-input-trial.sh');
  fs.copyFileSync(path.join(root, 'webos4/home-input-trial.sh'), ctl);
  fs.writeFileSync(path.join(tmp, 'trial.pid'), '1 0\n');
  const stopped = cp.spawnSync('sh', [ctl, 'stop'], { encoding: 'utf8' });
  ok(stopped.status === 0, 'a PID belonging to another executable is never signalled');
  const bad = cp.spawnSync('sh', [ctl, 'arbitrary'], { encoding: 'utf8' });
  ok(bad.status === 2, 'unknown controller commands never start the native filter');
});
