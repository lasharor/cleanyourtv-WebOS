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
  // issue 109: webOS 25 froze a live stream without a 'waiting' event, so nothing reloaded it. A watchdog on the picture time does, is stopped with the
  // video, starts afresh with every variant, and the one reload of a stall is given back after half a minute of playing
  const live = fs.readFileSync(path.join(root, 'helper', 'addons-bundled', 'iptv', 'src', 'js', 'live.js'), 'utf8');
  ok(
    /progressT = setInterval\(watchProgress, 1000\)/.test(live) &&
      /function watchProgress\(\) \{\s*if \(!started \|\| pend \|\| !video \|\| video\.paused \|\| video\.ended/.test(live) &&
      /Date\.now\(\) - lastProgressAt >= STALL_MS/.test(live) &&
      /clearInterval\(progressT\)/.test(live) &&
      /started = false;\s*lastTime = -1;\s*lastProgressAt = 0;/.test(live) &&
      /healthyT = setTimeout\(function \(\) \{\s*reloads = 0;\s*\}, 30000\)/.test(live),
    'Live TV reloads a stream whose picture time stops without a waiting event (issue 109)'
  );
  // the focused weather card has a ring with rounded corners of its own, like the tiles (an outline is a rectangle before Chromium 94)
  ok(
    /\.card-weather\.f::before\s*\{[^}]*border-radius:/.test(launcher) && !/\.card-weather\.f\s*\{[^}]*outline/.test(launcher),
    'the focused weather card has a ring with rounded corners'
  );
  // the weather drawer (wxdrawer.js) drawn from what the service keeps: the page's own code, with the page's globals stood in for
  const vm = require('vm'),
    src = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'wxdrawer.js'), 'utf8');
  const hrs = [0, 1, 2].map(i => ({
    t: '2026-10-31T' + (18 + i) + ':00',
    temp: 20 - i,
    code: i === 1 ? 61 : 2,
    rain: i === 1 ? 70 : null,
    wind: 12,
    day: true,
  }));
  const week = [0, 1].map(i => ({
    date: '2026-10-3' + (1 + i),
    code: 3,
    max: 22 - i,
    min: 14,
    rain: 30,
    sunrise: '2026-10-31T07:40',
    sunset: '2026-10-31T17:12',
  }));
  const drawn = (tab, w, place) => {
    const sandbox = {
      WXD: null,
      document: { addEventListener() {} },
      $: () => ({}),
      cfg: {},
      LOC: 'en-GB',
      clockOpts: () => ({ hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }),
      t: x => x,
      wxKind: c => [c === 61 ? 'rain' : 'part', c === 61 ? 'Rain' : 'Partly cloudy'],
      wxSvg: k => '<svg class="' + k + '"></svg>',
      lineSvg: p => '<svg>' + p + '</svg>',
      WX_ICON: { rain: '', sun: '' },
      setHtml: (el, h) => {
        el.innerHTML = h;
        return el;
      },
      cardEls: () => [{ _slot: 'under-clock', _card: { type: 'weather', place: place, lat: 1, lon: 2 } }],
      wxFor: () => w,
      saveCfg() {},
      clearTimeout() {},
      setTimeout: () => 0,
    };
    vm.createContext(sandbox);
    vm.runInContext(
      src +
        ';WXD.on = true; WXD.slot = "under-clock"; WXD.p = { innerHTML: "" }; WXD.tab = ' +
        tab +
        '; WXD.hour = 1; wxdDraw(); var out = WXD.p.innerHTML;',
      sandbox
    );
    return sandbox.out;
  };
  const full = {
    at: Date.now(),
    unit: 'c',
    now: { temp: 19, code: 2, day: true },
    detail: { feels: 17, humidity: 60, wind: 14, dir: 315, pressure: 1016, uv: 4.2, offset: 3600, hours: hrs, week, air: { aqi: 38 } },
  };
  const nowTab = drawn(0, full, 'A<b>x</b>');
  ok(
    /Feels like/.test(nowTab) &&
      />1016</.test(nowTab) &&
      />4</.test(nowTab) &&
      /Rain likely from/.test(nowTab) &&
      /Air quality/.test(nowTab),
    'the weather drawer shows what it feels like, the pressure, UV, the next rain and the air quality'
  );
  ok(!/<b>x<\/b>/.test(nowTab) && /A&lt;b&gt;x&lt;\/b&gt;/.test(nowTab), "the place's name is escaped in the weather drawer");
  const hoursTab = drawn(1, full, 'A'),
    daysTab = drawn(2, full, 'A');
  ok(
    /class="chip/.test(hoursTab) && /Chance of rain, hour by hour/.test(hoursTab) && (daysTab.match(/class="dr"/g) || []).length === 2,
    'the Hours tab has the hour chips and the Days tab a row a day'
  );
  // an answer kept by an earlier version, or one with holes, is still drawn (the drawer never throws on missing data)
  const holes = {
    at: Date.now() - 3 * 3600000,
    unit: 'c',
    now: { temp: 19, code: 2, day: true },
    detail: {
      feels: null,
      hours: [{ t: '', temp: null, code: 0, rain: null, wind: null, day: true }],
      week: [{ date: '2026-10-31', code: 0, max: null, min: null, rain: null, sunrise: '', sunset: '' }],
      air: null,
    },
  };
  let thrown = '';
  try {
    [0, 1, 2].forEach(tab => {
      drawn(tab, holes, '');
      drawn(tab, { at: Date.now(), unit: 'c', now: { temp: 5, code: 0, day: false } }, '');
    });
  } catch (e) {
    thrown = e.message;
  }
  ok(
    !thrown && /Offline, data from/.test(drawn(0, holes, '')),
    'the weather drawer copes with missing data, and says so when what it shows is old' + (thrown ? ': ' + thrown : '')
  );
  // the page functions on their own, with their globals stood in for: what a key or a click runs, without drawing the whole drawer
  const runIn = (extra, code) => {
    const sandbox = Object.assign(
      {
        WXD: null,
        document: { addEventListener() {} },
        $: () => ({}),
        cfg: { cards: {} },
        LOC: 'en-GB',
        clockOpts: () => ({ hour: 'numeric', hourCycle: 'h23' }),
        t: x => x,
        wxKind: () => ['part', 'Partly cloudy'],
        wxSvg: () => '<svg></svg>',
        lineSvg: () => '<svg></svg>',
        WX_ICON: { rain: '', sun: '' },
        setHtml: (el, h) => {
          el.innerHTML = h;
          return el;
        },
        cardEls: () => [],
        wxFor: () => null,
        saveCfg() {},
        clearTimeout() {},
        setTimeout: () => 0,
      },
      extra
    );
    vm.createContext(sandbox);
    vm.runInContext(src + '\n;' + code, sandbox);
    return sandbox;
  };
  // a place whose weather came back with a detail but without hours (an answer written by something else): Hours has one hour, not a throw
  const noHours = runIn(
    {
      cardEls: () => [{ _slot: 'side', _card: { type: 'weather' } }],
      wxFor: () => ({ at: Date.now(), detail: { feels: 3 } }),
    },
    'WXD.slot = "side"; var n = wxdHours();'
  );
  ok(noHours.n === 1, 'the Hours tab copes with an answer that has a detail but no hours');
  // the unit button on a place the theme fills (no saved card yet) writes a weather card, not an entry without a type, which the service drops
  const unit = runIn({ cfg: { cards: { side: {} } } }, 'WXD.slot = "side"; wxdUnit();');
  ok(
    unit.cfg.cards.side.type === 'weather' && unit.cfg.cards.side.unit === 'f',
    'the unit button keeps a card the theme put there a weather card'
  );
  // the wind's direction is a whole word: a one-letter text would count as used on every page (build-pages.js usedIn)
  const compass = runIn({}, 'var d = [wxdCompass(0), wxdCompass(45), wxdCompass(315), wxdCompass(null)];');
  ok(compass.d.join('|') === 'North|North-east|North-west|', "the wind's direction is a word, and empty without one");
  ok(!/t\('N'\)/.test(src) && !/t\('E'\)/.test(src), 'no one-letter text is translated in the weather drawer');
  // a card joins the row of buttons for the remote only while it is drawn: a theme can leave the place under the clock out (a glass clock,
  // clock.under off, no clock at all), and then the card must not be a stop in that row
  const target = /function cardTargets\(\) \{[\s\S]*?\n\}/.exec(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'cards.js'), 'utf8'));
  const targets = { CARD_TYPES: { weather: { act() {}, focus: () => true } } };
  targets.cardEls = () => [
    { _card: { type: 'weather' }, offsetParent: {} },
    { _card: { type: 'weather' }, offsetParent: null },
  ];
  vm.createContext(targets);
  vm.runInContext((target ? target[0] : '') + '\n;var out = cardTargets().length;', targets);
  ok(target && targets.out === 1, 'a card is in the row of buttons for the remote only while it is drawn');
  // Customise > Home Assistant lists the kinds a place can be given: the weather card of Customise > Weather is one only where it already is
  const ham = { CARD_TYPES: { 'ha-entity': {}, greeting: {}, weather: {} }, t: x => x, cfg: { cards: {} } };
  vm.createContext(ham);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'app', 'src', 'js', 'hamenu.js'), 'utf8') +
      '\n;var withW = hamKindsFor("weather").map(function (k) { return k[0]; });\n' +
      'var without = hamKindsFor("none").map(function (k) { return k[0]; });\nvar label = hamKind("weather");',
    ham
  );
  ok(
    ham.withW.indexOf('weather') >= 0 && ham.without.indexOf('weather') < 0 && ham.label === 'Weather',
    'the weather card is a kind of card only where it already is, and it is named Weather there'
  );
});
