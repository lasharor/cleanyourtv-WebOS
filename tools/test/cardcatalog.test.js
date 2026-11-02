// Downloadable cards (cardcatalog.js): a card.json is checked, the catalog is read from GitHub (a stand-in), a card is installed only when
// every file matches its hash, removed again, its picture is read from the catalog, and an installed card is a card type of the cards
// feature (x-<id>) that the launcher is told about.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const { ok, call, serve, req, memoryConfig, run, tmp } = require('./lib');

run(async () => {
  process.env.CYTV_CARDPACKS = path.join(tmp, 'cardpacks');
  const cc = req('cardcatalog');
  const good = {
    id: 'hello',
    name: 'Hello',
    version: '1.0.0',
    template: '# {{opt.who}}',
    options: [
      { key: 'who', kind: 'text', label: 'Who', default: 'World' },
      {
        key: 'size',
        kind: 'choice',
        label: 'Size',
        choices: [
          ['small', 'Small'],
          ['large', 'Large'],
        ],
      },
    ],
  };
  const chk = (patch, re, name) => {
    const r = cc.clean(Object.assign({}, good, patch));
    ok(r.error && re.test(r.error), name + ': ' + (r.error || 'accepted'));
  };
  const c0 = cc.clean(good);
  ok(
    c0.card && c0.card.size === 'medium' && c0.card.options[0].default === 'World' && c0.card.about === '',
    'a good card.json is accepted, with its defaults'
  );
  chk({ id: 'Bad Id' }, /id must/, 'an id with capitals or spaces is refused');
  chk({ id: 'x'.repeat(30) }, /id must/, 'an id that makes a card type longer than 31 characters is refused');
  chk({ id: 'greeting' }, /launcher itself/, 'an id that is a card of the launcher is refused');
  chk({ version: 'one' }, /version/, 'a version that is not 1.0.0-like is refused');
  chk({ template: '' }, /template/, 'a card without a template is refused');
  chk({ template: 'x'.repeat(1501) }, /template/, 'a template over 1500 characters is refused');
  chk({ options: [{ key: 'a b', kind: 'text' }] }, /option needs a key/, 'an option key with a space is refused');
  chk({ options: [{ key: 'a', kind: 'script' }] }, /option needs a key/, 'an option kind that does not exist is refused');
  chk({ options: [{ key: 'a', kind: 'choice' }] }, /choices/, 'a choice without choices is refused');
  ok(cc.clean(good, 'other').error, 'the folder name must be the id');
  ok(cc.clean(Object.assign({}, good, { about: 'x'.repeat(900) })).card.about.length === 600, 'the longer text is cut at 600 characters');

  // the cards of this repository
  const root = path.join(__dirname, '..', '..', 'cards');
  const repoIds = fs.readdirSync(path.join(root, 'catalog'));
  ok(
    repoIds.length >= 3 &&
      repoIds.every(id => {
        const r = cc.clean(JSON.parse(fs.readFileSync(path.join(root, 'catalog', id, 'card.json'), 'utf8')), id);
        return r.card && fs.existsSync(path.join(root, 'catalog', id, 'preview.jpg'));
      }),
    'every card in the repository passes the check and has a picture'
  );
  ok(
    require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'card-index.js'), '--check']).status === 0,
    'cards/index.json matches cards/catalog (run node tools/card-index.js)'
  );

  // the catalog: a stand-in for GitHub
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const files = { 'card.json': JSON.stringify(good) };
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(80, 4)]);
  let tampered = false;
  const gh = await serve((rq, rs) => {
    if (rq.url === '/index.json')
      return rs.end(
        JSON.stringify({
          cards: [
            {
              id: 'hello',
              name: 'Hello',
              version: '1.0.0',
              about: 'Says hello.',
              preview: 'preview.jpg',
              files: { 'card.json': sha(files['card.json']) },
            },
            { id: 'Bad Id', version: '1.0.0', files: { 'card.json': sha('x') } },
            { id: 'nohash', version: '1.0.0', files: { 'card.json': 'xyz' } },
          ],
        })
      );
    if (rq.url === '/catalog/hello/card.json') return rs.end(tampered ? files['card.json'].replace('World', 'Evil') : files['card.json']);
    if (rq.url === '/catalog/hello/preview.jpg') return rs.end(JPG);
    rs.writeHead(404);
    rs.end();
  });
  process.env.CYTV_CARDS_URL = gh.url;
  const cards = req('cards').create({ config: memoryConfig({}), feature: () => null });
  let r = await call(cards, '/api/cards/catalog', 'GET');
  ok(
    r.j.cards.length === 1 &&
      r.j.cards[0].id === 'hello' &&
      r.j.cards[0].about === 'Says hello.' &&
      r.j.cards[0].preview === true &&
      r.j.cards[0].installed === '',
    'the catalog lists only clean entries, with their text and a picture: ' + r.out
  );
  r = await call(cards, '/api/cards/preview/greeting', 'GET');
  ok(r.code === 200 && Buffer.isBuffer(r.out) && r.out.length > 1000, "the launcher's own cards have a picture too");
  r = await call(cards, '/api/cards/preview/hello', 'GET');
  ok(r.code === 200 && Buffer.isBuffer(r.out) && r.out.equals(JPG), 'the picture is read from the catalog');
  tampered = true;
  r = await call(cards, '/api/cards/install', 'POST', { id: 'hello' });
  ok(
    r.code === 400 && /does not match/.test(r.j.error) && !fs.existsSync(path.join(process.env.CYTV_CARDPACKS, 'hello')),
    'a file that does not match its hash installs nothing: ' + r.out
  );
  tampered = false;
  r = await call(cards, '/api/cards/install', 'POST', { id: 'nothere' });
  ok(r.code === 400 && /not in the catalog/.test(r.j.error), 'an id that is not in the catalog is refused');
  r = await call(cards, '/api/cards/install', 'POST', { id: 'hello' });
  ok(r.code === 200 && fs.existsSync(path.join(process.env.CYTV_CARDPACKS, 'hello', 'card.json')), 'a good card installs: ' + r.out);
  ok(!fs.existsSync(path.join(process.env.CYTV_CARDPACKS, 'hello', 'preview.jpg')), 'the picture is not installed');
  r = await call(cards, '/api/cards/packs', 'GET');
  ok(r.j.packs.hello && r.j.packs.hello.template === '# {{opt.who}}', 'the installed cards are listed as the launcher needs them');
  r = await call(cards, '/api/cards/catalog', 'GET');
  ok(r.j.cards[0].installed === '1.0.0' && r.j.cards[0].update === false, 'the catalog shows what is installed');

  // an installed card is a card type with a form on the phone page, and can be chosen for a place
  const theme = { resolved: () => ({ slots: [{ id: 'side', card: '' }] }) };
  const withTheme = req('cards').create({ config: memoryConfig({}), feature: n => (n === 'theme' ? theme : null) });
  r = await call(withTheme, '/api/cards/status', 'POST', {});
  const ty = (r.j.types || []).filter(x => x.type === 'x-hello')[0];
  const gr = (r.j.types || []).filter(x => x.type === 'greeting')[0];
  ok(
    gr && gr.about.length > 20 && gr.preview === 'greeting' && ty.preview === 'hello',
    'every card type has a text and the picture to show next to it'
  );
  ok(
    ty && ty.name === 'Hello' && ty.fields[0].key === 'who' && ty.fields[1].choices.length === 2,
    'it is a card type with its options as the form: ' + JSON.stringify(ty)
  );
  r = await call(withTheme, '/api/cards/set', 'POST', { slot: 'side', type: 'x-hello' });
  ok(r.j.ok === true, 'it can be chosen for a place');
  r = await call(withTheme, '/api/cards/set', 'POST', { slot: 'side', type: 'x-nothere' });
  ok(r.j.error, 'a card that is not installed cannot');
  ok(withTheme.packs().hello && withTheme.packs().hello.options.length === 2, 'the cards feature hands the launcher the installed cards');

  // the launcher's list of apps carries the installed cards, and nothing when there are none
  const luna = async () => ({ returnValue: true, apps: [] });
  const apps = req('apps').create({ config: memoryConfig({}), luna, version: '1.6.0', feature: n => (n === 'cards' ? withTheme : null) });
  r = await call(apps, '/api/apps');
  ok(
    r.j.cardPacks &&
      r.j.cardPacks.hello.template === '# {{opt.who}}' &&
      r.j.cardPacks.hello.options[0].def === 'World' &&
      r.j.cardPacks.hello.options[1].def === 'small',
    '/api/apps tells the launcher about the installed cards (a choice without a default starts at its first choice): ' + r.out
  );
  r = await call(cards, '/api/cards/remove', 'POST', { id: 'hello' });
  ok(r.code === 200 && !fs.existsSync(path.join(process.env.CYTV_CARDPACKS, 'hello')), 'an installed card can be removed');
  r = await call(cards, '/api/cards/remove', 'POST', { id: 'hello' });
  ok(r.code === 400, 'and not twice');
  gh.server.close();
});
