/* ---------- Weather over the scene (theme: effects.sceneWeather, with effects.scenes "couch") ----------
   After couch-tv (github.com/Seagey/couch-tv, MIT), which draws the weather over its landscapes: while the weather the launcher
   already knows says rain, drizzle, snow, fog or a thunderstorm, that weather falls over the photo behind Home.
   The weather comes from the weather card (Open-Meteo, or a Home Assistant condition mapped to the same WMO code in cards.js); with
   no card at all, scenes.js asks the service for the weather of the place the TV stands (the city of its time zone). Nothing here
   needs Home Assistant, and without any weather nothing is drawn.
   The TV's GPU is weak, so: the drops are drawn on one canvas of 960 x 540 stretched over the screen (a quarter of the pixels), in
   one path per frame, at most 30 frames a second, and never while Home is not shown. Fog is not drawn at all: it is two wide
   gradients that only move (transform), and the lightning is one white layer that only changes opacity. */
var WEATHERFX = (function () {
  /* which effect belongs to a WMO weather code (what the weather card carries) */
  function fxFor(code) {
    var c = +code;
    if (!isFinite(c) || c < 0) return '';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 95) return 'storm';
    if (c >= 51 && c <= 57) return 'drizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    return '';
  }
  /* per effect: how many drops, how fast they fall (canvas pixels a second), how long they are drawn, how far the wind carries
     them, how wide the line is, and how much light they take */
  var KIND = {
    drizzle: { n: 46, vy: 420, len: 9, wind: 18, w: 1, alpha: 0.3, snow: false },
    rain: { n: 84, vy: 760, len: 18, wind: 44, w: 1.2, alpha: 0.42, snow: false },
    storm: { n: 104, vy: 900, len: 24, wind: 72, w: 1.4, alpha: 0.5, snow: false },
    snow: { n: 66, vy: 58, len: 0, wind: 10, w: 2.4, alpha: 0.78, snow: true },
  };
  var W = 960,
    H = 540; /* the canvas is half the screen in each direction and stretched over it */

  /* the drops of an effect, spread over the screen so it does not start empty */
  function make(kind, rnd) {
    var k = KIND[kind];
    if (!k) return [];
    var r = rnd || Math.random,
      ps = [],
      i;
    for (i = 0; i < k.n; i++)
      ps.push({
        x: r() * W,
        y: r() * H,
        s: 0.6 + r() * 0.7 /* how near it is: the nearer, the faster and the longer */,
        ph: r() * 6.28 /* where in its drift a flake is */,
      });
    return ps;
  }
  /* move them on by dt seconds; what leaves the screen comes back in at the top, and snow drifts sideways as it falls */
  function step(ps, kind, dt) {
    var k = KIND[kind];
    if (!k || !ps) return ps || [];
    var t = Math.min(dt, 0.1) /* a long gap (the page was away) must not teleport them */,
      i,
      p;
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      p.y += k.vy * p.s * t;
      p.x += k.wind * p.s * t;
      if (k.snow) {
        p.ph += t * 1.6;
        p.x += Math.sin(p.ph) * 14 * t;
      }
      if (p.y > H + 24) {
        p.y = -8 - Math.random() * 48; /* back in just above the screen, somewhere else along it */
        p.x = Math.random() * W;
      }
      if (p.x > W + 24) p.x -= W + 48;
      else if (p.x < -24) p.x += W + 48;
    }
    return ps;
  }

  /* ---- what is drawn on the TV ---- */
  var box = null,
    cv = null,
    ctx = null,
    fog = null,
    flash = null,
    kind = '',
    ps = [],
    last = 0,
    raf = 0,
    away = false,
    boltAt = 0,
    boltTo = 0;
  function ensure() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'wfx';
    cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    cv.className = 'wfxc';
    box.appendChild(cv);
    fog = document.createElement('div');
    fog.className = 'wfxfog';
    fog.innerHTML = '<i></i><i></i>';
    box.appendChild(fog);
    flash = document.createElement('div');
    flash.className = 'wfxbolt';
    box.appendChild(flash);
    try {
      ctx = cv.getContext('2d');
    } catch (e) {
      ctx = null;
    }
    var s = document.getElementById('scenes');
    if (s && s.parentNode) s.parentNode.insertBefore(box, s.nextSibling);
    else document.body.insertBefore(box, document.body.firstChild);
  }
  function clear() {
    if (ctx) ctx.clearRect(0, 0, W, H);
  }
  function draw() {
    if (!ctx) return;
    var k = KIND[kind],
      i,
      p;
    ctx.clearRect(0, 0, W, H);
    if (!k) return;
    if (k.snow) {
      ctx.fillStyle = 'rgba(255,255,255,' + k.alpha + ')';
      for (i = 0; i < ps.length; i++) {
        p = ps[i];
        ctx.fillRect(p.x, p.y, k.w * p.s, k.w * p.s);
      }
      return;
    }
    /* every drop in one path, so the TV strokes once a frame */
    ctx.strokeStyle = 'rgba(214,226,240,' + k.alpha + ')';
    ctx.lineWidth = k.w;
    ctx.beginPath();
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - k.wind * 0.02 * p.s, p.y - k.len * p.s);
    }
    ctx.stroke();
  }
  /* a thunderstorm lights up now and then: two or three short flashes, six to sixteen seconds apart */
  function bolt(now) {
    if (!flash) return;
    if (kind !== 'storm') {
      flash.style.opacity = '0';
      boltAt = 0;
      return;
    }
    if (!boltAt) boltAt = now + 4000 + Math.random() * 8000;
    if (now >= boltAt && !boltTo) {
      boltTo = now + 620;
      flash.style.opacity = '0.5';
      setTimeout(function () {
        if (flash) flash.style.opacity = '0';
      }, 90);
      setTimeout(function () {
        if (flash && kind === 'storm') flash.style.opacity = '0.34';
      }, 210);
      setTimeout(function () {
        if (flash) flash.style.opacity = '0';
      }, 300);
    }
    if (boltTo && now >= boltTo) {
      boltTo = 0;
      boltAt = now + 6000 + Math.random() * 10000;
    }
  }
  function loop(ts) {
    raf = 0;
    if (!kind || away) return;
    var now = ts || Date.now();
    if (!last) last = now;
    var dt = (now - last) / 1000;
    if (dt >= 0.033) {
      last = now;
      if (kind !== 'fog') {
        step(ps, kind, dt);
        draw();
      }
      bolt(now);
    }
    arm();
  }
  function arm() {
    if (raf || !kind || away) return;
    raf =
      window.requestAnimationFrame && kind !== 'fog'
        ? window.requestAnimationFrame(loop)
        : setTimeout(
            function () {
              loop(Date.now());
            },
            kind === 'fog' ? 400 : 40
          );
  }
  function stop() {
    if (raf) {
      if (window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
      clearTimeout(raf);
      raf = 0;
    }
  }
  /* the effect to show now ('' for none); the layers are only built once something is shown */
  function set(k) {
    if (!KIND[k] && k !== 'fog') k = '';
    if (k === kind) {
      arm();
      return;
    }
    kind = k;
    if (!k) {
      stop();
      if (box) {
        box.className = '';
        clear();
        if (flash) flash.style.opacity = '0';
      }
      return;
    }
    ensure();
    box.className = 'on fx-' + k;
    ps = kind === 'fog' ? [] : make(kind);
    last = 0;
    boltAt = 0;
    boltTo = 0;
    clear();
    arm();
  }
  return {
    fxFor: fxFor,
    make: make,
    step: step,
    kinds: KIND,
    size: { w: W, h: H },
    set: set,
    now: function () {
      return kind;
    },
    shown: function () {
      away = false;
      last = 0;
      arm();
    },
    hidden: function () {
      away = true;
      stop();
    },
  };
})();
