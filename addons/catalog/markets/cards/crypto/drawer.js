/* The markets drawer: the second page of the Stocks and Crypto cards (one page for both; ES5: it runs on Chromium 68 too). The launcher
   shows it in a sheet from the side, in a frame without network; the launcher owns the keys and draws the focus ring, this page draws and
   says where its buttons are.
   In:  {cytvCard: ctx}  ctx.data is what the add-on's service said (kind, range, at, open, vs, q: the symbols, missing, labels: the words
        in the language of the screens), ctx.opt the card's options, ctx.lang, ctx.clock, ctx.dir, ctx.font;
        {cytvSheet: {select: i}} show the tab i, {act: name} a button was pressed, {focus: name} the ring moved to a button.
   Out: {cytvCard: 'ready'}; {cytvSheet: 'targets', targets: [{name, x, y, w, h, r, tab}], focus, back, tab} in percent of the frame (close,
        tab0..tab2, and c0.. for the rows of Watchlist and the tiles of Details, r0.. for the range buttons under the chart);
        {cytvSheet: 'option', set: {range}}; {cytvSheet: 'close'}.
   The page: a header (the card's name, how fresh the prices are, and Close), the chosen symbol (its price and today's change),
   and three tabs: Watchlist (OK on a row picks that symbol and shows its Chart), Chart (the range buttons set the range of the chart and
   of the lines on the card) and Details. It opens on Watchlist with the first symbol every time. */
var RANGES = {
  stocks: [
    ['1d', '1D'],
    ['5d', '5D'],
    ['1mo', '1M'],
    ['6mo', '6M'],
    ['1y', '1Y'],
  ],
  crypto: [
    ['1d', '24H'],
    ['7d', '7D'],
    ['30d', '30D'],
    ['1y', '1Y'],
  ],
};
var SIGN = { USD: ['$', ''], EUR: ['€', ''], GBP: ['£', ''], JPY: ['¥', ''], BTC: ['₿', ''], ILS: ['', ' ₪'] };
var M = null,
  tab = 0,
  sel = 0,
  focus = 'tab0',
  sentKey = '',
  MAX_TARGETS = 24,
  CHART_W = 612,
  CHART_H = 300;
function L(k) {
  var l = (M && M.data && M.data.labels) || {};
  return l[k] || k;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* numbers inside a sentence keep their own order in a right-to-left language (left-to-right isolates) */
function ltr(s) {
  return String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);
}
function fin(v) {
  return typeof v === 'number' && isFinite(v);
}
function kind() {
  return M && M.data && M.data.kind === 'crypto' ? 'crypto' : 'stocks';
}
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
/* a range, the currency sign once: $340.80 – 345.90, 238,692 – 243,050 ₪ */
function span(lo, hi, q) {
  var g = q && q.cur && q.t !== 'index' ? SIGN[q.cur] : null,
    plain = { cur: '' };
  if (!fin(lo) || !fin(hi)) return '–';
  if (g ? g[1] : q && q.cur && q.t !== 'index') return money(lo, plain) + ' – ' + money(hi, q);
  return money(lo, q) + ' – ' + money(hi, plain);
}
/* a big number with three digits: 5.08T, 270B, 41.2M, 21M */
function big(v) {
  if (!fin(v)) return '–';
  var u = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ],
    i;
  for (i = 0; i < u.length; i++) if (Math.abs(v) >= u[i][0]) return String(Number((v / u[i][0]).toPrecision(3))) + u[i][1];
  return String(Math.round(v));
}
function change(q) {
  var abs = M.data.show === 'abs' && kind() === 'stocks',
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
function badge(q, cls) {
  var t = String(q.s)
      .replace(/^\^/, '')
      .replace(/[.=\-].*$/, ''),
    h = 0,
    i;
  for (i = 0; i < q.s.length; i++) h = (h * 31 + q.s.charCodeAt(i)) % 360;
  return (
    '<span class="badge' +
    (cls ? ' ' + cls : '') +
    '" style="color:hsl(' +
    h +
    ',75%,68%);background:hsla(' +
    h +
    ',75%,68%,.2);box-shadow:inset 0 0 0 1px hsla(' +
    h +
    ',75%,68%,.4)">' +
    esc(t.slice(0, q.t === 'coin' ? 1 : 2)) +
    '</span>'
  );
}
/* a line of prices, w x h; with fill, the chart: a soft area under it and a dot at the end */
function spark(v, w, h, isUp, fill) {
  var lo = Infinity,
    hi = -Infinity,
    i,
    d = '',
    c = isUp ? '#4ade9a' : '#ff7a6e';
  v = v || [];
  for (i = 0; i < v.length; i++) {
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  if (v.length < 2) return '<svg class="ln" width="' + w + '" height="' + h + '"></svg>';
  if (hi === lo) hi = lo + 1;
  var px = function (j) {
      return (j / (v.length - 1)) * w;
    },
    py = function (p) {
      return h - 2 - ((p - lo) / (hi - lo)) * (h - 4);
    };
  for (i = 0; i < v.length; i++) d += (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(v[i]).toFixed(1);
  var lx = px(v.length - 1).toFixed(1),
    ly = py(v[v.length - 1]).toFixed(1);
  return (
    '<svg class="ln" width="' +
    w +
    '" height="' +
    h +
    '" viewBox="0 0 ' +
    w +
    ' ' +
    h +
    '">' +
    (fill ? '<path d="' + d + 'L' + w + ' ' + h + 'L0 ' + h + 'Z" fill="' + c + '" opacity=".14"/>' : '') +
    '<path d="' +
    d +
    '" fill="none" stroke="' +
    c +
    '" stroke-width="' +
    (fill ? 3 : 2.4) +
    '" stroke-linejoin="round" stroke-linecap="round"/>' +
    (fill ? '<circle cx="' + lx + '" cy="' + ly + '" r="6" fill="' + c + '"/>' : '') +
    '</svg>'
  );
}
/* the range chosen (the option, which may be newer than the data), one of this kind's ranges */
function curRange() {
  var r = (M.opt && M.opt.range) || (M.data && M.data.range),
    R = RANGES[kind()],
    i;
  for (i = 0; i < R.length; i++) if (R[i][0] === r) return i;
  return 0;
}
function pageList(d) {
  var out = '<div class="wl">',
    i;
  for (i = 0; i < d.q.length; i++) {
    var q = d.q[i];
    out +=
      '<div class="r' +
      (i === sel ? ' sel' : '') +
      '" data-n="c' +
      i +
      '">' +
      badge(q) +
      '<div class="nm"><b>' +
      esc(q.s) +
      '</b><small>' +
      esc(q.n || '') +
      '</small></div>' +
      spark(q.sp, 130, 40, up(q), false) +
      '<span class="pr">' +
      esc(money(q.p, q)) +
      '</span><span class="ch ' +
      tone(q) +
      '">' +
      esc(change(q)) +
      '</span></div>';
  }
  return out + '</div>';
}
function pageChart(d, q) {
  var v = q.sp || [],
    lo = Infinity,
    hi = -Infinity,
    R = RANGES[kind()],
    k = curRange(),
    i,
    rg = '';
  for (i = 0; i < v.length; i++) {
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  for (i = 0; i < R.length; i++) rg += '<div data-n="r' + i + '" class="' + (i === k ? 'on' : '') + '">' + esc(R[i][1]) + '</div>';
  return (
    '<div class="chart"><div class="ch2 s2"><span>' +
    esc(q.s + ' · ' + R[k][1]) +
    '</span><span>' +
    (v.length > 1 ? esc(L('High %s').replace('%s', ltr(money(hi, q))) + ' · ' + L('Low %s').replace('%s', ltr(money(lo, q)))) : '') +
    '</span></div><div class="cv">' +
    spark(v, CHART_W, CHART_H, v.length < 2 || v[v.length - 1] >= v[0], true) +
    '</div><div class="rg">' +
    rg +
    '</div></div>'
  );
}
function pageDetails(d, q) {
  var t, lo, hi, label;
  if (kind() === 'crypto') {
    t = [
      [L('Rank'), q.rank ? '#' + q.rank : '–'],
      [L('Market cap'), big(q.mc)],
      [L('24h range'), span(q.lo, q.hi, q)],
      [L('24h volume'), big(q.v)],
      [L('All-time high'), money(q.ath, q)],
      [L('Supply'), big(q.sup) + (fin(q.max) ? ' / ' + big(q.max) : '')],
    ];
    lo = q.atl;
    hi = q.ath;
    label = L('All-time range');
  } else {
    t = [
      [L('Open price'), money(q.o, q)],
      [L('Previous close'), money(q.prev, q)],
      [L('Day range'), span(q.lo, q.hi, q)],
      [L('Volume'), big(q.v)],
      [L('Currency'), q.t === 'index' ? '–' : q.cur || '–'],
      [L('Exchange'), q.x || '–'],
    ];
    lo = q.ylo;
    hi = q.yhi;
    label = L('52-week range');
  }
  var out = '<div class="stats">',
    i;
  for (i = 0; i < t.length; i++)
    out +=
      '<div class="t' +
      (t[i][1].length > 15 ? ' sm' : '') +
      '" data-n="c' +
      i +
      '"><div class="l">' +
      esc(t[i][0]) +
      '</div><div class="v">' +
      esc(t[i][1]) +
      '</div></div>';
  out += '</div>';
  if (fin(lo) && fin(hi) && hi > lo) {
    var pos = Math.max(0, Math.min(100, ((q.p - lo) / (hi - lo)) * 100));
    out +=
      '<div class="yr"><div class="s2 yh"><span>' +
      esc(label) +
      '</span><span>' +
      esc(ltr(span(lo, hi, q))) +
      '</span></div><div class="rng ltr"><i style="left:' +
      pos.toFixed(1) +
      '%"></i></div></div>';
  }
  var src = kind() === 'crypto' ? L('Data by CoinGecko') : L('Market data from Yahoo Finance, may be delayed');
  if (d.missing && d.missing.length) src += ' · ' + L('Not found: %s').replace('%s', d.missing.join(', '));
  return out + '<div class="src">' + esc(src) + '</div>';
}
function sub(d, q) {
  var at = '';
  try {
    at = new Date(d.at).toLocaleTimeString(M.lang, (M && M.clock) || { hour: 'numeric', minute: '2-digit' });
  } catch (e) {}
  if (fin(d.at) && Date.now() - d.at > 3600000)
    return '<small class="off">' + esc(L('Offline, data from %s').replace('%s', ltr(at))) + '</small>';
  if (kind() === 'crypto')
    return '<small>' + esc(L('Prices in %s').replace('%s', d.vs || '') + ' · ' + L('updated %s').replace('%s', ltr(at))) + '</small>';
  return (
    '<small>' +
    esc(d.open ? L('Delayed up to 15 min') + (q && q.x ? ' · ' + q.x : '') : L('Markets closed') + ' · ' + L('prices at close')) +
    '</small>'
  );
}
function render() {
  var app = document.getElementById('app');
  if (!M || !app) return;
  document.documentElement.dir = M.dir || 'ltr';
  if (M.font) document.body.style.fontFamily = M.font;
  var d = M.data || {},
    has = d.q && d.q.length,
    keep = 0,
    old = document.getElementById('bd');
  if (old && old.getAttribute('data-tab') === String(tab)) keep = old.scrollTop;
  if (has && sel >= d.q.length) sel = 0;
  var q = has ? d.q[sel] : null,
    body = !has
      ? '<div class="empty">' + esc(d.error || '') + '</div>'
      : tab === 0
        ? pageList(d)
        : tab === 1
          ? pageChart(d, q)
          : pageDetails(d, q);
  app.innerHTML =
    '<div class="dh"><div class="pl">' +
    esc(L(kind() === 'crypto' ? 'Crypto' : 'Stocks')) +
    (has ? sub(d, q) : '') +
    '</div><div class="bt"><div class="p" id="close">✕  ' +
    esc(L('Close')) +
    '</div></div></div>' +
    (q
      ? '<div class="hero">' +
        '<div class="big">' +
        esc(money(q.p, q)) +
        '</div><div class="hx"><b>' +
        esc(q.n || q.s) +
        '</b><span class="' +
        tone(q) +
        '">' +
        esc((up(q) ? '▲ ' : '▼ ') + ltr(change(q)) + ' ' + L('today')) +
        '</span></div></div>'
      : '') +
    '<div class="tabs">' +
    [L('Watchlist'), L('Chart'), L('Details')]
      .map(function (n, j) {
        return '<div id="tab' + j + '" class="' + (tab === j ? 'on' : '') + '">' + esc(n) + '</div>';
      })
      .join('') +
    '</div><div class="bd" id="bd" data-tab="' +
    tab +
    '">' +
    body +
    '</div>';
  document.getElementById('bd').scrollTop = keep;
  reveal();
  post(true);
}
/* scroll the list so the focused row is in view */
function reveal() {
  var bd = document.getElementById('bd'),
    el = focus ? document.querySelector('[data-n="' + focus + '"]') : null;
  if (!bd || !el) return;
  var b = bd.getBoundingClientRect(),
    r = el.getBoundingClientRect(),
    pad = 12;
  if (r.top < b.top + pad) bd.scrollTop = Math.max(0, bd.scrollTop - (b.top + pad - r.top));
  else if (r.bottom > b.bottom - pad) bd.scrollTop = bd.scrollTop + (r.bottom - (b.bottom - pad));
}
function pc(v, total) {
  return Math.max(0, Math.min(100, Math.round((v / total) * 1000) / 10));
}
function box(name, el, r, tabIx, clip) {
  var q = el.getBoundingClientRect(),
    W = window.innerWidth,
    H = window.innerHeight,
    t = q.top,
    b = q.bottom;
  if (clip) {
    t = Math.max(t, clip.top);
    b = Math.min(b, clip.bottom);
    if (b - t < 6) return null;
  }
  return { name: name, x: pc(q.left, W), y: pc(t, H), w: pc(q.width, W), h: pc(b - t, H), r: r, tab: tabIx };
}
/* the buttons that can be seen: the header, the tabs, and the rows, range buttons or tiles in view (one cut off at the edge is clipped) */
function post(force) {
  var list = [],
    fixed = [
      ['close', 32, -1],
      ['tab0', 26, 0],
      ['tab1', 26, 1],
      ['tab2', 26, 2],
    ],
    i,
    t,
    bd = document.getElementById('bd');
  for (i = 0; i < fixed.length; i++) {
    var e = document.getElementById(fixed[i][0]);
    t = e ? box(fixed[i][0], e, fixed[i][1], fixed[i][2], null) : null;
    if (t) list.push(t);
  }
  if (bd) {
    var items = bd.querySelectorAll('[data-n]'),
      clip = bd.getBoundingClientRect();
    for (i = 0; i < items.length && list.length < MAX_TARGETS; i++) {
      var n = items[i].getAttribute('data-n');
      t = box(n, items[i], n.charAt(0) === 'r' ? 24 : tab === 2 ? 20 : 18, -1, clip);
      if (t) list.push(t);
    }
  }
  var key = JSON.stringify([list, focus]);
  if (!force && key === sentKey) return;
  sentKey = key;
  // Back goes to Watchlist from the other tabs (and closes the sheet from Watchlist); Up from the page lands on the tab shown
  parent.postMessage({ cytvSheet: 'targets', targets: list, focus: focus, back: tab ? 'tab0' : '', tab: tab }, '*');
}
function select(i) {
  i = Math.max(0, Math.min(2, Math.floor(Number(i)) || 0));
  var changed = i !== tab,
    bd = document.getElementById('bd');
  tab = i;
  if (changed || /^tab/.test(focus)) focus = 'tab' + i;
  if (changed && bd) bd.scrollTop = 0;
  render();
}
/* set the range as the card's option: the launcher asks the service again and sends the new lines */
function setRange(i) {
  var R = RANGES[kind()],
    n = R[((i % R.length) + R.length) % R.length][0];
  if (M.opt) M.opt.range = n;
  parent.postMessage({ cytvSheet: 'option', set: { range: n } }, '*');
  render();
}
window.addEventListener('message', function (e) {
  var m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.cytvCard && typeof m.cytvCard === 'object') {
    M = m.cytvCard;
    render();
    return;
  }
  var s = m.cytvSheet;
  if (!s || typeof s !== 'object' || !M) return;
  if (s.select !== undefined) select(s.select);
  else if (typeof s.act === 'string') {
    var t = /^tab([0-2])$/.exec(s.act),
      c = /^c(\d+)$/.exec(s.act),
      r = /^r(\d+)$/.exec(s.act);
    if (s.act === 'close') parent.postMessage({ cytvSheet: 'close' }, '*');
    else if (t) select(+t[1]);
    else if (r && tab === 1) {
      focus = s.act;
      setRange(+r[1]);
    } else if (c && tab === 0 && M.data && M.data.q && +c[1] < M.data.q.length) {
      sel = +c[1];
      select(1);
    }
  } else if (typeof s.focus === 'string') {
    focus = s.focus;
    reveal();
    post(true);
  }
});
window.addEventListener('resize', function () {
  if (M) render();
});
parent.postMessage({ cytvCard: 'ready' }, '*');
