// Immich as a photo source for Home's wallpapers (an add-on that provides "wallpapers", see helper/wallpapers.js):
//   dataDir/photos/<asset id>.<jpg|png|webp>   photos of the chosen albums, downloaded by a sync and kept, so showing one never needs Immich
//   dataDir/index.json                          what each file is (size, Immich checksum) and how the last sync went; only listed files are deleted
// The settings (address, API key, albums, hidden photos) are this add-on's settings in config.json (addons.immich.settings). The key goes
// only in the x-api-key header to your Immich, shows as its last four characters at most and is not logged.
// The phone page (settings(): a short-lived server on the LAN, port 8795, needs the code shown on the TV) connects, picks albums, and hides
// photos. A TV that used the Immich of an earlier CleanYourTV hands its settings and photos over once (adopt()).
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const phone = require('./phone');

const LIMITS = { photos: 300, bytes: 100 * 1024 * 1024, file: 12 * 1024 * 1024 };
const PAIR_PORT = 8795, // after the Android box (8793) and App icons (8794) pages
  PAIR_MS = 15 * 60 * 1000,
  SYNC_MS = 6 * 3600 * 1000;
const ASSET = /^[0-9a-f-]{36}$/i;

// what a file is, from its first bytes: only JPEG, PNG and WebP are kept
function imageType(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
}
const base = u =>
  String(u || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/, '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function create(ctx) {
  const fetch = ctx.fetch,
    util = ctx.util,
    PH = path.join(ctx.dataDir, 'photos'),
    INDEX = path.join(ctx.dataDir, 'index.json');
  const cfg = () => Object.assign({ url: '', key: '', albums: [], hidden: [] }, ctx.settings.get());
  const save = o => ctx.settings.set(o);

  // ---- the index of the files ----
  let index = null;
  function idx() {
    if (index) return index;
    try {
      index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    } catch (_) {
      index = {};
    }
    index.photos = index.photos && typeof index.photos === 'object' ? index.photos : {};
    index.sync = index.sync || { state: 'idle', at: 0, error: '', ok: 0, done: 0 };
    return index;
  }
  function saveIdx() {
    util.mkdirp(ctx.dataDir);
    fs.writeFileSync(INDEX + '.tmp', JSON.stringify(idx()), { mode: 0o600 });
    fs.renameSync(INDEX + '.tmp', INDEX);
  }
  const unlink = f => {
    try {
      fs.unlinkSync(f);
    } catch (_) {}
  };
  const shown = () => {
    const hid = cfg().hidden;
    return Object.keys(idx().photos).filter(id => hid.indexOf(id) < 0);
  };
  const usedBytes = () => Object.keys(idx().photos).reduce((n, k) => n + (idx().photos[k].bytes || 0), 0);

  // ---- Immich (https://immich.app/docs/api): the key goes in the x-api-key header ----
  function immich(pathname, c, opts) {
    const s = c || cfg();
    return fetch
      .read(
        base(s.url) + '/api' + pathname,
        Object.assign(
          { headers: { 'x-api-key': s.key, Accept: 'application/json' }, idleMs: 20000, maxBytes: 16 << 20, anyStatus: true },
          opts || {}
        )
      )
      .then(r => {
        if (r.status === 401 || r.status === 403) throw new Error('Immich refused the API key (needs album.read and asset.read/view)');
        if (r.status !== 200) throw new Error('Immich answered ' + r.status);
        return JSON.parse(r.body.toString('utf8'));
      });
  }
  // every album the key can read: own and shared with you
  async function albums(c) {
    const own = await immich('/albums', c),
      shared = await immich('/albums?shared=true', c).catch(() => []);
    const seen = {};
    return own
      .concat(shared)
      .filter(a => a && a.id && !seen[a.id] && (seen[a.id] = 1))
      .map(a => ({ id: a.id, name: String(a.albumName || 'Album').slice(0, 80), count: a.assetCount || 0 }));
  }
  async function connect(url, key) {
    const c = { url: base(url), key: key || cfg().key };
    if (!/^https?:\/\/[^/]+/i.test(c.url)) return { error: 'the address must start with http:// or https://' };
    if (!c.key) return { error: 'enter the API key' };
    try {
      const list = await albums(c);
      const old = cfg();
      save({ url: c.url, key: c.key, albums: old.url === c.url ? old.albums : [], hidden: old.url === c.url ? old.hidden : [] });
      return { ok: true, albums: list };
    } catch (e) {
      return { error: 'could not reach Immich: ' + String(e.message || e) };
    }
  }

  // ---- the sync: new or changed photos are downloaded, photos no longer wanted are deleted (only files the index lists) ----
  let syncing = null,
    again = false;
  // one sync at a time; a request during a sync (new albums chosen, Sync now) runs it once more afterwards, within the same promise
  function sync() {
    if (syncing) {
      again = true;
      return syncing;
    }
    syncing = (async () => {
      do {
        again = false;
        await doSync().catch(() => {});
      } while (again);
      syncing = null;
    })();
    return syncing;
  }
  async function download(id, mime, size) {
    const c = cfg(),
      tmp = path.join(PH, id + '.tmp'),
      hdrs = { 'x-api-key': c.key };
    const tries =
      size === '4k'
        ? ['/assets/' + id + '/thumbnail?size=fullsize'].concat(
            /^image\/(jpeg|png|webp)$/.test(mime || '') ? ['/assets/' + id + '/original'] : [],
            ['/assets/' + id + '/thumbnail?size=preview']
          )
        : ['/assets/' + id + '/thumbnail?size=preview'];
    let last = null;
    for (const t of tries) {
      try {
        const r = await fetch.read(base(c.url) + '/api' + t, { headers: hdrs, idleMs: 30000, maxBytes: LIMITS.file, anyStatus: true });
        if (r.status !== 200) throw new Error('Immich answered ' + r.status);
        const type = imageType(r.body);
        if (!type) throw new Error('not a picture the TV can show');
        fs.writeFileSync(tmp, r.body, { mode: 0o600 });
        const file = id + '.' + type;
        fs.renameSync(tmp, path.join(PH, file));
        return { file, bytes: r.body.length };
      } catch (e) {
        last = e;
      }
    }
    unlink(tmp);
    throw last || new Error('download failed');
  }
  // an album's photos. Up to Immich 1.x the album itself lists them; newer servers (2.x, 3.x) leave them out, so they are searched by
  // album (POST /api/search/metadata), a page at a time
  async function albumAssets(id) {
    const al = await immich('/albums/' + encodeURIComponent(id) + '?withoutAssets=false');
    if (Array.isArray(al.assets)) return al.assets;
    let out = [],
      page = 1;
    for (let n = 0; page && n < 20; n++) {
      const r = await immich('/search/metadata', null, {
        method: 'POST',
        headers: { 'x-api-key': cfg().key, Accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ albumIds: [id], type: 'IMAGE', size: 250, page }),
      });
      const items = (r.assets && r.assets.items) || [];
      out = out.concat(items);
      page = r.assets && r.assets.nextPage ? +r.assets.nextPage : 0;
      if (out.length >= LIMITS.photos * 2) break;
    }
    return out;
  }
  async function doSync() {
    const c = cfg(),
      st = idx().sync;
    if (!c.url || !c.key) return;
    st.state = 'syncing';
    st.error = '';
    st.done = 0;
    try {
      util.mkdirp(PH);
      // the albums' photos, newest first, without videos or trashed ones (hidden ones stay on the TV, so they can be shown again)
      const want = [],
        seen = {};
      for (const a of c.albums) {
        for (const x of await albumAssets(a))
          if (x && ASSET.test(x.id) && x.type === 'IMAGE' && !x.isTrashed && x.visibility !== 'hidden' && !seen[x.id]) {
            seen[x.id] = 1;
            want.push({ id: x.id, sum: x.checksum || '', mime: x.originalMimeType || '', at: Date.parse(x.fileCreatedAt || '') || 0 });
          }
      }
      want.sort((a, b) => b.at - a.at);
      if (!want.length && c.albums.length) st.error = 'the chosen albums have no photos the TV can show';
      const keep = want.slice(0, LIMITS.photos),
        keepIds = {};
      keep.forEach(w => (keepIds[w.id] = 1));
      // first the ones no longer wanted, so their space is free for the new ones
      const cur = idx().photos;
      for (const id of Object.keys(cur))
        if (!keepIds[id]) {
          unlink(path.join(PH, cur[id].file));
          delete cur[id];
        }
      saveIdx();
      const size = ctx.env.wallpaperSize();
      let full = false,
        failed = 0;
      for (const w of keep) {
        const have = cur[w.id];
        if (have && have.sum === w.sum && have.size === size && fs.existsSync(path.join(PH, have.file))) continue;
        if (usedBytes() > LIMITS.bytes - 2 * 1024 * 1024) {
          full = true;
          break;
        }
        try {
          const d = await download(w.id, w.mime, size);
          if (have && have.file !== d.file) unlink(path.join(PH, have.file));
          cur[w.id] = { file: d.file, bytes: d.bytes, sum: w.sum, size };
          st.done++;
          if (st.done % 10 === 0) saveIdx();
        } catch (e) {
          failed++;
          if (failed >= 5 && !st.done) throw e; // Immich is down or the key lost a permission: stop, keep what is there
        }
      }
      st.ok = Date.now();
      if (full) st.error = 'Immich is full (100 MB): not every photo was downloaded';
      else if (failed) st.error = failed + ' photos could not be downloaded';
    } catch (e) {
      st.error = String(e.message || e);
    }
    st.state = 'idle';
    st.at = Date.now();
    saveIdx();
  }
  function disconnect() {
    for (const id of Object.keys(idx().photos)) unlink(path.join(PH, idx().photos[id].file));
    idx().photos = {};
    idx().sync = { state: 'idle', at: 0, error: '', ok: 0, done: 0 };
    saveIdx();
    save({ url: '', key: '', albums: [], hidden: [] });
  }

  // ---- what Home's wallpapers ask of a source ----
  const ago = t => {
    if (!t) return 'never';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  };
  function details() {
    const c = cfg(),
      s = idx().sync;
    return {
      configured: !!(c.url && c.key),
      url: c.url,
      keyHint: c.key ? '…' + c.key.slice(-4) : '',
      albums: c.albums.length,
      photos: shown().length,
      hidden: c.hidden.length,
      state: s.state,
      lastSync: s.ok || 0,
      tried: s.at || 0,
      error: s.error || '',
      done: s.done || 0,
    };
  }
  function status() {
    const d = details();
    if (!d.configured) return { summary: 'not connected · set up from your phone', error: '' };
    return {
      summary: d.state === 'syncing' ? 'syncing… ' + d.done + ' new' : d.photos + ' photos · synced ' + ago(d.lastSync),
      error: d.error,
    };
  }
  const file = id => {
    const p = ASSET.test(id) && idx().photos[id];
    return p && shown().indexOf(id) >= 0 ? path.join(PH, p.file) : '';
  };

  // a TV that used the Immich of an earlier CleanYourTV: its settings and its photos move here once (the core gives them over)
  async function adopt(legacy) {
    const s = (legacy && legacy.settings) || {};
    if (!cfg().url && s.url && s.key)
      save({
        url: base(s.url),
        key: String(s.key),
        albums: (Array.isArray(s.albums) ? s.albums : []).filter(a => ASSET.test(a)),
        hidden: (Array.isArray(s.hidden) ? s.hidden : []).filter(a => ASSET.test(a)),
      });
    const from = (legacy && legacy.photos) || {};
    util.mkdirp(PH);
    for (const id of Object.keys(from)) {
      const p = from[id];
      if (!ASSET.test(id) || !p || typeof p.file !== 'string' || /[\\/]/.test(p.file) || idx().photos[id]) continue;
      try {
        fs.renameSync(path.join(legacy.dir, p.file), path.join(PH, p.file));
        idx().photos[id] = { file: p.file, bytes: +p.bytes || 0, sum: String(p.sum || ''), size: p.size === 'hd' ? 'hd' : '4k' };
      } catch (_) {}
    }
    saveIdx();
    return { ok: true };
  }

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, pair.until - Date.now());
  }
  function body(req) {
    return new Promise((resolve, reject) => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > 16384) {
          reject(new Error('too large'));
          req.destroy();
        } else b.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(b).toString('utf8') || '{}'));
        } catch (_) {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }
  async function handlePhone(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phone.page(util.i18n, esc, util.i18n.lang(req, ctx.env.lang())));
    }
    if (u.indexOf('/api/') !== 0) {
      res.writeHead(404);
      return res.end();
    }
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    try {
      if (u === '/api/state') return json(details());
      const m = /^\/api\/photo\/([0-9a-f-]{36})$/i.exec(u);
      if (m && req.method === 'GET') {
        const p = idx().photos[m[1]];
        if (!p) return json({ error: 'not found' }, 404);
        res.writeHead(200, {
          'content-type': 'image/' + (p.file.split('.').pop() === 'jpg' ? 'jpeg' : p.file.split('.').pop()),
          'cache-control': 'private, max-age=3600',
        });
        return fs.createReadStream(path.join(PH, p.file)).pipe(res);
      }
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = await body(req);
      if (u === '/api/connect') return json(await connect(String(b.url || ''), String(b.key || '')));
      if (u === '/api/albums') {
        if (Array.isArray(b.ids)) {
          save({ albums: b.ids.filter(x => typeof x === 'string' && ASSET.test(x)).slice(0, 50) });
          sync();
          return json({ ok: true });
        }
        const sel = cfg().albums;
        return json({ albums: (await albums()).map(a => Object.assign(a, { on: sel.indexOf(a.id) >= 0 })) });
      }
      if (u === '/api/sync') {
        sync();
        return json({ ok: true });
      }
      if (u === '/api/photos') {
        const hid = cfg().hidden;
        return json({ photos: Object.keys(idx().photos).map(id => ({ id, hidden: hid.indexOf(id) >= 0 })) });
      }
      if (u === '/api/hide') {
        const id = String(b.id || '');
        if (!ASSET.test(id)) return json({ error: 'bad id' }, 400);
        const hid = cfg().hidden.filter(x => x !== id);
        if (b.hidden) hid.push(id);
        save({ hidden: hid });
        return json({ ok: true });
      }
      if (u === '/api/disconnect') {
        disconnect();
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }
  function settings(o) {
    stopPair();
    if (o && o.stop) return {};
    const code = String(util.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => handlePhone(req, res, code, () => ++bad));
    pair = { code, srv, until: Date.now() + PAIR_MS, timer: setTimeout(stopPair, PAIR_MS) };
    const url = 'http://' + util.lanIp() + ':' + PAIR_PORT;
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve({ url, code, qr: url + '/#' + code, seconds: PAIR_MS / 1000 }));
    });
  }

  // the automatic sync: every six hours; shortly after a start only when the last one is more than a day old
  function start() {
    if (idx().sync.state === 'syncing') idx().sync.state = 'idle'; // a sync the last run did not finish
    const t = setInterval(() => sync(), SYNC_MS);
    if (t.unref) t.unref();
    if (Date.now() - (idx().sync.ok || 0) > 24 * 3600 * 1000 && cfg().url) {
      const t2 = setTimeout(() => sync(), 15 * 60 * 1000);
      if (t2.unref) t2.unref();
    }
  }

  return {
    start,
    wallpapers: { label: 'Immich', list: shown, file, status, settings, adopt },
    // for the tests
    sync,
    details,
    handlePhone,
  };
}

module.exports = { create, imageType, LIMITS, PAIR_PORT };
