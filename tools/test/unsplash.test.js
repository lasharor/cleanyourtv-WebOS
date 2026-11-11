// The Unsplash add-on (addons/catalog/unsplash), against a stand-in for Unsplash: the Access Key goes only in the Authorization header of
// API requests and never with a redirect or a picture request, a photo is fetched and reported (two requests), at most one new photo
// every 3 minutes (in between one shown before is shown again), a failed request is not a photo, the hourly limit pauses new photos,
// the credit line is always given, and the phone page (key check, Test key and save, off, disconnect). Written for the Unsplash
// integration of the pull request that first added it to Wallpapers (Edenik, #132).
const http = require('http'),
  path = require('path');
const { root, ok, serve, req, memoryConfig, run } = require('./lib');

const KEY = 'unsplash-key-abcdefghij1234';

// a request to the add-on's phone page on 127.0.0.1:8796
function phone(method, p, body, code) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 8796, path: p, method, headers: { 'x-code': code || '' } }, res => {
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
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

run(async () => {
  const nc = req('netcompat');
  const addonDir = path.join(root, 'addons', 'catalog', 'unsplash');
  const M = require(path.join(addonDir, 'service.js'));

  // ---- a stand-in for Unsplash ----
  let n = 0,
    mode = 'ok',
    left = 40;
  const log = []; // [url, authorization header]
  const us = await serve((q, res) => {
    log.push([q.url, q.headers.authorization || '']);
    const send = (c, o, h) => {
      res.writeHead(c, Object.assign({ 'content-type': 'application/json', 'x-ratelimit-remaining': String(left) }, h));
      res.end(JSON.stringify(o));
    };
    if (q.headers.authorization !== 'Client-ID ' + KEY) return send(401, {});
    if (/^\/photos\/random/.test(q.url)) {
      if (mode === 'limit') return send(403, { errors: ['Rate Limit Exceeded'] });
      if (mode === 'fail') return send(500, {});
      if (mode === 'redirect') return send(302, {}, { location: 'http://127.0.0.1:1/x' });
      if (/topics=/.test(q.url) && mode === 'notopic') return send(404, {});
      n++;
      const base = us.url;
      return send(200, {
        id: 'ph' + n + 'abcdef',
        width: 4000,
        height: 3000,
        urls: { raw: base + '/img/ph' + n + '?ixid=abc', small: base + '/img/s' + n },
        links: { download_location: 'https://api.unsplash.com/photos/ph' + n + 'abcdef/download?ixid=abc' },
        user: { name: 'Ann <b>Lee</b>', username: 'ann_lee' },
      });
    }
    if (/^\/photos\/[A-Za-z0-9_-]+\/download/.test(q.url)) return send(200, { url: 'x' });
    if (q.url === '/photos?per_page=1') return send(200, []);
    send(404, {});
  });
  process.env.CYTV_UNSPLASH_URL = us.url;

  const config = memoryConfig({});
  const dataDir = path.join(process.env.CYTV_DIR, 'addon-data', 'unsplash');
  nc.mkdirp(dataDir);
  const ctx = {
    id: 'unsplash',
    dir: addonDir,
    dataDir,
    log: () => {},
    fetch: req('fetch'),
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => '', wallpaperSize: () => 'hd' },
    settings: {
      get: () => Object.assign({}, ((config.get().addons || {}).unsplash || {}).settings),
      set: o =>
        config.update('addon:unsplash', c => {
          c.addons = c.addons || {};
          c.addons.unsplash = Object.assign({}, c.addons.unsplash, { settings: Object.assign({}, (c.addons.unsplash || {}).settings, o) });
        }),
    },
  };
  const mod = M.create(ctx);
  const W = mod.wallpapers;
  ok(
    W.label === 'Unsplash' && W.live === false && W.list().length === 0 && typeof W.next === 'function',
    'a live source without files, off until a key is set'
  );
  ok(/not set up/.test(W.status().summary), 'not set up at first');
  ok((await W.next()).error === 'Unsplash is off' && W.push() === null, 'nothing is asked without a key');

  // ---- the tool (wave 2): status, search words, on or off, credits ----
  const T = mod.tools,
    tv = x => JSON.parse(x.content[0].text);
  ok(T.list().length === 1 && T.list()[0].name === 'unsplash', 'one tool, unsplash');
  let tr = await T.call('unsplash', { action: 'status' });
  ok(!tr.isError && tv(tr).configured === false && tv(tr).on === false, 'status: not set up');
  tr = await T.call('unsplash', { action: 'set_query', query: 'x' });
  ok(tr.isError && /not set up/.test(tr.content[0].text), 'nothing changes before it is set up');
  ctx.settings.set({ key: KEY, query: '', on: true });
  tr = await T.call('unsplash', { action: 'status' });
  ok(
    tv(tr).configured === true && tv(tr).on === true && JSON.stringify(tv(tr)).indexOf(KEY.slice(-4)) < 0,
    'status with a key: on, and no part of the key'
  );
  tr = await T.call('unsplash', { action: 'set_query', query: '  snowy   peaks ' });
  ok(!tr.isError && ctx.settings.get().query === 'snowy peaks', 'set_query saves the search words, tidied');
  await T.call('unsplash', { action: 'turn', on: false });
  ok(W.live === false, 'turn off');
  await T.call('unsplash', { action: 'turn', on: true });
  ok(W.live === true, 'turn on');
  ok((await T.call('unsplash', { action: 'turn' })).isError, 'turn needs on');
  ok(/no Unsplash photo/.test((await T.call('unsplash', { action: 'credits' })).content[0].text), 'credits before any photo says so');
  ctx.settings.set({ key: '', query: '', on: true });
  ok(W.live === false, '(the key is taken away again for the tests below)');

  // ---- the phone page ----
  const r = await W.settings({});
  const code = r.code;
  ok(/^\d{6}$/.test(code) && /:8796\/#\d{6}$/.test(r.qr), 'the settings page opens with a 6-digit code');
  let p = await phone('GET', '/api/state', undefined, '000000');
  ok(p.code === 403, 'the API needs the code');
  p = await phone('GET', '/');
  ok(p.code === 200 && /Unsplash/.test(p.text) && !/Client-ID/.test(p.text), 'the page loads and holds no key');
  p = await phone('POST', '/api/save', { key: 'short' }, code);
  ok(p.code === 400 && /does not look like/.test(p.j.error), 'a key of the wrong shape is refused without asking Unsplash');
  ok(log.length === 0, 'and nothing was sent');
  p = await phone('POST', '/api/save', { key: 'wrong-key-abcdefghij12345' }, code);
  ok(p.code === 400 && /refused the Access Key/.test(p.j.error) && !W.live, 'a key Unsplash refuses is reported and not saved');
  log.length = 0;
  p = await phone('POST', '/api/save', { key: KEY, query: '  mountains   snow ' }, code);
  ok(
    p.j.ok === true && p.j.photo && p.j.photo.name === 'Ann <b>Lee</b>' && /utm_source=CleanYourTV/.test(p.j.photo.link),
    'Test key and save: the key works and a photo is fetched'
  );
  ok(
    log[0][0] === '/photos?per_page=1' && /query=mountains%20snow/.test(log[1][0]) && /^\/photos\/ph1abcdef\/download/.test(log[2][0]),
    'the key is checked, a photo asked for with the search words, and the download reported'
  );
  ok(
    log.every(l => l[1] === 'Client-ID ' + KEY),
    'every request carried the key in the Authorization header'
  );
  ok(
    !/unsplash-key/.test(JSON.stringify(mod.details())) && mod.details().keyHint === '…1234',
    'the page is told the last four characters of the key only'
  );
  ok(W.live === true && /3 minutes/.test(W.status().summary), 'the source is live now');
  const pushed = W.push();
  ok(
    pushed &&
      /\/img\/ph1\?ixid=abc&w=1920&fit=max&q=80&fm=jpg$/.test(pushed.url) &&
      pushed.credit === 'Photo by Ann <b>Lee</b> on Unsplash',
    'the saved photo is handed to Home once, with the credit'
  );
  ok(W.push() === null, 'and not a second time');
  ok(!/Authorization|Client-ID|unsplash-key/.test(pushed.url), 'the picture address carries no key');

  // ---- photos for Home ----
  log.length = 0;
  let a = await W.next();
  ok(
    a.url && /ph1\?/.test(a.url) && a.credit === 'Photo by Ann <b>Lee</b> on Unsplash' && log.length === 0,
    'within 3 minutes one shown before is shown again, without a request'
  );
  p = await phone('POST', '/api/credits', {}, code);
  ok(p.j.photos.length === 1 && p.j.photos[0].id === 'ph1abcdef', 'the photographers shown are listed for the phone page');
  tr = await T.call('unsplash', { action: 'credits' });
  ok(
    tv(tr).photographer === 'Ann <b>Lee</b>' && /utm_source=CleanYourTV/.test(tv(tr).link),
    'the tool names the photographer of the photo on Home'
  );

  // ---- what happens when Unsplash fails ----
  mode = 'limit';
  p = await phone('POST', '/api/save', { key: KEY, query: '' }, code);
  ok(
    p.j.ok === true && /hourly limit/.test(p.j.note) && mod.details().pausedUntil > Date.now(),
    'the hourly limit is reported and pauses new photos'
  );
  log.length = 0;
  a = await W.next();
  ok(a.url && log.length === 0, 'during the pause one shown before is shown');
  ok(/paused/.test(W.status().summary), 'the status says paused');

  // ---- a clean state: failures and redirects ----
  await phone('POST', '/api/disconnect', {}, code);
  ok(!W.live && mod.details().shown === 0 && mod.details().keyHint === '', 'disconnect removes the key and the photos shown');
  mode = 'redirect';
  p = await phone('POST', '/api/save', { key: KEY, query: '' }, code);
  ok(p.j.ok === true && p.j.note && !p.j.photo, 'a redirect is not followed (the key would go along): no photo');
  mode = 'fail';
  a = await W.next();
  ok(a.error && !a.url, 'with nothing shown yet and Unsplash failing, Home is told there is none');
  mode = 'notopic';
  await phone('POST', '/api/disconnect', {}, code);
  p = await phone('POST', '/api/save', { key: KEY, query: '' }, code);
  ok(p.j.ok === true && p.j.photo, 'when the Wallpapers topic is unknown, any random landscape photo is used');

  // ---- off ----
  await phone('POST', '/api/on', { on: false }, code);
  ok(!W.live && W.status().summary === 'off' && (await W.next()).error === 'Unsplash is off', 'switched off, nothing is asked');
  await phone('POST', '/api/on', { on: true }, code);
  ok(W.live === true, 'and on again');

  await W.settings({ stop: true });
  p = await phone('GET', '/').catch(() => ({ code: 0 }));
  ok(p.code === 0, 'the phone page is closed again');
  us.server.close();
});
