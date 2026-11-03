// The Immich add-on (addons/catalog/immich): connecting (a wrong key is reported, the key stays in the service), the sync against a
// stand-in for Immich (only new or changed photos are downloaded, videos and trashed ones are skipped, a photo that left the albums is
// deleted, hidden ones are not shown, a failed sync keeps the cache), the phone page, what Home's wallpapers ask of a source, and the
// hand-over of what an earlier version kept (wallpapers.js adoptLegacy).
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const { root, ok, call, serve, req, memoryConfig, run, sleep } = require('./lib');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

// a request to the add-on's phone page on 127.0.0.1:8795
function phone(method, p, body, code) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 8795, path: p, method, headers: { 'x-code': code || '' } }, res => {
      const b = [];
      res.on('data', c => b.push(c));
      res.on('end', () => {
        const t = Buffer.concat(b).toString();
        let j = null;
        try {
          j = JSON.parse(t);
        } catch (_) {}
        resolve({ code: res.statusCode, j, text: t, type: res.headers['content-type'] });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

run(async () => {
  const nc = req('netcompat');
  const addonDir = path.join(root, 'addons', 'catalog', 'immich');
  const M = require(path.join(addonDir, 'service.js'));
  ok(M.imageType(JPEG) === 'jpg' && M.imageType(Buffer.from('<svg>')) === '', 'pictures are told apart by their first bytes');

  // the ctx the loader gives an add-on: settings in config.json under addons.immich.settings, a data folder, fetch and a few helpers
  const config = memoryConfig({});
  const dataDir = path.join(process.env.CYTV_DIR, 'addon-data', 'immich');
  nc.mkdirp(dataDir);
  let size = '4k';
  const ctx = {
    id: 'immich',
    dir: addonDir,
    dataDir,
    log: () => {},
    fetch: req('fetch'),
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => '', wallpaperSize: () => size },
    settings: {
      get: () => Object.assign({}, ((config.get().addons || {}).immich || {}).settings),
      set: o =>
        config.update('addon:immich', c => {
          c.addons = c.addons || {};
          c.addons.immich = Object.assign({}, c.addons.immich, { settings: Object.assign({}, (c.addons.immich || {}).settings, o) });
        }),
    },
  };
  const im0 = M.create(ctx);
  const W = im0.wallpapers;
  ok(
    W.label === 'Immich' && typeof W.list === 'function' && typeof W.file === 'function' && typeof W.settings === 'function' && !W.live,
    'it is a photo source with files, a status and a settings page'
  );
  ok(W.status().summary === 'not connected · set up from your phone' && W.list().length === 0, 'not connected at first');

  // ---- the phone page ----
  let r = await W.settings({});
  const code = r.code;
  ok(
    /^\d{6}$/.test(code) && /:8795\/#\d{6}$/.test(r.qr) && r.seconds === 900,
    'the settings page opens with a 6-digit code, which the QR code carries'
  );
  await sleep(100);
  let p = await phone('GET', '/');
  ok(
    p.code === 200 && /text\/html/.test(p.type) && /Test connection and save/.test(p.text) && !/Upload photos/.test(p.text),
    'the page is about Immich only'
  );
  p = await phone('GET', '/api/state', undefined, '000000');
  ok(p.code === 403, 'the API needs the code');

  // ---- a stand-in for Immich ----
  const A = (n, extra) =>
    Object.assign(
      {
        id: 'aaaaaaaa-0000-0000-0000-00000000000' + n,
        type: 'IMAGE',
        checksum: 'c' + n,
        fileCreatedAt: '2026-01-0' + n + 'T00:00:00Z',
        originalMimeType: 'image/jpeg',
      },
      extra || {}
    );
  let album = [A(1), A(2), A(3, { type: 'VIDEO' }), A(4, { isTrashed: true }), A(5)];
  let down = 0,
    keyOk = true,
    downAll = false;
  const im = await serve((q, res) => {
    const send = (c, o, raw) => {
      res.writeHead(c, { 'content-type': raw ? 'image/jpeg' : 'application/json' });
      res.end(raw || JSON.stringify(o));
    };
    if (downAll) return send(500, {});
    if (q.headers['x-api-key'] !== 'secret-key-1234' || !keyOk) return send(401, {});
    const u = q.url;
    if (u === '/api/albums') return send(200, [{ id: 'bbbbbbbb-0000-0000-0000-000000000001', albumName: 'Family', assetCount: 5 }]);
    if (u === '/api/albums?shared=true') return send(200, []);
    if (/^\/api\/albums\/bbbbbbbb/.test(u)) return send(200, { assets: album });
    // a newer Immich (2.x, 3.x): the album does not list its photos, they are searched by album, page by page
    if (/^\/api\/albums\/cccccccc/.test(u)) return send(200, { id: 'cccccccc-0000-0000-0000-000000000001', assetCount: 3 });
    if (u === '/api/search/metadata' && q.method === 'POST') {
      let b = '';
      q.on('data', c => (b += c));
      q.on('end', () => {
        const f = JSON.parse(b),
          all = [A(6), A(7), A(8)].filter(() => f.albumIds[0] === 'cccccccc-0000-0000-0000-000000000001');
        const pg = f.page || 1;
        send(200, { assets: { items: all.slice((pg - 1) * 2, pg * 2), nextPage: pg * 2 < all.length ? String(pg + 1) : null } });
      });
      return;
    }
    const m = /^\/api\/assets\/([0-9a-f-]+)\/(thumbnail\?size=(fullsize|preview)|original)$/.exec(u);
    if (m) {
      if (m[3] === 'fullsize' && /1$/.test(m[1])) return send(404, {}); // no full-size image for this one: the original is used
      down++;
      return send(200, null, JPEG);
    }
    send(404, {});
  });
  const album1 = 'bbbbbbbb-0000-0000-0000-000000000001',
    album2 = 'cccccccc-0000-0000-0000-000000000001';
  await phone('POST', '/api/connect', { url: im.url + '/', key: 'wrong' }, code).then(x => {
    ok(/refused the API key/.test(x.j.error || ''), 'a wrong key is reported: ' + (x.j.error || ''));
  });
  p = await phone('POST', '/api/connect', { url: 'ftp://x', key: 'k' }, code);
  ok(/must start with http/.test(p.j.error || ''), 'an address that is not http or https is refused');
  p = await phone('POST', '/api/connect', { url: im.url + '/', key: 'secret-key-1234' }, code);
  ok(p.j.ok === true && p.j.albums[0].name === 'Family', 'the connection test lists the albums');
  const st0 = (await phone('GET', '/api/state', undefined, code)).j;
  ok(
    st0.configured && st0.keyHint === '…1234' && JSON.stringify(st0).indexOf('secret-key') < 0,
    'the page shows the last four characters of the key only'
  );
  ok(
    JSON.stringify(W.status()).indexOf('secret-key') < 0 && JSON.stringify(im0.details()).indexOf('secret-key') < 0,
    'the key is in no status reply'
  );
  p = await phone('POST', '/api/albums', { ids: [album1] }, code);
  await im0.sync();
  let d = im0.details();
  ok(d.photos === 3 && down === 3 && !d.error && d.lastSync > 0, 'the sync downloads the photos (not the video or the trashed one)');
  ok(W.list().length === 3 && W.list().every(id => /^[0-9a-f-]{36}$/.test(id)), 'the source lists them by their Immich id');
  const f1 = W.file(A(1).id);
  ok(
    path.isAbsolute(f1) && fs.existsSync(f1) && /\.jpg$/.test(f1) && f1.indexOf(dataDir) === 0,
    'and gives the file of each, in its own data folder'
  );
  ok(
    W.file('../../etc/passwd') === '' && W.file('aaaaaaaa-0000-0000-0000-000000000099') === '',
    'an id that is not a synced photo gives no file'
  );
  ok(/3 photos · synced/.test(W.status().summary), 'the status line says how many and when');
  await im0.sync();
  ok(down === 3, 'a second sync downloads nothing');
  album[1] = A(2, { checksum: 'changed' });
  await im0.sync();
  ok(down === 4, 'a changed photo is downloaded again');
  await phone('POST', '/api/albums', { ids: [album1, album2] }, code);
  await im0.sync();
  d = im0.details();
  ok(d.photos === 6 && down === 7, 'an album on a newer Immich (photos found by search, in pages) is synced too: ' + d.photos);
  await phone('POST', '/api/albums', { ids: [album1] }, code);
  await im0.sync();
  ok(im0.details().photos === 3, "a deselected album's photos are removed");
  album = [A(1), A(2, { checksum: 'changed' })];
  await im0.sync();
  ok(fs.readdirSync(path.join(dataDir, 'photos')).length === 2, 'a photo that left the album is deleted');
  p = await phone('POST', '/api/hide', { id: A(1).id, hidden: true }, code);
  ok(W.list().length === 1 && W.list().indexOf(A(1).id) < 0 && W.file(A(1).id) === '', 'a hidden Immich photo is not shown');
  p = await phone('GET', '/api/photo/' + A(1).id, undefined, code);
  ok(p.code === 200 && /image\/jpeg/.test(p.type), 'the phone page still shows it, so it can be shown again');
  downAll = true;
  await im0.sync();
  d = im0.details();
  ok(
    d.error && d.photos === 1 && fs.readdirSync(path.join(dataDir, 'photos')).length >= 1,
    'when Immich is down the cache stays: ' + d.error
  );
  downAll = false;
  size = 'hd';
  p = await phone('POST', '/api/disconnect', {}, code);
  d = im0.details();
  ok(
    !d.configured && d.photos === 0 && fs.readdirSync(path.join(dataDir, 'photos')).length === 0,
    'disconnecting forgets the key and deletes the photos'
  );
  ok(((config.get().addons || {}).immich || {}).settings.key === '', 'and the key is gone from the settings');
  await W.settings({ stop: true });
  await sleep(50);
  p = await phone('GET', '/').catch(() => ({ code: 0 }));
  ok(p.code === 0, 'the settings page closes on request');

  // ---- through Home's wallpapers (core): the photos are listed and served as a source's ----
  const wpMod = req('wallpapers');
  await im0.sync().catch(() => {});
  // set up again so there is something to list
  await (async () => {
    ctx.settings.set({ url: im.url, key: 'secret-key-1234', albums: [album1] });
    size = '4k';
    await im0.sync();
  })();
  const core = wpMod.create({
    config: memoryConfig({}),
    feature: n => (n === 'addons' ? { providers: w => (w === 'wallpapers' ? [{ id: 'immich', name: 'Immich', mod: im0 }] : []) } : null),
  });
  r = await call(core, '/api/wallpapers/list');
  ok(
    r.j.photos.length === 2 && r.j.photos.every(x => /^s\/immich\/[0-9a-f-]{36}$/.test(x)),
    'Home gets s/immich/<id> entries: ' + r.j.photos.join()
  );
  r = await call(core, '/api/wallpapers/status');
  ok(
    r.j.sources &&
      r.j.sources[0].id === 'immich' &&
      r.j.sources[0].label === 'Immich' &&
      r.j.sources[0].settings === true &&
      r.j.sources[0].photos === 2,
    'the manager gets a row for it'
  );

  // ---- what an earlier version kept: handed over once ----
  const old = path.join(process.env.CYTV_DIR, 'wallpapers', 'immich');
  nc.mkdirp(old);
  fs.writeFileSync(path.join(old, A(9).id + '.jpg'), JPEG);
  fs.writeFileSync(path.join(old, A(8).id + '.jpg'), JPEG);
  const legacyIdx = {
    upload: [],
    immich: {
      [A(9).id]: { file: A(9).id + '.jpg', bytes: JPEG.length, sum: 'c9', size: '4k' },
      [A(8).id]: { file: A(8).id + '.jpg', bytes: JPEG.length, sum: 'c8', size: '4k' },
      '../bad': { file: '../../x.jpg', bytes: 1 },
    },
    sync: { state: 'idle', at: 0, error: '', ok: 0 },
  };
  fs.writeFileSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'index.json'), JSON.stringify(legacyIdx));
  // a fresh add-on (no settings yet) and a core that finds the old data
  const fresh = Object.assign({}, ctx, { dataDir: path.join(process.env.CYTV_DIR, 'addon-data', 'immich2'), settings: undefined });
  nc.mkdirp(fresh.dataDir);
  const store = { settings: {} };
  fresh.settings = { get: () => Object.assign({}, store.settings), set: o => (store.settings = Object.assign({}, store.settings, o)) };
  const im2 = M.create(fresh);
  const coreCfg = memoryConfig({
    wallpapers: { immich: { url: 'https://photos.example.org', key: 'old-key-5678', albums: [album1, 'not an id'], hidden: [A(8).id] } },
  });
  let have = false;
  const core2 = wpMod.create({
    config: coreCfg,
    feature: n =>
      n === 'addons' ? { providers: w => (w === 'wallpapers' && have ? [{ id: 'immich', name: 'Immich', mod: im2 }] : []) } : null,
  });
  r = await call(core2, '/api/wallpapers/status');
  ok(
    r.j.legacyImmich && r.j.legacyImmich.photos === 3 && r.j.legacyImmich.configured === true && r.j.immich === undefined,
    'without the add-on, the status tells that old Immich data is there'
  );
  r = await call(core2, '/api/wallpapers/list');
  ok(r.j.photos.length === 0, 'and the old photos are not shown (the add-on does that now)');
  await core2.adoptLegacy();
  ok(
    fs.existsSync(old) && fs.readdirSync(old).length === 2 && store.settings.url === undefined,
    'with no add-on installed the old data waits where it is'
  );
  have = true;
  await core2.adoptLegacy();
  ok(
    store.settings.url === 'https://photos.example.org' &&
      store.settings.key === 'old-key-5678' &&
      store.settings.albums.join() === album1 &&
      store.settings.hidden.join() === A(8).id,
    'the add-on takes over the address, the key, the albums and the hidden photos (ids that are not ids dropped)'
  );
  const kept = fs.readdirSync(path.join(fresh.dataDir, 'photos')).sort();
  ok(
    kept.length === 2 && kept[0] === A(8).id + '.jpg' && fs.readdirSync(old).length === 0,
    'and the photos move into its data folder (not the one with a bad name)'
  );
  ok(im2.details().photos === 1 && im2.wallpapers.list().join() === A(9).id, 'it shows the ones that are not hidden');
  r = await call(core2, '/api/wallpapers/status');
  ok(
    r.j.legacyImmich === undefined && (coreCfg.get().wallpapers || {}).immich === undefined,
    'the old settings and index entries are gone from the core, once'
  );
  // and removing the old data when the add-on is not wanted
  const core3 = wpMod.create({ config: memoryConfig({ wallpapers: { immich: { url: 'https://x.example.org', key: 'k' } } }) });
  nc.mkdirp(old);
  fs.writeFileSync(path.join(old, A(7).id + '.jpg'), JPEG);
  fs.writeFileSync(
    path.join(process.env.CYTV_DIR, 'wallpapers', 'index.json'),
    JSON.stringify({ upload: [], immich: { [A(7).id]: { file: A(7).id + '.jpg', bytes: 1, sum: 'x', size: '4k' } } })
  );
  const core4 = wpMod.create({ config: memoryConfig({ wallpapers: { immich: { url: 'https://x.example.org', key: 'k' } } }) });
  void core3;
  r = await call(core4, '/api/wallpapers/status');
  ok(r.j.legacyImmich && r.j.legacyImmich.photos === 1, 'old data from an earlier version shows up in the status');
  r = await call(core4, '/api/wallpapers/disconnect', 'POST', {});
  ok(r.j.legacyImmich === undefined && fs.readdirSync(old).length === 0, 'Remove old Immich data deletes the files and the settings');

  im.server.close();
  void http;
});
