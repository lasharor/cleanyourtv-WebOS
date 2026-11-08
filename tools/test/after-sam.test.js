// Exercise the real shell hook with local stand-ins; never call the TV or system services.
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');
run(async () => {
  const bin = path.join(tmp, 'bin'),
    service = path.join(tmp, 'service'),
    calls = path.join(tmp, 'calls');
  fs.mkdirSync(bin);
  fs.mkdirSync(service);
  fs.mkdirSync(path.join(service, 'backup'));
  fs.writeFileSync(path.join(service, 'backup/home-appinfo.orig.json'), JSON.stringify({ id: 'com.webos.app.home', type: 'flutter' }));
  fs.copyFileSync(path.join(root, 'helper/tvprofile.js'), path.join(service, 'tvprofile.js'));
  fs.copyFileSync(path.join(root, 'scripts/jtool.js'), path.join(service, 'jtool.js'));
  fs.copyFileSync(path.join(root, 'scripts/luna-compat.sh'), path.join(service, 'luna-compat.sh'));
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.writeFileSync(path.join(bin, 'luna-send'), '#!/bin/sh\nprintf \'%s\\n\' "$FACTS"\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(bin, 'systemctl'),
    '#!/bin/sh\ncase "$1" in\ncat) [ "$STATE" != missing ] ;;\nis-active) [ "$STATE" = active ] ;;\nrestart) printf "%s\\n" "$2" >> "$CALLS" ;;\n*) exit 1 ;;\nesac\n',
    { mode: 0o755 }
  );
  const script = fs
    .readFileSync(path.join(root, 'scripts/after-sam.sh'), 'utf8')
    .replace(/^export PATH=.*$/m, 'export PATH="' + bin + ':$PATH"')
    .replace('L=/media/developer/cleanyourtv', 'L="' + service + '"')
    .replace('LOG=/tmp/cleanyourtv-boot.log', 'LOG="' + path.join(tmp, 'boot.log') + '"')
    .replace(/^up\(\).*$/m, 'up() { echo 1; }');
  for (const state of ['active', 'inactive', 'missing']) {
    fs.writeFileSync(calls, '');
    const r = cp.spawnSync('sh', ['-s'], {
      input: script,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        FACTS: JSON.stringify({ returnValue: true, sdkVersion: '11.2.0', modelName: 'OLED65C35LA.AEU' }),
        STATE: state,
        CALLS: calls,
      }),
    });
    ok(
      r.status === 0 && fs.readFileSync(calls, 'utf8') === (state === 'active' ? 'arccontroller\numediaserver\n' : ''),
      'post-SAM hook: ARC controller and media server ' + state
    );
  }
  // issue 122: webOS 25 restarts the video output and then the media server; a file in the service folder replaces the list on one TV
  const run25 = () => {
    fs.writeFileSync(calls, '');
    const r = cp.spawnSync('sh', ['-s'], {
      input: script,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        FACTS: JSON.stringify({ returnValue: true, sdkVersion: '10.3.2', modelName: 'OLED65B2RLA' }),
        STATE: 'active',
        CALLS: calls,
      }),
    });
    return [r.status, fs.readFileSync(calls, 'utf8'), fs.readFileSync(path.join(tmp, 'boot.log'), 'utf8')];
  };
  let r25 = run25();
  ok(r25[0] === 0 && r25[1] === 'videooutputd\numediaserver\n', 'post-SAM hook on webOS 25: the video output first, then the media server');
  const own = path.join(service, 'after-sam-services');
  fs.writeFileSync(own, '');
  r25 = run25();
  ok(
    r25[1] === '' && /services: none \(from after-sam-services\)/.test(r25[2]),
    'an empty after-sam-services switches the restarts off on that TV'
  );
  fs.writeFileSync(own, 'umediaserver\n');
  r25 = run25();
  ok(r25[1] === 'umediaserver\n', 'and a list in it replaces the profile; an update leaves the file alone');
  fs.unlinkSync(own);
});
