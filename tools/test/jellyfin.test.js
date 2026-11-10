// The Jellyfin add-on (addons/catalog/jellyfin): the sign-in (only the token is kept, never the password), the Continue watching
// card's data against a stand-in for Jellyfin (Resume, then Next up for series that are not in it, the pictures as data: addresses,
// the older Resume route), its buttons (the app that is installed, the launch parameters with the TMDB id) and the phone page.
// Jellyfin is a local stand-in; no real server or account is used.
const http = require('http');
const path = require('path');
const { root, ok, serve, req, memoryConfig, run } = require('./lib');

const TOKEN = 'TOKEN-SECRET-one',
  PW = 'PASSWORD-SECRET';
const U = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  MOVIE = '11111111111111111111111111111111',
  EP = '22222222222222222222222222222222',
  SER = '33333333333333333333333333333333',
  EP2 = '44444444444444444444444444444444',
  SER2 = '55555555555555555555555555555555',
  EP3 = '66666666666666666666666666666666';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);

function phone(method, p, body, code) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 8798, path: p, method, headers: { 'x-code': code || '' } }, res => {
      const b = [];
      res.on('data', c => b.push(c));
      res.on('end', () => {
        const t = Buffer.concat(b).toString();
        let j = null;
        try {
          j = JSON.parse(t);
        } catch (_) {}
        resolve({ code: res.statusCode, text: t, j });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

run(async () => {
  const said = [];
  // ---- the stand-in for Jellyfin ----
  const seen = { paths: [], auth: [], login: [] };
  let newRoutes = true,
    imageMode = 'ok';
  const resumeItems = [
    {
      Id: MOVIE,
      Type: 'Movie',
      Name: 'Example Film',
      ProductionYear: 2024,
      RunTimeTicks: 60 * 600000000,
      UserData: { PlaybackPositionTicks: 15 * 600000000, PlayedPercentage: 25 },
      ProviderIds: { Tmdb: '603' },
      ImageTags: { Primary: 'p1', Thumb: 't1' },
      BackdropImageTags: ['b1'],
    },
    {
      Id: EP,
      Type: 'Episode',
      Name: 'Pilot',
      SeriesName: 'Example Series',
      SeriesId: SER,
      ParentIndexNumber: 1,
      IndexNumber: 2,
      RunTimeTicks: 40 * 600000000,
      UserData: { PlaybackPositionTicks: 30 * 600000000 },
      ProviderIds: { Tmdb: '999999' },
      ImageTags: { Primary: 'e1' },
      SeriesPrimaryImageTag: 's1',
    },
  ];
  const nextItems = [
    // the same series as the episode in Resume: left out
    {
      Id: EP2,
      Type: 'Episode',
      Name: 'Second',
      SeriesName: 'Example Series',
      SeriesId: SER,
      ParentIndexNumber: 1,
      IndexNumber: 3,
      ImageTags: {},
    },
    {
      Id: EP3,
      Type: 'Episode',
      Name: 'Opening',
      SeriesName: 'Other Series',
      SeriesId: SER2,
      ParentIndexNumber: 2,
      IndexNumber: 1,
      ImageTags: {},
      ParentThumbItemId: SER2,
      ParentThumbImageTag: 'pt',
    },
  ];
  const jf = await serve((rq, rs) => {
    const chunks = [];
    rq.on('data', c => chunks.push(c));
    rq.on('end', () => {
      const p = rq.url.split('?')[0];
      seen.paths.push(rq.url);
      seen.auth.push(rq.headers.authorization || '');
      const json = (o, c) => {
        rs.writeHead(c || 200, { 'content-type': 'application/json' });
        rs.end(JSON.stringify(o));
      };
      if (p === '/Users/AuthenticateByName') {
        const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        seen.login.push(b);
        if (b.Pw !== PW) return json({}, 401);
        return json({ AccessToken: TOKEN, User: { Id: U, Name: 'lars' }, ServerId: 'srv1' });
      }
      if (p === '/System/Info/Public') return json({ ServerName: 'Living room' });
      if (!/Token="TOKEN-SECRET-one"/.test(rq.headers.authorization || '')) return json({}, 401);
      if (p === '/Sessions/Logout') {
        rs.writeHead(204);
        return rs.end();
      }
      if (p === '/UserItems/Resume') return newRoutes ? json({ Items: resumeItems }) : json({}, 404);
      if (p === '/Users/' + U + '/Items/Resume') return json({ Items: resumeItems });
      if (p === '/Shows/NextUp') return json({ Items: nextItems });
      if (p === '/Items') return json({ Items: [{ Id: SER, ProviderIds: { Tmdb: '1399' } }] });
      if (/^\/Items\/[0-9a-f]{32}\/Images\//.test(p)) {
        (seen.accepts = seen.accepts || []).push(rq.headers.accept || '');
        // a server that answers 406 to a request that does not accept images
        if (!/image\//.test(rq.headers.accept || '')) return json({}, 406);
        if (imageMode === 'fail') return json({}, 500);
        rs.writeHead(200, { 'content-type': 'image/jpeg' });
        return rs.end(imageMode === 'big' ? Buffer.alloc(60 * 1024, 7) : JPEG);
      }
      json({}, 404);
    });
  });

  // ---- the add-on with its ctx ----
  const nc = req('netcompat');
  const addonDir = path.join(root, 'addons', 'catalog', 'jellyfin');
  const config = memoryConfig({});
  const settings = {
    get: () => Object.assign({}, ((config.get().addons || {}).jellyfin || {}).settings),
    set: o =>
      config.update('addon:jellyfin', c => {
        c.addons = c.addons || {};
        const old = (c.addons.jellyfin || {}).settings || {};
        c.addons.jellyfin = { settings: Object.assign({}, old, o) };
      }),
  };
  const launched = [];
  let installed = ['org.litefin.app', 'org.jellyfin.webos'];
  const luna = (uri, payload) => {
    if (/getAppInfo$/.test(uri))
      return Promise.resolve(
        installed.indexOf(payload.id) >= 0
          ? { returnValue: true, appInfo: { id: payload.id } }
          : { returnValue: false, errorText: 'not found' }
      );
    if (/launch$/.test(uri)) {
      launched.push(payload);
      return Promise.resolve({ returnValue: true });
    }
    return Promise.resolve({ returnValue: false });
  };
  const M = require(path.join(addonDir, 'service.js'));
  const svc = M.create({
    id: 'jellyfin',
    dir: addonDir,
    dataDir: path.join(process.env.CYTV_DIR, 'addon-data', 'jellyfin'),
    log: m => said.push(m),
    fetch: req('fetch'),
    luna,
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => '', wallpaperSize: () => '4k' },
    settings,
  });

  const man = require(path.join(addonDir, 'addon.json'));
  ok(man.about.length <= 600 && man.cards[0].about.length <= 600, 'the texts of the manager fit (600 characters), so none is cut off');
  const J = require(path.join(addonDir, 'jellyfin.js'));
  ok(
    J.base('jellyfin.local:8096/web/#/home') === 'http://jellyfin.local:8096' &&
      J.base('https://jf.example.org/') === 'https://jf.example.org',
    'an address as typed or copied from the browser becomes the server address'
  );

  // not set up: the card says where to set it up, and no button opens anything
  let f = await svc.cards.feed('continue', {});
  ok(f.connected === false && /Set up from your phone/.test(f.hint), 'without a sign-in the card says where to set it up');

  // ---- the phone page and the sign-in ----
  const s = await svc.settings({});
  ok(s.url === 'http://127.0.0.1:8798' && /^\d{6}$/.test(s.code), 'the phone page opens on port 8798 with a code');
  ok((await phone('GET', '/api/state', undefined, '000000')).code === 403, 'a wrong code is refused');
  const page = await phone('GET', '/');
  ok(/Server address/.test(page.text) && /type=password/.test(page.text), 'the page asks for the address, user name and password');
  let r = await phone('POST', '/api/signin', { url: jf.url + '/web/', user: 'lars', password: 'wrong' }, s.code);
  ok(/refused the user name or password/.test(r.j.error || ''), 'a wrong password is reported');
  r = await phone('POST', '/api/signin', { url: jf.url + '/web/', user: 'lars', password: PW }, s.code);
  ok(
    r.j.connected === true && r.j.user === 'lars' && r.j.server === 'Living room',
    'the sign-in answers who and where: ' + JSON.stringify(r.j)
  );
  const kept = JSON.stringify(config.get());
  ok(kept.indexOf(TOKEN) > 0 && kept.indexOf(PW) < 0, 'the token is kept in the settings, the password is not');
  ok(
    JSON.stringify(r.j).indexOf(TOKEN) < 0 && JSON.stringify((await phone('GET', '/api/state', undefined, s.code)).j).indexOf(TOKEN) < 0,
    'the phone page never gets the token'
  );
  ok(
    /^MediaBrowser Client="CleanYourTV", Device="LG TV", DeviceId="[0-9a-f]{24}", Version="1.0.0"$/.test(seen.auth[0]),
    'the sign-in names the client and the TV, with a device id of its own'
  );

  // ---- the card ----
  seen.paths.length = 0;
  f = await svc.cards.feed('continue', {});
  ok(
    f.connected === true && f.style === 'wide' && f.items.length === 3,
    'the row has what you were watching and the next episode of another series: ' + JSON.stringify(f).slice(0, 200)
  );
  ok(
    f.items[0].title === 'Example Film' && f.items[0].sub === '2024' && f.items[0].pct === 25 && f.items[0].left === '45 min left',
    'a film: its title, year, how far you got and how long is left'
  );
  ok(
    f.items[1].title === 'Example Series' && f.items[1].sub === 'S01E02 · Pilot' && f.items[1].left === '10 min left',
    'an episode: the series, the episode and what is left'
  );
  ok(
    f.items[2].title === 'Other Series' && f.items[2].left === 'Next episode' && !f.items[2].pct,
    'the next episode of a series you follow, without a bar'
  );
  ok(
    f.items.every(i => /^data:image\/jpeg;base64,/.test(i.pic)),
    'every picture is a data: address (the frame has no network)'
  );
  ok(
    seen.paths.some(p => /^\/Items\/1{32}\/Images\/Thumb\?fillWidth=384&fillHeight=216/.test(p)),
    'a film shows its wide Thumb, made small by the server'
  );
  ok(
    seen.paths.some(p => /^\/Items\/5{32}\/Images\/Thumb\?/.test(p)),
    "an episode without a still shows its series' Thumb"
  );
  ok(JSON.stringify(f).indexOf(TOKEN) < 0 && JSON.stringify(f).length < 128 * 1024, 'the answer has no token and fits the feed');
  const asked = seen.paths.length;
  await svc.cards.feed('continue', {});
  ok(seen.paths.length === asked * 2 - 3, 'the pictures are not asked again while their tags stay: ' + seen.paths.slice(asked).join(' '));
  f = await svc.cards.feed('continue', { style: 'poster', nextup: 'off' });
  ok(f.style === 'poster' && f.items.length === 2, 'posters, and only what you started');
  ok(
    seen.paths.some(p => /^\/Items\/3{32}\/Images\/Primary\?fillWidth=200&fillHeight=300/.test(p)),
    "an episode's poster is its series' poster"
  );
  f = await svc.cards.feed('continue', { count: '2' });
  ok(f.items.length === 2, 'the number of titles is an option');

  // ---- pictures that fail: the reason is logged, they are asked for again after a minute, and they are asked for as images ----
  ok(seen.accepts.length > 0 && seen.accepts.every(a => /^image\//.test(a)), 'pictures are asked for as images, not as JSON (a server may answer 406)');
  const retag = tag => {
    resumeItems.forEach(i => {
      Object.keys(i.ImageTags || {}).forEach(k => (i.ImageTags[k] = tag + k));
      if (i.BackdropImageTags) i.BackdropImageTags = [tag + 'b'];
    });
  };
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    imageMode = 'fail';
    retag('f1');
    said.length = 0;
    f = await svc.cards.feed('continue', { nextup: 'off' });
    ok(f.items.length >= 1 && f.items.every(i => i.pic === ''), 'when the server fails, the card still has its titles, without pictures');
    ok(
      said.some(m => /jellyfin: no picture: .*500/.test(m)) && said.join('\n').indexOf(TOKEN) < 0,
      'and the reason is in the log, without the token: ' + said.join(' | ')
    );
    const n = seen.paths.length;
    await svc.cards.feed('continue', { nextup: 'off' });
    ok(seen.paths.length === n + 1, 'a failed picture is not asked for again at once (only the list is)');
    imageMode = 'ok';
    clock += 61000;
    f = await svc.cards.feed('continue', { nextup: 'off' });
    ok(f.items.some(i => /^data:image\/jpeg/.test(i.pic)), 'after a minute it is asked for again and shown');
    imageMode = 'big';
    retag('f2');
    said.length = 0;
    f = await svc.cards.feed('continue', { nextup: 'off' });
    ok(
      f.items.every(i => i.pic === '') && said.some(m => /over the \d+ byte limit/.test(m)),
      'a picture over the limit is left out and the log says why'
    );
    imageMode = 'ok';
    retag('f3');
    clock += 61000;
  } finally {
    Date.now = realNow;
  }

  // ---- the buttons ----
  await svc.cards.feed('continue', {});
  r = await svc.cards.action('continue', {}, 'open1');
  ok(r.ok === true && launched[0].id === 'org.jellyfin.webos', 'OK opens the official Jellyfin app when it is installed');
  ok(
    JSON.stringify(launched[0].params) ===
      JSON.stringify({ itemId: MOVIE, serverId: 'srv1', tmdbId: 603, mediaType: 'movie', title: 'Example Film' }),
    'with the title in the launch parameters: ' + JSON.stringify(launched[0].params)
  );
  r = await svc.cards.action('continue', { app: 'org.litefin.app' }, 'open2');
  ok(
    r.ok &&
      launched[1].id === 'org.litefin.app' &&
      launched[1].params.tmdbId === 1399 &&
      launched[1].params.mediaType === 'tv' &&
      launched[1].params.title === 'Example Series',
    "an episode opens its series by the series' TMDB id (Litefin opens a title by it): " + JSON.stringify(launched[1].params)
  );
  r = await svc.cards.action('continue', { app: 'org.moonfin.webos' }, 'open1');
  ok(/No Jellyfin app/.test(r.error || '') && launched.length === 2, 'an app that is not installed is not opened');
  ok((await svc.cards.action('continue', {}, 'open6')).error === 'Nothing to continue', 'a button without a title opens nothing');
  ok((await svc.cards.action('continue', {}, 'play')).error === 'no such action', 'an unknown action is refused');

  // ---- an older server (before 10.9): Resume under /Users/<id> ----
  newRoutes = false;
  seen.paths.length = 0;
  f = await svc.cards.feed('continue', {});
  ok(
    f.items.length === 3 && seen.paths.some(p => p.indexOf('/Users/' + U + '/Items/Resume?') === 0),
    'an older server is asked by its own Resume route'
  );

  // ---- sign out ----
  r = await phone('POST', '/api/signout', {}, s.code);
  ok(r.j.connected === false && JSON.stringify(config.get()).indexOf(TOKEN) < 0, 'signing out forgets the token');
  ok(seen.paths.indexOf('/Sessions/Logout') >= 0, 'and ends the session on the server');
  f = await svc.cards.feed('continue', {});
  ok(f.connected === false, 'and the card says it is not connected');
  ok(said.join('\n').indexOf(TOKEN) < 0 && said.join('\n').indexOf(PW) < 0, 'nothing secret is logged');

  svc.settings({ stop: true });
  jf.server.close();
});
