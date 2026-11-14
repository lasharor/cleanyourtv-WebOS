/* ---------- pages (helper/addons.js): Home is page 1 of a book, the add-ons are the pages after it ----------
   A page add-on is a web page the service serves (/addon/<id>/...). It takes Home's place, as the next page of a book: Home slides
   away and the page slides in (transform only). The number buttons (1 is Home, 2 the next page, ...) and the colour buttons
   (red Home, green, yellow, blue the next three) switch pages; Back returns to Home. A page that keeps those keys for itself
   (Live TV: digits tune channels) says so in its manifest ("claims"); then only its own keys work there and Back/Home leave it.
   The pages come from GET /api/addons; each page is loaded when you open it and unloaded when you leave it.
   The Home key of the remote is bound by the service only while a page shows (helper/book.js): the page is an iframe of the Home
   app, so webOS sees Home in front and sends no relaunch when Home is pressed. PAGER.report tells the service which page shows. */
var addonBar = []; /* topbar entries: add-ons with placement "topbar", they open their page */
var stripOn = true; /* the strip that shows the pages on Home (manager > Add-ons) */
var stripPos = ''; /* where the user put it ('' leaves that to the theme) */
var PAGES = []; /* the add-on pages after Home: {id, label, icon, page, claims} */
var LOOSE = []; /* pages switched out of the book (manager > the add-on > Page of the book): only "Open page" or {page:<id>} shows them */
var PAGER = {
  on: false /* true while a page other than Home shows */,
  id: '',
  busy: 0,
  hb: 0 /* the timer that tells the service which page shows, while one does */,
  load: function () {
    return api('/api/addons').then(
      function (x) {
        var pages = [],
          loose = [],
          bar = [],
          strip = true;
        ((x && x.addons) || [])
          .slice()
          .sort(function (a, b) {
            return a.order - b.order;
          })
          .forEach(function (a) {
            if (a.status !== 'running' || !a.enabled || !a.page || !a.tile) return;
            (a.inBook ? pages : loose).push({
              id: a.id,
              label: a.tile.label || a.name,
              icon: a.tile.icon || 'addon',
              page: a.page,
              claims: a.claims || [],
              guide: (a.permissions || []).indexOf('key.guide') >= 0,
            });
            if (a.inBook && a.tile.placement === 'topbar')
              bar.push({ label: a.tile.label || a.name, icon: a.tile.icon || 'addon', action: 'addon', addon: a.id, fixed: true });
          });
        strip = !(x && x.book && x.book.strip === false);
        var pos = (x && x.book && x.book.position) || '';
        var sig = JSON.stringify([pages, bar, strip, pos]);
        LOOSE = loose;
        if (sig === JSON.stringify([PAGES, addonBar, stripOn, stripPos])) return;
        PAGES = pages;
        addonBar = bar;
        stripOn = strip;
        stripPos = pos;
        PAGER.draw();
        rebuild();
      },
      function () {}
    );
  },
  /* The page strip: a coloured dot or a number for each page, so you see what the buttons do; the pointer can click one to turn to it. Its look and place come from the theme
     (themeStrip: style, labels, colours, edge, size); the user can put it in one of six places (manager > Add-ons), which wins. */
  draw: function () {
    var s = $('pagestrip');
    if (!s) return;
    var th = themeStrip || {},
      c = {
        show: th.show !== false,
        style: th.style || 'pills',
        labels: th.labels || 'all',
        colors: th.colors || 'colour',
        anchor: th.anchor || 'bottom',
        align: th.align || 'center',
        x: th.x === undefined ? 96 : th.x,
        y: th.y === undefined ? 22 : th.y,
        size: th.size || 1,
      };
    if (stripPos) {
      var m = stripPos.split('-');
      c.anchor = m[0];
      c.align = m[1];
      c.x = 96;
      c.y = c.anchor === 'top' ? 8 : 22; /* the top row of Home starts at 54 px */
    }
    var items = [{ id: '', label: t('Home'), icon: 'home' }].concat(PAGES);
    s.textContent = '';
    s.style.display = PAGES.length && stripOn && c.show ? 'flex' : 'none';
    s.setAttribute('data-style', c.style);
    s.setAttribute('data-labels', c.labels);
    s.setAttribute('data-anchor', c.anchor);
    s.setAttribute('data-align', c.align);
    s.style.setProperty('--st-s', String(c.size));
    s.style.setProperty('--st-x', c.x + 'px');
    s.style.setProperty('--st-y', c.y + 'px');
    items.forEach(function (p, i) {
      var e = document.createElement('div');
      e.className = 'pg' + (p.id === PAGER.id ? ' cur' : '');
      var d = document.createElement('i');
      if (i < 4 && c.colors === 'colour') {
        e.className += ' k' + i;
        if (c.style === 'pills') {
          /* the pill carries the key's colour as a wash, so the icon the add-on chose (tile.icon) takes the dot's place */
          d.className = 'ic';
          d.innerHTML = svg(p.icon);
        } else d.className = 'c' + i;
      } else d.textContent = String(i + 1);
      var l = document.createElement('span');
      /* an add-on's page name comes in English from its addon.json, like every text of the service; Home's is translated above */
      l.textContent = p.id ? t(p.label) : p.label;
      e.appendChild(d);
      e.appendChild(l);
      /* the pointer of the Magic Remote (or a mouse) turns to the page it clicks, as its number or colour button does */
      e.addEventListener('click', function () {
        PAGER.go(p.id);
      });
      s.appendChild(e);
    });
  },
  /* where a page is: 0 Home, 1.. the pages of the book; a page out of the book comes after the last one, so it slides in from the right */
  index: function (id) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].id === id) return i + 1;
    for (var j = 0; j < LOOSE.length; j++) if (LOOSE[j].id === id) return PAGES.length + 1;
    return id ? -1 : 0;
  },
  find: function (id) {
    var all = PAGES.concat(LOOSE);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  },
  claims: function (what) {
    var p = PAGER.find(PAGER.id);
    return !!p && p.claims.indexOf(what) >= 0;
  },
  /* the page for a number or colour button; false for any other key */
  pageKey: function (e) {
    var k = e.keyCode,
      n = k >= 48 && k <= 57 ? k - 48 : k >= 96 && k <= 105 ? k - 96 : k >= 403 && k <= 406 ? k - 403 + 1 : -1,
      colour = k >= 403 && k <= 406;
    if (n < 1) return false;
    if (PAGER.on && PAGER.claims(colour ? 'colors' : 'digits')) return false;
    var to = n - 1; /* 1 and red: Home; 2 and green: the first page; ... */
    if (to > PAGES.length) return false;
    e.preventDefault();
    PAGER.go(to === 0 ? '' : PAGES[to - 1].id);
    return true;
  },
  /* the page URL: the launcher's language and clock format go with it */
  url: function (p, extra) {
    var q =
      '?lang=' +
      encodeURIComponent(cfg.lang || '') +
      '&clock=' +
      encodeURIComponent(cfg.clock || '') +
      '&loc=' +
      encodeURIComponent(LOC || '');
    for (var k in extra || {}) q += '&' + k + '=' + encodeURIComponent(extra[k]);
    return API + p.page + q;
  },
  frame: function () {
    return document.querySelector('#pages iframe.pgframe');
  },
  /* turn to a page ('' is Home); params are added to its address (Live TV: guide=1) */
  go: function (id, params, instant) {
    if (id === PAGER.id) {
      if (id && params) PAGER.send({ cytv: 'guide' });
      return;
    }
    var to = PAGER.index(id),
      from = PAGER.index(PAGER.id);
    if (to < 0) return;
    var home = $('homepage'),
      old = PAGER.frame(),
      fwd = to > from;
    PAGER.busy++;
    var token = PAGER.busy;
    var nf = null;
    if (id) {
      nf = document.createElement('iframe');
      nf.className = 'pgframe';
      nf.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      nf.setAttribute('allow', 'autoplay');
      nf.style.transform = instant ? 'none' : 'translate3d(' + (fwd ? 1920 : -1920) + 'px,0,0)';
      if (instant) nf.style.transition = 'none';
      nf.src = PAGER.url(PAGER.find(id), params);
      nf.onload = function () {
        try {
          nf.contentWindow.focus();
        } catch (e) {}
        try {
          nf.contentWindow.postMessage({ cytv: 'init', vars: PAGER.vars() }, '*');
        } catch (e) {}
      };
      $('pages').appendChild(nf);
    } else {
      home.style.visibility = 'visible';
    }
    if (instant && id) home.style.visibility = 'hidden';
    PAGER.on = !!id;
    PAGER.id = id;
    PAGER.draw();
    /* one frame later the transforms change, and the CSS transition turns the page */
    setTimeout(function () {
      if (nf) nf.style.transform = 'none';
      else home.style.transform = 'none';
      if (!id) {
        if (old) old.style.transform = 'translate3d(' + (fwd ? -1920 : 1920) + 'px,0,0)';
      } else if (from === 0) home.style.transform = 'translate3d(' + (fwd ? -1920 : 1920) + 'px,0,0)';
      else if (old) old.style.transform = 'translate3d(' + (fwd ? -1920 : 1920) + 'px,0,0)';
    }, 30);
    setTimeout(function () {
      if (token !== PAGER.busy) return; /* turned again meanwhile: that turn cleans up */
      if (old && old.parentNode) old.parentNode.removeChild(old); /* unloading the page stops its video and timers */
      if (id) home.style.visibility = 'hidden'; /* nothing to paint behind the page */
      else {
        try {
          window.focus();
        } catch (e) {}
      }
    }, 380);
    logLine('page ' + (id || 'home'));
    PAGER.report();
  },
  home: function () {
    PAGER.go('');
  },
  /* The service binds the remote's Home key only while a page shows (helper/book.js: the code learned in the manager, else 773): a
     press then asks webOS for Home, which is the relaunch handled in input.js. It is told on each turn, every 30 s while a page shows
     (a restarted service starts with no page) and when the launcher is shown again. Hiding the window does not unbind the key: some
     TVs report the window hidden while it is on screen, and a bind left in place while another app is in front only makes Home open
     Home, which it does anyway. */
  report: function () {
    clearTimeout(PAGER.hb);
    PAGER.hb = 0;
    var id = PAGER.on ? PAGER.id : '';
    api('/api/book/page', { id: id }).then(
      function () {},
      function () {}
    );
    if (id) PAGER.hb = setTimeout(PAGER.report, 30000);
  },
  /* a message to the page that shows */
  send: function (m) {
    var f = PAGER.frame();
    if (f && f.contentWindow) f.contentWindow.postMessage(m, '*');
  },
  /* the theme's colours, for pages that draw like the launcher (Live TV) */
  vars: function () {
    var cs = getComputedStyle(document.documentElement),
      out = {};
    [
      'ink',
      'ink2',
      'night',
      'night-rgb',
      'panel',
      'panel2',
      'acc',
      'acc-ink',
      'focus',
      'font',
      'fs',
      'spd',
      'pill-bg',
      'pill-ring',
      'row-r',
      'menu-bg',
    ].forEach(function (n) {
      out[n] = cs.getPropertyValue('--' + n).trim();
    });
    return out;
  },
  /* a key that reached the launcher while a page shows (the frame did not have the focus) */
  key: function (e) {
    if (PAGER.claims('back') && (e.keyCode === 461 || e.keyCode === 27 || e.keyCode === 8)) return PAGER.pass(e);
    if (PAGER.pageKey(e)) return;
    if (e.keyCode === 461 || e.keyCode === 27 || e.keyCode === 8) {
      e.preventDefault();
      PAGER.home();
      return;
    }
    if (PAGER.claims('digits') || PAGER.claims('colors') || PAGER.claims('back')) PAGER.pass(e);
  },
  /* hand a key to the page (it keeps those keys) and give it the focus again */
  pass: function (e) {
    e.preventDefault();
    PAGER.send({ cytv: 'key', keyCode: e.keyCode });
    var f = PAGER.frame();
    try {
      if (f) f.contentWindow.focus();
    } catch (x) {}
  },
};
window.addEventListener('message', function (ev) {
  var d = ev.data;
  if (!PAGER.on || !d || d.id !== PAGER.id) return;
  if (d.cytvAddon === 'close') {
    var back = guideFrom && d.id === guidePage() ? guideFrom : '';
    logLine('guide closed, back to ' + (back || 'home'));
    guideFrom = '';
    PAGER.home();
    if (back) launch(back); /* Back in the guide goes to what was playing */
  } else if (d.cytvAddon === 'pagekey') PAGER.pageKey({ keyCode: d.keyCode, preventDefault: function () {} });
});
