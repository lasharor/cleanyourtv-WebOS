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
  mtools = null /* the tool settings (/api/mcp/tools) */,
  mtOpen = {} /* the groups open on the Tools screen */,
  mcpSel = null /* the agent on the Manage screen */,
  mcpAsk = null /* the confirm on screen: {title, about, yes, body, done, back} */,
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
/* "5 min ago", "3 h ago", "2 days ago": when an agent was last used */
function mcpAgo(t) {
  var m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 48 * 60) return Math.round(m / 60) + ' h ago';
  return Math.round(m / 1440) + ' days ago';
}
/* a span of time in days: "1 day", "2 weeks", "1 month" */
function mcpDays(ms) {
  var d = Math.max(1, Math.round(ms / 864e5));
  if (d === 30) return '1 month';
  if (d % 7 === 0) return d / 7 + (d === 7 ? ' week' : ' weeks');
  return d + (d === 1 ? ' day' : ' days');
}
/* the MCP screens follow changes made elsewhere while they are on screen (a device that pairs, logs out, is removed by the hourly sweep):
   every three seconds, and only while one of them is displayed and the app is visible, the state is read again and the screen is
   redrawn when it changed; the focused row stays where it was. Leaving those screens stops the timer. */
var mcpLiveTimer = 0,
  mcpLiveViews = ['mcpnet', 'mcpdevices', 'mcpagent', 'mcptools'];
function mcpLiveStop() {
  if (mcpLiveTimer) clearInterval(mcpLiveTimer);
  mcpLiveTimer = 0;
}
function mcpLive() {
  if (mcpLiveTimer) return;
  mcpLiveTimer = setInterval(function () {
    if (mcpLiveViews.indexOf(view) < 0) return mcpLiveStop();
    if (document.hidden) return; /* behind another app: nothing to show */
    /* the Tools screen: a new tool that appears (an add-on updated, a source approved) shows with its New badge */
    if (view === 'mcptools') {
      api('/api/mcp/tools').then(
        function (t) {
          if (view !== 'mcptools' || document.hidden || !t || t.error || JSON.stringify(t) === JSON.stringify(mtools)) return;
          var was = rows[idx] && rows[idx].label;
          mtools = t;
          build();
          mtRefocus(was);
          draw();
        },
        function () {}
      );
      return;
    }
    api('/api/mcp/lan').then(
      function (n) {
        if (mcpLiveViews.indexOf(view) < 0 || document.hidden || !n || n.error) return;
        var key = function (x) {
          return JSON.stringify([
            x && x.lan,
            x && x.listening,
            x && x.error,
            x && x.expireDays,
            ((x && x.agents) || []).map(function (a) {
              return [a.id, a.name, a.blocked, a.active, Math.floor((Date.now() - a.seen) / 60000)];
            }),
          ]);
        };
        if (key(n) === key(mnet)) return;
        var was = rows[idx] && rows[idx].label;
        mnet = n;
        build();
        /* keep the focus on the same row when it is still there, else on the nearest one */
        var i = -1;
        for (var k = 0; k < rows.length; k++) if (rows[k].label === was && !rows[k].sep) i = k;
        idx = i >= 0 ? i : Math.min(idx, rows.length - 1);
        while (idx > 0 && rows[idx] && rows[idx].sep) idx--;
        draw();
      },
      function () {}
    );
  }, 3000);
}
