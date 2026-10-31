// The launcher's own API: the list of apps with their icons, how often each is used, the inputs, launching, and the launcher's
// settings (dock, hidden apps, sort order, clock, top buttons).
//   GET /api/apps  GET /api/inputs  GET /api/foreground  POST /api/launch {id, params}  POST /api/config {...}  GET /icon/<app id>
//   GET /api/inputs: the HDMI ports, plus LG's own Live TV (the tuner) while its app is installed ({appId, tuner: true})
//   POST /api/power/off   switch the TV off completely (the cold-boot power-off, not the standby of the remote)
//   POST /api/inputs/pin {id, on}   pin an input (its input app, e.g. com.webos.app.hdmi2) to Home, or take it off again
// A pinned input is listed with the apps ({id, title, input: <port>, off: <nothing connected>}), so the dock, the grid, the saved
// layout and the order by use treat it as an app; it is kept in config.json (pinnedInputs), apart from the launcher's own keys.
const fs = require('fs'),
  path = require('path');
const P = require('./paths'),
  web = require('./web'),
  exec = require('./exec'),
  cardsShape = require('./cards'),
  { LAUNCHER_KEYS } = require('./config');

const HALF_LIFE = 30 * 24 * 3600 * 1000; // usage counts halve every 30 days
const WALL_SECS = [0, 10, 30, 60, 180, 300, 900, 3600]; // the photo-change intervals Customise > Wallpapers offers
const HOME = 'com.webos.app.home';
// never offered for uninstall: the Homebrew Channel runs the boot scripts (root, CleanYourTV, the update blocking), and the other two keep
// LG's firmware updates away
const KEEP = ['org.webosbrew.hbchannel', 'org.webosbrew.safeupdate', 'org.webosbrew.appupdateblocker'];

function create(ctx) {
  const { config, luna } = ctx;
  const audio = ctx.audio || (ctx.audio = require('./audio').create(ctx));
  if (audio.start) audio.start();

  // ---- the installed apps. The app manager takes a moment to answer (a luna-send each time), and Home is opened often: after the first
  // answer the list is given at once from memory and asked again in the background when it is older than 5 seconds, so an app installed
  // a moment ago shows up on the next opening of Home ----
  let appCache = null,
    appCacheAt = 0,
    asking = null;
  const uninstalledRecently = {};
  function isRemovable(a) {
    if (!a || !a.id || a.id === HOME || /^com\.cleanyourtv\./.test(a.id) || KEEP.indexOf(a.id) >= 0) return false;
    if (a.removable === true) return true;
    if (a.removable === false || a.systemApp === true) return false;
    if (a.folderPath && (a.folderPath.indexOf('/media/developer/apps') === 0 || a.folderPath.indexOf('/var/luna/user/data/apps') === 0))
      return true;
    if (a.folderPath && a.folderPath.indexOf('/usr/palm/applications') === 0) return false;
    return false;
  }
  function askApps() {
    if (!asking)
      asking = luna('luna://com.webos.applicationManager/listApps', {}).then(r => {
        asking = null;
        if (!Array.isArray(r.apps)) return appCache || [];
        appCache = r.apps
          .filter(a => a.visible !== false && a.id !== HOME && !uninstalledRecently[a.id])
          .map(a => {
            const item = { id: a.id, title: a.title, icon: a.largeIcon || a.icon, folder: a.folderPath, type: a.type };
            if (isRemovable(a)) item.removable = true;
            return item;
          });
        appCacheAt = Date.now();
        return appCache;
      });
    return asking;
  }
  async function installed() {
    if (!appCache) return askApps();
    if (Date.now() - appCacheAt > 5000) askApps();
    return (appCache || []).filter(a => !uninstalledRecently[a.id]);
  }

  async function uninstallApp(id) {
    // an app id: letters, digits, dots and dashes, never starting with a dot (a folder name with rm -rf behind it)
    if (
      !id ||
      typeof id !== 'string' ||
      !/^[\w\-][\w.\-]*$/.test(id) ||
      /^com\.cleanyourtv\./.test(id) ||
      id === HOME ||
      KEEP.indexOf(id) >= 0
    ) {
      return { returnValue: false, error: 'refused' };
    }
    const all = await installed();
    const a = all.find(x => x.id === id);
    if (!a || !a.removable) {
      return { returnValue: false, error: 'app not removable' };
    }

    try {
      await luna('luna://com.webos.applicationManager/closeByAppId', { id });
    } catch (_) {}

    const isDev = a.folder && (a.folder.indexOf('/media/developer/apps') === 0 || a.folder.indexOf('/var/luna/user/data/apps') === 0);

    let r = await luna(isDev ? 'luna://com.webos.appInstallService/dev/remove' : 'luna://com.webos.appInstallService/remove', {
      id,
      subscribe: false,
    });
    if (!r || r.returnValue !== true) {
      r = await luna(isDev ? 'luna://com.webos.appInstallService/remove' : 'luna://com.webos.appInstallService/dev/remove', {
        id,
        subscribe: false,
      });
    }

    // a failed removal changes nothing: the app stays on Home, in the dock and in the hidden list, and its files stay
    if (!r || r.returnValue !== true) return { returnValue: false, error: (r && (r.errorText || r.error)) || 'could not uninstall' };

    if (isDev && a.folder && a.folder.indexOf('/media/developer/apps') === 0) {
      try {
        const pkgDir = path.join('/media/developer/apps/usr/palm/packages', id);
        const appDir = path.join('/media/developer/apps/usr/palm/applications', id);
        if (fs.existsSync(pkgDir)) exec.execFile('rm', ['-rf', pkgDir], {}, () => {});
        if (fs.existsSync(appDir)) exec.execFile('rm', ['-rf', appDir], {}, () => {});
      } catch (_) {}
    }

    config.update('launcher', c => {
      if (Array.isArray(c.dock) && c.dock.indexOf(id) >= 0) {
        c.dock = c.dock.filter(x => x !== id);
      }
      if (Array.isArray(c.hidden) && c.hidden.indexOf(id) >= 0) {
        c.hidden = c.hidden.filter(x => x !== id);
      }
    });

    uninstalledRecently[id] = Date.now();
    const now = Date.now();
    for (const k in uninstalledRecently) {
      if (now - uninstalledRecently[k] > 60000) delete uninstalledRecently[k];
    }
    if (Array.isArray(appCache)) {
      appCache = appCache.filter(x => x.id !== id);
    }
    appCacheAt = Date.now();
    return { returnValue: true, id };
  }

  // ---- the inputs, read like the apps: the last answer at once, asked again in the background when older than 5 seconds ----
  let inputCache = null,
    inputCacheAt = 0,
    askingInputs = null;
  function askInputs() {
    if (!askingInputs)
      askingInputs = luna('luna://com.webos.service.eim/getAllInputStatus', {}).then(r => {
        askingInputs = null;
        if (Array.isArray(r.devices)) {
          inputCache = r;
          inputCacheAt = Date.now();
        }
        return r;
      });
    return askingInputs;
  }
  function knownInputs() {
    if (!inputCache || Date.now() - inputCacheAt > 5000) askInputs();
    return (inputCache && inputCache.devices) || [];
  }
  const portLabel = d => 'HDMI ' + d.port;
  // ---- LG's own Live TV (the tuner). It is the TV's antenna and cable input, but the TV does not report it with the inputs of
  // getAllInputStatus (issue 69): it is listed here while its app is installed, so the Inputs list and the picker can show it. The app is
  // asked once and the answer kept for five minutes; a TV without that app (no tuner) lists nothing extra ----
  const TUNER = 'com.webos.app.livetv',
    TUNER_MS = 5 * 60 * 1000; // how long its answer is kept: a TV does not gain or lose its tuner every minute
  let tunerOn = null,
    tunerAt = 0,
    askingTuner = null,
    foreground = '';
  // getAppInfo puts the app's fields in appInfo on webOS 22 and newer ({appId, appInfo: {title, ...}}) and at the top on older ones;
  // a refusal (or a stand-in that answers nothing) carries neither, and then this TV has no tuner
  function tunerInReply(r) {
    if (!r || r.returnValue === false) return false;
    const info = r.appInfo || {};
    return !!(r.id || r.title || info.id || info.title || r.appId);
  }
  function askTuner() {
    if (tunerOn !== null && Date.now() - tunerAt < TUNER_MS) return Promise.resolve(tunerOn);
    if (!askingTuner)
      askingTuner = luna('luna://com.webos.applicationManager/getAppInfo', { id: TUNER }).then(
        r => {
          askingTuner = null;
          tunerOn = tunerInReply(r);
          tunerAt = Date.now();
          return tunerOn;
        },
        () => {
          askingTuner = null;
          return false;
        }
      );
    return askingTuner;
  }
  // the inputs the pages get: the HDMI ports, and LG's Live TV while its app is there (some firmware lists it itself: not twice)
  // The manager's "Show LG's own Live TV" (options.tuner, on by default) switches the tuner off everywhere: the list leaves it out, also
  // where the firmware reports it itself, and the launcher gets no TV button.
  const tunerShown = () => config.options().tuner !== false;
  async function inputsWithTuner() {
    const r = await askInputs(),
      list = (r && r.devices) || [];
    if (!tunerShown())
      return r && Array.isArray(r.devices) ? Object.assign({}, r, { devices: list.filter(d => !d || d.appId !== TUNER) }) : r;
    if (!(await askTuner()) || list.some(d => d && d.appId === TUNER)) return r;
    const tuner = { id: 'TV', appId: TUNER, tuner: true };
    if (foreground === TUNER) tuner.activate = true;
    return Object.assign({}, r, { devices: list.concat([tuner]) });
  }
  // the inputs pinned to Home, with the name and state the TV reports now (or what was saved when it was pinned)
  function pinned() {
    const now = {};
    for (const d of knownInputs()) if (d.appId) now[d.appId] = d;
    return (config.get().pinnedInputs || [])
      .filter(p => p && typeof p.id === 'string')
      .map(p => {
        const d = now[p.id];
        const label = (d && d.label) || p.label || 'HDMI ' + p.port;
        return { id: p.id, title: label, input: (d && d.port) || p.port || 0, off: d ? !d.hdmiPlugIn : false };
      });
  }
  async function apps() {
    return (await installed()).concat(pinned());
  }
  async function pin(b) {
    const id = String(b.id || '');
    const r = await askInputs();
    const d = (r.devices || (inputCache && inputCache.devices) || []).find(x => x.appId === id);
    if (b.on !== false && !d) return { returnValue: false, error: 'not an input of this TV' };
    config.update('launcher', c => {
      const list = (c.pinnedInputs || []).filter(p => p && p.id !== id);
      if (b.on !== false) list.push({ id, label: d.label && d.label !== portLabel(d) ? d.label : '', port: d.port });
      c.pinnedInputs = list.slice(0, 20);
      if (b.on === false && Array.isArray(c.dock)) c.dock = c.dock.filter(i => i !== id); // taken off Home: off the dock too
    });
    return { returnValue: true, pinned: b.on !== false };
  }

  // ---- usage: which apps get used (foreground changes), with a 30-day half-life ----
  let usage = {};
  try {
    usage = JSON.parse(fs.readFileSync(P.USAGE, 'utf8'));
  } catch (_) {}
  const decayed = (u, now) => u.s * Math.pow(0.5, (now - u.t) / HALF_LIFE);
  function usageScores() {
    const now = Date.now(),
      out = {};
    for (const id in usage) out[id] = Math.round(decayed(usage[id], now) * 1000) / 1000;
    return out;
  }
  let saveTimer = null;
  function bump(id) {
    const now = Date.now(),
      u = usage[id];
    usage[id] = { s: (u ? decayed(u, now) : 0) + 1, t: now };
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.writeFileSync(P.USAGE + '.tmp', JSON.stringify(usage));
        fs.renameSync(P.USAGE + '.tmp', P.USAGE);
      } catch (_) {}
    }, 15000);
  }
  // an app counts as used once it stayed in the foreground for two polls in a row; going back to Home arms it again
  let cand = null,
    streak = 0,
    counted = null;
  async function onForeground(id) {
    if (id) foreground = id; // the tuner is shown as the active input while LG's Live TV is the app in front
    if (id === HOME) {
      counted = null;
      cand = id;
      streak = 1;
      return;
    }
    if (!id) return;
    if (id === cand) streak++;
    else {
      cand = id;
      streak = 1;
    }
    if (streak >= 2 && id !== counted) {
      counted = id;
      if ((await apps()).some(a => a.id === id)) bump(id);
    }
  }
  // poll every few seconds: a subscription's output is block-buffered by luna-send, so it would arrive late
  function pollForeground() {
    exec.execFile(
      'luna-send',
      ['-n', '1', '-w', '3000', '-f', 'luna://com.webos.applicationManager/getForegroundAppInfo', '{}'],
      { timeout: 6000 },
      (e, out) => {
        try {
          const o = JSON.parse(out);
          if (o.returnValue !== false) onForeground(o.appId || '');
        } catch (_) {}
      }
    );
  }

  // ---- the launcher's settings: only its own keys are replaced; options, keys, theme and the rest stay as they are ----
  function saveLauncherConfig(b) {
    const strs = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 200) : undefined);
    const out = {};
    if (strs(b.dock)) out.dock = strs(b.dock).slice(0, 8);
    if (strs(b.hidden)) out.hidden = strs(b.hidden);
    if (b.sort === 'usage' || b.sort === 'alpha' || b.sort === 'custom') out.sort = b.sort;
    if (strs(b.order)) out.order = strs(b.order);
    if (['auto', '24', '12'].includes(b.clock)) out.clock = b.clock;
    if (b.runDots === true) out.runDots = true; // the green dot on open apps (off unless switched on)
    if (b.shelfShow === false) out.shelfShow = false; // app name hidden (shown by default, saved only when hidden)
    // Wallpapers in the launcher: on or off, and how often the photo changes
    if (b.wall && typeof b.wall === 'object') {
      // secs: how often the photo changes while Home is shown, in seconds (0: each time Home opens); "every" (minutes) came before it
      const secs = typeof b.wall.secs === 'number' ? b.wall.secs : typeof b.wall.every === 'number' ? b.wall.every * 60 : 900;
      out.wall = { on: b.wall.on === true, secs: WALL_SECS.indexOf(secs) >= 0 ? secs : 900 };
    }
    // the cards in the theme's slots (Customise > Cards), checked for shape only (cards.js)
    const cards = cardsShape.sanitize(b.cards);
    if (cards) out.cards = cards;
    if (Array.isArray(b.topbar))
      out.topbar = b.topbar
        .slice(0, 12)
        .filter(o => o && typeof o.label === 'string')
        .map(o => {
          const t = { label: o.label.slice(0, 40), icon: String(o.icon || 'grid').slice(0, 20) };
          if (typeof o.action === 'string') t.action = o.action;
          if (typeof o.app === 'string') t.app = o.app;
          if (o.params && typeof o.params === 'object') t.params = o.params;
          return t;
        });
    config.update('launcher', c => {
      for (const k of LAUNCHER_KEYS) delete c[k];
      return Object.assign(c, out);
    });
  }

  // what the launcher gets: its settings and the resolved theme, not the secrets (voice, notification token)
  function launcherConfig() {
    const c = config.get();
    delete c.voice;
    delete c.notifyApi;
    delete c.theme;
    delete c.wallpapers; // holds the Immich key; the launcher gets only a stamp that changes with the set of photos
    delete c.androidBox; // the box's address stays with the service
    const theme = ctx.feature('theme'),
      wp = ctx.feature('wallpapers');
    if (wp) c.wallpapers = { stamp: wp.stamp() };
    return theme ? Object.assign(c, { theme: theme.resolved() }) : c;
  }

  async function handle(req, res, u, body) {
    if (u === '/api/apps') {
      const reply = { apps: await apps(), config: launcherConfig(), usage: usageScores(), version: ctx.version };
      // the launcher offers its TV button only where LG's Live TV is installed (a TV without a tuner has no such app)
      if (tunerShown() && (await askTuner())) reply.tuner = true;
      return web.json(res, reply);
    }
    if (u === '/api/inputs') return web.json(res, await inputsWithTuner());
    if (u === '/api/inputs/pin' && req.method === 'POST') return web.json(res, await pin(await body(req)));
    if (u === '/api/foreground') return web.json(res, await luna('luna://com.webos.applicationManager/getForegroundAppInfo', {}));
    if (u === '/api/launch' && req.method === 'POST') {
      const b = await body(req);
      if (!/^[\w.\-]+$/.test(b.id || '')) return web.json(res, { error: 'bad id' }, 400);
      // an app set up to open on an Android box (androidbox.js) switches the input instead of opening on the TV
      const box = ctx.feature && ctx.feature('androidbox');
      const moved = box && box.handles(b.id) ? await box.open(b.id) : null;
      if (moved) return web.json(res, moved);
      return web.json(res, await luna('luna://com.webos.applicationManager/launch', { id: b.id, params: b.params || {} }));
    }
    // a full power-off (tvpower/power/shutDown, issue 50): not the standby of the remote's power key, which keeps Quick Start+ and draws power.
    // Wake-on-LAN no longer wakes the TV afterwards and the next start is a cold boot. The reply comes before the TV goes down.
    if (u === '/api/power/off' && req.method === 'POST') {
      luna('luna://com.webos.service.tvpower/power/shutDown', { reason: 'remoteKey' }).catch(() => {});
      return web.json(res, { returnValue: true });
    }
    if (u === '/api/config' && req.method === 'POST') {
      saveLauncherConfig(await body(req));
      return web.json(res, { returnValue: true });
    }
    if (u === '/api/apps/uninstall' && req.method === 'POST') {
      const b = await body(req);
      const out = await uninstallApp(b && b.id);
      return web.json(res, out, out.returnValue ? 200 : 400);
    }
    if (u === '/api/audio/volume') return audio.handle(req, res, u);
    const m = u.match(/^\/icon\/([\w.\-]+)$/);
    if (m) {
      const a = (await apps()).find(x => x.id === m[1]);
      const f = a && a.icon && path.join(a.folder, a.icon);
      if (!f || !path.resolve(f).startsWith(path.resolve(a.folder)) || !fs.existsSync(f)) return web.notFound(res);
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
      return fs.createReadStream(f).pipe(res);
    }
    web.notFound(res);
  }

  return {
    name: 'apps',
    paths: [
      '/api/apps',
      '/api/inputs',
      '/api/inputs/pin',
      '/api/foreground',
      '/api/launch',
      '/api/config',
      '/api/apps/uninstall',
      '/api/power/off',
      '/api/audio/volume',
    ],
    prefix: '/icon/',
    handle,
    start: () => setInterval(pollForeground, 4000),
    apps,
    onForeground, // which app is in front: it marks the tuner as the active input
  };
}

module.exports = { create };
