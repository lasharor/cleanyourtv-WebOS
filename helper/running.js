// The launcher's Running apps menu (Back on Home, issue 16, as suggested and first built by Steefzar): the apps that are open now, to
// close them, as LG's own Home does with its Recents panel on a second Back.
//   GET /api/running                               {apps: [{id, title, background?}]}
//   POST /api/running/close {id} or {all: true}    {returnValue, closed: [ids]}
// Only apps the launcher knows are listed (the apps of listApps), never Home and never CleanYourTV's picker and notify apps, which
// are meant to stay up; the manager is listed. Only listed apps can be closed. Closing also drops the app from LG's recents, as
// LG's panel does.
// Background services of installed apps are listed too ({background: true}), as Stremio's streaming server: the app manager does not
// count them, and they stay up after their app is closed. An app's packageinfo.json names its services, and a service that runs is a
// process with the service's id as its name. Closing one stops that process; its app starts it again when it needs it. The services
// of the Homebrew Channel and of CleanYourTV are never listed.
const fs = require('fs'),
  path = require('path');
const web = require('./web');
const P = require('./paths');

const HOME = 'com.webos.app.home',
  MANAGER = 'com.cleanyourtv.manager',
  OWN = /^com\.cleanyourtv\./,
  KEEP = /^(com\.cleanyourtv\.|org\.webosbrew\.)/,
  AM = 'luna://com.webos.applicationManager/';

const titles = apps => {
  const title = {};
  (apps || []).forEach(a => {
    title[a.id] = a.title || a.id;
  });
  return title;
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const names = dir => {
  try {
    return fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
};

// running: the list of applicationManager/running; apps: the launcher's apps ({id, title})
function pick(running, apps) {
  const title = titles(apps),
    seen = {},
    out = [];
  (running || []).forEach(r => {
    const id = r && (r.id || r.appId);
    if (!id || seen[id] || id === HOME) return;
    if (id === MANAGER) title[id] = 'CleanYourTV';
    else if (OWN.test(id) || !has(title, id)) return;
    seen[id] = true;
    out.push({ id, title: title[id] });
  });
  return out;
}

// the services of installed apps that run now: [{id (the service), app, pid}]; packages and proc are folders (stand-ins in the tests)
function services(packages, proc) {
  const owner = {},
    out = [];
  packages.forEach(d =>
    names(d).forEach(n => {
      let j = null;
      try {
        j = JSON.parse(fs.readFileSync(path.join(d, n, 'packageinfo.json'), 'utf8'));
      } catch (_) {}
      if (j && typeof j.app === 'string' && Array.isArray(j.services))
        j.services.forEach(s => {
          if (typeof s === 'string' && !KEEP.test(s) && !KEEP.test(j.app)) owner[s] = j.app;
        });
    })
  );
  names(proc).forEach(pid => {
    if (!/^\d+$/.test(pid)) return;
    let name = '';
    try {
      name = fs.readFileSync(path.join(proc, pid, 'cmdline'), 'utf8').split('\0')[0];
    } catch (_) {}
    if (has(owner, name) && !out.some(s => s.id === name)) out.push({ id: name, app: owner[name], pid: Number(pid) });
  });
  return out;
}

function create(ctx) {
  const { luna } = ctx;
  const packages = ctx.packages || P.APP_PACKAGES,
    proc = ctx.proc || P.PROC,
    kill = ctx.kill || ((pid, sig) => process.kill(pid, sig));
  const apps = () => {
    const a = ctx.feature('apps');
    return a ? a.apps() : Promise.resolve([]);
  };
  async function list() {
    const r = await luna(AM + 'running', {});
    if (!Array.isArray(r.running)) return { apps: [], error: r.errorText || 'the app manager did not answer' };
    const a = await apps(),
      title = titles(a);
    const bg = services(packages, proc)
      .filter(s => has(title, s.app))
      .map(s => ({ id: s.id, title: title[s.app], background: true }));
    return { apps: pick(r.running, a).concat(bg) };
  }
  // a background service: its process is stopped (looked up again, so a pid that has gone is never signalled)
  function stop(id) {
    const s = services(packages, proc).filter(x => x.id === id)[0];
    if (!s) return false;
    try {
      kill(s.pid, 'SIGTERM');
      return true;
    } catch (_) {
      return false;
    }
  }
  // closeByAppId is the call that works on webOS 6, plain close the fallback (as for the picker in inputkey.js)
  async function close(id) {
    let r = await luna(AM + 'closeByAppId', { id });
    if (r.returnValue !== true) r = await luna(AM + 'close', { id });
    if (r.returnValue !== true) return false;
    await luna('luna://com.webos.service.recent/removeRecent', { appId: id }); // not on every webOS; the app is closed either way
    return true;
  }
  async function handle(req, res, u, body) {
    if (u === '/api/running') return web.json(res, await list());
    if (u === '/api/running/close' && req.method === 'POST') {
      const b = await body(req);
      const listed = (await list()).apps.filter(a => b.all === true || a.id === b.id);
      if (!listed.length) return web.json(res, { returnValue: false, errorText: b.all ? 'nothing is running' : 'not a running app' });
      const closed = [];
      for (const a of listed) if (a.background ? stop(a.id) : await close(a.id)) closed.push(a.id);
      return web.json(res, { returnValue: closed.length === listed.length, closed });
    }
    web.notFound(res);
  }
  return { name: 'running', paths: ['/api/running', '/api/running/close'], handle, list, close };
}

module.exports = { create, pick, services };
