/* ---------- Wallpapers: the service's photos (uploads and Immich, GET /api/wallpapers/list) behind Home instead of the theme's
   background. A random photo each time Home opens and every cfg.wall.secs seconds (0: only when Home opens), cross-faded between two
   layers (opacity only). Darkened like a theme's wallpaper. Off, or no photos: the theme as it is. ---------- */
/* seconds between photos; settings saved before 1.6.10 hold minutes in "every" */
function wallSecs() {
  var w = cfg.wall || {};
  return typeof w.secs === 'number' ? w.secs : typeof w.every === 'number' ? w.every * 60 : 900;
}
var WALL = (function () {
  var list = [],
    stamp = '',
    cur = '',
    side = 0,
    timer = 0,
    els = null;
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
  function dim() {
    var th = cfg.theme || {},
      d = th.wallpaper && th.wallpaper.dim != null ? th.wallpaper.dim : 0.4;
    layers()[2].style.background = 'rgba(' + (th.nightRgb || '7, 8, 11') + ',' + d + ')';
  }
  function show(id) {
    var url = API + '/api/wallpapers/photo/' + id,
      im = new Image();
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
    };
    im.src = url;
  }
  function next() {
    if (!list.length) return;
    var pick = list[Math.floor(Math.random() * list.length)];
    for (var n = 0; pick === cur && list.length > 1 && n < 8; n++) pick = list[Math.floor(Math.random() * list.length)];
    show(pick);
  }
  function arm() {
    clearInterval(timer);
    var sec = wallSecs();
    if (sec > 0 && list.length > 1) timer = setInterval(next, sec * 1000);
  }
  function off() {
    clearInterval(timer);
    document.body.classList.remove('wpon');
    if (els) {
      els[0].classList.remove('on');
      els[1].classList.remove('on');
    }
    cur = '';
  }
  /* after the settings were read: switched on or off, a new interval, or a different set of photos */
  function sync() {
    if (!want()) return off();
    var st = (cfg.wallpapers && cfg.wallpapers.stamp) || '';
    if (st === stamp && list.length) {
      dim();
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
    },
  };
})();
