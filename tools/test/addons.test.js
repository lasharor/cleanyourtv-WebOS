// Add-ons (addons.js): the manifest check, the loader (a good one, a broken one, one that is off, DISABLE-ADDONS) and the routes.
const fs = require('fs'),
  path = require('path');
const crypto = require('crypto');
const { ok, call, fake, req, run, tmp, serve } = require('./lib');

run(async () => {
  // paths.js reads these when it first loads (with the loader below)
  process.env.CYTV_ADDONS = path.join(tmp, 'addons');
  process.env.CYTV_ADDON_DATA = path.join(tmp, 'addon-data');
  process.env.CYTV_ADDONS_BUNDLED = path.join(tmp, 'bundled');
  const addons = req('addons');
  const good = {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    kind: 'service',
    entry: { service: 'service.js' },
    permissions: ['net.fetch'],
  };
  ok(addons.check(good, '1.6.11').manifest.id === 'demo', 'a good manifest is accepted');
  const bad = (patch, re, name) => {
    const r = addons.check(Object.assign({}, good, patch), '1.6.11');
    ok(r.error && re.test(r.error), name + ': ' + (r.error || 'accepted'));
  };
  bad({ id: 'Bad Id' }, /id must/, 'an id with capitals or spaces is refused');
  bad({ kind: 'root' }, /kind/, 'an unknown kind is refused');
  bad({ entry: { service: '../x.js' } }, /entry\.service/, 'a service file outside the folder is refused');
  bad({ entry: { service: 'a.js', page: '/etc/passwd' } }, /entry\.page/, 'an absolute page path is refused');
  bad({ permissions: ['exec'] }, /unknown permission/, 'a permission that does not exist is refused');
  bad({ minService: '9.0.0' }, /needs service 9\.0\.0/, 'a newer service is asked for');
  ok(addons.check(null).error && addons.check([]).error, 'a manifest that is not an object is refused');
  ok(
    addons.check(Object.assign({}, good, { about: 'x'.repeat(700) }), '1.6.11').manifest.about.length === 600 &&
      addons.check(good, '1.6.11').manifest.about === '',
    'the longer text of an add-on (about) is kept, at most 600 characters'
  );

  // folders: demo (works), broken (throws at load), later (off), wrongname (id differs from the folder), plain file
  const dir = path.join(tmp, 'addons');
  fs.mkdirSync(dir);
  const put = (name, manifest, code) => {
    const d = path.join(dir, name);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'addon.json'), JSON.stringify(manifest));
    if (code) fs.writeFileSync(path.join(d, 'service.js'), code);
  };
  const svc = id => ({ id, name: id, version: '1.0.0', kind: 'service', entry: { service: 'service.js' }, permissions: [] });
  put(
    'demo',
    svc('demo'),
    'exports.create = c => ({ handle: (req, res, p) => { res.writeHead(200); res.end(JSON.stringify({ p, id: c.id, hasExec: !!c.exec, hasFetch: !!c.fetch })); } });'
  );
  put('broken', svc('broken'), "exports.create = () => { throw new Error('boom'); };");
  put('later', svc('later'), "exports.create = () => ({ handle: (q, r) => r.end('{}') });");
  put('wrongname', svc('other'), '');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  // a bundled add-on that still answers an old API path, enabled by an option
  const bdir = path.join(tmp, 'bundled', 'old');
  req('netcompat').mkdirp(bdir);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);
  fs.writeFileSync(path.join(bdir, 'preview.png'), PNG); // the picture of a bundled add-on ships in its folder
  fs.writeFileSync(
    path.join(bdir, 'addon.json'),
    JSON.stringify({
      id: 'old',
      name: 'Old',
      version: '1.0.0',
      kind: 'service',
      entry: { service: 's.js' },
      routes: ['/api/oldpath/', '/api/exact', '/api/addons/'],
      enabledOption: 'tuner',
    })
  );
  fs.writeFileSync(
    path.join(bdir, 's.js'),
    'exports.create = () => ({ handle: (q, r, p) => { r.writeHead(200); r.end(JSON.stringify({ full: p })); } });'
  );

  const cfg = req('config').memory({ addons: { later: { enabled: false } } });
  // the service of this tree (the catalog's add-ons ask for the service they need)
  const SVC = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'helper', 'helper.js'), 'utf8'))[1];
  const lunaCalls = [];
  const fakeLuna = async (uri, payload, o) => (lunaCalls.push({ uri, payload, o }), { returnValue: true });
  const a = addons.create({ config: cfg, version: SVC, feature: () => null, luna: fakeLuna });
  a.start();
  const by = id => a.list().filter(x => x.id === id)[0];
  ok(by('demo').status === 'running' && by('demo').enabled, 'a good add-on runs');
  ok(
    by('broken').status === 'failed' && /boom/.test(by('broken').error),
    'an add-on that throws is failed, the others still load: ' + by('broken').error
  );
  ok(by('later').status === 'off', 'an add-on switched off in config.json is not loaded');
  ok(by('wrongname').status === 'failed' && /folder name/.test(by('wrongname').error), 'the folder name must be the id');
  ok(!by('notes.txt'), 'a plain file in the folder is ignored');

  let r = await call(a, '/api/addons');
  ok(r.code === 200 && r.j.addons.length === 5, 'GET /api/addons lists them');
  r = await call(a, '/api/addons/demo/hello');
  const j = r.j;
  ok(
    j.p === '/hello' && j.id === 'demo' && j.hasExec === false && j.hasFetch === false,
    'a request reaches the add-on; it gets no exec, and no fetch without the permission'
  );
  r = await call(a, '/api/addons/broken/x');
  ok(r.code === 404, 'a failed add-on answers nothing');
  r = await call(a, '/api/addons/nope');
  ok(r.code === 404, 'an unknown add-on is not found');
  r = await call(a, '/api/addons/later/enable', 'POST', { enabled: true });
  ok(r.j.restartNeeded === true && cfg.get().addons.later.enabled === true, 'switching on is stored and asks for a restart of the service');
  r = await call(a, '/api/addons/later/enable', 'POST', { enabled: 'yes' });
  ok(r.code === 400, 'enabled must be a boolean');

  fs.writeFileSync(path.join(path.dirname(dir), 'DISABLE-ADDONS'), '');
  a.load();
  ok(a.list().every(x => x.status === 'paused' || x.status === 'failed') && by('demo').status === 'paused', 'DISABLE-ADDONS loads none');
  // ---- the old path of a bundled add-on, page serving, the catalog ----
  fs.unlinkSync(path.join(path.dirname(dir), 'DISABLE-ADDONS'));
  cfg.update('test', c => {
    c.options = { tuner: true };
  });
  a.load();
  ok(by('old') && by('old').bundled && by('old').status === 'running', 'a bundled add-on runs (enabled by its option)');
  r = await call(a, '/api/oldpath/status');
  ok(r.j && r.j.full === '/api/oldpath/status', 'an old API path reaches the bundled add-on with the whole path');
  r = await call(a, '/api/exact');
  ok(r.j && r.j.full === '/api/exact', 'a route without a trailing slash answers that path');
  r = await call(a, '/api/exact/apps');
  ok(r.j && r.j.full === '/api/exact/apps', 'and the paths below it');
  r = await call(a, '/api/exactly');
  ok(r.code === 404, 'but not a path that only starts with the same letters');
  ok(
    a.module('old') && typeof a.module('old').handle === 'function' && a.module('nope') === null,
    'the loader gives the service part of a running add-on'
  );
  r = await call(a, '/api/addons/old/enable', 'POST', { enabled: false });
  ok(cfg.options().tuner === false, 'switching an add-on with an option writes the option');
  a.load();
  r = await call(a, '/api/oldpath/status');
  ok(
    r.code === 200 && !by('old').enabled,
    'switched off by its option, it stays loaded (the launcher reads the option) and shows as not enabled'
  );
  // the same option changed on another screen (the manager's Live TV > Show Live TV): the add-on follows it at once
  cfg.update('manager', c => {
    c.options = Object.assign({}, c.options, { tuner: true });
  });
  r = await call(a, '/api/addons/old');
  ok(r.j.enabled === true, 'an option switched on elsewhere shows the add-on as on, without a restart');
  r = await call(a, '/api/addons/old/enable', 'POST', { enabled: false });
  const r7 = await call(a, '/api/addons/old/enable', 'POST', { enabled: true });
  ok(
    r.j.restartNeeded === false &&
      r7.j.restartNeeded === false &&
      cfg.options().tuner === true &&
      (await call(a, '/api/addons/old')).j.enabled,
    'switching it with its own switch needs no restart either (it stays loaded) and is saved'
  );
  ok(
    !a.list().filter(x => x.id === 'old')[0].page && a.match('/api/addons') && a.match('/addon/x/y') && !a.match('/api/live/x'),
    'match: the add-on paths only'
  );
  const live = req('addons').check(
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'helper', 'addons-bundled', 'iptv', 'addon.json'), 'utf8')),
    '1.6.11'
  );
  ok(
    live.manifest && live.manifest.routes[0] === '/api/live/' && live.manifest.enabledOption === 'liveTv',
    'Live TV ships as the bundled add-on iptv, answering /api/live/'
  );

  const server = req('server');
  // a bundled add-on's page may call its old API paths (Live TV's page calls /api/live/), nobody else's page may
  const may = (id, u) => a.pageMay(id, u);
  const ref = 'http://127.0.0.1:8765/addon/old/page/index.html';
  ok(
    server.addonPageCall({ headers: { host: '127.0.0.1:8765', referer: ref } }, 'http://127.0.0.1:8765', '/api/oldpath/x', may),
    'the page of a bundled add-on calls its old API path'
  );
  ok(
    !server.addonPageCall(
      { headers: { host: '127.0.0.1:8765', referer: 'http://127.0.0.1:8765/addon/pg/index.html' } },
      'http://127.0.0.1:8765',
      '/api/oldpath/x',
      may
    ),
    "another add-on's page does not"
  );
  ok(
    !server.addonPageCall({ headers: { host: '127.0.0.1:8765' } }, 'http://127.0.0.1:8765', '/api/oldpath/x', may),
    'a call without a page as Referer does not'
  );
  const abm = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'helper', 'addons-bundled', 'androidbox', 'addon.json'), 'utf8'));
  const abc = addons.check(abm, '1.6.12');
  ok(
    abc.manifest && abc.manifest.routes.join() === '/api/androidbox' && abc.manifest.kind === 'service',
    'the Android box ships as the bundled add-on androidbox, answering /api/androidbox'
  );
  const icm = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'helper', 'addons-bundled', 'icons', 'addon.json'), 'utf8'));
  const icc = addons.check(icm, '1.6.12');
  ok(
    icc.manifest && icc.manifest.routes.join() === '/api/icons' && icc.manifest.kind === 'service',
    'App icons ship as the bundled add-on icons, answering /api/icons'
  );
  const iptvDir = path.join(__dirname, '..', '..', 'helper', 'addons-bundled', 'iptv');
  ok(
    fs.existsSync(path.join(iptvDir, 'page', 'index.html')) &&
      JSON.parse(fs.readFileSync(path.join(iptvDir, 'addon.json'), 'utf8')).entry.page === 'page/index.html',
    'the iptv add-on has its built page (node tools/build-pages.js)'
  );

  // the catalog in the repository: addons/index.json is current, and its add-ons pass the same checks as an install
  const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'addons', 'index.json'), 'utf8'));
  ok(
    require('../addon-index').build() === JSON.stringify(idx, null, 2) + '\n',
    'addons/index.json matches addons/catalog (run node tools/addon-index.js)'
  );
  ok(
    req('addons').cleanIndex(idx).length === idx.addons.length && idx.addons.length >= 1,
    'every catalog entry is clean: id, version and a hash per file'
  );
  idx.addons.forEach(e => {
    const m = req('addons').check(
      JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'addons', 'catalog', e.id, 'addon.json'), 'utf8')),
      /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'helper', 'helper.js'), 'utf8'))[1] // the service of this tree
    );
    ok(m.manifest && m.manifest.version === e.version, 'catalog add-on ' + e.id + ' has a valid manifest');
  });

  // page serving
  const pdir = path.join(dir, 'pg');
  req('netcompat').mkdirp(path.join(pdir, 'sub'));
  fs.writeFileSync(
    path.join(pdir, 'addon.json'),
    JSON.stringify({
      id: 'pg',
      name: 'Pg',
      version: '1.0.0',
      kind: 'page',
      entry: { page: 'index.html' },
      tile: { label: 'Pg', placement: 'topbar' },
    })
  );
  fs.writeFileSync(path.join(pdir, 'index.html'), '<p>hi</p>');
  fs.writeFileSync(path.join(pdir, 'sub', 'a.css'), 'a{}');
  a.load();
  const http = require('http');
  const web = await serve((rq, rs) => a.handle(rq, rs, rq.url.split('?')[0], async () => ({})));
  const fetchPage = p =>
    new Promise(rs =>
      http.get(web.url + p, res => {
        let b = '';
        res.on('data', d => (b += d));
        res.on('end', () =>
          rs({ code: res.statusCode, type: res.headers['content-type'], csp: res.headers['content-security-policy'], body: b })
        );
      })
    );
  let g = await fetchPage('/addon/pg/index.html');
  ok(
    g.code === 200 && /text\/html/.test(g.type) && g.body === '<p>hi</p>' && /connect-src 'self'/.test(g.csp),
    'the page is served with its type and a policy that keeps it to itself'
  );
  g = await fetchPage('/addon/pg/');
  ok(g.code === 200 && g.body === '<p>hi</p>', 'the folder address gives the entry page');
  g = await fetchPage('/addon/pg/sub/a.css');
  ok(g.code === 200 && /text\/css/.test(g.type), 'files in folders are served');
  g = await fetchPage('/addon/pg/..%2Fdemo%2Fservice.js');
  ok(g.code === 404, 'a path out of the folder is refused');
  g = await fetchPage('/addon/demo/service.js');
  ok(g.code === 404, 'a service add-on has no page and its code is not served');
  g = await fetchPage('/addon/pg/addon.json');
  ok(g.code === 404, 'addon.json is not served');
  g = await fetchPage('/addon/sdk.js');
  ok(g.code === 200 && /cytvAddon/.test(g.body), 'the helper script for pages is served');
  ok(
    a.list().filter(x => x.id === 'pg')[0].page === '/addon/pg/index.html' &&
      a.list().filter(x => x.id === 'pg')[0].tile.placement === 'topbar',
    'the list gives the page address and the tile'
  );
  ok(
    addons
      .check(Object.assign({}, good, { claims: ['digits', 'x', 'digits'], tile: { label: 'T', placement: 'page' } }))
      .manifest.claims.join() === 'digits' && addons.check(good).manifest.tile === null,
    'claims are the known ones, once each; the tile placement page is kept'
  );
  r = await call(a, '/api/addons/pg/enable', 'POST', { enabled: false });
  g = await fetchPage('/addon/pg/index.html');
  ok(r.j.restartNeeded === false && g.code === 404, 'a page add-on switched off stops being served at once');
  web.server.close();

  // origin rule for the pages' own calls
  const pc = (host, origin, u, ref) => server.addonPageCall({ headers: { host, referer: ref } }, origin, u);
  ok(
    pc('127.0.0.1:8765', 'http://127.0.0.1:8765', '/api/addons/pg/x', 'http://127.0.0.1:8765/addon/pg/index.html'),
    'a page may call its own API'
  );
  ok(
    !pc('127.0.0.1:8765', 'http://127.0.0.1:8765', '/api/addons/other/x', 'http://127.0.0.1:8765/addon/pg/index.html'),
    "but not another add-on's"
  );
  ok(
    !pc('127.0.0.1:8765', 'http://127.0.0.1:8765', '/api/addons/install', 'http://127.0.0.1:8765/addon/pg/index.html'),
    'not install or remove'
  );
  ok(
    !pc('127.0.0.1:8765', 'http://127.0.0.1:8765', '/api/live/status', 'http://127.0.0.1:8765/addon/pg/index.html'),
    'not the rest of the API'
  );
  ok(
    !pc('evil.example:8765', 'http://evil.example:8765', '/addon/pg/index.html'),
    'a page from another host name is refused (DNS rebinding)'
  );
  ok(
    !pc('127.0.0.1:8765', 'http://evil.example', '/api/addons/pg/x', 'http://127.0.0.1:8765/addon/pg/'),
    'an origin that is not the service is refused'
  );

  // the book: order, pages left out, the strip
  a.load();
  r = await call(a, '/api/addons');
  const bookable = r.j.addons.filter(x => x.bookable).map(x => x.id);
  ok(
    bookable.indexOf('pg') >= 0 && r.j.book.strip === true && r.j.book.order.length === 0,
    'GET /api/addons has the book, and pages that can be in it'
  );
  r = await call(a, '/api/addons/book', 'POST', { order: ['pg', 'nope', 'pg'], hidden: ['x'], strip: false });
  ok(
    JSON.stringify(r.j.book.order) === '["pg"]' &&
      r.j.book.hidden.length === 0 &&
      r.j.book.strip === false &&
      cfg.get().book.strip === false,
    'the book keeps known pages, once each, and the strip setting: ' + r.out
  );
  r = await call(a, '/api/addons');
  ok(
    r.j.addons.filter(x => x.id === 'pg')[0].order === 0 && r.j.addons.filter(x => x.id === 'pg')[0].inBook,
    'a page in the order has its place'
  );
  r = await call(a, '/api/addons/book', 'POST', { hidden: ['pg'] });
  r = await call(a, '/api/addons');
  ok(
    !r.j.addons.filter(x => x.id === 'pg')[0].inBook && r.j.book.order[0] === 'pg',
    'a hidden page is out of the book and keeps its order'
  );

  // the catalog's own add-ons
  const dnsc = require(path.join(__dirname, '..', '..', 'addons', 'catalog', 'dnscheck', 'service.js'));
  ok(
    dnsc.classify(null, [{ address: '0.0.0.0' }]).state === 'blocked' &&
      dnsc.classify(null, [{ address: '127.0.0.1' }, { address: '::' }]).state === 'blocked',
    'dnscheck: 0.0.0.0, 127.x and :: count as blocked'
  );
  ok(
    dnsc.classify({ code: 'ENOTFOUND' }).state === 'blocked' && dnsc.classify(null, []).state === 'blocked',
    'dnscheck: a name that does not exist is blocked'
  );
  ok(
    dnsc.classify(null, [{ address: '93.184.216.34' }]).state === 'reachable' &&
      dnsc.classify(null, [{ address: '0.0.0.0' }, { address: '1.2.3.4' }]).state === 'reachable',
    'dnscheck: a real address means reachable'
  );
  ok(
    JSON.stringify(dnsc.cleanHosts(['Ads.Example.net', 'ads.example.net', 'bad host', 'nl.ad.lgsmartad.com', 'x', 5])) ===
      '["ads.example.net"]',
    'dnscheck: your hosts are valid names, once, not the built-in ones'
  );
  const sysi = require(path.join(__dirname, '..', '..', 'addons', 'catalog', 'sysinfo', 'service.js'));
  const procFiles = {
    meminfo: 'MemTotal:  1000000 kB\nMemFree: 100000 kB\nMemAvailable: 400000 kB\nSwapTotal: 700000 kB\nSwapFree: 500000 kB\n',
    loadavg: '0.50 0.40 0.30 1/200 999\n',
    uptime: '4333.08 100.00\n',
  };
  const sx = sysi.stats(f => procFiles[f]);
  ok(
    sx.memTotalMB === 977 && sx.memUsedMB === 586 && sx.swapUsedMB === 195 && sx.load[0] === 0.5 && sx.uptimeS === 4333,
    'sysinfo: memory, swap, load and uptime from /proc text: ' + JSON.stringify(sx)
  );
  ok(sysi.stats(() => '').memTotalMB === 0, 'sysinfo: an unreadable /proc gives zeros, not an error');

  // where the strip is: the user's choice, known places only
  r = await call(a, '/api/addons/book', 'POST', { position: 'top-right' });
  ok(r.j.book.position === 'top-right' && cfg.get().book.position === 'top-right', 'the user can put the page strip in one of six places');
  r = await call(a, '/api/addons/book', 'POST', { position: 'middle-left' });
  ok(r.j.book.position === 'top-right', 'a place that does not exist changes nothing: ' + r.out);
  r = await call(a, '/api/addons/book', 'POST', { strip: false });
  ok(r.j.book.position === 'top-right' && r.j.book.strip === false, 'other settings leave the place alone');
  r = await call(a, '/api/addons/book', 'POST', { position: '', strip: true });
  r = await call(a, '/api/addons');
  ok(r.j.book.position === '' && r.j.book.strip === true, 'an empty place leaves it to the theme');

  // what an add-on can provide to a part of the service: only known things, and only running, switched-on add-ons are listed
  ok(
    addons.check(Object.assign({}, good, { provides: ['wallpapers', 'x', 'wallpapers'] })).manifest.provides.join() === 'wallpapers' &&
      addons.check(good).manifest.provides.length === 0,
    'provides keeps the known things, once each'
  );
  put(
    'src',
    Object.assign(svc('src'), { provides: ['wallpapers'] }),
    "exports.create = () => ({ wallpapers: { label: 'Src', list: () => [] }, handle: (q, r) => r.end('{}') });"
  );
  put(
    'srcoff',
    Object.assign(svc('srcoff'), { provides: ['wallpapers'] }),
    "exports.create = () => ({ wallpapers: {}, handle: (q, r) => r.end('{}') });"
  );
  cfg.update('test', c => {
    c.addons = Object.assign({}, c.addons, { srcoff: { enabled: false } });
  });
  a.load();
  ok(
    a
      .providers('wallpapers')
      .map(x => x.id)
      .join() === 'src' && a.providers('wallpapers')[0].mod.wallpapers.label === 'Src',
    'providers(what) gives the running, switched-on add-ons that provide it, with their module'
  );
  ok(a.providers('nothing').length === 0, 'and nothing for what nobody provides');

  // permission "luna": the manifest lists the calls an add-on may make to LG's services, and the app each is made as
  const lunaOk = Object.assign({}, good, {
    permissions: ['luna'],
    luna: [{ uri: 'luna://com.example.one/ask', as: 'com.example.app' }, { uri: 'luna://com.example.two/' }],
  });
  const lm = addons.check(lunaOk, SVC);
  ok(
    lm.manifest && lm.manifest.luna.length === 2 && lm.manifest.luna[0].as === 'com.example.app' && lm.manifest.luna[1].as === '',
    'a manifest with luna calls is accepted'
  );
  ok(addons.check(Object.assign({}, lunaOk, { permissions: [] }), SVC).error, 'a luna list without the permission is refused');
  ok(addons.check(Object.assign({}, lunaOk, { luna: undefined }), SVC).error, 'the permission without a list is refused');
  ok(
    addons.check(Object.assign({}, lunaOk, { luna: [{ uri: 'http://x/y' }] }), SVC).error,
    'a call that is not luna://service/method is refused'
  );
  ok(
    addons.check(Object.assign({}, lunaOk, { luna: [{ uri: 'luna://a.b.c/x', as: 'bad app!' }] }), SVC).error,
    'an app id with odd characters is refused'
  );
  ok(addons.check(Object.assign({}, lunaOk, { luna: new Array(9).fill({ uri: 'luna://a.b.c/x' }) }), SVC).error, 'at most 8 calls');
  ok(addons.check(good, SVC).manifest.luna.length === 0, 'an add-on without them has none');
  put(
    'lunaa',
    Object.assign(svc('lunaa'), { permissions: ['luna'], luna: lunaOk.luna }),
    "exports.create = c => ({ call: (u, o) => c.luna(u, { x: 1 }, o), handle: (q, r) => r.end('{}') });"
  );
  put('lunab', svc('lunab'), "exports.create = c => ({ has: !!c.luna, handle: (q, r) => r.end('{}') });");
  a.load();
  const la = a.module('lunaa');
  let lr = await la.call('luna://com.example.one/ask', {});
  ok(
    lr.returnValue === true && lunaCalls[0].o.appId === 'com.example.app' && lunaCalls[0].payload.x === 1,
    'a listed call is made, as the app the manifest names'
  );
  lr = await la.call('luna://com.example.two/anything?x', {});
  ok(lr.returnValue === true && lunaCalls[1].o.appId === undefined, 'a call under a listed prefix is made, as no app when none is named');
  lr = await la.call('luna://com.webos.applicationManager/launch', {});
  ok(lr.returnValue === false && /may not call/.test(lr.errorText) && lunaCalls.length === 2, 'a call that is not listed is not made');
  lr = await la.call('luna://com.example.one/ask', { wait: 99999, appId: 'com.evil' });
  ok(
    lunaCalls[2].o.appId === 'com.example.app' && lunaCalls[2].o.wait <= 20000,
    'the app cannot be chosen by the add-on, and the wait is limited'
  );
  ok(a.module('lunab').has === false, 'an add-on without the permission has no luna at all');

  // every add-on of the repository's catalog installs from a stand-in for GitHub (the real index and files) and loads: its service part
  // gets the ctx the loader makes, so a catalog add-on cannot lean on something only the service has
  {
    const catRoot = path.join(__dirname, '..', '..', 'addons');
    const gh2 = await serve((q, rs) => {
      const f = path.join(catRoot, q.url.split('?')[0].replace(/\.\./g, ''));
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return rs.end(fs.readFileSync(f));
      rs.writeHead(404);
      rs.end();
    });
    process.env.CYTV_ADDONS_URL = gh2.url;
    const index = JSON.parse(fs.readFileSync(path.join(catRoot, 'index.json'), 'utf8'));
    for (const e of index.addons) {
      r = await call(a, '/api/addons/install', 'POST', { id: e.id });
      const inst = await call(a, '/api/addons/' + e.id);
      ok(
        r.code === 200 && inst.j.status === 'running',
        'the catalog add-on ' + e.id + ' installs and runs: ' + (r.out || '').slice(0, 120) + ' ' + (inst.j.error || '')
      );
    }
    ok(
      a.providers('wallpapers').some(x => x.id === 'immich' && x.mod.wallpapers.label === 'Immich'),
      'the Immich add-on is a wallpaper source once installed'
    );
    gh2.server.close();
    delete process.env.CYTV_ADDONS_URL;
  }

  // the catalog: a stand-in for GitHub
  const files = {
    'addon.json': JSON.stringify({ id: 'hello', name: 'Hello', version: '1.2.0', kind: 'page', entry: { page: 'index.html' } }),
    'index.html': '<b>hello</b>',
  };
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 5)]);
  let pictureOk = true;
  const hashes = {};
  Object.keys(files).forEach(f => (hashes[f] = sha(files[f])));
  const evil = Object.assign({}, files);
  let serveEvil = false;
  const gh = await serve((rq2, rs) => {
    if (rq2.url === '/index.json') {
      rs.end(
        JSON.stringify({
          addons: [
            { id: 'hello', name: 'Hello', version: '1.2.0', kind: 'page', about: 'Says hello.', preview: 'preview.jpg', files: hashes },
            { id: 'Bad Id', version: '1.0.0', files: hashes },
            { id: 'nohash', version: '1.0.0', files: { 'addon.json': 'xyz' } },
            { id: 'esc', version: '1.0.0', files: { 'addon.json': hashes['addon.json'], '../x': hashes['addon.json'] } },
          ],
        })
      );
      return;
    }
    if (rq2.url === '/catalog/hello/preview.jpg') return rs.end(pictureOk ? JPG : Buffer.from('<script>x</script>'));
    const m = /^\/catalog\/hello\/(.+)$/.exec(rq2.url);
    if (m && (serveEvil ? evil : files)[m[1]] !== undefined) return rs.end((serveEvil ? evil : files)[m[1]]);
    rs.writeHead(404);
    rs.end();
  });
  process.env.CYTV_ADDONS_URL = gh.url;
  r = await call(a, '/api/addons/catalog');
  ok(
    r.j.addons.length === 1 && r.j.addons[0].id === 'hello' && r.j.addons[0].installed === '',
    'the catalog lists only entries with a clean id and hashes: ' + JSON.stringify(r.j)
  );
  ok(
    r.j.addons[0].about === 'Says hello.' && r.j.addons[0].preview === true,
    'a catalog entry carries its longer text and says it has a picture'
  );
  r = await call(a, '/api/addons/preview/hello');
  ok(r.code === 200 && Buffer.isBuffer(r.out) && r.out.equals(JPG), 'the picture of a catalog add-on is read from the catalog');
  fs.unlinkSync(path.join(dir, '.previews', '__hello.img'));
  pictureOk = false;
  r = await call(a, '/api/addons/preview/hello');
  ok(r.code === 404, 'a catalog picture that is not an image is not served');
  pictureOk = true;
  evil['index.html'] = '<script>steal()</script>';
  serveEvil = true;
  r = await call(a, '/api/addons/install', 'POST', { id: 'hello' });
  ok(
    r.code === 400 &&
      /does not match/.test(r.j.error) &&
      !fs.existsSync(path.join(dir, 'hello')) &&
      !fs.existsSync(path.join(dir, '.staging-hello')),
    'a file that does not match its hash installs nothing and leaves no staging folder: ' + r.out
  );
  serveEvil = false;
  r = await call(a, '/api/addons/install', 'POST', { id: 'hello' });
  ok(
    r.code === 200 && r.j.restartNeeded === false && fs.readFileSync(path.join(dir, 'hello', 'index.html'), 'utf8') === '<b>hello</b>',
    'a good add-on installs: ' + r.out
  );
  r = await call(a, '/api/addons/hello');
  ok(r.j.status === 'running' && r.j.page === '/addon/hello/index.html' && !r.j.bundled, 'and runs at once (a page)');
  ok(
    !fs.existsSync(path.join(dir, 'hello', 'preview.jpg')),
    'the picture is not installed with the add-on (the manager reads it from the catalog)'
  );
  r = await call(a, '/api/addons/catalog');
  ok(r.j.addons[0].installed === '1.2.0' && r.j.addons[0].update === false, 'the catalog shows what is installed');
  r = await call(a, '/api/addons/old');
  ok(r.j.preview === true && r.j.about === '', 'an add-on with a picture in its folder says so');
  r = await call(a, '/api/addons/preview/old');
  ok(r.code === 200 && Buffer.isBuffer(r.out) && r.out.equals(PNG), 'and the picture is served from the folder');
  r = await call(a, '/api/addons/preview/nothere');
  ok(r.code === 404, 'an add-on without a picture has none');
  r = await call(a, '/api/addons/install', 'POST', { id: 'old' });
  ok(r.code === 400 && /ships with/.test(r.j.error), 'a bundled add-on is not installed from the catalog');
  r = await call(a, '/api/addons/install', 'POST', { id: 'nothere' });
  ok(r.code === 400 && /not in the catalog/.test(r.j.error), 'an id that is not in the catalog is refused');
  r = await call(a, '/api/addons/remove', 'POST', { id: 'old' });
  ok(r.code === 400, 'a bundled add-on cannot be removed');
  r = await call(a, '/api/addons/remove', 'POST', { id: 'hello' });
  ok(
    r.code === 200 && !fs.existsSync(path.join(dir, 'hello')) && !a.list().some(x => x.id === 'hello'),
    'an installed add-on can be removed'
  );
  // the repository template: a repository on its own, its index is current, its sample add-on is a good one and make-index.js agrees with the tool
  const tpl = path.join(__dirname, '..', '..', 'addons', 'template');
  ok(
    require('../addon-index').build(tpl) === fs.readFileSync(path.join(tpl, 'index.json'), 'utf8'),
    'addons/template/index.json is current (run node make-index.js in addons/template)'
  );
  ok(
    require('child_process').spawnSync(process.execPath, [path.join(tpl, 'make-index.js'), '--check']).status === 0,
    "the template's own make-index.js agrees with its index"
  );
  const tplIdx = JSON.parse(fs.readFileSync(path.join(tpl, 'index.json'), 'utf8'));
  ok(addons.cleanIndex(tplIdx).length === tplIdx.addons.length && tplIdx.addons.length === 1, 'the template index is clean');
  const tplM = addons.check(JSON.parse(fs.readFileSync(path.join(tpl, 'catalog', 'hello', 'addon.json'), 'utf8')), SVC);
  ok(tplM.manifest && tplM.manifest.id === 'hello' && tplM.manifest.kind === 'service', 'the sample add-on has a valid manifest');
  const hello = require(path.join(tpl, 'catalog', 'hello', 'service.js')).create({
    settings: { get: () => ({ hits: 4 }), set: o => (hello.saved = o) },
  });
  const hx = fake('/hit', 'POST');
  await hello.handle(hx.req, hx.res, '/hit', async () => ({}));
  ok(JSON.parse(hx.res.out).hits === 5 && hello.saved.hits === 5, 'the sample add-on service counts');

  // ---- repositories: the list, the confirm, where an add-on came from, updates from that repository ----
  const rp = req('addonrepos');
  const sp = s => rp.parseSpec(s);
  ok(sp('alice/addons').url === 'https://raw.githubusercontent.com/alice/addons/main', 'owner/repo is a GitHub repository on main');
  ok(sp('alice/addons@dev/pk/x').url === 'https://raw.githubusercontent.com/alice/addons/dev/pk/x', 'owner/repo@branch/folder');
  ok(sp('https://github.com/alice/addons/tree/v1/pk').url.endsWith('/alice/addons/v1/pk'), 'a github.com tree address');
  ok(sp('https://example.com/cytv/index.json/').url === 'https://example.com/cytv', 'any https folder, with or without index.json');
  ok(
    sp('http://example.com/x').error && sp('alice/addons@..').error && sp('a b').error && sp('').error,
    'http and odd addresses are refused'
  );
  ok(
    rp.list({}).length === 1 && rp.list({}).every(x => x.name === 'official' && !x.url),
    'a TV that never set the list has the official repository'
  );
  ok(
    rp.list({ addonRepos: [] }).length === 1 && rp.list({ addonRepos: [] })[0].name === 'official',
    'the official repository is there when the list is empty'
  );
  ok(
    rp.list({ addonRepos: [{ name: 'official', url: 'https://evil.example/x' }] }).length === 1 &&
      !rp.list({ addonRepos: [{ name: 'official', url: 'https://evil.example/x' }] })[0].url,
    'a custom repository cannot take the name official, and the official one is first'
  );
  ok(
    rp.describe('service', ['net.fetch', 'luna'], ['luna://com.webos.service.iepg/getChannelList']).join('|') ===
      "run its own code as root on the TV|connect to the internet|call LG's services: com.webos.service.iepg/getChannelList",
    'what an add-on may do is said in plain words'
  );

  process.env.CYTV_REPOS_ALLOW_HTTP = '1';
  const mk = (ver, bad) => {
    const f = {
      'addon.json': JSON.stringify({ id: 'extra', name: 'Extra', version: ver, kind: 'page', entry: { page: 'index.html' } }),
      'index.html': '<b>extra ' + ver + '</b>',
    };
    const h = {};
    Object.keys(f).forEach(k => (h[k] = sha(bad ? 'other' : f[k])));
    return { f, h };
  };
  let cur = mk('1.0.0');
  const gx = await serve((q, s) => {
    if (q.url === '/index.json')
      return s.end(
        JSON.stringify({
          addons: [
            {
              id: 'extra',
              name: 'Extra',
              version: cur.f['addon.json'] && JSON.parse(cur.f['addon.json']).version,
              kind: 'page',
              files: cur.h,
            },
          ],
        })
      );
    const m = /^\/catalog\/extra\/(.+)$/.exec(q.url);
    if (m && cur.f[m[1]] !== undefined) return s.end(cur.f[m[1]]);
    s.writeHead(404);
    s.end();
  });
  r = await call(a, '/api/addons/repos');
  ok(
    r.code === 200 && r.j.repos.length === 1 && r.j.repos[0].name === 'official' && r.j.repos[0].official,
    'the list starts with the official repository'
  );
  r = await call(a, '/api/addons/repos', 'POST', { add: gx.url });
  ok(r.code === 400 && r.j.confirm === true, 'a repository is not added without the confirm');
  r = await call(a, '/api/addons/repos', 'POST', { add: gx.url, name: 'mine', confirm: true });
  ok(r.code === 200 && r.j.repos.length === 2 && r.j.repos[1].name === 'mine', 'a repository is added with the confirm');
  ok(cfg.get().addonRepos.length === 2, 'the list is kept in config.json (addonRepos)');
  r = await call(a, '/api/addons/repos', 'POST', { add: gx.url, name: 'again', confirm: true });
  ok(r.code === 400 && /already/.test(r.j.error), 'the same address twice is refused');
  r = await call(a, '/api/addons/repos', 'POST', { add: 'alice/addons', name: 'mine', confirm: true });
  ok(r.code === 400 && /named mine/.test(r.j.error), 'the same name twice is refused');
  r = await call(a, '/api/addons/repos', 'POST', { add: 'bob/none', name: 'official', confirm: true });
  ok(r.code === 400, 'the name official is kept for the project repository');
  // a repository that does not answer does not hide the others
  r = await call(a, '/api/addons/repos', 'POST', { add: 'http://127.0.0.1:9/', name: 'dead', confirm: true });
  r = await call(a, '/api/addons/catalog');
  ok(
    r.j.addons.some(x => x.id === 'extra' && x.repo === 'mine' && !x.official) &&
      r.j.addons.some(x => x.id === 'hello' && x.repo === 'official') &&
      r.j.errors.length === 1 &&
      r.j.errors[0].repo === 'dead',
    'the catalog joins the repositories and names the one that failed: ' + JSON.stringify(r.j.errors)
  );
  r = await call(a, '/api/addons/repos', 'POST', { remove: 'dead' });
  r = await call(a, '/api/addons/install', 'POST', { id: 'extra' });
  ok(
    r.code === 400 && r.j.confirm === true && !fs.existsSync(path.join(dir, 'extra')),
    'an add-on from another repository needs the confirm'
  );
  cur = mk('1.0.0', true);
  r = await call(a, '/api/addons/install', 'POST', { id: 'extra', repo: 'mine', confirm: true });
  ok(
    r.code === 400 && /does not match/.test(r.j.error) && !fs.existsSync(path.join(dir, 'extra')),
    'its files are checked against its own index'
  );
  cur = mk('1.0.0');
  r = await call(a, '/api/addons/install', 'POST', { id: 'extra', repo: 'mine', confirm: true });
  ok(
    r.code === 200 && r.j.repo === 'mine' && fs.existsSync(path.join(dir, 'extra', 'index.html')),
    'it installs from the named repository'
  );
  ok(JSON.parse(fs.readFileSync(path.join(dir, '.sources', 'extra.json'), 'utf8')).repo === 'mine', 'the add-on remembers its repository');
  r = await call(a, '/api/addons/preview/extra');
  ok(r.code === 404, 'no picture is no picture');
  cur = mk('1.1.0');
  r = await call(a, '/api/addons/catalog');
  ok(r.j.addons.filter(x => x.id === 'extra')[0].update === true, 'a newer version in its repository is an update');
  r = await call(a, '/api/addons/update', 'POST', {});
  ok(r.code === 400 && r.j.confirm === true, 'updating also needs the confirm');
  r = await call(a, '/api/addons/update', 'POST', { confirm: true });
  ok(
    r.code === 200 &&
      r.j.updated.length === 1 &&
      r.j.updated[0].version === '1.1.0' &&
      fs.readFileSync(path.join(dir, 'extra', 'index.html'), 'utf8') === '<b>extra 1.1.0</b>',
    'update installs the newer version from the same repository: ' + r.out
  );
  r = await call(a, '/api/addons/repos', 'POST', { remove: 'mine' });
  ok(
    r.code === 200 && r.j.repos.length === 1 && fs.existsSync(path.join(dir, 'extra')),
    'removing a repository leaves what was installed from it'
  );
  r = await call(a, '/api/addons/repos', 'POST', { remove: 'mine' });
  ok(r.code === 400, 'removing a repository that is not there is refused');
  r = await call(a, '/api/addons/remove', 'POST', { id: 'extra' });
  ok(r.code === 200 && !fs.existsSync(path.join(dir, '.sources', 'extra.json')), 'removing an add-on removes its record');
  // ---- the rules for other repositories: ids of the official one are its own, two repositories with one id, what is shown is what is asked ----
  const repoServer = async items => {
    // items: [{id, ver, perms (what addon.json asks), listed (what the index says), tamper}]
    const files = {};
    items.forEach(it => {
      files[it.id] = {
        'addon.json': JSON.stringify({
          id: it.id,
          name: it.id,
          version: it.ver,
          kind: 'service',
          entry: { service: 'service.js' },
          permissions: it.perms || [],
        }),
        'service.js': 'exports.create = () => ({});',
      };
    });
    return serve((q, s) => {
      if (q.url === '/index.json')
        return s.end(
          JSON.stringify({
            addons: items.map(it => ({
              id: it.id,
              name: it.id,
              version: it.ver,
              kind: 'service',
              permissions: it.listed || [],
              files: { 'addon.json': sha(files[it.id]['addon.json']), 'service.js': sha(files[it.id]['service.js']) },
            })),
          })
        );
      const m = /^\/catalog\/([^/]+)\/(.+)$/.exec(q.url);
      if (m && files[m[1]] && files[m[1]][m[2]] !== undefined) return s.end(files[m[1]][m[2]]);
      s.writeHead(404);
      s.end();
    });
  };
  const gs = await repoServer([
    { id: 'hello', ver: '9.0.0' },
    { id: 'twin', ver: '1.0.0' },
    { id: 'liar', ver: '1.0.0', perms: ['net.fetch'], listed: [] },
  ]);
  const gt = await repoServer([{ id: 'twin', ver: '1.0.0' }]);
  await call(a, '/api/addons/repos', 'POST', { add: gs.url, name: 'shadow', confirm: true });
  await call(a, '/api/addons/repos', 'POST', { add: gt.url, name: 'second', confirm: true });
  r = await call(a, '/api/addons/catalog');
  ok(
    !r.j.addons.some(x => x.id === 'hello' && x.repo !== 'official') && r.j.addons.filter(x => x.id === 'twin').length === 2,
    'another repository cannot offer the id of an official add-on'
  );
  r = await call(a, '/api/addons/install', 'POST', { id: 'hello', repo: 'shadow', confirm: true });
  ok(r.code === 400 && /official repository/.test(r.j.error) && !fs.existsSync(path.join(dir, 'hello')), 'and it cannot install it either');
  r = await call(a, '/api/addons/install', 'POST', { id: 'twin', confirm: true });
  ok(
    r.code === 400 && /several repositories \(shadow, second\)/.test(r.j.error),
    'an id two other repositories have must say which: ' + r.out
  );
  r = await call(a, '/api/addons/install', 'POST', { id: 'twin', repo: 'second' });
  ok(
    r.code === 400 &&
      r.j.confirm === true &&
      r.j.addons[0].repo === 'second' &&
      r.j.addons[0].can[0] === 'run its own code as root on the TV',
    'the confirm says what is to be installed and what it may do: ' + r.out
  );
  r = await call(a, '/api/addons/install', 'POST', { id: 'twin', repo: 'second', confirm: true });
  ok(r.code === 200 && r.j.repo === 'second', 'with the repository named it installs');
  r = await call(a, '/api/addons/install', 'POST', { id: 'liar', repo: 'shadow', confirm: true });
  ok(
    r.code === 400 && /other permissions/.test(r.j.error) && !fs.existsSync(path.join(dir, 'liar')),
    'an add-on that asks for more than its index showed is refused'
  );
  r = await call(a, '/api/addons/remove', 'POST', { id: 'twin' });
  // the official repository cannot be read: what others offer is hidden, not installed
  const officialUrl = process.env.CYTV_ADDONS_URL;
  process.env.CYTV_ADDONS_URL = 'http://127.0.0.1:9';
  r = await call(a, '/api/addons/catalog');
  ok(
    r.j.addons.length === 0 && r.j.errors.some(x => x.repo === 'official') && r.j.errors.some(x => x.repo === 'others'),
    'without the official repository, what others offer is hidden: ' + JSON.stringify(r.j.errors)
  );
  r = await call(a, '/api/addons/install', 'POST', { id: 'twin', repo: 'second', confirm: true });
  ok(r.code === 400 && !fs.existsSync(path.join(dir, 'twin')), 'and not installed');
  process.env.CYTV_ADDONS_URL = officialUrl;
  await call(a, '/api/addons/repos', 'POST', { remove: 'shadow' });
  await call(a, '/api/addons/repos', 'POST', { remove: 'second' });
  gs.server.close();
  gt.server.close();
  r = await call(a, '/api/addons/repos', 'POST', { remove: 'official' });
  ok(r.code === 400 && /cannot be removed/.test(r.j.error), 'the official repository cannot be removed');
  r = await call(a, '/api/addons/repos');
  ok(r.j.repos[0].name === 'official' && r.j.repos[0].official, 'and stays the first entry');
  // the phone page: the code is needed, adding needs the box ticked
  r = await call(a, '/api/addons/repos/phone', 'POST', {});
  ok(
    r.code === 200 && /^\d{6}$/.test(r.j.code) && /:8800$/.test(r.j.url) && r.j.qr.endsWith('#' + r.j.code),
    'the phone page opens with a code'
  );
  const ph = (method, p, code, b) =>
    new Promise(resolve => {
      const q = require('http').request(
        { host: '127.0.0.1', port: 8800, method, path: p, headers: { 'x-code': code, 'content-type': 'application/json' } },
        s => {
          let t = '';
          s.on('data', d => (t += d));
          s.on('end', () => {
            let j = null;
            try {
              j = JSON.parse(t);
            } catch (_) {}
            resolve({ code: s.statusCode, j, t });
          });
        }
      );
      q.on('error', () => resolve({ code: 0, j: null, t: '' }));
      q.end(b ? JSON.stringify(b) : '');
    });
  const pcode = r.j.code;
  ok((await ph('GET', '/', '')).t.indexOf('Add-on repositories') > 0, 'the phone page is served without the code');
  ok((await ph('GET', '/api/repos', '000000')).code === 403, 'its data needs the code');
  const p1 = await ph('POST', '/api/add', pcode, { add: gx.url, name: 'phoned' });
  ok(p1.code === 400 && p1.j.confirm === true, 'adding from the phone needs the box ticked');
  const p2 = await ph('POST', '/api/add', pcode, { add: gx.url, name: 'phoned', confirm: true });
  ok(p2.code === 200 && p2.j.repos.some(x => x.name === 'phoned'), 'adding from the phone works');
  ok((await ph('POST', '/api/remove', pcode, { name: 'phoned' })).code === 200, 'and so does removing');
  await call(a, '/api/addons/repos/phone', 'POST', { stop: true });
  ok((await ph('GET', '/', '').catch(() => ({ code: 0 }))).code !== 200, 'the phone page closes');

  // the shell tool (scripts/cytv-addons.js) against the real handler
  const bridge = await serve((q, s) => {
    let raw = '';
    q.on('data', c => (raw += c));
    q.on('end', () => {
      let b = {};
      try {
        b = JSON.parse(raw || '{}');
      } catch (_) {}
      a.handle(q, s, q.url.split('?')[0], async () => b);
    });
  });
  const cli = (args, input) =>
    new Promise(resolve => {
      const c = require('child_process').execFile(
        process.execPath,
        [path.join(__dirname, '..', '..', 'scripts', 'cytv-addons.js')].concat(args),
        { env: Object.assign({}, process.env, { CYTV_PORT: String(bridge.server.address().port) }) },
        (err, out, errOut) => resolve({ code: err ? err.code : 0, out: String(out), err: String(errOut) })
      );
      c.stdin.end(input || '');
    });
  let c = await cli(['repo-add', gx.url, 'viacli'], 'n\n');
  ok(
    c.code === 1 && /Cancelled/.test(c.err) && !rp.list(cfg.get()).some(x => x.name === 'viacli'),
    'cytv-addons asks before adding a repository, no cancels'
  );
  c = await cli(['repo-add', gx.url, 'viacli', '-y']);
  ok(c.code === 0 && /Added viacli/.test(c.out), 'cytv-addons repo-add -y adds it: ' + c.out + c.err);
  c = await cli(['list', 'viacli']);
  ok(c.code === 0 && /^extra\s+1\.1\.0\s+viacli/m.test(c.out), 'cytv-addons list shows what a repository offers: ' + c.out);
  c = await cli(['install', 'extra', 'viacli'], 'yes\n');
  ok(c.code === 0 && /Installed extra 1\.1\.0 from viacli/.test(c.out), 'cytv-addons install asks, yes installs: ' + c.out + c.err);
  cur = mk('1.2.0');
  c = await cli(['update', '-y']);
  ok(c.code === 0 && /Updated extra to 1\.2\.0/.test(c.out), 'cytv-addons update: ' + c.out + c.err);
  c = await cli(['remove', 'extra']);
  ok(c.code === 0 && /Removed extra/.test(c.out), 'cytv-addons remove: ' + c.out);
  c = await cli(['repo-rm', 'viacli']);
  ok(c.code === 0, 'cytv-addons repo-rm: ' + c.out + c.err);
  c = await cli(['bogus']);
  ok(c.code === 1 && /repo-add/.test(c.out), 'cytv-addons prints its usage');
  const home = path.join(tmp, 'home');
  c = await new Promise(resolve =>
    require('child_process').execFile(
      process.execPath,
      [path.join(__dirname, '..', '..', 'scripts', 'cytv-addons.js'), 'shortcut'],
      { env: Object.assign({}, process.env, { HOME: home }) },
      (err, out) => resolve({ code: err ? err.code : 0, out: String(out) })
    )
  );
  const sc = path.join(home, '.local', 'bin', 'cytv-addons');
  ok(
    c.code === 0 && fs.existsSync(sc) && /^#!\/bin\/sh\nexec node ".*cytv-addons\.js" "\$@"/.test(fs.readFileSync(sc, 'utf8')),
    'cytv-addons shortcut writes the command to ~/.local/bin'
  );
  bridge.server.close();
  delete process.env.CYTV_REPOS_ALLOW_HTTP;
  gx.server.close();
  gh.server.close();
  delete process.env.CYTV_ADDONS_URL;
});
