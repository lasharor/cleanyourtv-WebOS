// The phone page of the Immich add-on: connect to Immich, choose albums, see and hide the synced photos. Plain script for iOS Safari and
// Android Chrome; the fixed text is translated here (ctx.util.i18n), the script's own texts by t().
const PHONE_JS = `var code='',S={},$=function(i){return document.getElementById(i)};
function fm(s){var a=arguments,n=1;return t(s.replace(/%[sd]/g,function(){return a[n++]}))}
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function msg(t,e){$('msg').innerHTML=t?'<p class="m'+(e?' e':'')+'"></p>':'';if(t)$('msg').firstChild.textContent=t}
function showLogin(t){$('login').className='';$('main').className='hide';$('sum').textContent=t||''}
function ago(x){if(!x)return t('never');var m=Math.round((Date.now()-x)/60000);return m<1?t('just now'):m<60?fm('%d min ago',m):m<1440?fm('%d h ago',Math.round(m/60)):fm('%d days ago',Math.round(m/1440))}
function state(){return api('state').then(function(i){S=i;$('login').className='hide';$('main').className='';
 $('sum').textContent=fm('Immich: %d photos',i.photos);
 $('iu').value=$('iu').value||i.url;$('ik').placeholder=i.keyHint?fm('API key (saved: %s; leave empty to keep)',i.keyHint):t('API key');
 $('ist').innerHTML='';var p=document.createElement('p');p.textContent=i.configured?(i.state==='syncing'?fm('Syncing… %d new',i.done):fm('Last sync: %s',ago(i.lastSync))+' · '+fm('%d photos from %d albums',i.photos,i.albums))+(i.error?' · '+t(i.error):''):'';$('ist').appendChild(p);
 $('isy').className=$('idc').className=i.configured?'':'hide';if(i.state==='syncing')setTimeout(state,3000)})}
function thumbs(el){[].forEach.call(el.querySelectorAll('img[data-s]'),function(im){var x=new XMLHttpRequest();x.open('GET','/api/photo/'+im.getAttribute('data-s'));x.setRequestHeader('x-code',code);x.responseType='blob';
 x.onload=function(){if(x.status===200)im.src=URL.createObjectURL(x.response)};x.send()})}
function loadAlbums(){api('albums',{}).then(function(r){if(r.error)return msg(t(r.error),1);var h='';(r.albums||[]).forEach(function(a){h+='<label class=al><input type=checkbox value="'+a.id+'"'+(a.on?' checked':'')+'><span></span><small>'+a.count+'</small></label>'});
 $('al').innerHTML=h;var sp=$('al').querySelectorAll('span');(r.albums||[]).forEach(function(a,i){sp[i].textContent=a.name});$('albox').className=''},function(e){msg(e.error||t('Could not read the albums'),1)})}
function loadPhotos(){api('photos',{}).then(function(r){var ps=r.photos||[];$('iphb').className=ps.length?'':'hide';var g='';ps.forEach(function(p){g+='<div class="ph'+(p.hidden?' off':'')+'" data-h="'+p.id+'"><img loading=lazy src="" data-s="'+p.id+'"></div>'});$('ipg').innerHTML=g;thumbs($('ipg'))})}
$('ipg').onclick=function(e){var t=e.target.closest('[data-h]');if(!t)return;var off=!/off/.test(t.className);api('hide',{id:t.getAttribute('data-h'),hidden:off}).then(function(){t.className='ph'+(off?' off':'');state()})};
$('ic').onclick=function(){msg(t('Connecting…'));api('connect',{url:$('iu').value,key:$('ik').value}).then(function(r){if(r.error)return msg(t(r.error),1);$('ik').value='';msg(t('Connected to Immich.'));state().then(function(){loadAlbums();loadPhotos()})})};
$('as').onclick=function(){var ids=[].map.call($('al').querySelectorAll('input:checked'),function(i){return i.value});api('albums',{ids:ids}).then(function(){msg(t('Albums saved. Syncing…'));setTimeout(state,1500);setTimeout(loadPhotos,8000)})};
$('isy').onclick=function(){api('sync',{}).then(function(){msg(t('Syncing…'));setTimeout(state,1500)})};
$('idc').onclick=function(){if(confirm(t('Disconnect Immich? Its photos are removed from the TV.')))api('disconnect',{}).then(function(){$('albox').className='hide';$('iphb').className='hide';msg(t('Immich disconnected.'));state()})};
$('go').onclick=function(){code=$('code').value.trim();state().then(function(){if(S.configured){loadAlbums();loadPhotos()}}).catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().then(function(){if(S.configured){loadAlbums();loadPhotos()}}).catch(function(){});else showLogin();
`;

function page(i18n, esc, lang) {
  const T = s => esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Immich</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:28px 0 10px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}input{text-align:left}.hide{display:none}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.ph{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#222}
.ph img{width:100%;height:100%;object-fit:cover;display:block}.ph.off img{opacity:.3}.al{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:#1a1b21;margin:6px 0}.al input{width:22px;height:22px;margin:0}small{color:#888}</style>
<h1>Immich</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<div id=msg></div>
<p>${T('Use an API key from Immich (Account settings > API keys) with album.read and asset.read/view permissions.')}</p>
<input id=iu type=url placeholder="https://immich.example.com" autocomplete=off><input id=ik type=password placeholder="${T('API key')}" autocomplete=off>
<button class=p id=ic>${T('Test connection and save')}</button>
<div id=albox class=hide><h2>${T('Albums')}</h2><div id=al></div><button class=p id=as>${T('Save albums and sync')}</button></div>
<div id=ist></div>
<div id=iphb class=hide><h2>${T('Synced photos')} <small>${T('tap to hide or show one')}</small></h2><div class=grid id=ipg></div></div>
<button id=isy>${T('Sync now')}</button><button id=idc>${T('Disconnect Immich')}</button></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { page };
