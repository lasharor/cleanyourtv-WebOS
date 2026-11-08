// Opening an app on an Android box (androidbox.js): the settings are checked, launching switches the input and starts the app on the box,
// and every way it can fail is reported. The box is a stand-in device on a local port (adbdevice.js); the client is the real one.
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const { ok, call, sleep, memoryConfig, run } = require('./lib');
const { device, KEY } = require('./adbdevice');

process.env.CYTV_ADB_AUTH_MS = '300'; // the time to answer the box's question, short for the test

run(async () => {
  const D = process.env.CYTV_DIR;
  const keyFile = path.join(D, 'adb', 'adbkey');
  fs.mkdirSync(path.join(D, 'adb'));
  fs.writeFileSync(keyFile, KEY, { mode: 0o600 });

  const good = { host: '127.0.0.1', port: 5555, input: 'com.webos.app.hdmi2', apps: { plex: 'com.plexapp.android' } };
  const mod = require(path.join(__dirname, '..', '..', 'helper', 'addons-bundled', 'androidbox', 'service.js'));

  // ---- the settings ----
  ok(JSON.stringify(mod.clean(good)) === JSON.stringify(good), 'valid settings are kept as they are');
  ok(mod.clean(Object.assign({}, good, { port: undefined })).port === 5555, 'the port defaults to 5555');
  ok(mod.clean(Object.assign({}, good, { port: 70000 })).port === 5555, 'a port out of range falls back to 5555');
  ok(mod.clean(Object.assign({}, good, { host: '1.2.3.4; reboot' })) === null, 'a host with shell characters is refused');
  ok(mod.clean(Object.assign({}, good, { host: '' })) === null, 'no host: the box is switched off');
  ok(mod.clean(Object.assign({}, good, { input: 'netflix' })) === null, 'only an HDMI input app is accepted');
  ok(
    JSON.stringify(mod.clean(Object.assign({}, good, { apps: { plex: 'com.x; id' } })).apps) === '{}',
    'a package with shell characters is dropped (a box may have no apps: everything opens on the TV)'
  );
  ok(
    JSON.stringify(mod.clean(Object.assign({}, good, { apps: { plex: 'com.plexapp.android', bad: 'nodots', 'a b': 'com.a.b' } })).apps) ===
      JSON.stringify({ plex: 'com.plexapp.android' }),
    'invalid apps are dropped, valid ones stay'
  );

  // ---- the feature ----
  const conf = memoryConfig({});
  const launched = [];
  const luna = async (uri, payload) => {
    launched.push(uri.split('/').pop() + ' ' + JSON.stringify(payload));
    return { returnValue: true };
  };
  const appsStub = {
    apps: async () => [
      { id: 'plex', title: 'Plex' },
      { id: 'com.webos.app.hdmi2', title: 'PlayStation', input: 2 },
      { id: 'netflix', title: 'Netflix' },
      { id: 'mytv.player', title: 'My Player' },
    ],
  };
  const shown = [];
  const notifyStub = { show: async p => (shown.push(p), {}) };
  const f = mod.create({ config: conf, luna, feature: n => (n === 'apps' ? appsStub : n === 'notify' ? notifyStub : null) });
  let box = await device({ trusted: KEY, reply: () => 'Events injected: 1\n' });
  const at = port => Object.assign({}, good, { port });

  ok(f.handles('plex') === false && (await f.open('plex')) === null, 'nothing is set up: the app opens on the TV as before');
  let r = await call(f, '/api/androidbox');
  ok(r.j.configured === false && r.j.key.ready === true, 'status: not set up, the key is there');

  r = await call(f, '/api/androidbox', 'POST', at(box.port));
  ok(r.j.configured === true && conf.get().androidBox.host === '127.0.0.1', 'saving keeps the settings in config.json');
  ok(f.handles('plex') && !f.handles('netflix'), 'only the listed apps move to the box');

  // ---- a start that works ----
  const o = await f.open('plex');
  ok(o && o.returnValue === true && o.androidBox === 'starting', 'launching answers at once');
  ok(
    launched.length === 1 && launched[0] === 'launch {"id":"com.webos.app.hdmi2","params":{}}',
    'the TV switches to the HDMI input first: ' + launched[0]
  );
  await sleep(600);
  ok(
    box.seen.commands.length === 1 &&
      /^input keyevent KEYCODE_WAKEUP; o=\$\(monkey -p com\.plexapp\.android -c android\.intent\.category\.LAUNCHER 1 2>&1\)/.test(
        box.seen.commands[0]
      ),
    'the box wakes and the app starts by its launcher entry: ' + box.seen.commands[0]
  );
  // the command as the box's shell runs it: an app made only for Android TV (no LAUNCHER entry) is started by its LEANBACK_LAUNCHER entry
  const cp = require('child_process');
  const onBoxShell = only =>
    cp.spawnSync(
      '/bin/sh',
      [
        '-c',
        'input() { :; }; monkey() { case "$*" in *' +
          only +
          '*) echo "Events injected: 1";; *) echo "** No activities found to run, monkey aborted.";; esac; }; ' +
          box.seen.commands[0],
      ],
      { encoding: 'utf8' }
    ).stdout;
  ok(
    /Events injected/.test(onBoxShell('category.LAUNCHER')) && !/No activities/.test(onBoxShell('category.LAUNCHER')),
    'an app with a LAUNCHER entry starts'
  );
  ok(
    /Events injected/.test(onBoxShell('LEANBACK_LAUNCHER')) && !/No activities/.test(onBoxShell('LEANBACK_LAUNCHER')),
    'an Android TV only app starts by its LEANBACK_LAUNCHER entry'
  );
  ok(/No activities found/.test(onBoxShell('nothing-matches')), 'an app that has neither is reported as not found');
  ok(box.seen.good === 1, "the box accepted the TV's key");
  r = await call(f, '/api/androidbox');
  ok(r.j.last && r.j.last.ok === true && r.j.last.app === 'plex', 'the result of the start is in the status');

  // ---- a second tap while one is running ----
  const a = await f.open('plex');
  ok(a.androidBox === 'busy' || a.androidBox === 'starting', 'a quick second tap does not start a second one at the same time');
  await sleep(600);

  // ---- ways it fails ----
  async function fails(name, port, step, text) {
    await call(f, '/api/androidbox', 'POST', at(port));
    launched.length = 0;
    await f.open('plex');
    await sleep(900);
    const st = (await call(f, '/api/androidbox')).j.last;
    ok(st && st.ok === false && st.step === step && st.error.indexOf(text) >= 0, name + ' -> ' + step + ': ' + (st && st.error));
    ok(launched.length === 1, name + ': the input was switched anyway');
  }
  box.close();
  box = await device({ trusted: KEY, reply: () => '** No activities found to run, monkey aborted.\n' });
  shown.length = 0;
  await fails('Plex is not installed', box.port, 'launch', 'not installed');
  ok(
    shown.length >= 1 &&
      /^Plex is not installed on the Android box\. Install it there/.test(shown[0].text) &&
      shown[0].title === 'Android box',
    'the TV says on screen, by the app’s name, what went wrong: ' + (shown[0] && shown[0].text)
  );
  box.close();
  box = await device({ trusted: '', prompt: 'deny' });
  await fails('the box has not allowed the TV', box.port, 'authorize', 'accept the question');
  ok(box.seen.keys.length === 1, 'the TV offered its key to the box');
  box.close();
  box = await device({ auth: false, refuse: true });
  await fails('the box refuses the command', box.port, 'shell', 'refused');
  box.close();
  await fails('nothing listens on the box', box.port, 'connect', 'refused');
  fs.writeFileSync(keyFile, 'rubbish');
  box = await device({ trusted: KEY });
  await fails('the key file is damaged', box.port, 'key', 'cannot be used');
  ok((await call(f, '/api/androidbox')).j.key.ready === false, 'and the status says the key is not usable');
  fs.writeFileSync(keyFile, KEY);

  // ---- the test button ----
  box.close();
  box = await device({ trusted: KEY, reply: () => 'SHIELD Android TV\n' });
  await call(f, '/api/androidbox', 'POST', at(box.port));
  const t = await call(f, '/api/androidbox/test', 'POST', {});
  ok(
    t.j.ok === true && t.j.model === 'SHIELD Android TV' && box.seen.commands.pop() === 'getprop ro.product.model',
    'the test asks the box for its model'
  );
  box.close();

  // ---- a request that is not valid is refused and changes nothing ----
  const before = JSON.stringify(conf.get().androidBox);
  r = await call(f, '/api/androidbox', 'POST', { host: 'not a host!', input: 'com.webos.app.hdmi2', apps: good.apps });
  ok(
    r.code === 400 && /address/.test(r.j.error) && JSON.stringify(conf.get().androidBox) === before,
    'a bad address is refused: ' + r.j.error
  );
  r = await call(f, '/api/androidbox', 'POST', { host: '1.2.3.4', input: 'netflix', apps: good.apps });
  ok(r.code === 400 && /HDMI input/.test(r.j.error), 'a bad input is refused: ' + r.j.error);
  r = await call(f, '/api/androidbox', 'POST', { host: '1.2.3.4', input: 'com.webos.app.hdmi1', apps: { plex: 'nodots' } });
  ok(
    r.code === 400 && /Android package/.test(r.j.error) && JSON.stringify(conf.get().androidBox) === before,
    'no valid app is refused: ' + r.j.error
  );

  // ---- choosing apps: each one on the box or on the TV, the others stay as they were ----
  r = await call(f, '/api/androidbox/apps');
  const byId = {};
  r.j.apps.forEach(x => (byId[x.id] = x));
  ok(r.j.apps.length === 3 && !byId['com.webos.app.hdmi2'], 'the TV’s apps are listed, without the inputs');
  ok(byId.plex.on === true && byId.plex.pkg === 'com.plexapp.android', 'an app that opens on the box says so, with its package');
  ok(byId.netflix.on === false && byId.netflix.suggest === 'com.netflix.ninja', 'a known app that stays on the TV has a suggested package');
  ok(byId['mytv.player'].suggest === '', 'an unknown app has no suggestion');
  ok(mod.suggest({ id: 'cdp-30', title: 'Plex' }) === 'com.plexapp.android', 'the suggestion also finds an app by its title');
  ok(
    mod.suggest({ id: 'amazon', title: 'Prime Video' }) === 'com.amazon.amazonvideo.livingroom' &&
      mod.suggest({ id: 'amazon.alexa.view', title: 'Amazon Alexa' }) === '',
    'Prime Video is suggested, Alexa is not'
  );
  r = await call(f, '/api/androidbox/app', 'POST', { id: 'netflix', on: true });
  ok(
    r.code === 200 &&
      conf.get().androidBox.apps.netflix === 'com.netflix.ninja' &&
      conf.get().androidBox.apps.plex === 'com.plexapp.android' &&
      f.handles('netflix'),
    'one app moved to the box with its suggested package, the others stay'
  );
  r = await call(f, '/api/androidbox/app', 'POST', { id: 'mytv.player', on: true });
  ok(
    r.code === 400 && /phone/.test(r.j.error) && !f.handles('mytv.player'),
    'an app without a known package asks for it from the phone: ' + r.j.error
  );
  r = await call(f, '/api/androidbox/app', 'POST', { id: 'mytv.player', on: true, pkg: 'org.example.player' });
  ok(r.code === 200 && conf.get().androidBox.apps['mytv.player'] === 'org.example.player', 'a package that is given is used');
  r = await call(f, '/api/androidbox/app', 'POST', { id: 'mytv.player', on: true, pkg: 'bad package;' });
  ok(
    r.code === 400 && conf.get().androidBox.apps['mytv.player'] === 'org.example.player',
    'an invalid package is refused and nothing changes'
  );
  r = await call(f, '/api/androidbox/app', 'POST', { id: 'bad id!', on: false });
  ok(r.code === 400, 'an invalid app id is refused');
  for (const id of ['plex', 'netflix', 'mytv.player']) await call(f, '/api/androidbox/app', 'POST', { id, on: false });
  ok(
    JSON.stringify(conf.get().androidBox.apps) === '{}' && conf.get().androidBox.host === '127.0.0.1' && !f.handles('plex'),
    'with the last app back on the TV the box stays set up, and every app opens on the TV'
  );
  await call(f, '/api/androidbox/app', 'POST', { id: 'plex', on: true });
  ok(f.handles('plex'), 'an app can be put back on the box');
  const g = mod.create({ config: memoryConfig({}), luna, feature: () => null });
  r = await call(g, '/api/androidbox/app', 'POST', { id: 'plex', on: true });
  ok(r.code === 400, 'without a box set up nothing can be chosen');

  // ---- the phone page ----
  const phone = (method, p, code, body) =>
    new Promise(res => {
      const h = { 'accept-language': 'en' };
      if (code) h['x-code'] = code;
      const q = http.request({ host: '127.0.0.1', port: 8793, path: p, method, headers: h, agent: false }, rs => {
        let b = '';
        rs.on('data', c => (b += c));
        rs.on('end', () => res({ code: rs.statusCode, body: b }));
      });
      q.on('error', e => res({ code: 0, body: String(e) }));
      q.end(body ? JSON.stringify(body) : undefined);
    });
  const pr = await call(f, '/api/androidbox/pair', 'POST', {});
  ok(
    /^http:\/\/.+:8793$/.test(pr.j.url) && /^\d{6}$/.test(pr.j.code) && pr.j.qr === pr.j.url + '/#' + pr.j.code,
    'the phone page opens with a six-digit code: ' + pr.j.url
  );
  ok((await call(f, '/api/androidbox')).j.pairing === true, 'the status says the page is open');
  let pg = await phone('GET', '/');
  ok(
    pg.code === 200 && /<title>Android box<\/title>/.test(pg.body) && /id=host/.test(pg.body) && /var I18N/.test(pg.body),
    'the page is served without the code'
  );
  ok((await phone('GET', '/api/state', 'wrong')).code === 403, 'the data needs the code');
  const st = JSON.parse((await phone('GET', '/api/state', pr.j.code)).body);
  ok(
    st.settings.host === '127.0.0.1' &&
      st.apps.length === 3 &&
      st.apps[0].id === 'plex' &&
      st.suggest.netflix === 'com.netflix.ninja' &&
      !st.suggest['mytv.player'],
    'the page gets the settings, the TV apps without inputs, and the usual packages of known apps'
  );
  pg = await phone('POST', '/api/save', pr.j.code, {
    host: '192.168.1.60',
    port: 5555,
    input: 'com.webos.app.hdmi3',
    apps: { plex: 'com.plexapp.android' },
  });
  ok(
    pg.code === 200 &&
      JSON.parse(pg.body).ok &&
      conf.get().androidBox.host === '192.168.1.60' &&
      conf.get().androidBox.input === 'com.webos.app.hdmi3',
    'saving from the phone changes the settings'
  );
  const sv = (await call(f, '/api/androidbox')).j.savedAt;
  ok(sv > 0, 'and the status shows when, for the manager');
  pg = await phone('POST', '/api/save', pr.j.code, { host: '192.168.1.60', input: 'com.webos.app.hdmi3', apps: {} });
  ok(
    JSON.parse(pg.body).ok && conf.get().androidBox.host === '192.168.1.60' && JSON.stringify(conf.get().androidBox.apps) === '{}',
    'a box with no app ticked is saved: every app opens on the TV'
  );
  pg = await phone('POST', '/api/save', pr.j.code, { host: '192.168.1.61', input: 'com.webos.app.hdmi3', apps: { plex: 'nodots' } });
  ok(
    JSON.parse(pg.body).error && conf.get().androidBox.host === '192.168.1.60',
    'a save with an invalid package is explained and changes nothing: ' + JSON.parse(pg.body).error
  );
  for (let i = 0; i < 9; i++) await phone('GET', '/api/state', '000000');
  await sleep(100);
  ok(
    (await phone('GET', '/')).code === 0 && (await call(f, '/api/androidbox')).j.pairing === false,
    'after eight wrong codes the page closes'
  );
  await call(f, '/api/androidbox/pair', 'POST', {});
  await call(f, '/api/androidbox/pair', 'POST', { stop: true });
  ok((await phone('GET', '/')).code === 0, 'closing the page from the TV stops it');

  // ---- switching it off ----
  r = await call(f, '/api/androidbox', 'POST', { host: '' });
  ok(
    r.j.configured === false && conf.get().androidBox === undefined && !f.handles('plex'),
    'an empty host switches the box off and removes it'
  );
});
