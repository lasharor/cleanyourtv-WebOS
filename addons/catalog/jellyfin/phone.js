// The phone page of the Jellyfin add-on: the address of your Jellyfin server, your user name and password (sent to Jellyfin once, for
// the sign-in; the TV keeps only the access token Jellyfin answers), and signing out. Plain script for iOS Safari and Android Chrome;
// the fixed text is translated here (ctx.util.i18n), the script's own texts by t().
const PHONE_JS = `var code='',$=function(i){return document.getElementById(i)};
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function showLogin(s){$('login').className='';$('main').className='hide';$('sum').textContent=s||''}
function msg(s,e){$('msg').innerHTML='';if(!s)return;var p=document.createElement('p');p.className='m'+(e?' e':'');p.textContent=s;$('msg').appendChild(p)}
function show(s){$('login').className='hide';$('main').className='';$('sum').textContent='';
 $('ju').value=$('ju').value||s.url||'';$('jn').value=$('jn').value||s.user||'';
 if(s.connected){msg(t('Connected to Jellyfin.')+' '+(s.server?s.server+' · ':'')+s.user);$('out').className=''}else $('out').className='hide'}
function state(){return api('state').then(show)}
$('in').onclick=function(){msg(t('Connecting…'));api('signin',{url:$('ju').value,user:$('jn').value,password:$('jp').value}).then(function(r){$('jp').value='';if(r.error)return msg(r.error,1);show(r)})};
$('out').onclick=function(){api('signout',{}).then(function(r){msg(t('Signed out of Jellyfin.'));show(r)})};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;
function page(i18n, esc, lang) {
  const T = s => esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Jellyfin</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0;color:#eee}.m.e{background:#3a1717}
button,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0}
button{text-align:center}button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}.hide{display:none}label{display:block;margin-top:14px;color:#aaa;font-size:14px}</style>
<h1>Jellyfin</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<p>${T('Sign in to your Jellyfin server for the Continue watching card. The password goes to Jellyfin once; the TV keeps only the access token.')}</p>
<div id=msg></div>
<label for=ju>${T('Server address')}</label><input id=ju type=url placeholder="http://192.168.1.10:8096" autocomplete=off autocapitalize=off spellcheck=false>
<label for=jn>${T('User name')}</label><input id=jn type=text autocomplete=username autocapitalize=off spellcheck=false>
<label for=jp>${T('Password')}</label><input id=jp type=password autocomplete=current-password>
<button class=p id=in>${T('Sign in')}</button><button id=out class=hide>${T('Sign out')}</button></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { page };
