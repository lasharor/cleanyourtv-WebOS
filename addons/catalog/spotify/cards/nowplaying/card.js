/* The Now playing card (ES5: it runs on Chromium 68 too). Everything comes in the message of the launcher: m.data is what the Spotify
   add-on's service said (the cover as a data: address, because the frame has no network). The card is drawn once and only what changed is
   touched, so the text that runs to its end and back is not restarted by every answer. The progress bar moves with the clock between two
   answers. The cover (open the Spotify app on the song) and the four buttons (previous, play or pause, next, output) are told to the
   launcher, which makes them targets of the remote; their places are measured on the page. */
var ICON = {
  prev: '<path d="M6 6h2v12H6zM9.5 12L18 18V6z"/>',
  next: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/>',
  out: '<path d="M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-5 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 16a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
};
var BUTTONS = ['prev', 'toggle', 'next', 'output'],
  MAXH = 250 /* the tallest the card gets, and the width of a pill */,
  MAXW = 720,
  GAP = 28;
var M = null,
  D = null,
  rcv = 0,
  stamp = 0,
  told = '',
  built = null /* the parts of the card, once made */,
  key = '';

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/* 125000 -> 2:05 (and 1:02:05 for a long episode) */
function clock(ms) {
  var s = Math.floor(Math.max(0, ms) / 1000),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  s = s % 60;
  return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function at() {
  return D.playing ? Math.min(D.duration || Infinity, D.progress + (Date.now() - rcv)) : D.progress;
}
/* a text that is wider than its box runs to its end and back: it sits in a span; the box (overflow hidden, left to right) moves it with a
   transform, towards the end of the text: to the left for a Latin text, to the right for Hebrew or Arabic, which starts at the right. The
   distance goes in --np-d for the keyframes. */
function text(box, s) {
  box.firstChild.textContent = s;
  fit(box);
  /* the font may arrive after the first measurement */
  setTimeout(function () {
    fit(box);
  }, 1500);
}
/* does the text start with a letter of a right-to-left script (Hebrew, Arabic: U+0590 to U+08FF)? */
function rtl(s) {
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return false;
    if (c >= 1424 && c <= 2303) return true;
  }
  return false;
}
function fit(box) {
  var tx = box.firstChild;
  box.className = box.className.replace(/ np-run| np-rtl/g, '');
  tx.style.animationDuration = '';
  box._fw = box.clientWidth;
  var d = tx.offsetWidth - box._fw;
  if (!box._fw || d < 3) return;
  tx.style.setProperty('--np-d', -d + 'px');
  tx.style.animationDuration = (5 + d / 45).toFixed(1) + 's';
  box.className += rtl(tx.textContent) ? ' np-run np-rtl' : ' np-run';
}
function line(cls) {
  var d = el('div', cls);
  d.appendChild(el('span'));
  return d;
}
/* a new cover fades in over the old one (opacity only) once it has loaded; the old one goes when the new one is in */
function cover(box, src) {
  var imgs = box.getElementsByTagName('img');
  while (imgs.length > 1) box.removeChild(imgs[0]);
  var old = imgs[0];
  if (!src) {
    if (old) box.removeChild(old);
    return;
  }
  var im = el('img');
  im.alt = '';
  im.style.opacity = old ? '0' : '1';
  im.onload = function () {
    if (!im.parentNode) return;
    void im.offsetWidth;
    im.style.opacity = '1';
    if (old)
      setTimeout(function () {
        if (old.parentNode) old.parentNode.removeChild(old);
      }, 500);
  };
  im.src = src;
  box.appendChild(im);
}
/* the card: the cover, the lines, the bar and the buttons, made once. A place at least 200 high gets the pill (a cover of the height, three
   lines and the buttons); a smaller one the cover at its own height, without buttons. */
/* the shape of the place: a strip under 80 high (one line), a compact card under 200, else the pill */
function modeOf() {
  var H = window.innerHeight || MAXH;
  return H < 80 ? 'xs' : H < 200 ? 'sm' : 'big';
}
/* a pill narrower than its 720 is laid out at 720 and shrunk to fit, so nothing is cut off */
function build() {
  var card = document.getElementById('card'),
    W = window.innerWidth || MAXW,
    H = window.innerHeight || MAXH,
    mode = modeOf(),
    big = mode === 'big',
    /* a place about as tall as the pill (above the dock) leaves a gap at its foot, so the card does not sit on the dock */
    room = big && H <= MAXH + 10 ? H - GAP : H,
    s = big ? Math.min(1, W / MAXW, room / MAXH) : 1,
    hh = big ? Math.min(room / s, MAXH) : H;
  card.textContent = '';
  card.className = big ? '' : mode === 'xs' ? 'np-sm np-xs' : 'np-sm';
  /* the strip is as wide as its cover and text (up to the place): a long text runs to its end and back */
  card.style.cssText = 'height:' + hh + 'px;' + (mode === 'xs' ? 'width:auto;max-width:' + W + 'px' : 'width:' + (big ? MAXW : W) + 'px');
  /* the pill sits on the side the place is on (the theme's align), as the card of the launcher did */
  var al = M && M.align === 'right' ? 'right' : M && M.align === 'center' ? 'center' : '',
    cw = (big ? MAXW : W) * s,
    atRight = al === 'right' || (!al && M && M.dir === 'rtl');
  if (al === 'center') card.style.left = Math.max(0, (W - cw) / 2) + 'px';
  else if (atRight) card.style.cssText += ';left:auto;right:0';
  card.style.transformOrigin = (al === 'center' ? 'left' : atRight ? 'right' : 'left') + ' top';
  if (s < 1) card.style.transform = 'scale(' + s.toFixed(4) + ')';
  var art = el('div', 'np-art'),
    t = el('div', 'np-t'),
    c = el('div', 'np-c'),
    b = {
      card: card,
      big: big,
      mode: mode,
      al: (M && M.align) || '',
      w: W,
      h: H,
      art: art,
      s: line('np-s'),
      n: line('np-n'),
      a: line('np-a'),
      bar: el('div', 'np-bar'),
      c: c,
      btn: {},
    };
  art.style.width = art.style.height = (big ? hh - 40 : hh) + 'px';
  if (mode === 'xs') b.n.style.fontSize = Math.max(10, Math.round(H * 0.6)) + 'px';
  b.bar.appendChild(el('i'));
  BUTTONS.forEach(function (n) {
    var d = el('div', 'np-btn');
    d.setAttribute('data-name', n);
    b.btn[n] = d;
    c.appendChild(d);
  });
  b.time = el('div', 'np-time');
  c.appendChild(b.time);
  [b.s, b.n, b.a, b.bar, c].forEach(function (x) {
    t.appendChild(x);
  });
  card.appendChild(art);
  card.appendChild(t);
  built = b;
  key = '';
  return b;
}
function icon(btn, k) {
  if (btn._k === k) return;
  btn._k = k;
  btn.innerHTML = '<svg viewBox="0 0 24 24">' + ICON[k] + '</svg>';
}
function tick() {
  if (!D || !D.title || !D.duration || !built) return;
  var f = at() / D.duration,
    tx = clock(at()) + ' / ' + clock(D.duration);
  built.bar.firstChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, f)).toFixed(3) + ')';
  if (built.time._tx !== tx) built.time.textContent = built.time._tx = tx;
  /* a narrow place has no room for the time next to the buttons: it is left out rather than cut in half */
  var tl = built.time.offsetLeft - built.c.offsetLeft,
    ob = built.btn.output;
  built.time.style.visibility =
    built.big && (tl + built.time.offsetWidth > built.c.clientWidth + 1 || tl < ob.offsetLeft + ob.offsetWidth - built.c.offsetLeft)
      ? 'hidden'
      : '';
  [built.s, built.n, built.a].forEach(function (b) {
    if (b.clientWidth !== b._fw) fit(b);
  });
}
/* where the cover and the buttons are, in percent of the frame: told again only when they moved */
function tell() {
  var W = window.innerWidth || 1,
    H = window.innerHeight || 1,
    out = [],
    add = function (n, e, look, radius) {
      var r = e.getBoundingClientRect();
      out.push({
        name: n,
        x: (r.left / W) * 100,
        y: (r.top / H) * 100,
        w: (r.width / W) * 100,
        h: (r.height / H) * 100,
        r: radius,
        look: look,
      });
    };
  if (built && D && D.title) {
    add('open', built.art, 'ring', 10);
    if (built.big)
      BUTTONS.forEach(function (n) {
        add(n, built.btn[n], 'ring', 26);
      });
  }
  var k = JSON.stringify(out);
  if (k === told) return;
  told = k;
  parent.postMessage({ cytvCard: 'buttons', buttons: out }, '*');
}
function draw() {
  var card = document.getElementById('card');
  document.documentElement.dir = M.dir || 'ltr';
  document.body.style.color = M.ink || '#fff';
  if (M.font) document.body.style.fontFamily = M.font;
  /* nothing plays: nothing is drawn, unless Spotify is not set up or refused (then the card says why) */
  if (!D || !D.title) {
    built = null;
    var why = D && (D.connected === false ? D.hint : D.error);
    card.className = '';
    card.textContent = '';
    card.style.cssText = why ? 'height:auto;width:' + MAXW + 'px' : 'display:none';
    if (why) card.appendChild(el('div', 'msg', why));
    tell();
    return;
  }
  var b =
    built && built.mode === modeOf() && built.al === (M.align || '') && built.w === window.innerWidth && built.h === window.innerHeight
      ? built
      : build();
  card.style.display = '';
  b.bar.style.display = M.opt && M.opt.bar === 'off' ? 'none' : '';
  var k = D.title + '|' + D.artist + '|' + D.cover + '|' + D.device;
  if (key !== k) {
    key = k;
    cover(b.art, D.cover);
    text(b.s, D.device ? D.playingOn + ' ' + D.device : D.nowPlaying);
    text(b.n, b.mode === 'xs' && D.artist ? D.title + ' · ' + D.artist : D.title);
    text(b.a, D.artist);
  }
  icon(b.btn.prev, 'prev');
  icon(b.btn.toggle, D.playing ? 'pause' : 'play');
  icon(b.btn.next, 'next');
  icon(b.btn.output, 'out');
  tick();
  tell();
}
window.addEventListener('message', function (e) {
  var m = e.data && e.data.cytvCard;
  if (!m || typeof m !== 'object') return;
  M = m;
  if (m.data && m.data.at !== stamp) {
    stamp = m.data.at;
    rcv = Date.now();
  }
  D = m.data || null;
  draw();
});
setInterval(tick, 1000);
parent.postMessage({ cytvCard: 'ready' }, '*');
