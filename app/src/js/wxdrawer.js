/* ---------- the weather drawer: OK on a weather card on Home opens more of the weather at that card's place ----------
   Now (what it feels like, the next rain, humidity, wind, UV, pressure, air quality, the sun), Hours (the next 24) and Days (the next
   seven). It reads what the service kept for the card (cards.js wxFor: detail), so it opens at once and shows the last answer while the
   internet is away. Focus: row 0 the unit and Close, row 1 the tabs, row 2 the hours (Hours tab). Back closes it. */
var WXD = { on: false, slot: '', tab: 0, hour: 0, row: 1, col: 0, p: null, idleT: 0 };
var WXD_ICON = {
  drop: '<path d="M12 3s6 6.2 6 10.2a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0M12 17l4-5"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19l8-8"/>',
  up: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 5v5M9 8l3-3 3 3"/>',
  down: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 5v5M9 7l3 3 3-3"/>',
  off: '<path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 3-2M12 20h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
/* numbers and times inside a sentence keep their own order in a right-to-left language (left-to-right isolates) */
function wxdLtr(s) {
  return String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);
}
function wxe(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wxn(v) {
  return v === null || v === undefined ? '–' : v;
}
/* a time at the place (2026-10-31T19:48) as the clock setting writes it; hourOnly: just the hour, for the chips */
function wxdHM(iso, hourOnly) {
  if (!iso) return '–';
  var hh = +iso.slice(11, 13),
    mm = +iso.slice(14, 16),
    o = clockOpts();
  if (hourOnly) delete o.minute;
  try {
    return wxdLtr(new Date(2000, 0, 1, hh, mm).toLocaleTimeString(LOC, o));
  } catch (e) {
    return wxdLtr(iso.slice(11, 16));
  }
}
/* the place's clock as milliseconds in the same scale as its times (the time zone's offset, then read as UTC) */
function wxdMs(iso) {
  var m = iso ? Date.parse(iso.slice(0, 16) + ':00Z') : NaN;
  return isFinite(m) ? m : null;
}
function wxdDur(ms) {
  var m = Math.max(0, Math.round(ms / 60000));
  return wxdLtr(Math.floor(m / 60) + ' h ' + (m % 60) + ' min');
}
function wxdCard() {
  var els = cardEls();
  for (var i = 0; i < els.length; i++) if (els[i]._slot === WXD.slot && els[i]._card.type === 'weather') return els[i]._card;
  return null;
}
function wxdOpen(el) {
  WXD.slot = el._slot;
  WXD.on = true;
  WXD.tab = 0;
  WXD.hour = 0;
  WXD.row = 1;
  WXD.col = 0;
  var box = $('wxd');
  box.className = 'on';
  box.innerHTML = '<div class="sc" data-a="close"></div><div class="pn"></div>';
  WXD.p = box.lastChild;
  wxdDraw();
  /* the panel slides in (transform only) once it is on screen */
  setTimeout(function () {
    if (WXD.on) box.className = 'on in';
  }, 30);
  wxdIdle();
}
function wxdClose() {
  if (!WXD.on) return;
  WXD.on = false;
  clearTimeout(WXD.idleT);
  var box = $('wxd');
  box.className = '';
  box.textContent = '';
  WXD.p = null;
}
/* OLED care, as for the cards: a drawer nobody uses closes after five minutes */
function wxdIdle() {
  clearTimeout(WXD.idleT);
  WXD.idleT = setTimeout(wxdClose, 300000);
}
/* the unit is the card's: switching it saves the card and asks for the weather in the other unit */
function wxdUnit() {
  var c = Object.assign({}, (cfg.cards || {})[WXD.slot]);
  if (c.unit === 'f') delete c.unit;
  else c.unit = 'f';
  cfg.cards = Object.assign({}, cfg.cards);
  cfg.cards[WXD.slot] = c;
  saveCfg();
}
function wxdRows() {
  return WXD.tab === 1 ? 3 : 2;
}
function wxdKey(k, e) {
  wxdIdle();
  if (k === 461 || k === 27 || k === 8) wxdClose();
  else if (k === 13) wxdPick(WXD.row, WXD.col);
  else if (k === 38 || k === 40) {
    var nr = WXD.row + (k === 38 ? -1 : 1);
    if (nr < 0 || nr >= wxdRows()) return e.preventDefault();
    WXD.row = nr;
    WXD.col = nr === 0 ? 1 : nr === 1 ? WXD.tab : WXD.hour;
    wxdDraw();
  } else if (k === 37 || k === 39) {
    var n = WXD.row === 0 ? 2 : WXD.row === 1 ? 3 : wxdHours(),
      nc = Math.max(0, Math.min(n - 1, WXD.col + (k === 37 ? -1 : 1)));
    if (nc !== WXD.col) {
      WXD.col = nc;
      if (WXD.row === 1) WXD.tab = nc;
      if (WXD.row === 2) WXD.hour = nc;
      wxdDraw();
    }
  } else return;
  e.preventDefault();
}
function wxdHours() {
  var o = wxdCard(),
    w = o && wxFor(o);
  return w && w.detail && w.detail.hours.length ? w.detail.hours.length : 1;
}
/* what a press or a click on a button does */
function wxdPick(row, col) {
  if (row === 0) {
    if (col === 0) wxdUnit();
    else wxdClose();
  } else if (row === 1) {
    WXD.tab = col;
    WXD.row = 1;
    WXD.col = col;
    wxdDraw();
  } else if (row === 2) {
    WXD.hour = col;
    WXD.col = col;
    wxdDraw();
  }
}
document.addEventListener('click', function (ev) {
  if (!WXD.on) return;
  var el = ev.target.closest ? ev.target.closest('[data-a]') : null,
    a = el ? el.getAttribute('data-a') : '';
  if (!a) return;
  wxdIdle();
  if (a === 'close') wxdClose();
  else {
    var p = a.split(':');
    wxdPick(+p[0], +p[1]);
  }
});

/* ---- drawing ---- */
function wxdBtn(row, col, cls, inner) {
  return (
    '<div class="b ' + cls + (WXD.row === row && WXD.col === col ? ' f' : '') + '" data-a="' + row + ':' + col + '">' + inner + '</div>'
  );
}
function wxdIc(p) {
  return lineSvg(p);
}
/* the sky in words and the icon, from a WMO code */
function wxdSky(code, day) {
  var k = wxKind(code, day);
  return { cls: 'k-' + k[0], icon: wxSvg(k[0]), text: k[1] };
}
function wxdUv(v) {
  return v === null ? '' : v < 3 ? t('Low') : v < 6 ? t('Moderate') : v < 8 ? t('High') : v < 11 ? t('Very high') : t('Extreme');
}
function wxdAqi(v) {
  return v === null || v === undefined
    ? ''
    : v <= 20
      ? t('Good')
      : v <= 40
        ? t('Fair')
        : v <= 60
          ? t('Moderate')
          : v <= 80
            ? t('Poor')
            : v <= 100
              ? t('Very poor')
              : t('Extremely poor');
}
function wxdCompass(deg) {
  return deg === null ? '' : [t('N'), t('NE'), t('E'), t('SE'), t('S'), t('SW'), t('W'), t('NW')][Math.round(deg / 45) % 8];
}
function wxdTile(icon, label, value, sub) {
  return (
    '<div class="tl"><div class="tn">' +
    wxdIc(icon) +
    '<span>' +
    wxe(label) +
    '</span></div><div class="tv">' +
    wxe(value) +
    '</div><div class="ts">' +
    wxe(sub || ' ') +
    '</div></div>'
  );
}
/* the headline: when the next rain is likely in the coming hours */
function wxdHead(d) {
  var hs = d.hours || [],
    i;
  for (i = 0; i < hs.length; i++)
    if (hs[i].rain !== null && hs[i].rain >= 50) return t('Rain likely from %s').replace('%s', i === 0 ? t('now') : wxdHM(hs[i].t));
  return hs.length ? t('No rain expected in the next 24 hours') : '';
}
function wxdSun(d, o) {
  var wk = d.week || [],
    td = wk[0] || {},
    sr = wxdMs(td.sunrise),
    ss = wxdMs(td.sunset),
    now = Date.now() + (d.offset || 0) * 1000,
    line = '',
    dot = '',
    passed = '';
  if (sr !== null && ss !== null) {
    if (now >= sr && now <= ss) {
      var f = (now - sr) / (ss - sr),
        q1 = [30 + 340 * f, 110 - 180 * f],
        r1 = [370 + 340 * f, -70 + 180 * f],
        b = [q1[0] + (r1[0] - q1[0]) * f, q1[1] + (r1[1] - q1[1]) * f];
      passed =
        '<path class="sp" d="M30 110 Q' +
        Math.round(q1[0]) +
        ' ' +
        Math.round(q1[1]) +
        ' ' +
        Math.round(b[0]) +
        ' ' +
        Math.round(b[1]) +
        '"/>';
      dot = '<circle class="sd" cx="' + Math.round(b[0]) + '" cy="' + Math.round(b[1]) + '" r="13"/>';
      line = t('Sunset in %s').replace('%s', wxdDur(ss - now));
    } else {
      var next = now < sr ? sr : wxdMs((wk[1] || {}).sunrise);
      if (next !== null) line = t('Sunrise in %s').replace('%s', wxdDur(next - now));
    }
  }
  return (
    '<div class="sun"><svg viewBox="0 0 740 120" class="sa"><line x1="10" y1="110" x2="730" y2="110" class="sh"/>' +
    '<path class="sc2" d="M30 110 Q370 -70 710 110"/>' +
    passed +
    dot +
    '</svg><div class="sr"><div class="sk k-sun">' +
    wxdIc(WXD_ICON.up) +
    '<div><div class="ts">' +
    wxe(t('Sunrise')) +
    '</div><div class="sv">' +
    wxe(wxdHM(td.sunrise)) +
    '</div></div></div><div class="sm"><div class="ts">' +
    wxe(t('Daylight')) +
    '</div><div class="sv">' +
    wxe(sr !== null && ss !== null ? wxdDur(ss - sr) : '–') +
    '</div><div class="ts">' +
    wxe(line || ' ') +
    '</div></div><div class="sk k-sun">' +
    wxdIc(WXD_ICON.down) +
    '<div><div class="ts">' +
    wxe(t('Sunset')) +
    '</div><div class="sv">' +
    wxe(wxdHM(td.sunset)) +
    '</div></div></div></div></div>'
  );
}
function wxdNow(w, d, o) {
  var s = wxdSky(w.now.code, w.now.day),
    wk0 = (d.week || [])[0] || {},
    hrs = d.hours || [],
    peak = null,
    i,
    speed = w.unit === 'f' ? 'mph' : 'km/h',
    air = d.air;
  for (i = 0; i < hrs.length; i++) if (hrs[i].rain !== null && (peak === null || hrs[i].rain > peak.rain)) peak = hrs[i];
  var head = wxdHead(d);
  return (
    '<div class="hero"><span class="hi ' +
    s.cls +
    '">' +
    s.icon +
    '</span><span class="ht">' +
    w.now.temp +
    '°</span><div class="hx"><div class="hs">' +
    wxe(s.text) +
    '</div><div class="ts">' +
    wxe(t('Feels like %s').replace('%s', wxdLtr(wxn(d.feels) + '°'))) +
    '</div><div class="ts">' +
    wxe(t('High') + ' ' + wxdLtr(wxn(wk0.max) + '°') + ' · ' + t('Low') + ' ' + wxdLtr(wxn(wk0.min) + '°')) +
    '</div></div></div>' +
    (head ? '<div class="hl">' + wxdIc(WX_ICON.rain) + '<span>' + wxe(head) + '</span></div>' : '') +
    '<div class="tiles">' +
    wxdTile(WXD_ICON.drop, t('Humidity'), d.humidity === null || d.humidity === undefined ? '–' : d.humidity + '%', '') +
    wxdTile(WXD_ICON.wind, t('Wind'), wxn(d.wind) + ' ' + speed, wxdCompass(d.dir === undefined ? null : d.dir)) +
    wxdTile(
      WX_ICON.rain,
      t('Rain chance'),
      hrs.length && hrs[0].rain !== null ? hrs[0].rain + '%' : '–',
      peak && peak.rain > 0 ? t('Peak %s').replace('%s', wxdLtr(peak.rain + '%') + ' · ' + wxdHM(peak.t)) : ''
    ) +
    wxdTile(
      WX_ICON.sun,
      t('UV index'),
      d.uv === null || d.uv === undefined ? '–' : Math.round(d.uv),
      wxdUv(d.uv === undefined ? null : d.uv)
    ) +
    wxdTile(WXD_ICON.gauge, t('Pressure'), wxn(d.pressure), 'hPa') +
    wxdTile(WXD_ICON.leaf, t('Air quality'), air ? air.aqi : '–', air ? wxdAqi(air.aqi) : '') +
    '</div>' +
    wxdSun(d, o)
  );
}
function wxdHours24(w, d) {
  var hs = d.hours || [];
  if (!hs.length) return '';
  var sel = Math.min(WXD.hour, hs.length - 1),
    h = hs[sel],
    s = wxdSky(h.code, h.day),
    start = Math.max(0, Math.min(hs.length - 8, sel - 3)),
    win = hs.slice(start, start + 8),
    lo = 1e9,
    hi = -1e9,
    i,
    speed = w.unit === 'f' ? 'mph' : 'km/h';
  for (i = 0; i < win.length; i++)
    if (win[i].temp !== null) {
      lo = Math.min(lo, win[i].temp);
      hi = Math.max(hi, win[i].temp);
    }
  var pts = [],
    cur = '';
  for (i = 0; i < win.length; i++) {
    var x = Math.round((i + 0.5) * 92.5),
      y = win[i].temp === null || hi === lo ? 50 : Math.round(84 - ((win[i].temp - lo) / (hi - lo)) * 66);
    pts.push(x + ' ' + y);
    if (start + i === sel) cur = '<circle class="sd" cx="' + x + '" cy="' + y + '" r="10"/>';
  }
  var chips = win
    .map(function (c, j) {
      var k = wxdSky(c.code, c.day),
        n = start + j;
      return wxdBtn(
        2,
        n,
        'chip' + (n === sel ? ' sel' : ''),
        '<span class="cl">' +
          wxe(n === 0 ? t('Now') : wxdHM(c.t, true)) +
          '</span><span class="ci ' +
          k.cls +
          '">' +
          k.icon +
          '</span><span class="ct">' +
          wxn(c.temp) +
          '°</span><span class="cr">' +
          (c.rain === null ? '–' : c.rain + '%') +
          '</span>'
      );
    })
    .join('');
  var bars = hs
    .map(function (c) {
      return '<i style="height:' + Math.max(4, Math.round((c.rain || 0) * 0.9)) + 'px"></i>';
    })
    .join('');
  return (
    '<div class="sel"><span class="hi ' +
    s.cls +
    '">' +
    s.icon +
    '</span><div><div class="ts">' +
    wxe(sel === 0 ? t('Now') : wxdHM(h.t)) +
    '</div><div class="ht2">' +
    wxn(h.temp) +
    '°</div></div><div class="se"><div class="hs">' +
    wxe(s.text) +
    '</div><div class="ts">' +
    wxe(t('Rain chance') + ' ' + wxdLtr(h.rain === null ? '–' : h.rain + '%')) +
    '</div><div class="ts">' +
    wxe(t('Wind') + ' ' + wxdLtr(wxn(h.wind) + ' ' + speed)) +
    '</div></div></div><div class="ltr"><svg viewBox="0 0 740 96" class="spk"><path d="M' +
    pts.join(' L') +
    '"/>' +
    cur +
    '</svg><div class="chips">' +
    chips +
    '</div><div class="ts hint"><span>' +
    wxe(t('Next 24 hours')) +
    '</span></div></div><div class="rb ltr"><div class="ts">' +
    wxe(t('Chance of rain, hour by hour')) +
    '</div><div class="bars">' +
    bars +
    '</div><div class="ax ts"><span>' +
    wxe(t('Now')) +
    '</span><span>+12 h</span><span>+24 h</span></div></div>'
  );
}
function wxdDays(w, d) {
  var wk = d.week || [],
    lo = 1e9,
    hi = -1e9;
  wk.forEach(function (x) {
    if (x.min !== null) lo = Math.min(lo, x.min);
    if (x.max !== null) hi = Math.max(hi, x.max);
  });
  if (hi <= lo) hi = lo + 1;
  return (
    '<div class="days">' +
    wk
      .map(function (x, i) {
        var s = wxdSky(x.code, true),
          wd = '';
        try {
          wd = i === 0 ? t('Today') : new Date(x.date + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'short' });
        } catch (e) {}
        var l = x.min === null ? 0 : Math.round(((x.min - lo) / (hi - lo)) * 100),
          wd2 = x.max === null || x.min === null ? 0 : Math.max(4, Math.round(((x.max - x.min) / (hi - lo)) * 100));
        return (
          '<div class="dr"><span class="dd">' +
          wxe(wd) +
          '</span><span class="di ' +
          s.cls +
          '">' +
          s.icon +
          '</span><span class="dp">' +
          (x.rain === null ? '' : x.rain + '%') +
          '</span><span class="dl">' +
          wxn(x.min) +
          '°</span><span class="db ltr"><i style="left:' +
          l +
          '%;width:' +
          wd2 +
          '%"></i></span><span class="dh">' +
          wxn(x.max) +
          '°</span></div>'
        );
      })
      .join('') +
    '</div>'
  );
}
function wxdDraw() {
  if (!WXD.on || !WXD.p) return;
  var o = wxdCard();
  if (!o) return wxdClose();
  var w = wxFor(o),
    d = (w && w.detail) || { hours: [], week: [] },
    place = String(o.place || '').slice(0, 40),
    stale = w && Date.now() - w.at > 2400000,
    at = '',
    body = '';
  if (w) {
    try {
      at = new Date(w.at).toLocaleTimeString(LOC, clockOpts());
    } catch (e) {}
    body = WXD.tab === 0 ? wxdNow(w, d, o) : WXD.tab === 1 ? wxdHours24(w, d) : wxdDays(w, d);
  }
  var day = '';
  try {
    day = new Date().toLocaleDateString(LOC, { weekday: 'long' });
  } catch (e) {}
  var html =
    '<div class="hd"><div class="tt"><div class="ti">' +
    wxe(t('Weather & sun')) +
    '</div><div class="ts">' +
    wxe((place ? place + ' · ' : '') + day) +
    '</div></div><div class="bt">' +
    wxdBtn(0, 0, 'unit', o.unit === 'f' ? '°F' : '°C') +
    wxdBtn(0, 1, 'cls', wxdIc(WXD_ICON.x) + '<span>' + wxe(t('Close')) + '</span>') +
    '</div></div><div class="tr"><div class="tabs">' +
    [t('Now'), t('Hours'), t('Days')]
      .map(function (n, i) {
        return wxdBtn(1, i, 'tab' + (WXD.tab === i ? ' on' : ''), wxe(n));
      })
      .join('') +
    '</div>' +
    (w
      ? stale
        ? '<div class="off">' + wxdIc(WXD_ICON.off) + '<span>' + wxe(t('Offline, data from %s').replace('%s', wxdLtr(at))) + '</span></div>'
        : '<div class="ts">' + wxe(t('Updated %s').replace('%s', wxdLtr(at))) + '</div>'
      : '') +
    '</div><div class="bd">' +
    body +
    '</div><div class="ft"><span>' +
    wxe(t('Weather data by Open-Meteo.com')) +
    '</span><span><b class="kc">' +
    wxe(t('Back')) +
    '</b> ' +
    wxe(t('Close')) +
    '</span></div>';
  WXD.p = setHtml(WXD.p, html);
}
