// Manual original-UI trial: upstream features, separate state/port, no boot hooks or updater.
'use strict';
const VERSION = '1.6.10';
const APP_ID = 'com.cleanyourtv.webos4.original';

function launchThroughStable(id) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ id });
    const q = require('http').request(
      {
        host: '127.0.0.1',
        port: 8765,
        path: '/api/launch',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      },
      r => {
        let out = '';
        r.on('data', c => {
          out += c;
          if (out.length > 65536) q.destroy(new Error('Launch result uncertain'));
        });
        r.on('aborted', () => reject(new Error('Launch result uncertain')));
        r.on('error', reject);
        r.on('end', () => {
          try {
            if (r.statusCode !== 200) throw new Error('Launch result uncertain');
            resolve(JSON.parse(out));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    const timer = setTimeout(() => q.destroy(new Error('Launch result uncertain')), 9500);
    q.on('error', reject);
    q.on('close', () => clearTimeout(timer));
    q.end(data);
  });
}

function startNativeBridge(luna, port) {
  return new Promise((resolve, reject) => {
    const bridge = require('./webos4').create({ luna, allowLaunch: true });
    bridge.once('error', reject);
    bridge.listen(port === undefined ? 8765 : port, '127.0.0.1', () => resolve(bridge));
  });
}

function create(opts) {
  const web = require('./web');
  const loaded = [];
  const ctx = {
    version: VERSION,
    config: opts.config,
    // Keep upstream's volume subscription and OSD changes outside this isolated profile.
    audio: {},
    noStartup: true,
    slug: () => 'lasharor/cleanyourtv-WebOS',
    ref: () => 'main',
    feature: name => loaded.filter(f => f.name === name)[0] || null,
    luna: async (uri, payload) => {
      if (!/\/(listApps|running|getAllInputStatus|getForegroundAppInfo|getAppInfo)$/.test(uri)) throw new Error('Read-only Luna boundary');
      const result = await opts.luna(uri, payload);
      if (/\/listApps$/.test(uri) && Array.isArray(result.apps))
        return Object.assign({}, result, {
          apps: result.apps
            .filter(a => a.id !== APP_ID && a.id !== 'com.cleanyourtv.webos4')
            .map(a => Object.assign({}, a, { removable: false })),
        });
      return result;
    },
  };
  const names = opts.modules || ['theme', 'wallpapers', 'cards', 'live', 'apps', 'running'];
  for (const name of names) loaded.push(require('./' + name).create(ctx));
  const feature = {
    name: 'original-trial',
    prefix: '/',
    async handle(req, res, u, body) {
      const read = ['/api/apps', '/api/inputs', '/api/foreground', '/api/running', '/api/version', '/api/service'];
      const allowed = read.indexOf(u) >= 0 || /^\/(icon\/|api\/(theme|wallpapers|cards|live)\/)/.test(u);
      if (u === '/api/launch') {
        if (req.method !== 'POST') return web.json(res, { error: 'method not allowed' }, 405);
        const b = await body(req, 4096);
        if (!b || typeof b.id !== 'string' || !/^[\w.-]{1,200}$/.test(b.id)) return web.json(res, { error: 'bad id' }, 400);
        // The isolated bridge owns the validated native payload and allowlist. Never retry an uncertain reply.
        return web.json(res, await (opts.launch || launchThroughStable)(b.id));
      }
      if (u === '/api/config' || u === '/api/inputs/pin') {
        if (req.method !== 'POST') return web.json(res, { error: 'method not allowed' }, 405);
      } else if (u === '/api/frontend-ok') {
        return web.json(res, { returnValue: true });
      } else if (u === '/api/log') {
        return web.json(res, { returnValue: true });
      } else if (!allowed) {
        return web.json(res, { error: 'unavailable in original UI trial' }, 403);
      } else if (read.indexOf(u) >= 0 && req.method !== 'GET') {
        return web.json(res, { error: 'method not allowed' }, 405);
      }
      if (u === '/api/version') return web.json(res, { version: VERSION });
      if (u === '/api/service') return web.json(res, { version: VERSION, trial: true, features: names });
      const target = loaded.filter(f => (f.paths && f.paths.indexOf(u) >= 0) || (f.prefix && u.indexOf(f.prefix) === 0))[0];
      if (!target) return web.notFound(res);
      return target.handle(req, res, u, body);
    },
  };
  return require('./server').create({ features: () => [feature], appOrigins: /^file:\/\/com\.cleanyourtv\.webos4\.original(?:-webos)?$/ });
}

if (require.main === module) {
  const path = require('path'),
    fs = require('fs');
  const base = path.resolve(__dirname, '../state');
  process.umask(0o077);
  process.env.CYTV_DIR = base;
  process.env.CYTV_LIVE_DIR = path.join(base, 'live');
  process.env.CYTV_THEMES = path.resolve(__dirname, '../themes');
  process.env.CYTV_RUNFILE = path.join(base, 'run.json');
  require('./netcompat').mkdirp(base);
  const server = create({ config: require('./config').main(), luna: require('./luna') });
  let bridge;
  const stop = () => {
    if (bridge) bridge.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  const fail = error => {
    console.error(error.message);
    if (bridge) bridge.close();
    server.close();
    process.exitCode = 1;
  };
  server.on('error', fail);
  (async () => {
    // Fresh installations host the unchanged native bridge in this process; an existing bridge is never stopped.
    if (process.env.CYTV_WEBOS4_OWN_BRIDGE === '1') {
      bridge = await startNativeBridge(require('./luna'));
      bridge.on('error', fail);
    }
    server.listen(8764, '127.0.0.1', () => {
      fs.writeFileSync(path.join(base, 'helper.pid'), String(process.pid));
      console.log('Original UI trial ready on loopback 8764');
    });
  })().catch(fail);
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
module.exports = { create, launchThroughStable, startNativeBridge };
