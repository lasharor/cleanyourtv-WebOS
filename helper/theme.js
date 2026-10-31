// Themes for the launcher's home screen. A theme is a folder in the themes/ folder of the GitHub repository (theme.json, a screenshot and
// optionally a wallpaper and a typeface). Nothing is shipped with the service: the TV reads themes/index.json from GitHub, shows the list
// with the screenshots and downloads a theme (and its wallpaper and typeface) when it is chosen; downloaded themes stay on the TV. Classic is built in. A theme sets
// values from the table SCHEMA below: colours, surfaces, text, and the position and size of every part of the screen (clock, buttons, app
// name, dock, grid), plus effects and a wallpaper. There is no CSS or script in a theme. Every value is checked against SCHEMA and clamped,
// a value that is missing or invalid keeps the value of the theme it extends (or the default, the original look), and unknown keys are
// ignored, so a theme can change how Home looks but nothing else. A new setting is one row in SCHEMA plus the CSS that reads its variable;
// docs/themes.md is generated from SCHEMA (tools/theme-docs.js).
// API (loopback only): GET /api/theme/list, POST /api/theme/set {id, accent}, POST /api/theme/revert, GET /api/theme/preview/<id>,
// GET /api/theme/wallpaper/<id>/<file>, GET /api/theme/font/<id>/<file>.
const fs = require('fs'),
  path = require('path');
const nc = require('./netcompat'),
  fetch = require('./fetch');
const {
  ACCENTS,
  DEFAULTS,
  DEFAULT_ID,
  FILE,
  FONT_FILE,
  HEX,
  ID,
  MAX_CUSTOM_SCENES,
  MAX_FONT,
  MAX_INDEX,
  MAX_PREVIEW,
  MAX_SCENE_FILE,
  MAX_THEME,
  MAX_WALLPAPER,
  PREVIEW_PATH,
  SCENE_FRONT,
  SCENE_ID_RE,
  SCENE_IMG,
  SCHEMA,
  dir,
  fontOk,
  fontType,
  getPath,
  hex,
  imageOk,
  imageType,
  normalize,
  resolve,
  sniff,
} = require('./themeschema');

const BUILTIN = () =>
  normalize(
    { name: 'Classic', author: 'CleanYourTV', description: 'The original look: near-black, white focus, ten columns.' },
    DEFAULT_ID
  );
let cache = null;
// the themes on the TV: Classic (built in) and every downloaded folder
function load() {
  if (cache) return cache;
  const raws = {};
  let names = [];
  try {
    names = fs.readdirSync(dir());
  } catch (_) {}
  for (const f of names.sort()) {
    if (!ID.test(f) || f === DEFAULT_ID) continue;
    try {
      raws[f] = JSON.parse(fs.readFileSync(path.join(dir(), f, 'theme.json'), 'utf8'));
    } catch (_) {}
  }
  const out = { [DEFAULT_ID]: BUILTIN() };
  const build = (id, stack) => {
    // "extends": another theme's values are the starting point
    if (out[id]) return out[id];
    const raw = raws[id];
    if (!raw || stack.indexOf(id) >= 0 || stack.length > 4) return null;
    const baseId = typeof raw.extends === 'string' && ID.test(raw.extends) ? raw.extends : '',
      base = baseId ? build(baseId, stack.concat(id)) : null;
    if (baseId && !base) return null; // its base is missing: not usable
    return (out[id] = normalize(raw, id, base ? base.v : null));
  };
  for (const id of Object.keys(raws)) build(id, []);
  for (const id of Object.keys(out)) if (!out[id]) delete out[id];
  return (cache = out);
}

// ---- reading from GitHub ----
// the themes folder of the repository (main branch); https only, except the address a test sets
function baseUrl(slug, ref) {
  return process.env.CYTV_THEMES_URL || 'https://raw.githubusercontent.com/' + slug + '/' + (ref || 'main') + '/themes';
}
// a file from GitHub, at most `max` bytes and `ms` milliseconds
function fetchBuf(url, max, ms) {
  return fetch
    .read(url, {
      headers: { 'User-Agent': 'cleanyourtv-themes' },
      maxBytes: max,
      totalMs: ms || 15000,
      idleMs: 10000,
      redirects: 3,
      allowHttp: () => !!process.env.CYTV_THEMES_URL,
      statusText: st => (st === 404 ? 'not found on GitHub' : 'GitHub answered ' + st),
    })
    .then(r => r.body);
}
const writeAtomic = (f, data) => {
  fs.writeFileSync(f + '.tmp', data);
  fs.renameSync(f + '.tmp', f);
};
const mkdirs = d => {
  try {
    nc.mkdirp(d);
  } catch (_) {}
};
const rmrf = d => {
  try {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) rmrf(p);
      else fs.unlinkSync(p);
    }
    fs.rmdirSync(d);
  } catch (_) {}
};

function create(ctx) {
  // the repository and branch the themes come from: this project's main branch, unless D/source names another (to try a theme)
  const slug = () => (ctx.slug && ctx.slug()) || require('./updates').repo();
  const ref = () => {
    if (ctx.ref) return ctx.ref();
    let x = '';
    try {
      x = fs.readFileSync(require('./paths').SOURCE, 'utf8').trim().split(/\s+/)[1];
    } catch (_) {}
    return /^[\w.\/-]{1,60}$/.test(x || '') ? x : 'main';
  };
  const conf = () => ctx.config.get();
  const base = () => baseUrl(slug(), ref());
  const cur = () => {
    const c = conf().theme || {};
    const all = load();
    return {
      id: all[c.id] ? c.id : DEFAULT_ID,
      accent: hex(c.accent) || '',
      prev: c.prev && all[c.prev.id] ? { id: c.prev.id, accent: hex(c.prev.accent) || '' } : null,
    };
  };
  const resolved = () => {
    const c = cur();
    return resolve(load()[c.id], c.accent);
  };
  const save = o =>
    ctx.config.update('theme', c => {
      c.theme = o;
    });

  // the catalogue: themes/index.json from GitHub, kept in memory for ten minutes
  let cat = { at: 0, themes: [], error: '' },
    catP = null;
  function refreshCatalogue(force) {
    if (!force && cat.at && Date.now() - cat.at < 600000) return Promise.resolve(cat);
    if (catP) return catP;
    catP = fetchBuf(base() + '/index.json', MAX_INDEX, 12000)
      .then(b => {
        const j = JSON.parse(b.toString('utf8')),
          out = [];
        for (const t of Array.isArray(j.themes) ? j.themes.slice(0, 200) : []) {
          if (!t || !ID.test(String(t.id || ''))) continue;
          const pm = PREVIEW_PATH.exec(String(t.preview || ''));
          out.push({
            id: t.id,
            name: String(t.name || t.id).slice(0, 40),
            author: String(t.author || '').slice(0, 60),
            description: String(t.description || '').slice(0, 160),
            preview: pm && pm[1] === t.id ? t.preview : '',
          });
        }
        cat = { at: Date.now(), themes: out, error: '' };
      })
      .catch(e => {
        cat = { at: cat.at, themes: cat.themes, error: String(e.message || e) };
      })
      .then(() => {
        catP = null;
        return cat;
      });
    return catP;
  }

  // download a theme (and the theme it extends, its wallpaper and its typeface) into themes/<id>/; nothing is kept when a file is invalid
  async function install(id, depth) {
    if (!ID.test(id) || id === DEFAULT_ID) throw new Error('unknown theme');
    if ((depth || 0) > 3) throw new Error('the theme extends too many themes');
    const raw = JSON.parse((await fetchBuf(base() + '/' + id + '/theme.json', MAX_THEME, 12000)).toString('utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a theme file');
    if (typeof raw.extends === 'string' && ID.test(raw.extends) && raw.extends !== DEFAULT_ID && !load()[raw.extends]) {
      try {
        await install(raw.extends, (depth || 0) + 1);
      } catch (e) {
        throw new Error('the theme it extends (' + raw.extends + ') could not be downloaded: ' + e.message);
      }
    }
    const w = getPath(raw, 'effects.wallpaper');
    let wall = null;
    if (typeof w === 'string' && w !== '') {
      if (!FILE.test(w)) throw new Error('the wallpaper name is not valid');
      wall = await fetchBuf(base() + '/' + id + '/' + w, MAX_WALLPAPER, 25000);
      if (!imageOk(wall, w, MAX_WALLPAPER)) throw new Error('the wallpaper is not an image of that type');
    }
    const f = getPath(raw, 'type.fontFile');
    let font = null;
    if (typeof f === 'string' && f !== '') {
      if (!FONT_FILE.test(f)) throw new Error('the typeface name is not valid');
      font = await fetchBuf(base() + '/' + id + '/' + f, MAX_FONT, 25000);
      if (!fontOk(font, f)) throw new Error('the typeface is not a font of that type');
    }
    const sceneFiles = {};
    if (getPath(raw, 'effects.scenes') === 'custom' && Array.isArray(raw.scenes)) {
      for (const s of raw.scenes.slice(0, MAX_CUSTOM_SCENES)) {
        if (!s || typeof s !== 'object' || !SCENE_ID_RE.test(s.id)) continue;
        const filenames = [];
        if (SCENE_IMG.test(s.image)) filenames.push(s.image);
        if (SCENE_IMG.test(s.glass) && !filenames.includes(s.glass)) filenames.push(s.glass);
        if (s.front && SCENE_FRONT.test(s.front) && !filenames.includes(s.front)) filenames.push(s.front);
        for (const fn of filenames) {
          if (sceneFiles[fn]) continue;
          const b = await fetchBuf(base() + '/' + id + '/' + fn, MAX_SCENE_FILE, 30000);
          if (!imageOk(b, fn, MAX_SCENE_FILE)) throw new Error('scene image ' + fn + ' is not a valid image');
          sceneFiles[fn] = b;
        }
      }
    }
    const d = path.join(dir(), id),
      had = fs.existsSync(path.join(d, 'theme.json'));
    mkdirs(d);
    if (wall) writeAtomic(path.join(d, w), wall);
    if (font) writeAtomic(path.join(d, f), font);
    for (const fn of Object.keys(sceneFiles)) writeAtomic(path.join(d, fn), sceneFiles[fn]);
    writeAtomic(path.join(d, 'theme.json'), JSON.stringify(raw));
    cache = null;
    if (!load()[id]) {
      if (!had) rmrf(d);
      cache = null;
      throw new Error('the theme file is not usable');
    }
  }

  // screenshots: fetched once from GitHub and kept in themes/.previews for a day
  async function preview(id) {
    if (!ID.test(id)) return null;
    const pd = path.join(dir(), '.previews'),
      f = path.join(pd, id + '.img');
    let st = null;
    try {
      st = fs.statSync(f);
    } catch (_) {}
    if (st && Date.now() - st.mtimeMs < 86400000) return fs.readFileSync(f);
    try {
      const e = (await refreshCatalogue(false)).themes.find(t => t.id === id);
      if (!e || !e.preview) throw new Error('no screenshot');
      const b = await fetchBuf(base() + '/' + e.preview, MAX_PREVIEW, 15000);
      if (!sniff(b)) throw new Error('the screenshot is not an image');
      mkdirs(pd);
      writeAtomic(f, b);
      return b;
    } catch (_) {
      return st ? fs.readFileSync(f) : null;
    }
  }

  async function list() {
    await refreshCatalogue(false);
    const c = cur(),
      all = load(),
      seen = {},
      themes = [];
    const add = (id, info) => {
      if (seen[id]) return;
      seen[id] = 1;
      const l = all[id];
      themes.push({
        id,
        name: l ? l.name : info.name,
        author: l ? l.author : info.author,
        description: l ? l.description : info.description,
        installed: !!l,
        preview: !!info.preview,
      });
    };
    const cc = cat.themes.find(t => t.id === DEFAULT_ID);
    add(DEFAULT_ID, cc || { name: 'Classic', author: 'CleanYourTV', description: all[DEFAULT_ID].description, preview: '' });
    for (const t of cat.themes) add(t.id, t);
    for (const id of Object.keys(all))
      add(id, { name: all[id].name, author: all[id].author, description: all[id].description, preview: '' });
    return {
      current: { id: c.id, accent: c.accent },
      previous: c.prev,
      accents: ACCENTS.map(x => ({ name: x[0], hex: x[1] })),
      themes,
      catalogue: { ok: !cat.error, error: cat.error, at: cat.at },
    };
  }

  async function handle(req, res, u, body) {
    const json = (o, code) => {
      res.writeHead(code || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    const act = u.replace('/api/theme/', '');
    if (act === 'list') return json(await list());
    let m = /^preview\/([a-z0-9-]{1,30})$/.exec(act);
    if (m) {
      const b = await preview(m[1]);
      if (!b) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'content-type': imageType('x.' + sniff(b)), 'cache-control': 'max-age=600' });
      return res.end(b);
    }
    m = /^wallpaper\/([a-z0-9-]{1,30})\/([\w-]{1,40}\.(?:jpg|png|webp))$/.exec(act);
    if (m) {
      const t = load()[m[1]];
      if (!t || t.v['effects.wallpaper'] !== m[2]) {
        res.writeHead(404);
        return res.end();
      }
      try {
        const b = fs.readFileSync(path.join(dir(), m[1], m[2]));
        res.writeHead(200, { 'content-type': imageType(m[2]), 'cache-control': 'max-age=3600' });
        return res.end(b);
      } catch (_) {
        res.writeHead(404);
        return res.end();
      }
    }
    m = /^font\/([a-z0-9-]{1,30})\/([\w-]{1,40}\.(?:woff2|woff|ttf|otf))$/.exec(act);
    if (m) {
      // only the typeface a theme names, from that theme's folder (also when a theme that extends it is chosen)
      const ok = Object.keys(load()).some(k => {
        const v = load()[k].v;
        return v['type.fontFile'] === m[2] && (v.fontTheme || k) === m[1];
      });
      try {
        if (!ok) throw new Error('not a theme typeface');
        const b = fs.readFileSync(path.join(dir(), m[1], m[2]));
        res.writeHead(200, { 'content-type': fontType(m[2]), 'cache-control': 'max-age=86400', 'access-control-allow-origin': '*' });
        return res.end(b);
      } catch (_) {
        res.writeHead(404);
        return res.end();
      }
    }
    m = /^scene\/([a-z0-9-]{1,30})\/([\w-]{1,60}\.(?:jpg|webp))$/.exec(act);
    if (m) {
      const t = load()[m[1]];
      const cs = t && t.v.customScenes;
      if (!cs || !cs.some(s => s.image === m[2] || s.glass === m[2] || s.front === m[2])) {
        res.writeHead(404);
        return res.end();
      }
      try {
        const b = fs.readFileSync(path.join(dir(), m[1], m[2]));
        res.writeHead(200, { 'content-type': imageType(m[2]), 'cache-control': 'max-age=3600' });
        return res.end(b);
      } catch (_) {
        res.writeHead(404);
        return res.end();
      }
    }
    if (req.method !== 'POST') {
      res.writeHead(404);
      return res.end();
    }
    const b = await body(req),
      c = cur();
    if (act === 'set') {
      const id = b.id === undefined ? c.id : String(b.id);
      if (!ID.test(id)) return json({ error: 'unknown theme' }, 400);
      if (b.id !== undefined && id !== DEFAULT_ID) {
        // the latest version of the theme from GitHub; a downloaded copy is used when GitHub cannot be reached
        try {
          await install(id);
        } catch (e) {
          if (!load()[id]) {
            const unk = e.message === 'unknown theme' || e.message === 'not found on GitHub';
            return json({ error: unk ? 'unknown theme' : 'could not download the theme: ' + e.message }, unk ? 400 : 502);
          }
        }
      }
      const all = load();
      if (!all[id]) return json({ error: 'unknown theme' }, 400);
      let accent = c.accent;
      if (b.accent !== undefined) {
        if (b.accent !== '' && !HEX.test(String(b.accent))) return json({ error: 'the accent must be a colour like #4c8dff' }, 400);
        accent = String(b.accent).toLowerCase();
      } else if (id !== c.id) accent = ''; // a new theme brings its own accent
      if (id !== c.id || accent !== c.accent) save({ id, accent, prev: { id: c.id, accent: c.accent } });
      return json(await list());
    }
    if (act === 'revert') {
      if (!c.prev) return json({ error: 'nothing to go back to' }, 400);
      save({ id: c.prev.id, accent: c.prev.accent, prev: { id: c.id, accent: c.accent } });
      return json(await list());
    }
    res.writeHead(404);
    res.end();
  }

  // earlier versions shipped the themes with the service: remove those files; fetch the chosen theme when it is not on the TV
  try {
    for (const f of fs.readdirSync(dir())) if (/^[a-z0-9-]+\.json$/.test(f)) fs.unlinkSync(path.join(dir(), f));
    rmrf(path.join(dir(), 'wallpapers'));
  } catch (_) {}
  const startup = () => {
    const c = conf().theme || {};
    if (c.id && c.id !== DEFAULT_ID && ID.test(c.id) && !load()[c.id]) install(c.id).catch(() => {});
  };
  if (!ctx.noStartup) {
    const t = setTimeout(startup, 8000);
    if (t.unref) t.unref();
  }
  return { name: 'theme', prefix: '/api/theme/', handle, resolved, list, install, refreshCatalogue, preview };
}
module.exports = { create, normalize, SCHEMA, DEFAULTS, imageOk, fontOk, ID, resolve };
