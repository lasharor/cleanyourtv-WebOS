// Unsplash as a photo source for Home's wallpapers (an add-on that provides "wallpapers", see helper/wallpapers.js). Live only: nothing is
// saved on the TV. When Home is about to show the Unsplash entry, this asks /photos/random (landscape, content filter high), reports the
// download (links.download_location, as Unsplash's guidelines ask) and hands Home the picture's address on Unsplash's image host (urls.raw
// with w, fit, q and fm added) and a credit line, "Photo by NAME on Unsplash". The picture request never carries the key.
//   - At most one new photo every 3 minutes (2 requests each: 40 of the 50 an hour a new key may make). In between, and when the hourly
//     limit is used up (a clear message, a pause of an hour), one of the last 30 photos shown is shown again. A request that fails is
//     tried again after 30 seconds, not after the 3 minutes.
//   - The Access Key goes only in "Authorization: Client-ID <key>" to api.unsplash.com, never follows a redirect, shows as its last four
//     characters at most and is not logged. It is this add-on's setting in config.json (addons.unsplash.settings: key, query, on).
//   - dataDir/index.json keeps the last 30 photos (ids, picture addresses, photographers; no picture) and the hourly allowance.
// The phone page (settings(): a short-lived server on the LAN, port 8796, needs the code shown on the TV) sets the key and the search words;
// "Test key and save" fetches a photo at once, which Home takes by its poll (push()) or with the next photo it asks for. The photo shown
// again is not reported to Unsplash a second time. Written from the Unsplash integration of the pull request that first added it to
// Wallpapers (Edenik, #132).
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const phone = require('./phone');

const unsplashBase = () => process.env.CYTV_UNSPLASH_URL || 'https://api.unsplash.com', // overridden only by the tests
  APP = 'CleanYourTV', // the utm_source of every link back to Unsplash
  WAIT_MS = 61 * 60 * 1000, // the hourly limit is counted in hours
  PUSH_MS = 10 * 60 * 1000, // a photo from Test key and save waits this long for Home to take it
  TOPIC = 'bo8jQKTaE0Y', // the id of Unsplash's Wallpapers topic (/photos/random takes topic ids)
  SEEN_MAX = 30,
  LIVE_GAP_MS = 3 * 60 * 1000, // a new photo is asked for at most every 3 minutes (2 requests each: 40 an hour of the 50 a new key has)
  RETRY_MS = 30 * 1000; // a failed request is not a photo: try again after 30 s, not after the 3 minutes
const PAIR_PORT = 8796, // after the Immich page (8795)
  PAIR_MS = 15 * 60 * 1000;
const UKEY = /^[A-Za-z0-9_-]{20,100}$/, // an Access Key; also keeps anything else out of the Authorization header
  UPHOTO = /^[A-Za-z0-9_-]{6,20}$/,
  UUSER = /^[A-Za-z0-9._-]{1,50}$/;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function create(ctx) {
  const fetch = ctx.fetch,
    util = ctx.util,
    INDEX = path.join(ctx.dataDir, 'index.json');
  const cfg = () => Object.assign({ key: '', query: '', on: true }, ctx.settings.get());
  const save = o => ctx.settings.set(o);
  const liveOn = () => !!cfg().key && cfg().on;

  // ---- what is kept: the last photos shown and the state of the allowance ----
  let index = null;
  function idx() {
    if (index) return index;
    try {
      index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    } catch (_) {
      index = {};
    }
    index.seen = Array.isArray(index.seen) ? index.seen : [];
    index.usync = index.usync || { error: '', ok: 0, wait: 0, remaining: null, remainingAt: 0 };
    return index;
  }
  function saveIdx() {
    util.mkdirp(ctx.dataDir);
    fs.writeFileSync(INDEX + '.tmp', JSON.stringify(idx()), { mode: 0o600 });
    fs.renameSync(INDEX + '.tmp', INDEX);
  }
  const seen = () => idx().seen;

  // ---- Unsplash (https://unsplash.com/documentation): the Access Key goes in the Authorization header, to api.unsplash.com only ----
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
  // a picture address is used only when it is on Unsplash's own image host and has no character that could break out of a CSS url()
  const pictureUrl = u =>
    typeof u === 'string' &&
    /^[A-Za-z0-9_\-./?=&%:~,+]+$/.test(u) &&
    (/^https:\/\/[a-z0-9.-]+\.unsplash\.com\//.test(u) ||
      (!!process.env.CYTV_UNSPLASH_URL && u.indexOf(process.env.CYTV_UNSPLASH_URL + '/') === 0));
  // the picture at the Picture size: urls.raw with w, fit, q and fm added (the ixid in it stays)
  const sized = raw =>
    raw + (raw.indexOf('?') < 0 ? '?' : '&') + 'w=' + (ctx.env.wallpaperSize() === 'hd' ? 1920 : 3840) + '&fit=max&q=80&fm=jpg';
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
        r = await unsplashApi(o + '&topics=' + TOPIC, uc.key);
      } catch (e) {
        if (e.limited || /^Unsplash refused/.test(e.message)) throw e;
        r = await unsplashApi(o, uc.key); // the topic is not known to Unsplash after all: any random landscape photo
      }
    }
    const e = unsplashEntry(Array.isArray(r) ? r[0] : r);
    if (!e) throw new Error('Unsplash has no landscape photo for that search');
    return e;
  }

  // the photographers, for the phone page and for Home's credit: "Photo by NAME on Unsplash", linked back with the utm parameters
  const profile = user => 'https://unsplash.com/@' + user + '?utm_source=' + APP + '&utm_medium=referral';
  const credits = () =>
    (liveOn() ? seen() : []).map(p => ({ id: p.id, name: p.name, link: p.user ? profile(p.user) : '', thumb: p.thumb || '' }));
  // the line Home shows in a corner, in the language of the screens (Unsplash's guidelines ask for it, so it is not switchable)
  const credit = name => util.i18n.tr(util.i18n.lang(null, ctx.env.lang()), 'Photo by ' + String(name || '?') + ' on Unsplash');

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
    return { url: sized(p.raw), name: p.name };
  }
  // the photo the phone page's Test key and save fetched: handed to Home once, by its poll (push) or by the next photo it asks for,
  // whichever comes first; after ten minutes it is dropped and the photos shown before go round again
  let pushed = { raw: '', name: '', at: 0, taken: true };
  function takePush() {
    if (!pushed.raw || pushed.taken || Date.now() - pushed.at > PUSH_MS) return null;
    pushed.taken = true;
    return { url: sized(pushed.raw), name: pushed.name };
  }
  // one new random photo, two requests. Not within 3 minutes of the last one (unless force: Test key and save), not during the pause for
  // the limit, not when the replies say the hour's allowance is nearly used up; {ok: false, note} then
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
        url: sized(p.raw),
        raw: p.raw,
        name: p.name,
        photo: { name: p.name, link: p.user ? profile(p.user) : '', thumb: p.thumb },
      };
    } catch (e) {
      st.error = String(e.message || e);
      if (e.limited) st.wait = Date.now() + WAIT_MS;
      else lastLive = Date.now() - LIVE_GAP_MS + RETRY_MS; // no photo was fetched: the next try may come after 30 s
      saveIdx();
      return { ok: false, note: st.error };
    } finally {
      busy = false;
    }
  }
  // Home is about to show the Unsplash entry: the photo the phone page just fetched, else a new one when one may be asked for, else one
  // shown before; an error when there is none yet and nothing can be asked now (Home then keeps what it shows)
  async function next() {
    const uc = cfg();
    if (!uc.key || !uc.on) return { error: 'Unsplash is off' };
    const p = takePush();
    if (p) return { url: p.url, credit: credit(p.name) };
    const r = await unsplashNew(uc, false);
    if (r.ok) return { url: r.url, credit: credit(r.name) };
    const again = replay();
    return again ? { url: again.url, credit: credit(again.name) } : { error: r.note || 'no photo yet' };
  }
  function push() {
    if (!liveOn()) return null;
    const p = takePush();
    return p ? { url: p.url, credit: credit(p.name) } : null;
  }
  // the phone page's Test key and save: the key is checked (one request) and saved, and a photo is fetched now (2 requests) for Home to show
  async function saveKey(b) {
    const old = cfg(),
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
    save({ key, query, on: old.key ? old.on : true });
    if (key !== old.key) {
      idx().usync.wait = 0;
      saveIdx();
    }
    const r = await unsplashNew(cfg(), true);
    if (!r.ok) return { ok: true, note: r.note };
    pushed = { raw: r.raw, name: r.name, at: Date.now(), taken: false };
    return { ok: true, photo: r.photo };
  }
  function turn(on) {
    if (cfg().key) save({ on: !!on });
  }
  function disconnect() {
    idx().seen = [];
    lastShown = '';
    lastLive = 0;
    pushed = { raw: '', name: '', at: 0, taken: true };
    idx().usync = { error: '', ok: 0, wait: 0, remaining: null, remainingAt: 0 };
    saveIdx();
    save({ key: '', query: '', on: true });
  }

  // ---- what Home's wallpapers ask of a source ----
  function details() {
    const uc = cfg(),
      us = idx().usync;
    return {
      configured: !!uc.key,
      keyHint: uc.key ? '…' + uc.key.slice(-4) : '',
      on: !!uc.key && uc.on,
      query: uc.query,
      shown: seen().length,
      lastPhoto: us.ok || 0,
      error: us.error || '',
      pausedUntil: us.wait > Date.now() ? us.wait : 0,
      remaining: typeof us.remaining === 'number' ? us.remaining : null,
    };
  }
  function status() {
    const d = details();
    if (!d.configured) return { summary: 'not set up · set up from your phone', error: '' };
    if (!d.on) return { summary: 'off', error: '' };
    return { summary: d.pausedUntil ? 'paused for the hourly limit' : 'a new photo at most every 3 minutes', error: d.error };
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
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = await body(req);
      if (u === '/api/save') {
        const r = await saveKey(b);
        return json(r, r.error ? 400 : 200);
      }
      if (u === '/api/on') {
        turn(b.on === true);
        return json({ ok: true });
      }
      if (u === '/api/credits') return json({ photos: credits() });
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

  // ---- the tool for the voice assistant and MCP clients ("provides": ["tools"]): one tool with an action ----
  // The Access Key is never in an answer, not even its last characters.
  const TOOL = {
    name: 'unsplash',
    description:
      "Unsplash photos behind the TV's Home screen. action status: is it set up and on, what it searches for, the hourly limit; set_query: the words photos are searched by (query; empty for any landscape); turn: on or off (on); credits: who took the photo on Home now.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'set_query', 'turn', 'credits'] },
        query: { type: 'string', description: 'for set_query: words such as mountains, or empty' },
        on: { type: 'boolean', description: 'for turn' },
      },
      required: ['action'],
    },
  };
  const done = v => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }], isError: false });
  const bad = m => ({ content: [{ type: 'text', text: String(m) }], isError: true });
  async function callTool(name, args) {
    if (name !== 'unsplash') return bad('unknown tool: ' + name);
    const x = args && typeof args === 'object' ? args : {};
    const d = details();
    if (x.action === 'status')
      return done({
        configured: d.configured,
        on: d.on,
        query: d.query || '',
        photosShown: d.shown,
        pausedForTheHourlyLimit: !!d.pausedUntil,
        error: d.error,
      });
    if (!d.configured) return bad('Unsplash is not set up: Add-ons > Unsplash > Set up from your phone (it needs your own Access Key)');
    if (x.action === 'set_query') {
      if (typeof x.query !== 'string') return bad('set_query needs a query (empty for any landscape)');
      const q = x.query.trim().replace(/\s+/g, ' ').slice(0, 100);
      save({ query: q });
      return done({ query: q, note: 'the next photo uses it (a new one comes at most every 3 minutes)' });
    }
    if (x.action === 'turn') {
      if (typeof x.on !== 'boolean') return bad('turn needs on: true or false');
      turn(x.on);
      return done({ on: x.on });
    }
    if (x.action === 'credits') {
      const l = credits(),
        p = l.filter(c => c.id === lastShown)[0] || l[0];
      return p ? done({ photographer: p.name, link: p.link }) : done('no Unsplash photo was shown yet');
    }
    return bad('action is status, set_query, turn or credits');
  }

  return {
    tools: { list: () => [TOOL], call: callTool },
    wallpapers: {
      label: 'Unsplash',
      // one entry that stands for "a new photo from Unsplash", there only while a key is set and the source is on
      get live() {
        return liveOn();
      },
      list: () => [],
      file: () => '',
      next,
      push,
      status,
      settings,
    },
    // for the tests
    details,
    handlePhone,
  };
}

module.exports = { create, PAIR_PORT };
