// The pages that run on the TV (launcher, manager, picker, notification card): nothing newer than Chromium 68 (webOS 5), and fixes that
// must not come back.
const fs = require('fs'),
  path = require('path');
const { root, ok, run } = require('./lib');

run(async () => {
  const pages = ['app', 'manager/app', 'picker/app', 'notify/app', 'helper/addons-bundled/iptv/page'].map(d =>
    path.join(root, d, 'index.html')
  );
  // the cards that bring a page of their own run on the TV too
  fs.readdirSync(path.join(root, 'cards', 'catalog')).forEach(id => {
    ['card.html', id + '.js'].forEach(f => {
      const file = path.join(root, 'cards', 'catalog', id, f);
      if (fs.existsSync(file)) pages.push(file);
    });
  });
  const rules = [
    [/\?\?|\?\.[A-Za-z_\[(]/, 'optional chaining or ??'],
    [/\|\|=|&&=/, 'logical assignment'],
    [
      /\.(flat|flatMap|matchAll|replaceAll|findLast)\(|\.at\(-?\d|\bObject\.fromEntries\b|\bPromise\.(allSettled|any)\b|\bglobalThis\b|\bstructuredClone\b|\bAbortSignal\.timeout\b/,
      'a function newer than Chromium 68',
    ],
    [
      /\baspect-ratio\s*:|:is\(|:where\(|:has\(|\binset\s*:|:focus-visible|\bcontainer-type|color-mix\(|\b\d+d?v?[sd]vh\b|@layer\b/,
      'CSS newer than Chromium 68',
    ],
  ];
  const bad = [];
  for (const f of pages)
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const r of rules) if (r[0].test(line)) bad.push(path.relative(root, f) + ':' + (i + 1) + ' ' + r[1]);
      });
  ok(!bad.length, 'the pages use nothing newer than Chromium 68' + (bad.length ? ':\n  ' + bad.join('\n  ') : ''));
  // the scripts must be ES5: Chromium 68 knows most of ES2015, but a slip there is a page that stays blank on webOS 5 only
  const acorn = require(path.join(root, 'tools', 'vendor', 'acorn.js'));
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8'),
      re = /<script>([\s\S]*?)<\/script>/g;
    let m,
      err = '';
    while ((m = re.exec(html))) {
      try {
        acorn.parse(m[1], { ecmaVersion: 5 });
      } catch (e) {
        err = e.message;
      }
    }
    ok(!err, 'the script of ' + path.relative(root, f) + ' is ES5' + (err ? ': ' + err : ''));
  }
  // flex "gap" is ignored before Chromium 84, and the script that once added the spacing after each redraw made lists jump and left old
  // text behind on webOS 5 (issues 4, 8, 13): flex children are spaced with sibling margins
  const gapBad = [];
  for (const f of pages) {
    const t = fs.readFileSync(f, 'utf8'),
      re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(t))) {
      if (/display:\s*(inline-)?flex/.test(m[2]) && /(^|[;\s])(row-|column-)?gap\s*:/.test(m[2]))
        gapBad.push(path.relative(root, f) + ': ' + m[1].trim().split('\n').pop());
    }
  }
  ok(!gapBad.length, 'no flex container uses gap (a sibling margin instead)' + (gapBad.length ? ':\n  ' + gapBad.join('\n  ') : ''));
  // the centred app grid (grid.align center) is a flex row: #grid's own gap does not apply there on Chromium 68 and 79, so the tiles
  // are spaced with margins and that gap is switched off for it (the check above only sees one rule at a time)
  const home = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8'),
    rule = sel => {
      const out = [],
        re = /([^{}]+)\{([^{}]*)\}/g;
      let m;
      while ((m = re.exec(home))) if (m[1].trim().split('\n').pop().trim() === sel) out.push(m[2]);
      return out.join(';');
    };
  ok(
    /margin:\s*0 calc\(var\(--gap-x\) \/ 2\) var\(--gap-y\)/.test(rule('[data-galign="center"] #grid .tile')) &&
      /(^|[;\s])gap:\s*0/.test(rule('[data-galign="center"] #grid')),
    'the centred app grid spaces its tiles with margins (flex gap is ignored on webOS 5 and 6)'
  );
  ok(
    !fs.existsSync(path.join(root, 'shared', 'flexgap.js')) && !/flexgap/.test(fs.readFileSync(path.join(root, 'ipk', 'build.py'), 'utf8')),
    'no script adds the spacing after a redraw'
  );
  ok(
    !/\.tile\.f\s*\{[^}]*outline/.test(fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8')) &&
      /\.tile\.f::before\s*\{[^}]*border-radius:/.test(fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8')) &&
      /\.tile\.fill\.f\s*\{\s*box-shadow:\s*0 0 0 var\(--ring-w\)/.test(fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8')),
    'the focus ring has its own rounded corners (an outline is a rectangle before Chromium 94), also on tiles that crop their picture'
  );
  const built = require(path.join(root, 'tools', 'build-pages.js'));
  for (const p of built.PAGES)
    ok(
      built.build(p[0]) === fs.readFileSync(path.join(root, p[1]), 'utf8'),
      p[1] + ' is built from ' + p[0] + ' (run: node tools/build-pages.js)'
    );
  // a long device name (HDMI-CEC) is the second line of a chip in the Inputs picker: the line could not shrink, so it was painted outside the
  // card, over the next ones (issue 19). It wraps onto a second line now, ends in an ellipsis there when that is not enough, and the card
  // reserves the two lines so every card's icon and port sit at the same height.
  const pickerPage = fs.readFileSync(path.join(root, 'picker', 'app', 'index.html'), 'utf8'),
    cssRule = (css, sel) => (css.match(new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}')) || [])[1] || '',
    chipSt = cssRule(pickerPage, '.chip .st'),
    chipTx = cssRule(pickerPage, '.chip .tx');
  ok(
    /-webkit-line-clamp:\s*2/.test(chipSt) &&
      /overflow:\s*hidden/.test(chipSt) &&
      /min-height:\s*2\.4em/.test(chipSt) &&
      !/white-space:\s*nowrap/.test(chipSt) &&
      /text-align:\s*center/.test(chipSt) &&
      /width:\s*100%/.test(chipTx) &&
      /overflow:\s*hidden/.test(cssRule(pickerPage, '.chip')),
    'a long input name stays inside its card in the Inputs picker, on two lines'
  );
  // the favourite star and the menus' right-hand text both had the class st: the star's width squeezed the menu text into a column
  // the Live TV page is a page of its own now (the iptv add-on); the star styles are in it
  const launcher =
    fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8') +
    fs.readFileSync(path.join(root, 'helper', 'addons-bundled', 'iptv', 'page', 'index.html'), 'utf8');
  ok(
    !/(^|\n)\s*\.st\s*\{/.test(launcher) && /svg\.st\s*\{\s*width:\s*26px/.test(launcher),
    "the favourite star is styled as svg.st, so the menu's .st text keeps its natural width"
  );
  // the manager's build() declares variables with var, which shadow a global of the same name in the whole function: a card catalog called cc
  // was undefined in build() because the channel screen has a local cc, and Get more cards did nothing
  const mdir = path.join(root, 'manager', 'src', 'js');
  const msrc = fs.readdirSync(mdir).map(n => [n, fs.readFileSync(path.join(mdir, n), 'utf8')]);
  const menu = msrc.filter(x => x[0] === 'menu.js')[0][1];
  const from = menu.indexOf('function build() {'),
    to = menu.indexOf("/* the debloat's four groups");
  const locals = {};
  menu.slice(from, to).replace(/\bvar\s+([^;]*?);/g, (m, list) => {
    list.replace(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=\s*(?:=|,|$))/g, (m2, n) => (locals[n] = 1));
    return m;
  });
  const globals = {};
  msrc.forEach(x => {
    const text = x[0] === 'menu.js' ? menu.slice(0, from) + menu.slice(to) : x[1];
    text.replace(/^(?:var|function)\s+([A-Za-z_$][\w$]*)/gm, (m, n) => (globals[n] = 1));
    text.replace(/^var\s+[^;]*;/gm, m => m.replace(/(?:^var|,)\s*([A-Za-z_$][\w$]*)\s*(?=\s*[=,;])/g, (m2, n) => (globals[n] = 1)));
  });
  const shadow = Object.keys(locals).filter(n => globals[n]);
  ok(!shadow.length, "no variable of the manager's build() has the name of a global of the manager: " + shadow.join(', '));
});
