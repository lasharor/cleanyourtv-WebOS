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
      el.className = 'scene ' + (custom ? 's-custom' : 's-' + s.id);
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
    document.body.insertBefore(frost, $('view'));
  }
  function fillOf(s) {
    if (!s) return '';
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
      if (custom) {
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
    if (id) b.classList.add(custom ? 'scene-custom' : 'scene-' + id);
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
      if (custom) {
        var s = lib[cur];
        document.body.style.setProperty('--scene-date-top', (s.date && s.date.top != null ? s.date.top : 96) + 'px');
      }
      glassCards();
    }, 700);
    /* after the fade: the old scene is no longer drawn, the next one gets ready */
    setTimeout(function () {
      var next = (cur + 1) % lib.length;
      els.forEach(function (el, k) {
        if (k !== cur && k !== next) el.classList.remove('ready', 'on');
      });
      ready(next);
    }, 2000);
  }
  function arm() {
    clearInterval(timer);
    if (on && !document.hidden)
      timer = setInterval(function () {
        show((cur + 1) % lib.length);
      }, secs * 1000);
  }
  /* the theme decides: scenes on or off, how long each stays, the glass clock with or without them */
  function apply(th) {
    var wantCouch = !!(th && th.scenes && th.scenes.set === 'couch');
    var wantCustom = !!(th && th.scenes && th.scenes.set === 'custom' && th.scenes.lib && th.scenes.lib.length);
    var want = wantCouch || wantCustom;
    secs = (th && th.scenes && th.scenes.secs) || 20;

    /* rebuild the scene list when switching mode or theme */
    var newCustom = wantCustom;
    var newLib = wantCustom ? th.scenes.lib : COUCH;
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
      document.body.insertBefore(solo, $('top'));
    }
    if (solo) {
      solo.style.display = want ? '' : 'none';
      if (want) drawClock(solo, null, shownHm || hm());
    }
  }
  /* the clock tick: the digits only change once a minute */
  function tick() {
    var h = new Date().getHours();
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
