/* ---------- the clock and dates follow the language (the TV's, or the manager's Language setting; text: i18n/runtime.js) ---------- */
var LOC_TV = (window.webOSSystem && webOSSystem.locale) || navigator.language || 'en-GB',
  LOC = LOC_TV;
/* the Language setting from the service's settings: '' follows the TV */
function useLang(code) {
  var loc = code ? code : LOC_TV;
  setLang(code || '');
  if (loc === LOC) return;
  LOC = loc;
  if (window.tick) tick(); /* the date in the new language at once, not at the next quarter minute */
}
/* a button's label: built-in buttons and the add-ons' buttons are translated (an add-on's name comes in English from its addon.json),
   buttons you added keep the app's own name */
function barLabel(o) {
  return o.action === 'inputs'
    ? t('Inputs')
    : o.action === 'bluetooth'
      ? t('Bluetooth')
      : o.app === 'com.palm.app.settings'
        ? t('Settings')
        : o.action === 'poweroff'
          ? t('Power off')
          : o.app === 'com.webos.app.livetv'
            ? t('TV') /* LG's own Live TV, the tuner */
            : o.action === 'customize'
              ? t('Customise')
              : o.action === 'live'
                ? t('Live TV')
                : o.action === 'addon'
                  ? t(o.label || '')
                  : o.label || '';
}
function clockOpts() {
  var c = cfg.clock,
    o = { hour: 'numeric', minute: '2-digit' };
  if (c === '24') {
    o.hourCycle = 'h23';
  } else if (c === '12') {
    o.hourCycle = 'h12';
    o.hour = 'numeric';
  }
  return o;
}

var apps = [],
  cfg = {},
  usage = {},
  warned = false,
  rows = [],
  r = 1,
  c = 0,
  colors = {},
  tiles = {},
  lastSig = '',
  tunerOn = false,
  iconsOn = false /* the App icons add-on runs (helper/addons-bundled/icons): a tile's menu offers Change icon */,
  gSide = 0,
  gColor = '',
  gT = 0,
  saveT = 0;
function $(id) {
  return document.getElementById(id);
}
var toastT;
/* a short message at the bottom; an error stays twice as long, so its next step can be read from the couch */
function toast(t, err) {
  var e = $('toast');
  e.textContent = t;
  e.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(
    function () {
      e.classList.remove('on');
    },
    err ? 8000 : 4000
  );
}
var MIN_SERVICE = '1.4.3';
function oldSvc(v) {
  var a = String(v).split('.'),
    b = MIN_SERVICE.split('.');
  for (var i = 0; i < 3; i++) {
    var x = +a[i] || 0,
      y = +b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}
function api(p, body) {
  return fetch(API + p, body ? { method: 'POST', body: JSON.stringify(body) } : {}).then(function (x) {
    return x.json();
  });
}
/* one line in the service log (Share log shows it); nothing waits for it */
function logLine(m) {
  try {
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/log?m=' + encodeURIComponent(m));
    x.send();
  } catch (e) {}
}
/* a timing for tools/perf-tv.sh ("perf launcher ready 412") */
function perfMark(m) {
  logLine('perf ' + m);
}
var perfReady = false;
function launch(id, params) {
  if (id === '__live') return LIVE.enter();
  api('/api/launch', { id: id, params: params }).then(function (x) {
    if (x && x.returnValue === false) toast(t('Could not open %s. Is it still installed?').replace('%s', title(id)), true);
  });
}
function store() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ apps: apps, cfg: cfg, usage: usage, colors: colors }));
  } catch (e) {}
}
function storeSoon() {
  clearTimeout(saveT);
  saveT = setTimeout(store, 1500);
}
