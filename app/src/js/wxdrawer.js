/* ---------- the weather drawer: OK (or a click) on the weather forecast card on Home opens more of the weather at its city ----------
   A sheet from the right edge: the place with the unit and Close, the temperature, and three pages: Now (the next rain as a sentence, four
   tiles, the rest in a quiet row, the sun), Hours (the next 24 in one list) and Days (the next seven as capsules). It reads what the weather
   add-on's service handed the card (the feed's wx: now, unit, at, detail), so it opens at once and shows the last answer while the internet
   is away. Focus: row 0 the unit and Close, row 1 the three tabs (it opens here), row 2 the page's items (tiles, hours or days).
   Left and right on the tabs show the page at once; Back closes. */
var WXD = { on: false, slot: '', tab: 0, row: 1, col: 0, hour: 0, day: 0, p: null, idleT: 0 };
var WXD_TAB = 0; /* the page it was last left on, for the next opening */
/* the icons of the drawer: filled, two tones */
var WXD_DUO = {
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
function wxdIc(k) {
  return '<svg class="ic" viewBox="0 0 24 24">' + (WXD_DUO[k] || WXD_DUO.cloud) + '</svg>';
}
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
/* the card element of the place the drawer was opened from */
function wxdEl() {
  var els = $('cards').children;
  for (var i = 0; i < els.length; i++) if (els[i]._slot === WXD.slot && els[i]._card && els[i]._card.type === WX_TYPE) return els[i];
  return null;
}
function wxdCard() {
  var e = wxdEl();
  return e ? e._card : null;
}
/* what the add-on's service kept for the card: {now, unit, at, detail}, or null before the first answer */
function wxdW() {
  var e = wxdEl();
  return e && e._data && e._data.wx ? e._data.wx : null;
}
function wxdOpen(el) {
  if (!el._data || !el._data.wx) return toast(t('The service did not answer.'), true);
  WXD.slot = el._slot;
  WXD.on = true;
  WXD.tab = WXD_TAB;
  WXD.row = 1;
  WXD.col = WXD.tab;
  WXD.hour = 0;
  WXD.day = 0;
  var box = $('wxd');
  box.className = 'on';
  box.innerHTML = '<div class="sc" data-a="close"></div><div class="pn"></div>';
  WXD.p = box.lastChild;
  wxdDraw();
  /* the sheet slides in (transform only) once it is on screen */
  setTimeout(function () {
    if (WXD.on) box.className = 'on in';
  }, 30);
  wxdIdle();
}
function wxdClose() {
  if (!WXD.on) return;
  WXD_TAB = WXD.tab;
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
/* the unit is the weather cards' (one setting, as in Customise > Weather): switching it saves it and the cards ask for the other unit */
function wxdUnit() {
  var c = wxdCard();
  wxSet({ unit: c && c.unit === 'f' ? 'c' : 'f' });
}
/* how many things the page has to move through: 4 tiles, the hours, the days */
function wxdItems() {
  var w = wxdW(),
    d = (w && w.detail) || {};
  return WXD.tab === 0 ? 4 : WXD.tab === 1 ? (d.hours || []).length : (d.week || []).length;
}
function wxdKey(k, e) {
  wxdIdle();
  var r = WXD.row,
    c = WXD.col,
    n;
  if (k === 461 || k === 27 || k === 8) wxdClose();
  else if (k === 13) wxdPick(r, c);
  else if (k === 38) {
    if (r === 2) {
      if (WXD.tab === 0 && c >= 2) c -= 2;
      else if (WXD.tab !== 0 && c > 0) c -= 1;
      else {
        r = 1;
        c = WXD.tab;
      }
    } else if (r === 1) {
      r = 0;
      c = WXD.tab < 2 ? 0 : 1;
    }
    wxdFocus(r, c);
  } else if (k === 40) {
    n = wxdItems();
    if (r === 0) {
      r = 1;
      c = WXD.tab;
    } else if (r === 1 && n) {
      r = 2;
      c = WXD.tab === 0 ? 0 : WXD.tab === 1 ? WXD.hour : WXD.day;
    } else if (r === 2) {
      if (WXD.tab === 0 && c < 2) c += 2;
      else if (WXD.tab !== 0 && c < n - 1) c += 1;
    }
    wxdFocus(r, c);
  } else if (k === 37 || k === 39) {
    var dir = k === 37 ? -1 : 1;
    if (r === 0) c = Math.max(0, Math.min(1, c + dir));
    else if (r === 1) {
      c = Math.max(0, Math.min(2, c + dir));
      WXD.tab = c; /* the page changes with the focus */
      WXD.hour = WXD.day = 0;
    } else if (WXD.tab === 0) {
      if (c % 2 === 0 && dir > 0) c += 1;
      else if (c % 2 === 1 && dir < 0) c -= 1;
    }
    wxdFocus(r, c);
  } else return;
  e.preventDefault();
}
/* move the focus: the row and the place in it; the hours and the days remember where they are */
function wxdFocus(r, c) {
  if (r === WXD.row && c === WXD.col && r !== 1) return;
  WXD.row = r;
  WXD.col = c;
  if (r === 2 && WXD.tab === 1) WXD.hour = c;
  if (r === 2 && WXD.tab === 2) WXD.day = c;
  wxdDraw();
}
/* what a press or a click on a button does */
function wxdPick(row, col) {
  if (row === 0) {
    if (col === 0) wxdUnit();
    else wxdClose();
  } else if (row === 1) {
    WXD.tab = col;
    WXD.hour = WXD.day = 0;
    WXD.row = 1;
    WXD.col = col;
    wxdDraw();
  } else wxdFocus(row, col);
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
/* the pointer sets the focus, so it and the arrows never disagree */
document.addEventListener('mousemove', function (ev) {
  if (!WXD.on) return;
  var el = ev.target.closest ? ev.target.closest('[data-a]') : null,
    a = el ? el.getAttribute('data-a') : '';
  if (!a || a === 'close') return;
  var p = a.split(':'),
    r = +p[0],
    c = +p[1];
  if (r === 1) return; /* a tab is chosen by a click, as the arrows would */
  if (r !== WXD.row || c !== WXD.col) {
    wxdIdle();
    wxdFocus(r, c);
  }
});

/* ---- drawing ---- */
function wxdBtn(row, col, cls, inner) {
  return (
    '<div class="b ' + cls + (WXD.row === row && WXD.col === col ? ' f' : '') + '" data-a="' + row + ':' + col + '">' + inner + '</div>'
  );
}
/* the sky in words and the icon, from a WMO code */
function wxdSky(code, day) {
  var k = wxKind(code, day);
  return { icon: wxdIc(k[0]), text: k[1] };
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
/* the wind's direction in words, clockwise from the north: whole names, not N/E/S/W, so a one-letter text is not a translation key
   (build-pages.js takes a text as used when its letters appear anywhere in the page, so "E" would land in every page) */
function wxdCompass(deg) {
  return deg === null
    ? ''
    : [t('North'), t('North-east'), t('East'), t('South-east'), t('South'), t('South-west'), t('West'), t('North-west')][
        Math.round(deg / 45) % 8
      ];
}
/* the headline: when the next rain is likely in the coming hours */
function wxdHead(d) {
  var hs = d.hours || [],
    i;
  for (i = 0; i < hs.length; i++)
    if (hs[i].rain !== null && hs[i].rain >= 50) return t('Rain likely from %s').replace('%s', i === 0 ? t('now') : wxdHM(hs[i].t));
  return hs.length ? t('No rain expected in the next 24 hours') : '';
}
function wxdTile(i, label, value, small, sub, extra) {
  return (
    '<div class="wtile' +
    (WXD.row === 2 && WXD.col === i ? ' f' : '') +
    '" data-a="2:' +
    i +
    '"><div class="l">' +
    wxe(label) +
    '</div><div class="v">' +
    value +
    (small ? '<small>' + wxe(small) + '</small>' : '') +
    '</div>' +
    (sub ? '<div class="c">' + wxe(sub) + '</div>' : '') +
    (extra || '') +
    '</div>'
  );
}
function wxdFeelsNote(now, feels) {
  if (feels === null || feels === undefined || now === null || now === undefined) return '';
  return feels > now ? t('Warmer than it is') : feels < now ? t('Cooler than it is') : t('As it is');
}
function wxdNow(w, d) {
  var hrs = d.hours || [],
    peak = null,
    i,
    wk = d.week || [],
    td = wk[0] || {},
    speed = w.unit === 'f' ? 'mph' : 'km/h',
    air = d.air,
    sr = wxdMs(td.sunrise),
    ss = wxdMs(td.sunset),
    head = wxdHead(d),
    rainNow = hrs.length && hrs[0].rain !== null ? hrs[0].rain : null;
  for (i = 0; i < hrs.length; i++) if (hrs[i].rain !== null && (peak === null || hrs[i].rain > peak.rain)) peak = hrs[i];
  var uvPos = d.uv === null || d.uv === undefined ? 0 : Math.max(0, Math.min(100, Math.round((d.uv / 11) * 100)));
  return (
    (head ? '<div class="verdict">' + wxdIc('rain') + '<span>' + wxe(head) + '</span></div>' : '') +
    '<div class="wtiles">' +
    wxdTile(0, t('Feels like'), wxe(wxn(d.feels)) + '°', '', wxdFeelsNote(w.now.temp, d.feels)) +
    wxdTile(
      1,
      t('Rain chance'),
      rainNow === null ? '–' : rainNow,
      rainNow === null ? '' : '%',
      peak && peak.rain > 0 ? t('Peak %s').replace('%s', wxdLtr(peak.rain + '%') + ' · ' + wxdHM(peak.t)) : ''
    ) +
    wxdTile(2, t('Wind'), wxe(wxn(d.wind)), speed, wxdCompass(d.dir === undefined ? null : d.dir)) +
    wxdTile(
      3,
      t('UV index'),
      d.uv === null || d.uv === undefined ? '–' : Math.round(d.uv),
      wxdUv(d.uv === undefined ? null : d.uv),
      '',
      '<div class="bar6"><i style="left:' + uvPos + '%"></i></div>'
    ) +
    '</div><div class="wmore"><div>' +
    wxe(t('Humidity')) +
    '<b>' +
    (d.humidity === null || d.humidity === undefined ? '–' : d.humidity + '%') +
    '</b></div><div>' +
    wxe(t('Pressure')) +
    '<b>' +
    wxe(wxn(d.pressure)) +
    ' hPa</b></div><div>' +
    wxe(t('Air quality')) +
    '<b>' +
    (air ? wxe(wxdAqi(air.aqi)) + ' · ' + air.aqi : '–') +
    '</b></div></div><div class="wsunl"><span>' +
    wxe(t('Sunrise')) +
    ' <b>' +
    wxe(wxdHM(td.sunrise)) +
    '</b></span><span>' +
    wxe(sr !== null && ss !== null ? t('%s of daylight').replace('%s', wxdDur(ss - sr)) : '') +
    '</span><span>' +
    wxe(t('Sunset')) +
    ' <b>' +
    wxe(wxdHM(td.sunset)) +
    '</b></span></div><div class="src">' +
    wxe(t('Weather data by Open-Meteo.com')) +
    '</div>'
  );
}
function wxdHours24(w, d) {
  var hs = d.hours || [];
  if (!hs.length) return '';
  var sel = Math.min(WXD.hour, hs.length - 1),
    start = Math.max(0, Math.min(hs.length - 8, sel - 3)),
    lo = 1e9,
    hi = -1e9,
    i;
  for (i = 0; i < hs.length; i++)
    if (hs[i].temp !== null) {
      lo = Math.min(lo, hs[i].temp);
      hi = Math.max(hi, hs[i].temp);
    }
  if (hi <= lo) hi = lo + 1;
  var rows = '';
  for (i = start; i < Math.min(hs.length, start + 8); i++) {
    var c = hs[i],
      s = wxdSky(c.code, c.day),
      pos = c.temp === null ? 0 : Math.round(((c.temp - lo) / (hi - lo)) * 100);
    rows +=
      '<div class="hrow' +
      (WXD.row === 2 && sel === i ? ' sel' : '') +
      '" data-a="2:' +
      i +
      '"><span class="tm">' +
      wxe(i === 0 ? t('Now') : wxdHM(c.t, true)) +
      '</span>' +
      s.icon +
      '<span class="tp">' +
      wxe(wxn(c.temp)) +
      '°</span><span class="tr ltr"><u style="width:' +
      (c.rain || 0) +
      '%"></u><i style="left:calc(' +
      pos +
      '% - 9px)"></i></span><span class="rp">' +
      (c.rain !== null && c.rain >= 20 ? wxdLtr(c.rain + '%') : '') +
      '</span></div>';
  }
  return rows;
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
  return wk
    .map(function (x, i) {
      var s = wxdSky(x.code, true),
        wd = '';
      try {
        wd = i === 0 ? t('Today') : new Date(x.date + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'short' });
      } catch (e) {}
      var l = x.min === null ? 0 : Math.round(((x.min - lo) / (hi - lo)) * 100),
        wd2 = x.max === null || x.min === null ? 0 : Math.max(4, Math.round(((x.max - x.min) / (hi - lo)) * 100));
      return (
        '<div class="drow' +
        (i === 0 ? ' today' : '') +
        (WXD.row === 2 && WXD.day === i ? ' sel' : '') +
        '" data-a="2:' +
        i +
        '"><span class="dn">' +
        wxe(wd) +
        '</span>' +
        s.icon +
        '<span class="rp">' +
        (x.rain !== null && x.rain >= 20 ? wxdLtr(x.rain + '%') : '') +
        '</span><span class="lo">' +
        wxe(wxn(x.min)) +
        '°</span><span class="cap ltr"><i style="left:' +
        l +
        '%;width:' +
        wd2 +
        '%"></i></span><span class="hi">' +
        wxe(wxn(x.max)) +
        '°</span></div>'
      );
    })
    .join('');
}
function wxdHero(w, d) {
  var s = wxdSky(w.now.code, w.now.day),
    td = (d.week || [])[0] || {},
    big = WXD.tab === 0;
  return (
    '<div class="hero' +
    (big ? '' : ' sm') +
    '">' +
    s.icon +
    '<div class="tmp">' +
    wxe(w.now.temp) +
    '°</div><div class="hx"><b>' +
    wxe(s.text) +
    '</b>' +
    (big ? '<span>' + wxe(t('Feels like %s').replace('%s', wxdLtr(wxn(d.feels) + '°'))) + '</span>' : '') +
    '<span>' +
    wxe(t('High') + ' ' + wxdLtr(wxn(td.max) + '°') + ' · ' + t('Low') + ' ' + wxdLtr(wxn(td.min) + '°')) +
    '</span></div></div>'
  );
}
function wxdDraw() {
  if (!WXD.on || !WXD.p) return;
  var o = wxdCard();
  if (!o) return wxdClose();
  var w = wxdW(),
    d = (w && w.detail) || { hours: [], week: [] },
    place = String(o.place || '').slice(0, 40),
    stale = w && Date.now() - w.at > 2400000,
    at = '',
    body = '',
    day = '';
  if (w) {
    try {
      at = new Date(w.at).toLocaleTimeString(LOC, clockOpts());
    } catch (e) {}
    body = WXD.tab === 0 ? wxdNow(w, d) : WXD.tab === 1 ? wxdHours24(w, d) : wxdDays(w, d);
  }
  try {
    day = new Date().toLocaleDateString(LOC, { weekday: 'long' });
  } catch (e) {}
  var html =
    '<div class="tint"></div><div class="hd"><div class="pl">' +
    wxe(place || t('Weather')) +
    '<small' +
    (stale ? ' class="off"' : '') +
    '>' +
    wxe(stale ? t('Offline, data from %s').replace('%s', wxdLtr(at)) : day) +
    '</small></div><div class="bt">' +
    '<div class="b pill unit' +
    (WXD.row === 0 && WXD.col === 0 ? ' f' : '') +
    '" data-a="0:0"><span class="' +
    (o.unit === 'f' ? '' : 'on') +
    '">°C</span><span class="' +
    (o.unit === 'f' ? 'on' : '') +
    '">°F</span></div>' +
    wxdBtn(0, 1, 'pill cls', wxdIc('x') + '<span>' + wxe(t('Close')) + '</span>') +
    '</div></div>' +
    (w ? wxdHero(w, d) : '') +
    '<div class="seg2">' +
    [t('Now'), t('Hours'), t('Days')]
      .map(function (n, i) {
        return wxdBtn(1, i, 'tabb' + (WXD.tab === i ? ' on' : ''), wxe(n));
      })
      .join('') +
    '</div><div class="bd' +
    (WXD.tab === 0 ? '' : ' list') +
    '">' +
    body +
    '</div>';
  WXD.p = setHtml(WXD.p, html);
}
