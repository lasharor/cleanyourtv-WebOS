// The launcher's app list (apps.js): the first answer is waited for, later ones come from memory while the list is asked again.
// Inputs pinned to Home are listed with the apps.
const { ok, call, req, memoryConfig, run } = require('./lib');

run(async () => {
  let asked = 0,
    title = 'One';
  const luna = async uri => {
    if (/listApps/.test(uri)) {
      asked++;
      await new Promise(r => setTimeout(r, 50));
      return {
        returnValue: true,
        apps: [
          { id: 'a.one', title, folderPath: '/x', icon: 'i.png' },
          { id: 'com.webos.app.home', title: 'Home' },
        ],
      };
    }
    if (/getAllInputStatus/.test(uri))
      return {
        returnValue: true,
        devices: [
          { appId: 'com.webos.app.hdmi1', port: 1, label: 'HDMI 1', hdmiPlugIn: false },
          { appId: 'com.webos.app.hdmi2', port: 2, label: 'PlayStation', hdmiPlugIn: true },
        ],
      };
    return { returnValue: true };
  };
  const config = memoryConfig({ dock: ['a.one'], wallpapers: { immich: { url: 'http://immich', key: 'secret-immich-key' } } });
  const wpStub = { stamp: () => '3:abcd' };
  const apps = req('apps').create({ config, luna, version: '1.6.0', feature: n => (n === 'wallpapers' ? wpStub : null) });
  let r = await call(apps, '/api/apps');
  ok(
    r.out.indexOf('secret-immich-key') < 0 && r.j.config.wallpapers.stamp === '3:abcd',
    'the launcher gets a stamp of the Wallpapers photos, never the Immich key'
  );
  ok(
    asked === 1 && r.j.apps.length === 1 && r.j.apps[0].title === 'One' && r.j.config.dock[0] === 'a.one',
    'the first list is asked from the app manager, without LG Home'
  );
  title = 'Two';
  const t0 = Date.now();
  r = await call(apps, '/api/apps');
  ok(asked === 1 && r.j.apps[0].title === 'One' && Date.now() - t0 < 40, 'opened again soon: the list comes from memory at once');
  r = await call(apps, '/api/launch', 'POST', { id: 'bad id' });
  ok(r.code === 400, 'a bad app id is refused');

  // pinned inputs (hold OK on an input): kept by the service, listed with the apps under the input app's id
  r = await call(apps, '/api/inputs/pin', 'POST', { id: 'com.webos.app.hdmi2', on: true });
  ok(r.j.returnValue === true && config.get().pinnedInputs.length === 1, 'an input is pinned to Home');
  r = await call(apps, '/api/inputs/pin', 'POST', { id: 'com.webos.app.hdmi1', on: true });
  r = await call(apps, '/api/apps');
  const pins = r.j.apps.filter(a => a.input);
  ok(
    pins.length === 2 &&
      pins[0].id === 'com.webos.app.hdmi2' &&
      pins[0].title === 'PlayStation' &&
      pins[0].input === 2 &&
      pins[0].off === false &&
      pins[1].title === 'HDMI 1' &&
      pins[1].off === true,
    "pinned inputs are listed with the apps: the TV's name for the input, the port, and whether something is connected"
  );
  r = await call(apps, '/api/inputs/pin', 'POST', { id: 'com.webos.app.hdmi9', on: true });
  ok(r.j.returnValue === false && config.get().pinnedInputs.length === 2, 'an input the TV does not have is not pinned');
  config.update('test', c => {
    c.dock = ['a.one', 'com.webos.app.hdmi2'];
  });
  await call(apps, '/api/config', 'POST', { dock: ['a.one'], sort: 'alpha' });
  ok(config.get().pinnedInputs.length === 2, "saving the launcher's settings keeps the pinned inputs");
  await call(apps, '/api/config', 'POST', { dock: ['a.one'], sort: 'custom', order: ['a.two', 'a.one'] });
  ok(
    config.get().sort === 'custom' && JSON.stringify(config.get().order) === JSON.stringify(['a.two', 'a.one']),
    'custom sort and order are saved in config'
  );
  await call(apps, '/api/config', 'POST', { dock: ['a.one'], runDots: true });
  const on = config.get().runDots === true;
  await call(apps, '/api/config', 'POST', { dock: ['a.one'], runDots: 'yes' });
  ok(on && config.get().runDots === undefined, 'the green dot on open apps is off by default and saved only when switched on');
  await call(apps, '/api/config', 'POST', { dock: ['a.one'], shelfShow: false });
  const sfOff = config.get().shelfShow === false;
  await call(apps, '/api/config', 'POST', { dock: ['a.one'] });
  ok(sfOff && config.get().shelfShow === undefined, 'Show app name is on by default and saved only when hidden');
  await call(apps, '/api/config', 'POST', {
    dock: ['a.one'],
    cards: { greeting: { type: 'greeting', name: 'Sam' }, 'x y': { type: 'a' } },
  });
  const savedCards = JSON.stringify(config.get().cards);
  await call(apps, '/api/config', 'POST', { dock: ['a.one'] });
  ok(
    savedCards === JSON.stringify({ greeting: { type: 'greeting', name: 'Sam' } }) && config.get().cards === undefined,
    'the launcher saves its cards (checked) with its other settings, and a save without them removes them'
  );
  await call(apps, '/api/config', 'POST', { wall: { on: true, secs: 10 } });
  const w10 = config.get().wall;
  await call(apps, '/api/config', 'POST', { wall: { on: true, every: 5 } });
  const wOld = config.get().wall;
  await call(apps, '/api/config', 'POST', { wall: { on: false, secs: 7 } });
  ok(
    w10.on && w10.secs === 10 && wOld.secs === 300 && config.get().wall.secs === 900,
    "Wallpapers: the photo interval is saved in seconds (10 s up to an hour), an older launcher's minutes are converted, an unknown value becomes 15 min"
  );

  config.update('test', c => {
    c.dock = ['a.one', 'com.webos.app.hdmi2'];
  });
  r = await call(apps, '/api/inputs/pin', 'POST', { id: 'com.webos.app.hdmi2', on: false });
  ok(
    r.j.returnValue === true && config.get().pinnedInputs.length === 1 && config.get().dock.indexOf('com.webos.app.hdmi2') < 0,
    'an input taken off Home leaves the dock too'
  );

  // LG's own Live TV is the TV's tuner input, but the TV does not report it with the HDMI ports (issue 69): the service adds it while
  // its app is installed, after the ports, for the Inputs list and the Inputs picker
  r = await call(apps, '/api/inputs');
  ok(!(r.j.devices || []).some(d => d.tuner), "a TV without LG's Live TV app lists no tuner among its inputs");
  // getAppInfo as an LG TV answers it on webOS 22 and newer: the app's fields in appInfo, not at the top (QNED86A6A, webOS 9)
  const tunerLuna = async (uri, p) => {
    if (/getAppInfo/.test(uri))
      return p && p.id === 'com.webos.app.livetv'
        ? { returnValue: true, appId: p.id, appInfo: { title: 'Live TV', icon: 'assets/icon_livetv_80.png' } }
        : { returnValue: false };
    if (/getAllInputStatus/.test(uri))
      return { returnValue: true, devices: [{ appId: 'com.webos.app.hdmi1', port: 1, label: 'HDMI 1', hdmiPlugIn: true }] };
    return { returnValue: true };
  };
  r = await call(apps, '/api/apps');
  ok(r.j.tuner === undefined, "a TV without LG's Live TV app does not tell the launcher about a tuner (no TV button)");
  const tunerApps = req('apps').create({ config: memoryConfig({}), luna: tunerLuna, version: '1.6.0', feature: () => null });
  r = await call(tunerApps, '/api/apps');
  ok(r.j.tuner === true, "a TV with LG's Live TV says so, so Customise offers the TV button");
  r = await call(tunerApps, '/api/inputs');
  ok(
    r.j.devices.length === 2 &&
      r.j.devices[1].appId === 'com.webos.app.livetv' &&
      r.j.devices[1].tuner === true &&
      !r.j.devices[1].activate,
    "LG's Live TV is listed with the inputs while its app is installed, after the HDMI ports"
  );
  await tunerApps.onForeground('com.webos.app.livetv');
  r = await call(tunerApps, '/api/inputs');
  ok(
    r.j.devices[1].activate === true,
    "the tuner is the active input while LG's Live TV is the app in front (the green dot in the picker)"
  );
  r = await call(tunerApps, '/api/inputs/pin', 'POST', { id: 'com.webos.app.livetv', on: true });
  ok(r.j.returnValue === false, 'the tuner is not pinned to Home like an HDMI port (a top button opens it)');
  const ownLuna = async uri => {
    if (/getAppInfo/.test(uri)) return { returnValue: true, id: 'com.webos.app.livetv', title: 'Live TV' };
    if (/getAllInputStatus/.test(uri)) return { returnValue: true, devices: [{ id: 'TV', appId: 'com.webos.app.livetv', label: 'TV' }] };
    return { returnValue: true };
  };
  const ownApps = req('apps').create({ config: memoryConfig({}), luna: ownLuna, version: '1.6.0', feature: () => null });
  r = await call(ownApps, '/api/inputs');
  ok(r.j.devices.length === 1, 'a TV that reports the tuner itself gets no second one');
  // the manager's "Show LG's own Live TV" off: no tuner in the list (also where the firmware reports it), no TV button, the HDMI ports stay
  const offApps = req('apps').create({
    config: memoryConfig({ options: { tuner: false } }),
    luna: tunerLuna,
    version: '1.6.0',
    feature: () => null,
  });
  r = await call(offApps, '/api/inputs');
  const offApps2 = req('apps').create({
    config: memoryConfig({ options: { tuner: false } }),
    luna: ownLuna,
    version: '1.6.0',
    feature: () => null,
  });
  const r2 = await call(offApps2, '/api/inputs');
  ok(
    r.j.devices.length === 1 && r.j.devices[0].appId === 'com.webos.app.hdmi1' && r2.j.devices.length === 0,
    "with Show LG's own Live TV off the tuner is left out of the inputs, also where the TV reports it itself"
  );
  r = await call(offApps, '/api/apps');
  ok(r.j.tuner === undefined, "with Show LG's own Live TV off the launcher gets no TV button");
  const onApps = req('apps').create({
    config: memoryConfig({ options: { tuner: true, liveTv: false } }),
    luna: tunerLuna,
    version: '1.6.0',
    feature: () => null,
  });
  r = await call(onApps, '/api/inputs');
  ok(
    r.j.devices.length === 2 && r.j.devices[1].tuner === true,
    'the tuner does not depend on Show Live TV (the playlist): each is its own switch'
  );

  // a full power-off (issue 50): tvpower/power/shutDown, only on POST, and the reply does not wait for the TV
  const powerCalls = [];
  const powerApps = req('apps').create({
    config: memoryConfig({}),
    luna: async (uri, p) => {
      powerCalls.push([uri, p]);
      return { returnValue: true };
    },
    version: '1.6.0',
    feature: () => null,
  });
  r = await call(powerApps, '/api/power/off', 'POST', {});
  ok(
    r.j.returnValue === true &&
      powerCalls.length === 1 &&
      powerCalls[0][0] === 'luna://com.webos.service.tvpower/power/shutDown' &&
      powerCalls[0][1].reason === 'remoteKey',
    'Power off switches the TV off completely through tvpower/power/shutDown'
  );
  r = await call(powerApps, '/api/power/off', 'GET');
  ok(powerCalls.length === 1 && r.code !== 200, 'a GET does not power the TV off');

  // uninstalling apps
  r = await call(apps, '/api/apps/uninstall', 'POST', { id: 'bad id!' });
  ok(r.code === 400 && r.j.returnValue === false, 'uninstall with bad id is refused');
  r = await call(apps, '/api/apps/uninstall', 'POST', { id: 'com.cleanyourtv.manager' });
  ok(r.code === 400 && r.j.returnValue === false, 'uninstall of CleanYourTV itself is refused');
  r = await call(apps, '/api/apps/uninstall', 'POST', { id: 'a.one' });
  ok(r.code === 400 && r.j.returnValue === false, 'uninstalling a non-removable app is refused');

  const removedCalls = [];
  const luna2 = async (uri, payload) => {
    if (/listApps/.test(uri)) {
      return {
        returnValue: true,
        apps: [
          {
            id: 'com.store.app',
            title: 'Store App',
            folderPath: '/media/cryptofs/apps/usr/palm/applications/com.store.app',
            removable: true,
          },
          { id: 'com.dev.app', title: 'Dev App', folderPath: '/media/developer/apps/usr/palm/applications/com.dev.app' },
          {
            id: 'org.webosbrew.hbchannel',
            title: 'Homebrew Channel',
            folderPath: '/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel',
          },
        ],
      };
    }
    if (/appInstallService/.test(uri)) {
      removedCalls.push({ uri, id: payload.id });
      return { returnValue: true };
    }
    return { returnValue: true };
  };
  const config2 = memoryConfig({ dock: ['com.store.app', 'com.dev.app'], hidden: ['com.store.app'] });
  const apps2 = req('apps').create({ config: config2, luna: luna2, version: '1.6.0', feature: () => null });
  const list2 = await call(apps2, '/api/apps');
  ok(
    list2.j.apps.length === 3 && list2.j.apps[0].removable === true && list2.j.apps[1].removable === true && !list2.j.apps[2].removable,
    'store and dev apps are marked removable, the Homebrew Channel is not'
  );

  r = await call(apps2, '/api/apps/uninstall', 'POST', { id: 'com.store.app' });
  ok(
    r.j.returnValue === true &&
      removedCalls.some(c => /appInstallService\/remove$/.test(c.uri) && c.id === 'com.store.app') &&
      config2.get().dock.indexOf('com.store.app') < 0 &&
      config2.get().hidden.indexOf('com.store.app') < 0,
    'a store app is removed via appInstallService/remove and dropped from dock and hidden'
  );

  r = await call(apps2, '/api/apps/uninstall', 'POST', { id: 'com.dev.app' });
  ok(
    r.j.returnValue === true &&
      removedCalls.some(c => /appInstallService\/dev\/remove$/.test(c.uri) && c.id === 'com.dev.app') &&
      config2.get().dock.indexOf('com.dev.app') < 0,
    'a dev app is removed via appInstallService/dev/remove and dropped from dock'
  );

  // a removal that fails changes nothing: no files deleted, the dock, the hidden list and the app list stay as they were
  const fs = require('fs'),
    ex = require('../../helper/exec');
  const rms = [],
    exists = fs.existsSync,
    execFile = ex.execFile;
  fs.existsSync = f => /^\/media\/developer\/apps\/usr\/palm\//.test(String(f)) || exists(f);
  ex.execFile = (cmd, args, o, cb) => {
    if (cmd === 'rm') rms.push(args.join(' '));
    else execFile(cmd, args, o, cb);
  };
  try {
    let fail = true;
    const luna3 = async uri => {
      if (/listApps/.test(uri))
        return {
          returnValue: true,
          apps: [{ id: 'com.dev.keep', title: 'Keep', folderPath: '/media/developer/apps/usr/palm/applications/com.dev.keep' }],
        };
      if (/appInstallService/.test(uri)) return fail ? { returnValue: false, errorText: 'busy' } : { returnValue: true };
      return { returnValue: true };
    };
    const config3 = memoryConfig({ dock: ['com.dev.keep'], hidden: ['com.dev.keep'] });
    const apps3 = req('apps').create({ config: config3, luna: luna3, version: '1.6.0', feature: () => null });
    await call(apps3, '/api/apps');
    r = await call(apps3, '/api/apps/uninstall', 'POST', { id: 'com.dev.keep' });
    const after = await call(apps3, '/api/apps');
    ok(
      r.code === 400 &&
        r.j.error === 'busy' &&
        rms.length === 0 &&
        config3.get().dock.indexOf('com.dev.keep') >= 0 &&
        config3.get().hidden.indexOf('com.dev.keep') >= 0 &&
        after.j.apps.some(x => x.id === 'com.dev.keep'),
      'a failed removal deletes no files and leaves the dock, the hidden list and the app list alone'
    );
    fail = false;
    r = await call(apps3, '/api/apps/uninstall', 'POST', { id: 'com.dev.keep' });
    ok(
      r.j.returnValue === true &&
        rms.length === 2 &&
        rms.every(x => /^-rf \/media\/developer\/apps\/usr\/palm\/(packages|applications)\/com\.dev\.keep$/.test(x)),
      'a removal that works deletes the package folders'
    );
  } finally {
    fs.existsSync = exists;
    ex.execFile = execFile;
  }
  for (const bad of ['..', '.hidden', '../x', 'org.webosbrew.hbchannel', 'org.webosbrew.safeupdate', 'org.webosbrew.appupdateblocker'])
    ok((await call(apps, '/api/apps/uninstall', 'POST', { id: bad })).j.error === 'refused', 'the id ' + bad + ' is refused');

  // audio volume status and polling
  r = await call(apps, '/api/audio/volume');
  ok(
    r.j && typeof r.j.volume === 'number' && typeof r.j.seq === 'number' && typeof r.j.theme === 'string',
    'the launcher can query audio volume and theme'
  );

  // an app set up to open on an Android box (androidbox.js) goes there instead of opening on the TV
  const sent = [],
    opened = [];
  const spy = async (uri, payload) => {
    sent.push(uri.split('/').pop() + ' ' + payload.id);
    return { returnValue: true };
  };
  const box = { handles: id => id === 'plex', open: async id => (opened.push(id), { returnValue: true, androidBox: 'starting' }) };
  const withBox = req('apps').create({
    config: memoryConfig({ androidBox: { host: '192.168.1.50', port: 5555 }, dock: [] }),
    luna: spy,
    version: '1.6.0',
    feature: n => (n === 'androidbox' ? box : null),
  });
  r = await call(withBox, '/api/launch', 'POST', { id: 'plex' });
  ok(r.j.androidBox === 'starting' && opened[0] === 'plex' && sent.length === 0, 'an app set up for the box is not launched on the TV');
  r = await call(withBox, '/api/launch', 'POST', { id: 'netflix' });
  ok(r.j.returnValue === true && sent[0] === 'launch netflix' && opened.length === 1, 'any other app still opens on the TV');
  r = await call(withBox, '/api/apps');
  ok(r.j.config.androidBox === undefined, "the launcher is not given the box's address");
});
