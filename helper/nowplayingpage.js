// The phone page where Spotify is connected for the Now playing card (nowplaying.js): a short-lived server on the LAN, port 8797, that
// needs the code shown on the TV in every request (header x-code), like the other phone pages (Wallpapers 8791, Cards 8792, Android box
// 8793, App icons 8794). It stays open ten minutes, and up to an hour while it is used. Plain script for iOS Safari and Android Chrome, in
// the phone's language (i18n.js). It is not encrypted: the Client ID and the pasted address travel over the Wi-Fi.
//   create({config, np}) -> { start() -> {url, code, qr, seconds} | {error}, stop() }
const http = require('http');
const web = require('./web'),
  i18n = require('./i18n'),
  nc = require('./netcompat');
const PORT = 8797,
  MS = 10 * 60 * 1000;

function create(ctx) {
  const config = ctx.config,
    np = ctx.np;
  let pair = null;
  function stop() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  function start() {
    stop();
    const code = String(nc.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => answer(req, res, code, () => ++bad));
    pair = { srv, until: Date.now() + MS, timer: setTimeout(stop, MS) };
    const url = 'http://' + web.lanIp() + ':' + PORT;
    return new Promise(resolve => {
      srv.on('error', e => {
        stop();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PORT, '0.0.0.0', () => resolve({ url, code, qr: url + '/#' + code, seconds: MS / 1000 }));
    });
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stop, pair.until - Date.now());
  }
  async function answer(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      lang = i18n.lang(req, config.get().lang),
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    // (the answers carry their errors in English: translated here, for the phone)
    const said = o => (o.error ? Object.assign({}, o, { error: i18n.tr(lang, o.error) }) : o);
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(page(lang));
    }
    if (u.indexOf('/api/') !== 0) return web.notFound(res);
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stop();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    if (u === '/api/state') return json(said(np.status()));
    if (req.method !== 'POST') return json({ error: 'not found' }, 404);
    if (u === '/api/prepare') {
      const b = await web.body(req, 4096);
      return json(said(np.prepare(b.clientId, b.redirect)));
    }
    if (u === '/api/finish') return json(said(await np.finish((await web.body(req, 4096)).address)));
    if (u === '/api/disconnect') return json(said(np.disconnect()));
    json({ error: 'not found' }, 404);
  }
  return { start, stop };
}

const PHONE_JS = `var code='',$=function(i){return document.getElementById(i)};
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function el(tag,attrs,text){var e=document.createElement(tag);for(var k in attrs||{})e.setAttribute(k,attrs[k]);if(text!==undefined)e.textContent=text;return e}
function showLogin(s){$('login').className='';$('main').className='hide';$('sum').textContent=s||''}
function note(box,s,e){box.appendChild(el('p',{'class':'m'+(e?' e':'')},s))}
function copyIt(inp,b){try{inp.focus();inp.select();inp.setSelectionRange(0,999);document.execCommand('copy')}catch(e){}var o=b.textContent;b.textContent=t('Copied');setTimeout(function(){b.textContent=o},1500)}
function steps(box,s){var cur=0,rows=[];
 function open(i){cur=i;for(var k=0;k<rows.length;k++){rows[k].w.className='s'+(k===i?' o':'')+(k<i?' d':'');rows[k].n.textContent=k<i?'\u2713':String(k+1)}}
 function mk(title,fill){var i=rows.length,w=el('div',{'class':'s'}),h=el('button',{type:'button','class':'sh'}),n=el('span',{'class':'n'},String(i+1)),b=el('div',{'class':'sb'});
  h.appendChild(n);h.appendChild(el('span',{'class':'st'},title));h.onclick=function(){open(cur===i?-1:i)};w.appendChild(h);w.appendChild(b);box.appendChild(w);rows.push({w:w,n:n});fill(b);return b}
 function nx(b,i){var x=el('button',{type:'button'},t('Done, next step'));x.onclick=function(){open(i+1)};b.appendChild(x)}
 function p(b,s2,c){b.appendChild(el('p',{'class':c||'h'},s2))}
 mk(t('Log in to the Spotify developer dashboard'),function(b){p(b,t('Sign in with the Spotify account you listen with. The app owner needs Spotify Premium.'));
  b.appendChild(el('a',{'class':'lk',href:'https://developer.spotify.com/dashboard',target:'_blank',rel:'noopener'},t('Open developer.spotify.com')));nx(b,0)});
 mk(t('Create the app'),function(b){p(b,t('Click Create app. Use any name and description, tick Web API, and add this Redirect URI. Then accept the terms and save.'));
  var ru=el('input',{type:'text',readonly:'readonly',autocapitalize:'off'});ru.value=s.redirect;b.appendChild(ru);
  var cp=el('button',{type:'button'},t('Copy Redirect URI'));cp.onclick=function(){copyIt(ru,cp)};b.appendChild(cp);nx(b,1)});
 mk(t('Add your Spotify email'),function(b){p(b,t('In your app open Settings, then User Management. Add the name and email of the Spotify account you use on the TV.'));
  b.appendChild(el('p',{'class':'m e'},t('Without this Spotify refuses the sign-in.')));nx(b,2)});
 var out;
 mk(t('Client ID and sign-in'),function(b){p(b,t('In the app Settings, under Basic Information, copy the Client ID and paste it here. The Client secret is not needed.'));
  var ci=el('input',{type:'text',autocomplete:'off',autocapitalize:'off',spellcheck:'false',placeholder:t('Client ID')}),go=el('button',{type:'button','class':'p'},t('Prepare sign-in'));
  b.appendChild(ci);b.appendChild(go);var er=el('div',{});b.appendChild(er);
  go.onclick=function(){er.innerHTML='';api('prepare',{clientId:ci.value}).then(function(r){
   if(r.error){note(er,r.error,1);return}
   out.innerHTML='';out.appendChild(el('a',{'class':'lk',href:r.url,target:'_blank',rel:'noopener'},t('Open Spotify sign-in')));
   p(out,t('Approve the access. The next page will not open: copy its whole address from the browser and paste it here.'));
   var bk=el('input',{type:'text',autocomplete:'off',autocapitalize:'off',spellcheck:'false',placeholder:t('Pasted address')}),fin=el('button',{type:'button','class':'p'},t('Connect')),fe=el('div',{});
   out.appendChild(bk);out.appendChild(fin);out.appendChild(fe);
   fin.onclick=function(){fe.innerHTML='';api('finish',{address:bk.value}).then(function(r2){if(r2.error){note(fe,r2.error,1);return}show(r2)})};open(4)})}});
 mk(t('Approve and connect'),function(b){out=b;p(b,t('Prepare the sign-in in the step before first. The sign-in button and the box for the address appear here.'))});
 open(0)}
function show(s){var box=$('box');box.innerHTML='';if(s.error&&!s.connected)note(box,s.error,1);
 if(s.connected){note(box,t('Connected to Spotify.')+(s.account?' '+t('Signed in as')+' '+s.account:''));if(s.error)note(box,s.error,1);var d=el('button',{type:'button'},t('Disconnect Spotify'));d.onclick=function(){api('disconnect',{}).then(show)};box.appendChild(d);return}
 steps(box,s)}
function state(){return api('state').then(function(s){$('login').className='hide';$('main').className='';$('sum').textContent='';show(s)})}
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;
function page(lang) {
  const T = s => web.esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${T('Spotify now playing')}</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0}
button{text-align:center}button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}.h{font-size:14px}.hide{display:none}
a.lk{display:block;text-align:center;padding:14px;border-radius:12px;background:#f5f6f8;color:#111;font-weight:600;text-decoration:none;margin:8px 0}.s{border:1px solid #333;border-radius:12px;background:#1a1b21;margin:8px 0;overflow:hidden}.sh{display:flex;align-items:center;margin:0;border:0;background:none;text-align:start}
.n{flex:none;width:28px;height:28px;border-radius:50%;border:1px solid #333;display:inline-grid;place-items:center;font-size:14px;color:#aaa;margin-inline-end:12px}.st{font-weight:600}
.s.o .n{border-color:#f5f6f8;color:#eee}.s.d .n{background:#f5f6f8;border-color:#f5f6f8;color:#111;font-weight:600}.sb{display:none;padding:0 14px 14px}.s.o .sb{display:block}
.sb input,.sb button{background:#0d0e12}.sb button.p{background:#f5f6f8}.sh{width:100%;padding:14px;color:#eee;background:none}
[dir=rtl] body{text-align:right}</style>
<h1>${T('Spotify now playing')}</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide><div id=box></div></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { PORT, create };
