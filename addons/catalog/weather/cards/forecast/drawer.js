/* The weather drawer: the second page of the forecast card (ES5: it runs on Chromium 68 too). The launcher shows it in a sheet from the side,
   in a frame without network; the launcher owns the keys and draws the focus ring, this page draws and says where its buttons are.
   In:  {cytvCard: ctx}  ctx.data is what the add-on's service said (ctx.data.wx: now, unit, at, detail; ctx.data.labels: the words in the
        language of the screens), ctx.opt the card's options, ctx.lang, ctx.clock, ctx.dir, ctx.font;
        {cytvSheet: {select: i}} show the tab i, {act: name} a button was pressed, {focus: name} the ring moved to a button.
   Out: {cytvCard: 'ready'}; {cytvSheet: 'targets', targets: [{name, x, y, w, h, r, tab}], focus} in percent of the frame (unit, close,
        tab0..tab2, and c0.. for the tiles, the hours or the days that can be seen); {cytvSheet: 'option', set: {unit}}; {cytvSheet: 'close'}.
   It opens on Now every time. Hours and Days are lists longer than the frame: the page scrolls them to the focused row. */
var DUO = {
  sun: '<circle cx="12" cy="12" r="5" fill="#FFD36B"/><g stroke="#FFD36B" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></g>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="#dfe6f5"/>',
  part: '<circle cx="9" cy="8" r="3.6" fill="#FFD36B"/><g stroke="#FFD36B" stroke-width="1.8" stroke-linecap="round"><path d="M9 1.6v1.4M3 8H1.6M4.6 3.6l1 1M13.4 3.6l-1 1"/></g><path d="M8 20h9.2a3.6 3.6 0 0 0 .4-7.18A5.2 5.2 0 0 0 7.8 13.6 3.2 3.2 0 0 0 8 20z" fill="#e9eef6"/>',
  cloud: '<path d="M7 19h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 12.6 3.3 3.3 0 0 0 7 19z" fill="#e9eef6"/>',
  fog: '<g stroke="#e9eef6" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M3 13h18M5 17h14"/></g>',
  rain: '<path d="M7 15h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 8.6 3.3 3.3 0 0 0 7 15z" fill="#cfd8e6"/><g stroke="#7CC4FF" stroke-width="2" stroke-linecap="round"><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/></g>',
  snow: '<path d="M7 15h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 8.6 3.3 3.3 0 0 0 7 15z" fill="#cfd8e6"/><g stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M8 19h.01M12 21h.01M16 19h.01M10 22h.01M14 18.5h.01"/></g>',
  storm:
    '<path d="M7 15h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 8.6 3.3 3.3 0 0 0 7 15z" fill="#b9c3d6"/><path d="M12.8 14.5l-2.4 4h3l-2 4" fill="none" stroke="#FFD36B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
};
var M = null,
  tab = 0,
  focus = 'tab0',
  sentKey = '',
  MAX_TARGETS = 24;
/* the WMO code as Open-Meteo gives it: the icon and the word (the words come in the labels) */
function kind(code, day) {
  if (code === 0) return [day === false ? 'moon' : 'sun', 'Clear sky'];
  if (code <= 2) return ['part', 'Partly cloudy'];
  if (code === 3) return ['cloud', 'Cloudy'];
  if (code === 45 || code === 48) return ['fog', 'Fog'];
  if (code >= 51 && code <= 57) return ['rain', 'Drizzle'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', 'Rain'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', 'Snow'];
  if (code >= 95) return ['storm', 'Thunderstorm'];
  return ['cloud', 'Cloudy'];
}
function L(k) {
  var l = (M && M.data && M.data.labels) || {};
  return l[k] || k;
}
function ic(k) {
  return '<svg class="ic" viewBox="0 0 24 24">' + (DUO[k] || DUO.cloud) + '</svg>';
}
/* numbers and times inside a sentence keep their own order in a right-to-left language (left-to-right isolates) */
function ltr(s) {
  return String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nn(v) {
  return v === null || v === undefined ? '–' : v;
}
function clockOpts(hourOnly) {
  var c = (M && M.clock) || { hour: 'numeric', minute: '2-digit' },
    o = {},
    k;
  for (k in c) if (!(hourOnly && k === 'minute')) o[k] = c[k];
  return o;
}
/* a time at the place (2026-10-31T19:48) as the clock setting writes it; hourOnly: just the hour, for the list */
function hm(iso, hourOnly) {
  if (!iso) return '–';
  var hh = +iso.slice(11, 13),
    mm = +iso.slice(14, 16);
  try {
    return ltr(new Date(2000, 0, 1, hh, mm).toLocaleTimeString(M.lang, clockOpts(hourOnly)));
  } catch (e) {
    return ltr(iso.slice(11, 16));
  }
}
/* the place's clock as milliseconds in the same scale as its times */
function ms(iso) {
  var m = iso ? Date.parse(iso.slice(0, 16) + ':00Z') : NaN;
  return isFinite(m) ? m : null;
}
function dur(x) {
  var m = Math.max(0, Math.round(x / 60000));
  return ltr(Math.floor(m / 60) + ' h ' + (m % 60) + ' min');
}
function uvWord(v) {
  return v === null ? '' : v < 3 ? L('Low') : v < 6 ? L('Moderate') : v < 8 ? L('High') : v < 11 ? L('Very high') : L('Extreme');
}
function aqiWord(v) {
  return v === null || v === undefined
    ? ''
    : v <= 20
      ? L('Good')
      : v <= 40
        ? L('Fair')
        : v <= 60
          ? L('Moderate')
          : v <= 80
            ? L('Poor')
            : v <= 100
              ? L('Very poor')
              : L('Extremely poor');
}
/* the wind's direction in words, clockwise from the north */
function compass(deg) {
  return deg === null || deg === undefined
    ? ''
    : [L('North'), L('North-east'), L('East'), L('South-east'), L('South'), L('South-west'), L('West'), L('North-west')][
        Math.round(deg / 45) % 8
      ];
}
function head(d) {
  var hs = d.hours || [],
    i;
  for (i = 0; i < hs.length; i++)
    if (hs[i].rain !== null && hs[i].rain >= 50) return L('Rain likely from %s').replace('%s', i === 0 ? L('now') : hm(hs[i].t));
  return hs.length ? L('No rain expected in the next 24 hours') : '';
}
function feelsNote(now, feels) {
  if (feels === null || feels === undefined || now === null || now === undefined) return '';
  return feels > now ? L('Warmer than it is') : feels < now ? L('Cooler than it is') : L('As it is');
}
function tile(i, label, value, small, sub, extra) {
  return (
    '<div class="wtile" data-n="c' +
    i +
    '"><div class="tc"><div class="l">' +
    esc(label) +
    '</div><div class="v">' +
    value +
    (small ? '<small>' + esc(small) + '</small>' : '') +
    '</div>' +
    (sub ? '<div class="c">' + esc(sub) + '</div>' : '') +
    (extra || '') +
    '</div></div>'
  );
}
function pageNow(w, d) {
  var hrs = d.hours || [],
    peak = null,
    i,
    td = (d.week || [])[0] || {},
    speed = w.unit === 'f' ? 'mph' : 'km/h',
    air = d.air,
    sr = ms(td.sunrise),
    ss = ms(td.sunset),
    hd = head(d),
    rainNow = hrs.length && hrs[0].rain !== null ? hrs[0].rain : null;
  for (i = 0; i < hrs.length; i++) if (hrs[i].rain !== null && (peak === null || hrs[i].rain > peak.rain)) peak = hrs[i];
  var uvPos = d.uv === null || d.uv === undefined ? 0 : Math.max(0, Math.min(100, Math.round((d.uv / 11) * 100)));
  return (
    (hd ? '<div class="verdict">' + ic('rain') + '<span>' + esc(hd) + '</span></div>' : '') +
    '<div class="wtiles">' +
    tile(0, L('Feels like'), esc(nn(d.feels)) + '°', '', feelsNote(w.now.temp, d.feels)) +
    tile(
      1,
      L('Rain chance'),
      rainNow === null ? '–' : rainNow,
      rainNow === null ? '' : '%',
      peak && peak.rain > 0 ? L('Peak %s').replace('%s', ltr(peak.rain + '%') + ' · ' + hm(peak.t)) : ''
    ) +
    tile(2, L('Wind'), esc(nn(d.wind)), speed, compass(d.dir)) +
    tile(
      3,
      L('UV index'),
      d.uv === null || d.uv === undefined ? '–' : Math.round(d.uv),
      uvWord(d.uv === undefined ? null : d.uv),
      '',
      '<div class="bar6"><i style="left:' + uvPos + '%"></i></div>'
    ) +
    '</div><div class="wmore"><div>' +
    esc(L('Humidity')) +
    '<b>' +
    (d.humidity === null || d.humidity === undefined ? '–' : d.humidity + '%') +
    '</b></div><div>' +
    esc(L('Pressure')) +
    '<b>' +
    esc(nn(d.pressure)) +
    ' hPa</b></div><div>' +
    esc(L('Air quality')) +
    '<b>' +
    (air ? esc(aqiWord(air.aqi)) + ' · ' + air.aqi : '–') +
    '</b></div></div><div class="wsunl"><span>' +
    esc(L('Sunrise')) +
    ' <b>' +
    esc(hm(td.sunrise)) +
    '</b></span><span>' +
    esc(sr !== null && ss !== null ? L('%s of daylight').replace('%s', dur(ss - sr)) : '') +
    '</span><span>' +
    esc(L('Sunset')) +
    ' <b>' +
    esc(hm(td.sunset)) +
    '</b></span></div><div class="src">' +
    esc(L('Weather data by Open-Meteo.com')) +
    '</div>'
  );
}
function pageHours(w, d) {
  var hs = d.hours || [],
    lo = 1e9,
    hi = -1e9,
    i,
    rows = '';
  for (i = 0; i < hs.length; i++)
    if (hs[i].temp !== null) {
      lo = Math.min(lo, hs[i].temp);
      hi = Math.max(hi, hs[i].temp);
    }
  if (hi <= lo) hi = lo + 1;
  for (i = 0; i < hs.length; i++) {
    var c = hs[i],
      pos = c.temp === null ? 0 : Math.round(((c.temp - lo) / (hi - lo)) * 100);
    rows +=
      '<div class="hrow" data-n="c' +
      i +
      '"><span class="tm">' +
      esc(i === 0 ? L('Now') : hm(c.t, true)) +
      '</span>' +
      ic(kind(c.code, c.day)[0]) +
      '<span class="tp">' +
      esc(nn(c.temp)) +
      '°</span><span class="tr ltr"><u style="width:' +
      (c.rain || 0) +
      '%"></u><i style="left:calc(' +
      pos +
      '% - 9px)"></i></span><span class="rp">' +
      (c.rain !== null && c.rain >= 20 ? ltr(c.rain + '%') : '') +
      '</span></div>';
  }
  return rows;
}
function pageDays(w, d) {
  var wk = d.week || [],
    lo = 1e9,
    hi = -1e9,
    i,
    out = '';
  for (i = 0; i < wk.length; i++) {
    if (wk[i].min !== null) lo = Math.min(lo, wk[i].min);
    if (wk[i].max !== null) hi = Math.max(hi, wk[i].max);
  }
  if (hi <= lo) hi = lo + 1;
  for (i = 0; i < wk.length; i++) {
    var x = wk[i],
      wd = '';
    try {
      wd = i === 0 ? L('Today') : new Date(x.date + 'T12:00:00').toLocaleDateString(M.lang, { weekday: 'short' });
    } catch (e) {}
    var l = x.min === null ? 0 : Math.round(((x.min - lo) / (hi - lo)) * 100),
      cw = x.max === null || x.min === null ? 0 : Math.max(4, Math.round(((x.max - x.min) / (hi - lo)) * 100));
    out +=
      '<div class="drow' +
      (i === 0 ? ' today' : '') +
      '" data-n="c' +
      i +
      '"><span class="dn">' +
      esc(wd) +
      '</span>' +
      ic(kind(x.code, true)[0]) +
      '<span class="rp">' +
      (x.rain !== null && x.rain >= 20 ? ltr(x.rain + '%') : '') +
      '</span><span class="lo">' +
      esc(nn(x.min)) +
      '°</span><span class="cap ltr"><i style="left:' +
      l +
      '%;width:' +
      cw +
      '%"></i></span><span class="hi">' +
      esc(nn(x.max)) +
      '°</span></div>';
  }
  return out;
}
function hero(w, d) {
  var k = kind(w.now.code, w.now.day),
    td = (d.week || [])[0] || {},
    big = tab === 0;
  return (
    '<div class="hero' +
    (big ? '' : ' sm') +
    '">' +
    ic(k[0]) +
    '<div class="tmp">' +
    esc(nn(w.now.temp)) +
    '°</div><div class="hx"><b>' +
    esc(L(k[1])) +
    '</b>' +
    (big ? '<span>' + esc(L('Feels like %s').replace('%s', ltr(nn(d.feels) + '°'))) + '</span>' : '') +
    '<span>' +
    esc(L('High') + ' ' + ltr(nn(td.max) + '°') + ' · ' + L('Low') + ' ' + ltr(nn(td.min) + '°')) +
    '</span></div></div>'
  );
}
function render() {
  var app = document.getElementById('app');
  if (!M || !app) return;
  document.documentElement.dir = M.dir || 'ltr';
  if (M.font) document.body.style.fontFamily = M.font;
  var data = M.data || {},
    w = data.wx,
    d = (w && w.detail) || { hours: [], week: [] },
    opt = M.opt || {},
    unit = opt.unit === 'f' || (!opt.unit && w && w.unit === 'f') ? 'f' : 'c',
    place = String(opt.place || data.city || '').slice(0, 40),
    stale = w && Date.now() - w.at > 2400000,
    at = '',
    day = '',
    body = '',
    keep = 0,
    old = document.getElementById('bd');
  if (old && old.getAttribute('data-tab') === String(tab)) keep = old.scrollTop;
  if (w) {
    try {
      at = new Date(w.at).toLocaleTimeString(M.lang, clockOpts());
    } catch (e) {}
    body = tab === 0 ? pageNow(w, d) : tab === 1 ? pageHours(w, d) : pageDays(w, d);
  }
  try {
    day = new Date().toLocaleDateString(M.lang, { weekday: 'long' });
  } catch (e) {}
  app.innerHTML =
    '<div class="hd"><div class="pl">' +
    esc(place || L('Weather')) +
    '<small' +
    (stale ? ' class="off"' : '') +
    '>' +
    esc(stale ? L('Offline, data from %s').replace('%s', ltr(at)) : day) +
    '</small></div><div class="bt"><div class="pill unit" id="unit"><span class="' +
    (unit === 'f' ? '' : 'on') +
    '">°C</span><span class="' +
    (unit === 'f' ? 'on' : '') +
    '">°F</span></div><div class="pill cls" id="close">' +
    ic('x') +
    '<span>' +
    esc(L('Close')) +
    '</span></div></div></div>' +
    (w ? hero(w, d) : '') +
    '<div class="seg2">' +
    [L('Now'), L('Hours'), L('Days')]
      .map(function (n, i) {
        return '<div class="tabb' + (tab === i ? ' on' : '') + '" id="tab' + i + '">' + esc(n) + '</div>';
      })
      .join('') +
    '</div><div class="bd' +
    (tab === 0 ? '' : ' list') +
    '" id="bd" data-tab="' +
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
function pct(v, total) {
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
  return { name: name, x: pct(q.left, W), y: pct(t, H), w: pct(q.width, W), h: pct(b - t, H), r: r, tab: tabIx };
}
/* the buttons that can be seen: the header, the tabs and the tiles, hours or days in view (a row cut off at the edge is clipped to it) */
function post(force) {
  var list = [],
    fixed = [
      ['unit', 32, -1],
      ['close', 32, -1],
      ['tab0', 30, 0],
      ['tab1', 30, 1],
      ['tab2', 30, 2],
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
      var it = tab === 0 ? items[i].querySelector('.tc') || items[i] : items[i];
      t = box(items[i].getAttribute('data-n'), it, tab === 0 ? 20 : 18, -1, clip);
      if (t) list.push(t);
    }
  }
  var key = JSON.stringify([list, focus]);
  if (!force && key === sentKey) return;
  sentKey = key;
  parent.postMessage({ cytvSheet: 'targets', targets: list, focus: focus }, '*');
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
window.addEventListener('message', function (e) {
  var m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.cytvCard && typeof m.cytvCard === 'object') {
    M = m.cytvCard;
    render();
    return;
  }
  var s = m.cytvSheet;
  if (!s || typeof s !== 'object') return;
  if (s.select !== undefined) select(s.select);
  else if (typeof s.act === 'string') {
    var t = /^tab([0-2])$/.exec(s.act);
    if (s.act === 'unit') {
      var cur = M && M.opt && M.opt.unit === 'f' ? 'f' : 'c';
      parent.postMessage({ cytvSheet: 'option', set: { unit: cur === 'f' ? 'c' : 'f' } }, '*');
    } else if (s.act === 'close') parent.postMessage({ cytvSheet: 'close' }, '*');
    else if (t) select(+t[1]);
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
