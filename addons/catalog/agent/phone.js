// The phone page of the agent add-on: every app and add-on that signed tools (a tools.json), with a switch each. A source's tools
// reach the voice assistant only after it is switched on here. Plain script for iOS Safari and Android Chrome; the fixed text is
// translated here (ctx.util.i18n), the script's own texts by t().
const PHONE_JS = `var code='',$=function(i){return document.getElementById(i)};
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function showLogin(s){$('login').className='';$('main').className='hide';$('sum').textContent=s||''}
var KIND={addon:'Add-on',app:'App',file:'Registered file'};
function draw(list){$('login').className='hide';$('main').className='';$('sum').textContent='';var box=$('list');box.innerHTML='';
 if(!list.length){var e=document.createElement('p');e.textContent=t('No app or add-on has signed any tools yet.');box.appendChild(e);return}
 list.forEach(function(s){var c=document.createElement('div');c.className='src';
  var h=document.createElement('label');h.className='row';var n=document.createElement('b');n.textContent=s.id;var k=document.createElement('small');k.textContent=t(KIND[s.kind]||s.kind);
  var w=document.createElement('span');w.appendChild(n);w.appendChild(document.createElement('br'));w.appendChild(k);h.appendChild(w);
  var cb=document.createElement('input');cb.type='checkbox';cb.checked=!!s.approved;cb.disabled=!!s.error;
  cb.onchange=function(){api('approve',{source:s.key,approved:cb.checked}).then(function(r){if(r.sources)draw(r.sources)})};h.appendChild(cb);c.appendChild(h);
  if(s.error){var er=document.createElement('p');er.className='e';er.textContent=s.error;c.appendChild(er)}
  s.tools.forEach(function(x){var p=document.createElement('p');var cd=document.createElement('code');cd.textContent=x.name;p.appendChild(cd);
   p.appendChild(document.createTextNode(' '+x.description+(x.confirm?' ('+t('asks you first')+')':'')));c.appendChild(p)});
  box.appendChild(c)})}
function load(){return api('sources').then(function(r){draw(r.sources||[])})}
$('rl').onclick=function(){api('reload',{}).then(function(r){draw(r.sources||[])})};
$('go').onclick=function(){code=$('code').value.trim();load().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))load().catch(function(){});else showLogin();
`;

function page(i18n, esc, lang) {
  const T = s => esc(i18n && i18n.tr ? i18n.tr(lang, s) : s);
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${T('Agent tools')}</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0 auto;padding:20px 16px 60px;max-width:640px}
h1{font-size:26px;margin:4px 0}p{color:#aaa;margin:6px 0}.hide{display:none}.e{color:#f0a0a0}
button,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0}
button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}.src{border:1px solid #2a2b33;border-radius:14px;padding:12px 14px;margin:12px 0}
.row{display:flex;justify-content:space-between;align-items:center}.row input{width:28px;height:28px;margin:0 0 0 12px;flex:none}
small{color:#888}code{color:#ffd9a3;font-size:14px}</style>
<h1>${T('Agent tools')}</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<p>${T('Apps and add-ons that signed tools. Switch one on to let the voice assistant and MCP clients on your network use its tools. Tools that ask you first run only after you say yes to the voice assistant, and never from the network.')}</p>
<div id=list></div><button id=rl>${T('Look for tools again')}</button></div>
` +
    (i18n && i18n.script ? i18n.script(lang, PHONE_JS) : '<script>function t(s){return s}</script>') +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { page };
