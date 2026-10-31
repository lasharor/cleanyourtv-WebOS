'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');
const home = require('../../webos4/home-bind');
run(async () => {
  const binds = path.join(tmp, 'binds.json'),
    state = path.join(tmp, 'trial.json');
  const opts = { binds, state, temp: tmp, script: '/media/developer/cleanyourtv/webos4/home.sh' };
  const ctl = home.create(opts);
  const original = { '241': { action: 'exec', command: 'unrelated command' } };
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const fails = fn => {
    try {
      fn();
      return false;
    } catch (_) {
      return true;
    }
  };
  write(binds, original);
  ok(!ctl.check() && !fs.existsSync(state), 'unassigned HOME stays with LG');
  for (const key of ['', '../x', '0', '65536', '1;reboot'])
    ok(fails(() => ctl.enable(key)) && !fs.existsSync(state), 'invalid HOME code changes nothing: ' + key);
  ok(fails(() => ctl.enable('241')) && JSON.stringify(read(binds)) === JSON.stringify(original), 'an existing binding is never replaced');
  let r = ctl.enable('773');
  ok(
    ctl.check() && read(binds)['773'].command === r.command && read(binds)['241'].command === original['241'].command,
    'the observed HOME code is assigned without changing unrelated keys'
  );
  ok(
    r.expiresAt > Date.now() && r.expiresAt <= Date.now() + 120000 && fs.existsSync(r.marker),
    'the trial has a two-minute deadline and a volatile marker'
  );
  ok(!ctl.restore('different trial') && ctl.check(), 'a stale timer cannot restore another trial');
  ctl.restore(r.marker);
  ok(
    JSON.stringify(read(binds)) === JSON.stringify(original) && !fs.existsSync(state) && !fs.existsSync(r.marker),
    'restore removes only our binding and trial files'
  );
  r = ctl.enable('773');
  fs.unlinkSync(r.marker);
  ok(!ctl.check() && !read(binds)['773'], 'a reboot-cleared marker removes the binding instead of opening an unavailable launcher');
  r = ctl.enable('773');
  write(state, Object.assign({}, r, { expiresAt: 0 }));
  ok(!ctl.check() && !read(binds)['773'], 'an expired trial restores HOME');
  r = ctl.enable('773');
  const changed = read(binds);
  changed['773'] = { action: 'exec', command: 'new owner' };
  write(binds, changed);
  ok(
    fails(() => ctl.restore()) && read(binds)['773'].command === 'new owner',
    'restore never clobbers a replacement belonging to someone else'
  );
  changed['773'] = { action: 'exec', command: r.command };
  write(binds, changed);
  ctl.restore();
  r = ctl.enable('773');
  fs.unlinkSync(state);
  ctl.restore();
  ok(
    !read(binds)['773'] && read(binds)['241'].command === original['241'].command,
    'an interrupted state write can recover only the exact owned command'
  );
  fs.unlinkSync(r.marker);
  fs.mkdirSync(path.join(tmp, 'cytv-home-bind.lock'));
  ok(fails(() => ctl.enable('773')) && !read(binds)['773'], 'concurrent configuration edits are refused');
  fs.rmdirSync(path.join(tmp, 'cytv-home-bind.lock'));
  ok(cp.spawnSync('sh', ['-n', path.join(root, 'webos4/home.sh')]).status === 0, 'the temporary HOME command parses');
});
