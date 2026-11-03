/* ---------- cards: small widgets in the slots a theme declares (theme.json "slots"), chosen in Customise > Cards ----------
   cfg.cards is {<slot id>: {type, ...options}}; a slot without an entry shows the card the theme puts there (slot.card), and
   {type: 'none'} leaves it empty. Each card type draws itself into its box; draw() runs on every rebuild and every clock tick. */
/* what changes with the time, for the cards: the greeting of the day part, the time and the date as the clock shows them */
function greetText(name) {
  var h = new Date().getHours();
  if (name) return (h < 12 ? t('Good morning, %s') : h < 18 ? t('Good afternoon, %s') : t('Good evening, %s')).replace('%s', name);
  return h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening');
}
function dateText(o) {
  try {
    return new Date().toLocaleDateString(LOC, o || { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (e) {
    return '';
  }
}
function timeText() {
  try {
    return new Date().toLocaleTimeString(LOC, clockOpts());
  } catch (e) {
    return '';
  }
}
/* ---- weather (Open-Meteo through the service, which asks at most every 30 minutes and keeps the last answer) ---- */
var WX = {},
  WX_LAST = null; /* the last weather drawn, for {{weather.temp}} in a text card and the greeting's second line */
var WX_ICON = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  part: '<path d="M8 3v1.5M3.8 4.8l1 1M2 9h1.5M12.2 4.8l-1 1"/><path d="M5.2 11.2A4 4 0 1 1 12 7.6"/><path d="M9 20h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.3A3 3 0 0 0 9 20z"/>',
  cloud: '<path d="M7 19h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 19z"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
  rain: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>',
  snow: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01M10 22h.01M14 18h.01"/>',
  storm: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M12.5 15l-2 4h3l-2 4"/>',
};
/* WMO weather codes as Open-Meteo gives them: an icon and a word */
function wxKind(code, day) {
  if (code === 0) return [day === false ? 'moon' : 'sun', t('Clear')];
  if (code <= 2) return ['part', t('Partly cloudy')];
  if (code === 3) return ['cloud', t('Cloudy')];
  if (code === 45 || code === 48) return ['fog', t('Fog')];
  if (code >= 51 && code <= 57) return ['rain', t('Drizzle')];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', t('Rain')];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', t('Snow')];
  if (code >= 95) return ['storm', t('Thunderstorm')];
  return ['cloud', t('Cloudy')];
}
/* a line icon in the style of the launcher's own (core.js svg) */
function lineSvg(p) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    p +
    '</svg>'
  );
}
function wxSvg(k) {
  return lineSvg(WX_ICON[k]);
}
function wxText(w) {
  return w && w.now ? w.now.temp + '° · ' + wxKind(w.now.code, w.now.day)[1] : '';
}
/* the weather of a card's place: what is known now (or null), asking the service when it is older than ten minutes */
function wxFor(o) {
  var lat = +o.lat,
    lon = +o.lon,
    unit = o.unit === 'f' ? 'f' : 'c';
  if (!isFinite(lat) || !isFinite(lon) || (o.lat === undefined && o.lon === undefined)) return null;
  var k = lat + ',' + lon + ',' + unit,
    e = WX[k] || (WX[k] = { w: null, at: 0, busy: false });
  if (!e.busy && Date.now() - e.at > 600000) {
    e.busy = true;
    api('/api/cards/weather', { lat: lat, lon: lon, unit: unit })
      .then(function (w) {
        e.busy = false;
        e.at = Date.now();
        if (w && w.now) {
          e.w = w;
          tickCards();
        }
      })
      .catch(function () {
        e.busy = false;
        e.at = Date.now() - 480000; /* try again in two minutes */
      });
  }
  if (e.w) WX_LAST = e.w;
  return e.w;
}
/* ---- Home Assistant (through the service, with the address and token set for Voice); one request for every card, every 30 s ---- */
var HA = { by: {}, at: 0, busy: false, want: '', err: '' };
var HA_ICON = {
  light: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1v.5h5V16c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  switch: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16" cy="12" r="2.2"/>',
  sensor: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
  binary: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};
function haIcon(d) {
  var k =
    d === 'light'
      ? 'light'
      : d === 'switch' || d === 'fan' || d === 'input_boolean' || d === 'automation'
        ? 'switch'
        : d === 'sensor' || d === 'climate' || d === 'weather'
          ? 'sensor'
          : d === 'binary_sensor'
            ? 'binary'
            : d === 'scene' || d === 'script'
              ? 'play'
              : 'dot';
  return lineSvg(HA_ICON[k]);
}
/* an entity's state in words: on and off, open and closed in the launcher's language, a number with its unit */
function haState(e) {
  if (!e) return '';
  var s = e.state,
    W = { on: t('On'), off: t('Off'), open: t('Open'), closed: t('Closed'), unavailable: t('not available'), unknown: '?' };
  return W[s] !== undefined ? W[s] : s + (e.unit ? (/^[%°]/.test(e.unit) ? '' : ' ') + e.unit : '');
}
function haIds() {
  var ids = [],
    els = $('cards').children;
  for (var i = 0; i < els.length; i++) {
    var c = els[i]._card;
    if (c.type === 'ha-entity' && c.entity) ids.push(String(c.entity).trim());
    if (c.type === 'ha-entities')
      String(c.entities || '')
        .split(/[\s,]+/)
        .forEach(function (x) {
          if (x) ids.push(x);
        });
  }
  return ids.slice(0, 20);
}
/* asks the service for the states the cards show, when they are older than 30 s or the list changed */
function haPoll() {
  var ids = haIds(),
    key = ids.join(',');
  if (!ids.length || HA.busy || (key === HA.want && Date.now() - HA.at < 30000)) return;
  HA.busy = true;
  HA.want = key;
  api('/api/cards/ha', { ids: ids })
    .then(function (r) {
      HA.busy = false;
      HA.at = Date.now();
      HA.err = r.error || '';
      (r.states || []).forEach(function (e) {
        HA.by[e.id] = e;
      });
      tickCards();
    })
    .catch(function () {
      HA.busy = false;
      HA.at = Date.now() - 20000; /* again in ten seconds */
    });
}
/* ---- the Home Assistant weather card (ha-weather): the condition of a weather entity, the temperature outside (a sensor, or the entity's
   own) and the forecast from weather.get_forecasts, through the service; asked again every five minutes ---- */
var HAW = {};
/* Home Assistant's conditions: an icon of the weather card's set, a word, and the nearest WMO code (for {{weather.text}} and the
   greeting's second line, which read the last weather drawn) */
var HAW_COND = {
  sunny: ['sun', 'Sunny', 0],
  'clear-night': ['moon', 'Clear', 0],
  partlycloudy: ['part', 'Partly cloudy', 2],
  cloudy: ['cloud', 'Cloudy', 3],
  fog: ['fog', 'Fog', 45],
  rainy: ['rain', 'Rain', 61],
  pouring: ['rain', 'Heavy rain', 65],
  snowy: ['snow', 'Snow', 71],
  'snowy-rainy': ['snow', 'Sleet', 67],
  hail: ['snow', 'Hail', 77],
  lightning: ['storm', 'Thunderstorm', 95],
  'lightning-rainy': ['storm', 'Thunderstorm', 95],
  windy: ['wind', 'Windy', 3],
  'windy-variant': ['wind', 'Windy', 3],
  exceptional: ['cloud', 'Exceptional weather', 3],
};
WX_ICON.wind = '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h8"/>';
function hawKind(c) {
  var k = HAW_COND[c] || ['cloud', c || '?', 3];
  return [k[0], HAW_COND[c] ? t(k[1]) : k[1], k[2]];
}
function hawFor(o) {
  var id = String(o.entity || '').trim(),
    temp = String(o.temp || '').trim(),
    kind = o.show === 'hourly' ? 'hourly' : o.show === 'none' ? 'none' : 'daily';
  if (!id) return null;
  var k = id + '|' + temp + '|' + kind,
    e = HAW[k] || (HAW[k] = { w: null, at: 0, busy: false });
  if (!e.busy && Date.now() - e.at > 300000) {
    e.busy = true;
    api('/api/cards/ha/weather', { id: id, temp: temp, kind: kind })
      .then(function (w) {
        e.busy = false;
        e.at = Date.now();
        e.w = w;
        if (w && w.error) e.at = Date.now() - 240000; /* an error: again in a minute */
        tickCards();
      })
      .catch(function () {
        e.busy = false;
        e.at = Date.now() - 240000;
      });
  }
  var w = e.w;
  if (w && w.now && w.now.temp !== null) {
    var hk = hawKind(w.now.cond);
    WX_LAST = { now: { temp: Math.round(w.now.temp), code: hk[2], day: w.now.cond !== 'clear-night' } };
  }
  return w;
}
/* a number for the card: one decimal under ten degrees, whole above */
function hawNum(x) {
  if (x === null || x === undefined) return '\u2013';
  return Math.abs(x) < 10 && Math.round(x) !== x ? (Math.round(x * 10) / 10).toLocaleString(LOC) : String(Math.round(x));
}
/* a Home Assistant card is left out while there is nothing to show yet: Home Assistant not set up on the TV, or no entity chosen
   (Customise > Home Assistant sets both); a card that is hidden is not a place for the focus either */
var HA_NOT_SET = 'Home Assistant is not set up';
function haHide(el, hide) {
  var d = hide ? 'none' : '';
  if (el.style.display !== d) {
    el.style.display = d;
  }
  return hide;
}
/* camera cards get a new picture on their own schedule (every 10, 30 or 60 seconds) while Home is shown */
setInterval(function () {
  if (document.hidden) return;
  var imgs = document.querySelectorAll('#cards .card-ha-camera img');
  for (var i = 0; i < imgs.length; i++) {
    var im = imgs[i],
      c = im.parentNode._card,
      ev = (+c.every || 10) * 1000;
    if (Date.now() - (im._at || 0) >= ev) {
      im._at = Date.now();
      im.src = API + '/api/cards/ha/camera/' + encodeURIComponent(String(c.entity || '').trim()) + '?t=' + im._at;
    }
  }
}, 5000);
/* a template card's text: {{greeting}}, {{time}}, {{date}}, {{weekday}} filled in, then **bold**, *italic* and "# heading" lines */
/* a day number: today's, for a date (YYYY-MM-DD) in the template's filters |days and |ago */
function dayDiff(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  var a = new Date(+m[1], +m[2] - 1, +m[3]),
    b = new Date();
  b = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((a - b) / 86400000);
}
function cardMarkup(src, opt) {
  var yr = new Date(),
    y0 = new Date(yr.getFullYear(), 0, 1),
    y1 = new Date(yr.getFullYear() + 1, 0, 1);
  var vars = {
    year: String(yr.getFullYear()),
    'year.percent': String(Math.round(((yr - y0) / (y1 - y0)) * 100)),
    'year.left': String(Math.ceil((y1 - yr) / 86400000)),
    greeting: greetText(''),
    /* the greeting with the name of the card's option "name", kept apart from the sentence by Unicode isolates so a Hebrew or Arabic
       name reads right in an English greeting; the plain greeting when none was typed */
    'greeting.name': greetText(
      opt && opt.name
        ? '\u2068' +
            String(opt.name)
              .replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, '')
              .slice(0, 30) +
            '\u2069'
        : ''
    ),
    time: timeText(),
    date: dateText(),
    weekday: dateText({ weekday: 'long' }),
    'weather.temp': WX_LAST && WX_LAST.now ? WX_LAST.now.temp + '\u00B0' : '',
    'weather.text': WX_LAST && WX_LAST.now ? wxKind(WX_LAST.now.code, WX_LAST.now.day)[1] : '',
  };
  /* what was filled in for a downloaded card, as {{opt.<key>}} */
  for (var k0 in opt || {}) vars['opt.' + k0] = String(opt[k0]);
  var esc = function (x) {
    return String(x).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  /* filters: |days (days until a date), |ago (days since it), |upper, |lower */
  var FILTER = {
    days: function (v) {
      var d = dayDiff(v);
      return d === null ? '' : String(d);
    },
    ago: function (v) {
      var d = dayDiff(v);
      return d === null ? '' : String(-d);
    },
    upper: function (v) {
      return v.toUpperCase();
    },
    lower: function (v) {
      return v.toLowerCase();
    },
  };
  return esc(String(src || '').slice(0, 1500))
    .replace(/\{\{\s*([\w.]+)(?:\|(\w+))?\s*\}\}/g, function (m, k, f) {
      var v = k in vars ? vars[k] : '';
      return esc(f && FILTER[f] ? FILTER[f](v) : v);
    })
    .split('\n')
    .map(function (l) {
      l = l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
      /* # a heading, ### a big light line (a time, a number), > a small dim line; dir=auto lets an Arabic line run from the right */
      if (/^#\s/.test(l)) return '<div class="hd" dir="auto">' + l.replace(/^#\s+/, '') + '</div>';
      if (/^###\s/.test(l)) return '<div class="dsp" dir="auto">' + l.replace(/^###\s+/, '') + '</div>';
      if (/^&gt;\s/.test(l)) return '<div class="mu" dir="auto">' + l.replace(/^&gt;\s+/, '') + '</div>';
      return '<div dir="auto">' + (l || '&nbsp;') + '</div>';
    })
    .join('');
}
var CARD_TYPES = {
  /* "Good morning" by the time of day, with an optional name and an optional second line (the date); set on the phone page */
  greeting: {
    name: function () {
      return t('Greeting');
    },
    draw: function (el, o) {
      var s = greetText(String(o.name || '').slice(0, 40)),
        l2 = o.line === 'date' ? dateText() : o.line === 'weather' ? wxText(WX_LAST) : '',
        key = s + '|' + l2;
      if (el._k === key) return;
      el._k = key;
      el.innerHTML = '<div class="l1"></div>' + (l2 ? '<div class="l2"></div>' : '');
      el.firstChild.textContent = s;
      if (l2) el.lastChild.textContent = l2;
    },
  },
  /* the weather now at a place chosen on the phone page, and with show: 'days' the next three days */
  weather: {
    name: function () {
      return t('Weather');
    },
    draw: function (el, o) {
      var w = wxFor(o),
        place = String(o.place || '').slice(0, 40),
        h;
      if (!w) h = '<div class="wx-none"></div>';
      else {
        var k = wxKind(w.now.code, w.now.day);
        h =
          '<div class="wx-now"><span class="wx-i">' +
          wxSvg(k[0]) +
          '</span><span class="wx-t">' +
          w.now.temp +
          '°</span></div><div class="wx-p"></div>';
        if (o.show === 'days')
          h +=
            '<div class="wx-days">' +
            (w.days || [])
              .slice(1, 4)
              .map(function (d) {
                var wd = '';
                try {
                  wd = new Date(d.date + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'short' });
                } catch (e) {}
                return (
                  '<div><span>' +
                  wd +
                  '</span>' +
                  wxSvg(wxKind(d.code, true)[0]) +
                  '<b>' +
                  d.max +
                  '°</b> <small>' +
                  d.min +
                  '°</small></div>'
                );
              })
              .join('') +
            '</div>';
      }
      var key = h + '|' + place + (w ? w.at : '');
      if (el._k === key) return;
      el._k = key;
      el.innerHTML = h;
      var p = el.querySelector('.wx-p') || el.querySelector('.wx-none');
      p.textContent = w
        ? (place ? place + ' · ' : '') + wxKind(w.now.code, w.now.day)[1]
        : o.lat === undefined
          ? t('Choose a place from your phone')
          : place;
    },
  },
  /* one Home Assistant entity: its icon, its state big and its name; OK switches a light, switch or fan, or runs a scene or script */
  'ha-entity': {
    name: function () {
      return t('Home Assistant entity');
    },
    draw: function (el, o) {
      var id = String(o.entity || '').trim(),
        e = HA.by[id],
        name = String(o.name || (e && e.name) || id).slice(0, 60),
        st = e ? haState(e) : HA.err ? t(HA.err) : id ? '\u2026' : t('Choose an entity from your phone'),
        key = id + '|' + name + '|' + st + '|' + (e ? e.state : '');
      haHide(el, !id || HA.err === HA_NOT_SET);
      el._o = { action: 'card', label: name };
      el.classList.toggle('on', !!e && e.state === 'on');
      if (el._k === key) return;
      el._k = key;
      el.innerHTML =
        '<div class="ha-i">' +
        haIcon(e ? e.domain : id.split('.')[0]) +
        '</div><div class="ha-tx"><div class="ha-s"></div><div class="ha-n"></div></div>';
      el.querySelector('.ha-s').textContent = st;
      el.querySelector('.ha-n').textContent = name;
    },
    /* can OK do something here? (the service decides what may be switched; this only offers it) */
    can: function (o) {
      var e = HA.by[String(o.entity || '').trim()];
      return !!(e && e.can);
    },
    act: function (el, o) {
      var id = String(o.entity || '').trim();
      api('/api/cards/ha/toggle', { id: id })
        .then(function (r) {
          if (r.error) toast(t(r.error), true);
          HA.at = 0;
          setTimeout(haPoll, 600);
        })
        .catch(function () {
          toast(t('The service did not answer.'), true);
        });
    },
  },
  /* several Home Assistant entities in a list: name on one side, state on the other */
  'ha-entities': {
    name: function () {
      return t('Home Assistant entities');
    },
    draw: function (el, o) {
      var ids = String(o.entities || '')
          .split(/[\s,]+/)
          .filter(function (x) {
            return x;
          })
          .slice(0, 12),
        rows = ids.map(function (id) {
          var e = HA.by[id];
          return [e ? e.name : id, e ? haState(e) : '\u2026', e ? e.domain : id.split('.')[0]];
        }),
        title = String(o.title || '').slice(0, 60),
        key = title + JSON.stringify(rows) + HA.err;
      haHide(el, !ids.length || HA.err === HA_NOT_SET);
      if (el._k === key) return;
      el._k = key;
      var h = title ? '<div class="ha-title"></div>' : '';
      rows.forEach(function () {
        h += '<div class="ha-row"><span class="ha-ri"></span><span class="ha-rn"></span><span class="ha-rs"></span></div>';
      });
      if (!rows.length) h += '<div class="ha-n"></div>';
      el.innerHTML = h;
      if (title) el.querySelector('.ha-title').textContent = title;
      var rs = el.querySelectorAll('.ha-row');
      rows.forEach(function (r, i) {
        rs[i].querySelector('.ha-ri').innerHTML = haIcon(r[2]);
        rs[i].querySelector('.ha-rn').textContent = r[0];
        rs[i].querySelector('.ha-rs').textContent = r[1];
      });
      if (!rows.length) el.querySelector('.ha-n').textContent = HA.err ? t(HA.err) : t('Choose entities from your phone');
    },
  },
  /* a Home Assistant camera's picture, renewed every 10, 30 or 60 seconds */
  'ha-camera': {
    name: function () {
      return t('Home Assistant camera');
    },
    draw: function (el, o) {
      var id = String(o.entity || '').trim();
      haHide(el, !id || HA.err === HA_NOT_SET);
      if (el._k === id) return;
      el._k = id;
      if (!/^camera\./.test(id)) {
        el.innerHTML = '<div class="ha-n"></div>';
        el.firstChild.textContent = t('Choose a camera from your phone');
        return;
      }
      var im = document.createElement('img'),
        n = document.createElement('div');
      im.alt = '';
      n.className = 'ha-n';
      n.style.display = 'none';
      /* no picture: say why (Home Assistant not set up, token refused, camera unavailable) instead of an empty card; the
         refresh above keeps trying */
      im.onerror = function () {
        im.style.display = 'none';
        n.style.display = '';
        api('/api/cards/ha', { ids: [id] })
          .then(function (r) {
            var e = (r.states || [])[0];
            n.textContent = r.error ? t(r.error) : (e ? e.name : id) + ': ' + t('not available');
          })
          .catch(function () {
            n.textContent = id + ': ' + t('not available');
          });
      };
      im.onload = function () {
        im.style.display = '';
        n.style.display = 'none';
      };
      im._at = Date.now();
      im.src = API + '/api/cards/ha/camera/' + encodeURIComponent(id) + '?t=' + im._at;
      el.textContent = '';
      el.appendChild(im);
      el.appendChild(n);
    },
  },
  /* Home Assistant weather: the condition and the temperature outside big on the left, the forecast (days or hours) on the right */
  'ha-weather': {
    name: function () {
      return t('Home Assistant weather');
    },
    draw: function (el, o) {
      var w = hawFor(o),
        h;
      if (haHide(el, !o.entity || (w && w.error === HA_NOT_SET))) return;
      if (!w || w.error || !w.now) {
        h = '<div class="hw-msg"></div>';
        var m = !o.entity ? t('Choose a weather entity from your phone') : w && w.error ? t(w.error) : '\u2026';
        if (el._k === 'm' + m) return;
        el._k = 'm' + m;
        el.innerHTML = h;
        el.firstChild.textContent = m;
        return;
      }
      var k = hawKind(w.now.cond),
        unit = /F/.test(w.now.unit) ? '\u00B0F' : '\u00B0',
        facts = [];
      if (w.now.hum !== null) facts.push(Math.round(w.now.hum) + '%');
      if (w.now.wind !== null) facts.push(Math.round(w.now.wind) + (w.now.windUnit ? ' ' + w.now.windUnit : ''));
      h =
        '<div class="hw-now"><div class="hw-top"><span class="wx-i">' +
        wxSvg(k[0]) +
        '</span><span class="hw-t">' +
        hawNum(w.now.temp) +
        unit +
        '</span></div><div class="hw-c"></div><div class="hw-f"></div></div>';
      /* the daily forecast starts tomorrow: today is the left half of the card */
      var today = new Date().toDateString(),
        list = (w.list || [])
          .filter(function (f) {
            return w.kind !== 'daily' || new Date(f.t).toDateString() !== today;
          })
          .slice(0, w.kind === 'hourly' ? 6 : 5);
      if (list.length) {
        h +=
          '<div class="hw-fc">' +
          list
            .map(function (f) {
              var lab = '';
              try {
                var d = new Date(f.t);
                lab =
                  w.kind === 'hourly'
                    ? d.toLocaleTimeString(LOC, { hour: 'numeric', minute: '2-digit' })
                    : d.toLocaleDateString(LOC, { weekday: 'short' });
              } catch (e) {}
              return (
                '<div><span class="hw-d">' +
                lab +
                '</span>' +
                wxSvg(hawKind(f.cond)[0]) +
                '<b>' +
                hawNum(f.hi) +
                '\u00B0</b>' +
                (f.lo !== null ? '<small>' + hawNum(f.lo) + '\u00B0</small>' : '') +
                (f.rain !== null && f.rain > 0 ? '<i>' + Math.round(f.rain) + '%</i>' : '') +
                '</div>'
              );
            })
            .join('') +
          '</div>';
      }
      var key = h + '|' + k[1] + facts.join();
      if (el._k === key) return;
      el._k = key;
      el.innerHTML = h;
      el.querySelector('.hw-c').textContent = k[1];
      el.querySelector('.hw-f').textContent = facts.join(' \u00B7 ');
    },
  },
  /* text from the phone page, with what changes filled in */
  template: {
    name: function () {
      return t('Text');
    },
    draw: function (el, o) {
      var h = cardMarkup(o.text);
      if (el._k === h) return;
      el._k = h;
      el.innerHTML = h;
      el.setAttribute('data-size', o.size === 'small' || o.size === 'large' ? o.size : 'medium');
    },
  },
};
/* A downloaded card that brings its own page (card.json "page"): the service serves it from /card/<id>/ and it runs in a sandboxed frame, with
   no network and no access to this page, which only tells it what it needs: the options, the language, the clock format, the colour and
   size of the text. The card draws itself and keeps its own time. The frame never takes the keys (pointer-events none). */
function cardFrameCtx(el, pk, o) {
  var opt = {};
  pk.options.forEach(function (q) {
    opt[q.key] = o[q.key] !== undefined && o[q.key] !== '' ? o[q.key] : q.def;
    if (q.kind === 'place') {
      opt.lat = o.lat;
      opt.lon = o.lon;
    }
  });
  var cs = getComputedStyle(el);
  return {
    opt: opt,
    data: pk.poll ? el._data || null : undefined /* what the add-on behind the card last said (cardFeed) */,
    lang: LOC,
    clock: clockOpts(),
    size: /^(small|medium|large)$/.test(opt.size) ? opt.size : pk.size,
    align: el.getAttribute('data-align') || 'left',
    dir: document.documentElement.dir || 'ltr',
    ink: cs.color,
    font: cs.fontFamily,
    fs: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 1,
  };
}
function cardFrameSend(el) {
  try {
    el._f.contentWindow.postMessage({ cytvCard: el._ctx }, '*');
  } catch (e) {}
}
/* the card element that owns a message's frame */
function cardOf(src) {
  var els = $('cards').children;
  for (var i = 0; i < els.length; i++) if (els[i]._f && els[i]._f.contentWindow === src) return els[i];
  return null;
}
window.addEventListener('message', function (e) {
  var m = e.data && e.data.cytvCard,
    el = m && cardOf(e.source);
  if (!el) return;
  /* a card page that has loaded asks for what it should show */
  if (m === 'ready') cardFrameSend(el);
  /* a card of an add-on tells where its buttons are (percent of its frame): each becomes a target of the remote, and OK sends the
     add-on the action of that name. Only the actions the card's add-on declared count. */ else if (
    m === 'buttons' &&
    el._pk &&
    el._pk.actions.length
  )
    cardButtons(el, e.data.buttons);
});
/* the buttons of a card of an add-on: made again only when they changed, and the top row of the remote follows */
function cardButtons(el, list) {
  var ok = [],
    names = el._pk.actions.map(function (a) {
      return a.name;
    });
  (Array.isArray(list) ? list : []).slice(0, 8).forEach(function (b) {
    var n = b && typeof b === 'object' ? b : {},
      i = names.indexOf(n.name);
    if (i < 0) return;
    var q = function (v) {
      v = Number(v);
      return isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
    };
    ok.push({ name: n.name, label: el._pk.actions[i].label, x: q(n.x), y: q(n.y), w: q(n.w), h: q(n.h) });
  });
  /* the page says percent of its frame; the frame can sit inside the card's margins (glass cards), so the targets are moved there */
  var f = el._f,
    cw = el.offsetWidth,
    ch = el.offsetHeight;
  if (f && cw && ch && f.offsetWidth && (f.offsetLeft || f.offsetTop || f.offsetWidth !== cw || f.offsetHeight !== ch))
    ok.forEach(function (b) {
      b.x = ((f.offsetLeft + (b.x * f.offsetWidth) / 100) / cw) * 100;
      b.y = ((f.offsetTop + (b.y * f.offsetHeight) / 100) / ch) * 100;
      b.w = ((b.w * f.offsetWidth) / 100 / cw) * 100;
      b.h = ((b.h * f.offsetHeight) / 100 / ch) * 100;
    });
  var key = JSON.stringify(ok);
  if (el._bk === key) return;
  el._bk = key;
  (el._btns || []).forEach(function (b) {
    if (b.parentNode) b.parentNode.removeChild(b);
  });
  el._btns = ok.map(function (b) {
    var d = document.createElement('div');
    d.className = 'card-btn';
    d.style.cssText = 'left:' + b.x + '%;top:' + b.y + '%;width:' + b.w + '%;height:' + b.h + '%';
    d._o = { action: 'cardbtn', label: b.label, fixed: true };
    d._btn = { card: el, name: b.name };
    hit(d);
    el.appendChild(d);
    return d;
  });
  if (window.refreshTop) refreshTop();
}
/* OK on a button: the add-on gets the action, then the card is asked for its data again (the answer to a button shows within seconds) */
function cardBtnAct(d) {
  var el = d._btn.card;
  api('/api/cards/action', { slot: el._slot, name: d._btn.name, lang: LANG }).then(
    function (r) {
      if (r && r.error) toast(t(r.error), true);
      [400, 1500, 3500].forEach(function (ms) {
        setTimeout(function () {
          cardFeed(el);
        }, ms);
      });
    },
    function () {
      toast(t('The service did not answer.'), true);
    }
  );
}
/* a card of an add-on asks its add-on for data now and then (card.json "poll", seconds): only while Home is shown, one request at a time */
function cardFeed(el) {
  if (!el._pk || !el.parentNode || el._busy) return;
  el._busy = true;
  el._feedAt = Date.now();
  api('/api/cards/feed', { slot: el._slot, lang: LANG }).then(
    function (r) {
      el._busy = false;
      el._data = r && typeof r === 'object' ? r : { error: 'no answer' };
      if (el.parentNode && el._card) cardType(el._card.type).draw(el, el._card);
    },
    function () {
      el._busy = false;
      el._data = { error: 'The service did not answer.' };
      if (el.parentNode && el._card) cardType(el._card.type).draw(el, el._card);
    }
  );
}
setInterval(function () {
  if (document.hidden) return;
  var els = $('cards') ? $('cards').children : [];
  for (var i = 0; i < els.length; i++) {
    var pk = els[i]._pk;
    if (pk && pk.poll && Date.now() - (els[i]._feedAt || 0) >= pk.poll * 1000) cardFeed(els[i]);
  }
}, 1000);
function cardFrame(id, pk) {
  return {
    draw: function (el, o) {
      el._pk = pk;
      /* a card with its own page: the glass style (cards.style) gives it the frosted panel too, its page inside the margins */
      if (!/\bcard-frame\b/.test(el.className)) el.className += ' card-frame';
      if (!el._f) {
        var f = document.createElement('iframe');
        f.setAttribute('sandbox', 'allow-scripts');
        f.setAttribute('tabindex', '-1');
        f.setAttribute('scrolling', 'no');
        f.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none';
        f.onload = function () {
          cardFrameSend(el);
        };
        f.src = API + '/card/' + id + '/' + pk.page;
        el._f = f;
        el.appendChild(f);
      }
      var ctx = cardFrameCtx(el, pk, o),
        key = JSON.stringify(ctx);
      if (el._k === key) return;
      el._k = key;
      el._ctx = ctx;
      cardFrameSend(el);
    },
  };
}
/* a card downloaded from the catalog (helper/cardcatalog.js) is the type x-<id>: drawn from its template, with what was filled in */
var CARD_PACKS = {};
function cardType(name) {
  if (CARD_TYPES[name]) return CARD_TYPES[name];
  var pk = /^x-(.+)$/.test(name) && CARD_PACKS[name.slice(2)];
  if (!pk) return null;
  if (pk.page) return cardFrame(name.slice(2), pk);
  return {
    draw: function (el, o) {
      var opt = {};
      pk.options.forEach(function (q) {
        opt[q.key] = o[q.key] !== undefined && o[q.key] !== '' ? o[q.key] : q.def;
        if (q.kind === 'place') {
          /* the place the phone page chose: its name and coordinates */
          opt.lat = o.lat;
          opt.lon = o.lon;
        }
      });
      var h = cardMarkup(pk.template, opt);
      if (el._k === h) return;
      el._k = h;
      el.innerHTML = h;
      /* an option called size (small, medium, large) is the card's size, else the card's own */
      el.setAttribute('data-size', /^(small|medium|large)$/.test(opt.size) ? opt.size : pk.size);
    },
  };
}
function cardFor(sl) {
  var c = (cfg.cards || {})[sl.id];
  if (c && c.type) return c.type === 'none' || !cardType(c.type) ? null : c;
  return cardType(sl.card) ? { type: sl.card } : null;
}
function drawCards() {
  var box = $('cards'),
    list = TH.slots || [];
  box.textContent = '';
  list.forEach(function (sl) {
    var c = cardFor(sl);
    if (!c) return;
    var el = document.createElement('div'),
      st = el.style;
    el.className = 'card ' + (CARD_TYPES[c.type] ? '' : 'card-template ') + 'card-' + c.type + (sl.keep ? ' keep' : '');
    el.setAttribute('data-align', sl.align || 'left');
    st.setProperty('--cl', sl.l);
    st.setProperty('--cr', sl.r);
    st.setProperty('--ct', sl.t);
    st.setProperty('--cb', sl.b);
    st.setProperty('--ctx', sl.tx);
    /* a centred card is placed from the right in a right-to-left language (rtl.css), so it moves the other way to its centre */
    if (sl.tx !== 'none') st.setProperty('--ctxr', 'translateX(50%)');
    st.width = sl.w;
    st.height = sl.h;
    st.setProperty('--ch', sl.h);
    el._card = c;
    el._slot = sl.id;
    box.appendChild(el);
  });
  tickCards();
  /* glass cards: the scene behind them (scenes.js) */
  if (window.SCENES) SCENES.glassCards();
}
/* the clock tick: cards that change with the time redraw themselves */
function tickCards() {
  /* weather cards first, so a text card or the greeting can use their weather */
  var els = $('cards').children,
    pass,
    i;
  for (pass = 0; pass < 2; pass++)
    for (i = 0; i < els.length; i++)
      if (/^(ha-)?weather$/.test(els[i]._card.type) === (pass === 0)) cardType(els[i]._card.type).draw(els[i], els[i]._card);
  haPoll();
}
/* the cards that OK can do something with: they join the top row (with the buttons) for the remote */
function cardTargets() {
  var out = [],
    els = $('cards').children;
  for (var i = 0; i < els.length; i++) {
    var ty = CARD_TYPES[els[i]._card.type];
    if (ty && ty.act && els[i].style.display !== 'none') out.push(els[i]);
    /* the buttons of a card of an add-on */
    if (els[i]._btns && els[i].offsetParent) out.push.apply(out, els[i]._btns);
  }
  return out;
}
function cardAct(el) {
  var ty = CARD_TYPES[el._card.type];
  if (!ty) return; /* a downloaded card has nothing to do on OK */
  if (ty.can && !ty.can(el._card)) return;
  ty.act(el, el._card);
}
/* OLED care: after three minutes without a key the cards dim, and every few minutes they shift a few pixels, so a card that stays on
   screen for hours does not leave its outline in the panel */
var cardsIdleT = 0;
function cardsWake() {
  document.body.classList.remove('cards-idle');
  clearTimeout(cardsIdleT);
  cardsIdleT = setTimeout(function () {
    document.body.classList.add('cards-idle');
  }, 180000);
}
document.addEventListener('keydown', cardsWake, true);
cardsWake();
setInterval(function () {
  var b = $('cards');
  if (b && !document.hidden)
    b.style.transform = 'translate(' + Math.round(Math.random() * 12 - 6) + 'px,' + Math.round(Math.random() * 12 - 6) + 'px)';
}, 240000);
