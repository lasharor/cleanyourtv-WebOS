// The Running apps menu's service side (running.js, issue 16): what is listed, what can be closed, and how.
const fs = require('fs'),
  path = require('path');
const { ok, call, req, run, tmp } = require('./lib');
const running = req('running');

run(async () => {
  const apps = [
    { id: 'netflix', title: 'Netflix' },
    { id: 'youtube.leanback.v4', title: 'YouTube' },
    { id: 'com.webos.app.hdmi1', title: 'HDMI 1' },
  ];
  const listed = running.pick(
    [
      { id: 'netflix' },
      { appId: 'youtube.leanback.v4' },
      { id: 'netflix' },
      { id: 'com.webos.app.home' },
      { id: 'com.cleanyourtv.picker' },
      { id: 'airplay' },
      null,
    ],
    apps
  );
  ok(listed.map(a => a.id).join() === 'netflix,youtube.leanback.v4', 'running apps the launcher knows, once each (by id or appId)');
  ok(
    !listed.some(a => a.id === 'com.webos.app.home' || /cleanyourtv/.test(a.id)) && !listed.some(a => a.id === 'airplay'),
    'never Home, never our own apps, never apps the launcher does not list'
  );
  ok(listed[1].title === 'YouTube', 'with the title the launcher shows');

  let runningNow = [{ id: 'netflix' }, { id: 'youtube.leanback.v4' }, { id: 'com.cleanyourtv.picker' }],
    calls = [],
    closeByAppIdWorks = true;
  const luna = async (uri, p) => {
    calls.push(uri.split('/').pop() + ' ' + ((p && (p.id || p.appId)) || ''));
    if (/running$/.test(uri)) return { returnValue: true, running: runningNow };
    if (/closeByAppId$/.test(uri)) return { returnValue: closeByAppIdWorks };
    if (/close$/.test(uri)) return { returnValue: true };
    if (/removeRecent$/.test(uri)) return { returnValue: false, errorText: 'no such service' };
    return {};
  };
  const r = running.create({ luna, feature: n => (n === 'apps' ? { apps: async () => apps } : null) });
  let x = await call(r, '/api/running');
  ok(x.j.apps.length === 2 && x.j.apps[0].id === 'netflix', 'GET /api/running lists them');
  x = await call(r, '/api/running/close', 'POST', { id: 'com.cleanyourtv.picker' });
  ok(x.j.returnValue === false && !calls.some(c => /close.* com.cleanyourtv/.test(c)), 'our own picker cannot be closed this way');
  x = await call(r, '/api/running/close', 'POST', { id: 'com.webos.app.home' });
  ok(x.j.returnValue === false, 'Home cannot be closed');
  calls = [];
  x = await call(r, '/api/running/close', 'POST', { id: 'netflix' });
  ok(
    x.j.returnValue === true &&
      x.j.closed.join() === 'netflix' &&
      calls.indexOf('closeByAppId netflix') >= 0 &&
      calls.indexOf('removeRecent netflix') >= 0,
    'one app: closeByAppId, then it leaves the recents'
  );
  ok(
    calls.indexOf('removeRecent netflix') > calls.indexOf('closeByAppId netflix'),
    'a missing recent service does not matter: the app is closed'
  );
  closeByAppIdWorks = false;
  calls = [];
  x = await call(r, '/api/running/close', 'POST', { all: true });
  ok(
    x.j.returnValue === true && x.j.closed.join() === 'netflix,youtube.leanback.v4' && calls.indexOf('close youtube.leanback.v4') >= 0,
    'Close all closes every listed app, with close as the fallback'
  );
  runningNow = [];
  x = await call(r, '/api/running/close', 'POST', { all: true });
  ok(x.j.returnValue === false && /nothing is running/.test(x.j.errorText), 'nothing to close');
  x = await call(r, '/api/running/close', 'POST', { all: 'yes' });
  ok(x.j.returnValue === false, 'only all: true closes everything');

  const mine = running.pick([{ id: 'com.cleanyourtv.manager' }, { id: 'com.cleanyourtv.picker' }, { id: 'com.cleanyourtv.notify' }], apps);
  ok(
    mine.length === 1 && mine[0].id === 'com.cleanyourtv.manager' && mine[0].title === 'CleanYourTV',
    'the manager is listed, the picker and notify apps that stay up are not'
  );

  // background services: an installed app's packageinfo.json names them; one that runs is a process with the service's id as its name
  const pkgs = path.join(tmp, 'running-packages'),
    proc = path.join(tmp, 'running-proc');
  const pkg = (dir, app, svcs) => {
    fs.mkdirSync(path.join(pkgs, dir));
    fs.writeFileSync(path.join(pkgs, dir, 'packageinfo.json'), JSON.stringify({ id: dir, app, services: svcs }));
  };
  const ps = (pid, cmd) => {
    fs.mkdirSync(path.join(proc, pid));
    fs.writeFileSync(path.join(proc, pid, 'cmdline'), cmd);
  };
  fs.mkdirSync(pkgs);
  fs.mkdirSync(proc);
  pkg('io.strem.tv', 'io.strem.tv', ['io.strem.tv.server']);
  pkg('org.webosbrew.hbchannel', 'org.webosbrew.hbchannel', ['org.webosbrew.hbchannel.service']);
  pkg('other.app', 'other.app', ['other.app.service']);
  fs.mkdirSync(path.join(pkgs, 'broken'));
  fs.writeFileSync(path.join(pkgs, 'broken', 'packageinfo.json'), '{');
  ps('101', 'io.strem.tv.server\0');
  ps('102', 'org.webosbrew.hbchannel.service\0');
  ps('103', 'other.app.service\0');
  ps('104', 'node\0/media/developer/cleanyourtv/helper.js\0');
  fs.mkdirSync(path.join(proc, 'self'));
  const killed = [];
  let killWorks = true;
  const bgApps = apps.concat([
    { id: 'io.strem.tv', title: 'Stremio' },
    { id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel' },
  ]);
  const rb = running.create({
    luna,
    packages: [pkgs, path.join(tmp, 'no-such-folder')],
    proc,
    kill: (pid, sig) => {
      if (!killWorks) throw new Error('EPERM');
      killed.push(pid + ' ' + sig);
    },
    feature: n => (n === 'apps' ? { apps: async () => bgApps } : null),
  });
  runningNow = [{ id: 'netflix' }];
  x = await call(rb, '/api/running');
  ok(
    JSON.stringify(x.j.apps) ===
      JSON.stringify([
        { id: 'netflix', title: 'Netflix' },
        { id: 'io.strem.tv.server', title: 'Stremio', background: true },
      ]),
    "a background service of an installed app is listed with its app's title; never the Homebrew Channel's, never one of an app " +
      'the launcher does not list: ' +
      JSON.stringify(x.j.apps)
  );
  x = await call(rb, '/api/running/close', 'POST', { id: 'io.strem.tv.server' });
  ok(x.j.returnValue === true && killed.join() === '101 SIGTERM', 'closing a background service stops its process');
  x = await call(rb, '/api/running/close', 'POST', { id: 'org.webosbrew.hbchannel.service' });
  ok(x.j.returnValue === false && killed.length === 1, "the Homebrew Channel's service cannot be stopped");
  killed.length = 0;
  calls = [];
  x = await call(rb, '/api/running/close', 'POST', { all: true });
  ok(
    x.j.returnValue === true && x.j.closed.join() === 'netflix,io.strem.tv.server' && killed.join() === '101 SIGTERM',
    'Close all closes the apps and stops the background services'
  );
  killWorks = false;
  x = await call(rb, '/api/running/close', 'POST', { id: 'io.strem.tv.server' });
  ok(x.j.returnValue === false, 'a service that cannot be stopped is reported');
});
