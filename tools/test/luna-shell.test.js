const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, req, run } = require('./lib');

run(async () => {
  const bin = path.join(tmp, 'bin'),
    probe = path.join(tmp, 'stdin.js');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    probe,
    'function done(state){console.log(JSON.stringify({state:state,fd3:process.env.CYTV_TEST_FD3,args:process.argv.slice(2)}));process.exit(0)};process.stdin.on("end",function(){done("EOF")});process.stdin.resume();setTimeout(function(){done("OPEN")},process.env.CYTV_TEST_HANG ? 30000 : 100);'
  );
  const command = path.join(bin, 'luna-send');
  fs.writeFileSync(
    command,
    '#!/bin/sh\n[ -z "$CYTV_TEST_EXIT" ] || exit "$CYTV_TEST_EXIT"\nexport CYTV_TEST_FD3=closed\n[ ! -e /proc/$$/fd/3 ] || export CYTV_TEST_FD3=open\nexec "' +
      process.execPath +
      '" "' +
      probe +
      '" "$@"\n'
  );
  fs.chmodSync(command, 0o755);
  const compat = path.join(root, 'scripts/luna-compat.sh'),
    uri = 'luna://example/query',
    payload = '{"text":"single\' double\\" $(not-a-command); <data>"}';
  const call = (mode, twice, exit) =>
    cp.spawnSync('/bin/sh', ['-c', '. "$1"; luna_send "$2" "$3"; ' + (twice ? 'luna_send "$2" "$3"' : ''), 'sh', compat, uri, payload], {
      encoding: 'utf8',
      timeout: 5000,
      env: Object.assign({}, process.env, {
        PATH: bin + ':' + process.env.PATH,
        CYTV_LUNA_STDIN: mode,
        TMPDIR: tmp,
        CYTV_TEST_EXIT: exit || '',
      }),
    });
  let result = call('closed'),
    reply = JSON.parse(result.stdout);
  ok(result.status === 0 && reply.state === 'EOF', 'shell Luna calls keep closed stdin by default');
  result = call('open');
  reply = JSON.parse(result.stdout);
  ok(result.status === 0 && reply.state === 'OPEN', 'the shell opt-in holds stdin until the child exits');
  ok(reply.fd3 === 'closed', 'the Luna process receives held stdin but no extra fd 3');
  ok(reply.args[0] === uri && reply.args[1] === payload, 'URI and quoted JSON remain separate literal arguments');
  result = call('open', true);
  ok(
    result.status === 0 &&
      result.stdout
        .trim()
        .split('\n')
        .every(line => JSON.parse(line).state === 'OPEN') &&
      result.stdout.trim().split('\n').length === 2,
    'successive calls each hold their own stdin'
  );
  ok(call('open', false, '7').status === 7 && call('closed', false, '7').status === 7, 'both modes preserve child failure status');
  ok(!fs.readdirSync(tmp).some(name => /^cytv-luna\./.test(name)), 'FIFO names and temporary directories are removed immediately');
  const flag = path.join(process.env.CYTV_DIR, 'luna-stdin-open');
  fs.writeFileSync(flag, '');
  ok(JSON.parse(call('').stdout).state === 'OPEN', 'shell calls read the persistent flag with no environment opt-in');
  ok(JSON.parse(call('closed').stdout).state === 'EOF', 'shell explicit closed overrides the flag');
  fs.unlinkSync(flag);
  ok(JSON.parse(call('').stdout).state === 'EOF', 'removing the flag restores the shell default');
  result = cp.spawnSync('/bin/sh', ['-c', '. "$1"; luna_send; sh -c \'test ! -e /proc/$$/fd/3\' & wait $!', 'sh', compat], {
    env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH, CYTV_LUNA_STDIN: 'open', TMPDIR: tmp }),
    timeout: 5000,
  });
  ok(result.status === 0, 'children started after a call inherit no held descriptor');

  // Execute the real sourcing headers, but not the TV-mutating bodies.
  for (const file of [
    '10-cleanyourtv-home',
    'after-sam.sh',
    'bootstrap.sh',
    'guidekey.sh',
    'home-standin.sh',
    'inputkey.sh',
    'reload-home.sh',
    'undo-home.sh',
    '../uninstall.sh',
    'volume-osd-restore.sh',
  ]) {
    const text = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
    const header = text
      .split('\n')
      .filter(line => /^luna_send\(\)|luna-compat\.sh/.test(line))
      .join('\n')
      .replace(/"[^"]*luna-compat\.sh"|\/media\/developer\/cleanyourtv\/luna-compat\.sh/g, '"$1"');
    result = cp.spawnSync('/bin/sh', ['-c', header + '\nluna_send "$2" "$3"', 'sh', path.join(tmp, 'missing'), uri, payload], {
      encoding: 'utf8',
      timeout: 5000,
      env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH }),
    });
    ok(result.status === 0 && JSON.parse(result.stdout).state === 'EOF', file + ' survives a missing compatibility helper');
  }

  fs.copyFileSync(compat, path.join(process.env.CYTV_DIR, 'luna-compat.sh'));
  const P = req('paths'),
    luna = req('luna');
  P.ENV.PATH = bin + ':' + P.ENV.PATH;
  fs.writeFileSync(flag, '');
  let sync = JSON.parse(luna.sync(uri, JSON.parse(payload), { wait: 1234 }));
  ok(
    sync.state === 'OPEN' && sync.args[3] === '1234' && sync.args[6] === payload,
    'synchronous report calls keep stdin and literal arguments'
  );
  sync = JSON.parse(luna.sync(uri, {}, { keepStdinOpen: false }));
  ok(sync.state === 'EOF', 'synchronous explicit false overrides the flag');
  P.ENV.CYTV_TEST_HANG = '1';
  const before = Date.now(),
    failed = luna.sync(uri, {}, { timeout: 200 });
  delete P.ENV.CYTV_TEST_HANG;
  ok(
    /failed:.*(?:timed out|ETIMEDOUT)/.test(failed) && Date.now() - before < 3000,
    'synchronous open-stdin calls are killed at their deadline'
  );
});
