// Cards that come with an add-on (addon.json "cards", provides "cards"): the manifest is checked, the card is a card type like a
// downloaded one (x-<id>) with its page served from the add-on's folder under a policy without network, the launcher gets its data
// from the add-on's feed (only for a card that is set for a place, with the options the person chose), and the actions of its buttons
// reach the add-on only when the card declared them.
const fs = require('fs'),
  path = require('path'),
  http = require('http');
const { ok, call, serve, req, memoryConfig, run, tmp } = require('./lib');

run(async () => {
  process.env.CYTV_ADDONS = path.join(tmp, 'addons');
  process.env.CYTV_ADDON_DATA = path.join(tmp, 'addon-data');
  process.env.CYTV_ADDONS_BUNDLED = path.join(tmp, 'bundled');
  process.env.CYTV_CARDPACKS = path.join(tmp, 'cardpacks');
  const addons = req('addons'),
    cc = req('cardcatalog');

  // ---- the manifest ----
  const card = {
    id: 'demo-card',
    name: 'Demo card',
    version: '1.0.0',
    page: 'card.html',
    poll: 5,
    actions: [
      { name: 'prev', label: 'Previous' },
      { name: 'toggle', label: 'Play or pause' },
    ],
    options: [{ key: 'title', kind: 'text', label: 'Title', default: 'Hi' }],
  };
  const man = {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    kind: 'service',
    entry: { service: 'service.js' },
    provides: ['cards'],
    cards: [card],
  };
  const m0 = addons.check(man, '1.6.15');
  ok(m0.manifest && m0.manifest.cards[0].poll === 5 && m0.manifest.cards[0].actions.length === 2, 'a manifest with a card is accepted');
  const bad = (patch, re, name) => {
    const r = addons.check(Object.assign({}, man, { cards: [Object.assign({}, card, patch)] }), '1.6.15');
    ok(r.error && re.test(r.error), name + ': ' + (r.error || 'accepted'));
  };
  bad({ page: undefined, template: '# x' }, /has a page/, 'a card of an add-on has a page, not a template');
  bad({ id: 'greeting' }, /launcher itself/, 'the id of a card of the launcher is refused');
  bad({ poll: -1 }, /poll/, 'a negative poll is refused');
  bad({ poll: 99999 }, /poll/, 'a poll over an hour is refused');
  bad({ actions: [{ name: 'Bad Name' }] }, /action has a name/, 'an action name with capitals or spaces is refused');
  bad({ actions: [{ name: 'a' }, { name: 'a' }] }, /two actions/, 'two actions with one name are refused');
  bad({ actions: new Array(9).fill(0).map((_, i) => ({ name: 'a' + i })) }, /at most 8/, 'more than 8 actions are refused');
  ok(addons.check(Object.assign({}, man, { cards: [card, card] }), '1.6.15').error, 'two cards with one id are refused');
  ok(addons.check(Object.assign({}, man, { cards: [1, 2, 3, 4, 5] }), '1.6.15').error, 'at most 4 cards');
  ok(addons.check(Object.assign({}, man, { cards: undefined }), '1.6.15').manifest.cards.length === 0, 'an add-on without cards has none');
  ok(
    cc.clean(Object.assign({}, card)).card.poll === 0 && cc.clean(Object.assign({}, card)).card.actions.length === 0,
    'a downloaded card (not from an add-on) has no poll and no actions'
  );
  ok(
    addons.check(Object.assign({}, man, { cards: [Object.assign({}, card, { poll: 1 })] }), '1.6.15').manifest.cards[0].poll === 2,
    'a poll under 2 seconds is 2'
  );

  // ---- an add-on that runs ----
  const dir = path.join(tmp, 'addons', 'demo');
  req('netcompat').mkdirp(path.join(dir, 'cards', 'demo-card'));
  fs.writeFileSync(path.join(dir, 'addon.json'), JSON.stringify(man));
  fs.writeFileSync(path.join(dir, 'cards', 'demo-card', 'card.html'), '<b>demo</b>');
  fs.writeFileSync(path.join(dir, 'cards', 'demo-card', 'x.php'), 'nope');
  fs.writeFileSync(
    path.join(dir, 'service.js'),
    `const seen = [];
exports.create = () => ({
  cards: {
    feed: (id, opt) => (opt.title === 'boom' ? Promise.reject(new Error('it broke')) : opt.title === 'big' ? { x: 'y'.repeat(200000) } : { id, title: opt.title, n: seen.length }),
    action: (id, opt, name, arg) => { seen.push([id, opt.title, name, arg]); return { ok: true, seen: seen.length }; },
  },
  handle: (q, r) => r.end('{}'),
});`
  );
  const config = memoryConfig({ cards: { side: { type: 'x-demo-card', title: 'Hello' }, other: { type: 'x-demo-card', title: 'boom' } } });
  const a = addons.create({ config, version: '1.6.15', feature: () => null });
  a.start();
  ok(a.list().filter(x => x.id === 'demo')[0].status === 'running', 'the add-on runs');
  ok(
    a.cardsOf().length === 1 && a.cardsOf()[0].card.id === 'demo-card',
    'cardsOf lists the cards of the running add-ons that provide cards'
  );

  const theme = {
    resolved: () => ({
      slots: [
        { id: 'side', card: '' },
        { id: 'other', card: '' },
      ],
    }),
  };
  const cards = req('cards').create({ config, feature: n => (n === 'addons' ? a : n === 'theme' ? theme : null), version: '1.6.15' });
  let r = await call(cards, '/api/cards/status', 'POST', {});
  const ty = r.j.types.filter(x => x.type === 'x-demo-card')[0];
  ok(ty && ty.name === 'Demo card' && ty.fields[0].key === 'title', 'the card is a card type with its options as the form');
  ok(
    cards.packs()['demo-card'].addon === 'demo' && cards.packs()['demo-card'].poll === 5,
    'the launcher is told it comes from an add-on, with its poll'
  );
  r = await call(cards, '/api/cards/set', 'POST', { slot: 'side', type: 'x-demo-card' });
  ok(r.j.ok === true, 'it can be chosen for a place');
  r = await call(cards, '/api/cards/remove', 'POST', { id: 'demo-card' });
  ok(r.code === 400 && /add-on/.test(r.j.error), 'a card of an add-on is not removed as a downloaded one: ' + r.out);

  // ---- the page ----
  const web = await serve((rq, rs) => cards.handle(rq, rs, rq.url.split('?')[0], async () => ({})));
  const get = u =>
    new Promise(resolve =>
      http.get(web.url + u, res => {
        const b = [];
        res.on('data', c => b.push(c));
        res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, body: Buffer.concat(b).toString() }));
      })
    );
  let g = await get('/card/demo-card/card.html');
  ok(
    g.code === 200 && g.body === '<b>demo</b>' && /connect-src 'none'/.test(g.headers['content-security-policy']),
    "the page comes from the add-on's folder under a policy without network"
  );
  ok((await get('/card/demo-card/x.php')).code === 404, 'a file of another type is not served');
  ok((await get('/card/demo-card/..%2Faddon.json')).code === 404, 'a path out of the card folder is not served');
  web.server.close();

  // ---- the feed ----
  r = await call(cards, '/api/cards/feed', 'POST', { slot: 'side' });
  ok(r.j.title === 'Hello' && r.j.id === 'demo-card', 'the feed gets the options the person chose: ' + r.out);
  r = await call(cards, '/api/cards/feed', 'POST', { slot: 'other' });
  ok(/it broke/.test(r.j.error), 'a feed that fails answers with its error: ' + r.out);
  config.update('test', c => {
    c.cards.other.title = 'big';
  });
  r = await call(cards, '/api/cards/feed', 'POST', { slot: 'other' });
  ok(/too large/.test(r.j.error), 'an answer over 128 KB is refused');
  r = await call(cards, '/api/cards/feed', 'POST', { slot: 'nowhere' });
  ok(r.j.error === 'no such card', 'a place without a card has no feed');
  config.update('test', c => {
    c.cards.third = { type: 'x-nothere' };
  });
  r = await call(cards, '/api/cards/feed', 'POST', { slot: 'third' });
  ok(r.j.error === 'no such card', 'nor a place with a card that is not from an add-on');

  // ---- the actions ----
  r = await call(cards, '/api/cards/action', 'POST', { slot: 'side', name: 'toggle', arg: 'x'.repeat(300) });
  ok(r.j.ok === true && r.j.seen === 1, 'a declared action reaches the add-on');
  r = await call(cards, '/api/cards/action', 'POST', { slot: 'side', name: 'delete-everything' });
  ok(r.j.error === 'no such action', 'an action the card did not declare does not');
  r = await call(cards, '/api/cards/action', 'POST', { slot: 'nowhere', name: 'toggle' });
  ok(r.j.error === 'no such card', 'nor one for a place without such a card');
  r = await call(cards, '/api/cards/feed', 'POST', { slot: 'side' });
  ok(r.j.n === 1, 'the feed shows the add-on saw one action');

  // ---- an add-on that is off or removed: its card goes with it ----
  config.update('test', c => {
    c.addons = { demo: { enabled: false } };
  });
  a.load();
  ok(a.cardsOf().length === 0 && !cards.packs()['demo-card'], 'a card of an add-on that is off is not offered');
  r = await call(cards, '/api/cards/feed', 'POST', { slot: 'side' });
  ok(r.j.error === 'no such card', 'and has no feed');
});
