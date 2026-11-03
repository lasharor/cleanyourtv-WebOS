// Add-ons (addons.js): the manifest check, the loader (a good one, a broken one, one that is off, DISABLE-ADDONS) and the routes.
const fs = require('fs'),
  path = require('path');
const crypto = require('crypto');
const { ok, call, req, run, tmp, serve } = require('./lib');

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
  // a bundled service add-on that says "live": its switch starts and stops the service part at once, with no restart
  const ldir = path.join(tmp, 'bundled', 'liveone');
  req('netcompat').mkdirp(ldir);
  fs.writeFileSync(
    path.join(ldir, 'addon.json'),
    JSON.stringify({
      id: 'liveone',
      name: 'Live one',
      version: '1.0.0',
      kind: 'service',
      entry: { service: 's.js' },
      routes: ['/api/liveone'],
      live: true,
    })
  );
  fs.writeFileSync(
    path.join(ldir, 's.js'),
    'const log = (global.__liveone = global.__liveone || []); exports.create = () => (log.push("create"), { start() { log.push("start"); }, stop() { log.push("stop"); }, handle: (q, r) => { r.writeHead(200); r.end(JSON.stringify({ ok: true })); } });'
  );
  cfg.update('test', c => {
    c.addons = Object.assign({}, c.addons, { liveone: { enabled: false } });
  });
  a.load();
  ok(
    by('liveone').status === 'off' && !by('liveone').mod && (global.__liveone || []).length === 0,
    'a live add-on that is switched off is not even created'
  );
  r = await call(a, '/api/liveone');
  ok(r.code === 404, 'and its API path answers nothing');
  r = await call(a, '/api/addons/liveone/enable', 'POST', { enabled: true });
  ok(r.j.restartNeeded === false && by('liveone').status === 'running', 'switching it on runs it at once, with no restart');
  ok(global.__liveone.join() === 'create,start', 'it is created and started');
  r = await call(a, '/api/liveone');
  ok(r.code === 200 && r.j.ok === true, 'and its API path answers');
  r = await call(a, '/api/addons/liveone/enable', 'POST', { enabled: false });
  ok(
    r.j.restartNeeded === false && by('liveone').status === 'off' && global.__liveone.join() === 'create,start,stop',
    'switching it off stops it at once'
  );
  r = await call(a, '/api/liveone');
  ok(r.code === 404, 'and its API path is gone');
  r = await call(a, '/api/addons/liveone/enable', 'POST', { enabled: true });
  ok(by('liveone').status === 'running' && global.__liveone.join() === 'create,start,stop,create,start', 'on again, it is a new instance');
  r = await call(a, '/api/addons/demo/enable', 'POST', { enabled: false });
  ok(r.j.restartNeeded === true, 'an add-on that does not say live still needs the restart');
  r = await call(a, '/api/addons/demo/enable', 'POST', { enabled: true });
  cfg.update('test', c => {
    c.addons = Object.assign({}, c.addons, { liveone: { enabled: false } });
  });
  a.load();
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
  fs.unlinkSync(path.join(dir, '.previews', 'hello.img'));
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
  gh.server.close();
  delete process.env.CYTV_ADDONS_URL;
});
