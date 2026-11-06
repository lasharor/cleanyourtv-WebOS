var kFlow = 'input',
  kText = '',
  kRows = [],
  kTimer = 0,
  upd = null,
  checkedOffline = false,
  forceOffer = false,
  API = 'http://127.0.0.1:8765',
  SVC = '/media/developer/apps/usr/palm/services/com.cleanyourtv.manager.service';
var napi = null,
  mnet = null /* MCP on the network (/api/mcp/lan) */,
  ad = {
    installed: [],
    catalog: [],
    repos: [],
    reposOk: false,
    repoSel: '',
    pend: null,
    error: '',
    sel: '',
    book: { order: [], hidden: [], strip: true },
  },
  lv = null,
  wp = null,
  ab = null,
  abl = [],
  vo = null,
  mdl = [],
  agl = [],
  tst = null,
  shareMode = 'log',
  pairBase = 0,
  idxStack = [],
  setupIdx = 0,
  updIdx = 0,
  st = null,
  rows = [],
  idx = 0,
  view = 'main',
  tab = 0,
  wantTab = -1 /* a tab to turn to when the status has arrived (opened with {open: 'addons'}) */,
  pending = null,
  pollT = 0,
  setup = { debloat: true, inputKey: true },
  offline = false,
  busyMsg = '';
/* the main screen: the tabs across the top, the options of the chosen tab in the list below (Left and Right turn the tabs) */
var TABS = [
  { id: 'updates', label: 'Updates & Home' },
  { id: 'features', label: 'Features' },
  { id: 'addons', label: 'Add-ons' },
  { id: 'debloat', label: 'Debloat' },
  { id: 'system', label: 'System' },
];
function $(i) {
  return document.getElementById(i);
}
function api(p, body, ms) {
  return new Promise(function (res, rej) {
    var x = new XMLHttpRequest();
    x.open(body ? 'POST' : 'GET', API + p);
    x.timeout = ms || 30000;
    x.onload = function () {
      try {
        res(JSON.parse(x.responseText));
      } catch (e) {
        rej(e);
      }
    };
    x.onerror = x.ontimeout = function () {
      rej(new Error('no answer'));
    };
    x.send(body ? JSON.stringify(body) : null);
  });
}
function rootExec(cmd) {
  return new Promise(function (res) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (m) {
        res(m);
      };
      b.call('luna://org.webosbrew.hbchannel.service/exec', JSON.stringify({ command: cmd }));
    } catch (e) {
      res(JSON.stringify({ returnValue: false, errorText: String(e) }));
    }
  });
}
function launch(id, params) {
  try {
    var b = new PalmServiceBridge();
    b.onservicecallback = function () {};
    b.call('luna://com.webos.applicationManager/launch', JSON.stringify({ id: id, params: params || {} }));
  } catch (e) {}
}
function onoff(v) {
  return v ? 'On' : 'Off';
}
var bannerAt = 0; // when the banner was last set: one left from an earlier action is cleared when the screen changes
function banner(text, cls) {
  var b = $('banner');
  bannerAt = Date.now();
  b.textContent = tr(text || '');
  b.className = cls || '';
  b.style.display = text ? '' : 'none';
}

// a banner set by the action that changes the screen stays (a result such as "Model: …"); an older one belongs to the screen left
function staleBanner() {
  if (Date.now() - bannerAt > 1000) banner('');
}
function push(v) {
  staleBanner();
  idxStack.push([view, idx]);
  view = v;
  idx = 0;
  build();
  draw();
} // into a screen; pop returns to the row we left
function pop() {
  staleBanner();
  var p = idxStack.pop() || ['main', 0];
  view = p[0];
  idx = p[1];
  build();
  draw();
}
