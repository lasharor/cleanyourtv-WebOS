/* The forecast card (ES5: it runs on Chromium 68 too). Everything it shows comes in the message of the launcher: m.data is what the
   weather add-on's service said for this card (translated words included), m.lang and m.clock the language and the clock format. The
   frame has no network. The three buttons (Now, Hours, Days) are told to the launcher, which makes them targets of the remote. */
var ICON = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  part: '<path d="M8 3v1.5M3.8 4.8l1 1M2 9h1.5M12.2 4.8l-1 1"/><path d="M5.2 11.2A4 4 0 1 1 12 7.6"/><path d="M9 20h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.3A3 3 0 0 0 9 20z"/>',
  cloud: '<path d="M7 19h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 19z"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
  rain: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>',
  snow: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01M10 22h.01M14 18h.01"/>',
  storm: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M12.5 15l-2 4h3l-2 4"/>',
};
var BUTTONS = [
  { name: 'now', x: 0, y: 74, w: 32, h: 24 },
  { name: 'hours', x: 34, y: 74, w: 32, h: 24 },
  { name: 'days', x: 68, y: 74, w: 32, h: 24 },
];
var M = null,
  sent = false;

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svg(k) {
  var s = el('span');
  s.innerHTML = '<svg viewBox="0 0 24 24">' + (ICON[k] || ICON.cloud) + '</svg>';
  return s.firstChild;
}
function num(v, suffix) {
  return typeof v === 'number' && isFinite(v) ? v + (suffix || '') : '–';
}
/* 2026-10-31T19:48 (the time at the place) as the clock of the launcher shows it: with the minutes for a time of day, without for an hour */
function hourText(s, short) {
  var h = parseInt(String(s).slice(11, 13), 10),
    mi = parseInt(String(s).slice(14, 16), 10),
    o = {},
    k;
  if (isNaN(h)) return '';
  for (k in M.clock || { hour: 'numeric', minute: '2-digit' })
    if (!(short && k === 'minute')) o[k] = (M.clock || { hour: 'numeric', minute: '2-digit' })[k];
  try {
    return new Date(2000, 0, 1, h, isNaN(mi) ? 0 : mi).toLocaleTimeString(M.lang, o);
  } catch (e) {
    return h + (short ? '' : ':' + (mi < 10 ? '0' : '') + mi);
  }
}
function dayName(s) {
  var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s));
  if (!m) return '';
  try {
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(M.lang, { weekday: 'short' });
  } catch (e) {
    return s;
  }
}
function fact(box, label, value) {
  var d = el('div', '', label);
  d.appendChild(el('b', '', value));
  box.appendChild(d);
}
function nowView(main, d, L, deg, spd) {
  var n = d.now,
    big = el('div', 'big');
  big.appendChild(el('span', 't', n.temp + deg));
  big.appendChild(svg(n.icon));
  var tx = el('div');
  tx.appendChild(el('div', '', n.text));
  tx.appendChild(el('div', 'sub', d.city));
  big.appendChild(tx);
  main.appendChild(big);
  var g = el('div', 'grid');
  fact(g, L['Feels like'], num(n.feels, deg));
  fact(g, L['Humidity'], num(n.humidity, '%'));
  fact(g, L['Wind'], num(n.wind, ' ' + spd));
  if (M.size !== 'small') {
    fact(g, L['Rain chance'], num(n.rain, '%'));
    fact(g, L['UV index'], num(n.uv));
    fact(g, L['Pressure'], num(n.pressure, ' hPa'));
    fact(g, L['Air quality'], n.air ? String(n.air.aqi) : '–');
    fact(g, L['Sunrise'], n.sunrise ? hourText(n.sunrise) : '–');
    fact(g, L['Sunset'], n.sunset ? hourText(n.sunset) : '–');
  }
  main.appendChild(g);
}
function colsView(main, items, line) {
  var c = el('div', 'cols');
  items.forEach(function (x) {
    var col = el('div', 'col');
    line(col, x);
    c.appendChild(col);
  });
  main.appendChild(c);
}
function draw() {
  var main = document.getElementById('main'),
    tabs = document.getElementById('tabs'),
    d = M && M.data;
  document.documentElement.dir = M.dir || 'ltr';
  document.body.style.color = M.ink || '#fff';
  if (M.font) document.body.style.fontFamily = M.font;
  main.textContent = '';
  tabs.textContent = '';
  if (!d) return main.appendChild(el('div', 'msg', '…'));
  var L = d.labels || {};
  if (d.empty) return main.appendChild(el('div', 'msg', L['Choose a city from your phone'] || ''));
  if (d.error) return main.appendChild(el('div', 'msg', d.error));
  var deg = '°',
    spd = d.unit === 'f' ? 'mph' : 'km/h',
    names = { now: 'Now', hours: 'Hours', days: 'Days' };
  if (d.view === 'hours')
    colsView(main, d.hours.slice(0, M.size === 'small' ? 5 : 8), function (col, h) {
      col.appendChild(el('i', '', hourText(h.t, true)));
      col.appendChild(svg(h.icon));
      col.appendChild(el('b', '', num(h.temp, deg)));
      col.appendChild(el('i', '', num(h.rain, '%')));
    });
  else if (d.view === 'days')
    colsView(main, d.days.slice(0, M.size === 'small' ? 4 : 7), function (col, x) {
      col.appendChild(el('i', '', dayName(x.date)));
      col.appendChild(svg(x.icon));
      col.appendChild(el('b', '', num(x.max, deg)));
      col.appendChild(el('i', '', num(x.min, deg)));
    });
  else nowView(main, d, L, deg, spd);
  BUTTONS.forEach(function (b, i) {
    var t = el('div', 'tab' + (b.name === (d.view || 'now') ? ' on' : ''), L[names[b.name]] || names[b.name]);
    t.style.left = b.x + '%';
    tabs.appendChild(t);
  });
}
window.addEventListener('message', function (e) {
  var m = e.data && e.data.cytvCard;
  if (!m || typeof m !== 'object') return;
  M = m;
  draw();
  if (!sent) {
    sent = true;
    parent.postMessage({ cytvCard: 'buttons', buttons: BUTTONS }, '*');
  }
});
parent.postMessage({ cytvCard: 'ready' }, '*');
