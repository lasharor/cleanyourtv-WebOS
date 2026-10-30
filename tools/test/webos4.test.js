// The standalone prototype must not expose the normal helper's settings, hooks or background work.
const fs = require('fs'),
  path = require('path'),
  http = require('http'),
  cp = require('child_process'),
  vm = require('vm');
const { root, tmp, ok, run, sleep } = require('./lib');
const prototype = require('../../helper/webos4');

function request(server, route, method, body, origin) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    if (origin !== undefined) headers.origin = origin;
    const q = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method: method || 'GET', headers }, r => {
      let out = '';
      r.on('data', c => (out += c));
      r.on('end', () => resolve({ code: r.statusCode, headers: r.headers, json: out ? JSON.parse(out) : null }));
    });
    q.on('error', reject);
    q.end(data);
  });
}

run(async () => {
  const calls = [];
  let fail = false;
  const luna = async (uri, payload) => {
    calls.push({ uri, payload });
    if (/listApps$/.test(uri))
      return fail
        ? { returnValue: false }
        : {
            returnValue: true,
            apps: [
              { id: 'app.one', title: 'One', folderPath: path.join(root, 'webos4/app'), icon: 'icon.png' },
              { id: 'app.two', title: 'Two' },
              { id: 'com.cleanyourtv.webos4', title: 'Self' },
              { id: 'com.webos.app.home', title: 'Home' },
              { id: 'com.webos.app.livetv', title: 'Live TV', visible: true },
              { id: 'com.palm.app.settings', title: 'Settings', visible: false },
              { id: 'app.hidden', visible: false },
            ],
          };
    return { returnValue: true };
  };
  const server = prototype.create({ luna });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    ok(calls.length === 0, 'startup makes no Luna calls or feature start calls');
    let r = await request(server, '/api/service');
    ok(r.json.readOnly && r.json.features.join() === 'apps', 'the default service is read-only and loads only apps');
    r = await request(server, '/api/apps');
    ok(
      r.json.apps.map(a => a.id).join() === 'app.one,app.two,com.webos.app.livetv' && !Object.keys(r.json.config).length,
      'visible installed apps include native Live TV, without saved settings'
    );
    r = await request(server, '/api/launch', 'POST', { id: 'app.one' });
    ok(r.code === 403 && !calls.some(c => /\/launch$/.test(c.uri)), 'read-only mode never launches apps');
    r = await request(server, '/api/launch', 'POST', { id: 'com.webos.app.livetv' });
    ok(r.code === 403 && !calls.some(c => /\/launch$/.test(c.uri)), 'native Live TV also respects read-only mode');
    r = await request(server, '/api/launch', 'POST', { id: 'com.palm.app.settings' });
    ok(r.code === 403 && !calls.some(c => /\/launch$/.test(c.uri)), 'native Settings also respects read-only mode');
    for (const route of [
      '/api/config',
      '/api/manager/options',
      '/api/manager/check',
      '/api/manager/update-service',
      '/api/manager/update-frontend',
      '/api/inputs',
      '/api/live/status',
    ]) {
      r = await request(server, route, 'POST', {});
      ok(r.code === 404, 'unavailable route ' + route);
    }
    r = await request(server, '/api/apps', 'POST');
    ok(r.code === 405 && r.headers.allow === 'GET', 'read routes reject writes');
    r = await request(server, '/icon/app.one', 'POST');
    ok(r.code === 405 && r.headers.allow === 'GET', 'TV icon route rejects writes');
    const icon = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: server.address().port, path: '/icon/app.one' }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
        })
        .on('error', reject);
    });
    ok(
      icon.status === 200 && icon.bytes.equals(fs.readFileSync(path.join(root, 'webos4/app/icon.png'))),
      'icons are read from installed TV apps without redistributing their artwork'
    );
    for (const origin of [
      'http://evil.example',
      'https://evil.example',
      'file://com.other.app-webos',
      'file://com.cleanyourtv.webos4.evil',
      'file://com.cleanyourtv.webos4-webos.evil',
    ]) {
      r = await request(server, '/api/version', 'GET', undefined, origin);
      ok(r.code === 403 && !r.headers['access-control-allow-origin'], 'untrusted origin refused: ' + origin);
    }
    for (const origin of ['null', 'file://com.cleanyourtv.webos4', 'file://com.cleanyourtv.webos4-webos']) {
      r = await request(server, '/api/version', 'GET', undefined, origin);
      ok(
        r.code === 200 && r.json.version === prototype.VERSION && r.headers['access-control-allow-origin'],
        'accepted local origin: ' + origin
      );
    }
    r = await request(server, '/api/launch', 'OPTIONS', undefined, 'file://com.cleanyourtv.webos4-webos');
    ok(r.code === 204, 'the standalone file origin can preflight JSON requests');
  } finally {
    await new Promise(r => server.close(r));
  }
  const launch = prototype.create({ luna, allowLaunch: true });
  await new Promise(r => launch.listen(0, '127.0.0.1', r));
  try {
    fail = true;
    let r = await request(launch, '/api/apps');
    ok(r.code === 500, 'Luna failure is reported instead of an empty success');
    fail = false;
    r = await request(launch, '/api/apps');
    ok(r.code === 200 && r.json.apps.length === 3, 'Refresh can recover after a failed Luna query');
    for (const body of [null, {}, { id: '../escape' }, { id: 42 }, { id: 'a'.repeat(201) }]) {
      r = await request(launch, '/api/launch', 'POST', body);
      ok(r.code === 400, 'invalid launch body rejected: ' + JSON.stringify(body));
    }
    r = await request(launch, '/api/launch', 'POST', { id: 'app.unknown' });
    ok(r.code === 404, 'an unlisted app cannot be launched');
    r = await request(launch, '/api/launch', 'POST', { id: 'app.hidden' });
    ok(r.code === 404, 'other hidden apps remain unavailable');
    const beforeSettings = calls.length;
    r = await request(launch, '/api/launch', 'POST', { id: 'com.palm.app.settings', params: { injected: true } });
    ok(
      r.code === 200 &&
        r.json.returnValue === true &&
        calls.length === beforeSettings + 1 &&
        /\/launch$/.test(calls[beforeSettings].uri) &&
        JSON.stringify(calls[beforeSettings].payload) === '{"id":"com.palm.app.settings","params":{}}',
      'the known native Settings app opens even when hidden, without caller parameters or closing inputs'
    );
    const beforeNative = calls.length;
    r = await request(
      launch,
      '/api/launch',
      'POST',
      { id: 'com.webos.app.livetv', params: { reason: 'boot', injected: true } },
      'file://com.cleanyourtv.webos4'
    );
    const nativeCall = calls[calls.length - 1];
    ok(
      r.code === 200 &&
        nativeCall.payload.id === 'com.webos.app.livetv' &&
        nativeCall.payload.reason === 'recent' &&
        nativeCall.payload.checkUpdateOnLaunch === false &&
        nativeCall.payload.autoInstallation === false &&
        JSON.stringify(nativeCall.payload.params) === '{"reason":"recent"}',
      "Live TV uses LG's captured activation payload, not caller-supplied parameters"
    );
    ok(calls.slice(beforeNative).length === 1 && /\/launch$/.test(nativeCall.uri), 'Live TV opens without closing other TV inputs');
    const beforeHdmi = calls.length;
    r = await request(launch, '/api/launch', 'POST', { id: 'com.webos.app.hdmi1', params: { deviceId: 'invalid' } });
    ok(
      r.code === 200 &&
        calls.length === beforeHdmi + 1 &&
        /\/launch$/.test(calls[beforeHdmi].uri) &&
        JSON.stringify(calls[beforeHdmi].payload) === '{"id":"com.webos.app.hdmi1"}',
      "HDMI 1 uses LG's id-only launch without closing Live TV or forwarding parameters"
    );
    r = await request(launch, '/api/launch', 'GET');
    ok(r.code === 405, 'a GET cannot launch an app');
    r = await request(launch, '/api/launch', 'POST', { id: 'app.one', params: { hidden: true } }, 'file://com.cleanyourtv.webos4');
    const call = calls[calls.length - 1];
    ok(
      r.json.returnValue && /\/launch$/.test(call.uri) && call.payload.id === 'app.one' && !Object.keys(call.payload.params).length,
      'only a listed app launches, with no caller-supplied parameters'
    );
  } finally {
    await new Promise(r => launch.close(r));
  }

  // Exercise the real entry point and stop script, not only the injectable HTTP feature.
  const state = path.join(tmp, 'standalone'),
    entry = path.join(root, 'helper', 'webos4.js'),
    script = path.join(root, 'webos4', 'service.sh');
  const env = Object.assign({}, process.env, { CYTV_WEBOS4_DIR: state });
  const main = cp.spawn(process.execPath, [entry], { env, stdio: 'ignore' });
  const exited = new Promise(resolve => main.on('exit', resolve));
  const pidfile = path.join(state, 'helper.pid');
  try {
    for (let i = 0; i < 100 && !fs.existsSync(pidfile); i++) await sleep(30);
    ok(
      fs.existsSync(pidfile) && fs.readFileSync(pidfile, 'utf8').trim() === String(main.pid),
      'entry point saves only its own PID in the isolated directory'
    );
    const contender = cp.spawnSync(process.execPath, [entry], {
      env: Object.assign({}, env, { CYTV_WEBOS4_DIR: path.join(tmp, 'contender') }),
      encoding: 'utf8',
      timeout: 5000,
    });
    ok(
      contender.status === 1 && /EADDRINUSE/.test(contender.stderr) && !fs.existsSync(path.join(tmp, 'contender')),
      'an occupied port fails without writing state or stopping the running helper'
    );
    ok(cp.spawnSync('sh', [script, 'status'], { env }).status === 0, 'status recognises the saved helper process');
    const readonly = await request({ address: () => ({ port: 8765 }) }, '/api/service');
    ok(readonly.json.readOnly, 'the real executable starts in read-only mode');
    ok(cp.spawnSync('sh', [script, 'stop'], { env }).status === 0, 'stop targets the matching helper');
    await exited;
    ok(!fs.existsSync(pidfile) && !fs.existsSync(path.join(state, 'run.json')), 'a clean stop removes only its own PID and diagnostics');
    ok(!fs.existsSync(path.join(process.env.CYTV_DIR, 'config.json')), 'the inherited official state never receives a config write');
    fs.writeFileSync(pidfile, String(process.pid));
    ok(cp.spawnSync('sh', [script, 'stop'], { env }).status !== 0, 'a PID reused by another program is never stopped');
    fs.writeFileSync(pidfile, '-1');
    ok(cp.spawnSync('sh', [script, 'stop'], { env }).status !== 0, 'a process-group PID is rejected');
  } finally {
    if (main.exitCode === null) main.kill('SIGKILL');
  }

  // Minimal DOM/XHR stand-ins prove focus navigation, safe text rendering, launch and error handling without TV APIs.
  const elements = {};
  const document = {
    activeElement: null,
    createElement: () => ({
      children: [],
      style: {},
      get firstChild() {
        return this.children[0];
      },
      set innerHTML(value) {
        this.children = value ? [document.createElement()] : [];
      },
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
      },
      replaceChild(child, old) {
        this.children[this.children.indexOf(old)] = child;
        child.parentNode = this;
      },
      removeChild(child) {
        this.children.splice(this.children.indexOf(child), 1);
      },
      focus() {
        document.activeElement = this;
      },
      click() {
        if (this.onclick) this.onclick();
      },
      scrollIntoView() {},
    }),
    getElementById: id => elements[id] || (elements[id] = document.createElement()),
    addEventListener: (name, fn) => (document[name] = fn),
  };
  const requests = [];
  function XHR() {
    this.open = (method, url) => requests.push({ method, url, xhr: this });
    this.setRequestHeader = () => {};
    this.send = data => {
      requests[requests.length - 1].data = data;
    };
  }
  let closed = 0;
  let nativeBacks = 0;
  const platform = { hide: () => closed++, platformBack: () => nativeBacks++ };
  const timers = [];
  const bridges = [];
  const context = {
    document,
    window: { close: () => closed++, PalmSystem: platform, webOSSystem: platform },
    PalmSystem: platform,
    webOSSystem: platform,
    XMLHttpRequest: XHR,
    setTimeout: fn => timers.push(fn),
    clearTimeout() {},
    setInterval() {},
    PalmServiceBridge: function () {
      this.call = (uri, payload) => bridges.push({ uri, payload: JSON.parse(payload) });
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'webos4/src/home.js'), 'utf8'), context);
  ok(
    requests.length === 1 && requests[0].method === 'GET' && requests[0].url === 'http://127.0.0.1:8765/api/apps',
    'startup reads the real app list from the local helper without downloading software'
  );
  const reply = (q, code, json) => {
    q.xhr.status = code;
    q.xhr.responseText = JSON.stringify(json);
    q.xhr.onload();
  };
  const savedFavs = JSON.stringify(context.favIds);
  const listedApps = Array.from({ length: 13 }, (_, i) => ({ id: 'app.' + i, title: '<Title ' + i + '>' }));
  reply(requests[0], 200, { apps: listedApps });
  ok(
    context.allApps.length === 13 && JSON.stringify(context.favIds) === savedFavs,
    'the real list replaces examples without deleting favourites'
  );
  ok(
    context.appIconMarkup('app.0').indexOf('http://127.0.0.1:8765/icon/app.0') >= 0 &&
      /system-icon/.test(context.appIconMarkup('com.palm.app.settings')) &&
      !/<img/.test(context.appIconMarkup('unknown" onerror="injected')),
    'installed app icons use the local helper; unrecognised ids get a neutral fallback'
  );
  context.describeApp({ title: 'Netflix', desc: 'Series y películas' });
  ok(elements['live-banner-text'].textContent === 'Netflix · Series y películas', 'the focus hint describes the actual selection');
  ok(
    context.appButtons.length === 13 && context.appButtons[0].children[1].textContent.indexOf('<Title') === 0,
    'UI renders app names as text, including markup characters'
  );
  const key = keyCode => document.keydown({ keyCode, preventDefault() {} });
  const allAppsButton = context.dockButtons.filter(button => button._action === 'apps')[0];
  const beforeUp = requests.length;
  allAppsButton.focus();
  key(38);
  ok(
    context.view === 'home' &&
      document.activeElement ===
        context.featuredButtons[Math.min(context.dockButtons.indexOf(allAppsButton), context.featuredButtons.length - 1)] &&
      requests.length === beforeUp,
    'Up from All apps moves to the featured row without opening the library or launching anything'
  );
  context.hideApps();
  allAppsButton.focus();
  key(13);
  ok(
    context.view === 'apps' && document.activeElement === context.appButtons[0],
    'OK on All apps opens the library and focuses its first tile'
  );
  key(40);
  ok(document.activeElement === context.appButtons[6], 'Down moves one row of six library tiles');
  context.loadApps();
  reply(requests[requests.length - 1], 200, { apps: listedApps.concat({ id: 'app.new', title: 'New app' }) });
  ok(
    context.allApps.length === 14 && document.activeElement._app.id === 'app.6' && JSON.stringify(context.favIds) === savedFavs,
    'rereading apps discovers new installations and preserves focus and favourites'
  );
  const lastGoodApps = context.allApps;
  context.loadApps();
  reply(requests[requests.length - 1], 500, { error: 'unavailable' });
  context.loadApps();
  reply(requests[requests.length - 1], 200, { apps: [{ id: '../bad', title: 'Bad' }] });
  context.loadApps();
  requests[requests.length - 1].xhr.ontimeout();
  ok(
    context.allApps === lastGoodApps && !context.loadingApps,
    'failed, invalid and timed-out app reads retain the last good list and allow retry'
  );
  context.loadApps();
  reply(requests[requests.length - 1], 200, { apps: listedApps });
  context.featuredButtons[0].focus();
  context.loadApps();
  reply(requests[requests.length - 1], 200, { apps: listedApps });
  ok(document.activeElement === context.featuredButtons[0], 'a late app-list reply does not move focus away from a featured card');
  context.appButtons[6].focus();
  key(38);
  key(38);
  ok(context.view === 'home' && document.activeElement._action === 'apps', 'Up from the first library row returns to the dock');
  context.showApps();
  key(13);
  ok(
    requests[requests.length - 1].method === 'POST' && JSON.parse(requests[requests.length - 1].data).id,
    'a tile opens only the selected app through POST'
  );
  const beforePing = requests.length;
  context.dockButtons.filter(b => b._action === 'connection')[0].click();
  const ping = requests[requests.length - 1];
  ok(
    requests.length === beforePing + 1 && ping.method === 'GET' && ping.url === 'http://127.0.0.1:8765/api/service' && !ping.data,
    'Connection performs only a local service health GET, never a software update or install'
  );
  reply(ping, 200, { version: '0.2.0', readOnly: false });
  ok(/Conectado/.test(elements.mode.textContent), 'a valid health reply reports the helper connection');
  context.checkConnection();
  requests[requests.length - 1].xhr.onerror();
  ok(
    /Sin conexi/.test(elements.mode.textContent) && !context.checkingConnection,
    'offline health checks explain the failure and allow retry'
  );
  context.checkConnection();
  reply(requests[requests.length - 1], 200, { version: '0.2.0', readOnly: true });
  ok(/solo lectura/.test(elements.mode.textContent), 'the health check distinguishes a read-only helper');
  elements['pill-live'].click();
  while (timers.length) timers.shift()();
  ok(closed === 0, 'the page stays alive while the Live TV request is pending');
  const liveRequest = requests[requests.length - 1];
  liveRequest.xhr.status = 200;
  liveRequest.xhr.responseText = '{"returnValue":false}';
  liveRequest.xhr.onload();
  while (timers.length) timers.shift()();
  ok(closed === 0, 'a rejected Live TV launch keeps the page open');
  liveRequest.xhr.responseText = '{"returnValue":true}';
  liveRequest.xhr.onload();
  while (timers.length) timers.shift()();
  ok(
    closed === 0 && JSON.parse(liveRequest.data).id === 'com.webos.app.livetv',
    'opening a native source never queues a page close that could fire on the next HOME activation'
  );
  liveRequest.xhr.onerror();
  const afterLaunch = requests.length;
  liveRequest.xhr.ontimeout();
  ok(
    bridges.length === 0 && requests.length === afterLaunch && liveRequest.xhr.timeout === 10000,
    'Live TV allows the helper to finish and never duplicates an uncertain launch through a direct bridge'
  );
  context.launchApp('com.webos.app.hdmi1', { deviceId: 'HDMI_1' });
  requests[requests.length - 1].xhr.onerror();
  requests[requests.length - 1].xhr.ontimeout();
  ok(
    bridges.length === 0 && requests.length === afterLaunch + 1 && closed === 0,
    'HDMI failure and timeout do not duplicate activation or queue a page close'
  );
  context.hideApps();
  context.hideInputs();
  platform.launchParams = JSON.stringify({ cytvPreviousAppId: 'com.webos.app.hdmi1' });
  document.webOSLaunch({});
  const beforeBack = requests.length;
  key(461);
  const back = requests[requests.length - 1];
  ok(
    requests.length === beforeBack + 1 &&
      back.method === 'POST' &&
      back.url === 'http://127.0.0.1:8765/api/launch' &&
      JSON.parse(back.data).id === 'com.webos.app.hdmi1' &&
      nativeBacks === 0 &&
      closed === 0,
    'Back returns to the captured source through the isolated helper without LG Home or closing the launcher'
  );
  document.keydown({ keyCode: 461, repeat: true, preventDefault() {} });
  ok(requests.length === beforeBack + 1, 'held Back does not issue repeated source launches');
  back.xhr.ontimeout();
  ok(requests.length === beforeBack + 1 && bridges.length === 0, 'an uncertain Back activation is never retried');
  document.webOSRelaunch({ detail: { cytvPreviousAppId: 'youtube.leanback.v4' } });
  key(461);
  ok(
    JSON.parse(requests[requests.length - 1].data).id === 'youtube.leanback.v4',
    'a relaunch replaces the origin with the most recent app'
  );
  context.showApps();
  const inApps = requests.length;
  key(461);
  ok(context.view === 'home' && requests.length === inApps, 'Back in the app library only dismisses that panel');
  context.showInputs();
  const inInputs = requests.length;
  key(461);
  ok(context.view === 'home' && requests.length === inInputs, 'Back in the input panel only dismisses that panel');
  for (const params of ['bad JSON', {}, { cytvPreviousAppId: '../bad' }, { cytvPreviousAppId: 'com.cleanyourtv.webos4' }]) {
    document.webOSRelaunch({ detail: params });
    const beforeInvalid = requests.length;
    key(461);
    ok(
      requests.length === beforeInvalid && nativeBacks === 0 && context.previousAppId === null,
      'missing, malformed and self-referential origins cannot launch an app or LG Home'
    );
  }
  const css = fs.readFileSync(path.join(root, 'webos4/src/home.css'), 'utf8');
  ok(!/display:\s*grid|\bgap\s*:|:focus-visible|\binset\s*:/.test(css), 'the standalone CSS avoids Grid and modern layout features');
  ok(cp.spawnSync('sh', ['-n', script]).status === 0, 'the manual service script parses');
  const info = JSON.parse(fs.readFileSync(path.join(root, 'webos4/app/appinfo.json'), 'utf8'));
  ok(
    info.type === 'web' &&
      info.visible === true &&
      info.version === prototype.VERSION &&
      fs.existsSync(path.join(root, 'webos4/app', info.icon)),
    'the standalone manifest is web, visible and consistent with its helper'
  );
});
