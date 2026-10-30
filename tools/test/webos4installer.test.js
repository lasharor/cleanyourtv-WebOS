'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');
run(async () => {
  const bin = path.join(tmp, 'bin'),
    calls = path.join(tmp, 'mutations'),
    sdk = path.join(tmp, 'sdk.json');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'luna-send'), '#!/bin/sh\ncat "$CHECK_SDK"\n', { mode: 0o700 });
  for (const name of ['curl', 'wget', 'mount', 'umount', 'reboot', 'pkill', 'kill', 'cp', 'mv', 'rm', 'mkdir', 'ln', 'tar', 'mktemp'])
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\necho "' + name + '" >>"$CHECK_CALLS"\nexit 77\n', { mode: 0o700 });
  const env = Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH, CHECK_SDK: sdk, CHECK_CALLS: calls });
  const check = (file, args) => cp.spawnSync('sh', [path.join(root, file)].concat(args || []), { env, encoding: 'utf8' });
  fs.writeFileSync(sdk, JSON.stringify({ returnValue: true, sdkVersion: '4.4.0' }));
  for (const entry of [
    ['install.sh', ['--check']],
    ['scripts/bootstrap.sh', ['check']],
    ['scripts/check-tv.sh', []],
  ]) {
    const result = check(entry[0], entry[1]);
    ok(
      result.status === 0 &&
        /readOnly=true/.test(result.stdout) &&
        /normalInstallerSupported=false/.test(result.stdout) &&
        /experimental-port-required/.test(result.stdout) &&
        !fs.existsSync(calls),
      'original entry point checks webOS 4 without installer mutations: ' + entry[0]
    );
  }
  fs.writeFileSync(sdk, '{"returnValue":false}');
  ok(check('install.sh', ['--check']).status !== 0 && !fs.existsSync(calls), 'unknown SDK fails closed before downloads or changes');
  fs.writeFileSync(sdk, JSON.stringify({ returnValue: true, sdkVersion: '10.0.0' }));
  const modern = check('install.sh', ['--check']);
  ok(
    modern.status === 0 && /inventory-only|unsupported-prerequisites/.test(modern.stdout) && !fs.existsSync(calls),
    'modern TVs keep the original install path and inventory remains read-only'
  );
});
