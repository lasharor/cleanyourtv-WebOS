// Scenes from an add-on. A theme with the couch scenes (effects.scenes "couch") shows five landscapes that ship with the launcher; an
// add-on that provides "scenes" (docs/development/addons.md) can bring other photos for them, chosen by the add-on (the Seasons add-on:
// by the date and the TV's country). Nothing happens without such an add-on: the launcher asks, gets an empty list, and keeps the
// five landscapes. The photos are files the add-on keeps on the TV; the launcher loads them from here, so it needs no network for them.
//   POST /api/scenes {cc}                      the scenes of the first add-on that has some: {addon, scenes: [{id, credit, darkSky}]}
//                                              (cc: the TV's country, two or three letters, as the launcher reads it)
//   GET  /api/scenes/photo/<add-on>/<id>/<image|glass>   a photo, or its blurred copy for the glass clock and the glass cards
// The object `scenes` on the module an add-on returns from create():
//   list({cc})        -> [{id, credit, darkSky}] (or a promise of it): the scenes to show now, at most 20; id: letters, digits, - _ .
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

  async function list(cc) {
    const opts = { cc: /^[A-Z]{2,3}$/.test(cc || '') ? cc : '' };
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

  async function handle(req, res, u, body) {
    const m = /^\/api\/scenes\/photo\/([^/]+)\/([^/]+)\/(image|glass)$/.exec(u);
    if (m) {
      if (req.method !== 'GET' || !ADDON.test(m[1]) || !ID.test(m[2])) return web.notFound(res);
      return photo(res, m[1], m[2], m[3]);
    }
    if (u === '/api/scenes' && req.method === 'POST') {
      const b = await body(req);
      return web.json(res, await list(String((b && b.cc) || '').toUpperCase()));
    }
    return web.notFound(res);
  }

  return { name: 'scenes', prefix: '/api/scenes', handle, list };
}

module.exports = { create };
