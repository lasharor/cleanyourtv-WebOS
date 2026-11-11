// The launcher's book (book.js): the Home key (the code learned in the manager, else 773) is bound in LG's input service only while
// a page shows, and Home gives the key back to LG.
const fs = require('fs'),
  path = require('path');
const { ok, call, req, memoryConfig, run } = require('./lib');

run(async () => {
  const mod = req('book'),
    hook = req('inputhook');
  const BINDS = path.join(process.env.CYTV_HOOK_CFG, 'keybinds.json');
  const BOOK = 'sh ' + process.env.CYTV_DIR + '/bookhome.sh';
  const binds = () => {
    try {
      return JSON.parse(fs.readFileSync(BINDS, 'utf8'));
    } catch (_) {
      return {};
    }
  };
  const bookBound = () => Object.keys(binds()).some(k => binds()[k].command === BOOK);
  const KEY = '777'; // a code as the hook reports it; the test does not care which one a remote sends

  // the Input key module, as the service gives it: its ensure() writes the binds from the hook's state
  const inputkey = { ensure: () => hook.ensure(true, '241') };
  let conf = null;
  const make = keys => {
    conf = memoryConfig({ keys: keys || {} });
    return mod.create({
      config: conf,
      inputhook: hook,
      feature: n => (n === 'inputkey' ? inputkey : null),
    });
  };

  // no Home key learned: 773 (KEY_HOME, the usual remotes) is bound while a page shows, and only then
  let f = make({});
  f.start();
  ok(!bookBound(), 'on Home nothing is bound');
  let r = await call(f, '/api/book/page', 'POST', { id: 'iptv' });
  ok(
    r.code === 200 && r.j.key === '773' && binds()['773'] && binds()['773'].command === BOOK,
    'without a learned code 773 is bound on a page'
  );

  // the manager learns a code while a page is open: sync() moves the bind at once, and forgetting it goes back to 773
  conf.update('test', c => void (c.keys.home = '778'));
  f.sync();
  ok(binds()['778'] && binds()['778'].command === BOOK && !binds()['773'], 'a code learned while a page is open is bound at once');
  conf.update('test', c => void (c.keys.home = ''));
  f.sync();
  ok(binds()['773'] && binds()['773'].command === BOOK && !binds()['778'], 'a forgotten code goes back to 773 at once');
  await call(f, '/api/book/page', 'POST', { id: '' });

  // a page shows: the learned code is bound to the script that asks for Home
  f = make({ home: KEY });
  f.start();
  r = await call(f, '/api/book/page', 'POST', { id: 'iptv' });
  ok(r.code === 200 && r.j.page === 'iptv' && r.j.key === KEY, 'the launcher reports the page that shows');
  ok(binds()[KEY] && binds()[KEY].command === BOOK, 'the learned Home key is bound while a page shows');

  r = await call(f, '/api/book');
  ok(r.code === 200 && r.j.page === 'iptv' && r.j.key === KEY, 'GET /api/book says which page and key');

  // the Input key module syncs the binds every 30 s: it must keep the Home key
  hook.ensure(true, '241');
  ok(binds()[KEY] && binds()[KEY].command === BOOK, 'the periodic sync keeps the Home key bound');

  // back on Home: the key is LG's again
  r = await call(f, '/api/book/page', 'POST', { id: '' });
  ok(r.code === 200 && !binds()[KEY], 'back on Home the Home key is given back to LG');

  // an id that is not an add-on's page
  r = await call(f, '/api/book/page', 'POST', { id: 'Not A Page' });
  ok(r.code === 400 && r.j.error, 'a page id that is not an add-on id is refused');

  // the launcher stops while on a page (a crash, a restart): the service starts with no page and clears the bind left behind
  await call(f, '/api/book/page', 'POST', { id: 'iptv' });
  ok(bookBound(), 'a page again: the key is bound again');
  make({ home: KEY }).start();
  ok(!bookBound(), 'a service that starts without a page removes a Home bind left by the run before');

  // a learned code that is really another of our keys is never taken over (a wrong learn must not lose the Input button)
  f = make({ home: '241' });
  f.start();
  await call(f, '/api/book/page', 'POST', { id: 'iptv' });
  ok(binds()['241'] && binds()['241'].command === 'sh ' + process.env.CYTV_DIR + '/inputkey.sh', 'the Input key keeps its code');
  await call(f, '/api/book/page', 'POST', { id: '' });

  // the manager tells the book when the Home key is learned or forgotten
  const { root } = require('./lib');
  const mgr = fs.readFileSync(path.join(root, 'helper', 'manager.js'), 'utf8');
  ok(/name === 'home'\) syncBook\(\)/.test(mgr) && /else syncBook\(\)/.test(mgr), 'learning or forgetting the Home key re-syncs the bind');

  // the script: luna-send through luna-compat.sh, and the parameters for the Home stand-in (issue 26) like the other key scripts
  const sh = fs.readFileSync(path.join(root, 'scripts', 'bookhome.sh'), 'utf8');
  ok(/luna-compat\.sh/.test(sh) && /luna_send .*applicationManager\/launch/.test(sh), 'bookhome.sh uses luna-compat.sh');
  ok(/cleanyourtv-home-standin/.test(sh) && /cleanyourtv-home-params/.test(sh), 'bookhome.sh passes its parameters to the Home stand-in');

  // the launcher reports the page again when it is shown, so the key is bound again after the service restarted meanwhile
  const page = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  ok(/if \(PAGER\.on\) PAGER\.report\(\);/.test(page), 'the launcher reports its page when it is shown again');

  // manager > an add-on > Open page: POST /api/book/open launches Home with {page, t} and answers the launcher waiting on GET at once
  {
    const launched = [];
    const ob = mod.create({
      config: memoryConfig({ keys: {} }),
      inputhook: hook,
      feature: () => null,
      luna: async (uri, p) => (launched.push(p), { returnValue: true }),
    });
    const fake = (url, method) => {
      const x = { req: { url, method, on: () => {} }, res: { code: 0, out: '', finished: false, ons: {} } };
      x.res.writeHead = c => void (x.res.code = c);
      x.res.setHeader = () => {};
      x.res.end = s => {
        x.res.out = s || '';
        x.res.finished = true;
      };
      x.res.on = (e, f) => void (x.res.ons[e] = f);
      return x;
    };
    const since = Date.now() - 1;
    const w = fake('/api/book/open?since=' + since, 'GET');
    await ob.handle(w.req, w.res, '/api/book/open', async () => ({}));
    ok(!w.res.finished, 'GET /api/book/open waits while nothing was opened');
    let r = await call(ob, '/api/book/open', 'POST', { id: 'phoneremote' });
    const t = r.j.t;
    ok(r.code === 200 && r.j.returnValue === true && t > since, 'POST /api/book/open opens a page');
    ok(
      launched.length === 1 &&
        launched[0].id === 'com.webos.app.home' &&
        launched[0].params.page === 'phoneremote' &&
        launched[0].params.t === t,
      'and launches Home with {page, t}'
    );
    const told = JSON.parse(w.res.out || 'null');
    ok(told && told.id === 'phoneremote' && told.t === t && told.fresh === true, 'the waiting launcher is told at once, with the same t');
    r = await call(ob, '/api/book/open?since=' + since, 'GET');
    ok(r.j.t === t && r.j.fresh, 'a launcher that asks a moment later gets it too');
    r = await call(ob, '/api/book/open', 'POST', { id: 'phoneremote' });
    ok(r.j.t > t, 'a second open of the same page has a new t');
    r = await call(ob, '/api/book/open', 'POST', { id: '../x' });
    ok(r.code === 400 && launched.length === 2, 'a bad id is refused and nothing is launched');
    const w2 = fake('/api/book/open?since=' + (t + 100), 'GET');
    await ob.handle(w2.req, w2.res, '/api/book/open', async () => ({}));
    ok(!w2.res.finished && typeof w2.res.ons.close === 'function', 'a launcher already up to date waits; a closed request is dropped');
    w2.res.ons.close();
  }
});
