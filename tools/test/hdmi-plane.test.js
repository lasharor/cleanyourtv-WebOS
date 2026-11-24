// scripts/hdmi-plane.sh (issue 255): the real shell script with local stand-ins; never calls the TV or system services.
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');
run(async () => {
  const bin = path.join(tmp, 'bin'),
    service = path.join(tmp, 'service'),
    calls = path.join(tmp, 'calls'),
    uptime = path.join(tmp, 'uptime'),
    done = path.join(tmp, 'done'),
    log = path.join(tmp, 'boot.log');
  fs.mkdirSync(bin);
  fs.mkdirSync(service);
  fs.mkdirSync(path.join(service, 'backup'));
  const home = type =>
    fs.writeFileSync(path.join(service, 'backup/home-appinfo.orig.json'), JSON.stringify({ id: 'com.webos.app.home', type }));
  home('native');
  for (const f of ['helper/tvprofile.js', 'scripts/jtool.js', 'scripts/luna-compat.sh'])
    fs.copyFileSync(path.join(root, f), path.join(service, path.basename(f)));
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // the answers come from the environment: SDK, FG (the foreground app), EIM (getAllInputStatus), RUNNING (listRunningApps)
  fs.writeFileSync(
    path.join(bin, 'luna-send'),
    `#!/bin/sh
for a in "$@"; do case "$a" in luna://*) u=$a ;; esac; done
case "$u" in
*getSystemInfo) printf '{"returnValue": true, "sdkVersion": "%s"}\\n' "$SDK" ;;
*getForegroundAppInfo) printf '{"returnValue": true, "appId": "%s"}\\n' "$FG" ;;
*getAllInputStatus) printf '%s\\n' "$EIM" ;;
*listRunningApps) printf '%s\\n' "$RUNNING" ;;
esac
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(bin, 'systemctl'),
    '#!/bin/sh\ncase "$1" in\nrestart) printf "%s\\n" "$2" >> "$CALLS" ;;\nis-active) echo active ;;\n*) exit 1 ;;\nesac\n',
    { mode: 0o755 }
  );
  const script = fs
    .readFileSync(path.join(root, 'scripts/hdmi-plane.sh'), 'utf8')
    .replace(/^export PATH=.*$/m, 'export PATH="' + bin + ':$PATH"')
    .replace('L=/media/developer/cleanyourtv', 'L="' + service + '"')
    .replace('LOG=/tmp/cleanyourtv-boot.log', 'LOG="' + log + '"')
    .replace('UPTIME=/proc/uptime', 'UPTIME="' + uptime + '"')
    .replace('DONE=/tmp/cleanyourtv-hdmi-plane-done', 'DONE="' + done + '"');
  const live = JSON.stringify({ returnValue: true, devices: [{ id: 'HDMI_1', appId: 'com.webos.app.hdmi1', hdmiPlugIn: true }] });
  const dead = JSON.stringify({ returnValue: true, devices: [{ id: 'HDMI_1', appId: 'com.webos.app.hdmi1', hdmiPlugIn: false }] });
  // one run of the script; returns the services that were restarted
  const go = o => {
    o = Object.assign(
      { app: 'com.webos.app.hdmi1', sdk: '6.5.3', up: '45.2 90.0', fg: 'com.webos.app.hdmi1', eim: live, running: '{"running":[]}' },
      o
    );
    fs.writeFileSync(calls, '');
    fs.writeFileSync(uptime, o.up);
    fs.writeFileSync(log, '');
    try {
      fs.unlinkSync(done);
    } catch (_) {}
    const r = cp.spawnSync('sh', ['-s', '--', o.app], {
      input: script,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { SDK: o.sdk, FG: o.fg, EIM: o.eim, RUNNING: o.running, CALLS: calls }),
    });
    return { status: r.status, calls: fs.readFileSync(calls, 'utf8'), log: fs.readFileSync(log, 'utf8') };
  };
  let r = go();
  ok(
    r.status === 0 && r.calls === 'webapp-mgr\n',
    'webOS 6 with the native Home, an HDMI input in front with a live signal: webapp-mgr is restarted once'
  );
  ok(/live signal on com\.webos\.app\.hdmi1/.test(r.log) && /webapp-mgr active/.test(r.log), 'and each step is in the boot log');
  ok(go({ eim: dead }).calls === '', 'no live signal on the port (a boot without the box on): nothing is restarted');
  ok(go({ eim: 'not json' }).calls === '', 'an answer that is not JSON: nothing is restarted');
  ok(
    go({ running: '{"running":[{"id":"com.webos.app.home"}]}' }).calls === '',
    'the launcher is open (it lives in webapp-mgr): nothing is restarted'
  );
  ok(go({ fg: 'com.webos.app.home' }).calls === '', 'Home in front: nothing is restarted');
  ok(go({ up: '130.5 300.0' }).calls === '', 'after 120 s of uptime the restart no longer attaches the plane: nothing is restarted');
  ok(
    go({ app: 'com.webos.app.home' }).calls === '' && go({ app: '' }).calls === '',
    'an app that is not an HDMI input: nothing is restarted'
  );
  ok(go({ sdk: '10.2.2' }).calls === '' && go({ sdk: '5.6.2' }).calls === '', 'other webOS versions are left alone');
  home('flutter');
  ok(go().calls === '', "LG's Home is not the native program (the mount way): nothing is restarted");
  home('native');
  fs.writeFileSync(path.join(service, 'hdmi-plane-on'), '');
  ok(go({ sdk: '5.6.2' }).calls === 'webapp-mgr\n', 'the file hdmi-plane-on switches it on for another TV');
  fs.writeFileSync(path.join(service, 'hdmi-plane-off'), '');
  ok(go().calls === '', 'the file hdmi-plane-off switches it off');
  fs.unlinkSync(path.join(service, 'hdmi-plane-on'));
  fs.unlinkSync(path.join(service, 'hdmi-plane-off'));
  // once per boot
  go();
  const again = cp.spawnSync('sh', ['-s', '--', 'com.webos.app.hdmi1'], {
    input: script,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SDK: '6.5.3', FG: 'com.webos.app.hdmi1', EIM: live, RUNNING: '{}', CALLS: calls }),
  });
  ok(again.status === 0 && fs.readFileSync(calls, 'utf8') === 'webapp-mgr\n', 'a second start in the same boot does not restart it again');
  // the profile rule and the boot script's call
  const tv = require('../../helper/tvprofile');
  ok(
    tv.decide({ sdk: '6.5.3', home: 'com.webos.app.home native' }).hdmiPlane === true &&
      tv.decide({ sdk: '5.6.2', home: 'com.webos.app.home native' }).hdmiPlane === false &&
      tv.decide({ sdk: '6.5.3', home: 'com.webos.app.home flutter' }).hdmiPlane === false &&
      tv.decide({ sdk: '10.2.2', home: 'com.webos.app.home native' }).hdmiPlane === false &&
      tv.decide({}).hdmiPlane === false,
    'tvprofile: hdmiPlane only on webOS 6 with the native Home'
  );
  const boot = fs.readFileSync(path.join(root, 'scripts/10-cleanyourtv-home'), 'utf8');
  ok(
    /hdmi-plane\.sh "[^\n]*>\/dev\/null 2>&1 &/.test(boot),
    'the boot script starts hdmi-plane.sh in the background when the TV came up on an input'
  );
});
