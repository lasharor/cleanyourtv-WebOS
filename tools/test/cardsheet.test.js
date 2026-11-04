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

  const mr = csrc.match(/function cardBtnRemap[\s\S]*?\n\}\r?\n/);
  ok(!!mr, 'cards.js has cardBtnRemap');
  const rmb = {};
  vm.runInNewContext(mr[0] + ';this.f = cardBtnRemap;', rmb);
  const bx = () => [{ x: 0, y: 0, w: 100, h: 100 }];
  const same = rmb.f({ left: 0, top: 0, width: 100, height: 260 }, { left: 0, top: 0, width: 100, height: 260 }, bx());
  ok(same[0].x === 0 && same[0].y === 0 && same[0].w === 100 && same[0].h === 100, 'a frame equal to the card leaves the buttons');
  const mid = rmb.f({ left: 0, top: 100, width: 100, height: 60 }, { left: 0, top: 0, width: 100, height: 260 }, bx());
  ok(Math.abs(mid[0].y - 38.4615) < 0.01 && Math.abs(mid[0].h - 23.0769) < 0.01 && mid[0].x === 0 && mid[0].w === 100, 'a centred smaller frame moves the buttons into it: ' + JSON.stringify(mid));
  const sc = rmb.f({ left: 20, top: 200, width: 100, height: 120 }, { left: 20, top: 100, width: 200, height: 240 }, [{ x: 50, y: 50, w: 50, h: 50 }]);
  ok(Math.abs(sc[0].y - 66.667) < 0.01 && Math.abs(sc[0].x - 25) < 0.01 && Math.abs(sc[0].w - 25) < 0.01, 'rectangles on the screen work at any offset: ' + JSON.stringify(sc));
  ok(!/offsetTop/.test(csrc.slice(csrc.indexOf('function cardButtons'), csrc.indexOf('function cardButtons') + 3000)), 'cardButtons no longer uses offsetTop');

  const place = { key: 'place', kind: 'place', def: '', label: 'City', choices: [] },
    unit = { key: 'unit', kind: 'choice', def: 'c', label: 'Unit', choices: [['c', 'C'], ['f', 'F']] };
  ok(P.csUnset({}, { options: [place, unit] }) === place, 'an empty place is the unset option');
  ok(P.csUnset({ place: 'Paris' }, { options: [place, unit] }) === null, 'a filled place leaves nothing unset');
  ok(P.csUnset({}, { options: [unit] }) === null, 'a choice with a default is never unset');

  // the settings panel of any card (cardsettings.js): generic rows from the declared options
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
  const cssrc = rd('app/src/js/cardsettings.js');
  ok(!/weather|wx|forecast/i.test(cssrc), 'the settings panel names no card (it is generic)');
  ok(/@include js\/cardsettings\.js/.test(rd('app/src/index.html')) && /id="csq"/.test(rd('app/src/index.html')), 'the launcher includes the settings panel and its city input');
  ok(/csq/.test(rd('app/src/js/input.js')) && /csFind\(CSQ_TYPE/.test(rd('app/src/js/input.js')) && /csSearchEnd\(\)/.test(rd('app/src/js/input.js')), 'the city input of the panel is wired to the keys');
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
          { key: 'unit', kind: 'choice', label: 'Unit', def: 'c', choices: [['c', '°C'], ['f', '°F']] },
          { key: 'note', kind: 'text', label: 'Note', def: '', choices: [] },
        ],
      },
    },
    openBuilt: (title, b) => { built = { title, b }; },
    api: (u, b) => { calls.push([u, b]); return { then: f => f({ ok: true, cards: {} }) }; },
    launch: (a, b) => calls.push(['launch', a, b]),
    toast: () => {},
    drawCards: () => {},
    cardFeedAll: () => { feeds++; },
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
  ok(calls.some(c => c[0] === '/api/cards/options' && c[1].type === 'x-demo' && c[1].set.unit === 'f' && Object.keys(c[1].set).length === 1), 'a choice cycles and saves');
  lab('More on your phone').fn();
  ok(feeds === 1, 'a saved option asks the cards for a fresh feed');
  ok(calls.some(c => c[0] === 'launch' && c[2] && c[2].open === 'cardspair'), 'the phone row opens the manager');
  env.cfg.cards = {};
  env.csSettings('x-demo');
  rows = built.b();
  ok(rows[0].note === 'This card is not on Home yet. Choose it for a place in Cards.', 'no card on Home: a note first');
  const cr = env.csRows();
  ok(cr.length === 1 && cr[0].label === 'Demo' && cr[0].sub === 'Not set', 'Customise gets a row per pack with settings');
});
