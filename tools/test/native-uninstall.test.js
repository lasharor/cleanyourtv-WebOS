// Execute the uninstaller in an isolated filesystem with system actions stubbed.
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');

run(async () => {
  const R = path.join(tmp, 'root'),
    D = R + '/media/developer/cleanyourtv';
  const write = (file, text) => {
    cp.spawnSync('mkdir', ['-p', path.dirname(file)]);
    fs.writeFileSync(file, text);
  };
  const source = fs.readFileSync(path.join(root, 'uninstall.sh'), 'utf8');
  // Only these fixed absolute roots occur in the uninstaller; all deletion paths
  // below are in this test's temporary root. Do not run a real TV system action.
  const sandbox = source
    .replace(/\/media\/developer|\/var\/lib\/webosbrew|\/var\/luna/g, match => R + match)
    .replace(/luna-send/g, 'luna_send');
  const script = path.join(tmp, 'uninstall.sh');
  write(script, 'id() { echo 0; }; pkill() { :; }; node() { :; }; luna_send() { :; }; reboot() { echo unexpected-reboot; };\n' + sandbox);
  const prepare = code => {
    write(D + '/undo-home.sh', '#!/bin/sh\necho "undo:$1"\nexit ' + code + '\n');
    write(D + '/recovery-sentinel', 'keep me');
    write(R + '/var/lib/webosbrew/init.d/10-cleanyourtv-home', 'boot');
    write(R + '/media/developer/apps/usr/palm/applications/com.cleanyourtv.manager/appinfo.json', '{}');
  };
  const uninstall = () => cp.spawnSync('/bin/sh', [script, '--no-reboot'], { encoding: 'utf8', timeout: 5000 });
  prepare(1);
  let result = uninstall();
  ok(
    result.status !== 0 && /runtime retained/.test(result.stderr) && fs.existsSync(D + '/recovery-sentinel'),
    'no-reboot uninstall retains runtime after failed restoration'
  );
  ok(
    fs.existsSync(R + '/media/developer/apps/usr/palm/applications/com.cleanyourtv.manager/appinfo.json'),
    'failed restoration stops before package removal'
  );
  prepare(0);
  result = uninstall();
  ok(
    result.status === 0 && /undo:temp/.test(result.stdout) && !fs.existsSync(D),
    'no-reboot uninstall restores Home before removing runtime, without relying on a marker'
  );
  ok(!/unexpected-reboot/.test(result.stdout), 'the no-reboot path never requests a reboot');
});
