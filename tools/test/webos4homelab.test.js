'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  EventEmitter = require('events');
const { root, tmp, ok, run } = require('./lib');
const lab = require('../../webos4/home-lab');

run(async () => {
  const dir = path.join(tmp, 'lab');
  fs.mkdirSync(dir);
  const binds = path.join(tmp, 'bindings.json');
  const unrelated = { '241': { action: 'exec', command: 'unrelated' } };
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const active = path.join(dir, 'active.json');
  const timers = [],
    launches = [];
  let child;
  const ctl = lab.create({
    dir,
    temp: tmp,
    binds,
    timer: (fn, ms) => timers.push({ fn, ms }),
    spawn: (file, args, options) => {
      launches.push({ file, args, options });
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      return child;
    },
  });
  const fails = fn => {
    try {
      fn();
      return false;
    } catch (_) {
      return true;
    }
  };
  const events = () => fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const id = '1793000000000-abcdef01';
  write(binds, unrelated);
  ok(fails(() => ctl.run('bad', id, () => {})) && !fs.existsSync(active), 'unknown variants cannot assign HOME');
  ok(
    fails(() => ctl.run('plain', ';reboot', () => {})),
    'invalid run ids cannot start a guardian'
  );
  ok(lab.launch('probe') === null, 'the hook diagnostic never launches an app');
  for (const variant of ['plain', 'recent', 'public']) {
    const request = lab.launch(variant),
      payload = JSON.parse(request.args[request.args.length - 1]);
    ok(
      payload.id === 'com.cleanyourtv.webos4' && request.args[5] === 'luna://com.webos.applicationManager/launch',
      variant + ' can only open the isolated launcher'
    );
    ok(request.file === (variant === 'public' ? 'luna-send-pub' : 'luna-send'), variant + ' has one explicit bus, no fallback');
  }
  ok(JSON.stringify(JSON.parse(lab.launch('plain').args[6])) === '{"id":"com.cleanyourtv.webos4"}', 'plain HOME uses only the launcher id');
  ok(JSON.parse(lab.launch('recent').args[6]).params.reason === 'recent', 'the recent variant keeps the LG reason inside params');
  let ended = false;
  const stop = ctl.run('probe', id, () => {
    ended = true;
  });
  ok(
    timers[0].ms === 120000 && read(binds)['773'].command === 'sh ' + path.join(dir, 'home-lab.sh'),
    'TV recovery is armed before the temporary HOME binding'
  );
  ok(
    fails(() => ctl.run('plain', '1793000000000-abcdef02', () => {})),
    'a second guardian cannot run concurrently'
  );
  ctl.press(() => {});
  ok(ctl.read().presses === 1 && !launches.length, 'a physical hook invocation is logged without any launch in probe mode');
  ok(!ctl.restore('1793000000000-abcdef02') && ctl.read().phase === 'ready', 'stale recovery cannot end another trial');
  timers[0].fn();
  ok(
    ended && ctl.read().phase === 'restored' && JSON.stringify(read(binds)) === JSON.stringify(unrelated),
    'the TV restores LG at the deadline without a PC or SSH'
  );
  stop();
  ok(events().filter(e => e.event === 'restored').length === 1, 'guardian cleanup is idempotent');

  ctl.run('plain', '1793000000000-abcdef02', () => {});
  ctl.press(() => {});
  ctl.press(() => {});
  ok(
    launches.length === 1 && launches[0].options.stdio[0] === 'ignore',
    'one HOME press makes one request; duplicate presses are suppressed and stdin is detached'
  );
  child.stdout.emit('data', Buffer.from('{"returnValue":false,"secret":"never log me"}'));
  child.emit('close', 0);
  ok(
    launches.length === 1 && events().some(e => e.event === 'launch' && e.data.uncertain),
    'a rejected activation is uncertain and never retried'
  );
  ok(
    !fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').includes('never log me'),
    'raw Luna replies and their incidental private fields are not logged'
  );
  ctl.restore('1793000000000-abcdef02');
  timers.filter(t => t.ms === 1000).forEach(t => t.fn());
  ok(!read(binds)['773'] && ctl.read().phase === 'restored', 'early manual recovery releases HOME before another variant');

  const rebootStop = ctl.run('plain', '1793000000000-abcdef03', () => {});
  fs.unlinkSync(ctl.read().marker);
  ctl.press(() => {});
  ok(!read(binds)['773'] && launches.length === 1, 'a reboot-cleared marker restores LG instead of launching');
  rebootStop();
  const expiryStop = ctl.run('plain', '1793000000000-abcdef04', () => {});
  const binding = path.join(dir, 'binding.json');
  write(binding, Object.assign({}, read(binding), { expiresAt: 0 }));
  write(active, Object.assign({}, read(active), { expiresAt: 0 }));
  ctl.press(() => {});
  ok(!read(binds)['773'] && launches.length === 1, 'an expired HOME press runs recovery even when the guard is no longer alive');
  expiryStop();

  const timeoutStop = ctl.run('public', '1793000000000-abcdef05', () => {});
  ctl.press(() => {});
  timers.filter(t => t.ms === 11000).forEach(t => t.fn());
  child.emit('close', null);
  ok(
    launches.length === 2 && events().filter(e => e.event === 'launch' && e.data.error === 'timeout').length === 1,
    'a hung request is bounded, logged once and never retried'
  );
  timeoutStop();
  const frame = (code, value, type = 1) => {
    const b = Buffer.alloc(16);
    b.writeUInt16LE(type, 8);
    b.writeUInt16LE(code, 10);
    b.writeInt32LE(value, 12);
    return b;
  };
  let hits = 0;
  const parse = lab.homeEvents(() => hits++);
  const packet = Buffer.concat([frame(773, 1), frame(773, 2), frame(773, 0), frame(412, 1), frame(773, 1, 0), frame(773, 1)]);
  parse(packet.slice(0, 9));
  ok(hits === 0, 'the observer waits for a complete native input frame');
  parse(packet.slice(9, 37));
  parse(packet.slice(37));
  ok(hits === 2, 'fragmented/multiple frames recognize HOME down only, not repeat, release, Back or sync');

  const observerTimers = [],
    observerLaunches = [];
  let input,
    readerDestroyed = false,
    observerEnded = false;
  const observer = lab.create({
    dir,
    temp: tmp,
    binds,
    timer: (fn, ms) => observerTimers.push({ fn, ms }),
    readInput: () => {
      input = new EventEmitter();
      input.destroy = () => {
        readerDestroyed = true;
      };
      return input;
    },
    spawn: (file, args) => {
      observerLaunches.push({ file, args });
      const ch = new EventEmitter();
      ch.stdout = new EventEmitter();
      ch.stderr = new EventEmitter();
      ch.kill = () => {};
      return ch;
    },
  });
  const observerStop = observer.run('observe', '1793000000000-abcdef06', () => {
    observerEnded = true;
  });
  ok(
    observer.read().phase === 'starting' && JSON.stringify(read(binds)) === JSON.stringify(unrelated),
    'observer startup never reassigns HOME or another key'
  );
  input.emit('open');
  ok(observer.read().phase === 'ready', 'observer readiness requires the actual input device to be open');
  input.emit('data', frame(773, 1));
  ok(!observerLaunches.length, 'the observer lets native HOME handling precede its single activation');
  observerTimers.filter(t => t.ms === 300).forEach(t => t.fn());
  ok(
    observerLaunches.length === 1 && JSON.parse(observerLaunches[0].args[6]).id === 'com.cleanyourtv.webos4',
    'a native HOME event opens only the isolated launcher once'
  );
  observerStop();
  ok(
    readerDestroyed && observerEnded && JSON.stringify(read(binds)) === JSON.stringify(unrelated),
    'stopping the observer closes its reader and leaves all native key assignments unchanged'
  );
  const count = observerLaunches.length;
  observerTimers.filter(t => t.ms === 300).forEach(t => t.fn());
  ok(observerLaunches.length === count, 'a delayed observer callback cannot launch after recovery');
  ok(
    !fs.existsSync(path.join(tmp, 'cytv-home-lab-press.lock')),
    'an observer stopped during a request cannot leave a stale filesystem press lock'
  );

  readerDestroyed = false;
  observer.run('observe', '1793000000000-abcdef07', () => {});
  input.emit('open');
  input.emit('data', frame(773, 1));
  observerTimers
    .filter(t => t.ms === 120000)
    .slice(-1)[0]
    .fn();
  observerTimers
    .filter(t => t.ms === 300)
    .slice(-1)[0]
    .fn();
  ok(
    readerDestroyed && observer.read().phase === 'restored' && observerLaunches.length === count,
    'the TV deadline stops observation and cancels pending activation without a PC'
  );
  observer.run('observe', '1793000000000-abcdef08', () => {});
  input.emit('error', Object.assign(new Error('reader failed'), { code: 'ENODEV' }));
  ok(
    observer.read().phase === 'restored' && JSON.stringify(read(binds)) === JSON.stringify(unrelated),
    'a device read failure ends the observer without changing LG bindings'
  );
  write(binds, Object.assign({}, unrelated, { '773': { action: 'exec', command: 'someone else' } }));
  ok(
    fails(() => observer.run('observe', '1793000000000-abcdef09', () => {})) && read(binds)['773'].command === 'someone else',
    'the observer refuses a conflicting HOME assignment without removing it'
  );
  write(binds, unrelated);
  ok(cp.spawnSync('sh', ['-n', path.join(root, 'webos4/home-lab.sh')]).status === 0, 'the standalone HOME hook parses');
  const python = cp.spawnSync('python3', [path.join(root, 'tools/test/webos4homelab_test.py')], { encoding: 'utf8' });
  ok(python.status === 0, 'the PC driver passes isolated tests: ' + (python.status ? python.stderr : 'ok'));
});
