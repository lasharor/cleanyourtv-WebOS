'use strict';
const http = require('http'),
  cp = require('child_process'),
  fs = require('fs'),
  path = require('path');
const { root, ok, run, memoryConfig } = require('./lib');
const trial = require('../../helper/webos4-original');
function ask(server, route, method, value, origin) {
  return new Promise((resolve, reject) => {
    const payload = value === undefined ? '' : JSON.stringify(value);
    const q = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: route,
        method: method || 'GET',
        headers: { 'content-length': Buffer.byteLength(payload), origin: origin || 'file://com.cleanyourtv.webos4.original' },
      },
      r => {
        let text = '';
        r.on('data', c => (text += c));
        r.on('end', () => resolve({ code: r.statusCode, data: text ? JSON.parse(text) : null }));
      }
    );
    q.on('error', reject);
    q.end(payload);
  });
}
run(async () => {
  const backup = cp.spawnSync('python3', [path.join(root, 'tools/test/webos4original_test.py')], { encoding: 'utf8' });
  ok(
    backup.status === 0,
    'backup and runtime-source checks reject altered/unsafe archives and existing destinations: ' + (backup.stderr || '')
  );
  const calls = [],
    launches = [];
  let uncertain = false;
  const server = trial.create({
    config: memoryConfig({}),
    modules: ['apps', 'running'],
    luna: async (uri, body) => {
      calls.push({ uri, body });
      return /listApps$/.test(uri)
        ? {
            apps: [
              { id: 'app.one', title: 'One', removable: true },
              { id: 'com.cleanyourtv.webos4.original', title: 'Trial' },
              { id: 'com.cleanyourtv.webos4', title: 'Stable' },
            ],
          }
        : { returnValue: true, running: [], devices: [] };
    },
    launch: async id => {
      launches.push(id);
      if (uncertain) throw Error('uncertain');
      return { returnValue: true };
    },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    ok(calls.length === 0, 'original trial does not start background features or query TV during construction');
    const list = await ask(server, '/api/apps');
    ok(
      list.code === 200 && list.data.apps.length === 1 && list.data.apps[0].id === 'app.one' && !list.data.apps[0].removable,
      'upstream catalogue excludes trial and stable launcher'
    );
    const opened = await ask(server, '/api/launch', 'POST', { id: 'com.webos.app.livetv', params: { injected: true } });
    ok(
      opened.code === 200 && launches.join() === 'com.webos.app.livetv' && !calls.some(x => /launch|closeByAppId/.test(x.uri)),
      'one native launch is delegated to the stable helper with id only and no direct Luna mutation'
    );
    uncertain = true;
    const failed = await ask(server, '/api/launch', 'POST', { id: 'com.webos.app.hdmi1' });
    ok(failed.code === 500 && launches.length === 2, 'uncertain launch fails once with no retry or direct fallback');
    for (const route of [
      '/api/apps/uninstall',
      '/api/running/close',
      '/api/manager/check',
      '/api/manager/update-service',
      '/api/power/off',
      '/api/audio/volume',
    ]) {
      const before = calls.length;
      const result = await ask(server, route, 'POST', { id: 'com.webos.app.hdmi1' });
      ok(result.code === 403 && calls.length === before, 'unavailable destructive/update operation: ' + route);
    }
    ok(
      (await ask(server, '/api/service', 'GET', undefined, 'https://example.invalid')).code === 403,
      'web origins cannot use the trial API'
    );
    ok((await ask(server, '/api/launch', 'POST', { id: '../bad' })).code === 400, 'invalid launch target never reaches stable helper');
    const saved = await ask(server, '/api/config', 'POST', { clock: '24' });
    ok(
      saved.code === 200 && (await ask(server, '/api/apps')).data.config.clock === '24',
      'upstream Customise changes only the supplied trial configuration'
    );
  } finally {
    await new Promise(r => server.close(r));
  }
  const count = calls.length;
  trial.create({
    config: memoryConfig({}),
    luna: async () => {
      throw Error('Unexpected startup query');
    },
  });
  ok(
    calls.length === count &&
      !Object.keys(require.cache).some(file => /helper[\\/](manager|updates|selfupdate|inputkey|voice|audio)\.js$/.test(file)),
    'all six original feature modules load without the updater, input hooks, audio subscription or background activation'
  );
  const nativeCalls = [];
  const bridge = await trial.startNativeBridge(async (uri, body) => {
    nativeCalls.push({ uri, body });
    return { returnValue: true };
  }, 0);
  try {
    await ask(bridge, '/api/launch', 'POST', { id: 'com.webos.app.livetv', params: { injected: true } }, 'file://com.cleanyourtv.webos4');
    await ask(bridge, '/api/launch', 'POST', { id: 'com.webos.app.hdmi1', params: { injected: true } }, 'file://com.cleanyourtv.webos4');
    ok(
      nativeCalls.length === 2 &&
        JSON.stringify(nativeCalls[0].body) ===
          JSON.stringify({
            checkUpdateOnLaunch: false,
            id: 'com.webos.app.livetv',
            reason: 'recent',
            autoInstallation: false,
            params: { reason: 'recent' },
          }) &&
        JSON.stringify(nativeCalls[1].body) === JSON.stringify({ id: 'com.webos.app.hdmi1' }),
      'fresh-install bridge preserves the captured Live TV and id-only HDMI payloads exactly once'
    );
    let refused = false;
    try {
      await trial.startNativeBridge(async () => {
        throw Error('Must not launch');
      }, bridge.address().port);
    } catch (error) {
      refused = error.code === 'EADDRINUSE';
    }
    ok(
      refused && (await ask(bridge, '/api/service', 'GET', undefined, 'file://com.cleanyourtv.webos4')).code === 200,
      'occupied bridge port is refused without disturbing its owner'
    );
  } finally {
    await new Promise(resolve => bridge.close(resolve));
  }
  ok(!bridge.listening, 'closing the trial-owned bridge releases its listener');
  const source = require('../build-pages').build('app/src');
  const page = require('../build-webos4-original').page(source);
  ok(
    page.indexOf("var API = 'http://127.0.0.1:8764'") >= 0 && /x.timeout=10000/.test(page),
    'upstream page uses separate port and a single bounded launch request'
  );
  ok(
    page.indexOf('flex-wrap:wrap') >= 0 && page.indexOf('trialLaunchBusy') >= 0,
    'Chromium 53 gets margin-based flex tiles and overlapping launches are suppressed'
  );
  ok(
    !/window\.close\(|PalmServiceBridge|PalmSystem\.hide/.test(page),
    'original trial never queues window cleanup or a direct launch bridge'
  );
  ok(
    fs.existsSync(path.join(root, 'app/src/js/menus.js')) && page.indexOf('function runningMenu') >= 0,
    'upstream menus are retained in the trial page'
  );
  ok(
    page.indexOf('list.map(function(a){return {label:a.title,dim:true};})') >= 0,
    'unsupported close actions are removed from the original running-app menu'
  );
});
