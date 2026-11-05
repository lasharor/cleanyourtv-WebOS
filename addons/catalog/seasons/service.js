// The Seasons add-on: photos for the couch scenes that follow the calendar (it provides "scenes", see helper/scenes.js). With a theme
// that shows the couch scenes (Couch), Christmas lights and snowy villages from 6 to 27 December, fireworks until 2 January, then five
// photos of the season take the place of the five landscapes; south of the equator the seasons turn around, and the tulip fields of
// spring show in the Netherlands and Belgium only (photos.js). The launcher tells the TV's country with each request.
// The photos come from Unsplash's image host and are kept on the TV (dataDir/photos: the photo, 1920 x 1080, and a blurred copy for the
// glass clock and the glass cards): the photos of the set in use, and the first two of every set, so each set shows at least two
// without network. Other files are deleted. The add-on contacts Unsplash only while it is installed and switched on: at its start, every
// six hours, and when the set or the country changes. GET /api/addons/seasons/status says what it has.
const fs = require('fs'),
  path = require('path');
const photos = require('./photos');

const HOST = process.env.CYTV_SEASONS_HOST || 'https://images.unsplash.com'; // the tests point it at a stand-in
const IMAGE = '?w=1920&h=1080&fit=crop&q=80&fm=jpg',
  GLASS = '?w=960&h=540&fit=crop&q=60&fm=jpg&blur=120&bri=15';
const KEEP = 2, // the first photos of every set, kept all year
  EVERY = 6 * 3600 * 1000,
  FILE_MAX = 4 * 1024 * 1024;
const jpeg = b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function create(ctx) {
  const PH = path.join(ctx.dataDir, 'photos');
  const now = () => (ctx.now ? ctx.now() : new Date());
  const cfg = () => Object.assign({ cc: '' }, ctx.settings.get());
  const fileOf = (id, kind) => path.join(PH, id + (kind === 'glass' ? '-glass' : '') + '.jpg');
  const has = id => fs.existsSync(fileOf(id, 'image')) && fs.existsSync(fileOf(id, 'glass'));
  const state = { at: 0, ok: 0, error: '', busy: false, got: 0 };

  // what the TV keeps for a country: the set in use, and the first two of every set
  function wanted(cc) {
    const out = photos.photosOf(photos.setOf(now(), cc), cc);
    for (const set of Object.keys(photos.SETS)) for (const x of photos.photosOf(set, cc).slice(0, KEEP)) out.push(x);
    const seen = {};
    return out.filter(x => !seen[x.id] && (seen[x.id] = 1));
  }
  async function download(x) {
    for (const kind of ['image', 'glass']) {
      const f = fileOf(x.id, kind);
      if (fs.existsSync(f)) continue;
      const r = await ctx.fetch.read(HOST + '/photo-' + x.p + (kind === 'glass' ? GLASS : IMAGE), {
        idleMs: 30000,
        maxBytes: FILE_MAX,
        anyStatus: true,
      });
      if (r.status !== 200) throw new Error('Unsplash answered ' + r.status);
      if (!jpeg(r.body)) throw new Error('not a JPEG');
      fs.writeFileSync(f + '.tmp', r.body);
      fs.renameSync(f + '.tmp', f);
      state.got++;
    }
  }
  let next = null,
    running = null;
  // one sync at a time: a call during one waits for it
  function sync() {
    if (!running)
      running = doSync().then(() => {
        running = null;
      });
    return running;
  }
  async function doSync() {
    state.busy = true;
    state.error = '';
    try {
      ctx.util.mkdirp(PH);
      const want = wanted(cfg().cc),
        keep = {};
      want.forEach(x => {
        keep[x.id + '.jpg'] = 1;
        keep[x.id + '-glass.jpg'] = 1;
      });
      for (const n of fs.readdirSync(PH))
        if (!keep[n])
          try {
            fs.unlinkSync(path.join(PH, n));
          } catch (_) {}
      let failed = 0;
      for (const x of want) {
        if (has(x.id)) continue;
        try {
          await download(x);
        } catch (e) {
          failed++;
          state.error = String((e && e.message) || e);
          if (failed >= 3) break; // no network, or Unsplash refuses: try again at the next sync
        }
      }
      if (!failed) state.ok = Date.now();
    } catch (e) {
      state.error = String((e && e.message) || e);
    }
    state.at = Date.now();
    state.busy = false;
  }
  function later(ms) {
    clearTimeout(next);
    next = setTimeout(() => sync().then(() => later(EVERY)), ms);
    if (next.unref) next.unref();
  }

  // ---- what the launcher asks (helper/scenes.js) ----
  let lastSet = '';
  function list(o) {
    const cc = (o && o.cc) || '';
    const set = photos.setOf(now(), cc);
    // a new country or a new set: the photos to keep change
    if (cc !== cfg().cc) ctx.settings.set({ cc });
    if (cc !== cfg().cc || set !== lastSet || photos.photosOf(set, cc).some(x => !has(x.id))) {
      if (!state.busy && Date.now() - state.at > 600000) sync();
    }
    lastSet = set;
    return photos
      .photosOf(set, cc)
      .filter(x => has(x.id))
      .map(x => ({ id: x.id, credit: x.by + ' / Unsplash', darkSky: !!x.dark }));
  }
  function file(id, kind) {
    if (!/^[a-z]+-\d{1,2}$/.test(id)) return '';
    const f = fileOf(id, kind);
    return fs.existsSync(f) ? f : '';
  }
  function status() {
    let n = 0,
      bytes = 0;
    try {
      for (const f of fs.readdirSync(PH))
        if (/\.jpg$/.test(f)) {
          n++;
          bytes += fs.statSync(path.join(PH, f)).size;
        }
    } catch (_) {}
    const cc = cfg().cc;
    return {
      set: photos.setOf(now(), cc),
      country: cc,
      files: n,
      bytes,
      lastSync: state.ok,
      tried: state.at,
      error: state.error,
      syncing: state.busy,
    };
  }

  return {
    scenes: { list, file },
    start: () => later(20000),
    sync,
    status,
    handle: (req, res, p) => {
      res.writeHead(p === '/status' ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(p === '/status' ? status() : { error: 'not found' }));
    },
  };
}

module.exports = { create };
