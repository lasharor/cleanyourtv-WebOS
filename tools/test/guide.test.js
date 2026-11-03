// The tuner guide page (guide/app/index.html): its own script runs here against the real service module (helper/tunerguide.js) with a
// stand-in for the TV's services and a small stand-in for the page (no browser): channels and the schedule of the rows in view are
// asked for, the rows are drawn, the remote's keys move and choose, choosing tunes LG's Live TV the way LG's guide does, Back closes.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { ok, req, run } = require('./lib');
const tg = req('tunerguide');

const NAMES = { channelId: 0, signalChannelId: 2, channelMode: 4, channelNumber: 8, majorNumber: 9, minorNumber: 10, channelName: 11 };
const rows = [];
for (let i = 0; i < 20; i++) {
  const r = new Array(14).fill('');
  r[0] = '3_' + i;
  r[2] = 'id' + i;
  r[4] = 'Cable';
  r[8] = String(i + 1);
  r[9] = i + 1;
  r[10] = i + 1;
  r[11] = 'Channel ' + (i + 1);
  rows.push(r);
}
const stamp = s => {
  const d = new Date(s * 1000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(',');
};
const base = Math.floor(Date.now() / 1000 / 1800) * 1800 - 3 * 3600;
const all = [];
for (let i = 0; i < 20; i++)
  for (let k = 0; k < 40; k++)
    all.push({
      signalChannelId: 'id' + i,
      startTime: stamp(base + k * 3600),
      endTime: stamp(base + (k + 1) * 3600),
      programName: 'Show ' + i + '-' + k,
      description: 'About ' + k,
      genre: 'News',
    });
const asked = [];
let nowOn = ''; // the channel the TV is on (LG's own id)
const luna = async (uri, p) => {
  if (uri.indexOf('getLastChannelId') > 0) return nowOn ? { returnValue: true, channelId: nowOn } : { returnValue: false };
  if (uri.indexOf('getChannelList') > 0) return { returnValue: true, names: NAMES, values: rows };
  const q = p.query;
  let a = all.filter(x => !q.where || x.signalChannelId === q.where[0].val);
  if (q.from.indexOf('programPF') > 0) a = [];
  if (q.where) asked.push(q.where[0].val);
  const at = q.page ? +q.page : 0;
  const r = { returnValue: true, results: a.slice(at, at + q.limit) };
  if (at + q.limit < a.length) r.next = String(at + q.limit);
  return r;
};

// just enough of a page: elements with an id, a class list, children, innerHTML and text
class El {
  constructor(id) {
    this.id = id || '';
    this.className = '';
    this.style = {};
    this.innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
  }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  replaceChild(n, o) {
    n.parentNode = this;
    this.children = this.children.map(c => (c === o ? n : c));
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  get html() {
    const inner = this.innerHTML + this.children.map(c => c.html).join('');
    return this.className ? '<div class="' + this.className + '">' + inner + '</div>' : inner;
  }
}

run(async () => {
  const g = tg.create({}, { luna });
  const els = {},
    logs = [],
    posts = [],
    handlers = {};
  // the rows container sits in a parent, as in the page, so that replaceChild works
  const grid = new El('grid');
  els.rows = grid.appendChild(new El('rows'));
  const byId = id => {
    if (id === 'rows') return grid.children[0]; // the page swaps the element for a new one
    return els[id] || (els[id] = new El(id));
  };
  const document = {
    getElementById: byId,
    createElement: () => new El(''),
    createDocumentFragment: () => new El(''),
    addEventListener: (n, f) => (handlers[n] = f),
    body: { classList: { add() {}, remove() {} } },
    documentElement: {},
  };
  function XHR() {}
  XHR.prototype.open = function (m, u) {
    this.m = m;
    this.u = u;
  };
  XHR.prototype.send = function (b) {
    const u = this.u.replace('http://127.0.0.1:8765', '');
    const done = (code, body) => {
      this.status = code;
      this.responseText = body;
      setTimeout(() => this.onload && this.onload(), 0);
    };
    if (u.indexOf('/api/log') === 0) {
      logs.push(decodeURIComponent(u.split('m=')[1]));
      return done(200, '{}');
    }
    if (u.indexOf('/api/launch') === 0) {
      posts.push(JSON.parse(b));
      return refuse ? done(403, '{"error":"origin not allowed"}') : done(200, '{"returnValue":true}');
    }
    const out = { code: 0, body: '' };
    g.handle(
      { url: u },
      {
        writeHead(c) {
          out.code = c;
        },
        end(s) {
          out.body = s;
        },
      },
      u.split('?')[0]
    ).then(
      () => done(out.code, out.body),
      () => done(500, '{}')
    );
  };
  let closed = false,
    refuse = false,
    bridge = [];
  const win = {
    document,
    addEventListener() {},
    close: () => (closed = true),
    webOSSystem: { launchParams: '{}', locale: 'en-US' },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { language: 'en-US' },
    XMLHttpRequest: XHR,
    PalmServiceBridge: function () {
      this.call = (u, p) => bridge.push([u, JSON.parse(p)]);
    },
    setTimeout: (f, ms) => (ms > 5000 ? 0 : setTimeout(f, ms)),
    setInterval: () => 0,
    clearTimeout: x => x && clearTimeout(x),
    clearInterval() {},
    console,
    Date,
    JSON,
    Math,
    String,
    Array,
  };
  // as in a browser: window is the global itself, and window.top cannot be assigned (a script's own 'var top' would stay the window)
  win.window = win;
  Object.defineProperty(win, 'top', { value: win, writable: false });
  vm.createContext(win);
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'guide', 'app', 'index.html'), 'utf8');
  const scripts = html.match(/<script>([\s\S]*?)<\/script>/g);
  ok(scripts && scripts.length === 1, 'the guide has one script');
  vm.runInContext(scripts[0].replace(/^<script>|<\/script>$/g, ''), win);
  const key = k => handlers.keydown({ keyCode: k, preventDefault() {} });
  const until = async (f, ms) => {
    for (let t = 0; t < (ms || 3000); t += 20) {
      if (f()) return true;
      await new Promise(r => setTimeout(r, 20));
    }
    return false;
  };
  const rowsHtml = () => byId('rows').html;

  ok(await until(() => /Show 0-/.test(rowsHtml())), 'the rows show the first channel and its programmes');
  ok((rowsHtml().match(/class="row/g) || []).length === 7, 'seven rows are drawn, not all twenty channels');
  ok(/class="row sel"><div class="cell" data-i="0"/.test(rowsHtml()), 'the first channel is selected');
  ok(
    /class="prog[^"]* f"/.test(rowsHtml()) && byId('ititle').textContent.indexOf('Show 0-') === 0,
    'a programme is selected and described'
  );
  ok(await until(() => asked.length >= 7), 'the schedule is asked for the channels in view (' + asked.length + ')');
  ok(asked.length <= 13 && asked.length < 20, 'not for all the channels (' + asked.length + ')');
  const t0 = byId('ititle').textContent;
  key(39);
  ok(byId('ititle').textContent !== t0 && /Show 0-/.test(byId('ititle').textContent), 'Right moves to the next programme');
  key(40);
  ok(
    /class="row sel"><div class="cell" data-i="1"/.test(rowsHtml()) && /Channel 2/.test(byId('imeta').textContent),
    'Down selects the next channel'
  );
  key(38);
  key(38);
  ok(/class="row sel"><div class="cell" data-i="19"/.test(rowsHtml()), 'Up from the first channel goes round to the last');
  key(40);
  key(13);
  ok(await until(() => posts.length === 1), 'OK tunes');
  ok(
    posts[0].id === 'com.webos.app.livetv' &&
      posts[0].params.id === 'channelChange' &&
      posts[0].params.channelId === '3_0' &&
      posts[0].params.sender === 'livemenu',
    "LG's Live TV is started with LG's own channel id, the way LG's guide does it: " + JSON.stringify(posts[0])
  );
  ok(await until(() => logs.some(l => /^guide close/.test(l))), 'the guide asks the service to close it after tuning');
  logs.length = 0;
  handlers.webOSRelaunch(); // the Guide key again: the app is started, shown
  key(461);
  ok(logs.some(l => /^guide close/.test(l)) && closed, 'Back closes the guide');
  // the service refuses the launch (as it did for an app it did not know): the system's bridge launches Live TV instead
  refuse = true;
  handlers.webOSRelaunch();
  key(40);
  key(13);
  ok(await until(() => bridge.length === 1), 'a refused launch falls back to the system bridge');
  ok(
    bridge[0][0] === 'luna://com.webos.applicationManager/launch' && bridge[0][1].params.channelId === '3_1',
    'the same Live TV launch, with the selected channel: ' + JSON.stringify(bridge[0])
  );
  // the number buttons dial a channel
  refuse = false;
  ok(await until(() => win.shown === false), 'the guide is closed after tuning');
  handlers.webOSRelaunch();
  ok(await until(() => win.shown === true), 'the Guide key shows it again');
  key(49);
  key(53);
  ok(
    byId('dial').textContent === '15' && /class="row sel"><div class="cell" data-i="14"/.test(rowsHtml()),
    'typing 1 5 selects channel 15, and the number is shown'
  );
  key(55);
  ok(
    byId('dial').textContent === '157' && /class="row sel"><div class="cell" data-i="14"/.test(rowsHtml()),
    'a number with no channel leaves the selection where it was'
  );
  key(98);
  ok(byId('dial').textContent === '1572', 'the numeric pad works too, up to four digits');
  key(98);
  ok(
    byId('dial').textContent === '2' && /class="row sel"><div class="cell" data-i="1"/.test(rowsHtml()),
    'a fifth digit starts a new number'
  );
  ok(await until(() => byId('dial').textContent === '', 3000), 'the typed number is forgotten after a moment');
  // on open the channel that is on now is selected, with the programme on now
  key(461);
  ok(await until(() => win.shown === false), 'Back closes it');
  nowOn = '3_7';
  handlers.webOSRelaunch();
  ok(await until(() => /class="row sel"><div class="cell" data-i="7"/.test(rowsHtml())), 'on open the channel that is on now is selected');
  ok(byId('ititle').textContent === 'Show 7-3', 'and so is the programme on now: ' + byId('ititle').textContent);
});
