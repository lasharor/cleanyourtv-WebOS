// Custom app icons: a picture chosen on a phone shows instead of an app's own icon, on Home and in the Inputs list. The app's own files
// are never touched, so an app update keeps the picture. One file per app, in one of two folders by how it is shown:
//   D/icons/<app id>.<png|jpg|webp>        Icon: inside the tile, like the app's own icon (a logo)
//   D/icons/tile/<app id>.<png|jpg|webp>   Full tile: the picture covers the tile, the middle kept (a photo)
// GET /icon/<app id> (apps.js) sends it first, and /api/apps marks such an app with iv (the picture's version, so the pages load the
// new picture and work out its colour again) and it: 1 for a Full tile picture.
// API (loopback, our apps): GET /api/icons/status, POST /api/icons/pair {app, scale, stop}, POST /api/icons/reset {id}. The phone page
// (POST pair) is a short-lived server on the LAN, port 8794, that needs the code shown on the TV; its API is under /api/ on that port.
// It and the manager show the picture sizes that fit the tiles of the theme in use (sizes()): scale is the screen's pixels per CSS
// pixel, measured by the manager (2 on a 4K TV, where Home is drawn at 3840 x 2160).
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const P = require('./paths'),
  web = require('./web'),
  i18n = require('./i18n'),
  nc = require('./netcompat'),
  { imageType } = require('./wallpapers');

const DIR = P.D + '/icons',
  TILE = DIR + '/tile';
const LIMITS = { file: 1024 * 1024, icons: 300 };
const PAIR_PORT = 8794, // after the Android box page (8793)
  PAIR_MS = 15 * 60 * 1000;
const ID = /^[\w-][\w.-]{0,127}$/; // an app id, as apps.js checks it: never starting with a dot
const TYPES = ['png', 'jpg', 'webp'];
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// the custom picture of an app, or ''
function find(id) {
  if (!ID.test(String(id || ''))) return '';
  for (const d of [TILE, DIR])
    for (const x of TYPES) {
      const f = d + '/' + id + '.' + x;
      if (fs.existsSync(f)) return f;
    }
  return '';
}
const isTile = f => f.indexOf(TILE + '/') === 0;
const mime = f => MIME[f.split('.').pop()] || 'image/png';
// {app id: {v, tile}} of every custom picture; the version is the file's time, so a new picture gets a new one
function versions() {
  const out = {};
  [DIR, TILE].forEach(d => {
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch (_) {}
    names.forEach(n => {
      const m = /^(.+)\.(png|jpg|webp)$/.exec(n);
      if (!m || !ID.test(m[1])) return;
      try {
        out[m[1]] = { v: Math.round(fs.statSync(d + '/' + n).mtimeMs), tile: d === TILE };
      } catch (_) {}
    });
  });
  return out;
}
// the app's own icon again; true when there was a picture
function remove(id) {
  if (!ID.test(String(id || ''))) return false;
  let gone = false;
  [DIR, TILE].forEach(d =>
    TYPES.forEach(x => {
      try {
        fs.unlinkSync(d + '/' + id + '.' + x);
        gone = true;
      } catch (_) {}
    })
  );
  return gone;
}
// keep a picture for an app, as Full tile (tile) or as Icon: '' when it worked, else why not
function set(id, b, tile) {
  if (!ID.test(String(id || ''))) return 'not an app';
  if (!b || !b.length) return 'no picture';
  if (b.length > LIMITS.file) return 'the picture is larger than 1 MB';
  const x = imageType(b);
  if (!x) return 'only JPEG, PNG or WebP pictures';
  if (!find(id) && Object.keys(versions()).length >= LIMITS.icons) return 'at most ' + LIMITS.icons + ' icons';
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
  if (tile && !fs.existsSync(TILE)) fs.mkdirSync(TILE);
  remove(id);
  const f = (tile ? TILE : DIR) + '/' + id + '.' + x;
  fs.writeFileSync(f + '.part', b);
  fs.renameSync(f + '.part', f);
  return '';
}

function create(ctx) {
  const config = ctx.config;
  // the apps a picture can be chosen for: the installed apps (not the inputs on Home), by name
  async function apps() {
    const a = ctx.feature && ctx.feature('apps');
    const list = a ? await a.apps() : [];
    return list.filter(x => !x.input).sort((p, q) => String(p.title).localeCompare(String(q.title)));
  }
  // the picture an app shows now: its custom one, else its own
  function sendIcon(res, a) {
    let f = find(a.id);
    if (!f && a.icon && a.folder) {
      const own = path.join(a.folder, a.icon);
      if (path.resolve(own).startsWith(path.resolve(a.folder)) && fs.existsSync(own)) f = own;
    }
    if (!f) return web.notFound(res);
    res.writeHead(200, { 'content-type': mime(f), 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }
  // the picture sizes that fit the tiles of the theme in use, in the screen's pixels: Full tile at the size of a dock tile (the grid's
  // tiles show its middle), Icon square
  function sizes(scale) {
    const th = ctx.feature && ctx.feature('theme');
    const v = (th && th.resolved && th.resolved().vars) || {};
    const n = (k, d) => Math.round((parseFloat(v[k]) || d) * scale);
    return { tile: { w: n('--dock-w', 408), h: n('--dock-h', 230) }, grid: { w: n('--tile-w', 151), h: n('--tile-h', 151) }, icon: 512 };
  }

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function startPair(app, scale) {
    stopPair();
    const code = String(nc.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => phone(req, res, code, () => ++bad));
    pair = {
      code,
      srv,
      scale: Math.min(3, Math.max(1, +scale || 1)),
      url: 'http://' + web.lanIp() + ':' + PAIR_PORT,
      until: Date.now() + PAIR_MS,
      timer: setTimeout(stopPair, PAIR_MS),
    };
    // the app chosen on Home comes first on the page
    const out = {
      url: pair.url,
      code,
      qr: pair.url + '/#' + code + (ID.test(app) ? '/' + app : ''),
      seconds: PAIR_MS / 1000,
      sizes: sizes(pair.scale),
    };
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve(out));
    });
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, pair.until - Date.now());
  }
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  function rawBody(req, max) {
    return new Promise((resolve, reject) => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > max) {
          reject(new Error('the picture is larger than 1 MB'));
          req.destroy();
        } else b.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(b)));
      req.on('error', reject);
    });
  }
  async function phone(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phonePage(i18n.lang(req, config.get().lang)));
    }
    if (u.indexOf('/api/') !== 0) return web.notFound(res);
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    try {
      const list = await apps();
      if (u === '/api/state')
        return json({
          apps: list.map(a => {
            const f = find(a.id);
            return { id: a.id, title: a.title, custom: !!f, tile: !!f && isTile(f) };
          }),
          sizes: sizes(pair ? pair.scale : 1),
        });
      let m = /^\/api\/icon\/([\w.-]+)$/.exec(u);
      if (m && req.method === 'GET') {
        const a = list.find(x => x.id === m[1]);
        return a ? sendIcon(res, a) : web.notFound(res);
      }
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      m = /^\/api\/upload\/([\w.-]+)$/.exec(u);
      if (m) {
        if (!list.some(x => x.id === m[1])) return json({ error: 'not an app' }, 400);
        const err = set(m[1], await rawBody(req, LIMITS.file), /[?&]tile=1(&|$)/.test(req.url));
        return json(err ? { error: err } : { ok: true }, err ? 400 : 200);
      }
      if (u === '/api/reset') {
        const b = await web.body(req, 4096);
        return json({ ok: true, removed: remove(String(b.id || '')) });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }

  // ---- the service's API ----
  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    if (u === '/api/icons/status')
      return json({
        icons: Object.keys(versions()).length,
        limits: LIMITS,
        pair: pair ? { url: pair.url, code: pair.code, until: pair.until } : null,
      });
    if (req.method !== 'POST') return web.notFound(res);
    const b = await body(req);
    if (u === '/api/icons/pair') return json(b.stop ? (stopPair(), {}) : await startPair(String(b.app || ''), b.scale));
    if (u === '/api/icons/reset') {
      const id = String(b.id || '');
      if (!ID.test(id)) return json({ error: 'not an app' }, 400);
      // an app that already shows its own icon (reset on the phone first) is fine too: the launcher then shows it again
      return json({ ok: true, removed: remove(id) });
    }
    return web.notFound(res);
  }

  return { name: 'icons', prefix: '/api/icons/', handle, phone };
}

// the phone page: the apps with their icons, Change and Reset. Change shows a preview of the picture in a dock tile and a grid tile
// of the theme in use, as Full tile (the default: it covers the tile, its middle kept) or as Icon (inside the tile, like the app's own
// icon), and the picture sizes that fit those tiles. Plain script for iOS Safari and Android Chrome; the picture is scaled in the
// browser before it is sent (Full tile: 1024 pixels on the long side, Icon: 512), as JPEG for a photo and as PNG for a picture with
// see-through parts, so a transparent logo stays transparent; such a picture starts as Icon. This also turns an iPhone's HEIC into JPEG
// or PNG. It is in the phone's language: the fixed text is translated here, the script's own texts by t() (i18n.js).
const PHONE_JS = `var code='',want='',cur='',file=null,alpha=false,mode='tile',S={},$=function(i){return document.getElementById(i)};
/* a text with its %s / %d filled in, in order, then in the page's language */
function fm(s){var a=arguments,n=1;return t(s.replace(/%[sd]/g,function(){return a[n++]}))}
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function msg(t,e){$('msg').innerHTML=t?'<p class="m'+(e?' e':'')+'"></p>':'';if(t)$('msg').firstChild.textContent=t}
function showLogin(t){$('login').className='';$('main').className='hide';$('sum').textContent=t||''}
function px(z){return z.w+' × '+z.h}
function state(){return api('state').then(function(s){S=s;$('login').className='hide';$('main').className='';$('sum').textContent=t('Choose an app, then a picture.');
 var z=s.sizes;if(z){$('sz').textContent=fm('Best size for Full tile: %s pixels. Edges that don’t fit are trimmed, keeping the middle.',px(z.tile));$('sz2').textContent=fm('Best size for Icon: %s pixels. Ideally with a transparent background.',z.icon+' × '+z.icon)}
 var list=(s.apps||[]).slice();list.sort(function(a,b){return (b.id===want)-(a.id===want)});
 var h='';list.forEach(function(a){h+='<div class="ap'+(a.id===want?' on':'')+'"><img alt="" data-i="'+a.id+'"><span></span><button class=p data-c="'+a.id+'"></button>'+(a.custom?'<button data-r="'+a.id+'"></button>':'')+'</div>'});
 $('list').innerHTML=h;var rows=$('list').children;
 list.forEach(function(a,i){rows[i].querySelector('span').textContent=a.title;rows[i].querySelector('[data-c]').textContent=t('Change');var r=rows[i].querySelector('[data-r]');if(r)r.textContent=t('Reset')});
 thumbs()})}
function thumbs(){[].forEach.call($('list').querySelectorAll('img[data-i]'),function(im){var x=new XMLHttpRequest();x.open('GET','/api/icon/'+im.getAttribute('data-i'));x.setRequestHeader('x-code',code);x.responseType='blob';
 x.onload=function(){if(x.status===200)im.src=URL.createObjectURL(x.response)};x.send()})}
/* the preview: the picture in a dock tile and a grid tile of the theme's shape, as the TV will show it */
function preview(){var z=S.sizes||{tile:{w:16,h:10},grid:{w:1,h:1}};$('td').style.paddingTop=(z.tile.h/z.tile.w*100)+'%';$('tg').style.paddingTop=(z.grid.h/z.grid.w*100)+'%';
 $('td').className=$('tg').className='t '+mode;$('mt').className=mode==='tile'?'on':'';$('mi').className=mode==='icon'?'on':'';
 $('mh').textContent=mode==='tile'?t('Full tile: the picture fills the tile; its middle is kept. Any photo works.'):t('Icon: inside the tile, like the app’s own icon. Best for a logo on a transparent background.')}
/* does the picture have see-through parts? Then it is a logo: it starts as Icon, and it is sent as PNG so it stays see-through */
function hasAlpha(im){try{var c=document.createElement('canvas');c.width=c.height=64;var g=c.getContext('2d');g.drawImage(im,0,0,64,64);
 var d=g.getImageData(0,0,64,64).data;for(var i=3;i<d.length;i+=4)if(d[i]<250)return true}catch(e){}return false}
function pick(f){file=f;alpha=false;mode='tile';var u=URL.createObjectURL(f);$('td').firstChild.src=$('tg').firstChild.src=u;
 var a=(S.apps||[]).filter(function(x){return x.id===cur})[0];$('pvt').textContent=a?a.title:'';$('list').className='hide';$('pv').className='';msg('');preview();window.scrollTo(0,0);
 var im=new Image();im.onload=function(){if(file===f&&hasAlpha(im)){alpha=true;mode='icon';preview()}};im.src=u}
function closePv(){$('pv').className='hide';$('list').className='';file=null}
/* scale in the browser: Full tile to 1024 pixels on the long side, Icon to 512. A photo goes as JPEG; a picture with see-through parts as
   PNG, made smaller until it fits in 1 MB; an Icon without them as PNG, or JPEG when the PNG would be too large. A file the browser cannot
   draw is sent as it is */
function scaled(f,m,al){return new Promise(function(ok){var u=URL.createObjectURL(f),im=new Image();im.onload=function(){var w=im.naturalWidth,h=im.naturalHeight,s=Math.min(1,(m==='tile'?1024:512)/Math.max(w,h));URL.revokeObjectURL(u);
 (function at(k){var c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  if(!al&&m==='tile')return c.toBlob(function(j){ok(j||f)},'image/jpeg',0.9);
  c.toBlob(function(b){if(b&&b.size<=1000000)ok(b);else if(al&&Math.max(c.width,c.height)>256)at(k*0.75);else c.toBlob(function(j){ok(j||f)},'image/jpeg',0.9)},'image/png')})(s)};
 im.onerror=function(){URL.revokeObjectURL(u);ok(f)};im.src=u})}
$('f').onchange=function(){var f=this.files[0];this.value='';if(f&&cur)pick(f)};
$('mt').onclick=function(){mode='tile';preview()};
$('mi').onclick=function(){mode='icon';preview()};
$('pc').onclick=closePv;
$('ps').onclick=function(){var id=cur,m=mode;if(!file||!id)return;msg(t('Sending…'));
 scaled(file,m,alpha).then(function(b){var x=new XMLHttpRequest();x.open('POST','/api/upload/'+id+(m==='tile'?'?tile=1':''));x.setRequestHeader('x-code',code);x.setRequestHeader('content-type',b.type||'application/octet-stream');
  x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===200){closePv();msg(t('Icon changed. Go back to Home on the TV to see it.'));state()}else msg(t(j.error||'refused'),1)};
  x.onerror=function(){msg(t('The TV did not answer.'),1)};x.send(b)})};
$('list').onclick=function(e){var c=e.target.getAttribute('data-c'),r=e.target.getAttribute('data-r');
 if(c){cur=c;$('f').click()}
 if(r)api('reset',{id:r}).then(function(){msg(t('Icon reset.'));state()})};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
var hh=(location.hash||'').slice(1).split('/');code=hh[0]||'';want=hh[1]||'';if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;
function phonePage(lang) {
  const T = s => web.esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${T('App icons')}</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:18px 0 8px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}input{text-align:left}.hide{display:none}small{color:#888}
.ap{display:flex;align-items:center;gap:12px;padding:10px;border-radius:14px;background:#15161b;margin:8px 0}.ap.on{outline:2px solid #f5f6f8}
.ap img{width:64px;height:64px;object-fit:contain;border-radius:12px;background:#22232a;flex:none}.ap span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap button{width:auto;margin:0;padding:10px 14px;flex:none}
.modes{display:flex;gap:8px}.modes button{margin:0}.modes .on{background:#f5f6f8;color:#111;font-weight:600}
.tiles{display:flex;gap:12px;align-items:flex-end;margin:12px 0}.tiles>div{text-align:center}.tiles small{display:block;margin-top:4px}
.t{position:relative;overflow:hidden;border-radius:18px;background:#3a3b42}.t img{position:absolute;max-width:none}
.t.tile img{left:0;top:0;width:100%;height:100%;object-fit:cover}
.t.icon img{left:50%;top:50%;transform:translate(-50%,-50%);height:56%;width:65%;object-fit:contain}#tg.icon img{height:64%;width:75%}</style>
<h1>${T('App icons')}</h1><p id=sum>${T('Connecting to the TV…')}</p><p><small id=sz></small><br><small id=sz2></small></p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide><div id=msg></div><input id=f type=file accept="image/*" class=hide>
<div id=pv class=hide><h2 id=pvt></h2><div class=modes><button id=mt>${T('Full tile')}</button><button id=mi>${T('Icon')}</button></div><p id=mh></p>
<div class=tiles><div style="width:62%"><div class=t id=td><img alt=""></div><small>${T('Dock')}</small></div><div style="width:34%"><div class=t id=tg><img alt=""></div><small>${T('App grid')}</small></div></div>
<button class=p id=ps>${T('Send')}</button><button id=pc>${T('Cancel')}</button></div>
<div id=list></div></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { create, find, versions, set, remove, mime, LIMITS, PAIR_PORT };
