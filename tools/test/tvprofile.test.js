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
  // Issue 21: ARC remained silent after SAM restarted, although the controller was active.
  const arc = { model: 'OLED65C35LA', sdk: '11.2.0', home: 'com.webos.app.home flutter' };
  ok(tv.decide(arc).afterSam === 'arccontroller', 'C3 on SDK 11 recovers ARC after SAM restarts');
  for (const change of [{ model: 'OTHER' }, { sdk: '10.2.2' }, { sdk: '' }, { home: '' }]) {
    ok(
      tv.decide(Object.assign({}, arc, change)).afterSam === '',
      'ARC recovery is limited to the reported profile ' + JSON.stringify(change)
    );
  }
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
    cli(['get', 'afterSam', '--model', arc.model, '--sdk', arc.sdk, '--home', arc.home]) === 'arccontroller',
    'from the shell: the reported model recovers ARC'
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
