// The phone page for the add-on repositories (manager > Add-ons > Repositories > Add from your phone): typing an address with the
// remote is no fun, so the TV shows a code and a QR code and this page takes the address. Short-lived, on the LAN, plain HTTP like the
// other phone pages (docs/security.md); every request carries the code shown on the TV in the header x-code.
const http = require('http');
const crypto = require('crypto');

const PORT = 8799,
  OPEN_MS = 10 * 60 * 1000;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add-on repositories</title>
<style>
body{font-family:sans-serif;margin:0;padding:16px;background:#111;color:#eee;max-width:560px}
h1{font-size:20px}input[type=text]{width:100%;box-sizing:border-box;padding:12px;font-size:16px;margin:4px 0 12px;border-radius:6px;border:1px solid #555;background:#222;color:#eee}
button{padding:12px 16px;font-size:16px;border-radius:6px;border:0;background:#3b82f6;color:#fff}
button.x{background:#555;padding:6px 10px;font-size:14px}.w{background:#3a2a10;border:1px solid #a66;padding:10px;border-radius:6px;font-size:14px;margin:12px 0}
li{margin:8px 0;word-break:break-all}small{color:#999}#m{margin:12px 0;min-height:1.2em}
</style></head><body><h1>Add-on repositories</h1>
<ul id="l"></ul>
<label>Address<br><input type="text" id="a" placeholder="user/repo   or   user/repo@branch   or   https://..." autocapitalize="off" autocorrect="off"></label>
<label>Name (optional)<br><input type="text" id="n" autocapitalize="off" autocorrect="off"></label>
<div class="w"><label><input type="checkbox" id="t"> I know that add-ons from this repository can run code as root on my TV, and I trust its author.</label></div>
<button id="go">Add</button><div id="m"></div>
<script>
var code = decodeURIComponent((location.hash || '').slice(1));
function api(p, b) {
  return fetch('/api/' + p, { method: b ? 'POST' : 'GET', headers: { 'x-code': code, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
    .then(function (r) { return r.json(); });
}
function msg(t) { document.getElementById('m').textContent = t; }
function show(r) {
  if (r.error) return msg(r.error);
  var l = document.getElementById('l'); l.innerHTML = '';
  r.repos.forEach(function (x) {
    var li = document.createElement('li'), b = document.createElement('button');
    li.appendChild(document.createTextNode(x.name + ' '));
    var s = document.createElement('small'); s.textContent = x.url; li.appendChild(s);
    if (!x.official) { b.className = 'x'; b.textContent = 'Remove'; b.onclick = function () { api('remove', { name: x.name }).then(function (q) { if (q.error) msg(q.error); else show(q); }); }; li.appendChild(document.createTextNode(' ')); li.appendChild(b); }
    l.appendChild(li);
  });
}
if (!code) { code = prompt('The code shown on the TV') || ''; }
api('repos').then(show);
document.getElementById('go').onclick = function () {
  msg('Adding...');
  api('add', { add: document.getElementById('a').value, name: document.getElementById('n').value, confirm: document.getElementById('t').checked }).then(function (r) {
    if (r.error) return msg(r.confirm ? 'Tick the box to confirm.' : r.error);
    msg('Added ' + r.added + '. Install its add-ons on the TV: Add-ons.'); document.getElementById('a').value = ''; show(r);
  });
};
</script></body></html>`;

// deps: {list(): [{name, url, official}], add(spec, name, confirm), remove(name), lanIp()}
function create(deps) {
  let open = null;
  function stop() {
    if (!open) return;
    clearTimeout(open.timer);
    try {
      open.srv.close();
    } catch (_) {}
    open = null;
  }
  const readBody = req =>
    new Promise(resolve => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > 8192) req.destroy();
        else b.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(b).toString('utf8') || '{}'));
        } catch (_) {
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });
  async function handle(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGE);
    }
    if (u.indexOf('/api/') !== 0) {
      res.writeHead(404);
      return res.end();
    }
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stop();
      return json({ error: 'wrong code' }, 403);
    }
    if (req.method === 'GET' && u === '/api/repos') return json({ repos: deps.list() });
    if (req.method !== 'POST') return json({ error: 'not found' }, 404);
    const b = await readBody(req);
    if (u === '/api/add') {
      const r = deps.add(String(b.add || ''), b.name, b.confirm === true);
      return json(r, r.error ? 400 : 200);
    }
    if (u === '/api/remove') {
      const r = deps.remove(String(b.name || ''));
      return json(r, r.error ? 400 : 200);
    }
    return json({ error: 'not found' }, 404);
  }
  // {url, code, qr, seconds} like every phone page, or {} for {stop: true}
  function start(o) {
    stop();
    if (o && o.stop) return Promise.resolve({});
    const code = String(100000 + (crypto.randomBytes(4).readUInt32BE(0) % 900000));
    let bad = 0;
    const srv = http.createServer((req, res) => {
      handle(req, res, code, () => ++bad).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    open = { srv, timer: setTimeout(stop, OPEN_MS) };
    const url = 'http://' + deps.lanIp() + ':' + PORT;
    return new Promise(resolve => {
      srv.on('error', e => {
        stop();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PORT, '0.0.0.0', () => resolve({ url, code, qr: url + '/#' + code, seconds: OPEN_MS / 1000 }));
    });
  }
  return { start, stop, handle };
}

module.exports = { create, PORT };
