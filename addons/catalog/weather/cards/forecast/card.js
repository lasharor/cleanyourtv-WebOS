/* The forecast card (ES5: it runs on Chromium 68 too). Everything it shows comes in the message of the launcher: m.data is what the
   weather add-on's service said for this card (translated words included), m.opt.look is Minimal or Rich, m.lang and m.clock the language
   and the clock format. The frame has no network. The whole card is one button for the remote (OK or a click opens the launcher's drawer);
   the glass is drawn only as big as its content, and the button is told to match it.
   Three shapes by the size of the place: strip (under 70px high), compact (under 190px) and panel. Minimal: one number, one icon, one
   phrase. Rich: the same plus today's next hours. */
var ICON = {
  sun: '<circle cx="12" cy="12" r="5" fill="#FFD36B"/><g stroke="#FFD36B" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></g>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="#dfe6f5"/>',
  part: '<circle cx="9" cy="8" r="3.6" fill="#FFD36B"/><g stroke="#FFD36B" stroke-width="1.8" stroke-linecap="round"><path d="M9 1.6v1.4M3 8H1.6M4.6 3.6l1 1M13.4 3.6l-1 1"/></g><path d="M8 20h9.2a3.6 3.6 0 0 0 .4-7.18A5.2 5.2 0 0 0 7.8 13.6 3.2 3.2 0 0 0 8 20z" fill="#e9eef6"/>',
  cloud: '<path d="M7 19h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 12.6 3.3 3.3 0 0 0 7 19z" fill="#e9eef6"/>',
  fog: '<g stroke="#e9eef6" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M3 13h18M5 17h14"/></g>',
  rain: '<path d="M7 15h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 8.6 3.3 3.3 0 0 0 7 15z" fill="#cfd8e6"/><g stroke="#7CC4FF" stroke-width="2" stroke-linecap="round"><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/></g>',
  snow: '<path d="M7 15h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 8.6 3.3 3.3 0 0 0 7 15z" fill="#cfd8e6"/><g stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M8 19h.01M12 21h.01M16 19h.01M10 22h.01M14 18.5h.01"/></g>',
  storm:
    '<path d="M7 15h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 8.6 3.3 3.3 0 0 0 7 15z" fill="#b9c3d6"/><path d="M12.8 14.5l-2.4 4h3l-2 4" fill="none" stroke="#FFD36B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  drop: '<path d="M12 3s6 6.2 6 10.2a6 6 0 0 1-12 0C6 9.2 12 3 12 3z" fill="currentColor"/>',
};
var M = null,
  sentKey = '';
/* tell the launcher where the button is, once for each place and size of it */
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
function svg(k, cls) {
  var s = el('span');
  s.innerHTML = '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24">' + (ICON[k] || ICON.cloud) + '</svg>';
  return s.firstChild;
}
function num(v, suffix) {
  return typeof v === 'number' && isFinite(v) ? v + (suffix || '') : '–';
}
/* 2026-10-31T19:48 (the time at the place) as the clock of the launcher shows it: without the minutes for an hour of the day */
function hourText(s, short) {
  var h = parseInt(String(s).slice(11, 13), 10),
    mi = parseInt(String(s).slice(14, 16), 10),
    o = {},
    c = M.clock || { hour: 'numeric', minute: '2-digit' },
    k;
  if (isNaN(h)) return '';
  for (k in c) if (!(short && k === 'minute')) o[k] = c[k];
  try {
    return new Date(2000, 0, 1, h, isNaN(mi) ? 0 : mi).toLocaleTimeString(M.lang, o);
  } catch (e) {
    return h + (short ? '' : ':' + (mi < 10 ? '0' : '') + mi);
  }
}
function sp(cls, text) {
  return el('span', cls, text);
}
/* "H 27°  L 19°": the first letter of the words High and Low */
function hl(L, d, wrap) {
  var t = d.days && d.days[0];
  if (!t) return null;
  var x = el(wrap || 'span');
  x.appendChild(sp('s3', (L.High || 'H').charAt(0)));
  x.appendChild(document.createTextNode(' ' + num(t.max, '°') + ' '));
  x.appendChild(sp('s3 lo', (L.Low || 'L').charAt(0)));
  x.appendChild(document.createTextNode(' ' + num(t.min, '°')));
  return x;
}
function feels(L, d) {
  return (L['Feels like'] || '') + ' ' + num(d.now.feels, '°');
}
/* the next hours as columns: the hour, the icon, the temperature */
function hoursView(d, n, cls, from) {
  var box = el('div', cls),
    hs = d.hours || [],
    i = from || 0,
    k;
  if (hs.length < i + n) i = 0;
  for (k = 0; k < n && i < hs.length; k++, i++) {
    var c = el('div');
    c.appendChild(sp('s2', i === 0 ? (d.labels && d.labels.Now) || '' : hourText(hs[i].t, true)));
    c.appendChild(svg(hs[i].icon, hs[i].icon === 'sun' ? 'k-sun' : ''));
    c.appendChild(el('b', '', num(hs[i].temp, '°')));
    box.appendChild(c);
  }
  return box;
}
function stripView(box, d, L, rich) {
  box.appendChild(svg(d.now.icon));
  box.appendChild(sp('t', num(d.now.temp, '°')));
  box.appendChild(sp('s2', d.now.text));
  if (rich && typeof d.now.rain === 'number' && d.now.rain >= 40) {
    box.appendChild(sp('s3 d', '·'));
    box.appendChild(sp('rn', ''));
    box.lastChild.appendChild(svg('drop'));
    box.appendChild(sp('s2 pc', d.now.rain + '%'));
  }
}
function compactView(box, d, L, rich) {
  box.appendChild(svg(d.now.icon, 'big'));
  box.appendChild(sp('tmp', num(d.now.temp, '°')));
  var rt = el('div', 'rt');
  if (rich) rt.appendChild(hoursView(d, 3, 'hrs'));
  else {
    rt.appendChild(el('div', 'c1', d.now.text));
    rt.appendChild(el('div', 'c2 s2', feels(L, d)));
  }
  box.appendChild(rt);
}
function panelView(box, d, L, rich) {
  var h = hl(L, d, 'div'),
    main = el('div', 'main'),
    side = el('div', 'side');
  if (rich) {
    var top = el('div', 'top');
    top.appendChild(el('div', 'city', d.city || ''));
    if (h) {
      h.className = 'hl';
      top.appendChild(h);
    }
    box.appendChild(top);
  } else box.appendChild(el('div', 'city', d.city || ''));
  main.appendChild(svg(d.now.icon));
  main.appendChild(el('div', 'tmp', num(d.now.temp, '°')));
  side.appendChild(el('div', 'cond', d.now.text));
  if (rich) side.appendChild(el('div', 'fl', feels(L, d)));
  else if (h) {
    h.className = 'hl';
    side.appendChild(h);
  }
  main.appendChild(side);
  box.appendChild(main);
  if (rich) box.appendChild(hoursView(d, 5, 'hr', 1));
}
function layout() {
  var h = window.innerHeight;
  return h < 70 ? 'strip' : h < 190 ? 'compact' : 'panel';
}
/* the button is the glass: its place and size in percent of the frame, and the radius of its corners for the focus ring */
function fullButton(name, gl, mode) {
  var r = gl.getBoundingClientRect(),
    W = window.innerWidth,
    H = window.innerHeight,
    q = function (v, t) {
      return Math.max(0, Math.min(100, Math.round((v / t) * 1000) / 10));
    },
    x = q(r.left, W),
    w = q(r.width, W);
  return [{ name: name, x: x, y: q(r.top, H), w: w, h: q(r.height, H), r: mode === 'strip' ? 999 : 32 }];
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
    sendButtons([]); /* until the add-on has answered, nothing is drawn: no glass, no ellipsis */
    return;
  }
  var L = d.labels || {};
  if (d.empty) {
    main.className = 'msg';
    main.appendChild(el('div', 'm1', L['Choose a city'] || ''));
    if (mode !== 'strip') main.appendChild(el('div', 'm2', L['Select to set it on the TV'] || ''));
    return sendButtons(fullButton('settings', main, mode));
  }
  if (d.error) {
    main.className = 'msg';
    main.appendChild(el('div', 'm1', d.error));
    return sendButtons([]);
  }
  if (mode === 'strip') {
    main.className = 'strip';
    stripView(main, d, L, rich);
  } else if (mode === 'compact') {
    main.className = 'cmp';
    compactView(main, d, L, rich);
  } else {
    main.className = 'pnl ' + (rich ? 'rich' : 'min');
    panelView(main, d, L, rich);
  }
  sendButtons(fullButton('open', main, mode)); /* after the drawing: the glass is as big as its content */
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
