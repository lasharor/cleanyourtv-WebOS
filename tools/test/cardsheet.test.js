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

  const place = { key: 'place', kind: 'place', default: '' },
    unit = { key: 'unit', kind: 'choice', default: 'c' };
  ok(P.csUnset({}, { options: [place, unit] }) === place, 'an empty place is the unset option');
  ok(P.csUnset({ place: 'Paris' }, { options: [place, unit] }) === null, 'a filled place leaves nothing unset');
  ok(P.csUnset({}, { options: [unit] }) === null, 'a choice with a default is never unset');
});
