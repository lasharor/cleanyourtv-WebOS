/* The markets drawer: the second page of the Stocks and Crypto cards (one page for both; ES5: it runs on Chromium 68 too). The launcher
   shows it in a sheet from the side, in a frame without network; the launcher owns the keys and draws the focus ring, this page draws and
   says where its buttons are.
   Two views, no tabs:
     list    every symbol: name, a line, price and today's change. OK on a row opens it; Back closes the drawer; CH+/CH- page by 8 rows.
     symbol  one symbol: price, today's change, the range buttons, the chart, the key numbers and the day and year (or all-time) ranges.
             Left/Right move along the range buttons and, past the first or last, to the previous or next symbol (the range is kept);
             CH+/CH- step symbols; OK on a range button loads it; Back returns to the list on that symbol's row.
   The range here is for browsing: the card's own line on Home is a setting in Customise and is not changed. A range other than the card's
   is asked from the service with the card action "chart" ("AAPL:1y"); the next data has it as data.chart.
   In:  {cytvCard: ctx}  ctx.data is what the add-on's service said (kind, range, at, open, vs, q, missing, chart, labels), ctx.opt the
        card's options, ctx.lang, ctx.clock, ctx.dir, ctx.font;
        {cytvSheet: {act: name}} OK on a target, or an edge or Back action (prev, next, list); {cytvSheet: {focus: name}} the ring moved;
        {cytvSheet: {key: 'chup' | 'chdown'}} CH+ / CH-.
   Out: {cytvCard: 'ready'}; {cytvSheet: 'targets', targets: [{name, x, y, w, h, r, tab}], focus, back, tab, edges} in percent of the
        frame (close, c0.. the rows in view, r0.. the range buttons); {cytvSheet: 'action', name: 'chart', arg}. */
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
var PAST = {
  '1d': 'past day',
  '5d': 'past 5 days',
  '1mo': 'past month',
  '6mo': 'past 6 months',
  '1y': 'past year',
  '7d': 'past 7 days',
  '30d': 'past 30 days',
};
var SINCE = {
  '5d': '5 days ago',
  '1mo': '1 month ago',
  '6mo': '6 months ago',
  '1y': '1 year ago',
  '7d': '7 days ago',
  '30d': '30 days ago',
};
var SIGN = { USD: ['$', ''], EUR: ['€', ''], GBP: ['£', ''], JPY: ['¥', ''], BTC: ['₿', ''], ILS: ['', ' ₪'] };
var X =
  '<svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
var M = null,
  view = 'list',
  sel = 0,
  selSym = '',
  focus = 'c0',
  range = '',
  asked = '',
  askedAt = 0,
  sentKey = '',
  ROW = 96,
  MAX_TARGETS = 24;

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
function list() {
  return (M && M.data && M.data.q) || [];
}
function short(q) {
  return String(q.s).replace(/\.[A-Z]{1,3}$/, '');
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
function pct(v) {
  return fin(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%' : '–';
}
function tone(v) {
  return !fin(v) || v === 0 ? 'fl' : v > 0 ? 'up' : 'dn';
}
function stale() {
  var d = M && M.data;
  return !!(d && fin(d.at) && Date.now() - d.at > 3600000);
}
function timeOf() {
  try {
    return new Date(M.data.at).toLocaleTimeString(M.lang, M.clock || { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}
function ranges() {
  return RANGES[kind()];
}
function rIndex() {
  var R = ranges(),
    i;
  for (i = 0; i < R.length; i++) if (R[i][0] === range) return i;
  return 0;
}

/* ---------- the line of a symbol for the range chosen here ---------- */
/* {sp, rc} when it is there (the card's own range, or the chart the service answered), else null (being asked) */
function series(q) {
  var d = M.data || {};
  if (range === d.range) return { sp: q.sp || [], rc: q.rc };
  var c = d.chart;
  if (c && c.s === q.s && c.range === range) return { sp: c.sp || [], rc: c.rc };
  return null;
}
/* ask the service for this symbol's line over the range (once, again after 8 seconds without an answer) */
function ask(q) {
  if (!q || series(q)) return;
  var arg = q.s + ':' + range;
  if (arg === asked && Date.now() - askedAt < 8000) return;
  asked = arg;
  askedAt = Date.now();
  parent.postMessage({ cytvSheet: 'action', name: 'chart', arg: arg }, '*');
}

/* ---------- drawing ---------- */
function spark(q, w, h) {
  var v = q.sp || [],
    lo = Infinity,
    hi = -Infinity,
    i,
    d = '',
    c = fin(q.cp) && q.cp < 0 ? '#ff6b5e' : '#3ddc91';
  for (i = 0; i < v.length; i++) {
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  if (v.length < 2) return '<svg class="ln" width="' + w + '" height="' + h + '"></svg>';
  if (hi === lo) hi = lo + 1;
  for (i = 0; i < v.length; i++)
    d += (i ? 'L' : 'M') + ((i / (v.length - 1)) * (w - 6) + 3).toFixed(1) + ' ' + (h - 4 - ((v[i] - lo) / (hi - lo)) * (h - 8)).toFixed(1);
  var base = fin(q.prev) && q.prev >= lo && q.prev <= hi ? (h - 4 - ((q.prev - lo) / (hi - lo)) * (h - 8)).toFixed(1) : '';
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
    (base ? '<path d="M0 ' + base + 'H' + w + '" stroke="rgba(255,255,255,.3)" stroke-width="1" stroke-dasharray="2 4"/>' : '') +
    '<path d="' +
    d +
    '" fill="none" stroke="' +
    c +
    '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>'
  );
}
/* the chart: area, the line, a dashed line at the previous close (1D) or the first price, the last price as a tag, high and low marked.
   Its colour follows today's change on 1D and the change over the range otherwise. */
function chart(q, s) {
  var v = s.sp,
    W = 554,
    H = 240,
    day = range === '1d',
    sign = day ? q.cp : s.rc,
    c = fin(sign) && sign < 0 ? '#ff6b5e' : '#3ddc91',
    cls = fin(sign) && sign < 0 ? 'dn' : 'up';
  if (v.length < 2) return '<svg class="ln" width="664" height="' + H + '"></svg>';
  var ref = day && fin(q.prev) ? q.prev : v[0],
    lo = ref,
    hi = ref,
    i,
    imax = 0,
    imin = 0,
    d = '';
  for (i = 0; i < v.length; i++) {
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
    if (v[i] > v[imax]) imax = i;
    if (v[i] < v[imin]) imin = i;
  }
  var pad = (hi - lo) * 0.1 || 1;
  lo -= pad;
  hi += pad;
  var px = function (j) {
      return (j / (v.length - 1)) * W;
    },
    py = function (p) {
      return H - ((p - lo) / (hi - lo)) * H;
    };
  for (i = 0; i < v.length; i++) d += (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(v[i]).toFixed(1);
  var g = '';
  for (i = 1; i < 4; i++) g += '<path d="M0 ' + ((H * i) / 4).toFixed(0) + 'H' + W + '" stroke="rgba(255,255,255,.06)" stroke-width="1"/>';
  var lx = px(v.length - 1).toFixed(1),
    ly = py(v[v.length - 1]),
    ry = py(ref);
  /* high and low: the quote's own day range on 1D, the line's extremes on longer ranges */
  var H1 = day && fin(q.hi) ? q.hi : v[imax],
    L1 = day && fin(q.lo) ? q.lo : v[imin],
    hx = Math.min(W - 150, Math.max(0, px(imax) - 60)),
    lxx = Math.min(W - 150, Math.max(0, px(imin) - 60));
  return (
    '<svg class="ln" width="664" height="' +
    H +
    '" viewBox="0 0 664 ' +
    H +
    '"><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' +
    c +
    '" stop-opacity=".24"/><stop offset="1" stop-color="' +
    c +
    '" stop-opacity="0"/></linearGradient></defs>' +
    g +
    '<path d="M0 ' +
    ry.toFixed(1) +
    'H' +
    W +
    '" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="7 7"/><path d="' +
    d +
    'L' +
    W +
    ' ' +
    H +
    'L0 ' +
    H +
    'Z" fill="url(#fg)"/><path d="' +
    d +
    '" fill="none" stroke="' +
    c +
    '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' +
    px(imax).toFixed(1) +
    '" cy="' +
    py(v[imax]).toFixed(1) +
    '" r="6" fill="none" stroke="#fff" stroke-width="2"/><circle cx="' +
    px(imin).toFixed(1) +
    '" cy="' +
    py(v[imin]).toFixed(1) +
    '" r="6" fill="none" stroke="#fff" stroke-width="2"/><circle cx="' +
    lx +
    '" cy="' +
    ly.toFixed(1) +
    '" r="16" fill="' +
    c +
    '" opacity=".22"/><circle cx="' +
    lx +
    '" cy="' +
    ly.toFixed(1) +
    '" r="7" fill="' +
    c +
    '"/></svg>' +
    '<div class="ref" style="top:' +
    ry.toFixed(0) +
    'px">' +
    esc((day && fin(q.prev) ? L('Previous close %s') : L('Start %s')).replace('%s', ltr(money(ref, q)))) +
    '</div><div class="tag ' +
    cls +
    '" style="top:' +
    ly.toFixed(0) +
    'px">' +
    esc(money(v[v.length - 1], q)) +
    '</div><div class="hl" style="left:' +
    hx.toFixed(0) +
    'px;top:' +
    Math.max(0, py(v[imax]) - 40).toFixed(0) +
    'px">' +
    esc(L('High %s').replace('%s', ltr(money(H1, q)))) +
    '</div><div class="hl" style="left:' +
    lxx.toFixed(0) +
    'px;top:' +
    Math.min(H - 26, py(v[imin]) + 14).toFixed(0) +
    'px">' +
    esc(L('Low %s').replace('%s', ltr(money(L1, q)))) +
    '</div>'
  );
}
function bar(label, lo, hi, p, q, caption) {
  if (!fin(lo) || !fin(hi) || hi <= lo) return '';
  var pos = Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100));
  return (
    '<div class="bar"><div class="bh"><span>' +
    esc(label) +
    '</span><span>' +
    esc(caption) +
    '</span></div><div class="bt ltr"><i style="left:' +
    pos.toFixed(1) +
    '%"></i></div><div class="bn ltr"><span class="num">' +
    esc(money(lo, q)) +
    '</span><span class="num">' +
    esc(money(hi, q)) +
    '</span></div></div>'
  );
}
function belowHigh(p, hi) {
  if (!fin(p) || !fin(hi) || !hi) return '';
  var x = ((hi - p) / hi) * 100;
  return x < 0.5 ? L('At the high') : L('%s below the high').replace('%s', ltr(Math.round(x) + '%'));
}
function pill() {
  var d = M.data || {};
  if (stale()) return '<span class="pill amber"><i></i>' + esc(L('Offline')) + '</span>';
  if (kind() === 'crypto') return '<span class="pill live"><i></i>' + esc(L('Live')) + '</span>';
  return d.open
    ? '<span class="pill live"><i></i>' + esc(L('Open')) + '</span>'
    : '<span class="pill"><i></i>' + esc(L('Closed') + ' · ' + L('prices at close')) + '</span>';
}
function foot() {
  var src = kind() === 'crypto' ? L('Data by CoinGecko') : L('Market data from Yahoo Finance, may be delayed'),
    when = stale() ? L('Offline, data from %s').replace('%s', ltr(timeOf())) : L('Updated %s').replace('%s', ltr(timeOf()));
  return '<div class="foot' + (stale() ? ' amber' : '') + '"><span>' + esc(src) + '</span><span>' + esc(when) + '</span></div>';
}
function closeBtn() {
  return '<div class="close" id="close">' + X + '<span>' + esc(L('Close')) + '</span></div>';
}

function drawList() {
  var d = M.data || {},
    q = list(),
    h = '',
    i,
    name = L(kind() === 'crypto' ? 'Crypto' : 'Stocks');
  h += '<div class="lh"><h1>' + esc(name) + '</h1>' + (q.length ? pill() : '') + '</div>' + closeBtn();
  if (!q.length) {
    h +=
      '<div class="empty"><div class="gl">+</div><b>' +
      esc(d.error || L('No symbols yet')) +
      '</b>' +
      (d.error ? '' : '<span>' + esc(L('Choose a list in Customise or type your own symbols on the phone page.')) + '</span>') +
      '</div>';
  } else {
    h += '<div class="lst" id="lst"><div>';
    for (i = 0; i < q.length; i++)
      h +=
        '<div class="row' +
        (focus === 'c' + i ? ' foc' : '') +
        '" data-n="c' +
        i +
        '"><div class="nm"><b>' +
        esc(short(q[i])) +
        '</b><span>' +
        esc(q[i].n || '') +
        '</span></div>' +
        spark(q[i], 144, 44) +
        '<div class="pr num">' +
        esc(money(q[i].p, q[i])) +
        '</div><div class="chg ' +
        tone(q[i].cp) +
        ' num">' +
        esc(pct(q[i].cp)) +
        '</div></div>';
    for (i = 0; d.missing && i < d.missing.length; i++)
      h += '<div class="row miss"><div class="nm"><b>' + esc(d.missing[i]) + '</b><span>' + esc(L('Not found')) + '</span></div></div>';
    h += '</div></div><div class="fade"></div>';
  }
  return h + foot();
}
function drawSymbol(q) {
  var Q = list(),
    R = ranges(),
    s = series(q),
    day = range === '1d',
    h = '',
    i,
    prev = Q[sel - 1],
    next = Q[sel + 1];
  /* the way back to the list is a button too (a click, the pointer of the Magic Remote, OK or Back) */
  h += '<div class="bk" id="list">‹&nbsp; ' + esc(L(kind() === 'crypto' ? 'Crypto' : 'Stocks')) + '</div>' + closeBtn();
  h +=
    '<div class="sv"><div class="t1"><h1>' +
    esc(q.s) +
    '</h1>' +
    (Q.length > 1
      ? '<div class="pager">' +
        (prev ? '<span class="pg" id="prev">‹ ' + esc(short(prev)) + '</span>' : '') +
        '<b>' +
        ltr(sel + 1 + ' / ' + Q.length) +
        '</b>' +
        (next ? '<span class="pg" id="next">' + esc(short(next)) + ' ›</span>' : '') +
        '</div>'
      : '') +
    '</div><div class="sub">' +
    esc(q.n || '') +
    (q.x ? ' · ' + esc(q.t === 'coin' ? L('Rank %s').replace('%s', q.x) : q.x) : '') +
    '</div></div>';
  h +=
    '<div class="pb"><div class="big num">' +
    esc(money(q.p, q)) +
    '</div><div class="cp ' +
    tone(q.cp) +
    ' num">' +
    (fin(q.cp) ? (q.cp >= 0 ? '▲ ' : '▼ ') : '') +
    esc(fin(q.c) && fin(q.cp) ? ltr(money(Math.abs(q.c), { cur: '' }) + ' (' + Math.abs(q.cp).toFixed(2) + '%)') : pct(q.cp)) +
    '</div></div>';
  var asof = stale()
      ? '<span class="amber">' + esc(L('Offline, data from %s').replace('%s', ltr(timeOf()))) + '</span>'
      : esc(
          kind() === 'crypto'
            ? L('Live') + ' · ' + L('Updated %s').replace('%s', ltr(timeOf()))
            : q.open
              ? L('Open') + ' · ' + L('Delayed up to 15 min')
              : L('At close') + ' · ' + L('Updated %s').replace('%s', ltr(timeOf()))
        ),
    near =
      fin(q.yhi) && q.p >= q.yhi * 0.98 ? L('Near the 52-week high') : fin(q.ath) && q.p >= q.ath * 0.98 ? L('Near the all-time high') : '';
  h += '<div class="asof">' + asof + (near ? '<span class="chip">' + esc(near) + '</span>' : '') + '</div><div class="rg">';
  for (i = 0; i < R.length; i++)
    h +=
      '<div data-n="r' +
      i +
      '" class="' +
      (R[i][0] === range ? 'on' : '') +
      (R[i][0] === range && !s ? ' load' : '') +
      (stale() ? ' dis' : '') +
      '">' +
      R[i][1] +
      '<i></i></div>';
  var shown = s || { sp: q.sp || [], rc: q.rc },
    sign = day ? q.cp : shown.rc;
  h += '</div><div class="rc ' + tone(sign) + '">' + (s && fin(sign) ? esc(ltr(pct(sign)) + ' ' + L(PAST[range])) : '&nbsp;') + '</div>';
  h += '<div class="ch' + (s ? '' : ' loading') + '">' + chart(q, shown) + '</div>';
  var start = day ? (kind() === 'crypto' ? L('24 hours ago') : L('Opening')) : L(SINCE[range]),
    end = day && kind() === 'stocks' && !q.open ? L('Closing') : L('Now');
  h += '<div class="xa"><span>' + esc(start) + '</span><span>' + esc(end) + '</span></div>';
  var st;
  if (kind() === 'crypto')
    st = [
      [L('Market cap'), esc(big(q.mc)) + (q.rank ? '<small>#' + q.rank + '</small>' : '')],
      [L('24h volume'), esc(big(q.v))],
      [L('7-day change'), '<span class="' + tone(q.cp7) + '">' + esc(pct(q.cp7)) + '</span>'],
      [L('Supply'), esc(big(q.sup)) + (fin(q.max) ? '<small>' + esc(L('of %s').replace('%s', big(q.max))) + '</small>' : '')],
    ];
  else
    st = [
      [L('Open price'), esc(money(q.o, q))],
      [L('Previous close'), esc(money(q.prev, q))],
      [L('Volume'), esc(big(q.v))],
      [L('Exchange'), esc(q.x || '–') + (q.cur && q.t !== 'index' ? '<small>' + esc(q.cur) + '</small>' : '')],
    ];
  h += '<div class="st">';
  for (i = 0; i < st.length; i++) h += '<div><span>' + esc(st[i][0]) + '</span><b class="num">' + st[i][1] + '</b></div>';
  h += '</div><div class="bars">';
  if (kind() === 'crypto') {
    h += bar(L('24h range'), q.lo, q.hi, q.p, q, '');
    h += bar(L('All-time'), q.atl, q.ath, q.p, q, belowHigh(q.p, q.ath));
  } else {
    h += bar(L('Day range'), q.lo, q.hi, q.p, q, '');
    h += bar(L('52 weeks'), q.ylo, q.yhi, q.p, q, belowHigh(q.p, q.yhi));
  }
  h += '</div>';
  var src = kind() === 'crypto' ? L('Data by CoinGecko') : L('Market data from Yahoo Finance, may be delayed');
  return { html: h + '<div class="src' + (stale() ? ' amber' : '') + '">' + esc(src) + '</div>', sign: sign };
}
function render() {
  var app = document.getElementById('app'),
    mood = document.getElementById('mood');
  if (!M || !app) return;
  document.documentElement.dir = M.dir || 'ltr';
  if (M.font) document.body.style.fontFamily = M.font;
  var Q = list(),
    keep = 0,
    old = document.getElementById('lst'),
    i;
  if (old) keep = old.scrollTop;
  /* the symbol follows its name when the list changes under it (a refresh) */
  if (selSym) for (i = 0; i < Q.length; i++) if (Q[i].s === selSym) sel = i;
  if (sel >= Q.length) sel = Math.max(0, Q.length - 1);
  if (view === 'sym' && !Q.length) view = 'list';
  document.body.className = stale() ? 'off' : '';
  if (view === 'list') {
    app.innerHTML = drawList();
    if (mood) mood.className = '';
    var lst = document.getElementById('lst');
    if (lst) lst.scrollTop = keep;
  } else {
    var q = Q[sel],
      r = drawSymbol(q);
    app.innerHTML = r.html;
    if (mood) mood.className = fin(r.sign) && r.sign < 0 ? 'dn' : 'up';
    ask(q);
  }
  reveal();
  post(true);
}
/* scroll the list so the focused row is in view, with a row of room */
function reveal() {
  var lst = document.getElementById('lst'),
    m = /^c(\d+)$/.exec(focus),
    i;
  if (!lst) return;
  if (m) {
    var top = +m[1] * ROW,
      room = lst.clientHeight;
    if (top - ROW < lst.scrollTop) lst.scrollTop = Math.max(0, top - ROW);
    else if (top + 2 * ROW > lst.scrollTop + room) lst.scrollTop = top + 2 * ROW - room;
  }
  var rows = lst.querySelectorAll('.row');
  for (i = 0; i < rows.length; i++)
    rows[i].className = rows[i].className.replace(/ foc\b/, '') + (rows[i].getAttribute('data-n') === focus ? ' foc' : '');
}
function pc(v, total) {
  return Math.max(0, Math.min(100, Math.round((v / total) * 1000) / 10));
}
function box(name, el, r, clip) {
  var q = el.getBoundingClientRect(),
    W = window.innerWidth,
    H = window.innerHeight,
    t = q.top,
    b = q.bottom;
  if (clip) {
    t = Math.max(t, clip.top);
    b = Math.min(b, clip.bottom);
    if (b - t < 24) return null;
  }
  return { name: name, x: pc(q.left, W), y: pc(t, H), w: pc(q.width, W), h: pc(b - t, H), r: r, tab: -1 };
}
/* the buttons that can be seen, and what Back and the arrows past the edge do */
function post(force) {
  var targets = [],
    c = document.getElementById('close'),
    t,
    i;
  if (c) targets.push(box('close', c, 28, null));
  /* back to the list, and the previous and next symbol: buttons for a click or the pointer (the arrows past the edge do the same) */
  ['list', 'prev', 'next'].forEach(function (n) {
    var e = document.getElementById(n);
    if (e) targets.push(box(n, e, n === 'list' ? 28 : 22, null));
  });
  var lst = document.getElementById('lst'),
    clip = lst ? lst.getBoundingClientRect() : null,
    items = document.querySelectorAll('[data-n]');
  for (i = 0; i < items.length && targets.length < MAX_TARGETS; i++) {
    t = box(items[i].getAttribute('data-n'), items[i], view === 'list' ? 16 : 30, clip);
    if (t) targets.push(t);
  }
  var sym = view === 'sym',
    msg = {
      cytvSheet: 'targets',
      targets: targets,
      focus: focus,
      back: sym ? 'list' : '',
      tab: -1,
      edges: sym && list().length > 1 ? { left: 'prev', right: 'next' } : {},
    };
  /* the same buttons are not sent again when only the focus moved (the launcher already knows it, and sending them again rebuilds its
     click layer under the pointer, which loses the click) */
  var key = JSON.stringify([msg.targets, msg.back, msg.edges]);
  if (!force && key === sentKey) return;
  sentKey = key;
  parent.postMessage(msg, '*');
}

/* ---------- what the keys do ---------- */
function openSymbol(i) {
  var Q = list();
  if (!Q[i]) return;
  sel = i;
  selSym = Q[i].s;
  view = 'sym';
  focus = 'r' + rIndex();
  render();
}
function toList() {
  view = 'list';
  focus = 'c' + sel;
  selSym = '';
  render();
}
function step(dir) {
  var Q = list(),
    n = sel + dir;
  if (n < 0 || n >= Q.length) return;
  sel = n;
  selSym = Q[n].s;
  render();
}
function setRange(i) {
  if (stale()) return;
  var R = ranges();
  if (!R[i]) return;
  range = R[i][0];
  focus = 'r' + i;
  render();
}
function page(dir) {
  var Q = list(),
    m = /^c(\d+)$/.exec(focus);
  if (!Q.length) return;
  focus = 'c' + Math.max(0, Math.min(Q.length - 1, (m ? +m[1] : 0) + dir * 8));
  reveal();
  post(true);
}
window.addEventListener('message', function (e) {
  var m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.cytvCard && typeof m.cytvCard === 'object') {
    var first = !M;
    M = m.cytvCard;
    if (first || !range) range = (M.data && M.data.range) || ranges()[0][0];
    /* a card with one symbol opens on it */
    if (first && list().length === 1) {
      view = 'sym';
      sel = 0;
      selSym = list()[0].s;
      focus = 'r' + rIndex();
    }
    render();
    return;
  }
  var s = m.cytvSheet;
  if (!s || typeof s !== 'object' || !M) return;
  if (typeof s.act === 'string') {
    var c = /^c(\d+)$/.exec(s.act),
      r = /^r(\d+)$/.exec(s.act);
    if (c && view === 'list') openSymbol(+c[1]);
    else if (r && view === 'sym') setRange(+r[1]);
    else if (s.act === 'list' && view === 'sym') toList();
    else if (s.act === 'prev' && view === 'sym') step(-1);
    else if (s.act === 'next' && view === 'sym') step(1);
  } else if (typeof s.key === 'string') {
    var d = s.key === 'chup' ? -1 : s.key === 'chdown' ? 1 : 0;
    if (!d) return;
    if (view === 'sym') step(d);
    else page(d);
  } else if (typeof s.focus === 'string') {
    focus = s.focus;
    reveal();
    post(false);
  }
});
window.addEventListener('resize', function () {
  if (M) render();
});
parent.postMessage({ cytvCard: 'ready' }, '*');
