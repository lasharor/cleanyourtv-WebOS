// Downloadable cards: a card is a definition without code (card.json: a name, the options a person fills in on the phone page, and a template),
// kept on GitHub in cards/catalog/<id>/ and listed in cards/index.json with a hash for every file, like the themes and the add-ons. It
// is installed into cardpacks/<id>/ and used as the card type x-<id>; the launcher draws it from its template (app/src/js/cards.js),
// so a card cannot run anything. The picture (preview.jpg) is read from GitHub for the manager and never installed.
//   GET  /api/cards/catalog         what the catalog offers: {cards: [{id, name, version, description, about, preview, installed, update}], error}
//   POST /api/cards/install {id}    download, check every file against its hash, install
//   POST /api/cards/remove {id}     delete an installed card (a slot that used it falls back to the theme's own card)
//   GET  /api/cards/preview/<id>    the picture (from GitHub, kept a day)
//   GET  /api/cards/packs           the installed cards, as the launcher draws them
// card.json: {id, name, version, description, about, size: "small|medium|large", options: [{key, kind: "text|long|choice", label, default,
// choices: [[value, label]]}], template}. The template is the Text card's: {{greeting}} {{time}} {{date}} {{weekday}} {{weather.temp}}
// {{weather.text}}, plus {{year}}, {{year.percent}}, {{year.left}}, {{opt.<key>}} (what was filled in) and the filters {{opt.date|days}} (days
// until a date, YYYY-MM-DD), |ago (days since), |upper, |lower; **bold**, *italic*, and a line starting with # for a heading.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const P = require('./paths'),
  nc = require('./netcompat'),
  web = require('./web'),
  fetch = require('./fetch'),
  version = require('./version');
const { imageType } = require('./wallpapers');

const ID = /^[a-z][a-z0-9-]{1,27}$/; // the card type is x-<id>, at most 31 characters
const MAX_FILE = 64 * 1024,
  MAX_PREVIEW = 600 * 1024,
  MAX_FILES = 8,
  MAX_OPTIONS = 10;
const KINDS = ['text', 'long', 'choice', 'place']; // place: a name searched on the phone page, with its coordinates (opt.place, opt.lat, opt.lon)
// the card types in the launcher itself: their pictures ship in cardpreviews/, and no downloadable card may take these ids
const BUILTIN = ['greeting', 'weather', 'ha-entity', 'ha-entities', 'ha-weather', 'ha-camera', 'template'];
const SIZES = ['small', 'medium', 'large'];
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const safeRel = f => typeof f === 'string' && /^[\w][\w.-]{0,60}$/.test(f);

// a card.json as the launcher will use it, or {error}
// opts.addon: a card of an add-on (addon.json "cards"): it may poll the add-on for data and have buttons that send it actions
function clean(m, folder, opts) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: 'card.json is not an object' };
  if (!ID.test(m.id || '')) return { error: 'id must be lower-case letters, digits and hyphens (2 to 28), starting with a letter' };
  if (BUILTIN.indexOf(m.id) >= 0) return { error: 'this id is a card of the launcher itself' };
  if (folder && folder !== m.id) return { error: 'the folder name must be the id' };
  if (typeof m.name !== 'string' || !m.name || m.name.length > 40) return { error: 'name is missing or too long' };
  if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) return { error: 'version must look like 1.0.0' };
  // a card is a template (drawn by the launcher) or a page of its own (card.html, run in a sandbox: it brings its own code)
  const hasPage = m.page !== undefined;
  if (hasPage) {
    if (m.template !== undefined) return { error: 'a card has a template or a page, not both' };
    if (typeof m.page !== 'string' || !safeRel(m.page) || !/\.html$/.test(m.page))
      return { error: 'page must be an .html file in the folder of the card' };
  } else if (typeof m.template !== 'string' || !m.template || m.template.length > 1500)
    return { error: 'template is missing or longer than 1500 characters' };
  const add = !!(opts && opts.addon);
  if (add && !hasPage) return { error: 'a card of an add-on has a page' };
  let poll = 0;
  const actions = [];
  if (add) {
    if (m.poll !== undefined && (!Number.isInteger(m.poll) || m.poll < 0 || m.poll > 3600))
      return { error: 'poll is a number of seconds (0 to 3600)' };
    poll = m.poll ? Math.max(2, m.poll) : 0;
    const acts = Array.isArray(m.actions) ? m.actions : [];
    if (acts.length > 8) return { error: 'at most 8 actions' };
    for (const a of acts) {
      if (!a || typeof a !== 'object' || !/^[a-z][a-z0-9-]{0,19}$/.test(a.name || ''))
        return { error: 'an action has a name (lower-case letters, digits, hyphens)' };
      if (actions.some(x => x.name === a.name)) return { error: 'two actions are called ' + a.name };
      actions.push({ name: a.name, label: text(a.label, 40) || a.name });
    }
  }
  const raw = Array.isArray(m.options) ? m.options : [];
  if (raw.length > MAX_OPTIONS) return { error: 'at most ' + MAX_OPTIONS + ' options' };
  const options = [];
  for (const o of raw) {
    if (!o || typeof o !== 'object' || !/^[a-zA-Z][a-zA-Z0-9]{0,19}$/.test(o.key || '') || KINDS.indexOf(o.kind) < 0)
      return { error: 'an option needs a key (letters and digits) and a kind (text, long, choice or place)' };
    if (o.kind === 'place' && o.key !== 'place') return { error: 'a place option has the key place' };
    const one = { key: o.key, kind: o.kind, label: text(o.label, 60) || o.key, default: text(o.default, 200) };
    if (o.kind === 'choice') {
      one.choices = (Array.isArray(o.choices) ? o.choices : [])
        .slice(0, 10)
        .filter(c => Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'string')
        .map(c => [c[0].slice(0, 60), c[1].slice(0, 60)]);
      if (!one.choices.length) return { error: 'a choice needs choices: [[value, label], ...]' };
    }
    options.push(one);
  }
  // a card of an add-on may bring a drawer (a page that opens over Home) and a settings entry, each tied to one of its actions
  let drawer = null,
    settings = null;
  if (add) {
    const has = n => actions.some(x => x.name === n);
    if (m.drawer !== undefined) {
      const d = m.drawer;
      if (!d || typeof d !== 'object' || Array.isArray(d)) return { error: 'drawer is an object: {page, action, label}' };
      if (typeof d.page !== 'string' || !safeRel(d.page) || !/\.html$/.test(d.page) || d.page === m.page)
        return { error: 'drawer page must be an .html file in the folder of the card, not the card page' };
      if (!has(d.action)) return { error: 'drawer action must be one of the actions of the card' };
      drawer = { page: d.page, action: d.action, label: text(d.label, 40) || m.name };
    }
    if (m.settings !== undefined) {
      const s = m.settings;
      if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: 'settings is an object: {action, title}' };
      if (!has(s.action)) return { error: 'settings action must be one of the actions of the card' };
      if (!options.length) return { error: 'settings needs options' };
      settings = { action: s.action, title: text(s.title, 40) || m.name };
    }
    if (drawer && settings && drawer.action === settings.action) return { error: 'drawer and settings need different actions' };
  }
  return {
    card: {
      id: m.id,
      name: m.name,
      version: m.version,
      description: text(m.description, 200),
      about: text(m.about, 600),
      size: SIZES.indexOf(m.size) >= 0 ? m.size : 'medium',
      minService: /^\d+\.\d+\.\d+$/.test(m.minService || '') ? m.minService : '',
      options,
      template: hasPage ? '' : m.template,
      page: hasPage ? m.page : '',
      poll,
      actions,
      drawer,
      settings,
    },
  };
}

// the catalog index: entries with a clean id and version and a hash for each file; anything else is dropped
function cleanIndex(raw) {
  const out = [];
  for (const e of raw && Array.isArray(raw.cards) ? raw.cards : []) {
    if (!e || !ID.test(e.id || '') || !/^\d+\.\d+\.\d+$/.test(e.version || '')) continue;
    const files = {};
    let n = 0,
      good = e.files && typeof e.files === 'object';
    for (const f of good ? Object.keys(e.files) : []) {
      if (!safeRel(f) || !/^[0-9a-f]{64}$/.test(e.files[f]) || ++n > MAX_FILES) good = false;
      else files[f] = e.files[f];
    }
    if (!good || !files['card.json']) continue;
    out.push({
      id: e.id,
      name: text(e.name, 40) || e.id,
      version: e.version,
      description: text(e.description, 200),
      about: text(e.about, 600),
      preview: /^preview\.(?:jpg|png|webp)$/.test(e.preview || '') ? e.preview : '',
      minService: /^\d+\.\d+\.\d+$/.test(e.minService || '') ? e.minService : '',
      files,
    });
  }
  return out;
}

const rmrf = d => {
  try {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.lstatSync(p).isDirectory()) rmrf(p);
      else fs.unlinkSync(p);
    }
    fs.rmdirSync(d);
  } catch (_) {}
};
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

function create(ctx) {
  const serviceVersion = () => (ctx && ctx.version) || '';
  const base = () => {
    if (process.env.CYTV_CARDS_URL) return process.env.CYTV_CARDS_URL;
    const ref = require('./updates').catalogRef();
    return 'https://raw.githubusercontent.com/' + require('./updates').repo() + '/' + ref + '/cards';
  };
  const get = (url, max) =>
    fetch
      .read(url, {
        headers: { 'User-Agent': 'cleanyourtv-cards' },
        maxBytes: max,
        totalMs: 30000,
        idleMs: 10000,
        redirects: 3,
        allowHttp: () => !!process.env.CYTV_CARDS_URL,
        statusText: st => (st === 404 ? 'not found on GitHub' : 'GitHub answered ' + st),
      })
      .then(r => r.body);
  const index = async () => cleanIndex(JSON.parse((await get(base() + '/index.json', 256 * 1024)).toString('utf8')));

  // the installed cards: {id: card}, read from the folders (a card that does not pass the check is left out)
  function installed() {
    const out = {};
    let names = [];
    try {
      names = fs.readdirSync(P.CARDPACKS);
    } catch (_) {}
    for (const n of names) {
      if (!ID.test(n)) continue;
      try {
        const r = clean(JSON.parse(fs.readFileSync(path.join(P.CARDPACKS, n, 'card.json'), 'utf8')), n);
        if (r.card) out[n] = r.card;
      } catch (_) {}
    }
    return out;
  }

  // the cards of add-ons that run (addon.json "cards"), as the installed ones: {id: card with addon}. A downloaded card with the same
  // id wins, and an add-on's card is not removed from here (it goes with its add-on)
  function fromAddons() {
    const out = {},
      ad = ctx && ctx.feature && ctx.feature('addons');
    for (const e of ad && ad.cardsOf ? ad.cardsOf() : [])
      if (!out[e.card.id]) out[e.card.id] = Object.assign({}, e.card, { addon: e.addon });
    return out;
  }
  const all = () => Object.assign(fromAddons(), installed());

  async function catalog() {
    let entries;
    try {
      entries = await index();
    } catch (e) {
      return { cards: [], error: String((e && e.message) || e).slice(0, 160) };
    }
    const have = installed();
    return {
      cards: entries.map(e => ({
        id: e.id,
        name: e.name,
        version: e.version,
        description: e.description,
        about: e.about,
        preview: !!e.preview,
        needs: e.minService && serviceVersion() && version.cmp(serviceVersion(), e.minService) < 0 ? e.minService : '',
        installed: have[e.id] ? have[e.id].version : '',
        update: !!(have[e.id] && version.cmp(e.version, have[e.id].version) > 0),
      })),
    };
  }

  async function install(id) {
    const e = (await index()).filter(x => x.id === id)[0];
    if (!e) return { error: 'not in the catalog' };
    if (e.minService && serviceVersion() && version.cmp(serviceVersion(), e.minService) < 0)
      return {
        error: 'this card needs service ' + e.minService + ' or newer (this is ' + serviceVersion() + '): update the service first',
      };
    const stage = path.join(P.CARDPACKS, '.staging-' + id),
      old = path.join(P.CARDPACKS, '.old-' + id),
      dest = path.join(P.CARDPACKS, id);
    rmrf(stage);
    nc.mkdirp(stage);
    try {
      for (const f of Object.keys(e.files)) {
        const buf = await get(base() + '/catalog/' + id + '/' + f, MAX_FILE);
        if (sha256(buf) !== e.files[f]) throw new Error(f + ' does not match the catalog (nothing was installed)');
        fs.writeFileSync(path.join(stage, f), buf);
      }
      const r = clean(JSON.parse(fs.readFileSync(path.join(stage, 'card.json'), 'utf8')), id);
      if (r.error) throw new Error(r.error);
      if (r.card.version !== e.version) throw new Error('card.json does not match the catalog entry');
      rmrf(old);
      if (fs.existsSync(dest)) fs.renameSync(dest, old);
      fs.renameSync(stage, dest);
      rmrf(old);
      return { id, version: e.version };
    } catch (err) {
      rmrf(stage);
      return { error: String((err && err.message) || err).slice(0, 200) };
    }
  }

  // an installed card goes; a slot that used it shows the theme's own card again (the launcher knows no such type any more)
  function remove(id) {
    if (!ID.test(id || '') || !installed()[id])
      return { error: fromAddons()[id] ? 'this card comes with its add-on: remove the add-on' : 'not installed' };
    rmrf(path.join(P.CARDPACKS, id));
    return { id };
  }

  // the picture of a card: from GitHub, kept in cardpacks/.previews for a day
  async function preview(id) {
    if (!ID.test(id || '')) return null;
    if (BUILTIN.indexOf(id) >= 0) {
      try {
        return fs.readFileSync(path.join(__dirname, 'cardpreviews', id + '.jpg'));
      } catch (_) {
        return null;
      }
    }
    // the picture of a card of an add-on is in the add-on's folder: cards/<id>/preview.jpg
    const own = fromAddons()[id];
    if (own) {
      const e = ctx
        .feature('addons')
        .cardsOf()
        .filter(x => x.addon === own.addon && x.card.id === id)[0];
      try {
        const b = e && fs.readFileSync(path.join(e.dir, 'cards', id, 'preview.jpg'));
        return b && imageType(b) ? b : null;
      } catch (_) {
        return null;
      }
    }
    const pd = path.join(P.CARDPACKS, '.previews'),
      f = path.join(pd, id + '.img');
    let st = null;
    try {
      st = fs.statSync(f);
    } catch (_) {}
    if (st && Date.now() - st.mtimeMs < 86400000) return fs.readFileSync(f);
    try {
      const e = (await index()).filter(x => x.id === id)[0];
      if (!e || !e.preview) throw new Error('no picture');
      const b = await get(base() + '/catalog/' + id + '/' + e.preview, MAX_PREVIEW);
      if (!imageType(b)) throw new Error('the picture is not an image');
      nc.mkdirp(pd);
      fs.writeFileSync(f + '.part', b);
      fs.renameSync(f + '.part', f);
      return b;
    } catch (_) {
      return st ? fs.readFileSync(f) : null;
    }
  }

  // the files of an installed page card, for the card's frame in the launcher (a sandbox without network: default-src none)
  const TYPES = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    svg: 'image/svg+xml',
    json: 'application/json',
    woff2: 'font/woff2',
    png: 'image/png',
    jpg: 'image/jpeg',
  };
  const CARD_CSP =
    "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data:; font-src data: 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'";
  function serve(req, res, u) {
    const m = /^\/card\/([a-z][a-z0-9-]*)\/([\w][\w.-]{0,60})$/.exec(u);
    const card = m && all()[m[1]];
    if (!card || !card.page || req.method !== 'GET') return web.notFound(res);
    // an add-on's card keeps its files in the add-on's folder, cards/<id>/
    let dir = path.join(P.CARDPACKS, m[1]);
    if (card.addon) {
      const e = ctx
        .feature('addons')
        .cardsOf()
        .filter(x => x.addon === card.addon && x.card.id === m[1])[0];
      if (!e) return web.notFound(res);
      dir = path.join(e.dir, 'cards', m[1]);
    }
    const file = path.join(dir, m[2]);
    let st;
    try {
      st = fs.statSync(file);
    } catch (_) {
      return web.notFound(res);
    }
    const type = TYPES[m[2].split('.').pop().toLowerCase()];
    if (!st.isFile() || !type) return web.notFound(res);
    res.writeHead(200, {
      'content-type': type,
      'content-length': st.size,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': CARD_CSP,
    });
    fs.createReadStream(file).pipe(res);
  }

  // GET/POST under /api/cards/ that belong here; true when it answered, false when the path is not ours
  async function handle(req, res, u, body) {
    if (u === '/api/cards/catalog' && req.method === 'GET') return web.json(res, await catalog()), true;
    if (u === '/api/cards/packs' && req.method === 'GET') return web.json(res, { packs: installed() }), true;
    const pm = /^\/api\/cards\/preview\/([a-z][a-z0-9-]*)$/.exec(u);
    if (pm && req.method === 'GET') {
      const b = await preview(pm[1]);
      if (!b) return web.notFound(res), true;
      res.writeHead(200, { 'content-type': MIME[imageType(b)], 'cache-control': 'max-age=600', 'x-content-type-options': 'nosniff' });
      return res.end(b), true;
    }
    if ((u === '/api/cards/install' || u === '/api/cards/remove') && req.method === 'POST') {
      const b = await body(req);
      if (!ID.test(b.id || '')) return web.json(res, { error: 'bad id' }, 400);
      const r = u === '/api/cards/install' ? await install(b.id) : remove(b.id);
      return web.json(res, r, r.error ? 400 : 200), true;
    }
    return false;
  }
  const match = u => u.indexOf('/card/') === 0;
  return { handle, installed, all, catalog, install, remove, preview, serve, match };
}

module.exports = { create, clean, cleanIndex, ID, KINDS, BUILTIN };
