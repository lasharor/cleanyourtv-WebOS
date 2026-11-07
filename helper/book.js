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
const web = require('./web');

const ID = /^[a-z][a-z0-9-]{1,31}$/; // an add-on id, as in addons.js: the pages are add-ons
const DEFAULT_HOME = '773'; // KEY_HOME as LG's input service reports it (keynames.js)

function create(ctx) {
  const { config } = ctx;
  const inputhook = ctx.inputhook || require('./inputhook');
  let page = '',
    armed = null;

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

  async function handle(req, res, u, body) {
    if (u === '/api/book' && req.method === 'GET') return web.json(res, { page, key: key() });
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
    paths: ['/api/book', '/api/book/page'],
    handle,
    start,
    sync,
  };
}

module.exports = { create };
