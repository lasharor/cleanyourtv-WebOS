// Wallpapers (wallpapers.js): uploads from the phone page (the code, picture types, limits, deleting) and the Immich sync against a
// stand-in for Immich (only new or changed photos are downloaded, videos and trashed ones are skipped, a photo that left the albums is
// deleted, hidden ones too, a failed sync keeps the cache, the key stays in the service).
const fs = require('fs'),
  http = require('http'),
  path = require('path'),
  vm = require('vm');
const { ok, call, serve, req, memoryConfig, run, sleep } = require('./lib');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]);

// a request to the phone page on 127.0.0.1:8791
function phone(method, p, body, code, type) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port: 8791,
        path: p,
        method,
        headers: Object.assign({ 'x-code': code || '' }, type ? { 'content-type': type } : {}),
      },
      res => {
        const b = [];
        res.on('data', c => b.push(c));
        res.on('end', () => {
          const t = Buffer.concat(b).toString();
          let j = null;
          try {
            j = JSON.parse(t);
          } catch (_) {}
          resolve({ code: res.statusCode, j, text: t });
        });
      }
    );
    r.on('error', reject);
    r.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
}

run(async () => {
  const W = req('wallpapers');
  ok(
    W.imageType(JPEG) === 'jpg' && W.imageType(PNG) === 'png' && W.imageType(Buffer.from('<svg>')) === '',
    'pictures are told apart by their first bytes'
  );

  const config = memoryConfig({});
  const wp = W.create({ config });
  let r = await call(wp, '/api/wallpapers/status');
  ok(r.j.total === 0 && r.j.size === '4k' && !r.j.immich.configured, 'no photos at first; the picture size is 4K');

  // ---- the phone page ----
  r = await call(wp, '/api/wallpapers/pair', 'POST', {});
  const code = r.j.code;
  ok(/^\d{6}$/.test(code) && /:8791\/#\d{6}$/.test(r.j.qr), 'the phone page opens with a 6-digit code, which the QR code carries');
  await sleep(100);
  let p = await phone('GET', '/');
  ok(
    p.code === 200 && /Upload photos/.test(p.text) && /Configure Immich/.test(p.text),
    'the page offers Upload photos and Configure Immich'
  );
  p = await phone('GET', '/api/state', undefined, '000000');
  ok(p.code === 403, 'the API needs the code');
  p = await phone('POST', '/api/upload', JPEG, code, 'image/jpeg');
  ok(p.code === 200 && p.j.uploads === 1, 'a JPEG is uploaded');
  p = await phone('POST', '/api/upload', Buffer.from('<html>not a picture</html>'), code, 'image/jpeg');
  ok(p.code === 400 && /JPEG, PNG or WebP/.test(p.j.error), 'a file that is not a picture is refused');
  p = await phone('POST', '/api/upload', PNG, code, 'image/png');
  const st = (await phone('GET', '/api/state', undefined, code)).j;
  const files = fs.readdirSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'upload'));
  ok(
    st.uploads === 2 && files.length === 2 && files.every(f => /^[a-f0-9]{16}\.(jpg|png)$/.test(f)),
    'uploads get names of their own, in the upload folder: ' + files.join(' ')
  );
  p = await phone('GET', '/api/photo/u/' + st.uploadsList[0], undefined, code);
  ok(p.code === 200, 'the phone page shows an upload');
  r = await call(wp, '/api/wallpapers/photo/u/..%2F..%2Fconfig.json');
  ok(r.code === 404, 'a path that is not an upload id is not served');
  p = await phone('POST', '/api/upload/delete', { id: st.uploadsList[0] }, code);
  ok(
    p.j.ok === true && fs.readdirSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'upload')).length === 1,
    'an upload is deleted from the phone'
  );
  r = await call(wp, '/api/wallpapers/list');
  ok(r.j.photos.length === 1 && /^u\/[a-f0-9]{16}$/.test(r.j.photos[0]), 'the list for the launcher holds the upload');

  // ---- Immich ----
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
  await phone('POST', '/api/immich/connect', { url: im.url + '/', key: 'wrong' }, code).then(x => {
    ok(/refused the API key/.test(x.j.error || ''), 'a wrong key is reported: ' + (x.j.error || ''));
  });
  p = await phone('POST', '/api/immich/connect', { url: im.url + '/', key: 'secret-key-1234' }, code);
  ok(p.j.ok === true && p.j.albums[0].name === 'Family', 'the connection test lists the albums');
  r = await call(wp, '/api/wallpapers/status');
  ok(
    r.j.immich.configured && r.j.immich.keyHint === '…1234' && JSON.stringify(r.j).indexOf('secret-key') < 0,
    'the status shows the last four characters of the key only'
  );
  p = await phone('POST', '/api/immich/albums', { ids: ['bbbbbbbb-0000-0000-0000-000000000001'] }, code);
  await wp.sync();
  r = await call(wp, '/api/wallpapers/status');
  ok(
    r.j.immich.photos === 3 && down === 3 && !r.j.immich.error && r.j.immich.lastSync > 0,
    'the sync downloads the photos (not the video or the trashed one)'
  );
  await wp.sync();
  ok(down === 3, 'a second sync downloads nothing');
  album[1] = A(2, { checksum: 'changed' });
  await wp.sync();
  ok(down === 4, 'a changed photo is downloaded again');
  await phone(
    'POST',
    '/api/immich/albums',
    { ids: ['bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001'] },
    code
  );
  await wp.sync();
  r = await call(wp, '/api/wallpapers/status');
  ok(
    r.j.immich.photos === 6 && down === 7,
    'an album on a newer Immich (photos found by search, in pages) is synced too: ' + r.j.immich.photos
  );
  await phone('POST', '/api/immich/albums', { ids: ['bbbbbbbb-0000-0000-0000-000000000001'] }, code);
  await wp.sync();
  ok((await call(wp, '/api/wallpapers/status')).j.immich.photos === 3, "a deselected album's photos are removed");
  album = [A(1), A(2, { checksum: 'changed' })];
  await wp.sync();
  const imFiles = fs.readdirSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'immich'));
  ok(
    imFiles.length === 2 && fs.readdirSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'upload')).length === 1,
    'a photo that left the album is deleted, the uploads stay'
  );
  p = await phone('POST', '/api/immich/hide', { id: A(1).id, hidden: true }, code);
  r = await call(wp, '/api/wallpapers/list');
  ok(r.j.photos.length === 2 && r.j.photos.indexOf('i/' + A(1).id) < 0, 'a hidden Immich photo is not shown');
  downAll = true;
  await wp.sync();
  r = await call(wp, '/api/wallpapers/status');
  ok(
    r.j.immich.error && r.j.immich.photos === 1 && fs.readdirSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'immich')).length >= 1,
    'when Immich is down the cache stays: ' + r.j.immich.error
  );
  downAll = false;
  r = await call(wp, '/api/wallpapers/set', 'POST', { size: 'hd' });
  ok(r.j.size === 'hd', 'the picture size can be Full HD');
  r = await call(wp, '/api/wallpapers/disconnect', 'POST', {});
  ok(
    !r.j.immich.configured && r.j.immich.photos === 0 && r.j.uploads === 1 && !(config.get().wallpapers || {}).immich,
    'disconnecting forgets the key and deletes only the Immich photos'
  );
  r = await call(wp, '/api/wallpapers/remove-uploads', 'POST', {});
  ok(r.j.uploads === 0 && r.j.total === 0, 'all uploads can be removed');

  // ---- Unsplash: a stand-in for api.unsplash.com (the clock is moved forward by hand: a new photo is asked for at most every 3 minutes) ----
  const KEY = 'UnsplashKeyABCDEFGHIJKLMNOP1234';
  let base = '',
    hits = [],
    tracked = [],
    limit = false,
    fail = false,
    left = '49',
    imgs = [],
    portrait = false,
    topic404 = false,
    skew = 0,
    GAP = 190000,
    rn = 0,
    evilHits = 0;
  const realNow = Date.now;
  Date.now = () => realNow() + skew;
  const udir = path.join(process.env.CYTV_DIR, 'wallpapers', 'unsplash');
  const evil = await serve((q, res) => {
    evilHits++;
    res.writeHead(404);
    res.end();
  });
  const P = (n, extra) => {
    const id = 'photo' + n + 'abc';
    return Object.assign(
      {
        id,
        width: 4000,
        height: 3000,
        urls: { raw: () => base + '/img/' + id + '?ixid=IX' + n + '&ixlib=rb-4.0', small: () => base + '/img/' + id + '?w=400' },
        links: { download_location: 'https://api.unsplash.com/photos/' + id + '/download?ixid=IX' + n },
        user: { name: 'Jane ' + n, username: 'jane_' + n },
      },
      extra || {}
    );
  };
  const wire = x => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === 'function' ? v() : v)));
  const un = await serve((q, res) => {
    const u = require('url').parse(q.url, true),
      send = (c, o, h) => {
        res.writeHead(c, Object.assign({ 'content-type': 'application/json', 'x-ratelimit-remaining': left }, h || {}));
        res.end(JSON.stringify(o));
      };
    if (/^\/img\//.test(q.url)) {
      // the image host: no key is sent to it
      imgs.push({ url: q.url, auth: q.headers.authorization || '' });
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(JPEG);
    }
    hits.push(q.url);
    if (q.headers.authorization !== 'Client-ID ' + KEY || q.headers['accept-version'] !== 'v1')
      return send(401, { errors: ['OAuth error: The access token is invalid'] });
    if (limit) return send(403, 'Rate Limit Exceeded', { 'x-ratelimit-remaining': '0' });
    if (fail) return send(500, {});
    if (u.pathname === '/photos') return send(200, []);
    if (u.pathname === '/photos/random') {
      if (u.query.query === 'redirect') return send(302, {}, { location: evil.url + '/stolen' });
      if (u.query.topics && topic404) return send(404, {});
      return send(200, wire(P(++rn, portrait ? { width: 3000, height: 4000 } : {})));
    }
    const m = /^\/photos\/([A-Za-z0-9]+)\/download$/.exec(u.pathname);
    if (m) {
      tracked.push(m[1] + '?' + (u.search || ''));
      return send(200, { url: 'x' });
    }
    send(404, {});
  });
  base = un.url;
  process.env.CYTV_UNSPLASH_URL = base;
  // save only (photo: false), and the way the phone page's button saves: that one also fetches a photo
  const unsave = b => phone('POST', '/api/unsplash/save', Object.assign({ photo: false }, b), code);
  const unsaveT = b => phone('POST', '/api/unsplash/save', b, code);
  const pushed = async () => (await call(wp, '/api/wallpapers/push')).j;
  const ust = async () => (await call(wp, '/api/wallpapers/status')).j.unsplash;
  const use = async id => (await call(wp, '/api/wallpapers/unsplash-use', 'POST', { id })).j;
  await call(wp, '/api/wallpapers/set', 'POST', { size: '4k' });
  p = await phone('GET', '/');
  ok(
    /Configure Unsplash/.test(p.text) && /unsplash\.com\/developers/.test(p.text),
    'the phone page has a Configure Unsplash part that says where to get a key'
  );
  // the page's scripts are ES5 built by hand: they must at least parse (a browser is needed to run them)
  const scripts = p.text.match(/<script>([\s\S]*?)<\/script>/g) || [];
  ok(
    scripts.length > 0 &&
      scripts.every(s => {
        try {
          new vm.Script(s.slice(8, -9)); // <script> … </script>
          return true;
        } catch (e) {
          return false;
        }
      }),
    'the phone page scripts parse: ' + scripts.length
  );
  // the phone page builds each credit from the translation, linking the photographer and Unsplash wherever the language puts them.
  // A language translated after this text (Vietnamese arrived upstream later) has no such key: it is incomplete, not wrong.
  const creditTexts = fs
    .readdirSync(path.join(__dirname, '../../i18n'))
    .filter(f => /^[a-z]{2}\.json$/.test(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(__dirname, '../../i18n', f), 'utf8'))['Photo by %s on Unsplash'])
    .filter(v => typeof v === 'string');
  ok(
    creditTexts.length >= 12 &&
      creditTexts.every(v => (v.match(/%s/g) || []).length === 1 && (v.match(/Unsplash/g) || []).length === 1),
    'every language that translates it credits the photographer and Unsplash once, in whatever order: ' + creditTexts.length
  );
  p = await unsave({ key: 'short', query: 'x' });
  ok(
    p.code === 400 && /Access Key/.test(p.j.error) && !hits.length,
    'a key that is not shaped like an Access Key is refused without a request: ' + p.j.error
  );
  p = await unsave({ key: 'W'.repeat(40), query: 'mountains' });
  ok(p.code === 400 && /refused the Access Key/.test(p.j.error) && !(await ust()).configured, 'a wrong key is reported and not saved');
  // ---- nothing is listed or stored; Home's "s/live" entry asks Unsplash for a new random photo each time ----
  hits = [];
  p = await unsave({ key: KEY, query: ' mountains  and lakes ' });
  ok(p.j.ok === true && hits.join() === '/photos?per_page=1', 'the key is tested with one request, then saved');
  await wp.sync();
  let s = await ust();
  ok(
    hits.length === 1 &&
      s.configured &&
      s.on &&
      !s.error &&
      !fs.existsSync(udir) &&
      (await call(wp, '/api/wallpapers/status')).j.bytes === 0,
    'saving and syncing ask Unsplash for no photo and no list, and nothing is stored'
  );
  ok(
    s.keyHint === '…1234' &&
      JSON.stringify([(await call(wp, '/api/wallpapers/status')).j, (await phone('GET', '/api/state', undefined, code)).j]).indexOf(KEY) <
        0 &&
      JSON.stringify(config.get().wallpapers.unsplash).indexOf(KEY) > 0,
    'the key is kept in the settings; the status and the phone page show its last four characters only'
  );
  r = await call(wp, '/api/wallpapers/list');
  ok(r.j.photos.join() === 's/live' && !r.j.credits, 'Home gets one entry that stands for a new photo from Unsplash');
  let n = hits.length;
  r = await use('live');
  ok(
    r.ok === true &&
      r.name === 'Jane 1' &&
      /^http:\/\/127\.0\.0\.1:\d+\/img\/photo1abc\?ixid=IX1&ixlib=rb-4\.0&w=3840&fit=max&q=80&fm=jpg$/.test(r.url) &&
      hits.length === n + 2 &&
      tracked.join() === 'photo1abc??ixid=IX1',
    'a new photo: one random photo asked, its download reported, urls.raw with w, fit, q and fm added (the ixid kept): ' + r.url
  );
  ok(
    /^\/photos\/random\?/.test(hits[n]) &&
      /query=mountains%20and%20lakes/.test(hits[n]) &&
      /orientation=landscape/.test(hits[n]) &&
      /content_filter=high/.test(hits[n]),
    'the random photo is a landscape one for the search words: ' + hits[n]
  );
  r = await use('live');
  ok(
    r.ok === true && r.again === true && r.name === 'Jane 1' && hits.length === n + 2,
    'within 3 minutes of the last photo no request is made: the photo shown before is shown again'
  );
  skew += GAP;
  r = await use('live');
  ok(r.ok === true && !r.again && r.name === 'Jane 2' && tracked.length === 2, 'after 3 minutes the next photo is a new one');
  r = await use('live');
  ok(r.again === true && r.name === 'Jane 1', 'and a repeat shows a photo shown before, not the one on screen');
  p = await phone('POST', '/api/unsplash/credits', {}, code);
  ok(
    p.j.photos.length === 2 &&
      p.j.photos[0].name === 'Jane 2' &&
      p.j.photos[0].link === 'https://unsplash.com/@jane_2?utm_source=CleanYourTV&utm_medium=referral' &&
      /\/img\/photo2abc\?w=400$/.test(p.j.photos[0].thumb),
    'the phone page gets the photos shown so far, each with its photographer, a link back to Unsplash (utm parameters) and a thumbnail'
  );
  skew += GAP;
  await call(wp, '/api/wallpapers/set', 'POST', { size: 'hd' });
  r = await use('live');
  await call(wp, '/api/wallpapers/set', 'POST', { size: '4k' });
  ok(/&w=1920&/.test(r.url), 'at Full HD the address asks for 1920 pixels');
  ok((await use('photo1abc')).ok === false && (await use('..%2Fx')).ok === false, 'only "live" is a photo Home may ask for');
  // Test key and save fetches a photo now, whatever the 3 minutes say, lists it and hands it to Home
  n = hits.length;
  let ps = await pushed();
  p = await unsaveT({ query: ' mountains  and lakes ' });
  r = await pushed();
  ok(
    p.j.ok === true &&
      /^Jane \d+$/.test(p.j.photo.name) &&
      p.j.photo.link.indexOf('https://unsplash.com/@jane_') === 0 &&
      p.j.photo.link.indexOf('utm_source=CleanYourTV&utm_medium=referral') > 0 &&
      hits.length === n + 2 &&
      r.seq === ps.seq + 1 &&
      r.name === p.j.photo.name &&
      /&w=3840&fit=max&q=80&fm=jpg$/.test(r.url),
    'Test key and save fetches a new photo at once (2 requests) and Home can pick it up: ' + JSON.stringify(p.j)
  );
  p = await phone('POST', '/api/unsplash/credits', {}, code);
  ok(p.j.photos[0].name === r.name, 'it is the first of the recent photos');
  ps = r;
  n = hits.length;
  p = await unsaveT({ query: ' mountains  and lakes ' });
  r = await pushed();
  ok(p.j.photo && p.j.photo.name !== ps.name && r.seq === ps.seq + 1 && hits.length === n + 2, 'every click fetches another photo');
  // the photo from Test key and save is handed to Home once, by its poll or by the next photo it asks for
  p = await unsaveT({ query: ' mountains  and lakes ' });
  const pushedOnce = await pushed();
  const pushedAgain = await pushed();
  ok(
    pushedOnce.url && pushedAgain.seq === pushedOnce.seq && !pushedAgain.url,
    'the photo from Test key and save is handed to Home once, then the poll gets nothing'
  );
  p = await unsaveT({ query: ' mountains  and lakes ' });
  r = await use('live');
  const afterUse = await pushed();
  ok(
    r.ok === true && r.name === p.j.photo.name && !afterUse.url,
    'Home asking for a photo takes the photo from Test key and save first, and the poll does not show it again'
  );
  p = await unsaveT({ query: ' mountains  and lakes ' });
  skew += 11 * 60 * 1000;
  const expired = await pushed();
  ok(expired.seq > 0 && !expired.url, 'a photo from Test key and save is dropped after ten minutes');
  // a request that fails is not a photo: the next one may come after 30 seconds, not after the 3 minutes
  skew += GAP;
  fail = true;
  n = hits.length;
  await use('live');
  const afterFail = hits.length;
  skew += 31000;
  await use('live');
  fail = false;
  ok(
    afterFail === n + 1 && hits.length === n + 2 && /Unsplash answered 500/.test((await ust()).error),
    'a failed request is tried again after 30 seconds, not after the 3 minutes'
  );
  // there is no collection field: one that is sent anyway is not kept or used; then the Wallpapers topic
  skew += GAP;
  p = await unsave({ collection: 'abc123XYZ', query: 'mountains' });
  n = hits.length;
  r = await use('live');
  ok(
    r.ok &&
      /query=mountains/.test(hits[n]) &&
      !/collections=/.test(hits[n]) &&
      !('collection' in config.get().wallpapers.unsplash) &&
      !('collection' in (await ust())),
    'there is no collection setting: only the search words count: ' + hits[n]
  );
  skew += GAP;
  p = await unsave({ query: '' });
  n = hits.length;
  r = await use('live');
  ok(r.ok && /topics=bo8jQKTaE0Y/.test(hits[n]), 'with no search words the Wallpapers topic is used: ' + hits[n]);
  skew += GAP;
  topic404 = true;
  n = hits.length;
  r = await use('live');
  ok(
    r.ok && hits.length === n + 3 && !/topics=/.test(hits[n + 1]),
    'if Unsplash does not know the topic any random landscape photo is used'
  );
  topic404 = false;
  skew += GAP;
  portrait = true;
  r = await use('live');
  ok(
    r.again === true && /no landscape photo/.test((await ust()).error),
    'a photo that is taller than wide is not shown: one shown before is shown instead'
  );
  portrait = false;
  // the key must not follow a redirect
  skew += GAP;
  p = await unsave({ query: 'redirect' });
  r = await use('live');
  ok(
    evilHits === 0 && r.again === true && /Unsplash answered 302/.test((await ust()).error),
    'a redirect is not followed (the key stays with api.unsplash.com)'
  );
  // the hourly limit: say so, leave Unsplash alone for an hour
  skew += GAP;
  p = await unsave({ query: 'limit me' });
  limit = true;
  r = await use('live');
  s = await ust();
  ok(
    r.ok === true && r.again === true && /hourly limit/.test(s.error) && s.pausedUntil > Date.now() + 3500 * 1000,
    'the limit is reached: a photo shown before is shown again, a clear message, a pause of an hour: ' + s.error
  );
  limit = false;
  n = hits.length;
  skew += GAP;
  r = await use('live');
  await wp.sync();
  ok(
    hits.length === n && r.again === true,
    'during the pause no request is made, not even with Sync now, and the photos shown before go round'
  );
  n = hits.length;
  p = await unsaveT({ query: 'limit me' });
  ok(
    p.j.ok === true && !p.j.photo && /hourly limit/.test(p.j.note) && hits.length === n,
    'Test key and save during the pause saves, fetches nothing and says why'
  );
  // the allowance the replies report runs out
  await call(wp, '/api/wallpapers/unsplash-disconnect', 'POST', {});
  p = await unsave({ key: KEY, query: 'mountains' });
  skew += GAP;
  left = '2';
  r = await use('live');
  skew += GAP;
  n = hits.length;
  const r2 = await use('live');
  left = '49';
  ok(
    r.ok === true && !r.again && r2.again === true && hits.length === n,
    'when the replies say 2 requests or fewer are left no photo is asked for until the next hour: the photos shown before go round'
  );
  // switching it off and on
  skew += 4000 * 1000; // an hour on
  r = await call(wp, '/api/wallpapers/unsplash-set', 'POST', { on: false });
  skew += GAP;
  ok(r.j.unsplash.on === false && r.j.total === 0 && (await use('live')).ok === false, 'switched off, no photo is shown or asked for');
  r = await call(wp, '/api/wallpapers/unsplash-set', 'POST', { on: true });
  ok(r.j.unsplash.on === true && r.j.total === 1, 'switched on again, the entry is back');
  // removing it
  r = await call(wp, '/api/wallpapers/unsplash-disconnect', 'POST', {});
  ok(
    !r.j.unsplash.configured && r.j.total === 0 && !(config.get().wallpapers || {}).unsplash && (await use('photo1abc')).ok === false,
    'removing Unsplash forgets the key and the list'
  );
  ok(
    JSON.stringify(r.j).indexOf(KEY) < 0 &&
      !fs.readFileSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'index.json'), 'utf8').includes(KEY),
    'the key is in neither the reply nor the photo index'
  );
  Date.now = realNow;
  delete process.env.CYTV_UNSPLASH_URL;
  await call(wp, '/api/wallpapers/pair', 'POST', { stop: true });
  im.server.close();
  un.server.close();
  evil.server.close();
});
