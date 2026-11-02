/* ---------- Wallpapers: the service's photos (uploads and Immich, GET /api/wallpapers/list, and a new photo from Unsplash now and then) behind Home instead of the theme's
   background. A random photo each time Home opens and every cfg.wall.secs seconds (0: only when Home opens), cross-faded between two
   layers (opacity only). Darkened like a theme's wallpaper. Off, or no photos: the theme as it is. ---------- */
/* seconds between photos; settings saved before 1.6.10 hold minutes in "every" */
function wallSecs() {
  var w = cfg.wall || {};
  return typeof w.secs === 'number' ? w.secs : typeof w.every === 'number' ? w.every * 60 : 900;
}
var WALL = (function () {
  var LIVE = 's/live' /* Unsplash: one entry in the list that stands for "a new photo from Unsplash" */,
    list = [],
    stamp = '',
    cur = '',
    curName = '',
    side = 0,
    timer = 0,
    pollT = 0,
    pushSeq = -1,
    els = null,
    cr = null;
  function want() {
    return !!(cfg.wall && cfg.wall.on);
  }
  function layers() {
    if (els) return els;
    var g = $('gA');
    els = ['wpA', 'wpB', 'wpD'].map(function (id) {
      var d = document.createElement('div');
      d.id = id;
      d.className = id === 'wpD' ? 'wpd' : 'wp';
      g.parentNode.insertBefore(d, g); /* inside #homepage, so the photo turns with Home when the book turns to a page */
      return d;
    });
    return els;
  }
  /* an Unsplash photo's photographer in a corner, "Photo by NAME on Unsplash": Unsplash's guidelines ask for it, so it is not switchable */
  function credit(name) {
    if (!cr) {
      cr = document.createElement('div');
      cr.id = 'wpc';
      cr.className = 'wpc';
      $('gA').parentNode.appendChild(cr); /* inside #homepage like the photo, last so nothing covers it */
    }
    if (name && want()) {
      cr.textContent = t('Photo by %s on Unsplash').replace('%s', name);
      cr.classList.add('on');
    } else cr.classList.remove('on');
  }
  function dim() {
    var th = cfg.theme || {},
      d = th.wallpaper && th.wallpaper.dim != null ? th.wallpaper.dim : 0.4;
    layers()[2].style.background = 'rgba(' + (th.nightRgb || '7, 8, 11') + ',' + d + ')';
  }
  /* the Unsplash entry ("s/live") is asked of the service: it asks Unsplash for a new random photo (or, when that may not be asked for
     now, takes one shown before) and hands over its address on Unsplash and the photographer. Nothing to show (no photo yet, no
     network): skip() makes next() pick another photo, and with only Unsplash the one on screen stays */
  function show(id, skip) {
    if (id.charAt(0) === 's')
      return api('/api/wallpapers/unsplash-use', { id: id.slice(2) }).then(
        function (r) {
          if (r && r.ok && r.url) load(id, r.url, skip, r.name);
          else if (skip) skip();
        },
        function () {}
      );
    load(id, API + '/api/wallpapers/photo/' + id);
  }
  function load(id, url, skip, name) {
    var im = new Image();
    im.onerror = function () {
      if (skip && id !== LIVE) skip();
    };
    im.onload = function () {
      if (!want()) return;
      var l = layers(),
        on = l[side],
        off = l[side ^ 1];
      side ^= 1;
      on.style.backgroundImage = 'url("' + url + '")';
      on.classList.add('on');
      off.classList.remove('on');
      dim();
      document.body.classList.add('wpon');
      cur = id;
      curName = name || '';
      credit(curName);
    };
    im.src = url;
  }
  function next(tries) {
    if (!list.length) return;
    var pick = list[Math.floor(Math.random() * list.length)];
    for (var n = 0; pick === cur && pick !== LIVE && list.length > 1 && n < 8; n++) pick = list[Math.floor(Math.random() * list.length)];
    show(pick, function () {
      if ((tries || 0) < 5 && list.length > 1) next((tries || 0) + 1);
    });
  }
  function arm() {
    clearInterval(timer);
    clearInterval(pollT);
    if (list.indexOf(LIVE) >= 0) {
      poll();
      pollT = setInterval(poll, 4000);
    }
    var sec = wallSecs();
    if (sec > 0 && (list.length > 1 || list[0] === LIVE))
      timer = setInterval(function () {
        next();
      }, sec * 1000);
  }
  /* the phone page's Test key and save fetches a photo for Home to show at once: while Home is on screen with Unsplash live in the list it
     asks every few seconds whether there is one, and the service hands it out once (a photo already taken by Home is not shown again) */
  function poll() {
    if (!want() || list.indexOf(LIVE) < 0) return;
    api('/api/wallpapers/push').then(
      function (r) {
        if (!r) return;
        if (r.seq === pushSeq) return;
        pushSeq = r.seq;
        if (r.url) load(LIVE, r.url, null, r.name);
      },
      function () {}
    );
  }
  function off() {
    clearInterval(timer);
    clearInterval(pollT);
    document.body.classList.remove('wpon');
    if (els) {
      els[0].classList.remove('on');
      els[1].classList.remove('on');
    }
    if (cr) cr.classList.remove('on');
    cur = '';
    curName = '';
  }
  /* after the settings were read: switched on or off, a new interval, or a different set of photos */
  function sync() {
    if (!want()) return off();
    var st = (cfg.wallpapers && cfg.wallpapers.stamp) || '';
    if (st === stamp && list.length) {
      dim();
      credit(curName);
      return arm();
    }
    stamp = st;
    api('/api/wallpapers/list').then(
      function (x) {
        list = x.photos || [];
        if (!list.length) return off();
        if (!cur || list.indexOf(cur) < 0) next();
        arm();
      },
      function () {}
    );
  }
  return {
    sync: sync,
    /* Home is on screen again: a new photo, and the timer runs again */
    shown: function () {
      if (want() && list.length) {
        next();
        arm();
      }
    },
    hidden: function () {
      clearInterval(timer);
      clearInterval(pollT);
    },
  };
})();
