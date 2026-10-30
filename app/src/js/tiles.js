/* ---------- tiles (built once per app, reused across rebuilds) ---------- */
function tile(a) {
  /* a new custom icon (iv, helper/icons.js) or a new way to show it (it: Full tile): build the tile again, with the colour of the new picture */
  if (tiles[a.id] && ((tiles[a.id]._iv || 0) !== (a.iv || 0) || (tiles[a.id]._it || 0) !== (a.it ? 1 : 0))) {
    delete tiles[a.id];
    delete colors[a.id];
    storeSoon();
  }
  if (tiles[a.id]) {
    tiles[a.id]._a = a;
    return a.input ? inputTile(tiles[a.id], a) : tiles[a.id];
  }
  var d = document.createElement('div');
  d.className = 'tile' + (a.sys ? ' sys' : '');
  d._a = a;
  d._iv = a.iv || 0;
  d._it = a.it ? 1 : 0;
  tiles[a.id] = d;
  hit(d);
  if (a.sys) {
    d.innerHTML = svg(a.icon) + '<div class="slab">' + 'LG Home' + '</div>';
    return d;
  }
  if (a.input) {
    d.innerHTML = svg('hdmi') + '<div class="slab"></div><div class="slab sub"></div>';
    var f = hsl2rgb(hashHue(a.id), 0.3, 0.3);
    paint(d, { c: f, b: hsl2rgb(hashHue(a.id), 0.3, 0.16) });
    return inputTile(d, a);
  }
  var known = colors[a.id];
  if (known) {
    paint(d, known);
    d._col = known;
  }
  var i = new Image();
  i.alt = '';
  i.decoding = 'async';
  d._i = i;
  if (!known) i.crossOrigin = 'anonymous';
  i.onload = function () {
    d._iconFailed = false;
    if (d._iconFallback) {
      d._iconFallback.remove();
      d._iconFallback = null;
    }
    if (!i.parentNode) d.appendChild(i);
    if (!colors[a.id]) {
      var col = iconColor(i, a.id);
      d._col = col;
      paint(d, col);
      fit(d, !!(d.parentNode && d.parentNode.id === 'dock'));
      if (!col.t) {
        colors[a.id] = col;
        storeSoon();
      }
      if (rows[r] && rows[r][c] === d) glowNow(d);
    }
  };
  i.onerror = function () {
    d._iconFailed = true;
    i.remove();
    if (!d._iconFallback) {
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = a.title;
      d._iconFallback = t;
      d.appendChild(t);
    }
    if (!colors[a.id]) {
      var f = hsl2rgb(hashHue(a.id), 0.42, 0.42);
      paint(d, { c: f, b: hsl2rgb(hashHue(a.id), 0.4, 0.2) });
    }
  }; /* not remembered: a failed load must not pin a made-up colour */
  i.src = a.id === '__live' ? LIVE_ICON : API + '/icon/' + encodeURIComponent(a.id) + (a.iv ? '?v=' + a.iv : '');
  d.appendChild(i);
  if (i.decode) i.decode().catch(function () {});
  return d;
}

// Cached first paint can beat the helper. Retry failed helper icons only after
// an app-list request succeeds; keep fallback text until an image really loads.
function retryTileIcons() {
  Object.keys(tiles).forEach(function (id) {
    var d = tiles[id];
    if (id === '__live' || !d._iconFailed || !d._i || (d._iconRetries || 0) >= 2) return;
    d._iconFailed = false;
    d._iconRetries = (d._iconRetries || 0) + 1;
    d._i.src = API + '/icon/' + encodeURIComponent(id) + '?retry=' + d._iconRetries;
  });
}

/* ---------- ambient glow: two layers cross-fade, updated only once focus settles ---------- */
function glowNow(e) {
  var col = TH.glow || e.style.getPropertyValue('--c') || '74,84,112';
  if (col === gColor) return;
  gColor = col;
  var on = gSide ? $('gB') : $('gA'),
    off = gSide ? $('gA') : $('gB');
  gSide ^= 1;
  on.style.setProperty('--c', col);
  on.classList.add('on');
  off.classList.remove('on');
}
function glowSoon(e) {
  clearTimeout(gT);
  gT = setTimeout(function () {
    glowNow(e);
  }, 110);
}

/* a pinned input: its name (or the port), the port under a name, dimmed while nothing is connected. Its name and state can change
   while the tile is kept, so they are written each time it is drawn. */
function inputTile(d, a) {
  var port = 'HDMI ' + a.input,
    named = a.title && a.title !== port;
  d._a = a;
  d.className = d.className.replace(/ ?\binp\b| ?\boff\b/g, '') + ' inp' + (a.off ? ' off' : '');
  d.children[1].textContent = named ? a.title : port;
  d.children[2].textContent = named ? port : '';
  return d;
}
