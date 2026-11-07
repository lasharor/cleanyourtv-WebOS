/* The Stocks and Crypto cards (one page for both: m.data.kind says which; cards/crypto/ is a copy that tools/build-pages.js keeps the same).
   ES5: it runs on Chromium 68 too. Everything it shows comes in the message of the launcher: m.data is what the markets add-on's service
   said for this card (translated words included), m.opt the card's options (look: Minimal or Rich), m.lang the language. The frame has no
   network. The whole card is one button for the remote (OK or a click opens the launcher's drawer); the glass is drawn only as big as its
   content, and the button is told to match it.
   Three shapes by the size of the place: strip (under 70px high), compact (under 190px) and panel.
     strip    every symbol: symbol, price, arrow and change; a ticker that scrolls by itself when they do not fit
     compact  Minimal 2 cells, Rich 3 with a line: symbol and change, price
     panel    a header (the card's name; Open or Closed, 24h for crypto, or Offline) and Minimal 3 rows, Rich 5 with the names and lines */
var M = null,
  sentKey = '';
function sendButtons(list) {
  var key = JSON.stringify(list);
  if (key === sentKey) return;
  sentKey = key;
  parent.postMessage({ cytvCard: 'buttons', buttons: list }, '*');
}
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function fin(v) {
  return typeof v === 'number' && isFinite(v);
}
var SIGN = { USD: ['$', ''], EUR: ['€', ''], GBP: ['£', ''], JPY: ['¥', ''], BTC: ['₿', ''], ILS: ['', ' ₪'] };
/* a price: no decimals from 1,000, 2 from 1, 4 from 0.01, else 8; the currency's sign (none for an index) */
function money(v, q) {
  if (!fin(v)) return '–';
  var a = Math.abs(v),
    d = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8,
    s;
  try {
    s = v.toLocaleString(M.lang || 'en', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
  } catch (e) {
    s = v.toFixed(d);
  }
  if (!q || !q.cur || q.t === 'index') return s;
  var g = SIGN[q.cur];
  return g ? g[0] + s + g[1] : s + ' ' + q.cur;
}
/* today's change: +0.52% or, with Change shown as Price change, +1.80; a real minus sign */
function change(q) {
  var abs = M.data.show === 'abs' && M.data.kind === 'stocks',
    v = abs ? q.c : q.cp;
  if (!fin(v)) return '–';
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(abs && fin(q.p) && Math.abs(q.p) < 1 ? 4 : 2) + (abs ? '' : '%');
}
function up(q) {
  return !fin(q.cp) || q.cp >= 0;
}
function tone(q) {
  return !fin(q.cp) ? 'fl' : q.cp >= 0 ? 'up' : 'dn';
}
/* a line of the prices, w x h, green or red as today's change */
function line(q, w, h) {
  var v = q.sp || [],
    lo = Infinity,
    hi = -Infinity,
    i,
    d = '';
  for (i = 0; i < v.length; i++) {
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  var s = document.createElement('span');
  if (hi === lo) hi = lo + 1;
  for (i = 0; i < v.length && v.length > 1; i++)
    d += (i ? 'L' : 'M') + ((i / (v.length - 1)) * w).toFixed(1) + ' ' + (h - 2 - ((v[i] - lo) / (hi - lo)) * (h - 4)).toFixed(1);
  s.innerHTML =
    '<svg class="ln" width="' +
    w +
    '" height="' +
    h +
    '" viewBox="0 0 ' +
    w +
    ' ' +
    h +
    '">' +
    (d
      ? '<path d="' +
        d +
        '" fill="none" stroke="' +
        (up(q) ? '#4ade9a' : '#ff7a6e') +
        '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>'
      : '') +
    '</svg>';
  return s.firstChild;
}
/* a round badge with the first letters of the symbol (one for a coin), in a colour of its own */
function badge(q) {
  var t = String(q.s)
      .replace(/^\^/, '')
      .replace(/[.=\-].*$/, ''),
    h = 0,
    i;
  for (i = 0; i < q.s.length; i++) h = (h * 31 + q.s.charCodeAt(i)) % 360;
  var b = el('span', 'badge', t.slice(0, q.t === 'coin' ? 1 : 2));
  b.style.color = 'hsl(' + h + ',75%,68%)';
  b.style.background = 'hsla(' + h + ',75%,68%,.2)';
  b.style.boxShadow = 'inset 0 0 0 1px hsla(' + h + ',75%,68%,.4)';
  return b;
}
function short(q) {
  return String(q.s).replace(/\.[A-Z]{1,3}$/, '');
}
function status(d, L) {
  if (fin(d.at) && Date.now() - d.at > 3600000) {
    var t = '';
    try {
      t = new Date(d.at).toLocaleTimeString(M.lang, M.clock || { hour: 'numeric', minute: '2-digit' });
    } catch (e) {}
    return el('span', 'pill off', (L['Offline · %s'] || '%s').replace('%s', t));
  }
  if (d.kind === 'crypto') return el('span', 's2', L['24h'] || '24h');
  return d.open ? el('span', 'pill on', '● ' + (L.Open || '')) : el('span', 'pill', L.Closed || '');
}
/* the strip shows every symbol; when they are wider than the place, they scroll by on their own like a ticker (the remote cannot
   scroll inside a card): the list twice in a row, moved by half its width, 40px a second, only transform animates. The ticker keeps
   its place when the card is drawn again (every minute): the animation starts as far in as the clock says. */
var TICK_SPEED = 40;
function stripItems(track, d) {
  for (var i = 0; i < d.q.length; i++) {
    var q = d.q[i],
      t = el('span', 'tk');
    t.appendChild(el('span', 'sym', short(q)));
    t.appendChild(el('span', 'px', money(q.p, q)));
    t.appendChild(el('span', tone(q), (up(q) ? '▲ ' : '▼ ') + change(q).replace(/^[+−]/, '')));
    track.appendChild(t);
  }
}
/* the strip: fill(track) puts its content in once; when it does not fit, it is put in twice and scrolls as a ticker (the symbols, or a
   message too long for one line) */
function stripView(box, d, fill) {
  var track = el('span', 'track');
  fill = fill || stripItems;
  box.appendChild(track);
  fill(track, d);
  var room = Math.min(1100, window.innerWidth) - 44,
    still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (track.scrollWidth <= room || still) return;
  box.className += ' scroll';
  fill(track, d);
  var half = track.scrollWidth / 2,
    dur = Math.max(8, half / TICK_SPEED);
  track.style.animationDuration = dur.toFixed(2) + 's';
  track.style.animationDelay = (-((Date.now() / 1000) % dur)).toFixed(2) + 's';
}
function compactView(box, d, rich) {
  var i;
  for (i = 0; i < d.q.length && i < (rich ? 3 : 2); i++) {
    var q = d.q[i],
      c = el('div', 'cell'),
      r = el('div', 'row1');
    r.appendChild(el('b', '', short(q)));
    r.appendChild(el('span', tone(q), change(q)));
    c.appendChild(r);
    c.appendChild(el('div', 'px', money(q.p, q)));
    if (rich) c.appendChild(line(q, 170, 26));
    box.appendChild(c);
  }
}
/* the panel fits its place: Minimal 3 rows, Rich 5, fewer when the place is lower (header 37px, padding 38px, a row 48px, the
   "+N more" line 28px); the lines of Rich get the width left after the name (at least 110px), the price and the change, or none */
function panelView(box, d, L, rich) {
  var head = el('div', 'top'),
    H = window.innerHeight,
    inner = Math.min(560, window.innerWidth) - 60,
    rows = Math.max(1, Math.floor((H - 37 - 38) / 48)),
    k = Math.min(rich ? 5 : 3, rows),
    narrow = inner < 500,
    lw = Math.min(110, inner - 48 - (narrow ? 200 : 226) - 110 - 36),
    i;
  if (narrow) box.className += ' narrow'; /* the price and change columns are 110 and 90 instead of 130 and 96 */
  if (d.q.length > k && k > 1 && H - 37 - 38 - k * 48 < 28) k--;
  head.appendChild(el('span', 't', L[d.kind === 'crypto' ? 'Crypto' : 'Stocks'] || ''));
  head.appendChild(status(d, L));
  box.appendChild(head);
  for (i = 0; i < d.q.length && i < k; i++) {
    var q = d.q[i],
      r = el('div', 'row'),
      nm = el('div', 'nm');
    r.appendChild(badge(q));
    nm.appendChild(el('b', '', q.s));
    if (rich) nm.appendChild(el('small', '', q.n || ''));
    r.appendChild(nm);
    if (rich && lw >= 50) r.appendChild(line(q, lw, 34));
    r.appendChild(el('span', 'pr', money(q.p, q)));
    r.appendChild(el('span', 'ch ' + tone(q), change(q)));
    box.appendChild(r);
  }
  if (d.q.length > k) box.appendChild(el('div', 'more s3', (L['+%s more in the drawer'] || '+%s').replace('%s', d.q.length - k)));
}
function layout() {
  var h = window.innerHeight;
  return h < 70 ? 'strip' : h < 190 ? 'compact' : 'panel';
}
function fullButton(name, gl, mode) {
  var r = gl.getBoundingClientRect(),
    W = window.innerWidth,
    H = window.innerHeight,
    q = function (v, t) {
      return Math.max(0, Math.min(100, Math.round((v / t) * 1000) / 10));
    };
  return [{ name: name, x: q(r.left, W), y: q(r.top, H), w: q(r.width, W), h: q(r.height, H), r: mode === 'strip' ? 999 : 32 }];
}
function draw() {
  var main = document.getElementById('gl'),
    d = M && M.data,
    mode = layout(),
    rich = M.opt && M.opt.look === 'rich';
  document.documentElement.dir = M.dir || 'ltr';
  document.body.className = mode + ' ' + (rich ? 'rich' : 'min') + (d ? '' : ' wait');
  if (M.font) document.body.style.fontFamily = M.font;
  main.textContent = '';
  main.className = '';
  if (!d) {
    sendButtons([]);
    return;
  }
  var L = d.labels || {};
  if (d.empty) {
    main.className = 'msg';
    main.appendChild(el('div', 'm1', L[d.kind === 'crypto' ? 'Choose your coins' : 'Choose your stocks'] || ''));
    if (mode !== 'strip') main.appendChild(el('div', 'm2', L['Select to set it on the TV'] || ''));
    return sendButtons(fullButton('settings', main, mode));
  }
  if (d.error || !d.q || !d.q.length) {
    var said = d.error || '';
    if (mode === 'strip') {
      // one line under or above the clock: a message too long for it scrolls sideways like the symbols
      main.className = 'strip msg1';
      stripView(main, d, function (track) {
        track.appendChild(el('span', 'tk', said));
      });
      return sendButtons([]);
    }
    main.className = 'msg';
    main.appendChild(el('div', 'm1', said));
    return sendButtons([]);
  }
  if (mode === 'strip') {
    main.className = 'strip';
    stripView(main, d);
  } else if (mode === 'compact') {
    main.className = 'cmp';
    compactView(main, d, rich);
  } else {
    main.className = 'pnl';
    panelView(main, d, L, rich);
  }
  sendButtons(fullButton('open', main, mode));
}
window.addEventListener('resize', function () {
  if (M) draw();
});
window.addEventListener('message', function (e) {
  var m = e.data && e.data.cytvCard;
  if (!m || typeof m !== 'object') return;
  M = m;
  draw();
});
parent.postMessage({ cytvCard: 'ready' }, '*');
