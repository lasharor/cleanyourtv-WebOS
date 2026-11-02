// The TV profile (tvprofile.js): the facts of a TV go in, every per-TV decision comes out. When a new kind of TV needs another
// decision, add its case here.
const path = require('path'),
  cp = require('child_process');
const { root, helper, ok, req, run } = require('./lib');
const tv = req('tvprofile');

run(async () => {
  const compat = [
    { firmware: '33.23.05', sdk: '10.2.2', note: 'OLED65G26LA' },
    { firmware: '04.4*', note: 'a prefix' },
    { firmware: '6.5.3', note: 'by SDK' },
  ];
  const cases = [
    // [what, facts, expected decisions]
    [
      'webOS 25 (G2, the tested TV)',
      { sdk: '10.2.2', firmware: '33.23.05', home: 'com.webos.app.home flutter', node: 'v16.20.2' },
      { pickerMode: 'overlay', notifyWindow: 'topui', homeSupported: true, tested: true, legacyNode: false },
    ],
    [
      'webOS 26 (SDK 11): the hidden picker was not tried there (issue 6)',
      { sdk: '11.2.0', firmware: '43.21.77', home: 'com.webos.app.home web', node: 'v16.20.2' },
      { pickerMode: 'ondemand', notifyWindow: 'topui', homeSupported: true, tested: false },
    ],
    [
      'webOS 6.5 (issue 5)',
      { sdk: '6.5.3', firmware: '03.53.45', home: 'com.webos.app.home native', node: 'v8.12.0' },
      { pickerMode: 'ondemand', notifyWindow: 'overlay', homeSupported: false, tested: true, legacyNode: true },
    ],
    [
      'webOS 5 (issue 4)',
      { sdk: '5.6.2', firmware: '04.41.35', home: 'com.webos.app.home native', node: 'v8.12.0' },
      { pickerMode: 'ondemand', notifyWindow: 'overlay', tested: true, testedNote: 'a prefix' },
    ],
    [
      'SDK unknown',
      { sdk: '', firmware: '', home: '' },
      { pickerMode: 'ondemand', notifyWindow: 'overlay', homeSupported: false, tested: false, sdkMajor: 0 },
    ],
  ];
  for (const c of cases) {
    const p = tv.decide(c[1], compat);
    const wrong = Object.keys(c[2]).filter(k => p[k] !== c[2][k]);
    ok(!wrong.length, c[0] + (wrong.length ? ': ' + wrong.map(k => k + ' is ' + JSON.stringify(p[k])).join(', ') : ''));
  }
  ok(
    tv.decide({ sdk: '5.6.2' }).afterSam === 'eim webapp-mgr preload-manager memorymanager' &&
      tv.decide({ sdk: '6.5.3' }).afterSam !== '' &&
      tv.decide({ sdk: '10.2.2' }).afterSam === '' &&
      tv.decide({ sdk: '' }).afterSam === '',
    'after the app manager restart, webOS 5 and 6 and every TV with the native Home restart the services that talk to it (issues 14, 23, 24); a flutter Home and an unknown TV do not'
  );
  ok(
    tv.decide({ home: 'com.webos.app.home native' }).homeTakeover === 'standin' &&
      tv.decide({ home: 'com.webos.app.home flutter' }).homeTakeover === 'mount' &&
      tv.decide({ home: 'com.webos.app.home web' }).homeTakeover === 'mount' &&
      tv.decide({}).homeTakeover === 'mount',
    "LG's native Home is taken over by a stand-in for its program (no app manager restart); flutter, web and unknown by the mount"
  );
  ok(
    tv.decide({ cmdline: 'console=ttyS0 criu_enabled root=/dev/mmcblk0p9' }).criu === true &&
      tv.decide({ cmdline: 'criu_enabled' }).criu === true &&
      tv.decide({ cmdline: 'console=ttyS0 root=/dev/mmcblk0p9' }).criu === false &&
      tv.decide({ cmdline: 'no_criu_enabled_here' }).criu === false &&
      tv.decide({}).criu === false &&
      tv.decide({ home: 'com.webos.app.home native', cmdline: 'criu_enabled' }).homeTakeover === 'standin',
    'CRIU on the kernel command line is reported (issues 72 and 84) but does not change the way: the setup tries the stand-in first'
  );
  // Issue 21: ARC remained silent after SAM restarted, although the controller was active.
  const arc = { model: 'OLED65C35LA.AEU', sdk: '11.2.0', home: 'com.webos.app.home flutter' };
  ok(
    tv.decide(arc).afterSam === 'arccontroller umediaserver',
    'webOS 26 restarts the ARC controller and umediaserver after SAM (issue 21), whatever the model name'
  );
  ok(
    tv.decide(Object.assign({}, arc, { home: 'com.webos.app.home web' })).afterSam === 'arccontroller umediaserver',
    'also with the web Home'
  );
  for (const change of [{ sdk: '' }, { home: '' }]) {
    ok(tv.decide(Object.assign({}, arc, change)).afterSam === '', 'not on an unknown TV ' + JSON.stringify(change));
  }
  // issue 122: webOS 25 with the flutter or web Home, black video after the restart of SAM
  const b2 = { model: 'OLED65B2RLA', sdk: '10.3.2', home: 'com.webos.app.home flutter' };
  ok(
    tv.decide(b2).afterSam === 'videooutputd umediaserver' &&
      tv.decide(Object.assign({}, b2, { home: 'com.webos.app.home web' })).afterSam === 'videooutputd umediaserver' &&
      tv.decide(Object.assign({}, b2, { sdk: '10.2.2' })).afterSam === 'videooutputd umediaserver',
    'webOS 25 restarts videooutputd and then umediaserver after SAM (issue 122), ARC left alone'
  );
  ok(
    tv.decide(Object.assign({}, b2, { home: 'com.webos.app.home native' })).afterSam === 'eim webapp-mgr preload-manager memorymanager' &&
      tv.decide(Object.assign({}, b2, { home: '' })).afterSam === '' &&
      tv.decide(Object.assign({}, b2, { sdk: '' })).afterSam === '',
    'the native Home keeps its own list on webOS 25, and an unknown Home or SDK restarts nothing'
  );
  // the setup script asks the same rules from the shell
  const cli = args => cp.spawnSync(process.execPath, [path.join(helper, 'tvprofile.js')].concat(args), { encoding: 'utf8' }).stdout.trim();
  ok(
    cli(['get', 'notifyWindow', '--sdk', '5.4.3']) === 'overlay' && cli(['get', 'notifyWindow', '--sdk', '10.2.2']) === 'topui',
    'from the shell: the notification window type'
  );
  ok(
    cli(['get', 'tested', '--firmware', '33.23.05', '--compat', path.join(root, 'compat.json')]) === '1' &&
      cli(['get', 'tested', '--firmware', '99.99.99', '--compat', path.join(root, 'compat.json')]) === '0',
    "from the shell: is the firmware in the repository's compat.json"
  );
  ok(cli(['get', 'homeSupported', '--home', 'com.webos.app.home flutter']) === '1', "from the shell: LG's Home kind");
  ok(
    cli(['get', 'afterSam', '--sdk', arc.sdk, '--home', arc.home]) === 'arccontroller umediaserver',
    'from the shell: webOS 26 restarts the ARC controller'
  );
  // the service saves the profile and reads it again after a restart
  const svc = tv.create({ luna: async () => ({ returnValue: true, modelName: 'X', firmwareVersion: '1', sdkVersion: '6.5.0' }) });
  const p = await svc.refresh();
  ok(
    p.pickerMode === 'ondemand' && p.model === 'X' && tv.create({ luna: async () => ({}) }).get().sdk === '6.5.0',
    'the service keeps the profile in tv.json'
  );
  const failed = tv.create({ luna: async () => ({ returnValue: false }) });
  ok((await failed.refresh()).sdk === '6.5.0', 'when luna does not answer, the saved profile stays');
});
