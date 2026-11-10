// The pages that run on the TV (launcher, manager, picker, notification card): nothing newer than Chromium 68 (webOS 5), and fixes that
// must not come back.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

run(async () => {
  const cardsSource = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'cards.js'), 'utf8');
  const mdiScripts = [];
  let mdiRedraws = 0;
  const mdiContext = {
    window: {},
    document: {
      createElement: tag => ({ tag }),
      head: { appendChild: script => mdiScripts.push(script) },
    },
    tickCards: () => mdiRedraws++,
    lineSvg: () => 'domain icon',
  };
  vm.runInNewContext(cardsSource.slice(cardsSource.indexOf('var HA_ICON'), cardsSource.indexOf("/* an entity's state")), mdiContext);
  const homePage = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  ok(!/<script[^>]+src=["']mdi-glyphs\.js/.test(homePage), 'the launcher does not load the MDI map at startup');
  mdiContext.haGlyph();
  ok(!mdiScripts.length, 'an entity without an icon does not request the MDI map');
  const pending = mdiContext.haGlyph('mdi:cat');
  mdiContext.haGlyph('mdi:water');
  ok(
    mdiScripts.length === 1 && mdiScripts[0].tag === 'script' && mdiScripts[0].src === 'mdi-glyphs.js',
    'concurrent icon lookups request the bundled map only once'
  );
  ok(mdiContext.haIcon('sensor', pending) === 'domain icon', 'the domain icon is shown while the map is loading');
  mdiContext.window.HA_MDI = { 'mdi:cat': 123 };
  mdiScripts[0].onload();
  ok(
    mdiRedraws === 1 && mdiContext.haIcon('sensor', mdiContext.haGlyph('mdi:cat')).indexOf('&#123;') >= 0,
    'loading the map redraws cards and makes the glyph available'
  );
  ok(mdiContext.haIcon('sensor', mdiContext.haGlyph('mdi:unknown')) === 'domain icon', 'unknown glyphs keep the domain icon');
  let dimmed = false,
    timer,
    delay,
    keydown;
  const idleContext = {
    document: {
      body: {
        classList: {
          add: () => {
            dimmed = true;
          },
          remove: () => {
            dimmed = false;
          },
        },
      },
      addEventListener: (event, fn) => {
        if (event === 'keydown') keydown = fn;
      },
    },
    setTimeout: (fn, ms) => {
      timer = fn;
      delay = ms;
      return 1;
    },
    clearTimeout: () => {
      timer = null;
    },
  };
  vm.runInNewContext(cardsSource.slice(cardsSource.indexOf('var cardsIdleMinutes'), cardsSource.indexOf('/* OLED care:')), idleContext);
  for (const minutes of [3, 5, 10]) {
    idleContext.setCardsIdleMinutes(minutes);
    ok(delay === minutes * 60000 && typeof timer === 'function', 'card dimming uses the selected delay');
  }
  timer();
  ok(dimmed, 'cards dim when the timer expires');
  idleContext.setCardsIdleMinutes(10);
  ok(dimmed, 'unchanged settings do not wake dimmed cards');
  keydown();
  ok(!dimmed && timer, 'a key press wakes cards and restarts the timer');
  idleContext.setCardsIdleMinutes(0);
  ok(!dimmed && !timer, 'switching off card dimming cancels the timer');
  const stackContext = { document: { documentElement: { dir: 'ltr' } } };
  vm.createContext(stackContext);
  vm.runInContext(
    cardsSource.slice(cardsSource.indexOf('function fitCardStacks'), cardsSource.indexOf('/* the clock tick: cards')),
    stackContext
  );
  const stackSlots = [150, 375, 600].map((top, index) => ({ id: 's' + index, stack: 'side', t: top + 'px', h: '209px' }));
  const stackCards = [392, 114, 114].map((height, index) => ({
    _slot: 's' + index,
    _stack: 'side',
    _card: { type: 'ha-entities' },
    offsetHeight: height,
    style: {},
    getAttribute: () => 'right',
  }));
  stackContext.fitCardStacks(stackCards, stackSlots);
  ok(
    stackCards.map(card => card.style.top).join(',') === '150px,558px,688px' && stackCards.every(card => card.style.transform === ''),
    'a tall card above two short cards keeps its size when the whole stack fits'
  );
  // webOS 26: after a wake the launcher is shown without the focus and asks the service for the remote (POST /api/refocus), twice at most
  {
    const inputSrc = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'input.js'), 'utf8');
    const fn = inputSrc.slice(inputSrc.indexOf('var wakeTries'), inputSrc.indexOf("document.addEventListener('webOSRelaunch'"));
    const wake = async (focusAfter, hidden) => {
      const asked = [];
      let focus = false;
      const timers = [];
      const sb = {
        document: { hidden: !!hidden, hasFocus: () => focus },
        setTimeout: f => timers.push(f),
        logLine: () => {},
        api: p => {
          asked.push(p);
          if (asked.length >= focusAfter) focus = true;
          return Promise.resolve({ done: true });
        },
      };
      vm.runInNewContext(fn + ';checkWakeFocus(true);', sb);
      for (let i = 0; i < 10 && timers.length; i++) {
        timers.shift()();
        await new Promise(r => setImmediate(r));
      }
      return asked;
    };
    let asked = await wake(1);
    ok(asked.length === 1 && asked[0] === '/api/refocus', 'a launcher shown without the focus after a wake asks for the remote once');
    asked = await wake(99);
    ok(asked.length === 2, 'and once more when that did not help, never more');
    const focused = [];
    vm.runInNewContext(fn + ';checkWakeFocus(true);', {
      document: { hidden: false, hasFocus: () => true },
      setTimeout: f => f(),
      logLine: () => {},
      api: p => (focused.push(p), Promise.resolve({ done: true })),
    });
    ok(!focused.length, 'a launcher that has the focus asks nothing');
    asked = await wake(1, true);
    ok(asked.length === 0, 'nor one that is hidden');
  }
  // manager > an add-on > Open page: Home is launched with {page: id} and turns to it, also to a page switched out of the book
  {
    const addonsSrc = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'addons.js'), 'utf8'),
      inputSrc = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'input.js'), 'utf8');
    const pagerSrc = addonsSrc.slice(addonsSrc.indexOf('var addonBar'), addonsSrc.indexOf("window.addEventListener('message'"));
    const wantSrc = inputSrc.slice(inputSrc.indexOf('var seenParams'), inputSrc.indexOf('/* webOS 26: when the TV wakes'));
    const addon = (id, inBook, claims) => ({
      id,
      name: id,
      status: 'running',
      enabled: true,
      page: '/addon/' + id + '/index.html',
      tile: { label: id, placement: 'book' },
      inBook,
      claims: claims || [],
      order: 0,
    });
    const reply = { addons: [addon('weather', true), addon('phoneremote', false, ['back'])] };
    const homeStyle = { visibility: 'visible' };
    const sb = {
      api: () => ({ then: ok1 => (ok1(reply), { then: f => f() }) }),
      rebuild: () => {},
      $: () => ({ style: homeStyle }),
      cfg: {},
      LOC: '',
      API: '',
      closeMenus: () => {},
      inputsMenu: () => {},
      liveOn: () => false,
      LIVE: {},
      webOSSystem: { launchParams: '{}' },
      JSON,
    };
    vm.runInNewContext(
      pagerSrc +
        ';PAGER.draw = function () {};this.P = PAGER;' +
        wantSrc +
        ';this.want = wantInputs;this.shown = pageOnShow;this.watchOpen = watchOpen;',
      sb
    );
    const P = sb.P;
    P.load();
    ok(
      P.index('weather') === 1 && P.index('phoneremote') === 2 && P.index('nope') === -1,
      'a page out of the book can be opened, after the last one'
    );
    ok(sb.PAGES.length === 1, 'but it is not a page of the book (the strip and the number buttons leave it out)');
    ok(P.url(P.find('phoneremote')).indexOf('/addon/phoneremote/index.html?') === 0, 'its address is its own page');
    const went = [];
    P.go = (id, params, instant) => went.push([id, params, instant]);
    P.on = true;
    P.id = 'phoneremote';
    ok(P.claims('back') && !P.claims('digits'), 'its claims count while it shows');
    sb.webOSSystem.launchParams = JSON.stringify({ page: 'phoneremote' });
    sb.want({ then: f => f() });
    ok(
      went.length === 1 && went[0][0] === 'phoneremote' && went[0][2] === true,
      'Home launched with {page: id} turns to that page at once'
    );
    went.length = 0;
    sb.webOSSystem.launchParams = JSON.stringify({ page: 'nope' });
    sb.want({ then: f => f() });
    ok(!went.length, 'an add-on without a page is ignored');
    // webOS shows Home about a second before webOSRelaunch, with the new launchParams already set: a new {page} turns at the show
    went.length = 0;
    sb.webOSSystem.launchParams = JSON.stringify({ keepAlive: true, page: 'phoneremote' });
    sb.shown();
    ok(went.length === 1 && went[0][0] === 'phoneremote', 'Home shown with a new {page} turns to it before the relaunch arrives');
    sb.shown();
    ok(went.length === 1, 'shown again with the same parameters (an app closed): no second turn');
    sb.want({ then: f => f() });
    went.length = 0;
    sb.shown();
    ok(!went.length, 'nor after the relaunch handled them');
    sb.webOSSystem.launchParams = JSON.stringify({ keepAlive: true });
    sb.shown();
    ok(!went.length, 'Home shown without a page does not turn');
    // each open (its t) turns once: the relaunch webOS delivers late does not turn again after you left the page
    sb.webOSSystem.launchParams = JSON.stringify({ keepAlive: true, page: 'phoneremote', t: 5000 });
    sb.shown();
    ok(went.length === 1, 'an open with a t turns at the show');
    sb.want({ then: f => f() });
    ok(went.length === 1, 'and its relaunch, late or not, does not turn again');
    sb.webOSSystem.launchParams = JSON.stringify({ keepAlive: true, page: 'phoneremote', t: 6000 });
    sb.want({ then: f => f() });
    ok(went.length === 2, 'a newer open turns again');
    // the service tells the launcher of an open at once (GET /api/book/open), before webOS delivers the relaunch
    const replies = [
      { id: 'phoneremote', t: 9000, fresh: true },
      { id: 'phoneremote', t: 9500, fresh: false },
    ];
    const asked = [];
    sb.api = p => {
      asked.push(p);
      const r = replies.shift();
      return { then: f => (r ? f(r) : null) };
    };
    sb.openSince = 8000;
    went.length = 0;
    sb.watchOpen();
    ok(
      asked[0] === '/api/book/open?since=8000' && asked[1] === '/api/book/open?since=9000',
      'the launcher waits for opens, one after another'
    );
    ok(went.length === 1 && went[0][0] === 'phoneremote', 'an open the service reports turns the page at once');
    ok(asked[2] === '/api/book/open?since=9500' && went.length === 1, 'an open older than 10 s (fresh false) is not acted on');
    sb.webOSSystem.launchParams = JSON.stringify({ keepAlive: true, page: 'phoneremote', t: 9000 });
    sb.want({ then: f => f() });
    ok(went.length === 1, 'the relaunch of that open, when webOS delivers it, does not turn again');
    ok(
      /PAGER\.on && !\(p && \(p\.live \|\| p\.page\)\)\) PAGER\.home\(\)/.test(inputSrc),
      'a relaunch with {page: id} does not first turn back to Home'
    );
    const menuSrc = fs.readFileSync(path.join(root, 'manager', 'src', 'js', 'menu.js'), 'utf8');
    ok(
      /label: 'Open page'[\s\S]{0,700}api\('\/api\/book\/open', \{ id: a1\.id \}\)/.test(menuSrc),
      'the manager offers Open page and launches Home with {page: id}'
    );
    const vi = menuSrc.indexOf("label: 'Let the voice assistant act on the TV'");
    ok(
      vi > 0 && /vReady = \(va\.providers \|\| \[\]\)\.some\(/.test(menuSrc) && !/va\.hasKey/.test(menuSrc.slice(vi - 700, vi + 1500)),
      'the voice-acts switch needs any usable AI provider (a server of yours too), not only OpenRouter'
    );
  }
  const pages = [
    'app',
    'manager/app',
    'picker/app',
    'notify/app',
    'screensaver/app',
    'helper/addons-bundled/iptv/page',
    'addons/catalog/tuner/page',
  ].map(d => path.join(root, d, 'index.html'));
  // the cards that bring a page of their own run on the TV too
  fs.readdirSync(path.join(root, 'cards', 'catalog')).forEach(id => {
    ['card.html', id + '.js'].forEach(f => {
      const file = path.join(root, 'cards', 'catalog', id, f);
      if (fs.existsSync(file)) pages.push(file);
    });
  });
  // the pages of the cards of add-ons (the weather drawer) are held to the same rules
  ['drawer.html', 'drawer.js', 'drawer.css'].forEach(f =>
    pages.push(path.join(root, 'addons', 'catalog', 'weather', 'cards', 'forecast', f))
  );
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
  for (const p of built.PAGES) ok(built.fresh(p), p[1] + ' is built from ' + p[0] + ' (run: node tools/build-pages.js)');
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
      /function watchProgress\(\) \{\s*if \(!started \|\| pend \|\| !video \|\| !o\.on/.test(live) &&
      /Date\.now\(\) - lastProgressAt >= STALL_MS/.test(live) &&
      /clearInterval\(progressT\)/.test(live) &&
      /started = false;\s*lastTime = -1;\s*lastProgressAt = 0;/.test(live) &&
      /healthyT = setTimeout\(function \(\) \{\s*reloads = 0;\s*\}, 30000\)/.test(live),
    'Live TV reloads a stream whose picture time stops without a waiting event (issue 109)'
  );
  // issue 224: webOS 25 left the video paused and ended, which the watchdog skipped: pause and ended now reload it, ended also in the watchdog
  ok(
    /function watchProgress\(\) \{\s*if \(!started \|\| pend \|\| !video \|\| !o\.on \|\| document\.hidden\) return;\s*[^]*?if \(video\.ended\) \{\s*lastProgressAt = Date\.now\(\);\s*stalled\(\);/.test(
      live
    ) &&
      /v\.addEventListener\('pause', function \(\) \{\s*if \(!o\.on \|\| !started \|\| pend \|\| failed \|\| document\.hidden\) return;[^]*?v\.paused[^]*?stalled\(\);[^]*?, 1500\)/.test(
        live
      ) &&
      /v\.addEventListener\('ended', function \(\) \{\s*if \(video === v && o\.on && started && !pend && !failed\) stalled\(\);/.test(live),
    'Live TV reloads a stream the TV leaves paused or ended (issue 224)'
  );
  // the text of an add-on on the Add-ons tab was cut off at the bottom of the screen (Weather forecast): it sits in a box of six lines and, when
  // longer, drifts up by itself (the remote cannot scroll it), with a fade at the cut edge; only transform animates
  const lst = msrc.filter(x => x[0] === 'list.js')[0][1];
  const mcss = fs.readFileSync(path.join(root, 'manager', 'src', 'css', 'manager.css'), 'utf8');
  ok(
    /box\.className = 'abt'/.test(lst) &&
      /aboutScroll\(box, txt\)/.test(lst) &&
      /clearTimeout\(abTimer\)/.test(lst) &&
      /'transform ' \+/.test(lst) &&
      /#info \.abt \{\s*max-height: 270px;\s*overflow: hidden;/.test(mcss) &&
      /#info \.abt\.ov \{\s*-webkit-mask-image/.test(mcss),
    "an add-on's long text on the Add-ons tab stays in its box and scrolls by itself"
  );
  // Experimental > Preloaded apps: the State row steps only through the modes this TV uses (PR 149)
  const mm = fs.readFileSync(path.join(root, 'manager', 'src', 'js', 'menu.js'), 'utf8');
  ok(
    /var states = \['off'\]\.concat\(\s*preSet\.modes\.filter\(function \(m\) \{\s*return seen\[m\];/.test(mm),
    'the preload State row offers only the modes the TV itself uses'
  );
  // a card of an add-on: its declared drawer and settings actions are the launcher's (the sheet and the settings panel)
  const rd = f => fs.readFileSync(path.join(root, ...f.split('/')), 'utf8');
  const wcards = rd('app/src/js/cards.js'),
    winput = rd('app/src/js/input.js'),
    wmgr = rd('manager/src/js/input.js');
  ok(
    /function cardBtnRoute/.test(wcards) && /csSettings\(/.test(wcards) && /csOpen\(el\)/.test(wcards) && /CS\.on/.test(winput),
    'the declared settings and drawer actions of a card open the generic panel and sheet (cardBtnRoute)'
  );
  ok(
    !fs.existsSync(path.join(root, 'app', 'src', 'js', 'wxdrawer.js')) &&
      !/x-forecast|wxdrawer|\bwxd\b|\bWXD\b|wxq|wxMenu|wxSet/i.test(
        ['js/cards.js', 'js/menus.js', 'js/input.js', 'js/cardsheet.js', 'js/cardsettings.js', 'css/cardsheet.css']
          .map(p => rd('app/src/' + p))
          .concat([rd('helper/cards.js'), rd('helper/apps.js')])
          .join('\n')
      ),
    'the launcher has no code of the weather add-on (no wxdrawer, no x-forecast, no wx names)'
  );
  ok(
    /p\.open === 'cardspair'/.test(wmgr) && /openCardsPair\(\)/.test(wmgr),
    "the manager opens the cards' phone page (QR code) at once when asked"
  );
  // the card sheet host: wired into the launcher, generic (no word of any one card)
  const cshtml = rd('app/src/index.html'),
    csjs = rd('app/src/js/cardsheet.js'),
    cscss = rd('app/src/css/cardsheet.css');
  ok(
    /@include js\/cardsheet\.js/.test(cshtml) && /@include css\/cardsheet\.css/.test(cshtml) && /<div id="cs"><\/div>/.test(cshtml),
    'the launcher includes the card sheet (script, style and its element)'
  );
  ok(
    /CS\.on/.test(winput) && /csKey\(k, e\)/.test(winput) && /csClose\(\)/.test(winput),
    'the keys go to the card sheet while it is open, and a relaunch closes it'
  );
  ok(!/weather|wx|forecast/i.test(csjs) && !/weather|wx|forecast/i.test(cscss), 'the card sheet names no card (it is generic)');
  ok(/e\.source !== CS\.frame\.contentWindow/.test(csjs), 'the card sheet listens only to its own frame');
});
