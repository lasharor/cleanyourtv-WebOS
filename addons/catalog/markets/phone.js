// The phone page of the markets add-on: the Twelve Data API key for the Stocks card (Test key and save, Remove), and how many of the
// day's credits are used. Plain script for iOS Safari and Android Chrome; the fixed text is translated here (ctx.util.i18n), the
// script's own texts by t().
const PHONE_JS = `var code='',S={},$=function(i){return document.getElementById(i)};
function fm(s){var a=arguments,n=1;return t(s).replace(/%[sd]/g,function(){return a[n++]})}
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function msg(s,e){$('msg').innerHTML=s?'<p class="m'+(e?' e':'')+'"></p>':'';if(s)$('msg').firstChild.textContent=s}
function showLogin(s){$('login').className='';$('main').className='hide';$('sum').textContent=s||''}
function state(){return api('state').then(function(u){S=u;$('login').className='hide';$('main').className='';$('sum').textContent='';
 $('k').placeholder=u.keyHint?fm('API key (saved: %s; leave empty to keep)',u.keyHint):t('API key');
 $('st').textContent=u.configured?fm('Set up. Credits used today: %s of %s.',u.used,u.perDay)+(u.error?' · '+t(u.error):''):t('Not set up.');
 $('rm').className=u.configured?'':'hide'})}
$('sv').onclick=function(){msg(t('Testing the key…'));api('save',{key:$('k').value}).then(function(r){if(r.error)return msg(t(r.error),1);$('k').value='';msg(t('Saved. The Stocks card shows prices within a few minutes.'));state()})};
$('rm').onclick=function(){if(confirm(t('Remove the Twelve Data key from the TV?')))api('disconnect',{}).then(function(){$('k').value='';msg(t('Key removed.'));state()})};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;

function page(i18n, esc, lang) {
  const T = s => esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${T('Stocks and crypto')}</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}input{text-align:left}.hide{display:none}</style>
<h1>${T('Stocks and crypto')}</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<div id=msg></div>
<p>${T('The Stocks card needs a free API key from Twelve Data: sign up at twelvedata.com, then copy the key from your dashboard (API Keys). The Crypto card needs none.')}</p>
<p>${T('The free plan has US stocks and ETFs (AAPL, SPY), 8 credits a minute and 800 a day. Each symbol costs one credit, so a long list is updated less often: every 5 minutes for up to 5 symbols, every 20 minutes for 20, while the US market is open.')}</p>
<input id=k type=password placeholder="${T('API key')}" autocomplete=off>
<button class=p id=sv>${T('Test key and save')}</button>
<p id=st></p>
<button id=rm class=hide>${T('Remove the key')}</button></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { page };
