// Wallpapers: photos as the launcher's background, from three sources:
//   D/wallpapers/upload/<random>.jpg   photos uploaded from a phone (the phone page scales them before sending)
//   D/wallpapers/immich/<asset id>.jpg photos from chosen Immich albums, downloaded by a sync and kept, so showing one never needs Immich
// Unsplash photos are not stored: Home asks for a new one now and then (see below).
// D/wallpapers/index.json says what each file is (source, size, Immich checksum) and holds the last Unsplash photos shown; only files listed there are ever deleted.
// The settings are the wallpapers section of config.json: {size: '4k'|'hd' (4K is the default: Home is drawn at the panel's 3840 x 2160), immich: {url, key, albums: [ids], hidden: [asset ids]}, unsplash: {key, query, on}}.
// The Immich and Unsplash keys never leave the service: status() shows their last four characters only, and they are not logged.
// Unsplash (https://unsplash.com/documentation): a random landscape photo from a search or the Wallpapers topic, asked for
// when Home is about to show one (at most every 3 minutes: 2 requests each, the photo and its download report; a new key may make 50
// requests an hour). The Access Key goes in "Authorization: Client-ID <key>" to api.unsplash.com only (never followed to another host,
// never sent to the image host); Home loads the picture from Unsplash's image host (urls.raw with w/fit/q/fm added, the ixid stays) and
// shows the photographer. In between, and when the hourly limit is used up, a photo shown before is shown again; the last 30 are kept
// (addresses and photographers only, no picture).
// API (loopback, our apps): GET /api/wallpapers/status, GET /api/wallpapers/list, GET /api/wallpapers/photo/<u|i>/<id>,
// POST /api/wallpapers/set {size}, POST /api/wallpapers/pair, POST /api/wallpapers/sync, POST /api/wallpapers/remove-uploads,
// POST /api/wallpapers/disconnect (Immich), POST /api/wallpapers/unsplash-set {on}, POST /api/wallpapers/unsplash-use {id}
// (-> {ok, url, name}), GET /api/wallpapers/push, POST /api/wallpapers/unsplash-disconnect.
// The phone page (POST pair) is a short-lived server on the LAN, port 8791, that needs the code shown on the TV; its API is under
// /api/ on that port.
const fs = require('fs'),
  http = require('http'),
  path = require('path'),
  crypto = require('crypto');
const P = require('./paths'),
  web = require('./web'),
  i18n = require('./i18n'),
  fetch = require('./fetch'),
  nc = require('./netcompat');

const DIR = P.D + '/wallpapers',
  UP = DIR + '/upload',
  IM = DIR + '/immich',
  INDEX = DIR + '/index.json';
const LIMITS = { uploads: 100, immich: 300, bytes: 150 * 1024 * 1024, file: 12 * 1024 * 1024 };
const PAIR_PORT = 8791, // after the Share-log page's range (8768-8790)
  PAIR_MS = 15 * 60 * 1000,
  SYNC_MS = 6 * 3600 * 1000;
const ID = /^[a-f0-9]{16}$/,
  ASSET = /^[0-9a-f-]{36}$/i;
const unsplashBase = () => process.env.CYTV_UNSPLASH_URL || 'https://api.unsplash.com', // overridden only by the tests
  UNSPLASH_APP = 'CleanYourTV', // the utm_source of every link back to Unsplash
  UNSPLASH_WAIT_MS = 61 * 60 * 1000, // the hourly limit is counted in hours
  WALLPAPERS_TOPIC = 'bo8jQKTaE0Y'; // the id of Unsplash's Wallpapers topic (/photos/random takes topic ids)
const UKEY = /^[A-Za-z0-9_-]{20,100}$/, // an Access Key; also keeps anything else out of the Authorization header
  UPHOTO = /^[A-Za-z0-9_-]{6,20}$/,
  UUSER = /^[A-Za-z0-9._-]{1,50}$/;

// what a file is, from its first bytes: only JPEG, PNG and WebP are kept
function imageType(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function create(ctx) {
  const config = ctx.config;
  const cfg = () => Object.assign({ size: '4k' }, config.get().wallpapers || {});
  const icfg = () => Object.assign({ url: '', key: '', albums: [], hidden: [] }, cfg().immich || {});
  const ucfg = () => Object.assign({ key: '', query: '', on: true }, cfg().unsplash || {});
  const setCfg = fn =>
    config.update('wallpapers', c => {
      c.wallpapers = Object.assign({}, c.wallpapers || {}); // the size is written only when it is chosen
      fn(c.wallpapers);
    });

  // ---- the index of the files ----
  let index = null;
  function idx() {
    if (index) return index;
    try {
      index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    } catch (_) {
      index = {};
    }
    index.upload = Array.isArray(index.upload) ? index.upload : [];
    index.immich = index.immich && typeof index.immich === 'object' ? index.immich : {};
    index.seen = Array.isArray(index.seen) ? index.seen : [];
    index.sync = index.sync || { state: 'idle', at: 0, error: '', ok: 0 };
    index.usync = index.usync || { error: '', ok: 0, wait: 0, remaining: null, remainingAt: 0 };
    return index;
  }
  function saveIdx() {
    nc.mkdirp(DIR);
    fs.writeFileSync(INDEX + '.tmp', JSON.stringify(idx()));
    fs.renameSync(INDEX + '.tmp', INDEX);
  }
  const immichList = () => {
    const i = idx().immich,
      hid = icfg().hidden;
    return Object.keys(i).filter(id => hid.indexOf(id) < 0);
  };
  // live mode: Home's one "s/live" entry stands for a new photo from Unsplash; shown only while that source is on
  const liveOn = () => !!ucfg().key && ucfg().on;
  const usedBytes = () =>
    idx().upload.reduce((n, u) => n + (u.bytes || 0), 0) + Object.keys(idx().immich).reduce((n, k) => n + (idx().immich[k].bytes || 0), 0);
  // your photos are for root only, as the settings are
  const mkdir = d => {
    nc.mkdirp(d);
    try {
      fs.chmodSync(DIR, 0o700);
    } catch (_) {}
  };
  const unlink = f => {
    try {
      fs.unlinkSync(f);
    } catch (_) {}
  };

  // ---- uploads ----
  function addUpload(buf) {
    const type = imageType(buf);
    if (!type) return 'not a JPEG, PNG or WebP picture';
    if (buf.length > LIMITS.file) return 'the picture is larger than 12 MB';
    if (idx().upload.length >= LIMITS.uploads) return 'there are ' + LIMITS.uploads + ' uploads already: remove some first';
    if (usedBytes() + buf.length > LIMITS.bytes) return 'Wallpapers is full (150 MB): remove some photos first';
    mkdir(UP);
    const id = crypto.randomBytes(8).toString('hex'),
      file = id + '.' + type;
    fs.writeFileSync(path.join(UP, file + '.tmp'), buf, { mode: 0o600 });
    fs.renameSync(path.join(UP, file + '.tmp'), path.join(UP, file));
    idx().upload.push({ id, file, bytes: buf.length, at: Date.now() });
    saveIdx();
    return '';
  }
  function removeUpload(id) {
    const u = idx().upload.filter(x => x.id === id)[0];
    if (!u) return false;
    unlink(path.join(UP, u.file));
    idx().upload = idx().upload.filter(x => x.id !== id);
    saveIdx();
    return true;
  }
  function removeUploads() {
    for (const u of idx().upload) unlink(path.join(UP, u.file));
    idx().upload = [];
    saveIdx();
  }

  // ---- Immich (https://immich.app/docs/api): the key goes in the x-api-key header ----
  const base = u =>
    String(u || '')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/api$/, '');
  function immich(pathname, ic, opts) {
    const c = ic || icfg();
    return fetch
      .read(
        base(c.url) + '/api' + pathname,
        Object.assign(
          { headers: { 'x-api-key': c.key, Accept: 'application/json' }, idleMs: 20000, maxBytes: 16 << 20, anyStatus: true },
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
  async function albums(ic) {
    const own = await immich('/albums', ic),
      shared = await immich('/albums?shared=true', ic).catch(() => []);
    const seen = {};
    return own
      .concat(shared)
      .filter(a => a && a.id && !seen[a.id] && (seen[a.id] = 1))
      .map(a => ({ id: a.id, name: String(a.albumName || 'Album').slice(0, 80), count: a.assetCount || 0 }));
  }
  async function connect(url, key) {
    const c = { url: base(url), key: key || icfg().key };
    if (!/^https?:\/\/[^/]+/i.test(c.url)) return { error: 'the address must start with http:// or https://' };
    if (!c.key) return { error: 'enter the API key' };
    try {
      const list = await albums(c);
      setCfg(w => {
        const old = Object.assign({ albums: [], hidden: [] }, w.immich || {});
        w.immich = { url: c.url, key: c.key, albums: old.url === c.url ? old.albums : [], hidden: old.url === c.url ? old.hidden : [] };
      });
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
    const ic = icfg(),
      tmp = path.join(IM, id + '.tmp'),
      hdrs = { 'x-api-key': ic.key };
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
        const r = await fetch.read(base(ic.url) + '/api' + t, { headers: hdrs, idleMs: 30000, maxBytes: LIMITS.file, anyStatus: true });
        if (r.status !== 200) throw new Error('Immich answered ' + r.status);
        const type = imageType(r.body);
        if (!type) throw new Error('not a picture the TV can show');
        fs.writeFileSync(tmp, r.body, { mode: 0o600 });
        const file = id + '.' + type;
        fs.renameSync(tmp, path.join(IM, file));
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
        headers: { 'x-api-key': icfg().key, Accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ albumIds: [id], type: 'IMAGE', size: 250, page }),
      });
      const items = (r.assets && r.assets.items) || [];
      out = out.concat(items);
      page = r.assets && r.assets.nextPage ? +r.assets.nextPage : 0;
      if (out.length >= LIMITS.immich * 2) break;
    }
    return out;
  }
  async function doSync() {
    await doImmich();
  }
  async function doImmich() {
    const ic = icfg(),
      st = idx().sync;
    if (!ic.url || !ic.key) return;
    st.state = 'syncing';
    st.error = '';
    st.done = 0;
    try {
      mkdir(IM);
      // the albums' photos, newest first, without videos or trashed ones (hidden ones stay on the TV, so they can be shown again)
      const want = [],
        seen = {};
      for (const a of ic.albums) {
        for (const x of await albumAssets(a))
          if (x && ASSET.test(x.id) && x.type === 'IMAGE' && !x.isTrashed && x.visibility !== 'hidden' && !seen[x.id]) {
            seen[x.id] = 1;
            want.push({ id: x.id, sum: x.checksum || '', mime: x.originalMimeType || '', at: Date.parse(x.fileCreatedAt || '') || 0 });
          }
      }
      want.sort((a, b) => b.at - a.at);
      if (!want.length && ic.albums.length) st.error = 'the chosen albums have no photos the TV can show';
      const keep = want.slice(0, LIMITS.immich),
        keepIds = {};
      keep.forEach(w => (keepIds[w.id] = 1));
      // first the ones no longer wanted, so their space is free for the new ones
      const cur = idx().immich;
      for (const id of Object.keys(cur))
        if (!keepIds[id]) {
          unlink(path.join(IM, cur[id].file));
          delete cur[id];
        }
      saveIdx();
      const size = cfg().size === 'hd' ? 'hd' : '4k';
      let full = false,
        failed = 0;
      for (const w of keep) {
        const have = cur[w.id];
        if (have && have.sum === w.sum && have.size === size && fs.existsSync(path.join(IM, have.file))) continue;
        if (usedBytes() > LIMITS.bytes - 2 * 1024 * 1024) {
          full = true;
          break;
        }
        try {
          const d = await download(w.id, w.mime, size);
          if (have && have.file !== d.file) unlink(path.join(IM, have.file));
          cur[w.id] = { file: d.file, bytes: d.bytes, sum: w.sum, size };
          st.done++;
          if (st.done % 10 === 0) saveIdx();
        } catch (e) {
          failed++;
          if (failed >= 5 && !st.done) throw e; // Immich is down or the key lost a permission: stop, keep what is there
        }
      }
      st.ok = Date.now();
      if (full) st.error = 'Wallpapers is full (150 MB): not every photo was downloaded';
      else if (failed) st.error = failed + ' photos could not be downloaded';
    } catch (e) {
      st.error = String(e.message || e);
    }
    st.state = 'idle';
    st.at = Date.now();
    saveIdx();
  }
  function disconnect() {
    for (const id of Object.keys(idx().immich)) unlink(path.join(IM, idx().immich[id].file));
    idx().immich = {};
    idx().sync = { state: 'idle', at: 0, error: '', ok: 0 };
    saveIdx();
    setCfg(w => {
      delete w.immich;
    });
  }

  // ---- Unsplash (https://unsplash.com/documentation): the Access Key goes in the Authorization header, to api.unsplash.com only ----
  // Nothing is listed or stored: each new photo is one random photo asked of Unsplash (unsplashNew).
  const limited = () => {
    const e = /** @type {Error & {limited?: boolean}} */ (
      new Error("Unsplash's hourly limit is used up (a new key may make 50 requests an hour): new photos come again in an hour")
    );
    e.limited = true;
    return e;
  };
  // one API request; never follows a redirect (the key would go along), and reads the hourly allowance from the reply
  function unsplashApi(pathname, key) {
    return fetch
      .read(unsplashBase() + pathname, {
        headers: { Authorization: 'Client-ID ' + key, 'Accept-Version': 'v1', Accept: 'application/json' },
        idleMs: 20000,
        totalMs: 60000,
        maxBytes: 4 << 20,
        redirects: 0,
        anyStatus: true,
      })
      .then(r => {
        const left = parseInt(r.headers['x-ratelimit-remaining'], 10);
        idx().usync.remaining = isNaN(left) ? null : left;
        idx().usync.remainingAt = Date.now();
        const text = r.body.toString('utf8', 0, 2000);
        if (r.status === 401) throw new Error('Unsplash refused the Access Key');
        if (r.status === 429 || (r.status === 403 && /rate limit/i.test(text))) throw limited();
        if (r.status === 403) throw new Error('Unsplash refused the request (the key may lack public access)');
        if (r.status !== 200) throw new Error('Unsplash answered ' + r.status);
        return JSON.parse(r.body.toString('utf8'));
      });
  }
  // a picture address is used only when it is on Unsplash's own image host and has no character that could break out of an attribute
  const pictureUrl = u =>
    typeof u === 'string' &&
    /^[A-Za-z0-9_\-./?=&%:~,+]+$/.test(u) &&
    (/^https:\/\/[a-z0-9.-]+\.unsplash\.com\//.test(u) ||
      (!!process.env.CYTV_UNSPLASH_URL && u.indexOf(process.env.CYTV_UNSPLASH_URL + '/') === 0));
  // the picture at the Picture size: urls.raw with w, fit, q and fm added (the ixid in it stays)
  const sized = (raw, size) => raw + (raw.indexOf('?') < 0 ? '?' : '&') + 'w=' + (size === 'hd' ? 1920 : 3840) + '&fit=max&q=80&fm=jpg';
  // what is kept of one photo in an Unsplash reply: a landscape photo with a picture address on Unsplash, else null
  function unsplashEntry(x) {
    const raw = x && x.urls && x.urls.raw,
      user = (x && x.user) || {};
    if (!x || !UPHOTO.test(String(x.id)) || !pictureUrl(raw) || !(x.width > x.height)) return null;
    const dl = /^https:\/\/api\.unsplash\.com(\/photos\/[A-Za-z0-9_-]+\/download(?:\?[A-Za-z0-9_=&.%-]*)?)$/.exec(
      String((x.links && x.links.download_location) || '')
    );
    return {
      raw,
      thumb: pictureUrl(x.urls.small) ? x.urls.small : '',
      dl: dl ? dl[1] : '/photos/' + x.id + '/download', // a reply may leave links.download_location out: the same endpoint
      name: String(user.name || '').slice(0, 80),
      user: UUSER.test(user.username || '') ? user.username : '',
      id: x.id,
    };
  }
  // one random landscape photo for what the settings ask for (a search, or the Wallpapers topic)
  async function unsplashRandom(uc) {
    const o = '/photos/random?orientation=landscape&content_filter=high';
    let r;
    if (uc.query) r = await unsplashApi(o + '&query=' + encodeURIComponent(uc.query), uc.key);
    else {
      try {
        r = await unsplashApi(o + '&topics=' + WALLPAPERS_TOPIC, uc.key);
      } catch (e) {
        if (e.limited || /^Unsplash refused/.test(e.message)) throw e;
        r = await unsplashApi(o, uc.key); // the topic is not known to Unsplash after all: any random landscape photo
      }
    }
    const e = unsplashEntry(Array.isArray(r) ? r[0] : r);
    if (!e) throw new Error('Unsplash has no landscape photo for that search');
    return e;
  }
  // the photos shown so far (the last 30: ids, picture addresses, photographers; no pictures): when a new one may not be asked
  // for, one of these is shown again. Kept in index.json so a restart does not lose them.
  const SEEN_MAX = 30,
    LIVE_GAP_MS = 3 * 60 * 1000, // a new photo is asked of Unsplash at most every 3 minutes (2 requests each: 40 an hour of the 50 a new key has)
    RETRY_MS = 30 * 1000; // a failed request is not a photo: try again after 30 s, not after the 3 minutes
  const seen = () => idx().seen;
  let busy = false,
    lastLive = 0,
    lastShown = '';
  // a photo shown before, other than the one on screen when there is a choice; null when none was shown yet
  function replay() {
    const l = seen(),
      pool = l.length > 1 ? l.filter(p => p.id !== lastShown) : l;
    if (!pool.length) return null;
    const p = pool[Math.floor(Math.random() * pool.length)];
    lastShown = p.id;
    return { ok: true, url: sized(p.raw, cfg().size), name: p.name, again: true };
  }
  // Home is about to show the Unsplash entry (id "live"): a new photo when one may be asked for, else one shown before; {ok: false} when
  // there is none yet and nothing can be asked now (Home then keeps what it shows)
  async function unsplashUse(id) {
    const uc = ucfg();
    if (!uc.key || !uc.on || id !== 'live') return { ok: false };
    const r = await unsplashNew(uc, false);
    return r.ok ? { ok: true, url: r.url, name: r.name } : replay() || { ok: false };
  }
  // one new random photo, two requests. Not within 3 minutes of the last one (unless force: the phone page's Test key and save), not
  // during the pause for the limit, not when the replies say the hour's allowance is nearly used up; {ok: false, note} then
  async function unsplashNew(uc, force) {
    const st = idx().usync;
    if (!uc.key || !uc.on) return { ok: false, note: 'Unsplash is off' };
    if (busy) return { ok: false, note: 'a photo is being fetched' };
    if (st.wait > Date.now() || (st.remaining !== null && st.remaining <= 2 && Date.now() - st.remainingAt < 3600 * 1000))
      return { ok: false, note: st.error || limited().message };
    if (!force && Date.now() - lastLive < LIVE_GAP_MS) return { ok: false };
    busy = true;
    try {
      const p = await unsplashRandom(uc);
      await unsplashApi(p.dl, uc.key);
      lastLive = Date.now(); // a photo that was really fetched: the next one is 3 minutes away
      st.error = '';
      st.ok = Date.now();
      const l = seen().filter(x => x.id !== p.id);
      l.unshift({ id: p.id, raw: p.raw, thumb: p.thumb, name: p.name, user: p.user });
      idx().seen = l.slice(0, SEEN_MAX);
      lastShown = p.id;
      saveIdx();
      return {
        ok: true,
        url: sized(p.raw, cfg().size),
        name: p.name,
        photo: { name: p.name, link: p.user ? profile(p.user) : '', thumb: p.thumb },
      };
    } catch (e) {
      st.error = String(e.message || e);
      if (e.limited) {
        st.wait = Date.now() + UNSPLASH_WAIT_MS;
      } else lastLive = Date.now() - LIVE_GAP_MS + RETRY_MS; // no photo was fetched: the next try may come after 30 s
      saveIdx();
      return { ok: false, note: st.error };
    } finally {
      busy = false;
    }
  }
  // the photo the phone page's Test key and save just fetched: Home asks for it now and then (GET /api/wallpapers/push) and shows it at once
  let push = { seq: 0, url: '', name: '' };
  async function unsplashSave(b) {
    const old = ucfg(),
      key = String(b.key || '').trim() || old.key,
      query = String(b.query || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 100);
    if (!key) return { error: 'enter the Access Key' };
    if (!UKEY.test(key)) return { error: 'that does not look like an Unsplash Access Key' };
    if (key !== old.key) {
      try {
        await unsplashApi('/photos?per_page=1', key); // one request: the key is valid and may use the API
      } catch (e) {
        return { error: String(e.message || e) };
      }
    }
    setCfg(w => {
      w.unsplash = { key, query, on: old.key ? old.on : true };
    });
    if (key !== old.key) {
      idx().usync.wait = 0;
      saveIdx();
    }
    if (b.photo === false) return { ok: true };
    // Test key and save fetches a photo now (2 requests), shows it on Home and lists it, so a change of the settings can be seen
    const r = await unsplashNew(ucfg(), true);
    if (!r.ok) return { ok: true, note: r.note };
    push = { seq: push.seq + 1, url: r.url, name: r.name };
    return { ok: true, photo: r.photo };
  }
  function unsplashOn(on) {
    if (!ucfg().key) return;
    setCfg(w => {
      w.unsplash = Object.assign({}, w.unsplash, { on: !!on });
    });
  }
  function unsplashDisconnect() {
    idx().seen = [];
    lastShown = '';
    lastLive = 0;
    idx().usync = { error: '', ok: 0, wait: 0, remaining: null, remainingAt: 0 };
    saveIdx();
    setCfg(w => {
      delete w.unsplash;
    });
  }
  // the photographers, for the phone page and for Home's credit: "Photo by NAME on Unsplash", linked back with the utm parameters
  const profile = user => 'https://unsplash.com/@' + user + '?utm_source=' + UNSPLASH_APP + '&utm_medium=referral';
  const unsplashCredits = () =>
    (liveOn() ? seen() : []).map(p => ({ id: p.id, name: p.name, link: p.user ? profile(p.user) : '', thumb: p.thumb || '' }));

  // ---- what the TV shows ----
  function list() {
    return idx()
      .upload.map(u => 'u/' + u.id)
      .concat(immichList().map(id => 'i/' + id))
      .concat(liveOn() ? ['s/live'] : []); // one entry that stands for "a new photo from Unsplash"
  }
  // a number that changes whenever the set of photos changes: the launcher reads the list again then
  const stamp = () => {
    const l = list();
    return l.length + ':' + crypto.createHash('md5').update(l.join(',')).digest('hex').slice(0, 8);
  };
  function status() {
    const ic = icfg(),
      uc = ucfg(),
      s = idx().sync,
      us = idx().usync;
    return {
      size: cfg().size === 'hd' ? 'hd' : '4k',
      uploads: idx().upload.length,
      immich: {
        configured: !!(ic.url && ic.key),
        url: ic.url,
        keyHint: ic.key ? '…' + ic.key.slice(-4) : '',
        albums: ic.albums.length,
        photos: immichList().length,
        hidden: ic.hidden.length,
        state: s.state,
        lastSync: s.ok || 0,
        tried: s.at || 0,
        error: s.error || '',
        done: s.done || 0,
      },
      unsplash: {
        configured: !!uc.key,
        keyHint: uc.key ? '…' + uc.key.slice(-4) : '',
        on: !!uc.key && uc.on,
        query: uc.query,
        shown: seen().length,
        lastPhoto: us.ok || 0,
        error: us.error || '',
        pausedUntil: us.wait > Date.now() ? us.wait : 0,
        remaining: typeof us.remaining === 'number' ? us.remaining : null,
      },
      total: list().length,
      bytes: usedBytes(),
      limits: LIMITS,
      pair: pair ? { url: pair.url, code: pair.code, until: pair.until } : null,
    };
  }
  function photoFile(src, id) {
    if (src === 'u' && ID.test(id)) {
      const u = idx().upload.filter(x => x.id === id)[0];
      return u ? path.join(UP, u.file) : '';
    }
    if (src === 'i' && ASSET.test(id) && idx().immich[id]) return path.join(IM, idx().immich[id].file);
    return '';
  }
  function sendPhoto(res, src, id, cache) {
    const f = photoFile(src, id);
    if (!f || !fs.existsSync(f)) return web.notFound(res);
    res.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'image/jpeg', 'cache-control': cache || 'max-age=86400' });
    fs.createReadStream(f).pipe(res);
  }

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function startPair() {
    stopPair();
    const code = String(nc.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => phone(req, res, code, () => ++bad));
    pair = { code, srv, url: 'http://' + web.lanIp() + ':' + PAIR_PORT, until: Date.now() + PAIR_MS, timer: setTimeout(stopPair, PAIR_MS) };
    const out = { url: pair.url, code, qr: pair.url + '/#' + code, seconds: PAIR_MS / 1000 };
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve(out));
    });
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, pair.until - Date.now());
  }
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  function rawBody(req, max) {
    return new Promise((resolve, reject) => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > max) {
          reject(new Error('the picture is larger than 12 MB'));
          req.destroy();
        } else b.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(b)));
      req.on('error', reject);
    });
  }
  async function phone(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phonePage(i18n.lang(req, config.get().lang)));
    }
    if (u.indexOf('/api/') !== 0) return web.notFound(res);
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    try {
      if (u === '/api/state') return json(Object.assign(status(), { pair: null, uploadsList: idx().upload.map(x => x.id) }));
      let m = /^\/api\/photo\/([ui])\/([0-9a-f-]{16,36})$/i.exec(u);
      if (m && req.method === 'GET') return sendPhoto(res, m[1], m[2], 'private, max-age=3600');
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      if (u === '/api/upload') {
        const err = addUpload(await rawBody(req, LIMITS.file));
        return json(err ? { error: err } : { ok: true, uploads: idx().upload.length }, err ? 400 : 200);
      }
      const b = await web.body(req, 16384);
      if (u === '/api/upload/delete') return json({ ok: removeUpload(String(b.id || '')) });
      if (u === '/api/immich/connect') return json(await connect(String(b.url || ''), String(b.key || '')));
      if (u === '/api/immich/albums') {
        if (Array.isArray(b.ids)) {
          const ids = b.ids.filter(x => typeof x === 'string' && ASSET.test(x)).slice(0, 50);
          setCfg(w => {
            w.immich = Object.assign({}, w.immich, { albums: ids });
          });
          sync();
          return json({ ok: true });
        }
        const sel = icfg().albums;
        return json({ albums: (await albums()).map(a => Object.assign(a, { on: sel.indexOf(a.id) >= 0 })) });
      }
      if (u === '/api/immich/sync') {
        sync();
        return json({ ok: true });
      }
      if (u === '/api/immich/photos') {
        const hid = icfg().hidden;
        return json({ photos: Object.keys(idx().immich).map(id => ({ id, hidden: hid.indexOf(id) >= 0 })) });
      }
      if (u === '/api/immich/hide') {
        const id = String(b.id || '');
        if (!ASSET.test(id)) return json({ error: 'bad id' }, 400);
        setCfg(w => {
          const ic = Object.assign({ hidden: [] }, w.immich);
          ic.hidden = ic.hidden.filter(x => x !== id);
          if (b.hidden) ic.hidden.push(id);
          w.immich = ic;
        });
        return json({ ok: true });
      }
      if (u === '/api/immich/disconnect') {
        disconnect();
        return json({ ok: true });
      }
      if (u === '/api/unsplash/save') {
        const r = await unsplashSave(b);
        return json(r, r.error ? 400 : 200);
      }
      if (u === '/api/unsplash/on') {
        unsplashOn(b.on === true);
        return json({ ok: true });
      }
      if (u === '/api/unsplash/credits') return json({ photos: unsplashCredits() });
      if (u === '/api/unsplash/disconnect') {
        unsplashDisconnect();
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }

  // ---- the service's API ----
  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    const m = /^\/api\/wallpapers\/photo\/([ui])\/([0-9a-f-]{16,36})$/i.exec(u);
    if (m) return sendPhoto(res, m[1], m[2]);
    if (u === '/api/wallpapers/status') return json(status());
    if (u === '/api/wallpapers/push') return json(liveOn() ? push : { seq: 0, url: '', name: '' });
    if (u === '/api/wallpapers/list') {
      return json({ photos: list(), stamp: stamp() });
    }
    if (req.method !== 'POST') return web.notFound(res);
    const b = await body(req);
    if (u === '/api/wallpapers/set') {
      if (b.size === '4k' || b.size === 'hd')
        setCfg(w => {
          w.size = b.size;
        });
      return json(status());
    }
    if (u === '/api/wallpapers/pair') return json(b.stop ? (stopPair(), {}) : await startPair());
    if (u === '/api/wallpapers/sync') {
      sync();
      return json(status());
    }
    if (u === '/api/wallpapers/remove-uploads') {
      removeUploads();
      return json(status());
    }
    if (u === '/api/wallpapers/disconnect') {
      disconnect();
      return json(status());
    }
    if (u === '/api/wallpapers/unsplash-use') return json(await unsplashUse(String(b.id || '')));
    if (u === '/api/wallpapers/unsplash-set') {
      unsplashOn(b.on === true);
      return json(status());
    }
    if (u === '/api/wallpapers/unsplash-disconnect') {
      unsplashDisconnect();
      return json(status());
    }
    return web.notFound(res);
  }

  // the automatic sync: every six hours; shortly after a start only when the last one is more than a day old
  function start() {
    if (idx().sync.state === 'syncing') idx().sync.state = 'idle'; // a sync the last run did not finish
    const t = setInterval(() => sync(), SYNC_MS);
    if (t.unref) t.unref();
    const stale = ok => Date.now() - (ok || 0) > 24 * 3600 * 1000;
    if (stale(idx().sync.ok)) {
      const t2 = setTimeout(() => sync(), 15 * 60 * 1000);
      if (t2.unref) t2.unref();
    }
  }

  return { name: 'wallpapers', prefix: '/api/wallpapers/', handle, start, status, stamp, sync, addUpload, list, phone };
}

// the phone page: three actions, Upload photos, Configure Immich and Configure Unsplash. Plain script for iOS Safari and Android Chrome; photos are scaled in
// the browser (to 3840 or 1920 pixels on the long side) before they are sent, which also turns an iPhone's HEIC into JPEG. It is in the
// phone's language: the fixed text is translated here, the script's own texts by t() with the translations it uses (i18n.js).
const PHONE_JS = `var code='',S={},MAX=3840,UF=0,LP=-1,$=function(i){return document.getElementById(i)};
/* a text with its %s / %d filled in, in order, then in the page's language (a template's plural form follows the number) */
function fm(s){var a=arguments,n=1;return t(s.replace(/%[sd]/g,function(){return a[n++]}))}
function api(p,b,ct){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 if(ct)x.setRequestHeader('content-type',ct);x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:(ct?b:JSON.stringify(b)))})}
function msg(t,e){$('msg').innerHTML=t?'<p class="m'+(e?' e':'')+'"></p>':'';if(t)$('msg').firstChild.textContent=t}
function showLogin(t){$('login').className='';$('main').className='hide';$('sum').textContent=t||''}
function ago(x){if(!x)return t('never');var m=Math.round((Date.now()-x)/60000);return m<1?t('just now'):m<60?fm('%d min ago',m):m<1440?fm('%d h ago',Math.round(m/60)):fm('%d days ago',Math.round(m/1440))}
function state(){return api('state').then(function(s){S=s;MAX=s.size==='hd'?1920:3840;$('login').className='hide';$('main').className='';
 $('sum').textContent=fm('Local uploads: %d · Immich: %d · Total: %d photos (%d of 150 MB)',s.uploads,s.immich.photos,s.uploads+s.immich.photos,Math.round(s.bytes/1048576));
 $('un').textContent=fm('%d of %d',s.uploads,s.limits.uploads);var g='';(s.uploadsList||[]).forEach(function(id){g+='<div class=ph><img loading=lazy src="" data-s="u/'+id+'"><button data-d="'+id+'">×</button></div>'});$('ug').innerHTML=g;thumbs($('ug'));
 var i=s.immich;$('iu').value=$('iu').value||i.url;$('ik').placeholder=i.keyHint?fm('API key (saved: %s; leave empty to keep)',i.keyHint):t('API key');
 $('ist').innerHTML='';var p=document.createElement('p');p.textContent=i.configured?(i.state==='syncing'?fm('Syncing… %d new',i.done):fm('Last sync: %s',ago(i.lastSync))+' · '+fm('%d photos from %d albums',i.photos,i.albums))+(i.error?' · '+t(i.error):''):t('Not connected.');$('ist').appendChild(p);
 $('isy').className=$('idc').className=i.configured?'':'hide';
 var u=s.unsplash;
 $('sk').placeholder=u.keyHint?fm('Access Key (saved: %s; leave empty to keep)',u.keyHint):t('Access Key');
 if(!UF){UF=1;$('sq').value=u.query}
 $('sst').innerHTML='';var q=document.createElement('p');q.textContent=u.configured?t('Live: a new photo from Unsplash at most every 3 minutes.')+(u.error?' · '+t(u.error):'')+(u.pausedUntil?' · '+fm('paused until %s',new Date(u.pausedUntil).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})):''):t('Not set up.');$('sst').appendChild(q);
 $('sd').className=$('so').className=u.configured?'':'hide';$('so').textContent=u.on?t('Turn Unsplash off'):t('Turn Unsplash on');
 if($('sp').className===''&&u.shown!==LP){LP=u.shown;loadUnsplash()}
 if(i.state==='syncing')setTimeout(state,3000)})}
function thumbs(el){[].forEach.call(el.querySelectorAll('img[data-s]'),function(im){var x=new XMLHttpRequest();x.open('GET','/api/photo/'+im.getAttribute('data-s'));x.setRequestHeader('x-code',code);x.responseType='blob';
 x.onload=function(){if(x.status===200)im.src=URL.createObjectURL(x.response)};x.send()})}
/* scale in the browser: the long side to MAX pixels, JPEG; a file the browser cannot draw is sent as it is when it is small enough */
function scaled(file){return new Promise(function(ok){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var w=im.naturalWidth,h=im.naturalHeight,k=Math.min(1,MAX/Math.max(w,h));
 var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(function(b){ok(b||file)},'image/jpeg',0.9)};
 im.onerror=function(){URL.revokeObjectURL(u);ok(file)};im.src=u})}
function upload(files){var list=[].slice.call(files),n=0,okN=0,errs=[];$('prog').className='';msg('');
 (function next(){if(n>=list.length){$('prog').className='hide';msg(fm('%d of %d photos uploaded.',okN,list.length)+(errs.length?' '+errs[0]:''),!!errs.length&&!okN);state();return}
  var f=list[n];$('pt').textContent=fm('Photo %d of %d · preparing',n+1,list.length);$('pb').style.width=Math.round(n/list.length*100)+'%';
  scaled(f).then(function(b){var x=new XMLHttpRequest();x.open('POST','/api/upload');x.setRequestHeader('x-code',code);x.setRequestHeader('content-type',b.type||'application/octet-stream');
   x.upload.onprogress=function(e){if(e.lengthComputable)$('pb').style.width=Math.round((n+e.loaded/e.total)/list.length*100)+'%';$('pt').textContent=fm('Photo %d of %d · sending',n+1,list.length)};
   x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===200)okN++;else errs.push((f.name||t('A photo'))+': '+t(j.error||'refused'));n++;next()};
   x.onerror=function(){errs.push(t('The TV did not answer.'));n++;next()};x.send(b)})})()}
$('f').onchange=function(){if(this.files.length)upload(this.files);this.value=''};
$('ug').onclick=function(e){var d=e.target.getAttribute('data-d');if(d)api('upload/delete',{id:d}).then(state)};
function tab(w){[['tu','up'],['ti','im'],['ts','sp']].forEach(function(p){$(p[0]).className=p[0]===w?'on':'';$(p[1]).className=p[0]===w?'':'hide'})}
$('tu').onclick=function(){tab('tu')};
$('ti').onclick=function(){tab('ti');if(S.immich&&S.immich.configured){loadAlbums();loadPhotos()}};
$('ts').onclick=function(){tab('ts');LP=-1;if(S.unsplash&&S.unsplash.configured)loadUnsplash()};
/* the synced photos, each with its credit under it: "Photo by NAME on Unsplash", NAME linked to the photographer's page and Unsplash to
   unsplash.com, both with the utm parameters (Unsplash's attribution rule) */
function link(txt,href){if(!href)return document.createTextNode(txt);var e=document.createElement('a');e.href=href;e.target='_blank';e.rel='noopener';e.textContent=txt;return e}
function loadUnsplash(){api('unsplash/credits',{}).then(function(r){var ps=r.photos||[],g=$('sg'),home='https://unsplash.com/?utm_source=CleanYourTV&utm_medium=referral';$('sph').className=ps.length?'':'hide';g.innerHTML='';
 ps.forEach(function(p){var c=document.createElement('div'),d=document.createElement('div'),k=document.createElement('div'),pre=t('Photo by %s on Unsplash').split('%s'),post=(pre[1]||'').split('Unsplash');c.className='uc';d.className='ph';
  if(p.thumb){var m=document.createElement('img');m.loading='lazy';m.src=p.thumb;d.appendChild(m)}
  c.appendChild(d);k.className='cap';k.appendChild(document.createTextNode(pre[0]));k.appendChild(link(p.name||'?',p.link));k.appendChild(document.createTextNode(post[0]));k.appendChild(link('Unsplash',home));if(post.length>1)k.appendChild(document.createTextNode(post.slice(1).join('Unsplash')));
  c.appendChild(k);g.appendChild(c)})})}
$('ss').onclick=function(){msg(t('Testing the key…'));api('unsplash/save',{key:$('sk').value,query:$('sq').value}).then(function(r){if(r.error)return msg(t(r.error),1);$('sk').value='';UF=0;msg(r.photo?fm('Saved. A new photo by %s is on the TV.',r.photo.name):r.note?t('Saved')+': '+t(r.note):t('Saved'));if(r.photo)loadUnsplash();setTimeout(state,1500)})};
$('so').onclick=function(){api('unsplash/on',{on:!(S.unsplash&&S.unsplash.on)}).then(function(){setTimeout(state,500)})};
$('sd').onclick=function(){if(confirm(t('Remove the Unsplash key from the TV?')))api('unsplash/disconnect',{}).then(function(){UF=0;LP=-1;$('sk').value=$('sq').value='';$('sph').className='hide';msg(t('Unsplash removed.'));state()})};
function loadAlbums(){api('immich/albums',{}).then(function(r){if(r.error)return msg(t(r.error),1);var h='';(r.albums||[]).forEach(function(a){h+='<label class=al><input type=checkbox value="'+a.id+'"'+(a.on?' checked':'')+'><span></span><small>'+a.count+'</small></label>'});
 $('al').innerHTML=h;var sp=$('al').querySelectorAll('span');(r.albums||[]).forEach(function(a,i){sp[i].textContent=a.name});$('albox').className=''},function(e){msg(e.error||t('Could not read the albums'),1)})}
function loadPhotos(){api('immich/photos',{}).then(function(r){var ps=r.photos||[];$('iphb').className=ps.length?'':'hide';var g='';ps.forEach(function(p){g+='<div class="ph'+(p.hidden?' off':'')+'" data-h="'+p.id+'"><img loading=lazy src="" data-s="i/'+p.id+'"></div>'});$('ipg').innerHTML=g;thumbs($('ipg'))})}
$('ipg').onclick=function(e){var t=e.target.closest('[data-h]');if(!t)return;var off=!/off/.test(t.className);api('immich/hide',{id:t.getAttribute('data-h'),hidden:off}).then(function(){t.className='ph'+(off?' off':'');state()})};
$('ic').onclick=function(){msg(t('Connecting…'));api('immich/connect',{url:$('iu').value,key:$('ik').value}).then(function(r){if(r.error)return msg(t(r.error),1);$('ik').value='';msg(t('Connected to Immich.'));state().then(loadAlbums)})};
$('as').onclick=function(){var ids=[].map.call($('al').querySelectorAll('input:checked'),function(i){return i.value});api('immich/albums',{ids:ids}).then(function(){msg(t('Albums saved. Syncing…'));setTimeout(state,1500);setTimeout(loadPhotos,8000)})};
$('isy').onclick=function(){api('immich/sync',{}).then(function(){msg(t('Syncing…'));setTimeout(state,1500)})};
$('idc').onclick=function(){if(confirm(t('Disconnect Immich? Its photos are removed from the TV.')))api('immich/disconnect',{}).then(function(){$('albox').className='hide';$('iphb').className='hide';msg(t('Immich disconnected.'));state()})};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;
function phonePage(lang) {
  const T = s => web.esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Wallpapers</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:28px 0 10px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input,select,label.b{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p,label.b{background:#f5f6f8;color:#111;font-weight:600;border:0}input{text-align:left}.row{display:flex;gap:10px}.row>*{flex:1}
.tabs{display:flex;gap:8px;margin:16px 0}.tabs button{margin:0;font-size:15px;padding:12px 4px}.tabs .on{background:#f5f6f8;color:#111}.hide{display:none}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.ph{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#222}
.ph img{width:100%;height:100%;object-fit:cover;display:block}.ph button{position:absolute;right:4px;top:4px;width:32px;height:32px;padding:0;margin:0;border-radius:16px;background:rgba(0,0,0,.7);border:0;color:#fff}
.ph.off img{opacity:.3}.al{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:#1a1b21;margin:6px 0}.al input{width:22px;height:22px;margin:0}
.bar{height:8px;border-radius:4px;background:#333;overflow:hidden;margin:8px 0}.bar i{display:block;height:100%;width:0;background:#f5f6f8}small{color:#888}a{color:#8ab4ff}.grid.u{grid-template-columns:repeat(2,1fr);gap:14px 10px}.cap{font-size:12px;line-height:1.4;margin-top:6px;color:#aaa}</style>
<h1>Wallpapers</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<div class=tabs><button id=tu class=on>${T('Upload photos')}</button><button id=ti>${T('Configure Immich')}</button><button id=ts>${T('Configure Unsplash')}</button></div>
<div id=msg></div>
<section id=up><label class=b for=f>${T('Choose photos')}</label><input id=f type=file accept="image/*" multiple class=hide>
<div id=prog class=hide><div class=bar><i id=pb></i></div><p id=pt></p></div>
<h2>${T('Uploaded')} <small id=un></small></h2><div class=grid id=ug></div></section>
<section id=im class=hide>
<p>${T('Use an API key from Immich (Account settings > API keys) with album.read and asset.read/view permissions.')}</p>
<input id=iu type=url placeholder="https://immich.example.com" autocomplete=off><input id=ik type=password placeholder="${T('API key')}" autocomplete=off>
<button class=p id=ic>${T('Test connection and save')}</button>
<div id=albox class=hide><h2>${T('Albums')}</h2><div id=al></div><button class=p id=as>${T('Save albums and sync')}</button></div>
<div id=ist></div>
<div id=iphb class=hide><h2>${T('Synced photos')} <small>${T('tap to hide or show one')}</small></h2><div class=grid id=ipg></div></div>
<button id=isy>${T('Sync now')}</button><button id=idc>${T('Disconnect Immich')}</button></section>
<section id=sp class=hide>
<p>${T('Get a free Access Key at unsplash.com/developers: create an application there and copy its Access Key. A new key may make 50 requests an hour.')}</p>
<p>${T('Photos come from the search words; with none, from the Wallpapers topic.')}</p>
<p>${T('Home asks Unsplash for one new random photo (2 requests) at most every 3 minutes, and the TV saves no picture. In between, and when the hourly limit is used up, photos shown before are shown again.')}</p>
<input id=sk type=password placeholder="${T('Access Key')}" autocomplete=off><input id=sq placeholder="${T('Search words, for example: mountains')}" autocomplete=off>
<button class=p id=ss>${T('Test key and save')}</button>
<div id=sst></div>
<div id=sph class=hide><h2>${T('Recent photos')}</h2><div class="grid u" id=sg></div></div>
<button id=so></button><button id=sd>${T('Remove Unsplash')}</button></section></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { create, imageType, LIMITS, PAIR_PORT };
