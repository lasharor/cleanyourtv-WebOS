/* The phone remote's page on the TV: pair a phone (a QR code and a 6-digit code), the paired phones, and when unused ones are removed.
   It is a page of the launcher's book: the launcher gives it the focus, Back closes it (the SDK script at the end of the page posts
   that to the launcher), and the number and colour buttons stay the launcher's. ES5, Chromium 68: no arrow functions, no template
   literals, no flex gap. The service is at /api/addons/phoneremote (the loader passes what follows to the add-on's handle).
   The view: the stage on the left is idle (the two steps and Pair a phone), pairing (the QR, the code and its countdown) or expired
   (the QR dimmed, Get a new code); the list on the right has one stop per phone, and OK on it opens the manage sheet; a destructive
   action asks in a confirm that has Cancel first. Back closes the confirm, then the sheet, then the stage, then the page. */
var Q = (function () {
  var o = {},
    s = String(location.search || '')
      .replace(/^\?/, '')
      .split('&'),
    i,
    p;
  for (i = 0; i < s.length; i++) {
    p = s[i].split('=');
    if (p[0]) o[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  }
  return o;
})();
var API = '/api/addons/phoneremote',
  S = null,
  SIG = '',
  qrFor = '',
  pairFrom = 0,
  toastT = 0,
  busy = false,
  /* the pairing on the stage: what the TV shows (kept when the window ends, so an expired code stays in place), and its countdown */
  shown = null,
  expired = false,
  closing = false,
  endAt = 0,
  total = 0,
  tickT = 0,
  /* the manage sheet (the phone's id), the picker of when unused phones are removed, and the confirm ({title, text, ok, run});
     back is the stop the focus returns to */
  sheetId = '',
  picking = false,
  dlg = null,
  back = '',
  /* the list shows whole cards: the first one in view, and how many fit */
  first = 0,
  fit = 0,
  CARD = 116; /* a card and the space under it */

setLang(Q.lang || '');

function $(id) {
  return document.getElementById(id);
}
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function cls(e, name, on) {
  var c = ' ' + e.className + ' ';
  c = c.replace(' ' + name + ' ', ' ');
  e.className = (on ? c + name : c).replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
}
/* one call to the add-on: '/state' is the state (and POSTs the expiry), then '/pair', '/revoke', '/access' */
function api(path, body, cb) {
  var x = new XMLHttpRequest();
  x.open(body ? 'POST' : 'GET', API + path);
  if (body) x.setRequestHeader('content-type', 'application/json');
  x.timeout = 15000;
  x.onload = function () {
    var j = null;
    try {
      j = JSON.parse(x.responseText);
    } catch (e) {}
    cb(j, x.status);
  };
  x.onerror = x.ontimeout = function () {
    cb(null, 0);
  };
  x.send(body ? JSON.stringify(body) : null);
}
function toast(text) {
  var e = $('toast');
  e.textContent = text;
  e.className = 'on';
  clearTimeout(toastT);
  toastT = setTimeout(function () {
    e.className = '';
  }, 3500);
}
function fail(r) {
  toast((r && r.error) || t('The service did not answer.'));
}
/* "7 min ago", "3 h ago", "3 days ago", "2 weeks ago": number first so plural forms follow (matches the redesign). */
function ago(at) {
  var m = Math.round((Date.now() - at) / 60000),
    d,
    w,
    mo;
  if (m < 1) return t('just now');
  if (m < 60) return t(m + ' min ago');
  if (m < 1440) return t(Math.round(m / 60) + ' h ago');
  d = Math.round(m / 1440);
  if (d < 7) return t(d + ' days ago');
  if (d < 30) {
    w = Math.max(1, Math.round(d / 7));
    return t(w + ' weeks ago');
  }
  mo = Math.max(1, Math.round(d / 30));
  return t(mo + ' months ago');
}
/* what the phone can do now, said as what happens: green is only "Connected" */
function state(p) {
  if (p.blocked) return t('Blocked · can’t control this TV');
  if (p.online) return t('Connected');
  return p.seen ? t('Last used ' + ago(p.seen)) : t('Paired, not used yet');
}
/* How long until an unused phone is removed by itself (the service removes one that is not connected and has not been used or paired
   for the chosen days), or -1 when it will not be: removal is off, or the phone is connected or blocked. */
var DAY = 86400000;
function removalLeft(p) {
  var d = S && S.expireDays;
  if (!d || p.online || p.blocked) return -1;
  return Math.max(0, Math.max(p.seen || 0, p.created || 0) + d * DAY - Date.now());
}
/* said on the card only when it is close: three days or less, or the last quarter of the time */
function countdown(p) {
  var left = removalLeft(p);
  if (left < 0 || (left > 3 * DAY && left > S.expireDays * DAY * 0.25)) return '';
  return left < DAY ? t('removed soon') : t('removed in ' + Math.ceil(left / DAY) + ' days');
}
function stateCls(p) {
  return p.blocked ? 'no' : p.online ? 'on' : '';
}
function phones() {
  var l = ((S && S.phones) || []).slice();
  /* connected first, then the most recently used; the order is stable, so the focus stays on the same card */
  l.sort(function (a, b) {
    return (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.seen || 0) - (a.seen || 0) || (a.id < b.id ? -1 : 1);
  });
  return l;
}
function byId(id) {
  var l = (S && S.phones) || [],
    i;
  for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
  return null;
}

/* ---- the manage sheet and the confirm ---- */
function openSheet(id) {
  sheetId = id;
  back = 'p:' + id;
  render();
  focusKey('s:access');
}
function closeSheet(to) {
  sheetId = '';
  render();
  if (!focusKey(to || back)) focusFirst();
}
function ask(o) {
  dlg = o;
  render();
  focusKey('d:cancel'); /* Cancel first: a missed OK destroys nothing */
}
function closeDlg() {
  dlg = null;
  render();
  if (!focusKey(sheetId ? 's:remove' : back)) focusFirst();
}
function removePhone(p) {
  ask({
    title: t('Remove ' + p.name + '?'),
    text: t('It will need a new code to connect again.'),
    ok: t('Remove'),
    run: function () {
      var next = neighbour(p.id);
      api('/revoke', { id: p.id }, function (r) {
        if (!r || r.error) return fail(r);
        S = r;
        dlg = null;
        sheetId = '';
        toast(t(p.name + ' removed'));
        render();
        if (!focusKey(next)) focusFirst();
      });
    },
  });
}
/* the card the focus goes to when one is removed: the next one, or the one before it at the end of the list */
function neighbour(id) {
  var l = phones(),
    i;
  for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i + 1] ? 'p:' + l[i + 1].id : l[i - 1] ? 'p:' + l[i - 1].id : 'pair';
  return 'pair';
}
function removeAll() {
  var n = ((S && S.phones) || []).length;
  back = 'all';
  ask({
    title: t('Remove all ' + n + ' phones?'),
    text: t('Every phone will need a new code. This can’t be undone.'),
    ok: t('Remove all'),
    run: function () {
      api('/revoke', { all: true }, function (r) {
        if (!r || r.error) return fail(r);
        S = r;
        dlg = null;
        toast(t(n + ' phones removed'));
        render();
        focusKey('pair');
      });
    },
  });
}
/* Block applies at once (Allow is one press away, so it does not ask); the sheet closes on the same card */
function allow(p) {
  var blocked = !!p.blocked;
  api('/access', { id: p.id, allow: blocked }, function (r) {
    if (!r || r.error) return fail(r);
    S = r;
    toast(blocked ? t('Phone allowed') : t('Phone blocked'));
    closeSheet('p:' + p.id);
  });
}

/* ---- the pairing window: open while the TV shows the code, closed when the page leaves it or a phone has paired ---- */
/* the code is on the screen: the window is open and no phone has scanned the QR yet (a scan takes it off the TV at once; the window
   stays open on the service for that phone alone, to finish pairing) */
function live() {
  return !!(S && S.pairing && !S.pairing.scanned);
}
function pair() {
  if (busy) return;
  busy = true;
  api('/pair', {}, function (r) {
    busy = false;
    if (!r || r.error) return fail(r);
    S = r;
    pairFrom = Date.now();
    expired = false;
    shown = null;
    SIG = '';
    render();
    focusKey('stop');
  });
}
function stopPair(quiet) {
  var was = live();
  closing = true;
  api('/pair', { stop: true }, function (r) {
    closing = false;
    if (r) S = r;
    shown = null;
    expired = false;
    SIG = '';
    render();
    focusKey('pair');
    if (was && !quiet) toast(t('Pairing closed — the code no longer works.'));
  });
}
/* the window ended by itself (its time, or too many wrong codes): the QR stays, dimmed, and the primary offers a new code */
function expire() {
  expired = true;
  clearInterval(tickT);
  tickT = 0;
  render();
  focusKey('renew');
}
function mmss(s) {
  var m = Math.floor(s / 60),
    r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function tick() {
  if (!live() && !expired) {
    clearInterval(tickT);
    tickT = 0;
    return;
  }
  var left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
  $('pairnote').textContent = t('Expires in ' + mmss(left) + ' · works once.');
  $('railbar').style.transform = 'scaleX(' + (total ? Math.min(1, left / total) : 0) + ')';
  if (!left && !expired) expire();
}
function drawQr(text) {
  /* qrcode.js loads before the page script; keep a short retry anyway if a host ever reorders the tags. */
  if (typeof qrcode !== 'function') {
    if (!drawQr._tries) drawQr._tries = 0;
    if (drawQr._tries++ < 40)
      setTimeout(function () {
        drawQr(text);
      }, 25);
    return;
  }
  drawQr._tries = 0;
  try {
    var q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    /* 480 px of modules; the card's 24 px of white around them is the quiet zone. Each module is rounded to whole pixels. */
    var n = q.getModuleCount(),
      cv = $('qr'),
      size = 480,
      g,
      r,
      c,
      x,
      y;
    if (!cv || !cv.getContext) return;
    cv.width = cv.height = size;
    g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000';
    for (r = 0; r < n; r++)
      for (c = 0; c < n; c++)
        if (q.isDark(r, c)) {
          x = Math.round((c * size) / n);
          y = Math.round((r * size) / n);
          g.fillRect(x, y, Math.round(((c + 1) * size) / n) - x, Math.round(((r + 1) * size) / n) - y);
        }
  } catch (e) {
    /* no QR code: the address and the code are on the page anyway */
  }
}
function renderStage() {
  var p = live() ? S.pairing : null,
    open = !!(p || expired),
    code,
    i,
    box;
  if (p && !closing) {
    if (!shown || shown.code !== p.code) {
      shown = { code: p.code, url: p.url, qr: p.qr };
      total = Math.max(p.seconds || 0, 1);
      expired = false;
    }
    endAt = Date.now() + (p.seconds || 0) * 1000;
    total = Math.max(total, p.seconds || 0);
    if (!expired && !tickT) tickT = setInterval(tick, 1000);
  }
  cls($('idle'), 'hide', open);
  cls($('pairsheet'), 'hide', !open);
  cls($('phonecol'), 'dim', open);
  /* the address the phone types: the TV's, also when no window is open */
  var url = (p && p.url) || S.url || (shown && shown.url) || '',
    noNet = S.url === '';
  $('idleurl').textContent = noNet ? t('This TV has no network address. Connect the TV to Wi-Fi, then pair.') : url;
  cls($('idleurl'), 'warn', noNet);
  if (!open || !shown) {
    qrFor = '';
    return;
  }
  $('pairurl').textContent = shown.url || '';
  if (shown.qr && shown.qr !== qrFor) {
    qrFor = shown.qr;
    drawQr(shown.qr);
  }
  cls($('qrcard'), 'dimmed', expired);
  box = $('codebox');
  cls(box, 'expired', expired);
  if (expired) box.textContent = t('Code expired');
  else if (box.getAttribute('data-code') !== shown.code) {
    /* two groups of three (the second one set apart by its margin), the digits fading in 40 ms apart */
    box.textContent = '';
    code = String(shown.code || '');
    for (i = 0; i < code.length; i++) {
      var d = el('span', i === 3 ? 'g' : '', code.charAt(i));
      d.style.animationDelay = i * 40 + 'ms';
      box.appendChild(d);
    }
  }
  box.setAttribute('data-code', expired ? '' : shown.code);
  cls($('pairnote'), 'quiet', false);
  if (expired) $('pairnote').textContent = t('This code no longer works.');
  else tick();
  cls($('rail'), 'hide', expired);
  cls($('pairnew'), 'hide', !expired);
}
function avatar() {
  var a = el('span', 'av');
  a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>';
  return a;
}
function renderPhones() {
  var box = $('phonein'),
    list = phones(),
    i,
    p,
    row,
    who,
    st,
    cd,
    q;
  box.textContent = '';
  if (!list.length) {
    q = el('div', 'quiet');
    q.appendChild(avatar());
    who = el('span', 'who');
    who.appendChild(el('b', '', t('No phone is paired yet')));
    who.appendChild(el('span', 'st', t('Pair a phone on the left to use it as a remote.')));
    q.appendChild(who);
    box.appendChild(q);
  }
  for (i = 0; i < list.length; i++) {
    p = list[i];
    row = el('button', 'phone');
    row.setAttribute('data-k', 'p:' + p.id);
    row.appendChild(avatar());
    who = el('span', 'who');
    who.appendChild(el('b', '', p.name));
    st = el('span', 'st ' + stateCls(p), state(p));
    cd = countdown(p);
    if (cd) {
      st.appendChild(document.createTextNode(' · '));
      st.appendChild(el('em', '', cd));
    }
    who.appendChild(st);
    row.appendChild(who);
    row.appendChild(el('span', 'mg', t('Manage')));
    row.onclick = (function (id) {
      return function () {
        openSheet(id);
      };
    })(p.id);
    box.appendChild(row);
  }
  /* "Remove all phones" only with two or more */
  cls($('removeall'), 'hide', list.length < 2);
  /* a busy port: one line above the list, and a way to try again */
  var busyPort = !!(S && S.listenError);
  cls($('portnote'), 'hide', !busyPort);
  if (busyPort) $('porttext').textContent = t('Port ' + (S.port || 8799) + ' is busy. Another app is using it — close it, then try again.');
  fitList();
}
/* The list gets the room between the column's top lines and the setting row, in whole cards; when the phones do not all fit, a line
   under it says how many more there are. */
function fitList() {
  var n = phones().length,
    lb = $('phonelist');
  lb.style.height = '0px';
  cls($('more'), 'hide', true);
  fit = Math.max(1, Math.floor(room() / CARD));
  if (n > fit) {
    cls($('more'), 'hide', false);
    $('more').textContent = '▼';
    fit = Math.max(1, Math.floor(room() / CARD));
  }
  lb.style.height = Math.min(n || 1, fit) * CARD + 'px';
  reveal(first);
}
function room() {
  var foot = $('removeall').nextElementSibling;
  return $('expire').offsetTop - (foot.offsetTop + foot.offsetHeight) - 12;
}
/* shows the card at index i (the focused one), whole, and says what is left below */
function reveal(i) {
  var n = phones().length;
  if (i < first) first = i;
  if (i >= first + fit) first = i - fit + 1;
  first = Math.max(0, Math.min(first, n - fit));
  $('phonelist').scrollTop = first * CARD;
  if (n > fit) $('more').textContent = first + fit < n ? '▼ ' + t(n - first - fit + ' more') : '▲ ' + t('scrolled to the end');
}
function indexOfKey(k) {
  var l = phones(),
    i;
  for (i = 0; i < l.length; i++) if ('p:' + l[i].id === k) return i;
  return -1;
}
function renderCap() {
  var l = (S && S.phones) || [],
    on = 0,
    i;
  for (i = 0; i < l.length; i++) if (l[i].online) on++;
  $('captext').textContent = l.length ? t(l.length + ' phones · ' + on + ' connected') : t('No phone paired');
  cls($('capdot'), 'off', !on);
}
/* ---- when unused phones are removed: one row (the rule and its value) and a picker with the six choices ---- */
var DAYS = [1, 3, 7, 14, 30, 0];
var AFTER = { 1: 'after 1 day', 3: 'after 3 days', 7: 'after 1 week', 14: 'after 2 weeks', 30: 'after 1 month' };
var CHOICE = { 1: 'After 1 day', 3: 'After 3 days', 7: 'After 1 week', 14: 'After 2 weeks', 30: 'After 1 month', 0: 'Never' };
function curExp() {
  return S && S.expireDays !== undefined ? S.expireDays : 14;
}
function openPick() {
  picking = true;
  back = 'exp';
  render();
  focusKey('o:' + curExp());
}
function closePick() {
  picking = false;
  render();
  focusKey('exp');
}
function choose(days) {
  if (days === curExp()) return closePick();
  /* "Never" is not recommended: it asks first, and says what it means; Cancel goes back to the list */
  if (days === 0) {
    back = 'o:0';
    return ask({
      title: t('Keep phones paired until you remove them?'),
      text: t('A lost or sold phone would keep control of this TV.'),
      ok: t('Keep them'),
      run: function () {
        save(0);
      },
    });
  }
  save(days);
}
function save(days) {
  api('/state', { expireDays: days }, function (r) {
    if (!r || r.error) return fail(r);
    S = r;
    dlg = null;
    picking = false;
    toast(days ? t('Saved') + ': ' + t(AFTER[days]) : t('Saved: never'));
    render();
    focusKey('exp');
  });
}
function renderExpire() {
  var cur = curExp(),
    any = ((S && S.phones) || []).length > 0;
  $('expsub').textContent = !cur
    ? t('Off · a lost phone keeps control until you remove it')
    : any
      ? t('Automatic · connected phones are never removed')
      : t('Applies to phones you pair');
  $('expval').textContent = t(CHOICE[cur] || CHOICE[14]);
  cls($('exppill'), 'never', !cur);
}
function renderPick() {
  var box = $('opts'),
    cur = curExp(),
    i;
  box.textContent = '';
  for (i = 0; i < DAYS.length; i++)
    (function (days) {
      var b = el('button', 'opt' + (days === 0 ? ' never' : '') + (days === cur ? ' on' : ''));
      b.setAttribute('data-k', 'o:' + days);
      b.appendChild(el('span', '', t(CHOICE[days]) + (days === 14 ? ' · ' + t('Default') : '')));
      b.appendChild(el('span', 'r', days === cur ? '✓' : days === 0 ? t('Not recommended') : ''));
      b.onclick = function () {
        choose(days);
      };
      box.appendChild(b);
    })(DAYS[i]);
}
function renderOverlay() {
  var p = sheetId ? byId(sheetId) : null,
    left,
    meta;
  if (sheetId && !p) sheetId = ''; /* the phone went away (removed by itself): the sheet closes */
  cls($('veil'), 'hide', !sheetId && !dlg && !picking);
  cls($('sheet'), 'hide', !sheetId || !!dlg);
  cls($('pick'), 'hide', !picking || !!dlg);
  cls($('dialog'), 'hide', !dlg);
  if (picking) renderPick();
  if (p) {
    $('sheetname').textContent = p.name;
    meta = $('sheetmeta');
    meta.textContent = p.online ? t('Connected now.') : state(p) + '.';
    /* the sheet always says when an unused phone will be removed */
    left = removalLeft(p);
    if (left >= 0) {
      meta.appendChild(document.createTextNode(' '));
      meta.appendChild(el('em', '', t('Removed in ' + Math.max(1, Math.ceil(left / DAY)) + ' days if not used.')));
    }
    meta.className = 'smeta ' + stateCls(p);
    $('sheetaccess').textContent = p.blocked ? t('Allow this phone') : t('Block this phone');
  }
  if (dlg) {
    $('dlgtitle').textContent = dlg.title;
    $('dlgtext').textContent = dlg.text;
    $('dlgok').textContent = dlg.ok;
  }
}
function render() {
  if (!S) return;
  var act = document.activeElement,
    dk = act && act.getAttribute ? act.getAttribute('data-k') : '';
  trDom();
  renderStage();
  renderPhones();
  renderExpire();
  renderCap();
  renderOverlay();
  if (!focusKey(dk)) focusFirst();
}
function trDom() {
  var n = document.querySelectorAll('[data-t]'),
    i;
  for (i = 0; i < n.length; i++) n[i].textContent = t(n[i].getAttribute('data-t'));
}

/* ---- the focus: regions, not DOM order. A sheet or a confirm keeps it; while pairing it stays on the stage. ---- */
function region() {
  if (dlg) return $('dialog');
  if (picking) return $('pick');
  if (sheetId) return $('sheet');
  if (live() || expired) return $('stage');
  return $('app');
}
function focusables() {
  var all = region().querySelectorAll('button'),
    out = [],
    i;
  for (i = 0; i < all.length; i++) if (all[i].offsetParent !== null && !all[i].disabled) out.push(all[i]);
  return out;
}
function focusKey(k) {
  var n = focusables(),
    i;
  if (!k) return false;
  for (i = 0; i < n.length; i++)
    if (n[i].getAttribute('data-k') === k) {
      try {
        n[i].focus();
      } catch (e) {}
      return true;
    }
  return false;
}
function focusFirst() {
  var l = focusables();
  if (l.length) {
    try {
      l[0].focus();
    } catch (e) {}
  }
}
/* the arrows move to the nearest stop on that side, by what the eye sees: Up and Down stay in a column, Left and Right cross them */
function move(k) {
  var l = focusables(),
    cur = document.activeElement,
    best = null,
    bestD = 1e9,
    a,
    i,
    b,
    dx,
    dy,
    d;
  if (!l.length) return;
  if (l.indexOf(cur) < 0) return focusFirst();
  /* Up and Down in the list go card by card, also to one that is out of view (the list then slides); a card out of view is not a
     target for any other move */
  var ck = cur.getAttribute('data-k') || '',
    ci = indexOfKey(ck),
    pl = phones(),
    lr = $('phonelist').getBoundingClientRect();
  if (ci >= 0 && (k === 38 || k === 40) && pl[ci + (k === 40 ? 1 : -1)]) return focusKey('p:' + pl[ci + (k === 40 ? 1 : -1)].id);
  a = cur.getBoundingClientRect();
  for (i = 0; i < l.length; i++) {
    if (l[i] === cur) continue;
    b = l[i].getBoundingClientRect();
    if (/^p:/.test(l[i].getAttribute('data-k') || '') && (b.top < lr.top - 1 || b.bottom > lr.bottom + 1)) continue;
    dx = (b.left + b.right - a.left - a.right) / 2;
    dy = (b.top + b.bottom - a.top - a.bottom) / 2;
    if (k === 37 && !(b.right <= a.left + 1)) continue;
    if (k === 39 && !(b.left >= a.right - 1)) continue;
    if (k === 38 && !(b.bottom <= a.top + 1)) continue;
    if (k === 40 && !(b.top >= a.bottom - 1)) continue;
    /* the distance along the arrow counts once, the distance across it three times: the stop in line wins */
    d = k === 37 || k === 39 ? Math.abs(dx) + 3 * Math.abs(dy) : Math.abs(dy) + 3 * Math.abs(dx);
    if (d < bestD) {
      bestD = d;
      best = l[i];
    }
  }
  if (best)
    try {
      best.focus();
    } catch (e) {}
}

/* the state is drawn again only when something changed (no flicker, and the focus stays where it was) */
function sig() {
  var p = (S && S.phones) || [],
    s = [S && S.expireDays, live() ? S.pairing.code : '', S && S.listenError, S && S.url],
    i;
  for (i = 0; i < p.length; i++)
    s.push(p[i].id + ':' + (p[i].blocked ? 1 : 0) + (p[i].online ? 1 : 0) + ':' + Math.round((p[i].seen || 0) / 60000) + ':' + p[i].name);
  return s.join('|');
}
function poll() {
  api('/state', null, function (r) {
    if (!r || r.error) return;
    var had = live(),
      paired = r.pairing && r.pairing.paired,
      sc = r.scanned;
    S = r;
    if (paired && paired.at > pairFrom) {
      pairFrom = paired.at;
      toast(t(paired.name + ' paired'));
      api('/pair', { stop: true }, function (x) {
        if (x) S = x;
        shown = null;
        expired = false;
        SIG = '';
        render();
        /* the focus lands on the new card */
        var l = phones(),
          i;
        for (i = 0; i < l.length; i++) if (l[i].name === paired.name && focusKey('p:' + l[i].id)) return;
      });
      return;
    }
    /* a phone scanned the QR code: it leaves the screen at once. A phone that was already paired closed the window by connecting; a new
       one finishes on the phone, and the toast above says when it has paired. */
    if (had && !live() && !closing && (r.pairing || (sc && sc.at > pairFrom))) {
      if (sc && sc.at > pairFrom) pairFrom = sc.at;
      shown = null;
      expired = false;
      SIG = sig();
      render();
      toast(r.pairing ? t('Code scanned. Finish on the phone.') : t(sc.name + ' connected'));
      focusKey('pair');
      return;
    }
    /* the window was open on this page and closed without a phone: it expired (its time, or eight wrong codes) */
    if (had && !r.pairing && shown && !closing && !expired) return expire();
    if (live() && !closing) endAt = Date.now() + (r.pairing.seconds || 0) * 1000;
    if (sig() !== SIG) {
      SIG = sig();
      render();
    }
  });
}
function onKey(e) {
  var k = e.keyCode;
  /* Back: the confirm closes first, then the sheet, then the pairing on the stage, then the page (the launcher's, through the SDK) */
  if (k === 461 || k === 27 || k === 8) {
    if (dlg || picking || sheetId || live() || expired) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (dlg) closeDlg();
      else if (picking) closePick();
      else if (sheetId) closeSheet();
      else if (live()) stopPair();
      else {
        expired = false;
        shown = null;
        render();
        focusKey('pair');
      }
    }
    return;
  }
  if (k >= 37 && k <= 40) {
    e.preventDefault();
    move(k);
  }
}
function init() {
  $('pairbtn').onclick = pair;
  $('pairnew').onclick = pair;
  $('pairstop').onclick = function () {
    if (live()) stopPair();
    else {
      expired = false;
      shown = null;
      render();
      focusKey('pair');
    }
  };
  $('removeall').onclick = removeAll;
  $('expire').onclick = openPick;
  /* a focused card is always whole in view: the list slides by cards */
  document.addEventListener(
    'focus',
    function (e) {
      var i = indexOfKey((e.target && e.target.getAttribute && e.target.getAttribute('data-k')) || '');
      if (i >= 0) reveal(i);
    },
    true
  );
  $('portretry').onclick = function () {
    api('/state', {}, function (r) {
      if (!r || r.error) return fail(r);
      S = r;
      render();
      if (S.listenError) toast(t('The port is still busy.'));
    });
  };
  $('sheetaccess').onclick = function () {
    var p = byId(sheetId);
    if (p) allow(p);
  };
  $('sheetremove').onclick = function () {
    var p = byId(sheetId);
    if (p) removePhone(p);
  };
  $('sheetcancel').onclick = function () {
    closeSheet();
  };
  $('dlgcancel').onclick = closeDlg;
  $('dlgok').onclick = function () {
    if (dlg && dlg.run) dlg.run();
  };
  document.addEventListener('keydown', onKey, true);
  api('/state', null, function (r) {
    if (!r) return fail(r);
    if (r.error) return toast(r.error);
    S = r;
    SIG = sig();
    render();
    focusKey('pair');
  });
  setInterval(poll, 2000);
}
init();
