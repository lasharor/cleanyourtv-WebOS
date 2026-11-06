// Add-ons (docs/development/addons.md): a folder with an addon.json, loaded by the service at start. Two places hold them:
//   addons-bundled/<id>   ships with the package (Live TV is one); cannot be removed; may answer old API paths (manifest "routes")
//   P.ADDONS/<id>         installed from the catalog (or put there by hand)
// Requests:
//   GET  /api/addons                       {addons: [{id, name, version, kind, enabled, status, error, bundled, tile, page, ...}], book}
//   POST /api/addons/book {order, hidden, strip, position}  which pages the launcher's book has, in which order, whether the strip
//                                          shows and where (config.json: book)
//   GET  /api/addons/catalog               what the project's catalog offers: {addons: [...], error}
//   POST /api/addons/install {id}          download from the catalog, check every file against its hash, install
//   POST /api/addons/remove {id}           delete an installed add-on (its data stays)
//   GET  /api/addons/<id>                  one add-on
//   POST /api/addons/<id>/enable {enabled} stored in config.json; takes effect at the next start (a page add-on at once)
//   ANY  /api/addons/<id>/<path>           answered by the add-on's own service.js (path = what follows the id)
//   GET  /addon/<id>/<file>                a file of the add-on's page (only while it runs); GET /addon/sdk.js is the helper for pages
// An add-on of kind "service" is Node code that runs as root in this process; it gets a small ctx (its folders, its settings, fetch,
// a log line) and a failing one is switched off without touching the rest. Installed add-ons come only from the catalog, file by
// file against the SHA-256 in its index. DISABLE-ADDONS in the CleanYourTV folder (or ADDONS/DISABLE) loads none.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const P = require('./paths'),
  nc = require('./netcompat'),
  web = require('./web'),
  fetch = require('./fetch'),
  version = require('./version');
const { imageType } = require('./wallpapers');
const repos = require('./addonrepos');

const KINDS = ['page', 'service'];
// luna: calls to LG's own services, only the ones the manifest lists ("luna": [{uri, as}]); see addonCtx
const PERMISSIONS = ['net.fetch', 'config.own', 'notify', 'key.guide', 'luna'];
// keys a page keeps for itself; every other key (the number and colour buttons, Back) switches pages or goes back to Home
const CLAIMS = ['digits', 'colors', 'back'];
// what an add-on can provide to a part of the service (wallpapers: photo sources, see helper/wallpapers.js; cards: cards for Home with
// their own page, data and actions, see helper/cardcatalog.js)
const PROVIDES = ['wallpapers', 'cards', 'scenes'];
// where the user may put the page strip ('' leaves it to the theme)
const POSITIONS = ['', 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const ID = /^[a-z][a-z0-9-]{1,31}$/;
const MIME_IMG = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const LUNA_URI = /^luna:\/\/[a-z][\w.-]{2,80}\/[\w/.-]{0,60}$/;
const RESERVED = ['catalog', 'install', 'remove', 'sdk', 'book', 'preview', 'repos', 'update'];
const MAX_PREVIEW = 600 * 1024, // the picture of an add-on (preview.jpg), as for themes
  MAX_FILE = 2 << 20,
  MAX_FILES = 60;
const safeRel = f => typeof f === 'string' && f.length > 0 && f.length < 120 && !/^[\\/]|\.\.|[\0\\]/.test(f);
const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};
// pages run from the service's own address and can reach only themselves and their own API (and media from anywhere)
const PAGE_CSP =
  "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src * blob:; connect-src 'self'";

// The manifest as the loader will use it, or {error}. serviceVersion: the running service's version, for minService.
function check(m, serviceVersion) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: 'addon.json is not an object' };
  if (!ID.test(m.id || '') || RESERVED.indexOf(m.id) >= 0)
    return { error: 'id must be lower-case letters, digits and hyphens (2 to 32), starting with a letter' };
  if (typeof m.name !== 'string' || !m.name || m.name.length > 60) return { error: 'name is missing or too long' };
  if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) return { error: 'version must look like 1.0.0' };
  if (KINDS.indexOf(m.kind) < 0) return { error: 'kind must be "page" or "service"' };
  const entry = m.entry && typeof m.entry === 'object' ? m.entry : {};
  if (m.kind === 'service' && !safeRel(entry.service)) return { error: 'a service add-on needs entry.service (a file in its folder)' };
  if (entry.page !== undefined && !safeRel(entry.page)) return { error: 'entry.page is not a path inside the folder' };
  const perms = Array.isArray(m.permissions) ? m.permissions : [];
  const bad = perms.filter(p => PERMISSIONS.indexOf(p) < 0);
  if (bad.length) return { error: 'unknown permission: ' + String(bad[0]).slice(0, 40) };
  if (m.minService && serviceVersion && version.cmp(serviceVersion, m.minService) < 0)
    return { error: 'needs service ' + m.minService + ' or newer (this is ' + serviceVersion + ')' };
  // old API paths: "/api/live/" (everything below it) or "/api/androidbox" (that path and everything below it)
  const routes = (Array.isArray(m.routes) ? m.routes : []).filter(
    r => /^\/api\/[a-z][a-z0-9-]*\/?$/.test(r) && !/^\/api\/addons\/?$/.test(r)
  );
  const t = m.tile && typeof m.tile === 'object' ? m.tile : null;
  // the calls to LG's services this add-on may make (permission "luna"): [{uri: 'luna://<service>/<method or prefix>', as: <app id to call as>}]
  const luna = [];
  if (m.luna !== undefined || perms.indexOf('luna') >= 0) {
    if (perms.indexOf('luna') < 0) return { error: 'luna needs the permission luna' };
    if (!Array.isArray(m.luna) || !m.luna.length || m.luna.length > 8) return { error: 'luna is a list of 1 to 8 calls' };
    for (const l of m.luna) {
      if (
        !l ||
        typeof l.uri !== 'string' ||
        !/^luna:\/\/[a-z][\w.-]{2,80}\/[\w/.-]{0,60}$/.test(l.uri) ||
        (l.as !== undefined && !/^[\w.-]{3,80}$/.test(String(l.as)))
      )
        return { error: 'a luna call is {uri: "luna://service/method", as: "app id"}' };
      luna.push({ uri: l.uri, as: l.as === undefined ? '' : String(l.as) });
    }
  }
  // cards for Home (provides "cards"): each is checked as a card.json is, with a poll interval and the actions of its buttons
  const cards = [];
  if (m.cards !== undefined) {
    if (!Array.isArray(m.cards) || m.cards.length > 4) return { error: 'cards is a list of at most 4 cards' };
    for (const c of m.cards) {
      const r = require('./cardcatalog').clean(c, '', { addon: true });
      if (r.error) return { error: 'card ' + String((c && c.id) || '?').slice(0, 28) + ': ' + r.error };
      if (cards.some(x => x.id === r.card.id)) return { error: 'two cards have the id ' + r.card.id };
      cards.push(r.card);
    }
  }
  return {
    manifest: {
      id: m.id,
      name: m.name,
      version: m.version,
      kind: m.kind,
      description: typeof m.description === 'string' ? m.description.slice(0, 200) : '',
      about: typeof m.about === 'string' ? m.about.slice(0, 600) : '',
      entry: { service: entry.service, page: entry.page },
      permissions: perms,
      luna,
      routes,
      provides: (Array.isArray(m.provides) ? m.provides : []).filter((c, i, a) => PROVIDES.indexOf(c) >= 0 && a.indexOf(c) === i),
      cards,
      claims: (Array.isArray(m.claims) ? m.claims : []).filter((c, i, a) => CLAIMS.indexOf(c) >= 0 && a.indexOf(c) === i),
      enabledOption: /^[A-Za-z]{2,24}$/.test(m.enabledOption || '') ? m.enabledOption : '',
      tile: t
        ? {
            label: String(t.label || m.name).slice(0, 40),
            icon: String(t.icon || '').slice(0, 30),
            placement: t.placement === 'topbar' || t.placement === 'page' ? t.placement : 'home',
          }
        : null,
    },
  };
}

// the catalog index: entries with a clean id, version and a hash for every file; anything else is dropped
function cleanIndex(raw) {
  const out = [];
  for (const e of raw && Array.isArray(raw.addons) ? raw.addons : []) {
    if (!e || !ID.test(e.id || '') || RESERVED.indexOf(e.id) >= 0 || !/^\d+\.\d+\.\d+$/.test(e.version || '')) continue;
    const files = {};
    let n = 0,
      good = e.files && typeof e.files === 'object';
    for (const f of good ? Object.keys(e.files) : []) {
      if (!safeRel(f) || !/^[0-9a-f]{64}$/.test(e.files[f]) || ++n > MAX_FILES) good = false;
      else files[f] = e.files[f];
    }
    if (!good || !files['addon.json']) continue;
    out.push({
      id: e.id,
      name: String(e.name || e.id).slice(0, 60),
      version: e.version,
      description: String(e.description || '').slice(0, 200),
      about: String(e.about || '').slice(0, 600),
      preview: /^preview\.(?:jpg|png|webp)$/.test(e.preview || '') ? e.preview : '',
      kind: KINDS.indexOf(e.kind) >= 0 ? e.kind : 'page',
      permissions: (Array.isArray(e.permissions) ? e.permissions : []).filter(p => PERMISSIONS.indexOf(p) >= 0),
      // the calls to LG's services it asks for (the uris of luna in its addon.json), so the person can be told before installing
      luna: (Array.isArray(e.luna) ? e.luna : []).filter(u => typeof u === 'string' && LUNA_URI.test(u)).slice(0, 8),
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
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// the helper page: Back goes back to Home, the number and colour buttons switch pages (the launcher listens), and CYTV.api() talks to the add-on's own service part
const SDK = `(function () {
  var m = /^\\/addon\\/([a-z][a-z0-9-]*)\\//.exec(location.pathname), id = m ? m[1] : '';
  function close() { try { parent.postMessage({ cytvAddon: 'close', id: id }, '*'); } catch (e) {} }
  document.addEventListener('keydown', function (e) {
    var t = e.target && e.target.tagName, typing = t === 'INPUT' || t === 'TEXTAREA';
    if (e.keyCode === 461 || e.keyCode === 27 || (e.keyCode === 8 && !typing)) { e.preventDefault(); close(); }
    /* the number and colour buttons switch pages (the launcher decides; a page that keeps them does not use this script) */
    else if (!typing && ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 403 && e.keyCode <= 406))) {
      e.preventDefault();
      try { parent.postMessage({ cytvAddon: 'pagekey', id: id, keyCode: e.keyCode }, '*'); } catch (x) {}
    }
  }, true);
  window.CYTV = {
    id: id,
    close: close,
    api: function (p, body) {
      return fetch('/api/addons/' + id + p, body ? { method: 'POST', body: JSON.stringify(body) } : {}).then(function (r) { return r.json(); });
    }
  };
})();
`;

function create(ctx) {
  const { config } = ctx;
  const list = []; // {id, dir, bundled, manifest, enabled, status, error, mod}
  const readJson = f => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (_) {
      return null;
    }
  };
  const addonsCfg = id => (config.get().addons || {})[id] || {};
  const settingsOf = id => addonsCfg(id).settings || {};
  const enabledOf = a =>
    a.manifest.enabledOption ? config.options()[a.manifest.enabledOption] !== false : addonsCfg(a.id).enabled !== false;
  // whether an add-on is on now: one whose switch is an option (Live TV: options.liveTv) follows that option, also when another screen
  // changes it (the manager's Live TV > Show Live TV); the others keep what was read at start or set with /enable
  const isOn = a => (a.manifest && a.manifest.enabledOption ? enabledOf(a) : a.enabled);
  const find = id => list.filter(x => x.id === id)[0];
  const paused = () => fs.existsSync(path.join(path.dirname(P.ADDONS), 'DISABLE-ADDONS')) || fs.existsSync(path.join(P.ADDONS, 'DISABLE'));

  // the ctx an add-on gets: its folders, its settings, fetch and a log line; not exec, luna or the other parts of the service
  function addonCtx(a) {
    const dataDir = path.join(P.ADDON_DATA, a.id);
    nc.mkdirp(dataDir);
    const perms = a.manifest.permissions;
    const c = {
      id: a.id,
      dir: a.dir,
      dataDir,
      proc: P.PROC, // the TV's /proc, for add-ons that read system counters (the tests move it)
      // a few vetted helpers and settings of the service, for every add-on (not the service's own parts)
      util: { lanIp: web.lanIp, randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: require('./i18n') },
      env: {
        // the language the manager's Language setting chose; while it follows the TV, the one Home is shown in ('' before Home asked)
        lang: () => config.get().lang || require('./i18n').screen() || '',
        wallpaperSize: () => ((config.get().wallpapers || {}).size === 'hd' ? 'hd' : '4k'), // Wallpapers > Picture size
      },
      log: m => console.log('addon ' + a.id + ': ' + String(m).slice(0, 300)),
      settings: {
        get: () => Object.assign({}, settingsOf(a.id)),
        set: obj =>
          config.update('addon:' + a.id, cfg => {
            cfg.addons = cfg.addons || {};
            cfg.addons[a.id] = Object.assign({}, cfg.addons[a.id], { settings: Object.assign({}, (cfg.addons[a.id] || {}).settings, obj) });
          }),
      },
    };
    if (a.bundled) return Object.assign({}, ctx, c); // a bundled add-on is part of the package: it gets the service's own ctx too
    if (perms.indexOf('net.fetch') >= 0) c.fetch = fetch;
    // LG's services, only the calls the manifest lists (a prefix of the uri), and as the app it names: nothing else of the TV
    if (perms.indexOf('luna') >= 0 && ctx.luna) {
      const allowed = a.manifest.luna;
      c.luna = (uri, payload, o) => {
        const e = allowed.filter(x => String(uri).indexOf(x.uri) === 0)[0];
        if (!e) return Promise.resolve({ returnValue: false, errorText: 'this add-on may not call ' + String(uri).slice(0, 80) });
        return ctx.luna(uri, payload, Object.assign({ wait: Math.min(+(o && o.wait) || 5000, 20000) }, e.as ? { appId: e.as } : {}));
      };
    }
    if (perms.indexOf('notify') >= 0 && ctx.feature('notify')) c.notify = body => ctx.feature('notify').show(body);
    return c;
  }

  // read one folder into the list (not started); a bundled add-on wins over an installed one with the same id
  function scanOne(dir, name, bundled) {
    const a = { id: name, dir, bundled, manifest: null, enabled: false, status: 'failed', error: '', mod: null };
    const r = check(readJson(path.join(dir, 'addon.json')), ctx.version);
    if (r.error) a.error = r.error;
    else if (r.manifest.id !== name) a.error = 'the folder name must be the id (' + r.manifest.id + ')';
    else if (find(name)) return null;
    else {
      a.manifest = r.manifest;
      a.enabled = enabledOf(a);
      // an add-on whose switch is an old option (Live TV) stays loaded: the launcher reads the option and the manager's screen needs the service
      a.status = paused() ? 'paused' : a.enabled || a.manifest.enabledOption ? 'ready' : 'off';
      if (a.status === 'paused') a.error = 'DISABLE-ADDONS is present';
    }
    list.push(a);
    return a;
  }

  // create the service part of a ready add-on; a page add-on has none
  function activate(a) {
    if (a.status !== 'ready') return;
    if (a.manifest.kind === 'page') {
      a.status = 'running';
      return;
    }
    try {
      a.mod = require(path.join(a.dir, a.manifest.entry.service)).create(addonCtx(a));
      a.status = 'running';
    } catch (e) {
      a.status = 'failed';
      a.error = String((e && e.message) || e).slice(0, 200);
      console.error('addon ' + a.id + ' failed to load: ' + ((e && e.stack) || e));
    }
  }
  function startOne(a) {
    if (a.status !== 'running' || !a.mod || typeof a.mod.start !== 'function') return;
    try {
      a.mod.start();
    } catch (e) {
      a.status = 'failed';
      a.error = String((e && e.message) || e).slice(0, 200);
      console.error('addon ' + a.id + ' failed to start: ' + ((e && e.stack) || e));
    }
  }

  function load() {
    list.length = 0;
    for (const where of [
      { root: P.ADDONS_BUNDLED, bundled: true },
      { root: P.ADDONS, bundled: false },
    ]) {
      const root = where.root,
        bundled = where.bundled;
      let names = [];
      try {
        names = fs.readdirSync(root).sort();
      } catch (_) {}
      for (const n of names) {
        if (n.charAt(0) === '.') continue; // staging folders
        const dir = path.join(root, n);
        let isDir = false;
        try {
          isDir = fs.statSync(dir).isDirectory();
        } catch (_) {}
        if (isDir) scanOne(dir, n, bundled);
      }
    }
    list.forEach(activate);
  }

  // the book (the launcher's pages): the order the user chose, the pages left out, and whether the strip at the bottom shows
  const bookOf = () => {
    const b = config.get().book || {};
    const ids = v => (Array.isArray(v) ? v : []).filter((x, i, all) => typeof x === 'string' && ID.test(x) && all.indexOf(x) === i);
    return {
      order: ids(b.order),
      hidden: ids(b.hidden),
      strip: b.strip !== false,
      position: POSITIONS.indexOf(b.position) > 0 ? b.position : '',
    };
  };
  const bookable = a => !!(a.manifest && a.manifest.entry.page && a.manifest.tile && a.manifest.tile.placement !== 'home');
  // the pages in book order: the ones named in order first, then the rest as they were loaded
  const pagesInOrder = () => {
    const b = bookOf(),
      all = list.filter(bookable);
    return b.order
      .map(id => all.filter(a => a.id === id)[0])
      .filter(Boolean)
      .concat(all.filter(a => b.order.indexOf(a.id) < 0));
  };
  // the picture of an add-on that is on the TV (it ships in the package folder), or ''
  const previewFile = a => {
    for (const x of ['jpg', 'png', 'webp']) {
      const f = path.join(a.dir, 'preview.' + x);
      if (fs.existsSync(f)) return f;
    }
    return '';
  };
  const baseInfo = a => ({
    id: a.id,
    name: a.manifest ? a.manifest.name : a.id,
    version: a.manifest ? a.manifest.version : '',
    kind: a.manifest ? a.manifest.kind : '',
    description: a.manifest ? a.manifest.description : '',
    about: a.manifest ? a.manifest.about : '',
    preview: !!previewFile(a),
    permissions: a.manifest ? a.manifest.permissions : [],
    enabled: isOn(a),
    status: a.status,
    error: a.error,
    bundled: a.bundled,
    tile: a.manifest ? a.manifest.tile : null,
    claims: a.manifest ? a.manifest.claims : [],
    provides: a.manifest ? a.manifest.provides : [],
    page: a.manifest && a.manifest.entry.page && a.status === 'running' ? '/addon/' + a.id + '/' + a.manifest.entry.page : '',
    bookable: bookable(a),
    inBook: bookable(a) && bookOf().hidden.indexOf(a.id) < 0,
    order: pagesInOrder().indexOf(a), // its place among the pages that can be in the book (-1: not a page)
  });
  // a running add-on whose service has a phone page of its own (settings): the manager offers "Set up from your phone" for it
  const info = a => {
    const out = baseInfo(a);
    if (a.status === 'running' && a.mod && typeof a.mod.settings === 'function') out.settings = true;
    return out;
  };

  // ---- the repositories and their catalogs ----
  // A repository is a folder with index.json and catalog/<id>/<files>; the list is config.json "addonRepos" (helper/addonrepos.js).
  // "official" is the project's own, on the branch of the update channel. An installed add-on remembers its repository in
  // addons/.sources/<id>.json; one without a record (put there by hand, or installed before repositories) counts as official.
  const repoList = () => repos.list(config.get());
  const officialUrl = () => {
    if (process.env.CYTV_ADDONS_URL) return process.env.CYTV_ADDONS_URL;
    const updates = require('./updates');
    return 'https://raw.githubusercontent.com/' + updates.repo() + '/' + updates.catalogRef() + '/addons';
  };
  const baseOf = r => r.url || officialUrl();
  const repoByName = name => repoList().filter(r => r.name === name)[0];
  const sourceFile = id => path.join(P.ADDONS, '.sources', id + '.json');
  const sourceOf = id => {
    const j = readJson(sourceFile(id));
    return j && repos.NAME.test(j.repo || '') ? j.repo : repos.OFFICIAL;
  };
  const get = (url, max) =>
    fetch
      .read(url, {
        headers: { 'User-Agent': 'cleanyourtv-addons' },
        maxBytes: max,
        totalMs: 30000,
        idleMs: 10000,
        redirects: 3,
        // plain http only for the tests' stand-in servers
        allowHttp: () =>
          process.env.CYTV_REPOS_ALLOW_HTTP === '1' || (!!process.env.CYTV_ADDONS_URL && url.indexOf(process.env.CYTV_ADDONS_URL) === 0),
        statusText: st => (st === 404 ? 'not found (404)' : 'the server answered ' + st),
      })
      .then(r => r.body);
  async function index(r) {
    return cleanIndex(JSON.parse((await get(baseOf(r) + '/index.json', 256 * 1024)).toString('utf8')));
  }
  const errText = e => String((e && e.message) || e).slice(0, 160);

  // the given repositories, read at the same time: [{repo, entries} | {repo, error}]
  const indexes = rs =>
    Promise.all(
      rs.map(r =>
        index(r).then(
          entries => ({ repo: r, entries }),
          e => ({ repo: r, error: errText(e) })
        )
      )
    );

  // the add-on as the person is shown it before anything is installed: what it is and what it may do, in plain words
  const brief = (repo, e) => ({
    repo: repo.name,
    id: e.id,
    name: e.name,
    version: e.version,
    kind: e.kind,
    can: repos.describe(e.kind, e.permissions, e.luna),
  });

  // Every repository is read at the same time. The official one decides which ids are its own: another repository cannot offer the id
  // of an official add-on (it could not ship its own "spotify"). When the official one cannot be read, what others offer is not shown
  // (and not installed) until it can: the ids cannot be checked.
  async function allEntries() {
    const all = await indexes(repoList()),
      official = all.filter(x => x.repo.name === repos.OFFICIAL)[0],
      own = {};
    if (official && official.entries) official.entries.forEach(e => (own[e.id] = true));
    const errors = all.filter(x => x.error).map(x => ({ repo: x.repo.name, error: x.error }));
    if (official && official.error && all.length > 1)
      errors.push({ repo: 'others', error: 'what other repositories offer is hidden until the official repository can be read' });
    const out = [];
    for (const x of all) {
      if (x.error) continue;
      const off = x.repo.name === repos.OFFICIAL;
      if (!off && (!official || official.error)) continue;
      for (const e of x.entries) if (off || !own[e.id]) out.push({ repo: x.repo, entry: e });
    }
    return { entries: out, errors, ownedByOfficial: own, officialOk: !!(official && !official.error) };
  }

  async function catalog() {
    const all = await allEntries(),
      out = [];
    for (const { repo, entry: e } of all.entries) {
      const a = find(e.id),
        mine = !!(a && !a.bundled && sourceOf(e.id) === repo.name);
      out.push({
        id: e.id,
        name: e.name,
        version: e.version,
        description: e.description,
        about: e.about,
        preview: !!e.preview,
        kind: e.kind,
        permissions: e.permissions,
        luna: e.luna,
        can: repos.describe(e.kind, e.permissions, e.luna),
        repo: repo.name,
        official: repo.name === repos.OFFICIAL,
        installed: a && a.manifest ? a.manifest.version : '',
        bundled: !!(a && a.bundled),
        // an update comes from the repository the add-on was installed from
        update: !!(mine && a.manifest && version.cmp(e.version, a.manifest.version) > 0),
      });
    }
    return { addons: out, error: all.errors.map(x => x.repo + ': ' + x.error).join('; '), errors: all.errors };
  }

  // the repository an install or a picture comes from: the one named; else the one the add-on is installed from; else the official one;
  // else the only one that has it (two have it: the person must say which)
  /**
   * @param {string} id
   * @param {string} [repoName]
   * @returns {Promise<{repo?: any, entry?: any, error?: string}>}
   */
  async function entryFor(id, repoName) {
    const all = await allEntries();
    if (repoName && !repoByName(repoName)) return { error: 'no such repository: ' + repoName };
    const has = all.entries.filter(x => x.entry.id === id);
    if (repoName) {
      const x = has.filter(y => y.repo.name === repoName)[0];
      if (x) return x;
      if (repoName !== repos.OFFICIAL && all.ownedByOfficial[id])
        return { error: "'" + id + "' is an add-on of the official repository; it cannot be installed from another repository" };
      const err = all.errors.filter(y => y.repo === repoName || y.repo === 'others')[0];
      return { error: err ? err.repo + ': ' + err.error : 'not in the catalog' };
    }
    const src = find(id) && !find(id).bundled ? sourceOf(id) : '';
    const pick = has.filter(x => x.repo.name === src)[0] || has.filter(x => x.repo.name === repos.OFFICIAL)[0];
    if (pick) return pick;
    if (has.length > 1)
      return { error: "'" + id + "' is in several repositories (" + has.map(x => x.repo.name).join(', ') + '): say which one to take' };
    if (has.length) return has[0];
    return { error: all.errors.length ? all.errors[0].repo + ': ' + all.errors[0].error : 'not in the catalog' };
  }

  // the picture of an add-on: from its folder when it is on the TV, else from its repository, kept in add-ons/.previews for a day
  async function preview(id, repoName) {
    const a = find(id),
      own = a && a.dir ? previewFile(a) : '';
    if (own) {
      const b = fs.readFileSync(own);
      return b.length <= MAX_PREVIEW && imageType(b) ? b : null;
    }
    const pd = path.join(P.ADDONS, '.previews'),
      f = path.join(pd, (repoName || '') + '__' + id + '.img');
    let st = null;
    try {
      st = fs.statSync(f);
    } catch (_) {}
    if (st && Date.now() - st.mtimeMs < 86400000) return fs.readFileSync(f);
    try {
      const r = await entryFor(id, repoName || '');
      if (r.error || !r.entry.preview) throw new Error('no picture');
      const b = await get(baseOf(r.repo) + '/catalog/' + id + '/' + r.entry.preview, MAX_PREVIEW);
      if (!imageType(b)) throw new Error('the picture is not an image');
      nc.mkdirp(pd);
      fs.writeFileSync(f + '.part', b);
      fs.renameSync(f + '.part', f);
      return b;
    } catch (_) {
      return st ? fs.readFileSync(f) : null;
    }
  }

  // body.confirm: the person was shown that code from outside the project runs as root on the TV and can read and change anything on
  // it and on the network, that the checksum only shows the file is the one the repository published, and what the add-on may do (the
  // manager, the phone page and cytv-addons show it, with the default on Cancel). The service refuses without it, so no screen or
  // script can skip it by accident. `extra` says what is to be confirmed: the add-on(s), or the repository.
  const needConfirm = extra =>
    Object.assign(
      { error: 'confirm first: code from a repository other than the official one runs as root on your TV', confirm: true },
      extra
    );

  async function install(id, repoName, confirm) {
    const a0 = find(id);
    if (a0 && a0.bundled) return { error: 'this add-on ships with CleanYourTV' };
    const found = await entryFor(id, repoName);
    if (found.error) return { error: found.error };
    const e = found.entry,
      base = baseOf(found.repo);
    if (found.repo.name !== repos.OFFICIAL && confirm !== true) return needConfirm({ addons: [brief(found.repo, e)] });
    const stage = path.join(P.ADDONS, '.staging-' + id),
      old = path.join(P.ADDONS, '.old-' + id),
      dest = path.join(P.ADDONS, id);
    rmrf(stage);
    rmrf(old);
    try {
      for (const f of Object.keys(e.files)) {
        const buf = await get(base + '/catalog/' + id + '/' + f, MAX_FILE);
        if (sha256(buf) !== e.files[f]) throw new Error(f + ' does not match the catalog (nothing was installed)');
        nc.mkdirp(path.dirname(path.join(stage, f)));
        fs.writeFileSync(path.join(stage, f), buf);
      }
      const r = check(readJson(path.join(stage, 'addon.json')), ctx.version);
      if (r.error) throw new Error(r.error);
      if (r.manifest.id !== id || r.manifest.version !== e.version) throw new Error('addon.json does not match the catalog entry');
      // what the person was shown (the index) must be what the add-on asks for
      const same = (x, y) => JSON.stringify(x.slice().sort()) === JSON.stringify(y.slice().sort());
      if (
        r.manifest.kind !== e.kind ||
        !same(r.manifest.permissions, e.permissions) ||
        !same(
          r.manifest.luna.map(l => l.uri),
          e.luna
        )
      )
        throw new Error('addon.json asks for other permissions than the catalog entry lists (nothing was installed)');
      if (r.manifest.kind === 'service' && !fs.existsSync(path.join(stage, r.manifest.entry.service)))
        throw new Error('the service file is missing');
    } catch (err) {
      rmrf(stage);
      return { error: errText(err) };
    }
    nc.mkdirp(P.ADDONS);
    nc.mkdirp(path.dirname(sourceFile(id)));
    fs.writeFileSync(sourceFile(id), JSON.stringify({ repo: found.repo.name, version: e.version }));
    const had = fs.existsSync(dest);
    if (had) fs.renameSync(dest, old);
    fs.renameSync(stage, dest);
    rmrf(old);
    // a new add-on starts now; one that was loaded before keeps its old code until the service restarts
    if (had) {
      const a = find(id);
      if (a && a.manifest && a.manifest.kind === 'page') {
        list.splice(list.indexOf(a), 1);
        const n = scanOne(dest, id, false);
        if (n) activate(n);
        return { id, version: e.version, repo: found.repo.name, restartNeeded: false };
      }
      return { id, version: e.version, repo: found.repo.name, restartNeeded: true };
    }
    const n = scanOne(dest, id, false);
    if (n) {
      activate(n);
      startOne(n);
      handOver();
    }
    return { id, version: e.version, repo: found.repo.name, restartNeeded: false };
  }

  // install the newer version of what is installed (one add-on, or all), each from the repository it came from. Nothing is installed
  // until the confirm is given for everything that comes from a repository other than the official one.
  async function updateAll(only, confirm) {
    const c = await catalog(),
      todo = c.addons.filter(x => x.update && (!only || x.id === only)),
      done = [],
      failed = [];
    const other = todo.filter(x => !x.official);
    if (other.length && confirm !== true)
      return needConfirm({
        addons: other.map(x => ({ repo: x.repo, id: x.id, name: x.name, version: x.version, kind: x.kind, can: x.can })),
      });
    let restartNeeded = false;
    for (const e of todo) {
      const r = await install(e.id, e.repo, confirm);
      if (r.error) failed.push({ id: e.id, error: r.error });
      else {
        done.push({ id: e.id, version: r.version });
        restartNeeded = restartNeeded || r.restartNeeded;
      }
    }
    return { updated: done, failed, restartNeeded, errors: c.errors };
  }

  // ---- the list of repositories ----
  const repoInfo = r => ({ name: r.name, url: baseOf(r), official: r.name === repos.OFFICIAL });
  const phone = require('./addonrepophone').create({
    list: () => repoList().map(repoInfo),
    add: (spec, name, confirm) => addRepo(spec, name, confirm),
    remove: name => removeRepo(name),
    lanIp: web.lanIp,
    lang: () => config.get().lang || '',
  });
  function addRepo(spec, name, confirm) {
    const p = repos.parseSpec(spec);
    if (p.error) return { error: p.error };
    if (confirm !== true) return needConfirm({ repoAddress: p.url });
    const nm = name === undefined || name === '' ? p.name : String(name);
    if (!repos.NAME.test(nm) || nm === repos.OFFICIAL) return { error: 'the name is lower case letters, digits, . _ - (at most 40)' };
    const cur = repoList();
    if (cur.some(r => r.name === nm)) return { error: 'a repository named ' + nm + ' is already in the list' };
    if (cur.some(r => r.url === p.url)) return { error: 'that repository is already in the list' };
    config.update('addon-repos', cfg => {
      cfg.addonRepos = cur.concat([{ name: nm, url: p.url }]);
    });
    return { repos: repoList().map(repoInfo), added: nm };
  }
  function removeRepo(name) {
    if (name === repos.OFFICIAL) return { error: 'the official repository cannot be removed' };
    const cur = repoList();
    if (!cur.some(r => r.name === name)) return { error: 'no such repository: ' + name };
    config.update('addon-repos', cfg => {
      cfg.addonRepos = cur.filter(r => r.name !== name);
    });
    // what was installed from it stays installed (and keeps its record: it can be removed, not updated)
    return { repos: repoList().map(repoInfo), removed: name };
  }

  function remove(id) {
    const a = find(id);
    if (!a) return { error: 'not installed' };
    if (a.bundled) return { error: 'this add-on ships with CleanYourTV; switch it off instead' };
    rmrf(a.dir);
    try {
      fs.unlinkSync(sourceFile(id));
    } catch (_) {}
    const wasService = !!a.mod;
    list.splice(list.indexOf(a), 1);
    return { id, restartNeeded: wasService };
  }

  // ---- the add-on's page ----
  function sendFile(res, a, rel) {
    const root = a.dir,
      file = path.normalize(path.join(root, rel || ''));
    const isService = a.manifest.entry.service && path.normalize(path.join(root, a.manifest.entry.service)) === file;
    if (file.indexOf(root + path.sep) !== 0 || isService || path.basename(file) === 'addon.json') return web.notFound(res);
    let st;
    try {
      st = fs.statSync(file);
    } catch (_) {
      return web.notFound(res);
    }
    if (!st.isFile()) return web.notFound(res);
    const ext = path.extname(file).slice(1).toLowerCase();
    res.writeHead(200, {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': PAGE_CSP,
    });
    fs.createReadStream(file).pipe(res);
  }

  // the old API paths a bundled add-on still answers (manifest "routes"); only while it runs
  const under = (r, u) => (r.charAt(r.length - 1) === '/' ? u.indexOf(r) === 0 : u === r || u.indexOf(r + '/') === 0);
  const legacy = u => list.filter(a => a.bundled && a.status === 'running' && a.mod && a.manifest.routes.some(r => under(r, u)))[0];
  // may the page of add-on `id` call this path? Its bundled add-on's old API paths (Live TV's page calls /api/live/)
  const pageMay = (id, u) => list.some(a => a.id === id && a.bundled && a.status === 'running' && a.manifest.routes.some(r => under(r, u)));
  const match = u => u.indexOf('/api/addons') === 0 || u.indexOf('/addon/') === 0 || !!legacy(u);

  async function viaAddon(a, req, res, sub, body) {
    try {
      return await a.mod.handle(req, res, sub, body);
    } catch (e) {
      console.error('addon ' + a.id + ': ' + sub + ': ' + ((e && e.stack) || e));
      if (!res.headersSent) web.json(res, { error: 'the add-on failed: ' + String((e && e.message) || e).slice(0, 200) }, 500);
      else res.end();
    }
  }

  async function handle(req, res, u, body) {
    const old = legacy(u);
    if (old) return viaAddon(old, req, res, u, body); // an old path: the add-on sees the whole path
    if (u === '/addon/sdk.js') {
      res.writeHead(200, { 'content-type': TYPES.js, 'cache-control': 'no-cache' });
      return res.end(SDK);
    }
    const pg = /^\/addon\/([a-z][a-z0-9-]*)\/(.*)$/.exec(u);
    if (pg) {
      const a = find(pg[1]);
      if (!a || a.status !== 'running' || !a.manifest.entry.page || req.method !== 'GET') return web.notFound(res);
      let rel = '';
      try {
        rel = decodeURIComponent(pg[2]);
      } catch (_) {
        return web.notFound(res);
      }
      return sendFile(res, a, rel || a.manifest.entry.page);
    }
    if (u === '/api/addons' && req.method === 'GET') return web.json(res, { addons: list.map(info), paused: paused(), book: bookOf() });
    if (u === '/api/addons/book' && req.method === 'POST') {
      const b = await body(req),
        known = list.filter(bookable).map(a => a.id),
        pick = v => (Array.isArray(v) ? v : []).filter((x, i, all) => known.indexOf(x) >= 0 && all.indexOf(x) === i);
      config.update('addons', cfg => {
        const cur = Object.assign({ order: [], hidden: [], strip: true, position: '' }, cfg.book);
        cfg.book = {
          order: Array.isArray(b.order) ? pick(b.order) : cur.order,
          hidden: Array.isArray(b.hidden) ? pick(b.hidden) : cur.hidden,
          strip: typeof b.strip === 'boolean' ? b.strip : cur.strip !== false,
          position: POSITIONS.indexOf(b.position) >= 0 ? b.position : POSITIONS.indexOf(cur.position) > 0 ? cur.position : '',
        };
      });
      return web.json(res, { book: bookOf() });
    }
    if (u === '/api/addons/catalog' && req.method === 'GET') return web.json(res, await catalog());
    if (u === '/api/addons/repos' && req.method === 'GET') return web.json(res, { repos: repoList().map(repoInfo) });
    // the phone page for adding a repository (port 8800): {url, code, qr, seconds}, or {stop: true} to close it
    if (u === '/api/addons/repos/phone' && req.method === 'POST') {
      const b = await body(req);
      return web.json(res, await phone.start(b && typeof b === 'object' ? b : {}));
    }
    if (u === '/api/addons/repos' && req.method === 'POST') {
      const b = await body(req);
      const r =
        typeof b.add === 'string'
          ? addRepo(b.add, b.name, b.confirm)
          : typeof b.remove === 'string'
            ? removeRepo(b.remove)
            : { error: 'add or remove' };
      return web.json(res, r, r.error ? 400 : 200);
    }
    if (u === '/api/addons/update' && req.method === 'POST') {
      const b = await body(req);
      if (b.id !== undefined && !ID.test(b.id || '')) return web.json(res, { error: 'bad id' }, 400);
      const r = await updateAll(b.id, b.confirm);
      return web.json(res, r, r.error ? 400 : 200);
    }
    const pm = /^\/api\/addons\/preview\/([a-z][a-z0-9-]*)$/.exec(u);
    if (pm && req.method === 'GET') {
      const b = await preview(pm[1], (/[?&]repo=([a-z0-9._-]+)/.exec(req.url || '') || [])[1]);
      if (!b) return web.notFound(res);
      res.writeHead(200, { 'content-type': MIME_IMG[imageType(b)], 'cache-control': 'max-age=600', 'x-content-type-options': 'nosniff' });
      return res.end(b);
    }
    if ((u === '/api/addons/install' || u === '/api/addons/remove') && req.method === 'POST') {
      const b = await body(req);
      if (!ID.test(b.id || '')) return web.json(res, { error: 'bad id' }, 400);
      const r = u === '/api/addons/install' ? await install(b.id, typeof b.repo === 'string' ? b.repo : '', b.confirm) : remove(b.id);
      return web.json(res, r, r.error ? 400 : 200);
    }
    const m = /^\/api\/addons\/([a-z][a-z0-9-]*)(\/.*)?$/.exec(u);
    const a = m && find(m[1]);
    if (!a) return web.notFound(res);
    if (!m[2]) return web.json(res, info(a));
    if (m[2] === '/enable' && req.method === 'POST') {
      const b = await body(req);
      if (typeof b.enabled !== 'boolean') return web.json(res, { error: 'enabled must be true or false' }, 400);
      if (!a.manifest) return web.json(res, { error: 'this add-on cannot be switched on: ' + a.error }, 400);
      const opt = a.manifest.enabledOption,
        changed = b.enabled !== isOn(a);
      config.update('addon:' + a.id, cfg => {
        if (opt) cfg.options = Object.assign({}, cfg.options, { [opt]: b.enabled });
        else {
          cfg.addons = cfg.addons || {};
          cfg.addons[a.id] = Object.assign({}, cfg.addons[a.id], { enabled: b.enabled });
        }
      });
      a.enabled = b.enabled;
      if (a.manifest.kind === 'page' && a.status !== 'paused') {
        a.status = b.enabled ? 'running' : 'off';
        return web.json(res, { id: a.id, enabled: b.enabled, restartNeeded: false });
      }
      // an add-on switched by an option stays loaded and the launcher reads the option: no restart for it
      return web.json(res, { id: a.id, enabled: b.enabled, restartNeeded: changed && !opt });
    }
    // the add-on's phone page (settings in its service, like a photo source's): the manager shows "Set up from your phone" for it
    if (m[2] === '/settings' && req.method === 'POST' && a.status === 'running' && a.mod && typeof a.mod.settings === 'function') {
      const b = await body(req);
      try {
        return web.json(res, (await a.mod.settings(b && typeof b === 'object' ? b : {})) || {});
      } catch (e) {
        return web.json(res, { error: String((e && e.message) || e).slice(0, 160) });
      }
    }
    if (a.status !== 'running' || !a.mod || typeof a.mod.handle !== 'function') return web.notFound(res);
    return viaAddon(a, req, res, m[2], body);
  }

  // a part of the service that kept something an add-on now looks after (the Wallpapers of Immich) hands it over once
  const handOver = () => {
    const w = ctx.feature && ctx.feature('wallpapers');
    if (w && typeof w.adoptLegacy === 'function') Promise.resolve(w.adoptLegacy()).catch(() => {});
  };

  function start() {
    load();
    list.forEach(startOne);
    handOver();
  }

  // the service part of a running add-on (the launch hook in apps.js asks the Android box for it)
  const module = id => {
    const a = find(id);
    return a && a.status === 'running' && a.mod ? a.mod : null;
  };

  // the running, switched-on add-ons that provide something ("provides" in their manifest): [{id, name, mod}]
  const providers = what =>
    list
      .filter(a => a.manifest && a.status === 'running' && isOn(a) && a.mod && a.manifest.provides.indexOf(what) >= 0)
      .map(a => ({ id: a.id, name: a.manifest.name, mod: a.mod }));

  // the cards of the running, switched-on add-ons that provide "cards": [{addon, dir, mod, card}]
  const cardsOf = () => {
    const out = [];
    for (const a of providers('cards'))
      for (const c of find(a.id).manifest.cards) out.push({ addon: a.id, dir: find(a.id).dir, mod: a.mod, card: c });
    return out;
  };

  return {
    name: 'addons',
    prefix: '/api/addons',
    match,
    pageMay,
    module,
    providers,
    cardsOf,
    handle,
    start,
    load,
    list: () => list.map(info),
  };
}

module.exports = { create, check, cleanIndex, KINDS, PERMISSIONS };
