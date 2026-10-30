// Root service of CleanYourTV: the launcher's bridge to the TV (apps, inputs, launching), Live TV, picture notifications, voice,
// themes, the Input key and the manager's API (updates, options). Listens on 127.0.0.1:8765 only.
// This file only wires the parts together. Each part is a feature module with create(ctx) -> { name, paths/prefix, handle, start };
// ctx carries what they share (config, the TV profile, luna). A part that fails to load is left out and reported at /api/service;
// the rest keeps working. AGENTS.md has the map of the files.
const VERSION = '1.6.11';
const fs = require('fs');
const P = require('./paths'),
  diag = require('./diag');
diag.start();
// A promise that fails without a handler ends the process on Node 15 and newer (webOS 22 and later ship Node 16): log it and keep the
// service running; the launcher depends on it.
process.on('unhandledRejection', (/** @type {any} */ e) => console.error('unhandled: ' + ((e && e.stack) || e)));
const luna = require('./luna'),
  web = require('./web'),
  config = require('./config').main(),
  tvprofile = require('./tvprofile');

const PORT = 8765;
const loaded = [],
  failed = {};
const ctx = {
  version: VERSION,
  config,
  luna,
  profile: tvprofile.create({ luna }),
  feature: name => loaded.filter(f => f.name === name)[0] || null,
};
function load(name, make) {
  try {
    const f = make();
    if (f) loaded.push(f);
    return f;
  } catch (e) {
    failed[name] = String(e.message || e);
    console.error(name + ' module failed: ' + ((e && e.stack) || e));
    return null;
  }
}

// the service itself: its version, the TV profile and which parts are running
const core = {
  name: 'core',
  paths: ['/api/version', '/api/tv', '/api/service'],
  handle(req, res, u) {
    if (u === '/api/version') return web.json(res, { version: VERSION });
    if (u === '/api/tv') return web.json(res, ctx.profile.get());
    web.json(res, { version: VERSION, node: process.version, features: loaded.map(f => f.name), failed });
  },
};
loaded.push(core);

// the order matters where one part uses another: voice and the notification port show cards through notify
const notify = load('notify', () => require('./notify').create(ctx));
if (notify) load('voice', () => require('./voice').create(ctx));
load('live', () => require('./live').create(ctx));
load('theme', () => require('./theme').create(ctx));
load('wallpapers', () => require('./wallpapers').create(ctx));
load('icons', () => require('./icons').create(ctx));
load('cards', () => require('./cards').create(ctx));
const inputkey = load('inputkey', () => require('./inputkey').create(ctx));
if (notify) load('notifyapi', () => require('./notifyapi').create(ctx));
const manager = load('manager', () => require('./manager').create(ctx));
load('androidbox', () => require('./androidbox').create(ctx));
load('apps', () => require('./apps').create(ctx));
load('running', () => require('./running').create(ctx));
load('zram', () => require('./zram').create(ctx));

require('./server')
  .create({ features: () => loaded })
  .listen(PORT, '127.0.0.1', () => {
    // the files that hold addresses and keys are for root only
    /** @type {Array<[string, number]>} */
    const secret = [
      [P.LIVE, 0o700],
      [P.CONF, 0o600],
      [P.USAGE, 0o600],
    ];
    for (const [f, mode] of secret) {
      try {
        fs.chmodSync(f, mode);
      } catch (_) {}
    }
    for (const f of loaded) {
      try {
        if (f.start) f.start();
      } catch (e) {
        console.error(f.name + ' failed to start: ' + e.message);
      }
    }
    // what this TV is (webOS version, firmware): the Input key's default follows it
    ctx.profile.refresh().then(() => inputkey && inputkey.syncMode());
    try {
      if (!ctx.audio) ctx.audio = require('./audio').create(ctx);
      ctx.audio.start();
    } catch (e) {
      console.error('audio failed to start: ' + e.message);
    }
    if (manager) setTimeout(() => manager.check(), 60000);
  });
