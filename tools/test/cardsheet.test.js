// The card sheet (a card's drawer page shown from the right): the pure helpers for focus moves, tab steps and the unset option.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

run(async () => {
  const src = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'cardsheet.js'), 'utf8');
  const sandbox = { window: {}, console };
  vm.runInNewContext(src.split('/* @dom */')[0], sandbox);
  const P = sandbox.window.CS_PURE;
  ok(!!P && typeof P.csNext === 'function', 'CS_PURE offers csNext');
  const t = (name, x, y, w, h, tab) => ({ name, x, y, w, h, tab });
  const list = [
    t('unit', 60, 4, 20, 8, -1),
    t('close', 82, 4, 14, 8, -1),
    t('now', 4, 16, 28, 8, 0),
    t('hours', 34, 16, 28, 8, 1),
    t('days', 64, 16, 28, 8, 2),
    t('c0', 4, 30, 44, 20, -1),
  ];
  const by = n => list.filter(e => e.name === n)[0];
  const nm = r => (r ? r.name : null);
  ok(nm(P.csNext(list, by('now'), 'down')) === 'c0', 'down from a tab reaches the first card');
  ok(nm(P.csNext(list, by('c0'), 'up')) === 'now', 'up from a card reaches the tab above');
  ok(nm(P.csNext(list, by('unit'), 'right')) === 'close', 'right from unit reaches close');
  ok(P.csNext(list, by('close'), 'right') === null, 'right from close finds nothing');
  ok(P.csNext(list, by('c0'), 'down') === null, 'down from the last row finds nothing');

  ok(nm(P.csTabStep(list, by('now'), 'right', false)) === 'hours', 'right from the first tab steps to the second');
  ok(nm(P.csTabStep(list, by('hours'), 'left', false)) === 'now', 'left steps back');
  ok(P.csTabStep(list, by('now'), 'right', true) === null, 'right-to-left: right from the first tab finds nothing');
  ok(nm(P.csTabStep(list, by('now'), 'left', true)) === 'hours', 'right-to-left: left steps forward');
  ok(P.csTabStep(list, by('c0'), 'right', false) === null, 'a target that is no tab does not step');
  ok(P.csTabStep(list, by('now'), 'down', false) === null, 'up and down do not step tabs');

  // back: the target Back presses instead of closing; tab: Up from the page lands on the tab shown
  ok(
    nm(P.csNamed(list, 'now')) === 'now' && P.csNamed(list, '') === null && P.csNamed(list, 'gone') === null,
    'csNamed finds a target by name, or none'
  );
  ok(nm(P.csLand(list, by('c0'), by('now'), 2)) === 'days', 'up from the page lands on the tab the page shows');
  ok(nm(P.csLand(list, by('c0'), by('now'), -1)) === 'now', 'without a tab from the page, the nearest tab');
  ok(
    nm(P.csLand(list, by('now'), by('hours'), 2)) === 'hours' && nm(P.csLand(list, by('c0'), by('unit'), 2)) === 'unit',
    'only a move from the page into the tab row is changed'
  );
  ok(
    /csNamed\(CS\.targets, CS\.back\)[\s\S]*?if \(!bk\) return csClose\(\)/.test(src),
    'Back presses the back target, and closes the sheet when there is none'
  );

  const csrc = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'cards.js'), 'utf8');
  const m = csrc.match(/function cardBtnRoute[\s\S]*?\n\}\r?\n/);
  ok(!!m, 'cards.js has cardBtnRoute');
  const rsb = {};
  vm.runInNewContext(m[0] + ';this.f = cardBtnRoute;', rsb);
  const rpk = { drawer: { action: 'open' }, settings: { action: 'settings' } };
  ok(rsb.f(rpk, 'open') === 'sheet', 'the declared drawer action routes to the sheet');
  ok(rsb.f(rpk, 'settings') === 'settings', 'the declared settings action routes to the panel');
  ok(rsb.f(rpk, 'next') === 'addon', 'any other action goes to the add-on');
  ok(rsb.f({ drawer: null, settings: null }, 'open') === 'addon', 'no drawer and no settings: the add-on gets it');
  ok(rsb.f(null, 'open') === 'addon', 'no pack: the add-on gets it');

  ok(!/cardBtnRemap/.test(csrc), 'no remap of the buttons: they sit in a wrapper with the frame box');
  const cb = csrc.slice(csrc.indexOf('function cardButtons'), csrc.indexOf('function cardBtnRoute'));
  ok(!/offsetTop|getBoundingClientRect/.test(cb), 'cardButtons does not measure the card');
  ok(
    /_bw\.className = 'card-bw'/.test(cb) && /el\._bw\.appendChild\(d\)/.test(cb) && /CARD_FRAME_BOX/.test(cb),
    'buttons go into the wrapper that has the frame box'
  );
  const css = fs.readFileSync(path.join(root, 'app', 'src', 'css', 'home.css'), 'utf8');
  ok(
    /\.card-frame > iframe,\s*\[data-cards="glass"\] \.card-frame > \.card-bw/.test(css),
    'on glass the wrapper has the same inset as the frame'
  );
  // a 30px card with the frame box of 44px: the stored percentages are the page's own
  const sty = [];
  vm.runInNewContext(cb + ';cardButtons(el, [{name:"a",x:10,y:20,w:30,h:100}]);', {
    el: { _pk: { actions: [{ name: 'a', label: 'A' }] }, appendChild() {} },
    document: {
      createElement: () => ({
        style: {},
        appendChild(d) {
          sty.push(d.style.cssText);
        },
      }),
    },
    CARD_FRAME_BOX: 'x',
    hit() {},
    JSON,
    Array,
    Math,
    Number,
    isFinite,
    window: {},
  });
  ok(sty.length === 1 && /left:10%;top:20%;width:30%;height:100%/.test(sty[0]), 'percent stored as the page says it: ' + sty[0]);

  // the message handler of the sheet: a message from any window but the sheet's own frame is ignored
  const hi = src.indexOf("window.addEventListener('message'");
  ok(hi > 0, 'cardsheet.js has the message handler');
  let handler = null;
  const own = {},
    seen = [];
  vm.runInNewContext(src.slice(hi), {
    window: {
      addEventListener: (n, f) => {
        if (n === 'message') handler = f;
      },
    },
    CS: { on: true, frame: { contentWindow: own }, targets: [] },
    csIdle: () => seen.push('idle'),
    csSendCtx: () => seen.push('ctx'),
    csTargets: () => seen.push('targets'),
    csClose: () => seen.push('close'),
    csCardEl: () => null,
    api: () => {
      seen.push('api');
      return { then: () => {} };
    },
    cfg: {},
    toast: () => {},
    t: x => x,
    cardAction: () => seen.push('action'),
  });
  ok(typeof handler === 'function', 'the handler is registered');
  handler({ source: {}, data: { cytvSheet: 'close' } });
  ok(seen.length === 0, 'a message from another window is ignored');
  handler({ source: own, data: { cytvSheet: 'close' } });
  ok(seen.indexOf('close') >= 0, 'a message from the sheet frame is handled');

  const place = { key: 'place', kind: 'place', def: '', label: 'City', choices: [] },
    unit = {
      key: 'unit',
      kind: 'choice',
      def: 'c',
      label: 'Unit',
      choices: [
        ['c', 'C'],
        ['f', 'F'],
      ],
    };
  ok(P.csUnset({}, { options: [place, unit] }) === place, 'an empty place is the unset option');
  ok(P.csUnset({ place: 'Paris' }, { options: [place, unit] }) === null, 'a filled place leaves nothing unset');
  ok(P.csUnset({}, { options: [unit] }) === null, 'a choice with a default is never unset');

  // the settings panel of any card (cardsettings.js): generic rows from the declared options
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
  const cssrc = rd('app/src/js/cardsettings.js');
  ok(!/weather|wx|forecast/i.test(cssrc), 'the settings panel names no card (it is generic)');
  ok(
    /@include js\/cardsettings\.js/.test(rd('app/src/index.html')) && /id="csq"/.test(rd('app/src/index.html')),
    'the launcher includes the settings panel and its city input'
  );
  ok(
    /csq/.test(rd('app/src/js/input.js')) &&
      /csFind\(CSQ_TYPE/.test(rd('app/src/js/input.js')) &&
      /csSearchEnd\(\)/.test(rd('app/src/js/input.js')),
    'the city input of the panel is wired to the keys'
  );
  const calls = [];
  let built = null,
    feeds = 0;
  const env = {
    console,
    t: x => x,
    cfg: { cards: { a: { type: 'x-demo', place: 'Paris', unit: 'c' } } },
    CARD_PACKS: {
      demo: {
        settings: { action: 'settings', title: 'Demo' },
        options: [
          { key: 'place', kind: 'place', label: 'City', def: '', choices: [] },
          {
            key: 'unit',
            kind: 'choice',
            label: 'Unit',
            def: 'c',
            choices: [
              ['c', '°C'],
              ['f', '°F'],
            ],
          },
          { key: 'note', kind: 'text', label: 'Note', def: '', choices: [] },
        ],
      },
    },
    openBuilt: (title, b) => {
      built = { title, b };
    },
    api: (u, b) => {
      calls.push([u, b]);
      return { then: f => f({ ok: true, cards: {} }) };
    },
    launch: (a, b) => calls.push(['launch', a, b]),
    toast: () => {},
    drawCards: () => {},
    cardFeedAll: () => {
      feeds++;
    },
    refreshMenu: () => {},
    backMenu: () => {},
    $: () => null,
  };
  vm.runInNewContext(cssrc, env);
  env.csSettings('x-demo');
  ok(built && built.title === 'Demo', 'the panel opens with the declared title');
  let rows = built.b();
  const lab = l => rows.filter(r => r.label === l)[0];
  ok(lab('City') && lab('City').sub === 'Paris', 'the place row shows the city');
  ok(lab('Unit') && lab('Unit').sub === '°C', 'the choice row shows the current choice');
  ok(!lab('Note'), 'a text option has no row');
  ok(!!lab('More on your phone'), 'skipped options give the phone row');
  lab('Unit').fn();
  ok(
    calls.some(c => c[0] === '/api/cards/options' && c[1].type === 'x-demo' && c[1].set.unit === 'f' && Object.keys(c[1].set).length === 1),
    'a choice cycles and saves'
  );
  lab('More on your phone').fn();
  ok(feeds === 1, 'a saved option asks the cards for a fresh feed');
  ok(
    calls.some(c => c[0] === 'launch' && c[2] && c[2].open === 'cardspair'),
    'the phone row opens the manager'
  );
  env.cfg.cards = {};
  env.csSettings('x-demo');
  rows = built.b();
  ok(rows[0].note === 'This card is not on Home yet. Choose it for a place in Cards.', 'no card on Home: a note first');
  const cr = env.csRows();
  ok(cr.length === 1 && cr[0].label === 'Demo' && cr[0].sub === 'Not set', 'Customise gets a row per pack with settings');
});
