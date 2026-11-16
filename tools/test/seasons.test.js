// Scenes from an add-on (helper/scenes.js) and the Seasons add-on (addons/catalog/seasons): the service hands the launcher the scenes of
// the first add-on that has some and serves their photos; Seasons picks the set by the date and the country, keeps the set in use and
// the first two of every set on the TV (from a stand-in for Unsplash's image host), and deletes what it no longer needs.
const fs = require('fs'),
  path = require('path');
const { root, tmp, ok, call, serve, req, memoryConfig, run } = require('./lib');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);

run(async () => {
  // ---- the stand-in for images.unsplash.com ----
  const asked = [];
  let refuse = false;
  const host = await serve((rq, rs) => {
    asked.push(rq.url);
    if (refuse) {
      rs.writeHead(503);
      return rs.end();
    }
    rs.writeHead(200, { 'content-type': 'image/jpeg' });
    rs.end(JPEG);
  });
  process.env.CYTV_SEASONS_HOST = host.url;

  const dir = path.join(root, 'addons', 'catalog', 'seasons');
  const P = require(path.join(dir, 'photos.js'));
  const on = (m, d, cc) => P.setOf(new Date(2026, m - 1, d), cc || '');
  ok(
    on(12, 5) === 'autumn' &&
      on(12, 6) === 'christmas' &&
      on(12, 27) === 'christmas' &&
      on(12, 28) === 'newyear' &&
      on(1, 2) === 'newyear' &&
      on(1, 3) === 'winter' &&
      on(3, 19) === 'winter' &&
      on(3, 20) === 'spring' &&
      on(6, 21) === 'summer' &&
      on(9, 23) === 'autumn',
    'Christmas from 6 to 27 December, New Year until 2 January, then the seasons'
  );
  ok(
    on(1, 15, 'AUS') === 'summer' && on(7, 1, 'AU') === 'winter' && on(12, 24, 'AUS') === 'christmas' && on(1, 15, 'NLD') === 'winter',
    'south of the equator the seasons turn around, Christmas and New Year stay'
  );
  ok(
    P.photosOf('spring', 'NLD').length === 6 && P.photosOf('spring', 'BE').length === 6 && P.photosOf('spring', 'US').length === 3,
    'the tulip fields only in the Netherlands and Belgium'
  );
  ok(
    Object.keys(P.SETS).every(k => P.SETS[k].slice(0, 2).every(x => !x.cc)) &&
      Object.keys(P.SETS).every(k => P.SETS[k].every(x => /^\d{10,13}-[0-9a-f]{12}$/.test(x.p) && x.by)),
    'every set starts with two photos for every country, and each photo is an Unsplash photo with its photographer'
  );

  // ---- the add-on, on 3 November (autumn) in the Netherlands ----
  const nc = req('netcompat');
  const dataDir = path.join(tmp, 'seasons-data');
  const config = memoryConfig({});
  let today = new Date(2026, 10, 3);
  const settings = {
    get: () => Object.assign({}, ((config.get().addons || {}).seasons || {}).settings),
    set: o =>
      config.update('addon:seasons', c => {
        c.addons = c.addons || {};
        c.addons.seasons = { settings: Object.assign({}, (c.addons.seasons || {}).settings || {}, o) };
      }),
  };
  const S = require(path.join(dir, 'service.js')).create({
    id: 'seasons',
    dir,
    dataDir,
    log: () => {},
    fetch: req('fetch'),
    util: { mkdirp: nc.mkdirp },
    settings,
    now: () => today,
  });
  ok(S.scenes.list({ cc: 'NLD' }).length === 0, 'before the first sync there is nothing to show (the launcher keeps the landscapes)');
  await S.sync();
  const files = () => fs.readdirSync(path.join(dataDir, 'photos')).sort();
  let l = S.scenes.list({ cc: 'NLD' });
  ok(
    l.length === 5 && l[0].id === 'autumn-1' && l[0].credit === 'Federica Galli / Unsplash' && l.every(x => typeof x.darkSky === 'boolean'),
    'the five photos of autumn with their photographer: ' + l.map(x => x.id).join(' ')
  );
  // autumn's five and the five of the autumn evening, and two of each of the other eight sets (spring: the first two, never the tulips)
  ok(
    files().length === (5 + 5 + 8 * 2) * 2,
    'the set in use, the evening of that set and the first two of every set are kept, each with its blurred copy: ' + files().length
  );
  ok(
    asked.some(u => /^\/photo-1508255139162-e1f7b7288ab7\?w=1920&h=1080/.test(u)) &&
      asked.some(u => /^\/photo-1508255139162-e1f7b7288ab7\?w=960&h=540.*blur=/.test(u)),
    'each photo is asked at 1920 x 1080, and blurred for the glass'
  );
  ok(
    S.scenes.file('autumn-1', 'image') === path.join(dataDir, 'photos', 'autumn-1.jpg') &&
      S.scenes.file('autumn-1', 'glass') === path.join(dataDir, 'photos', 'autumn-1-glass.jpg') &&
      S.scenes.file('../x', 'image') === '' &&
      S.scenes.file('summer-4', 'image') === '',
    'the files are handed out by id only, and only what is on the TV'
  );
  const n = asked.length;
  await S.sync();
  ok(asked.length === n, 'a second sync downloads nothing');

  // Christmas: the set changes, the autumn photos beyond the first two are deleted
  today = new Date(2026, 11, 10);
  l = S.scenes.list({ cc: 'NLD' });
  ok(l.length === 2 && l.every(x => /^christmas-[12]$/.test(x.id)), 'on 10 December the two Christmas photos kept all year show at once');
  await S.sync();
  ok(
    S.scenes.list({ cc: 'NLD' }).length === 5 && files().indexOf('autumn-3.jpg') < 0 && files().indexOf('autumn-1.jpg') >= 0,
    'then all five, and only the first two of autumn stay'
  );

  // the evening of a time of year that has its own photos: the launcher says the sun is down, and those take the place of the day's
  today = new Date(2026, 1, 20); // winter
  await S.sync();
  const byDay = S.scenes.list({ cc: 'NLD', day: true }),
    byNight = S.scenes.list({ cc: 'NLD', day: false });
  ok(
    byDay.length === 5 && byDay.every(x => /^winter-\d$/.test(x.id)),
    'in February the photos of winter show while the sun is up: ' + byDay.map(x => x.id).join(' ')
  );
  ok(
    byNight.length === 5 && byNight.every(x => /^winternight-\d$/.test(x.id)) && byNight[0].credit === 'Martin Woortman / Unsplash',
    'and the photos of the evening once it is down: ' + byNight.map(x => x.id).join(' ')
  );
  ok(
    S.scenes.list({ cc: 'NLD' }).length === 5 && S.scenes.list({ cc: 'NLD' })[0].id === 'winter-1',
    'a launcher that says nothing about the hour keeps the photos of the day, as before'
  );
  today = new Date(2026, 9, 20); // autumn, which has its own evening too
  await S.sync();
  ok(
    S.scenes.list({ cc: 'NLD', day: false }).every(x => /^autumnnight-\d$/.test(x.id)) &&
      S.scenes.list({ cc: 'NLD', day: true }).every(x => /^autumn-\d$/.test(x.id)),
    'in October the same, with the photos of the autumn evening'
  );
  today = new Date(2026, 11, 10); // Christmas, which is an evening already and has no second set
  await S.sync();
  ok(
    S.scenes.list({ cc: 'NLD', day: false }).every(x => /^christmas-\d$/.test(x.id)),
    'a time of year without photos of the evening keeps its own, whatever the hour'
  );
  today = new Date(2026, 3, 10); // back to spring for what follows

  // no network: what is kept still shows, and the error is reported
  today = new Date(2026, 3, 10); // spring
  refuse = true;
  await S.sync();
  const st = S.status();
  l = S.scenes.list({ cc: 'NLD' });
  ok(
    l.length === 2 && l.every(x => /^spring-[12]$/.test(x.id)) && /503/.test(st.error) && st.set === 'spring',
    'without network the two spring photos kept on the TV show, and the status says what went wrong'
  );
  refuse = false;
  await S.sync();
  ok(
    S.scenes.list({ cc: 'NLD' }).length === 6 && S.scenes.list({ cc: 'US' }).length === 3,
    'with network again: six in the Netherlands, three in the US'
  );

  // ---- the core: POST /api/scenes and the photos (helper/scenes.js) ----
  const providers = [];
  const scenes = req('scenes').create({ feature: n2 => (n2 === 'addons' ? { providers: w => (w === 'scenes' ? providers : []) } : null) });
  let r = await call(scenes, '/api/scenes', 'POST', { cc: 'nld' });
  ok(r.j && Array.isArray(r.j.scenes) && r.j.scenes.length === 0 && !r.j.addon, 'without an add-on that provides scenes the list is empty');
  providers.push({
    id: 'broken',
    mod: {
      scenes: {
        list: () => {
          throw new Error('boom');
        },
        file: () => '',
      },
    },
  });
  providers.push({ id: 'seasons', mod: S });
  r = await call(scenes, '/api/scenes', 'POST', { cc: 'nld' });
  ok(
    r.j.addon === 'seasons' &&
      r.j.scenes.length === 6 &&
      r.j.scenes[0].id === 'spring-1' &&
      r.j.scenes[0].credit === 'Claudio Testa / Unsplash',
    'the first add-on that has scenes answers (one that throws is skipped), with the country as the launcher read it'
  );
  const web = await serve((q, s2) => scenes.handle(q, s2, q.url.split('?')[0], async () => ({})));
  const get = u =>
    new Promise(res =>
      require('http').get(web.url + u, rs => {
        const b = [];
        rs.on('data', c => b.push(c));
        rs.on('end', () => res({ code: rs.statusCode, type: rs.headers['content-type'], body: Buffer.concat(b) }));
      })
    );
  let g = await get('/api/scenes/photo/seasons/spring-1/glass');
  ok(g.code === 200 && g.type === 'image/jpeg' && g.body.equals(JPEG), 'a photo is served from the add-on, as a JPEG');
  g = await get('/api/scenes/photo/seasons/..%2Fx/image');
  const g2 = await get('/api/scenes/photo/other/spring-1/image');
  ok(g.code === 404 && g2.code === 404, 'an odd id or an add-on that does not provide scenes gets nothing');
  web.server.close();

  // the place of the TV by name (the launcher asks with the city its time zone names), from the same search the weather card uses
  const geoAsked = [];
  const geo = await serve((q, s2) => {
    geoAsked.push(q.url);
    s2.writeHead(200, { 'content-type': 'application/json' });
    s2.end(
      /Amsterdam/i.test(q.url)
        ? JSON.stringify({ results: [{ name: 'Amsterdam', country: 'Netherlands', latitude: 52.37, longitude: 4.89 }] })
        : JSON.stringify({ results: [] })
    );
  });
  process.env.CYTV_GEO_URL = geo.url + '/v1/search';
  // the address of the search is read when weather.js is first loaded, so both are loaded again for this part
  for (const n of ['weather', 'scenes']) delete require.cache[require.resolve(path.join(root, 'helper', n + '.js'))];
  // the lookup leaves the TV, so it is off until the switch in the manager (options.sunPlace) is on, and it is done once
  const cfg2 = require(path.join(root, 'helper', 'config.js')).create('unused', { memory: {}, log() {} });
  const sc2 = require(path.join(root, 'helper', 'scenes.js')).create({ feature: () => null, config: cfg2 });
  const post = q => call(sc2, '/api/scenes/place', 'POST', { q: q });
  let pl = await post('Amsterdam');
  ok(
    pl.code === 200 && pl.j.enabled === false && pl.j.place === null && geoAsked.length === 0,
    'with the switch off nothing is asked and nothing leaves the TV: ' + JSON.stringify(pl.j)
  );
  cfg2.update('test', c => {
    c.options = Object.assign({}, c.options, { sunPlace: true });
  });
  pl = await post('Amsterdam');
  ok(
    pl.code === 200 && pl.j.place && pl.j.place.lat === 52.37 && pl.j.place.lon === 4.89 && pl.j.place.name === 'Amsterdam',
    'switched on, a place by name gives its coordinates: ' + JSON.stringify(pl.j)
  );
  const once = geoAsked.length;
  ok(cfg2.get().scenesPlace && cfg2.get().scenesPlace.lat === 52.37, 'the answer is kept in config.json');
  await post('Rotterdam');
  ok(geoAsked.length === once, 'and it is asked once only: another name, a restart of the service or a reload asks nothing more');
  const sc3 = require(path.join(root, 'helper', 'scenes.js')).create({ feature: () => null, config: cfg2 });
  pl = await call(sc3, '/api/scenes/place', 'POST', { q: 'Amsterdam' });
  ok(pl.j.place && pl.j.place.name === 'Amsterdam' && geoAsked.length === once, 'also after the service started again');
  // the switch goes off: the place is forgotten
  cfg2.update('test', c => {
    c.options.sunPlace = false;
    delete c.scenesPlace;
  });
  pl = await post('Amsterdam');
  ok(pl.j.enabled === false && geoAsked.length === once, 'switched off again, nothing is asked');
  // a name the search does not know is kept too, so it is not searched again and again
  cfg2.update('test', c => {
    c.options.sunPlace = true;
  });
  pl = await post('Nowhereville');
  const afterNone = geoAsked.length;
  ok(
    pl.j.place === null && cfg2.get().scenesPlace && cfg2.get().scenesPlace.none,
    'a name the search does not know gives nothing, so the clock decides'
  );
  await post('Nowhereville');
  ok(geoAsked.length === afterNone, 'and it is not searched again');
  pl = await post('A');
  ok(pl.j.place === null && geoAsked.length === afterNone, 'a name of one letter is not searched at all');
  geo.server.close();
  delete process.env.CYTV_GEO_URL;

  // the manifest is accepted by the loader, with "scenes" among what it provides
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'addon.json'), 'utf8'));
  ok(man.provides.indexOf('scenes') >= 0 && man.about.length <= 600 && man.permissions.join() === 'net.fetch', 'the manifest');
  host.server.close();
});
