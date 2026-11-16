// Scenes from an add-on. A theme with the couch scenes (effects.scenes "couch") shows five landscapes that ship with the launcher; an
// add-on that provides "scenes" (docs/development/addons.md) can bring other photos for them, chosen by the add-on (the Seasons add-on:
// by the date and the TV's country). Nothing happens without such an add-on: the launcher asks, gets an empty list, and keeps the
// five landscapes. The photos are files the add-on keeps on the TV; the launcher loads them from here, so it needs no network for them.
//   POST /api/scenes {cc, day}                 the scenes of the first add-on that has some: {addon, scenes: [{id, credit, darkSky}]}
//                                              (cc: the TV's country, two or three letters, as the launcher reads it; day: false while
//                                              the sun is down, so an add-on can answer with photos of the evening)
//   GET  /api/scenes/photo/<add-on>/<id>/<image|glass>   a photo, or its blurred copy for the glass clock and the glass cards
//   POST /api/scenes/place {q}                 the coordinates of a place by name: {enabled, place: {name, lat, lon}} or {enabled, place: null}. The
//                                              launcher asks with the city its own time zone names, so the scenes can follow the sun
//                                              on a TV without a weather card. Only when options.sunPlace is on (manager > Features >
//                                              Sun-aware scenes, off by default): else {enabled: false, place: null} and nothing leaves
//                                              the TV. Open-Meteo's geocoding, the same the weather card uses; only the name leaves the
//                                              TV, once: the answer is kept in config.json (scenesPlace) until the switch goes off
// The object `scenes` on the module an add-on returns from create():
//   list({cc, day})   -> [{id, credit, darkSky}] (or a promise of it): the scenes to show now, at most 20; id: letters, digits, - _ .
//                     day is false while the sun is down where the TV is; an add-on that does not care simply ignores it
//   file(id, kind)    -> the absolute path of the photo (kind "image") or of its blurred copy ("glass"): a JPEG, PNG or WebP, or ''
const fs = require('fs'),
  path = require('path');
const web = require('./web');

const ID = /^[\w.-]{1,64}$/,
  ADDON = /^[a-z0-9][a-z0-9-]{0,40}$/,
  MAX = 20,
  FILE_MAX = 8 * 1024 * 1024,
  MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const line = (v, n) =>
  String(v || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, n);

function create(ctx) {
  const weather = require('./weather').create({ path: require('./paths').WEATHER });
  const warned = {};
  const warn = (id, e) => {
    if (warned[id]) return;
    warned[id] = 1;
    console.error('scenes: add-on ' + id + ': ' + ((e && e.message) || e));
  };
  const sources = () => {
    const a = ctx.feature && ctx.feature('addons');
    return a && a.providers
      ? a
          .providers('scenes')
          .filter(s => s.mod.scenes && typeof s.mod.scenes.list === 'function' && typeof s.mod.scenes.file === 'function')
      : [];
  };

  async function list(cc, day) {
    const opts = { cc: /^[A-Z]{2,3}$/.test(cc || '') ? cc : '', day: day !== false };
    for (const s of sources()) {
      let l = [];
      try {
        l = await s.mod.scenes.list(opts);
      } catch (e) {
        warn(s.id, e);
        continue;
      }
      const seen = {};
      const scenes = (Array.isArray(l) ? l : [])
        .filter(x => x && typeof x === 'object' && typeof x.id === 'string' && ID.test(x.id) && !seen[x.id] && (seen[x.id] = 1))
        .slice(0, MAX)
        .map(x => ({ id: x.id, credit: line(x.credit, 120), darkSky: x.darkSky === true }));
      if (scenes.length) return { addon: s.id, scenes };
    }
    return { scenes: [] };
  }

  function photo(res, addon, id, kind) {
    const s = sources().filter(x => x.id === addon)[0];
    let f = '';
    if (s)
      try {
        f = s.mod.scenes.file(id, kind);
      } catch (e) {
        warn(addon, e);
      }
    const type = typeof f === 'string' && path.isAbsolute(f) && MIME[f.split('.').pop().toLowerCase()];
    let ok = false;
    if (type)
      try {
        const st = fs.statSync(f);
        ok = st.isFile() && st.size <= FILE_MAX;
      } catch (_) {}
    if (!ok) return web.notFound(res);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=86400' });
    fs.createReadStream(f).pipe(res);
  }

  // The place the sun's hours are worked out for, from the name of the city the TV's time zone names. This is the only call of the
  // scenes that leaves the TV, so: only with the switch in the manager (options.sunPlace, off by default), and only once. The answer
  // (or "not found") is kept in config.json until the switch goes off, which forgets it. A network failure is tried again at most
  // once per start of the service, so a TV that is offline is not asking all day.
  let failedThisRun = false;
  async function placeOf(q) {
    if (!ctx.config.options().sunPlace) return { enabled: false, place: null };
    const kept = ctx.config.get().scenesPlace;
    if (kept) return { enabled: true, place: kept.lat !== undefined ? kept : null };
    if (failedThisRun) return { enabled: true, place: null };
    let p = null;
    try {
      const found = await weather.search(q, '');
      const f = Array.isArray(found) ? found[0] : null;
      if (f && isFinite(f.lat) && isFinite(f.lon)) p = { name: line(f.name, 60), lat: f.lat, lon: f.lon };
    } catch (e) {
      failedThisRun = true;
      return { enabled: true, place: null };
    }
    // the switch may have gone off while the search was out: then nothing is kept
    ctx.config.update('scenes', c => {
      if (c.options && c.options.sunPlace) c.scenesPlace = p || { none: true, at: Date.now() };
    });
    return { enabled: true, place: p };
  }

  async function handle(req, res, u, body) {
    const m = /^\/api\/scenes\/photo\/([^/]+)\/([^/]+)\/(image|glass)$/.exec(u);
    if (m) {
      if (req.method !== 'GET' || !ADDON.test(m[1]) || !ID.test(m[2])) return web.notFound(res);
      return photo(res, m[1], m[2], m[3]);
    }
    if (u === '/api/scenes/place' && req.method === 'POST') {
      const b = await body(req);
      const q = String((b && b.q) || '')
        .trim()
        .slice(0, 60);
      return web.json(res, q.length < 2 ? { enabled: !!ctx.config.options().sunPlace, place: null } : await placeOf(q));
    }
    if (u === '/api/scenes' && req.method === 'POST') {
      const b = await body(req);
      return web.json(res, await list(String((b && b.cc) || '').toUpperCase(), !(b && b.day === false)));
    }
    return web.notFound(res);
  }

  return { name: 'scenes', prefix: '/api/scenes', handle, list };
}

module.exports = { create };
