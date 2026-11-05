/* The phone remote's page on the TV: pair a phone (a QR code and a 6-digit code), the paired phones, and when unused ones are removed.
   It is a page of the launcher's book: the launcher gives it the focus, Back closes it (the SDK script at the end of the page posts
   that to the launcher), and the number and colour buttons stay the launcher's. ES5, Chromium 68: no arrow functions, no template
   literals, no flex gap. The service is at /api/addons/phoneremote (the loader passes what follows to the add-on's handle). */
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
  confirmKey = '',
  confirmT = 0,
  neverAsk = 0,
  neverT = 0,
  busy = false;

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
/* "7 min ago", "3 h ago", "2 days ago": the number is put in first, so the language's plural form follows it */
function ago(at) {
  if (!at) return t('never');
  var m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return t('just now');
  if (m < 60) return t(m + ' min ago');
  if (m < 1440) return t(Math.round(m / 60) + ' h ago');
  return t(Math.round(m / 1440) + ' days ago');
}
function state(p) {
  return p.blocked ? t('blocked') : p.online ? t('connected') : t('last used ' + ago(p.seen));
}
/* a remove button asks once: the same button again within five seconds does it */
function ask(key) {
  if (confirmKey === key) {
    confirmKey = '';
    clearTimeout(confirmT);
    return true;
  }
  confirmKey = key;
  clearTimeout(confirmT);
  confirmT = setTimeout(function () {
    confirmKey = '';
    render();
  }, 5000);
  render();
  return false;
}
function removePhone(id) {
  if (!ask('p' + id)) return;
  api('/revoke', { id: id }, function (r) {
    if (!r) return fail(r);
    S = r;
    toast(t('Phone removed'));
    render();
  });
}
function removeAll() {
  if (!ask('all')) return;
  api('/revoke', { all: true }, function (r) {
    if (!r) return fail(r);
    S = r;
    toast(t('All phones removed'));
    render();
  });
}
function allow(id, blocked) {
  api('/access', { id: id, allow: blocked }, function (r) {
    if (!r) return fail(r);
    S = r;
    toast(blocked ? t('Phone allowed') : t('Phone blocked'));
    render();
  });
}
/* the pairing window: open while the TV shows the code, closed when the page leaves it or a phone has paired */
function pair() {
  if (busy) return;
  busy = true;
  api('/pair', {}, function (r) {
    busy = false;
    if (!r) return fail(r);
    S = r;
    pairFrom = Date.now();
    SIG = '';
    render();
    focusFirst();
  });
}
function stopPair() {
  api('/pair', { stop: true }, function (r) {
    if (r) S = r;
    SIG = '';
    render();
    focusFirst();
  });
}
var EXPIRES = [
  [1, '1 day'],
  [3, '3 days'],
  [7, '1 week'],
  [14, '2 weeks'],
  [30, '1 month'],
  [0, 'Never'],
];
function setExpire(days) {
  /* "Never" is not recommended: the first choice warns, the same choice again keeps every phone */
  if (days === 0 && !neverAsk) {
    neverAsk = 1;
    clearTimeout(neverT);
    neverT = setTimeout(function () {
      neverAsk = 0;
    }, 6000);
    toast(t('A phone that is lost or sold would control the TV for ever. Choose Never again to keep every phone.'));
    return;
  }
  neverAsk = 0;
  api('/state', { expireDays: days }, function (r) {
    if (!r) return fail(r);
    if (r.error) return toast(r.error);
    S = r;
    toast(t('Saved'));
    render();
  });
}
function drawQr(text) {
  try {
    var q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    var n = q.getModuleCount(),
      cell = Math.max(3, Math.floor(320 / (n + 8))),
      cv = $('qr'),
      size = cell * (n + 8),
      g,
      r,
      c;
    cv.width = cv.height = size;
    g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000';
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
  } catch (e) {
    /* no QR code: the address and the code are on the page anyway */
  }
}
function renderPhones() {
  var box = $('phonelist'),
    list = (S && S.phones) || [],
    i,
    p,
    row,
    who,
    acts,
    b;
  box.textContent = '';
  $('phcount').textContent = list.length ? ' ' + list.length : '';
  if (!list.length) box.appendChild(el('p', 'hint', t('No phone is paired yet.')));
  for (i = 0; i < list.length; i++) {
    p = list[i];
    row = el('div', 'phone');
    who = el('div', 'who');
    who.appendChild(el('b', '', p.name));
    who.appendChild(el('span', 'st' + (p.online ? ' on' : '') + (p.blocked ? ' no' : ''), state(p)));
    acts = el('div', 'acts');
    b = el('button', '', p.blocked ? t('Allow') : t('Block'));
    b.setAttribute('data-k', 'allow:' + p.id);
    b.onclick = (function (id, blocked) {
      return function () {
        allow(id, blocked);
      };
    })(p.id, !!p.blocked);
    acts.appendChild(b);
    b = el('button', 'danger', confirmKey === 'p' + p.id ? t('Yes, remove') : t('Remove'));
    b.setAttribute('data-k', 'remove:' + p.id);
    b.onclick = (function (id) {
      return function () {
        removePhone(id);
      };
    })(p.id);
    acts.appendChild(b);
    row.appendChild(who);
    row.appendChild(acts);
    box.appendChild(row);
  }
}
function renderExpire() {
  var box = $('expire'),
    cur = S && S.expireDays !== undefined ? S.expireDays : 14,
    i;
  box.textContent = '';
  for (i = 0; i < EXPIRES.length; i++)
    (function (days, label) {
      var b = el('button', cur === days ? 'on' : '', t(label));
      b.setAttribute('data-k', 'exp:' + days);
      b.onclick = function () {
        setExpire(days);
      };
      box.appendChild(b);
    })(EXPIRES[i][0], EXPIRES[i][1]);
}
function render() {
  if (!S) return;
  var p = S.pairing,
    act = document.activeElement,
    dk = act && act.getAttribute ? act.getAttribute('data-k') : '';
  $('pairbtn').className = p ? 'pri wide hide' : 'pri wide';
  $('pairsheet').className = p ? '' : 'hide';
  if (p) {
    $('pairurl').textContent = p.url || '';
    $('codebox').textContent = String(p.code || '')
      .split('')
      .join(' ');
    $('pairnote').textContent = p.seconds ? '' : t('The pairing window closed.');
    if (p.qr && p.qr !== qrFor) {
      qrFor = p.qr;
      drawQr(p.qr);
    }
  } else qrFor = '';
  $('removeall').className = 'ghost' + ((S.phones || []).length ? '' : ' dim');
  renderPhones();
  renderExpire();
  trDom();
  if (!focusKey(dk)) focusFirst();
}
function trDom() {
  var n = document.querySelectorAll('[data-t]'),
    i;
  for (i = 0; i < n.length; i++) n[i].textContent = t(n[i].getAttribute('data-t'));
}
function focusables() {
  var all = document.querySelectorAll('button'),
    out = [],
    i;
  for (i = 0; i < all.length; i++) if (all[i].offsetParent !== null && !all[i].disabled) out.push(all[i]);
  return out;
}
function focusKey(k) {
  var n, i;
  if (!k) return false;
  n = document.querySelectorAll('[data-k="' + k + '"]');
  for (i = 0; i < n.length; i++)
    if (n[i].offsetParent !== null) {
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
/* the state is drawn again only when something changed (no flicker, and the focus stays where it was) */
function sig() {
  var p = (S && S.phones) || [],
    s = [S && S.expireDays, S && S.pairing ? S.pairing.code : '', confirmKey],
    i;
  for (i = 0; i < p.length; i++)
    s.push(p[i].id + ':' + (p[i].blocked ? 1 : 0) + (p[i].online ? 1 : 0) + ':' + Math.round((p[i].seen || 0) / 60000) + ':' + p[i].name);
  return s.join('|');
}
function poll() {
  api('/state', null, function (r) {
    if (!r || r.error) return;
    var was = S,
      paired = r.pairing && r.pairing.paired;
    S = r;
    if (paired && paired.at > pairFrom) {
      pairFrom = paired.at;
      toast(t('Paired: ' + paired.name));
      stopPair();
      return;
    }
    if (sig() !== SIG) {
      SIG = sig();
      render();
    }
  });
}
function onKey(e) {
  var k = e.keyCode,
    l,
    at;
  /* Back: the pairing window closes first, then the page (that is the launcher's, through the SDK's own Back) */
  if (k === 461 || k === 27 || k === 8) {
    if (S && S.pairing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      stopPair();
      return;
    }
    if (confirmKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      confirmKey = '';
      render();
    }
    return;
  }
  if (k >= 37 && k <= 40) {
    l = focusables();
    if (!l.length) return;
    at = -1;
    for (var i = 0; i < l.length; i++) if (l[i] === document.activeElement) at = i;
    if (k === 37 || k === 38) at = at <= 0 ? l.length - 1 : at - 1;
    else at = at < 0 || at === l.length - 1 ? 0 : at + 1;
    e.preventDefault();
    l[at].focus();
  }
}
function init() {
  $('pairbtn').onclick = pair;
  $('pairstop').onclick = stopPair;
  $('removeall').onclick = removeAll;
  document.addEventListener('keydown', onKey, true);
  api('/state', null, function (r) {
    if (!r) return fail(r);
    if (r.error) return toast(r.error);
    S = r;
    SIG = sig();
    render();
    focusFirst();
  });
  setInterval(poll, 2000);
}
init();
