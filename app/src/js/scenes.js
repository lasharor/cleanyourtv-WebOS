/* ---------- Scenes and the glass clock (theme: effects.scenes "couch"/"custom", clock.style "glass", cards.style "glass") ----------
   After couch-tv (github.com/Seagey/couch-tv, MIT): five landscapes that take turns behind Home, a large glass clock (Antonio, its fill a
   blurred copy of the scene, a thin rim and a sheen), and in four scenes the scenery cut out of the photo and drawn over the clock, so
   the peaks stand in front of the digits. The files are shipped with the launcher (app/scene-*.jpg, scene-*-fg.webp,
   scene-*-glass.jpg, antonio.woff2). Only the scene on screen and the next one are drawn (.ready); a swap is an opacity cross-fade.
   Glass cards (cards.style) are filled with the same blurred copy, placed where the card is, so no live blur is needed (the GPU is weak).
   Without scenes the glass clock stands alone with a white frosted fill.
   Custom scenes (effects.scenes "custom"): a theme brings its own images; they are served by the helper at /api/theme/scene/<id>/<file>.
   Per-scene clock and date position are set as CSS variables on each scene element; .s-custom in home.css reads them. */
var SCENES = (function () {
  var COUCH = [
    { id: 'night', fg: true },
    { id: 'golden', fg: true },
    { id: 'water', fg: false, water: 0.55 } /* the clock sits on the water: under the line a blurred reflection */,
    { id: 'fog', fg: true },
    { id: 'dawn', fg: true },
  ];
  /* Seasonal scenes (effects.seasonal, with the couch set): photos from Unsplash (free to use under the Unsplash License) in place of
     the five landscapes. Christmas (6 to 27 December), New Year (28 December to 2 January) and the seasons (winter from 21 December,
     spring from 20 March, summer from 21 June, autumn from 23 September) each have five (spring three, and three tulip fields more in the Netherlands and Belgium). The first two of each set ship with the
     launcher (app/season-<set>-<n>.jpg and -glass.jpg), so they always show; the other three are loaded from Unsplash's image host
     when they are shown and never stored on the TV, and skipped without network. p: the photo on images.unsplash.com, by: the
     photographer (shown in the corner), dark: a bright sky, so the top buttons turn dark. */
  /* where the TV is (its country setting, else the region of its locale): a photo with cc shows only in those countries, and south
     of the equator the seasons are the other way round (summer from 21 December; Christmas and New Year stay) */
  var TULIPS = ['NL', 'NLD', 'BE', 'BEL'],
    SOUTH = [
      'AU',
      'AUS',
      'NZ',
      'NZL',
      'ZA',
      'ZAF',
      'AR',
      'ARG',
      'CL',
      'CHL',
      'UY',
      'URY',
      'PY',
      'PRY',
      'BR',
      'BRA',
      'NA',
      'NAM',
      'BW',
      'BWA',
      'LS',
      'LSO',
      'SZ',
      'SWZ',
    ];
  function region() {
    var c = '';
    try {
      var w = window.webOSSystem && window.webOSSystem.country ? window.webOSSystem : window.PalmSystem;
      var j = w && w.country ? (typeof w.country === 'string' ? JSON.parse(w.country) : w.country) : null;
      c = (j && (j.smartServiceCountry || j.country)) || '';
    } catch (e) {}
    if (!c) {
      var m = /[-_]([A-Za-z]{2,3})$/.exec((window.webOSSystem && window.webOSSystem.locale) || navigator.language || '');
      c = m ? m[1] : '';
    }
    return String(c).toUpperCase();
  }
  var SEASONAL = {
    christmas: [
      { p: '1765883915553-cac1513d8712', by: 'Eugene' },
      { p: '1703270102010-0003360a821f', by: 'Daniel Dalea' },
      { p: '1638825183364-01e8b64b00e0', by: 'Dmitry Sumin' },
      { p: '1765883275758-cc4802ed4882', by: 'Eugene' },
      { p: '1670231162299-9020d1ff6f9a', by: 'Kamil Klyta' },
    ],
    newyear: [
      { p: '1735675376752-2e0fb3de9f69', by: 'Paul Fiedler' },
      { p: '1761203091809-e45f79927820', by: 'Ved Shrawak' },
      { p: '1514876246314-d9a231ea21db', by: 'Jamie Fenn' },
      { p: '1688413081412-24698b68fe52', by: 'Manny Becerra' },
      { p: '1605941407951-fa62495beb54', by: 'Jireh' },
    ],
    winter: [
      { p: '1778510093540-0da0986f7d95', by: 'Timo Wielink' },
      { p: '1518873890627-d4b177c06e51', by: 'Joel & Jasmin Førestbird', dark: true },
      { p: '1514969655361-1dbc3731d4cc', by: 'Berny Steiner' },
      { p: '1573314316983-8f4cd223ed2f', by: 'Daniele Franchi', dark: true },
      { p: '1607427045913-9a3a67be4616', by: 'Daniele Franchi', dark: true },
    ],
    spring: [
      { p: '1506260408121-e353d10b87c7', by: 'Claudio Testa' },
      { p: '1683806743160-2fc2e159dc66', by: 'Pascal Debrunner', dark: true },
      { p: '1462524500090-89443873e2b4', by: 'Anders Jildén', dark: true },
      /* tulip fields: in the Netherlands and Belgium */
      { p: '1771353527238-fe6beed69a8b', by: 'Ken Theimer', cc: TULIPS },
      { p: '1775027814804-2a25db2fc615', by: 'Chris Weiher', dark: true, cc: TULIPS },
      { p: '1554199150-22eb3cfe888d', by: 'Lisette Verwoerd', dark: true, cc: TULIPS },
    ],
    summer: [
      { p: '1683041133891-613b76cbebc7', by: 'Sergei Gussev' },
      { p: '1490682143684-14369e18dce8', by: 'Artem Sapegin' },
      { p: '1720760637240-45bc41fe31ec', by: 'Anton Sobotyak' },
      { p: '1705747894563-f47ca490bca4', by: 'Tahamie Farooqui', dark: true },
      { p: '1759434236990-3ce36b930edf', by: 'Daniel Seßler' },
    ],
    autumn: [
      { p: '1508255139162-e1f7b7288ab7', by: 'Federica Galli' },
      { p: '1761099456406-2dc9e78a4e59', by: 'Josh Sorenson' },
      { p: '1724344526531-5168ab8b034b', by: 'Michael Hamments' },
      { p: '1731617662729-cdde91663de9', by: 'iuliu illes' },
      { p: '1571680719972-f18bb57077cf', by: 'Max Andrey' },
    ],
  };
  var PHOTO = '?w=1920&h=1080&fit=crop&q=80&fm=jpg',
    PHOTO_GLASS = '?w=960&h=540&fit=crop&q=60&fm=jpg&blur=120&bri=15';
  /* which photos a day gets: a holiday, else the season */
  function seasonOf(d, south) {
    var md = (d.getMonth() + 1) * 100 + d.getDate();
    if (md >= 1206 && md <= 1227) return 'christmas';
    if (md >= 1228 || md <= 102) return 'newyear';
    var k = md >= 1221 || md <= 319 ? 0 : md <= 620 ? 1 : md <= 922 ? 2 : 3;
    return ['winter', 'spring', 'summer', 'autumn'][south ? (k + 2) % 4 : k];
  }
  var SHIPPED = 2; /* the first photos of each set that ship with the launcher */
  function seasonalLib(key, cc) {
    var out = [];
    SEASONAL[key].forEach(function (x, i) {
      if (x.cc && x.cc.indexOf(cc) < 0) return;
      var id = key + '-' + (i + 1);
      out.push({
        id: id,
        url: i < SHIPPED ? 'season-' + id : 'https://images.unsplash.com/photo-' + x.p,
        local: i < SHIPPED,
        by: x.by,
        darkSky: !!x.dark,
      });
    });
    return out;
  }
  var season = '' /* the photos in use (seasonOf), '' without effects.seasonal */,
    lastTh = null;
  var lib = COUCH /* active scene list */,
    custom = false /* whether lib comes from the theme */,
    customBase = ''; /* URL prefix for custom scene images */
  var box = null,
    frost = null,
    solo = null,
    els = [],
    cur = 0,
    timer = 0,
    shownHm = '',
    on = false,
    secs = 20,
    fontIn = false;
  function glassOn() {
    return document.body.getAttribute('data-cstyle') === 'glass';
  }
  function cardsGlass() {
    return document.body.getAttribute('data-cards') === 'glass';
  }
  /* the time for the glass clock: as the clock shows it, without AM/PM (the digits are the picture) */
  function hm() {
    return timeText()
      .replace(/\s*[AaPp]\.?\s?[Mm]\.?/, '')
      .trim();
  }
  /* destroy the scenes DOM so build() recreates it with the new lib */
  function reset() {
    if (box) {
      if (box.parentNode) box.parentNode.removeChild(box);
      box = null;
      els = [];
      cur = 0;
    }
  }
  function build() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'scenes';
    els = lib.map(function (s) {
      var el = document.createElement('div');
      el.className = 'scene ' + (custom ? 's-custom' : s.url ? 's-custom s-remote' : 's-' + s.id);
      el.innerHTML =
        '<img class="sbg" alt=""><div class="shade"></div><div class="gclock"></div>' +
        (s.water ? '<div class="gclock under"></div>' : '') +
        (s.fg || s.front ? '<img class="fg" alt="">' : '') +
        '<div class="late"></div>';
      box.appendChild(el);
      return el;
    });
    document.body.insertBefore(box, document.body.firstChild);
    /* frosted glass behind the app grid (cards.style glass): the blurred scene instead of the dark layer */
    frost = document.createElement('div');
    frost.id = 'sglass';
    $('view').parentNode.insertBefore(frost, $('view')); /* #view is inside #homepage, not the body */
  }
  function fillOf(s) {
    if (!s) return '';
    if (s.url) return 'url("' + s.url + (s.local ? '-glass.jpg' : PHOTO_GLASS) + '")';
    if (custom) return 'url("' + customBase + s.glass + '")';
    return 'url("scene-' + s.id + '-glass.jpg")';
  }
  /* the digits, and the fill placed so the blurred scene lines up with the screen behind them */
  function drawClock(el, s, text) {
    var cs = el.querySelectorAll('.gclock');
    for (var k = 0; k < cs.length; k++) {
      var c = cs[k];
      c.innerHTML = '<span class="fill"></span><span class="sheen"></span><span class="rim"></span>';
      for (var j = 0; j < 3; j++) c.childNodes[j].textContent = text;
      var f = c.firstChild;
      if (s) {
        f.style.backgroundImage = fillOf(s);
        f.style.backgroundPosition = -(c.offsetLeft + f.offsetLeft) + 'px ' + -(c.offsetTop + f.offsetTop) + 'px';
      }
    }
    if (s && s.water && cs.length > 1) {
      /* above the waterline sharp, below it the reflection; the clips reach past the box on the open sides */
      var line = 1080 * s.water - cs[0].offsetTop,
        out = '-50%';
      cs[0].style.clipPath = 'inset(' + out + ' ' + out + ' ' + (cs[0].offsetHeight - line) + 'px ' + out + ')';
      cs[1].style.clipPath = 'inset(' + line + 'px ' + out + ' ' + out + ' ' + out + ')';
    }
  }
  function setCssVars(el, s) {
    /* per-scene clock/date position for custom scenes; .s-custom reads these */
    el.style.setProperty('--scene-clock-top', (s.clock && s.clock.top != null ? s.clock.top : 150) + 'px');
    el.style.setProperty('--scene-clock-size', (s.clock && s.clock.size != null ? s.clock.size : 400) + 'px');
    el.style.setProperty('--scene-date-top', (s.date && s.date.top != null ? s.date.top : 96) + 'px');
  }
  function ready(i) {
    var s = lib[i],
      el = els[i];
    if (!el.classList.contains('ready')) {
      if (s.url) {
        var im = el.querySelector('.sbg');
        /* no network, or the photo is gone: it is skipped (the shipped photos always show) */
        im.onerror = function () {
          if (s.local) return;
          s.bad = true;
          if (lib[cur] === s) show(nextOk(cur));
        };
        im.src = s.url + (s.local ? '.jpg' : PHOTO);
        setCssVars(el, s);
      } else if (custom) {
        el.querySelector('.sbg').src = customBase + s.image;
        if (s.front) el.querySelector('.fg').src = customBase + s.front;
        setCssVars(el, s);
      } else {
        el.querySelector('.sbg').src = 'scene-' + s.id + '.jpg';
        if (s.fg) el.querySelector('.fg').src = 'scene-' + s.id + '-fg.webp';
      }
      el.classList.add('ready');
    }
    if (glassOn()) drawClock(el, s, shownHm || hm());
    else {
      var cs = el.querySelectorAll('.gclock');
      for (var k = 0; k < cs.length; k++) cs[k].textContent = '';
    }
  }
  function sceneClass(id) {
    var b = document.body;
    lib.forEach(function (s) {
      b.classList.remove('scene-' + s.id);
    });
    b.classList.remove('scene-custom');
    b.classList.remove('scene-dark-sky');
    if (id) {
      b.classList.add(custom || (lib[cur] && lib[cur].url) ? 'scene-custom' : 'scene-' + id);
      if (lib[cur] && lib[cur].darkSky) b.classList.add('scene-dark-sky');
    }
  }
  function show(i) {
    var prev = cur;
    cur = i;
    ready(i);
    els[i].classList.add('on');
    if (prev !== i) els[prev].classList.remove('on');
    /* the date moves with the clock and the glass of the cards follows the scene, halfway through the fade */
    setTimeout(function () {
      sceneClass(lib[cur].id);
      photoCredit(lib[cur]);
      if (custom || lib[cur].url) {
        var s = lib[cur];
        document.body.style.setProperty('--scene-date-top', (s.date && s.date.top != null ? s.date.top : 96) + 'px');
      }
      glassCards();
    }, 700);
    /* after the fade: the old scene is no longer drawn, the next one gets ready */
    setTimeout(function () {
      var next = nextOk(cur);
      els.forEach(function (el, k) {
        if (k !== cur && k !== next) el.classList.remove('ready', 'on');
      });
      ready(next);
    }, 2000);
  }
  function arm() {
    clearInterval(timer);
    if (on)
      timer = setInterval(function () {
        show(nextOk(cur));
      }, secs * 1000);
  }
  /* the next scene that can be shown (a seasonal photo that did not load is skipped) */
  function nextOk(i) {
    for (var k = 1; k <= lib.length; k++) {
      var j = (i + k) % lib.length;
      if (!lib[j].bad) return j;
    }
    return i;
  }
  /* the photographer of a seasonal photo, in the corner (as Wallpapers does for an Unsplash photo) */
  function photoCredit(s) {
    var c = $('scredit');
    if (!c) {
      c = document.createElement('div');
      c.id = 'scredit';
      $('homepage').appendChild(c);
    }
    c.textContent = on && s && s.by ? t('Photo: %s / Unsplash').replace('%s', s.by) : '';
    c.style.display = c.textContent ? 'block' : 'none';
  }
  /* the theme decides: scenes on or off, how long each stays, the glass clock with or without them */
  function apply(th) {
    lastTh = th;
    var wantCouch = !!(th && th.scenes && th.scenes.set === 'couch');
    var wantCustom = !!(th && th.scenes && th.scenes.set === 'custom' && th.scenes.lib && th.scenes.lib.length);
    var want = wantCouch || wantCustom;
    secs = (th && th.scenes && th.scenes.secs) || 20;

    /* rebuild the scene list when switching mode or theme */
    var newCustom = wantCustom;
    var cc = region();
    season = wantCouch && th.scenes.seasonal ? seasonOf(new Date(), SOUTH.indexOf(cc) >= 0) : '';
    var newLib = wantCustom ? th.scenes.lib : season ? seasonalLib(season, cc) : COUCH;
    var libChanged =
      newCustom !== custom ||
      newLib.length !== lib.length ||
      newLib.some(function (s, i) {
        return s.id !== lib[i].id;
      });
    if (libChanged) {
      reset();
      lib = newLib;
      custom = newCustom;
      customBase = wantCustom ? '/api/theme/scene/' + th.scenes.id + '/' : '';
    }

    on = want;
    document.body.classList.toggle('scenes-on', want);
    if (want) {
      build();
      box.style.display = '';
      if (!els[cur].classList.contains('on')) show(cur);
      else ready(cur);
      sceneClass(lib[cur].id);
    } else {
      if (box) box.style.display = 'none';
      sceneClass('');
      photoCredit(null);
    }
    soloClock();
    arm();
    glassCards();
  }
  /* the glass clock without scenes: one clock with a white frosted fill */
  function soloClock() {
    var want = glassOn() && !on;
    if (want && !solo) {
      solo = document.createElement('div');
      solo.id = 'gsolo';
      solo.innerHTML = '<div class="gclock"></div>';
      $('top').parentNode.insertBefore(solo, $('top'));
    }
    if (solo) {
      solo.style.display = want ? '' : 'none';
      if (want) drawClock(solo, null, shownHm || hm());
    }
  }
  /* the clock tick: the digits only change once a minute */
  function tick() {
    var h = new Date().getHours();
    /* a new season or holiday: the photos change with it; once an hour a photo that did not load (no network) is tried again */
    if (on && season) {
      if (seasonOf(new Date(), SOUTH.indexOf(region()) >= 0) !== season) apply(lastTh);
      else if (new Date().getMinutes() === 0)
        lib.forEach(function (x) {
          x.bad = false;
        });
    }
    document.body.classList.toggle('late', h >= 22 || h < 6);
    if (!glassOn()) return;
    var x = hm();
    if (x === shownHm && fontIn) return;
    shownHm = x;
    if (on)
      els.forEach(function (el, i) {
        if (el.classList.contains('ready')) drawClock(el, lib[i], x);
      });
    if (solo && solo.style.display !== 'none') drawClock(solo, null, x);
  }
  /* glass cards: the blurred scene behind each card, lined up with the screen; without scenes the CSS gives a plain frosted panel */
  function glassCards() {
    var cards = $('cards');
    if (!cards) return;
    var els2 = cards.children,
      g = cardsGlass() && on ? fillOf(lib[cur]) : '';
    if (frost) frost.style.backgroundImage = g ? 'linear-gradient(rgba(16,14,26,0.34),rgba(16,14,26,0.46)),' + g : '';
    for (var i = 0; i < els2.length; i++) {
      var el = els2[i];
      if (!/\bcard-(weather|ha-)/.test(el.className)) continue;
      if (!g) {
        el.style.backgroundImage = '';
        el.style.backgroundSize = '';
        el.style.backgroundPosition = '';
        continue;
      }
      var r = el.getBoundingClientRect();
      el.style.backgroundImage = 'linear-gradient(rgba(16,14,26,0.40),rgba(16,14,26,0.30)),' + g;
      el.style.backgroundSize = '100% 100%,1920px 1080px';
      el.style.backgroundPosition = '0 0,' + -Math.round(r.left) + 'px ' + -Math.round(r.top) + 'px';
    }
  }
  /* the clock's typeface must be in before the glass is measured */
  try {
    if (document.fonts && document.fonts.load)
      document.fonts.load('300 100px "CYTV Clock"').then(function () {
        fontIn = true;
        shownHm = '';
        tick();
        if (on) ready(cur);
      });
    else fontIn = true;
  } catch (e) {
    fontIn = true;
  }
  return {
    apply: apply,
    tick: tick,
    glassCards: glassCards,
    shown: function () {
      arm();
      glassCards();
    },
    hidden: function () {
      clearInterval(timer);
    },
  };
})();
