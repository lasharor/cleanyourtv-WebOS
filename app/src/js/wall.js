/* ---------- Wallpapers: the service's photos (uploads and the photo sources of add-ons, GET /api/wallpapers/list) behind Home instead of the theme's
   background. A random photo every cfg.wall.secs seconds while Home is on screen; when Home opens again, a new one only if that many
   seconds have passed since the last change (0: a new photo each time Home opens), cross-faded between two layers (opacity only). Darkened like a theme's wallpaper. Off, or no photos: the theme as it is. ---------- */
/* seconds between photos; settings saved before 1.6.10 hold minutes in "every" */
function wallSecs() {
  var w = cfg.wall || {};
  return typeof w.secs === 'number' ? w.secs : typeof w.every === 'number' ? w.every * 60 : 900;
}
var WALL = (function () {
  var list = [],
    stamp = '',
    cur = '',
    curCredit = '',
    side = 0,
    last = 0 /* when the photo on screen was put there (ms) */,
    timer = 0,
    pollT = 0,
    els = null;
  /* a "live" entry (l/<add-on>): a photo source that is not kept on the TV and asks its server now and then */
  var isLive = function (id) {
    return id.slice(0, 2) === 'l/';
  };
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
  /* the line a photo source asks for in a corner (the photographer of an Unsplash photo); inside #homepage, so it turns with Home */
  function credit(text) {
    var c = $('wpc');
    if (!c) {
      c = document.createElement('div');
      c.id = 'wpc';
      $('homepage').appendChild(c);
    }
    c.textContent = want() ? text || '' : '';
    c.style.display = c.textContent ? 'block' : 'none';
  }
  function dim() {
    var th = cfg.theme || {},
      d = th.wallpaper && th.wallpaper.dim != null ? th.wallpaper.dim : 0.4;
    layers()[2].style.background = 'rgba(' + (th.nightRgb || '7, 8, 11') + ',' + d + ')';
  }
  /* a live entry is asked of the service (/api/wallpapers/live/<add-on>): it hands over an address on the source's own server and a
     credit line. Nothing to show (no photo yet, no network): skip() makes next() pick another photo, and with only a live source the
     one on screen stays */
  function show(id, skip) {
    if (isLive(id))
      return api('/api/wallpapers/live/' + id.slice(2)).then(
        function (r) {
          if (r && r.url) load(id, r.url, skip, r.credit);
          else if (skip) skip();
        },
        function () {}
      );
    load(id, API + '/api/wallpapers/photo/' + id, skip, '');
  }
  function load(id, url, skip, text) {
    var im = new Image();
    im.onerror = function () {
      if (skip && !isLive(id)) skip();
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
      last = Date.now();
      curCredit = text || '';
      credit(curCredit);
    };
    im.src = url;
  }
  function next(tries) {
    if (!list.length) return;
    var pick = list[Math.floor(Math.random() * list.length)];
    for (var n = 0; pick === cur && !isLive(pick) && list.length > 1 && n < 8; n++) pick = list[Math.floor(Math.random() * list.length)];
    show(pick, function () {
      if ((tries || 0) < 5 && list.length > 1) next((tries || 0) + 1);
    });
  }
  function hasLive() {
    return list.some(isLive);
  }
  function arm() {
    clearInterval(timer);
    clearInterval(pollT);
    if (hasLive()) {
      poll();
      pollT = setInterval(poll, 4000);
    }
    var sec = wallSecs();
    if (sec > 0 && (list.length > 1 || (list.length && isLive(list[0]))))
      timer = setInterval(function () {
        next();
      }, sec * 1000);
  }
  /* a live source can have a photo for Home at once (Unsplash: the one the phone page's Test key and save fetched): while Home is on
     screen with a live entry in the list it asks every few seconds, and the service hands the photo out once */
  function poll() {
    if (!want() || !hasLive()) return;
    api('/api/wallpapers/push').then(
      function (r) {
        if (r && r.url && r.id) load(r.id, r.url, null, r.credit);
      },
      function () {}
    );
  }
  function off() {
    clearInterval(timer);
    clearInterval(pollT);
    document.body.classList.remove('wpon');
    credit('');
    if (els) {
      els[0].classList.remove('on');
      els[1].classList.remove('on');
    }
    cur = '';
    curCredit = '';
  }
  /* after the settings were read: switched on or off, a new interval, or a different set of photos */
  function sync() {
    if (!want()) return off();
    var st = (cfg.wallpapers && cfg.wallpapers.stamp) || '';
    if (st === stamp && list.length) {
      dim();
      credit(curCredit);
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
    /* Home is on screen again: a new photo when it is time for one (every time with 0 seconds; else once the interval has passed since the
       last change, so opening Home does not change the photo or decode a new one before then), and the timer runs again */
    shown: function () {
      if (want() && list.length) {
        var gone = Date.now() - last,
          sec = wallSecs();
        if (!sec || !last || gone < 0 || gone >= sec * 1000) next();
        arm();
      }
    },
    hidden: function () {
      clearInterval(timer);
      clearInterval(pollT);
    },
  };
})();
