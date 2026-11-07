// Wallpapers: your own photos as the launcher's background:
//   D/wallpapers/upload/<random>.jpg   photos uploaded from a phone (the phone page scales them before sending)
// More photos come from add-ons that provide "wallpapers" (Immich, Unsplash, ...; docs/development/addons.md): see "photo sources" below.
// D/wallpapers/index.json says what each upload is; only files listed there are ever deleted. (D/wallpapers/immich/ is what an earlier
// version synced from Immich, kept until the Immich add-on takes it over or you remove it.)
// The settings are the wallpapers section of config.json: {size: '4k'|'hd' (4K is the default: Home is drawn at the panel's 3840 x 2160)}.
// API (loopback, our apps): GET /api/wallpapers/status, GET /api/wallpapers/list, GET /api/wallpapers/photo/u/<id>,
// POST /api/wallpapers/set {size}, POST /api/wallpapers/pair, POST /api/wallpapers/remove-uploads,
// POST /api/wallpapers/disconnect (removes the old Immich data of an earlier version). The phone page (POST pair) is a short-lived server on the LAN, port 8791, that needs the code shown
// on the TV; its API is under /api/ on that port.
const fs = require('fs'),
  http = require('http'),
  path = require('path'),
  crypto = require('crypto');
const P = require('./paths'),
  web = require('./web'),
  i18n = require('./i18n'),
  nc = require('./netcompat');

const DIR = P.D + '/wallpapers',
  UP = DIR + '/upload',
  IM = DIR + '/immich',
  INDEX = DIR + '/index.json';
const LIMITS = { uploads: 100, bytes: 150 * 1024 * 1024, file: 12 * 1024 * 1024 };
const PAIR_PORT = 8791, // after the Share-log page's range (8768-8790)
  PAIR_MS = 15 * 60 * 1000;
const ID = /^[a-f0-9]{16}$/;

// what a file is, from its first bytes: only JPEG, PNG and WebP are kept
function imageType(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function create(ctx) {
  const config = ctx.config;
  const cfg = () => Object.assign({ size: '4k' }, config.get().wallpapers || {});
  const icfg = () => Object.assign({ url: '', key: '', albums: [], hidden: [] }, cfg().immich || {});
  const setCfg = fn =>
    config.update('wallpapers', c => {
      c.wallpapers = Object.assign({}, c.wallpapers || {}); // the size is written only when it is chosen
      fn(c.wallpapers);
    });

  // ---- the index of the files ----
  let index = null;
  function idx() {
    if (index) return index;
    try {
      index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    } catch (_) {
      index = {};
    }
    index.upload = Array.isArray(index.upload) ? index.upload : [];
    index.immich = index.immich && typeof index.immich === 'object' ? index.immich : {};
    index.sync = index.sync || { state: 'idle', at: 0, error: '', ok: 0 };
    return index;
  }
  function saveIdx() {
    nc.mkdirp(DIR);
    fs.writeFileSync(INDEX + '.tmp', JSON.stringify(idx()));
    fs.renameSync(INDEX + '.tmp', INDEX);
  }
  const usedBytes = () => idx().upload.reduce((n, u) => n + (u.bytes || 0), 0);
  // your photos are for root only, as the settings are
  const mkdir = d => {
    nc.mkdirp(d);
    try {
      fs.chmodSync(DIR, 0o700);
    } catch (_) {}
  };
  const unlink = f => {
    try {
      fs.unlinkSync(f);
    } catch (_) {}
  };

  // ---- uploads ----
  function addUpload(buf) {
    const type = imageType(buf);
    if (!type) return 'not a JPEG, PNG or WebP picture';
    if (buf.length > LIMITS.file) return 'the picture is larger than 12 MB';
    if (idx().upload.length >= LIMITS.uploads) return 'there are ' + LIMITS.uploads + ' uploads already: remove some first';
    if (usedBytes() + buf.length > LIMITS.bytes) return 'Wallpapers is full (150 MB): remove some photos first';
    mkdir(UP);
    const id = crypto.randomBytes(8).toString('hex'),
      file = id + '.' + type;
    fs.writeFileSync(path.join(UP, file + '.tmp'), buf, { mode: 0o600 });
    fs.renameSync(path.join(UP, file + '.tmp'), path.join(UP, file));
    idx().upload.push({ id, file, bytes: buf.length, at: Date.now() });
    saveIdx();
    return '';
  }
  function removeUpload(id) {
    const u = idx().upload.filter(x => x.id === id)[0];
    if (!u) return false;
    unlink(path.join(UP, u.file));
    idx().upload = idx().upload.filter(x => x.id !== id);
    saveIdx();
    return true;
  }
  function removeUploads() {
    for (const u of idx().upload) unlink(path.join(UP, u.file));
    idx().upload = [];
    saveIdx();
  }

  // ---- Immich of earlier versions ----
  // Immich is an add-on now (addons/catalog/immich). A TV that had it keeps the settings (config.json: wallpapers.immich) and the photos
  // (wallpapers/immich/) until the add-on is installed, which takes them over once (adoptLegacy); "Remove old Immich data" deletes them.
  const legacyOn = () => {
    const c = icfg();
    return !!(c.url && c.key) || Object.keys(idx().immich).length > 0;
  };
  let adopting = false;
  async function adoptLegacy() {
    if (adopting || !legacyOn()) return;
    const s = sources().filter(x => x.id === 'immich' && typeof x.mod.wallpapers.adopt === 'function')[0];
    if (!s) return;
    adopting = true;
    try {
      const r = await s.mod.wallpapers.adopt({ settings: icfg(), photos: idx().immich, dir: IM });
      if (r && r.ok) removeLegacy();
    } catch (e) {
      console.error('wallpapers: the Immich add-on could not take over the old settings: ' + ((e && e.message) || e));
    }
    adopting = false;
  }
  function removeLegacy() {
    for (const id of Object.keys(idx().immich)) unlink(path.join(IM, idx().immich[id].file));
    idx().immich = {};
    idx().sync = { state: 'idle', at: 0, error: '', ok: 0 };
    saveIdx();
    setCfg(w => {
      delete w.immich;
    });
  }

  // ---- photo sources: add-ons that provide "wallpapers" ----
  // A source is the object `wallpapers` on the module an add-on returns from create():
  //   label            the name in the manager
  //   list()           ids of the photos it has now, each a file it can hand out (letters, digits, - _ .; at most 500)
  //   file(id)         the absolute path of that photo (a JPEG, PNG or WebP), or ''
  //   live: true       it also offers one photo at a time that is not kept on the TV: Home asks next() each time it shows that entry
  //   next()           (live) -> {url, credit}: an https address of the picture and the text Home shows in a corner (the photographer)
  //   push()           (live, optional) -> {url, credit} or null: a photo for Home to show now, once (Home asks every few seconds)
  //   status()         -> {summary, error}: one line for the manager (photos, last sync, what went wrong)
  //   settings(o)      -> {url, code, qr, seconds}: starts a short-lived page on the LAN for its settings (o.stop: close it)
  // The photos are listed as s/<add-on>/<id> and a live source as l/<add-on>. A source that throws offers nothing and is logged once.
  const SRC_PHOTO = /^[\w.-]{1,64}$/,
    SRC_MAX = 500,
    warned = {};
  const sources = () => {
    const a = ctx.feature && ctx.feature('addons');
    return a && a.providers ? a.providers('wallpapers').filter(s => s.mod.wallpapers && typeof s.mod.wallpapers === 'object') : [];
  };
  const srcOf = id => sources().filter(s => s.id === id)[0];
  function guard(s, fn, fallback) {
    try {
      return fn();
    } catch (e) {
      if (!warned[s.id]) {
        warned[s.id] = 1;
        console.error('wallpapers: source ' + s.id + ': ' + ((e && e.message) || e));
      }
      return fallback;
    }
  }
  const srcPhotos = s => {
    const l = guard(s, () => s.mod.wallpapers.list(), []);
    return (Array.isArray(l) ? l : [])
      .filter((x, i, all) => typeof x === 'string' && SRC_PHOTO.test(x) && all.indexOf(x) === i)
      .slice(0, SRC_MAX);
  };
  const line = (v, n) =>
    String(v || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, n);
  const srcFile = (addon, id) => {
    const s = srcOf(addon);
    if (!s || !SRC_PHOTO.test(id)) return '';
    const f = guard(s, () => s.mod.wallpapers.file(id), '');
    if (typeof f !== 'string' || !path.isAbsolute(f) || !MIME[f.split('.').pop().toLowerCase()]) return '';
    try {
      const st = fs.statSync(f);
      return st.isFile() && st.size <= LIMITS.file * 2 ? f : '';
    } catch (_) {
      return '';
    }
  };
  function sendSrcPhoto(res, addon, id) {
    const f = srcFile(addon, id);
    if (!f) return web.notFound(res);
    res.writeHead(200, { 'content-type': MIME[f.split('.').pop().toLowerCase()], 'cache-control': 'max-age=3600' });
    fs.createReadStream(f).pipe(res);
  }
  // a live photo: the address goes into a CSS url() on Home, so only a plain https address is passed on
  const livePhoto = r => {
    if (typeof r.url !== 'string' || !/^https:\/\/[^\s"'()\\]{4,600}$/.test(r.url))
      return { error: 'the source gave no usable picture address' };
    return { url: r.url, credit: line(r.credit, 120) };
  };
  // the live photo each source last gave Home (from next() or push()): the screen saver shows that one (liveCurrent)
  const lastLive = {};
  async function liveNext(addon) {
    const s = srcOf(addon);
    if (!s || s.mod.wallpapers.live !== true || typeof s.mod.wallpapers.next !== 'function') return { error: 'not a live source' };
    try {
      const r = (await s.mod.wallpapers.next()) || {};
      const p = r.error ? { error: line(r.error, 160) } : livePhoto(r);
      if (p.url) lastLive[addon] = p;
      return p;
    } catch (e) {
      return { error: line((e && e.message) || e, 160) };
    }
  }
  // what Home has now from a live source, for the screen saver: next() hands out a new photo on every call, so asking it again would
  // show another photo than Home and make Home skip one. Before Home asked at all (a fresh start of the service) it asks once, and
  // that photo waits for Home (forHome): Home's next request gets it instead of another one, so both show the same photo.
  const forHome = {};
  async function liveCurrent(addon) {
    const s = srcOf(addon);
    if (!s || s.mod.wallpapers.live !== true) return { error: 'not a live source' };
    if (lastLive[addon]) return lastLive[addon];
    const p = await liveNext(addon);
    if (p.url) forHome[addon] = true;
    return p;
  }
  // Home's request (/api/wallpapers/live/<add-on>): the photo the screen saver fetched first, once, else the source's next one
  async function liveForHome(addon) {
    if (forHome[addon] && lastLive[addon]) {
      delete forHome[addon];
      return lastLive[addon];
    }
    delete forHome[addon];
    return liveNext(addon);
  }
  // a photo a live source wants Home to show now (Unsplash: the one "Test key and save" fetched), handed out once; Home asks every few
  // seconds while a live entry is in its list
  function pushNow() {
    for (const s of sources()) {
      const w = s.mod.wallpapers;
      if (w.live !== true || typeof w.push !== 'function') continue;
      const r = guard(s, () => w.push(), null);
      if (r && !r.error) {
        const p = livePhoto(r);
        if (p.url) {
          lastLive[s.id] = p;
          return { id: 'l/' + s.id, url: p.url, credit: p.credit };
        }
      }
    }
    return { id: '', url: '', credit: '' };
  }
  async function srcSettings(addon, stop) {
    const s = srcOf(addon);
    if (!s || typeof s.mod.wallpapers.settings !== 'function') return { error: 'this source has no settings page' };
    try {
      const r = (await s.mod.wallpapers.settings({ stop: !!stop })) || {};
      if (r.error) return { error: line(r.error, 160) };
      return stop
        ? {}
        : { url: line(r.url, 200), code: line(r.code, 12), qr: line(r.qr, 240), seconds: +r.seconds > 0 ? Math.round(+r.seconds) : 0 };
    } catch (e) {
      return { error: line((e && e.message) || e, 160) };
    }
  }
  const sourceStatus = () =>
    sources().map(s => {
      const w = s.mod.wallpapers,
        st = guard(s, () => (typeof w.status === 'function' ? w.status() : {}), {}) || {};
      return {
        id: s.id,
        label: line(w.label || s.name, 40),
        photos: srcPhotos(s).length,
        live: w.live === true,
        summary: line(st.summary, 120),
        error: line(st.error, 160),
        settings: typeof w.settings === 'function',
      };
    });

  // ---- what the TV shows ----
  function list() {
    let out = idx().upload.map(u => 'u/' + u.id);
    for (const s of sources()) {
      out = out.concat(srcPhotos(s).map(id => 's/' + s.id + '/' + id));
      if (s.mod.wallpapers.live === true) out.push('l/' + s.id);
    }
    return out;
  }
  // a number that changes whenever the set of photos changes: the launcher reads the list again then
  const stamp = () => {
    const l = list();
    return l.length + ':' + crypto.createHash('md5').update(l.join(',')).digest('hex').slice(0, 8);
  };
  function status() {
    const out = {
      size: cfg().size === 'hd' ? 'hd' : '4k',
      uploads: idx().upload.length,
      total: list().length,
      bytes: usedBytes(),
      limits: LIMITS,
      pair: pair ? { url: pair.url, code: pair.code, until: pair.until } : null,
    };
    // only when an add-on provides photos, so the reply is the same without any
    const src = sourceStatus();
    if (src.length) out.sources = src;
    // only a TV that had Immich before it became an add-on
    if (legacyOn()) out.legacyImmich = { photos: Object.keys(idx().immich).length, configured: !!(icfg().url && icfg().key) };
    return out;
  }
  function photoFile(src, id) {
    if (src === 'u' && ID.test(id)) {
      const u = idx().upload.filter(x => x.id === id)[0];
      return u ? path.join(UP, u.file) : '';
    }
    return '';
  }
  function sendPhoto(res, src, id, cache) {
    const f = photoFile(src, id);
    if (!f || !fs.existsSync(f)) return web.notFound(res);
    res.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'image/jpeg', 'cache-control': cache || 'max-age=86400' });
    fs.createReadStream(f).pipe(res);
  }

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function startPair() {
    stopPair();
    const code = String(nc.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => phone(req, res, code, () => ++bad));
    pair = { code, srv, url: 'http://' + web.lanIp() + ':' + PAIR_PORT, until: Date.now() + PAIR_MS, timer: setTimeout(stopPair, PAIR_MS) };
    const out = { url: pair.url, code, qr: pair.url + '/#' + code, seconds: PAIR_MS / 1000 };
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
          reject(new Error('the picture is larger than 12 MB'));
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
      if (u === '/api/state') return json(Object.assign(status(), { pair: null, uploadsList: idx().upload.map(x => x.id) }));
      let m = /^\/api\/photo\/(u)\/([0-9a-f-]{16,36})$/i.exec(u);
      if (m && req.method === 'GET') return sendPhoto(res, m[1], m[2], 'private, max-age=3600');
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      if (u === '/api/upload') {
        const err = addUpload(await rawBody(req, LIMITS.file));
        return json(err ? { error: err } : { ok: true, uploads: idx().upload.length }, err ? 400 : 200);
      }
      const b = await web.body(req, 16384);
      if (u === '/api/upload/delete') return json({ ok: removeUpload(String(b.id || '')) });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }

  // ---- the service's API ----
  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    const m = /^\/api\/wallpapers\/photo\/(u)\/([0-9a-f-]{16,36})$/i.exec(u);
    if (m) return sendPhoto(res, m[1], m[2]);
    const ms = /^\/api\/wallpapers\/photo\/s\/([a-z][a-z0-9-]{1,31})\/([\w.-]{1,64})$/.exec(u);
    if (ms) return sendSrcPhoto(res, ms[1], ms[2]);
    const ml = /^\/api\/wallpapers\/live\/([a-z][a-z0-9-]{1,31})$/.exec(u);
    if (ml) return json(await liveForHome(ml[1]));
    if (u === '/api/wallpapers/push') return json(pushNow());
    if (u === '/api/wallpapers/status') return json(status());
    if (u === '/api/wallpapers/list') return json({ photos: list(), stamp: stamp() });
    if (req.method !== 'POST') return web.notFound(res);
    const b = await body(req);
    if (u === '/api/wallpapers/set') {
      if (b.size === '4k' || b.size === 'hd')
        setCfg(w => {
          w.size = b.size;
        });
      return json(status());
    }
    const mset = /^\/api\/wallpapers\/source\/([a-z][a-z0-9-]{1,31})\/settings$/.exec(u);
    if (mset) {
      const r = await srcSettings(mset[1], b.stop === true);
      return json(r, r.error ? 400 : 200);
    }
    if (u === '/api/wallpapers/pair') return json(b.stop ? (stopPair(), {}) : await startPair());
    if (u === '/api/wallpapers/remove-uploads') {
      removeUploads();
      return json(status());
    }
    if (u === '/api/wallpapers/disconnect') {
      removeLegacy();
      return json(status());
    }
    return web.notFound(res);
  }

  return { name: 'wallpapers', prefix: '/api/wallpapers/', handle, status, stamp, adoptLegacy, addUpload, list, phone, liveCurrent };
}

// the phone page: Upload photos. Plain script for iOS Safari and Android Chrome; photos are scaled in
// the browser (to 3840 or 1920 pixels on the long side) before they are sent, which also turns an iPhone's HEIC into JPEG. It is in the
// phone's language: the fixed text is translated here, the script's own texts by t() with the translations it uses (i18n.js).
const PHONE_JS = `var code='',S={},MAX=3840,$=function(i){return document.getElementById(i)};
/* a text with its %s / %d filled in, in order, then in the page's language (a template's plural form follows the number) */
function fm(s){var a=arguments,n=1;return t(s.replace(/%[sd]/g,function(){return a[n++]}))}
function api(p,b,ct){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 if(ct)x.setRequestHeader('content-type',ct);x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:(ct?b:JSON.stringify(b)))})}
function msg(t,e){$('msg').innerHTML=t?'<p class="m'+(e?' e':'')+'"></p>':'';if(t)$('msg').firstChild.textContent=t}
function showLogin(t){$('login').className='';$('main').className='hide';$('sum').textContent=t||''}
function ago(x){if(!x)return t('never');var m=Math.round((Date.now()-x)/60000);return m<1?t('just now'):m<60?fm('%d min ago',m):m<1440?fm('%d h ago',Math.round(m/60)):fm('%d days ago',Math.round(m/1440))}
function state(){return api('state').then(function(s){S=s;MAX=s.size==='hd'?1920:3840;$('login').className='hide';$('main').className='';
 $('sum').textContent=fm('Local uploads: %d · Total: %d photos (%d of 150 MB)',s.uploads,s.total,Math.round(s.bytes/1048576));
 $('un').textContent=fm('%d of %d',s.uploads,s.limits.uploads);var g='';(s.uploadsList||[]).forEach(function(id){g+='<div class=ph><img loading=lazy src="" data-s="u/'+id+'"><button data-d="'+id+'">×</button></div>'});$('ug').innerHTML=g;thumbs($('ug'))})}
function thumbs(el){[].forEach.call(el.querySelectorAll('img[data-s]'),function(im){var x=new XMLHttpRequest();x.open('GET','/api/photo/'+im.getAttribute('data-s'));x.setRequestHeader('x-code',code);x.responseType='blob';
 x.onload=function(){if(x.status===200)im.src=URL.createObjectURL(x.response)};x.send()})}
/* scale in the browser: the long side to MAX pixels, JPEG; a file the browser cannot draw is sent as it is when it is small enough */
function scaled(file){return new Promise(function(ok){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var w=im.naturalWidth,h=im.naturalHeight,k=Math.min(1,MAX/Math.max(w,h));
 var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(function(b){ok(b||file)},'image/jpeg',0.9)};
 im.onerror=function(){URL.revokeObjectURL(u);ok(file)};im.src=u})}
function upload(files){var list=[].slice.call(files),n=0,okN=0,errs=[];$('prog').className='';msg('');
 (function next(){if(n>=list.length){$('prog').className='hide';msg(fm('%d of %d photos uploaded.',okN,list.length)+(errs.length?' '+errs[0]:''),!!errs.length&&!okN);state();return}
  var f=list[n];$('pt').textContent=fm('Photo %d of %d · preparing',n+1,list.length);$('pb').style.width=Math.round(n/list.length*100)+'%';
  scaled(f).then(function(b){var x=new XMLHttpRequest();x.open('POST','/api/upload');x.setRequestHeader('x-code',code);x.setRequestHeader('content-type',b.type||'application/octet-stream');
   x.upload.onprogress=function(e){if(e.lengthComputable)$('pb').style.width=Math.round((n+e.loaded/e.total)/list.length*100)+'%';$('pt').textContent=fm('Photo %d of %d · sending',n+1,list.length)};
   x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===200)okN++;else errs.push((f.name||t('A photo'))+': '+t(j.error||'refused'));n++;next()};
   x.onerror=function(){errs.push(t('The TV did not answer.'));n++;next()};x.send(b)})})()}
$('f').onchange=function(){if(this.files.length)upload(this.files);this.value=''};
$('ug').onclick=function(e){var d=e.target.getAttribute('data-d');if(d)api('upload/delete',{id:d}).then(state)};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;
function phonePage(lang) {
  const T = s => web.esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Wallpapers</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:28px 0 10px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input,label.b{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p,label.b{background:#f5f6f8;color:#111;font-weight:600;border:0}input{text-align:left}.row{display:flex;gap:10px}.row>*{flex:1}
.tabs{display:flex;gap:8px;margin:16px 0}.tabs button{margin:0}.tabs .on{background:#f5f6f8;color:#111}.hide{display:none}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.ph{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#222}
.ph img{width:100%;height:100%;object-fit:cover;display:block}.ph button{position:absolute;right:4px;top:4px;width:32px;height:32px;padding:0;margin:0;border-radius:16px;background:rgba(0,0,0,.7);border:0;color:#fff}
.ph.off img{opacity:.3}.al{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:#1a1b21;margin:6px 0}.al input{width:22px;height:22px;margin:0}
.bar{height:8px;border-radius:4px;background:#333;overflow:hidden;margin:8px 0}.bar i{display:block;height:100%;width:0;background:#f5f6f8}small{color:#888}</style>
<h1>Wallpapers</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<div id=msg></div>
<section id=up><label class=b for=f>${T('Choose photos')}</label><input id=f type=file accept="image/*" multiple class=hide>
<div id=prog class=hide><div class=bar><i id=pb></i></div><p id=pt></p></div>
<h2>${T('Uploaded')} <small id=un></small></h2><div class=grid id=ug></div></section>
</div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { create, imageType, LIMITS, PAIR_PORT };
