// Standalone webOS 4 prototype. Only app discovery and optional manual launching; no feature start() is called.
const VERSION = '0.2.0';
const APP_ID = 'com.cleanyourtv.webos4';
const TV_INPUTS = [
  'com.webos.app.livetv',
  'com.webos.app.hdmi1',
  'com.webos.app.hdmi2',
  'com.webos.app.hdmi3',
  'com.webos.app.externalinput.av1',
  'com.webos.app.externalinput.component',
];
const DEFAULT_INPUT_PARAMS = {
  'com.webos.app.hdmi1': { deviceId: 'HDMI_1' },
  'com.webos.app.hdmi2': { deviceId: 'HDMI_2' },
  'com.webos.app.hdmi3': { deviceId: 'HDMI_3' },
  'com.webos.app.externalinput.av1': { deviceId: 'AV_1' },
  'com.webos.app.externalinput.component': { deviceId: 'COMP_1' },
};

function create(opts) {
  const web = require('./web');
  const apps = require('./apps').create({
    version: VERSION,
    config: require('./config').memory({}),
    // Keep upstream's volume subscription and OSD changes outside this isolated profile.
    audio: {},
    feature: () => null,
    luna: async (uri, payload) => {
      // Match LG's captured activation request; the earlier empty params request preceded loss of TV/HDMI video.
      if (uri === 'luna://com.webos.applicationManager/launch' && payload.id === 'com.webos.app.livetv')
        payload = {
          checkUpdateOnLaunch: false,
          id: payload.id,
          reason: 'recent',
          autoInstallation: false,
          params: { reason: 'recent' },
        };
      // LG switches HDMI with only the app id; let the system manage the other sources.
      else if (uri === 'luna://com.webos.applicationManager/launch' && /^com\.webos\.app\.hdmi[123]$/.test(payload.id))
        payload = { id: payload.id };
      const r = await opts.luna(uri, payload);
      if (/\/listApps$/.test(uri)) {
        if (r.returnValue === false || !Array.isArray(r.apps)) throw new Error('Could not read installed apps');
        return Object.assign({}, r, { apps: r.apps.filter(a => a.id !== APP_ID) });
      }
      return r;
    },
  });
  const feature = {
    name: 'webos4',
    paths: ['/api/version', '/api/service', '/api/apps', '/api/launch'],
    prefix: '/icon/',
    async handle(req, res, u, body) {
      const method = u === '/api/launch' ? 'POST' : 'GET';
      if (req.method !== method) {
        res.setHeader('Allow', method);
        return web.json(res, { error: 'method not allowed' }, 405);
      }
      if (u === '/api/version') return web.json(res, { version: VERSION });
      if (u === '/api/service')
        return web.json(res, { version: VERSION, node: process.version, features: ['apps'], readOnly: !opts.allowLaunch });
      if (u === '/api/launch') {
        if (!opts.allowLaunch) return web.json(res, { error: 'launching is disabled; restart with --allow-launch' }, 403);
        const b = await body(req, 4096);
        if (!b || typeof b.id !== 'string' || !/^[\w.\-]{1,200}$/.test(b.id)) return web.json(res, { error: 'bad id' }, 400);

        // LG's native Settings app is installed but excluded from the visible app list.
        if (b.id !== 'com.palm.app.settings' && TV_INPUTS.indexOf(b.id) < 0 && !(await apps.apps()).some(a => a.id === b.id))
          return web.json(res, { error: 'app not listed' }, 404);
        // Only the selected installed app can be opened; caller-supplied Luna parameters are not forwarded.
        return apps.handle(req, res, u, async () => ({ id: b.id, params: DEFAULT_INPUT_PARAMS[b.id] }));
      }
      return apps.handle(req, res, u, body);
    },
  };
  const server = require('./server').create({
    features: () => [feature],
    appOrigins: /^file:\/\/com\.cleanyourtv\.webos4(?:-webos)?$/,
  });
  server.timeout = 10000;
  return server;
}

if (require.main === module) {
  const fs = require('fs'),
    path = require('path');
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--allow-launch')) {
    console.error('Usage: node helper/webos4.js [--allow-launch]');
    process.exit(1);
  }
  // Set these before loading paths.js, including when the official service's environment was inherited.
  const dir = path.resolve(process.env.CYTV_WEBOS4_DIR || path.join(__dirname, '..', 'webos4', 'state'));
  process.env.CYTV_DIR = dir;
  process.env.CYTV_RUNFILE = path.join(dir, 'run.json');
  process.umask(0o077);
  const server = create({ luna: require('./luna'), allowLaunch: args.indexOf('--allow-launch') >= 0 });
  const pidfile = path.join(dir, 'helper.pid');
  server.on('error', e => {
    console.error('webOS 4 helper: ' + e.message);
    process.exitCode = 1;
  });
  server.listen(8765, '127.0.0.1', () => {
    try {
      require('./netcompat').mkdirp(dir);
      fs.writeFileSync(pidfile, String(process.pid) + '\n', { mode: 0o600 });
      process.on('exit', () => {
        try {
          if (fs.readFileSync(pidfile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidfile);
        } catch (_) {}
      });
      require('./diag').start();
      console.log('CleanYourTV webOS 4 ' + VERSION + ' on 127.0.0.1:8765; PID ' + process.pid);
    } catch (e) {
      console.error('webOS 4 helper: ' + e.message);
      server.close();
      process.exitCode = 1;
    }
  });
}

module.exports = { create, VERSION };
