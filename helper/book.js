// The pages of the launcher's book, and the Home key while one shows (app/src/js/addons.js PAGER, docs/development/addons.md).
// A page is an iframe of the Home app, so while one shows webOS still has Home in front: pressing the Home key does nothing at all
// (it does not relaunch Home, which is what turns the launcher back to its first page when another app is in front). The key is
// therefore caught in LG's input service for exactly that time: the code learned in the manager (Learn the Home key) is bound to
// scripts/bookhome.sh while a page shows, and a press asks the app manager for Home - the relaunch the launcher already handles.
// Until a code is learned, 773 is used: what LG's input service reports for the Home button (keynames.js, KEY_HOME). A remote whose
// Home sends another code loses nothing (no other button sends 773) and can have its own code learned; a learned code always wins.
//   POST /api/book/page {id}   the page on screen ('' is Home); the launcher sends it on each turn and every 30 s while a page shows
//   GET  /api/book             {page, key}: the page reported last and the code bound for the Home key (the learned one, else 773)
//   sync()                     re-reads the learned code (manager.js calls it when the Home key is learned or forgotten)
//   POST /api/book/open {id}   opens a page (manager > an add-on > Open page): Home is launched with {page, t} and the launcher, which
//                              waits on GET /api/book/open, is told at once. webOS can hold Home's relaunch and visibility events for
//                              seconds (12 to 40 s seen on a webOS 25 TV) while the page's own requests still answer.
//   GET  /api/book/open?since=t  {id, t, fresh}: answers when an open newer than t comes, else after 25 s with the last one; fresh is
//                              false for an open older than 10 s, which a launcher that (re)connects late must not act on
const web = require('./web');

const ID = /^[a-z][a-z0-9-]{1,31}$/; // an add-on id, as in addons.js: the pages are add-ons
const DEFAULT_HOME = '773'; // KEY_HOME as LG's input service reports it (keynames.js)
const HOLD_MS = 25000; // how long GET /api/book/open waits for an open
const FRESH_MS = 10000; // an open older than this is history, not a request

function create(ctx) {
  const { config } = ctx;
  const inputhook = ctx.inputhook || require('./inputhook');
  const luna = ctx.luna || require('./luna');
  let page = '',
    armed = null;
  let opened = { id: '', t: 0 }; // the last POST /api/book/open: t is its time, also the launch's t
  const waiters = [];
  const openReply = () => ({ id: opened.id, t: opened.t, fresh: !!opened.t && Date.now() - opened.t < FRESH_MS });

  // the code the manager learned for the Home button (config.keys.home), else the Home button's usual code
  const key = () => String(config.keys().home || DEFAULT_HOME);
  // what the hook should bind now: the learned code while a page shows, nothing otherwise
  const sync = () => {
    const want = page ? key() : '';
    if (inputhook.setBookKey) inputhook.setBookKey(want);
    if (want === armed) return want;
    armed = want;
    const ik = ctx.feature && ctx.feature('inputkey');
    if (ik && ik.ensure) ik.ensure(); // writes keybinds.json and keeps the hook in LG's input service
    return want;
  };

  function waitOpen(req, res) {
    const m = /[?&]since=(\d+)/.exec('?' + (req.url.split('?')[1] || ''));
    const since = m ? parseInt(m[1], 10) : 0;
    if (opened.t > since) return web.json(res, openReply());
    const item = { res, timer: null };
    const drop = () => {
      clearTimeout(item.timer);
      const i = waiters.indexOf(item);
      if (i >= 0) waiters.splice(i, 1);
    };
    item.timer = setTimeout(() => {
      drop();
      if (!res.finished) web.json(res, openReply());
    }, HOLD_MS);
    res.on('close', drop);
    waiters.push(item);
  }
  async function open(id) {
    // one value per open, also when two come in the same millisecond: the launcher handles each t once
    opened = { id, t: Math.max(Date.now(), opened.t + 1) };
    waiters.splice(0).forEach(w => {
      clearTimeout(w.timer);
      if (!w.res.finished) web.json(w.res, openReply());
    });
    const params = { page: id, t: opened.t };
    require('./nativehome').homeParams(params); // the stand-in Home (webOS 5 to 23) reads them from a file
    return luna('luna://com.webos.applicationManager/launch', { id: 'com.webos.app.home', params });
  }

  async function handle(req, res, u, body) {
    if (u === '/api/book' && req.method === 'GET') return web.json(res, { page, key: key() });
    if (u === '/api/book/open' && req.method === 'GET') return waitOpen(req, res);
    if (u === '/api/book/open' && req.method === 'POST') {
      const b = (await body(req)) || {};
      if (typeof b.id !== 'string' || !ID.test(b.id)) return web.json(res, { error: 'bad page' }, 400);
      const r = await open(b.id);
      return web.json(res, { id: b.id, t: opened.t, returnValue: !!(r && r.returnValue) });
    }
    if (u !== '/api/book/page' || req.method !== 'POST') return web.notFound(res);
    const b = (await body(req)) || {};
    const id = typeof b.id === 'string' ? b.id : '';
    if (id && !ID.test(id)) return web.json(res, { error: 'bad page' }, 400);
    page = id;
    sync();
    return web.json(res, { page, key: key() });
  }

  function start() {
    sync(); // no page when the service starts: a bind left by the run before goes
  }

  return {
    name: 'book',
    paths: ['/api/book', '/api/book/page', '/api/book/open'],
    handle,
    start,
    sync,
  };
}

module.exports = { create };
