// The phone page for the add-on repositories (manager > Add-ons > Repositories > Add from your phone): typing an address with the
// remote is no fun, so the TV shows a code and a QR code and this page takes the address. Short-lived, on the LAN, plain HTTP like the
// other phone pages (docs/security.md); every request carries the code shown on the TV in the header x-code. In the phone's language
// (i18n.js), like the other phone pages.
const http = require('http');
const crypto = require('crypto');
const i18n = require('./i18n');
const web = require('./web');

const PORT = 8800,
  OPEN_MS = 10 * 60 * 1000;

// plain script for iOS Safari and Android Chrome; t() is set up by i18n.script
const PHONE_JS = `var code='',$=function(i){return document.getElementById(i)};
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function msg(s,e){$('msg').innerHTML=s?'<p class="m'+(e?' e':'')+'"></p>':'';if(s)$('msg').firstChild.textContent=s}
function showLogin(s){$('login').className='';$('main').className='hide';$('sum').textContent=s||''}
function show(r){var l=$('l');l.innerHTML='';(r.repos||[]).forEach(function(x){var li=document.createElement('li');li.appendChild(document.createTextNode(x.name+' '));
 var s=document.createElement('small');s.textContent=x.url;li.appendChild(s);
 if(!x.official){var b=document.createElement('button');b.className='x';b.textContent=t('Remove');b.onclick=function(){api('remove',{name:x.name}).then(function(q){if(q.error)msg(t(q.error),1);else show(q)})};li.appendChild(b)}
 l.appendChild(li)})}
function state(){return api('repos').then(function(r){$('login').className='hide';$('main').className='';$('sum').textContent='';show(r)})}
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
$('add').onclick=function(){if(!$('t').checked)return msg(t('Tick the box to confirm.'),1);msg(t('Adding…'));
 api('add',{add:$('a').value,name:$('n').value,confirm:true}).then(function(r){if(r.error)return msg(t(r.error),1);msg(t('Added %s. Install its add-ons on the TV: Add-ons.').replace('%s',r.added));$('a').value='';$('t').checked=false;show(r)},function(e){msg(e.error,1)})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;

function page(lang) {
  const T = s => web.esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${T('Add-on repositories')}</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input[type=text]{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0}
button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}button.x{width:auto;display:inline-block;padding:6px 12px;margin:0 0 0 8px}
label{display:block;color:#aaa;margin:12px 0 0;font-size:15px}.w{background:#3a2a10;border:1px solid #a66;padding:12px 14px;border-radius:12px;font-size:15px;margin:16px 0;color:#eee}
.w li{margin:6px 0}.w label{color:#eee;margin:10px 0 0}.hide{display:none}li{word-break:break-all}small{color:#999}[dir=rtl] body{text-align:right}</style>
<h1>${T('Add-on repositories')}</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input type=text id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide><ul id=l></ul>
<label>${T('Address')}<input type=text id=a placeholder="user/repo   |   user/repo@branch   |   https://…" autocapitalize=off autocorrect=off></label>
<label>${T('Name (optional)')}<input type=text id=n autocapitalize=off autocorrect=off></label>
<div class=w><b>${T('Read this before you add a repository')}</b><ul>
<li>${T('The code of an add-on runs as root on the TV and can read and change anything on it and on your network.')}</li>
<li>${T('The checksum only shows that a file is the one the repository published. It does not show that its author is trustworthy.')}</li>
<li>${T('Only continue for people and projects you trust. The CleanYourTV project has not reviewed these add-ons.')}</li>
<li>${T('Every repository is contacted whenever the add-ons list or a picture is opened, so its operator sees the TV’s address.')}</li></ul>
<label><input type=checkbox id=t> ${T('I understand, and I trust the author of this repository.')}</label></div>
<button class=p id=add>${T('Add repository')}</button><div id=msg></div></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

// the code is compared in constant time
const sameCode = (a, b) => {
  const x = Buffer.from(String(a || '')),
    y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// deps: {list(): [{name, url, official}], add(spec, name, confirm), remove(name), lanIp(), lang(): the language chosen in the manager}
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
      return res.end(page(i18n.lang(req, deps.lang ? deps.lang() : '')));
    }
    if (u.indexOf('/api/') !== 0) {
      res.writeHead(404);
      return res.end();
    }
    if (!sameCode(req.headers['x-code'], code)) {
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
