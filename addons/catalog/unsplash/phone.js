// The phone page of the Unsplash add-on: the Access Key, search words, a test that shows a photo on Home at once, and the recent photos
// with their credits. Plain script for iOS Safari and Android Chrome; the fixed text is translated here (ctx.util.i18n), the script's own
// texts by t().
const PHONE_JS = `var code='',S={},UF=0,LP=-1,$=function(i){return document.getElementById(i)};
function fm(s){var a=arguments,n=1;return t(s.replace(/%[sd]/g,function(){return a[n++]}))}
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function msg(t,e){$('msg').innerHTML=t?'<p class="m'+(e?' e':'')+'"></p>':'';if(t)$('msg').firstChild.textContent=t}
function showLogin(t){$('login').className='';$('main').className='hide';$('sum').textContent=t||''}
function state(){return api('state').then(function(u){S=u;$('login').className='hide';$('main').className='';$('sum').textContent='';
 $('sk').placeholder=u.keyHint?fm('Access Key (saved: %s; leave empty to keep)',u.keyHint):t('Access Key');
 if(!UF){UF=1;$('sq').value=u.query}
 $('sst').innerHTML='';var q=document.createElement('p');q.textContent=u.configured?t('Live: a new photo from Unsplash at most every 3 minutes.')+(u.error?' · '+t(u.error):'')+(u.pausedUntil?' · '+fm('paused until %s',new Date(u.pausedUntil).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})):''):t('Not set up.');$('sst').appendChild(q);
 $('sd').className=$('so').className=u.configured?'':'hide';$('so').textContent=u.on?t('Turn Unsplash off'):t('Turn Unsplash on');
 if(u.configured&&u.shown!==LP){LP=u.shown;loadUnsplash()}})}
/* each photo with its credit under it: "Photo by NAME on Unsplash", NAME linked to the photographer's page and Unsplash to unsplash.com,
   both with the utm parameters (Unsplash's attribution rule) */
function link(txt,href){if(!href)return document.createTextNode(txt);var e=document.createElement('a');e.href=href;e.target='_blank';e.rel='noopener';e.textContent=txt;return e}
/* the credit with the photographer and the site linked wherever the translation puts each one: the name is marked with \\u0001 and the
   site with \\u0002, so a language that puts Unsplash before the name reads right too */
function credit(k,p,home){var s=t('Photo by %s on Unsplash'),A=String.fromCharCode(1),B=String.fromCharCode(2),i;
 s=s.replace('%s',A);i=s.indexOf('Unsplash');if(i>=0)s=s.slice(0,i)+B+s.slice(i+8);
 s.split(A).forEach(function(part,n){if(n)k.appendChild(link(p.name||'?',p.link));
  part.split(B).forEach(function(x,j){if(j)k.appendChild(link('Unsplash',home));if(x)k.appendChild(document.createTextNode(x))})})}
function loadUnsplash(){api('credits',{}).then(function(r){var ps=r.photos||[],g=$('sg'),home='https://unsplash.com/?utm_source=CleanYourTV&utm_medium=referral';$('sph').className=ps.length?'':'hide';g.innerHTML='';
 ps.forEach(function(p){var c=document.createElement('div'),d=document.createElement('div'),k=document.createElement('div');c.className='uc';d.className='ph';
  if(p.thumb){var m=document.createElement('img');m.loading='lazy';m.src=p.thumb;d.appendChild(m)}
  c.appendChild(d);k.className='cap';credit(k,p,home);
  c.appendChild(k);g.appendChild(c)})})}
$('ss').onclick=function(){msg(t('Testing the key…'));api('save',{key:$('sk').value,query:$('sq').value}).then(function(r){if(r.error)return msg(t(r.error),1);$('sk').value='';UF=0;msg(r.photo?fm('Saved. A new photo by %s is on the TV.',r.photo.name):r.note?t('Saved')+': '+t(r.note):t('Saved'));if(r.photo)loadUnsplash();setTimeout(state,1500)})};
$('so').onclick=function(){api('on',{on:!(S&&S.on)}).then(function(){setTimeout(state,500)})};
$('sd').onclick=function(){if(confirm(t('Remove the Unsplash key from the TV?')))api('disconnect',{}).then(function(){UF=0;LP=-1;$('sk').value=$('sq').value='';$('sph').className='hide';msg(t('Unsplash removed.'));state()})};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;

function page(i18n, esc, lang) {
  const T = s => esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Unsplash</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:28px 0 10px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}input{text-align:left}.hide{display:none}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px 10px}.ph{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#222}
.ph img{width:100%;height:100%;object-fit:cover;display:block}small{color:#888}a{color:#8ab4ff}.cap{font-size:12px;line-height:1.4;margin-top:6px;color:#aaa}</style>
<h1>Unsplash</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<div id=msg></div>
<p>${T('Get a free Access Key at unsplash.com/developers: create an application there and copy its Access Key. A new key may make 50 requests an hour.')}</p>
<p>${T('Photos come from the search words; with none, from the Wallpapers topic.')}</p>
<p>${T('Home asks Unsplash for one new random photo (2 requests) at most every 3 minutes, and the TV saves no picture. In between, and when the hourly limit is used up, photos shown before are shown again.')}</p>
<input id=sk type=password placeholder="${T('Access Key')}" autocomplete=off><input id=sq placeholder="${T('Search words, for example: mountains')}" autocomplete=off>
<button class=p id=ss>${T('Test key and save')}</button>
<div id=sst></div>
<div id=sph class=hide><h2>${T('Recent photos')}</h2><div class=grid id=sg></div></div>
<button id=so></button><button id=sd>${T('Remove Unsplash')}</button></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { page };
