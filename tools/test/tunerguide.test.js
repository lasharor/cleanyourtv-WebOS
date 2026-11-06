// The TV guide add-on for LG's tuner (addons/catalog/tuner): its service answers the page it shares with Live TV the same way Live TV's service
// does (status, channels as rows with no stream, the guide as now and next or the next programmes, favourites), and opens a channel by
// launching LG's Live TV with the channel's own id; its page is built from the guide code of Live TV, and it needs nothing else (no
// Live TV add-on, no playlist). The TV is a stand-in in the layout of a real one (see tuner.test.js).
const fs = require('fs'),
  path = require('path');
const { root, ok, fake, req, run, tmp } = require('./lib');

const dir = path.join(root, 'addons', 'catalog', 'tuner');
const NAMES = { channelId: 0, signalChannelId: 2, channelMode: 4, channelNumber: 8, majorNumber: 9, minorNumber: 10, channelName: 11 };
const row = (id, n, name) => {
  const r = new Array(14).fill('');
  r[0] = '3_' + id;
  r[2] = id;
  r[4] = 'Cable';
  r[8] = n;
  r[9] = +n;
  r[10] = 1;
  r[11] = name;
  return r;
};
const stamp = s => {
  const d = new Date(s * 1000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(',');
};
const T = Math.floor(Date.now() / 1000);
const prog = (id, start, mins, name) => ({
  signalChannelId: id,
  startTime: stamp(start),
  endTime: stamp(start + mins * 60),
  programName: name,
  description: 'about ' + name,
  genre: 'News',
});
const SCH = [
  prog('a1', T - 7200, 60, 'Old'),
  prog('a1', T - 600, 30, 'Now show'),
  prog('a1', T + 1200, 30, 'Next show'),
  prog('a1', T + 3000, 30, 'Later show'),
  prog('a1', T + 5000, 30, 'Much later'),
];
const PF = SCH.slice(1, 3);

run(async () => {
  const nc = req('netcompat');
  const dataDir = path.join(tmp, 'tuner-data');
  nc.mkdirp(dataDir);
  const calls = [];
  const luna = async (uri, payload, o) => {
    calls.push({ uri, payload, o });
    if (uri.indexOf('/getChannelList') > 0)
      return { returnValue: true, names: NAMES, values: [row('a1', '1', 'Alpha'), row('b2', '102', 'Beta')] };
    if (uri.indexOf('applicationManager/launch') > 0)
      return payload.params && payload.params.channelId === '3_zz' ? { returnValue: false, errorText: 'no' } : { returnValue: true };
    const q = payload.query;
    let all = q.from.indexOf('programPF') > 0 ? PF : SCH;
    if (q.where) all = all.filter(p => p[q.where[0].prop] === q.where[0].val);
    return { returnValue: true, results: all.slice(0, q.limit) };
  };
  let lang = '';
  const mk = () =>
    require(path.join(dir, 'service.js')).create({
      id: 'tuner',
      dir,
      dataDir,
      log: () => {},
      luna,
      util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
      env: { lang: () => lang, wallpaperSize: () => '4k' },
    });
  let svc = mk();
  const ask = async (p, method, body) => {
    const x = fake('/api/addons/tuner' + p, method);
    await svc.handle(x.req, x.res, p.split('?')[0], async () => body || {});
    return { code: x.res.code, j: x.res.out ? JSON.parse(x.res.out) : null };
  };

  ok(calls.length === 0, 'nothing is read from the TV before the page asks');
  let r = await ask('/status');
  ok(
    r.j.configured === true && r.j.channels === 2 && r.j.error === '',
    'status: always configured (nothing to set up), with the number of channels'
  );
  r = await ask('/channels');
  const c0 = r.j.channels[0];
  ok(
    r.j.groups.join() === 'LG tuner' &&
      r.j.channels.length === 2 &&
      c0[0] === 1 &&
      r.j.channels[1][0] === 2 &&
      r.j.channels[1][13] === '102' &&
      c0[13] === '1' &&
      c0[1] === 'a1' &&
      c0[2] === 'Alpha' &&
      c0[3] === 'LG tuner' &&
      c0[5] === '' &&
      c0[6] === 'a1' &&
      Array.isArray(c0[11]) &&
      c0[12].length === 0,
    'channels as the page reads them: number, id, name, group, no stream, the key for favourites'
  );
  lang = 'nl';
  ok((await ask('/channels')).j.groups.length === 1, 'in another language the group is still one');
  lang = '';
  r = await ask('/epg?ids=a1,b2,zz');
  ok(
    r.j.a1.now[2] === 'Now show' && r.j.a1.next[2] === 'Next show' && !r.j.b2 && !r.j.zz,
    'now and next as the page reads them; a channel with none, and one the TV did not list, have none'
  );
  r = await ask('/epg?full=1&ids=a1');
  ok(
    r.j.a1.list.length === 4 && r.j.a1.list[0][2] === 'Now show' && r.j.a1.list[3][2] === 'Much later',
    'the full guide of a channel: the next programmes, past ones left out'
  );
  calls.length = 0;
  r = await ask('/open', 'POST', { id: 'a1' });
  ok(
    r.j.returnValue === true && calls[0].payload.id === 'com.webos.app.livetv' && calls[0].payload.params.channelId === '3_a1',
    "OK on a channel launches LG's Live TV with the channel's own id"
  );
  ok((await ask('/open', 'POST', { id: 'nope' })).j.error, 'a channel that is not there is not opened');

  // favourites survive a restart
  ok((await ask('/state')).j.fav.length === 0, 'no favourites at first');
  ok(
    (await ask('/state', 'POST', { op: 'fav', key: 'a1', on: true })).j.returnValue === true &&
      (await ask('/state', 'POST', { op: 'fav', key: 'b2', on: true })).j.returnValue === true,
    'a channel is made a favourite'
  );
  ok((await ask('/state')).j.fav.join() === 'b2,a1', 'the newest favourite first');
  ok(
    (await ask('/state', 'POST', { op: 'fav', key: '../x', on: true })).code === 400 &&
      (await ask('/state', 'POST', { op: 'nope', key: 'a1' })).code === 400,
    'a key that is not one, and an op that is not one, are refused'
  );
  svc = mk();
  ok((await ask('/state')).j.fav.join() === 'b2,a1', 'the favourites are kept in the add-on folder');
  await ask('/state', 'POST', { op: 'fav', key: 'b2', on: false });
  ok((await ask('/state')).j.fav.join() === 'a1', 'and removed again');
  ok((await ask('/nothing')).code === 404, 'any other path is a 404');

  // the add-on on its own, and its page
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'addon.json'), 'utf8'));
  const chk = req('addons').check(man, '1.6.17');
  ok(
    chk.manifest &&
      chk.manifest.provides.length === 0 &&
      chk.manifest.entry.page === 'page/index.html' &&
      chk.manifest.tile.placement === 'page',
    'a page add-on of its own: nothing provided, nothing needed from Live TV'
  );
  ok(
    !/iptv|\/api\/live/.test(fs.readFileSync(path.join(dir, 'service.js'), 'utf8').replace(/\/\/.*$/gm, '')),
    'its service has no tie to the Live TV add-on or its API'
  );
  const page = fs.readFileSync(path.join(dir, 'page', 'index.html'), 'utf8');
  const iptv = fs.readFileSync(path.join(root, 'helper', 'addons-bundled', 'iptv', 'page', 'index.html'), 'utf8');
  const guideCode = s => s.slice(s.indexOf('var LIVE = (function'), s.indexOf('/* ---------- the launcher'));
  ok(
    guideCode(page).length > 20000 && guideCode(page) === guideCode(iptv),
    'its page carries the guide code of Live TV as it is (one code, built twice)'
  );
  ok(/<title>TV guide<\/title>/.test(page) && /<title>Live TV<\/title>/.test(iptv), 'and has its own title');
});
