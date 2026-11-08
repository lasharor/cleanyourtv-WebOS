// The page a paired phone opens for the phone remote (service.js): pairing with the code shown on the TV, then buttons, a touchpad and
// text entry. The page keeps a WebSocket to the TV open while it is on screen: it says who it is with the token it kept in localStorage,
// checks that the TV still answers (a ping every five seconds, dropped after four without an answer), and reconnects by itself after a
// drop, a sleep or a restart of the service.
// The look follows the redesign: a round pad with a large OK, volume and channel rockers, numbers and colours in a sheet, a tab bar, and a
// status line under the TV name for every message. Spacing is by sibling margins (no flex gap: Chromium 68), and the page is always left to right.
// the texts are translated with the service's i18n, which the add-on gets as ctx.util.i18n (a catalog add-on cannot require it); `esc`
// is helper/web.js's, kept here because the add-on gets only its ctx
// The Home Screen icon's address carries a short hash of the icon (?v=): iOS keeps an icon it fetched once, so a changed icon needs a new
// address to be fetched again. service.js serves the icons whatever comes after the ?.
const ICON_V = (() => {
  try {
    const f = require('path').join(__dirname, 'pwa', 'icon-180.png');
    return require('crypto').createHash('sha1').update(require('fs').readFileSync(f)).digest('hex').slice(0, 8);
  } catch (_) {
    return '1';
  }
})();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const PHONE_JS = `document.documentElement.dir='ltr'; /* the remote is laid out like a real one in every language: the arrows must not swap sides */
var KEY='cytv-remote',curTab='kb',liveOk=false,appsIn=false,liveIn=false,tok='',ws=null,timer=0,delay=1000,lastRx=0,lastPing=0,lastAsk=0,pwrState='',n=0,blocked=false,ready=false,lastTouch=0,prev='',mac='',wol=null,offAt=0,MK='cytv-tvmac',$=function(i){return document.getElementById(i)};
/* the visible height of the page (a phone answers with the part under its address bar): the screen fills it above the tab bar */
function fit(){
  var v=window.visualViewport,h=(v&&v.height)||window.innerHeight||0;
  if(h>200)document.documentElement.style.setProperty('--appH',h+'px')
}
fit();
window.addEventListener('resize',fit);
window.addEventListener('orientationchange',fit);
try{if(window.visualViewport)window.visualViewport.addEventListener('resize',fit)}catch(e){}
/* app titles come from the TV, they are not ours: they go into HTML escaped */
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function store(v){try{if(v)localStorage.setItem(KEY,v);else localStorage.removeItem(KEY)}catch(e){}}
function stored(){try{return localStorage.getItem(KEY)||''}catch(e){return ''}}
/* the app: the connect QR code on the TV carries the pairing code. Scanning it fills the code in and stays on the pairing screen, with the
   cursor in the name of the device, so the name can be changed before Pair this device is tapped. A page that is already connected
   ignores it, so scanning twice does not add the phone twice. */
window.cytvPair=function(code){code=String(code||'').replace(/\\D/g,'');if(code.length!==6||ready)return false;
 tok='';blocked=false;show('pairbox');$('code').value=code;cells();
 setTimeout(function(){var n=$('pname');try{n.focus();n.select()}catch(e){}cells()},120);return true};
/* An app that wraps this page (window.CYTV_APP) can send the wake packet itself: it asks this page for the TV's address (setMac) and this page asks it to wake (wake).
   In a browser window.CYTV_APP does not exist, and a page cannot send UDP, so a browser can only show the address: the Power sheet does
   that, and points at an app that can. The TV's address is kept here too, for that sheet. */
function native(){return !!(window.CYTV_APP&&window.CYTV_APP.wake)}
function waking(){offAt=0;power(false);status('off','');drop();delay=1000;retry(2500)} /* no banner: the header button and its status line show the wait */
function wakeNow(){if(!native())return;var ok=false;try{ok=window.CYTV_APP.wake()}catch(e){}
 if(!ok){say(t('No TV saved yet. Connect once.'),'warn',5000);return}
 if(wol===false)say(t('Wake-on-LAN is off. Turn on TV On With Mobile in the TV settings.'),'warn',5000);
 buzz();pendStart('on');waking()}
/* the on/off button of the app: it says what the TV is doing and does the other thing when it is tapped, with nothing to choose */
/* POWER is the TV's own toggle: from standby with Quick Start+ the screen comes back, and from on it goes to standby */
function powerPress(){if(pwBusy())return;if(!send({t:'key',k:'POWER'}))return;offAt=Date.now();buzz();pendStart(onNow()?'off':'on');ask();setTimeout(ask,1500);setTimeout(ask,4000)}
/* The TV takes seconds to answer a power press, and nothing says so unless the button does: from the tap until the TV's own state matches,
   the button shows a ring and "Turning on/off", the status line says what is happening, and the keys dim. No progress bar or countdown:
   the wait is not known. After 8 s the status line says it is slow; after 45 s the page gives up, without claiming the TV is off. A second
   tap does nothing (a second POWER key would undo the first); nothing is offered to press again. */
var pend=null,pendT=[],pendFail=0,pendOkT=0;
function pendClear(){for(var i=0;i<pendT.length;i++){clearTimeout(pendT[i]);clearInterval(pendT[i])}pendT=[];pend=null}
function pendStart(to){pendClear();clearTimeout(pendFail);pendFail=0;clearTimeout(pendOkT);pendOkT=0;pend={to:to,slow:false,nudge:false};
 pendT.push(setTimeout(function(){if(pend){pend.slow=true;mark()}},8000));
 pendT.push(setTimeout(function(){pendClear();pendFail=setTimeout(function(){pendFail=0;mark()},15000);buzz();mark()},45000));
 pendT.push(setInterval(ask,2000));
 mark()}
function pendOk(){pendClear();clearTimeout(pendOkT);pendOkT=setTimeout(function(){pendOkT=0;mark()},1500);buzz()}
function pwBusy(){if(!pend)return false;pend.nudge=true;mark();setTimeout(function(){if(pend){pend.nudge=false;mark()}},1400);buzz();return true}
var tvDown=false; /* the TV is off or not answering: the tab lists say so instead of showing an old one */
function onNow(){return pwrState?(pwrState==='Active'||pwrState==='Screen Saver'):ready}
function mark(){if(!$('pwrlb'))return;var on=onNow(),lb=$('pwrlb'),e=$('pwr');
 /* settled: the TV's own state says so (a TV that stopped answering after a turn off counts), never just that the key was sent */
 if(pend&&((pwrState&&on===(pend.to==='on'))||(!pwrState&&!ready&&pend.to==='off')))pendOk();
 var cls='info pwr'+(on?' on':''),txt=on?t('On'):t('Off'),st=null;
 if(pend){var up=pend.to==='on';cls='info pwr '+(up?'pend':'pendoff')+(pend.nudge?' nudge':'');txt=up?t('Turning on'):t('Turning off');
  st=['w',pend.nudge?t('Still working, one moment'):up?(pend.slow?t('Still trying. Waking can take a few seconds.'):t('Waking the TV…')):(pend.slow?t('Still working, one moment'):t('Turning off…'))];}
 else if(pendFail)st=['w',t("Can't reach the TV")];
 else if(pendOkT)st=[on?'ok':'off',on?t('TV is on'):t('TV is off')];
 var ch=lb.textContent!==txt;lb.textContent=txt;lb.className=ch?'lbin':(lb.className==='hide'?'':lb.className);e.className=cls;e.setAttribute('aria-label',pend?(pend.to==='on'?t('Turning on'):t('Turning off')):on?t('Turn off'):t('Turn on'));e.setAttribute('aria-busy',pend?'true':'false');
 $('pwring').setAttribute('class',pend?'':'hide');$('pwpop').className=pendOkT?'pop':'pop hide';
 if(pend)$('remote').setAttribute('data-p',pend.to);else $('remote').removeAttribute('data-p');
 var tone=note&&({info:'msg',warn:'w',bad:'off'})[note.tone];
 if(note&&note.tone!=='info'||(note&&!pend))st=[tone,note.text];
 if(!st&&stBase)st=[stBase[0].replace(/^st /,''),stBase[1]];
 if(st){$('st').className='st '+st[0];$('stt').textContent=st[1]}}
/* the TV's regular QR code carries the pairing code (?code=...): opened from a camera, this page fills the code in and waits for the name and the tap on Pair this device.
   The code in the address is used once and then taken out of it: a phone that is already paired must never be unseated by a refresh
   of a page that still had the old code in its address. */
function tidy(){try{history.replaceState(null,'','/')}catch(e){}}
function autoPair(){
  var m=/[?&]code=(\\d{6})/.exec(location.search||'');
  if(!m)return;
  /* Safari on an iPhone that is paired already and scans the code: the person is most likely adding the remote to the Home Screen, whose
     app has to pair by itself with this very code. The page tells the TV to keep the pairing window open (keep in hello), and says so */
  if(tok&&IOSWEB){HAND=true;setTimeout(function(){say(t('To use the remote as an app: Share > Add to Home Screen now. The app pairs with this code.'),'',9000)},800)}
  if(tok||ready){tidy();return}
  /* the Home Screen app opens its start address, code and all, every time: a code it has filled in once is not filled in again */
  if(homeApp()){var used='';try{used=localStorage.getItem(UK)||''}catch(e){}if(used===m[1]){$('code').value='';cells();tidy();return}try{localStorage.setItem(UK,m[1])}catch(e){}}
  /* in Safari on an iPhone the card at the top says what to do first: the code goes into the box without moving the focus (and the page) to the name */
  if(IOSWEB){$('code').value=m[1];cells();return}
  window.cytvPair(m[1]);
  /* the code is in the box now: it does not stay in the address. In Safari on an iPhone it does, until this page pairs: Add to Home Screen
     takes the address with it (or the manifest's start_url, which carries the same code), and the app pairs with it */
  tidy()
}
/* iPhone and iPad: there is no app to install, but this page can live on the Home Screen as an app (the TV serves the manifest and the
   icons). Such an app keeps its own storage, apart from Safari's, so a phone paired in Safari is not paired in the app: in Safari the
   pairing screen says to add the page to the Home Screen first. A wrapper app (window.CYTV_APP) is never told so. */
var UK='cytv-code-used',HAND=false;
function ios(){var k=kind();return k==='iPhone'||k==='iPad'}
function homeApp(){try{if(navigator.standalone)return true;return !!(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)}catch(e){return false}}
var IOS=ios(),IOSWEB=IOS&&!homeApp()&&!window.CYTV_APP;
function show(id){$('pairbox').className=id==='pairbox'?'':'hide';$('remote').className=id==='remote'?'':'hide';$('tabbar').className=id==='remote'?'':'hide';if(id==='pairbox'&&!IOSWEB)setTimeout(function(){$('code').focus();cells()},50)} /* in Safari on an iPhone the card at the top is read first */
function status(c,s){var off=c==='off';if(off)pwrState=''; /* the status line under the TV name says it, nothing covers the keys */
 stBase=['st '+c,c==='ok'?t('Connected'):(s||(off?t('Off'):''))];
 /* the keys are never greyed out: they look the same whether the TV is on or off, and the header says which it is */
 tvDown=off;if(off){appsIn=false;liveIn=false;if(curTab==='ap')noTv($('apgrid'));if(curTab==='lv')noTv($('lvgrid'))}
 mark()}
/* A short message shows in the status line under the TV name for a few seconds, then the real status comes back (no toast over the keys).
   Tones: info (white), warn (amber), bad (red). A warning or an error is shown over a power wait; an info message waits for it. */
var note=null,noteT=0,stBase=null;
function say(text,tone,ms){note={text:text,tone:tone};clearTimeout(noteT);noteT=setTimeout(function(){note=null;mark()},ms||2500);mark()}
/* The first guess for the name field, best source first: the Android app (the name set in Android settings, or maker and model), the name the
   router has for this phone (HINT, put in by the TV), then what the browser says about the kind of device, then 'Device'. It can be edited. */
function has(u,s){return u.indexOf(s)>=0}
function kind(){var u=navigator.userAgent||'',tp=navigator.maxTouchPoints||0;
 if(has(u,'iPad')||(has(u,'Macintosh')&&tp>1))return 'iPad';
 if(has(u,'iPhone')||has(u,'iPod'))return 'iPhone';
 if(has(u,'Android'))return has(u,'Mobile')?'Android phone':'Android tablet';
 if(has(u,'CrOS'))return 'Chromebook';
 var b=has(u,'Edg/')?'Edge':has(u,'OPR/')||has(u,'Opera')?'Opera':has(u,'Firefox/')?'Firefox':has(u,'Chrome/')?'Chrome':has(u,'Safari/')?'Safari':'',
  o=has(u,'Windows')?'Windows':has(u,'Macintosh')?'Mac':has(u,'Linux')||has(u,'X11')?'Linux':'';
 return b&&o?b+' on '+o:'Device'}
function plain(s){var r='',i,c;s=String(s||'');for(i=0;i<s.length;i++){c=s.charCodeAt(i);if(c>31&&c!==127&&'<>"&'.indexOf(s.charAt(i))<0)r+=s.charAt(i)}return r.trim().slice(0,30)}
function guess(){var n='';try{if(window.CYTV_APP&&window.CYTV_APP.deviceName)n=plain(window.CYTV_APP.deviceName())}catch(e){}
 return n||(typeof HINT==='string'&&plain(HINT))||kind()}
var pnoteT=0;
function pnote(s,k,ms){var e=$('pnote');clearTimeout(pnoteT);e.textContent=s;e.setAttribute('role',k==='warn'?'alert':'status');e.className=k||'';void e.offsetWidth;e.className=(k||'')+' on';pnoteT=setTimeout(function(){e.className=k||''},ms||3000)}
function showPair(s,k){tok='';ready=false;show('pairbox');if(s)pnote(s,k||'warn',10000)}
var pairing=false; /* a second tap while the first pair is in flight would post the same code twice: the second 403 would show over the remote */
function pair(){if(pairing)return;pairing=true;var x=new XMLHttpRequest();x.open('POST','/api/pair');x.setRequestHeader('content-type','application/json');
 x.onload=function(){pairing=false;var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(j.token){clearTimeout(pnoteT);$('pnote').className='';store(j.token);tok=j.token;blocked=false;delay=1000;tidy();show('remote');connect()}else pnote(j.error||t('That code is not right. Check the 6 digits on the TV screen.'),'warn',10000)};
 x.onerror=x.ontimeout=function(){pairing=false;pnote(t('The TV did not answer. Check the phone is on the same Wi-Fi as the TV.'),'warn',10000)};x.timeout=15000;
 x.send(JSON.stringify({code:$('code').value.trim(),name:$('pname').value.trim()}))}
function ask(){if(!(ws&&ws.readyState===1))return;lastAsk=Date.now();try{ws.send(JSON.stringify({t:'power'}))}catch(e){}}
function retry(ms){clearTimeout(timer);timer=setTimeout(connect,ms||delay);delay=Math.min(delay*2,10000)}
function connect(){if(!tok||(ws&&ws.readyState<2))return;clearTimeout(timer);status('w',t('Connecting…'));
 var w;try{w=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws')}catch(e){retry();return}
 ws=w;lastRx=Date.now();upFail=0;
 w.onopen=function(){w.send(JSON.stringify(HAND?{t:'hello',token:tok,keep:true}:{t:'hello',token:tok}))};
 w.onmessage=function(e){lastRx=Date.now();var m;try{m=JSON.parse(e.data)}catch(x){return}
  if(m.t==='ready'){ready=true;tvDown=false;blocked=false;delay=1000;status('ok',t('Connected'));$('who').title=m.name||'';if(m.tv){$('tvname').textContent=m.tv;try{localStorage.setItem('cytv-tvname',m.tv)}catch(e){}}try{if(window.CYTV_APP&&CYTV_APP.setName)CYTV_APP.setName(m.tv||'')}catch(e){}me={name:m.name||'',seen:m.seen||0,created:m.created||0};mac=m.mac||'';wol=m.wol;offAt=0;ask();appsIn=false;liveIn=false;loadLive();
   if(mac){try{localStorage.setItem(MK,mac)}catch(e){};try{if(window.CYTV_APP&&window.CYTV_APP.setMac)window.CYTV_APP.setMac(mac)}catch(e){}}}
  else if(m.t==='denied'){if(leaving)return;ready=false;if(m.reason==='blocked'){blocked=true;status('off',t('Blocked on the TV'))}else{store('');showPair(t('This phone was removed on the TV. Pair it again.'))}}
  else if(m.t==='bye'){if(lgAck)lgAck()}
  else if(m.t==='power'){pwrState=String(m.state||'');mark()}
 else if(m.t==='ack'&&!m.ok&&padMv&&m.n===padMv){padKeysUntil=Date.now()+30000;padMv=0}
 else if(m.t==='ack'&&!m.ok&&m.e){if(pend)pendClear();say(t('TV said:')+' '+m.e,'bad',4000)}};
 w.onclose=function(e){if(ws===w)ws=null;ready=false;if(leaving)return;
  var why=e&&e.code;
  /* the TV closes with a code that says what happened: a phone that was removed goes back to pairing, a blocked one waits */
  if(why===4401){if(leaving)return;store('');showPair(t('This phone was removed on the TV. Pair it again.'));return}
  if(why===4403){blocked=true;status('off',t('Blocked on the TV'));retry(15000);return}
  if(!tok||blocked)return retry(15000);
  var app=native(),justOff=Date.now()-offAt<60000;
  if(app)status('off',''); /* the header button turns to Off by itself */
  else if(justOff)status('off',t('TV is off'));
  else status('off',t("Can't reach the TV")); /* silence is not proof that it is off: it may be on another network */
  retry(justOff?5000:undefined)};
 w.onerror=function(){}}
function drop(){var w=ws;ws=null;ready=false;if(w){w.onclose=null;try{w.close()}catch(e){}}}
function wake(){if(!tok)return;if(!ws||ws.readyState>1){delay=1000;connect();return}ping();setTimeout(function(){if(tok&&Date.now()-lastRx>4000+(Date.now()-lastPing)){drop();delay=1000;connect()}},3000)}
function ping(){lastPing=Date.now();if(ws&&ws.readyState===1)ws.send('{"t":"ping"}')}
var padKeysUntil=0,padMv=0;
function send(o){if(!ready||!ws||ws.readyState!==1){say(t('Not connected'),'warn',2500);return false}o.n=++n;ws.send(JSON.stringify(o));return true}
/* the app can ask the phone whether the TV answers at all: a TV that went to standby does not close the socket, it just stops */
function upNow(){try{return A_up?A_up():true}catch(e){return true}}
var A_up=null,upFail=0; /* one slow connect on a phone that saves power is not a TV that is off: two in a row are */try{if(window.CYTV_APP&&window.CYTV_APP.up)A_up=function(){return window.CYTV_APP.up()}}catch(e){}
setInterval(function(){if(!tok)return;
 if(ws&&ws.readyState===1){
  /* the app asks the phone whether the TV answers at all; a browser asks the TV itself, with a ping it must answer at once */
  if(A_up&&ready){if(upNow())upFail=0;else if(++upFail>=2){upFail=0;ready=false;drop();status('off','');retry(1500);return}}
  if(ready&&Date.now()-lastPing>5000)ping();
  if(ready&&Date.now()-lastAsk>5000)ask();
  if(ready&&lastRx<lastPing&&Date.now()-lastPing>4000){ready=false;drop();status('off','');retry(1500);return}
 }else if(!ws&&!blocked&&!timer)connect()},3000);
document.addEventListener('visibilitychange',function(){upFail=0;if(!document.hidden)wake()});window.addEventListener('online',wake);window.addEventListener('pageshow',wake);window.addEventListener('focus',wake);
/* power: the button in the header says what the TV is doing and toggles it, with nothing to choose. A tap is the TV's POWER key; in the app,
   with the TV not answering, it sends the wake packet; in a browser it can only try to reconnect, since a page cannot send UDP. With the TV on, a
   hold on the button (not a tap) opens the sheet: the screen off, the soft off, a restart and a shut down. */
var pwT=0,pwHeld=false,pwArm='',pwArmT=0;
function disarm(){pwArm='';clearTimeout(pwArmT);
 Array.prototype.forEach.call(document.querySelectorAll('.pwrow'),function(b){
  b.className='pwrow';var s=b.querySelector('small'),x=b.getAttribute('data-x');if(s&&x)s.textContent=x})}
function power(on){disarm();$('pws').className=on?'scrim':'hide';if(on)ask()}
/* one row, one call: the two that cannot be taken back want a second tap within four seconds, and say so while they wait for it */
function pwAct(a){
 if(!ready){say(t('Not connected'),'warn',2500);return}
 if(pwBusy()){power(false);return}
 if(!send({t:'tvpower',a:a}))return;
 power(false);
 /* the button and the status line show the wait, as for a tap: all four end with the TV not on (a restart and a shut down end with it not answering) */
 offAt=Date.now();buzz();pendStart('off')}
Array.prototype.forEach.call(document.querySelectorAll('.pwrow'),function(b){
 var s=b.querySelector('small'),a=b.getAttribute('data-a');
 if(s)b.setAttribute('data-x',s.textContent);
 b.onclick=function(){
  if(a==='reboot'||a==='shutdown'){
   if(pwArm!==a){disarm();pwArm=a;b.className='pwrow arm';
    if(s)s.textContent=t(a==='reboot'?'Tap again to restart the TV.':'Tap again to shut the TV down.');
    pwArmT=setTimeout(disarm,4000);return}
   disarm()}
  pwAct(a)}});
/* a hold on the power button, the TV on, is the way in: a tap is still the TV's own POWER key (standby, and standby back on) */
function pwDown(e){
 if(e.type==='touchstart')lastTouch=Date.now();else if(Date.now()-lastTouch<700)return;
 pwHeld=false;clearTimeout(pwT);
 if(!(ready&&onNow()))return; /* the TV is off: a tap turns it on, and there is nothing to choose */
 pwT=setTimeout(function(){pwHeld=true;buzz();power(true)},480)}
function pwUp(){clearTimeout(pwT)}
['touchstart','mousedown'].forEach(function(ev){$('pwr').addEventListener(ev,pwDown,{passive:true})});
['touchend','touchcancel','mouseup','mouseleave'].forEach(function(ev){$('pwr').addEventListener(ev,pwUp)});
$('pwr').onclick=function(){if(pwHeld){pwHeld=false;return}if(pwBusy())return;if(ready)powerPress();else if(native())wakeNow();else{drop();delay=1000;blocked=false;connect();say(t('Turn the TV on with its own remote'),'warn',4000)}};
$('xpw').onclick=function(){power(false)};$('pws').onclick=function(e){if(e.target===$('pws'))power(false)};
/* buttons: a press at once, held down repeats (arrows, volume, channel) */
/* the app answers a key press with a short tick (window.CYTV_APP.buzz): a WebView has no navigator.vibrate, so a browser only gets the
   old attempt, which some phones honour and most do not */
function buzz(){try{if(window.CYTV_APP&&window.CYTV_APP.buzz){window.CYTV_APP.buzz();return}}catch(e){}try{if(navigator.vibrate){navigator.vibrate(8);return}}catch(e){}haptic()}
/* An iPhone has no navigator.vibrate, but a switch (<input type=checkbox switch>, Safari 17.4 and newer) ticks when it is toggled, also when
   a script clicks its label. A hidden one is clicked for each key. Safari counts such a click only while the person is acting, and a touch
   counts when the finger lifts (touchend), not when it lands: the keys answer on touchstart, so the tick waits for the touchend that follows.
   Not while text is being typed (a text field on screen has the focus): the click must not take the focus from the box. The click focuses
   the switch itself, so it gives the focus back at once. */
var hap=null,hapDue=false;
function haptic(){if(IOS)hapDue=true}
if(IOS)document.addEventListener('touchend',function(){if(hapDue){hapDue=false;tickNow()}},true);
function tickNow(){try{var a=document.activeElement;if(a&&(a.tagName==='TEXTAREA'||(a.tagName==='INPUT'&&a.type!=='checkbox'))&&a.offsetWidth)return;
 if(!hap){hap=document.createElement('label');hap.setAttribute('aria-hidden','true');hap.style.cssText='position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none';
  hap.innerHTML='<input type=checkbox switch tabindex=-1>';document.body.appendChild(hap)}
 hap.click();if(document.activeElement===hap.firstChild)hap.firstChild.blur()}catch(e){}}
/* Since iOS 26.5 Safari ticks only when the finger itself toggles a switch: a click from script (haptic() above) stays silent. So on an
   iPhone each key carries a see-through label for one hidden switch, the finger's tap lands on the label, and the label passes the tap to the
   switch. For that the tap must become a click, so on an iPhone a key does not cancel its touchstart; the mouse events Safari sends after the
   touch are ignored as before (lastTouch). The switch gives the focus back at once, so typing is not interrupted. */
var hsw=null;
function overlay(el){try{if(!hsw){hsw=document.createElement('input');hsw.type='checkbox';hsw.setAttribute('switch','');hsw.id='hsw';hsw.tabIndex=-1;hsw.setAttribute('aria-hidden','true');
  hsw.style.cssText='position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';hsw.addEventListener('focus',function(){hsw.blur()});document.body.appendChild(hsw)}
 if(window.getComputedStyle(el).position==='static')el.style.position='relative';
 var l=document.createElement('label');l.htmlFor='hsw';l.className='hapov';l.setAttribute('aria-hidden','true');el.appendChild(l)}catch(e){}}
function bind(el){var k=el.getAttribute('data-k'),rep=el.getAttribute('data-r'),t1=0,t2=0,ov=IOS&&!window.CYTV_APP;
 if(ov)overlay(el);
 function go(){send({t:'key',k:k});if(!ov)buzz()}
 function down(e){if(e.type==='touchstart')lastTouch=Date.now();else if(Date.now()-lastTouch<700)return;if(!(ov&&e.type==='touchstart'))e.preventDefault();go();el.className+=' on';
  if(rep){t1=setTimeout(function(){t2=setInterval(go,110)},380)}}
 function up(){clearTimeout(t1);clearInterval(t2);el.className=el.className.replace(' on','')}
 el.addEventListener('touchstart',down,{passive:false});el.addEventListener('mousedown',down);
 ['touchend','touchcancel','mouseup','mouseleave'].forEach(function(ev){el.addEventListener(ev,up)})}
Array.prototype.forEach.call(document.querySelectorAll('[data-k]'),bind);
/* the touchpad moves the pointer of the TV like the phone app of LG: the moves of the finger are collected and sent about 30 times a
   second in one message each, with a gain that grows with the speed of the finger, and the TV draws the pointer where it is. The first
   time the TV asks on its screen to allow the service; until then (or on a TV that has no pointer) the pad falls back for half a minute
   to arrow keys. A key is a process on the TV, about 95 ms each, so the keys are paced: one every 45 ms at most, what the finger moved
   beyond five steps is dropped, the rest plays out after the finger lifts. A tap clicks (OK with keys), two fingers up or down scroll,
   a tap with two fingers is Back. */
(function(){var pad=$('pad'),fg=$('pfing'),pr=null,x0=0,y0=0,t0=0,tm=0,moved=0,most=0,ax=0,ay=0,px=0,py=0,sc=0,cnt=0,two=0,tk=null,down=0,ptr=1,LIM=20;
 function raw(o){if(ready&&ws&&ws.readyState===1)ws.send(JSON.stringify(o))}
 function step(k){send({t:'key',k:k})}
 function flush(){var dx=Math.round(px),dy=Math.round(py),sy=Math.round(sc);
  if(dx||dy){px-=dx;py-=dy;var o={t:'move',dx:dx,dy:dy};if(++cnt%15===1){o.n=++n;padMv=o.n}raw(o)}
  if(sy){sc-=sy;raw({t:'scroll',dy:sy})}}
 function tick(){if(ptr){flush();if(!down)stop();return}
  var lim=two?16:LIM,X=Math.abs(ax),Y=Math.abs(ay);
  if(X<lim&&Y<lim){if(!down)stop();return}
  if(X>=Y){step(ax>0?'RIGHT':'LEFT');ax+=ax>0?-lim:lim}else{step(ay>0?'DOWN':'UP');ay+=ay>0?-lim:lim}
  ax=Math.max(-5*lim,Math.min(5*lim,ax));ay=Math.max(-5*lim,Math.min(5*lim,ay))}
 function stop(){if(tk){clearInterval(tk);tk=null}ax=ay=px=py=sc=0}
 pad.addEventListener('touchstart',function(e){e.preventDefault();var p=e.touches[0];if(e.touches.length===1){x0=p.clientX;y0=p.clientY;t0=tm=Date.now();moved=0;ax=ay=px=py=sc=0;most=1;down=1;ptr=Date.now()>padKeysUntil;pr=pad.getBoundingClientRect();pad.className='pad on';fg.style.transform='translate('+(p.clientX-pr.left)+'px,'+(p.clientY-pr.top)+'px)';if(!tk)tk=setInterval(tick,ptr?33:45)}else most=Math.max(most,e.touches.length)},{passive:false});
 pad.addEventListener('touchmove',function(e){e.preventDefault();var p=e.touches[0],dx=p.clientX-x0,dy=p.clientY-y0,now=Date.now(),sp=Math.sqrt(dx*dx+dy*dy)/Math.max(now-tm,8);two=e.touches.length>1;tm=now;if(pr)fg.style.transform='translate('+(p.clientX-pr.left)+'px,'+(p.clientY-pr.top)+'px)';x0=p.clientX;y0=p.clientY;moved+=Math.abs(dx)+Math.abs(dy);
  if(ptr){var g=2.2+Math.min(sp*1.6,3.3);if(two)sc+=dy*1.5;else{px+=dx*g;py+=dy*g}return}
  var k=1+Math.min(sp*1.5,3);if(two)dx=0;ax+=dx*k;ay+=dy*k},{passive:false});
 pad.addEventListener('touchend',function(e){e.preventDefault();if(e.touches.length){x0=e.touches[0].clientX;y0=e.touches[0].clientY;return}down=0;pad.className='pad';if(moved<10&&Date.now()-t0<350){if(most>1)step('BACK');else if(ptr)send({t:'click'});else step('ENTER');buzz()}most=0},{passive:false});
 pad.addEventListener('touchcancel',function(){down=0;most=0;pad.className='pad';stop()})})();
/* the scroll strip at the right of the pad, as in the phone app of LG: a finger on the black thumb moves it up or down the bar, and the page
   on the TV scrolls by as much as the finger moved, also when the thumb is at the end of the bar. The thumb slides back to the middle when the finger lifts. With
   no pointer (the keys fall back) it presses UP and DOWN, one every 45 ms at most. */
(function(){var bar=$('sbar'),th=$('sthumb'),y0=0,off=0,sc=0,kc=0,tk=null;
 function lim(){return Math.max(0,(bar.clientHeight-th.offsetHeight)/2)}
 function tick(){if(Date.now()>padKeysUntil){var d=Math.round(sc);if(d){sc-=d;if(ws&&ws.readyState===1&&ready)ws.send(JSON.stringify({t:'scroll',dy:d}))}}
  else{if(Math.abs(kc)>=24){send({t:'key',k:kc>0?'DOWN':'UP'});kc+=kc>0?-24:24;kc=Math.max(-120,Math.min(120,kc))}}}
 function stop(){if(tk){clearInterval(tk);tk=null}sc=0;kc=0}
 function back(){bar.className='sbar';off=0;th.style.transition='transform .22s ease-out';th.style.transform='translateY(0)'}
 bar.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();y0=e.touches[0].clientY;sc=kc=0;th.style.transition='none';bar.className='sbar drag';if(!tk)tk=setInterval(tick,40)},{passive:false});
 bar.addEventListener('touchmove',function(e){e.preventDefault();e.stopPropagation();var y=e.touches[0].clientY,dy=y-y0;y0=y;off=Math.max(-lim(),Math.min(lim(),off+dy));th.style.transform='translateY('+off+'px)';sc-=dy*2.4;kc+=dy},{passive:false});
 bar.addEventListener('touchend',function(e){e.preventDefault();e.stopPropagation();tick();stop();back()},{passive:false});
 bar.addEventListener('touchcancel',function(){stop();back()})})();
/* the pad and the strip also take a mouse (a computer, a tablet with a mouse): a mouse drag is played to the same handlers as a finger, the wheel
   over the pad scrolls, and a right click is Back */
(function(){var last=0;
 function fake(el,type,e){var ev=document.createEvent('Event'),t=[{clientX:e.clientX,clientY:e.clientY}];ev.initEvent(type,true,true);ev.touches=type==='touchend'?[]:t;ev.changedTouches=t;el.dispatchEvent(ev)}
 function bridge(el){var d=0;el.addEventListener('mousedown',function(e){if(e.button)return;d=1;e.preventDefault();e.stopPropagation();fake(el,'touchstart',e)});
  window.addEventListener('mousemove',function(e){if(d)fake(el,'touchmove',e)});
  window.addEventListener('mouseup',function(e){if(d){d=0;fake(el,'touchend',e)}})}
 bridge($('pad'));bridge($('sbar'));
 $('pad').addEventListener('wheel',function(e){e.preventDefault();var n=Date.now();if(n-last<30||Date.now()<padKeysUntil)return;last=n;if(ready&&ws&&ws.readyState===1)ws.send(JSON.stringify({t:'scroll',dy:-Math.max(-200,Math.min(200,Math.round(e.deltaY)))}))},{passive:false});
 $('pad').addEventListener('contextmenu',function(e){e.preventDefault();send({t:'key',k:'BACK'});buzz()})})();
/* tabs, the numbers sheet */
function tab(id){curTab=id;['kb','tp','ap','lv'].forEach(function(i){var p=$(i),b=$('b'+i);if(p)p.className=i===id?'':'hide';if(b)b.className=i===id?'tab on':'tab'});if(id==='ap'){if(tvDown){appsIn=false;noTv($('apgrid'))}else if(!appsIn)loadApps()}
if(id==='lv'){if(tvDown){liveIn=false;noTv($('lvgrid'))}else if(!liveIn)loadLive()}}
/* the Inputs sheet: the TV's own list, and picking one switches the TV to it (the launcher's input app, started like any app) */
function inputsOpen(on){$('ins').className=on?'':'hide';if(on)loadInputs()}
function loadInputs(){
  var g=$('inslist');
  if(!g)return;
  g.innerHTML='<p class=apmsg>'+esc(t('Loading…'))+'</p>';
  var x=new XMLHttpRequest();
  x.open('GET','/api/inputs?t='+encodeURIComponent(tok));
  x.onload=function(){
    var j={};try{j=JSON.parse(x.responseText)}catch(e){}
    var list=j.inputs||[];
    if(!list.length){g.innerHTML='<p class=apmsg>'+esc(t('No inputs were found on the TV.'))+'</p>';return}
    g.innerHTML=list.map(function(i){
      var name = i.tuner ? t('Live TV') : (i.title || t('Input'));
      return '<button data-in="'+esc(i.appId)+'"'+(i.off?' class=off':'')+'><span>'+esc(name)+(i.off?' ('+esc(t('off'))+')':'')+'</span></button>'
    }).join('');
    Array.prototype.forEach.call(g.querySelectorAll('[data-in]'),function(b){
      b.onclick=function(){
        var id=b.getAttribute('data-in'),label=b.querySelector('span').textContent;
        inputsOpen(false);
        openApp(id,label); /* the same path as an app: wake the TV if it is off, then open it */
      };
    });
  };
  x.onerror=function(){g.innerHTML='<p class=apmsg>'+esc(t('The TV did not answer. Is the phone on the same Wi-Fi?'))+'</p>'};
  x.send();
}
Array.prototype.forEach.call(document.querySelectorAll('.qin'),function(b){b.onclick=function(){inputsOpen(true)}});
$('xins').onclick=function(){inputsOpen(false)};
$('ins').onclick=function(e){if(e.target===$('ins'))inputsOpen(false)};
/* placeholder tiles while a list comes in: the same boxes as a tile, with only their opacity moving */
function skeleton(n){var out='',i;for(i=0;i<n;i++)out+='<div class=skel><i></i></div>';return out}
/* Live TV: the channels of the user's own playlist, as the TV has them; the tab is not there when there is no playlist */
function loadLive(){
  var g=$('lvgrid');
  if(!g||!tok)return;
  if(tvDown){liveIn=false;return noTv(g)}
  g.innerHTML=skeleton(6);
  var x=new XMLHttpRequest();
  x.open('GET','/api/live?t='+encodeURIComponent(tok));
  x.onload=function(){
    if(x.status!==200){liveIn=false;return noTv(g)}
    var j={};try{j=JSON.parse(x.responseText)}catch(e){}
    var list=j.channels||[];
    liveOk = list.length > 0;
    liveIn = liveOk;
    $('blv').className = curTab==='lv' ? 'tab on' : 'tab';
    if(!liveOk){
      pstateInto(g,'<svg class=ic viewBox="0 0 24 24" aria-hidden=true><rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7.5 4 4.5 4 4.5-4"/></svg>',t('Live TV is not set up yet'),t('Add your playlist on the TV once, and the channels appear here.'),t('Set it up on the TV'),setupLive);
      return;
    }
    g.innerHTML=list.map(function(c){
      var icon = c.logo
        ? '<img class=lvi alt="" data-n="'+c.num+'" loading=lazy src="/api/logo/'+c.num+'?t='+encodeURIComponent(tok)+'">'
        : '<span class=lvn>'+c.num+'</span>';
      return '<button data-ch="'+c.num+'">'+icon+'<span class=lvt>'+esc(c.name)+'</span></button>';
    }).join('');
    Array.prototype.forEach.call(g.querySelectorAll('.lvi'),function(im){
      /* a logo that cannot be fetched is replaced by the number, so the slot is never empty */
      im.onerror=function(){
        var s=document.createElement('span');
        s.className='lvn';
        s.textContent=this.getAttribute('data-n');
        if(this.parentNode)this.parentNode.replaceChild(s,this);
      };
    });
    Array.prototype.forEach.call(g.querySelectorAll('[data-ch]'),function(b){
      b.onclick=function(){openLive(parseInt(b.getAttribute('data-ch'),10), b.querySelector('.lvt').textContent.replace(/^\\d+\\s*/, ''))};
    });
  };
  x.onerror=function(){liveIn=false;noTv(g)};
  x.send();
}
/* no playlist yet: open Live TV on the TV, which is where the playlist is added (it shows the address to type on a phone) */
function setupLive(){
  if(!ready){say(t('Not connected'),'warn',2500);return}
  var go=function(){if(send({t:'liveSetup'}))say(t('Live TV setup opened on the TV'),'info',3000)};
  if(onNow())return goNow(go);
  wakeThen(go);
}
function openLive(num,name){
  if(!ready){say(t('Not connected'),'warn',2500);return}
  var go=function(){if(send({t:'live',num:num}))say(t('Opening')+' '+name,'info',2500)};
  if(onNow())return goNow(go);
  wakeThen(go);
}
/* A tile was tapped. With the TV on, the app opens at once. With it off (standby, the page still answers), the TV is woken first and
   the app is opened once the TV says it is really on — opening an app on a dark screen does nothing useful. */
/* the TV is in standby: wake it with the power key, show the wait on the power button, and do the tap once it is really on */
/* the screensaver counts as on, but it hides whatever is opened under it: a key (Back, which does nothing else there) takes it away first */
function goNow(go){if(pwrState!=='Screen Saver')return go();if(!send({t:'key',k:'BACK'}))return;setTimeout(go,900)}
function wakeThen(go){if(!send({t:'key',k:'POWER'}))return;offAt=Date.now();buzz();pendStart('on');
  whenOn(function(up){if(up)go();else{pendClear();say(t('The TV did not come on'),'bad',4000)}},24)}
function whenOn(cb,tries){
  if(onNow())return cb(true);
  if(tries<=0)return cb(false);
  ask();
  setTimeout(function(){whenOn(cb,tries-1)},900);
}
function launchApp(id,title){if(send({t:'launch',id:id}))say(t('Opening')+' '+title,'info',2500)}
function openApp(id,title){
  if(!ready){say(t('Not connected'),'warn',2500);return}
  if(onNow())return goNow(function(){launchApp(id,title)});
  wakeThen(function(){launchApp(id,title)});
}
/* the apps on the TV, from the TV's own list: the icons come through this page's server as well, since the launcher's API is loopback only */
/* a panel with nothing to show: an icon, a headline, a sentence and one button — the same shape in every list, so an empty
   list and a TV that is off do not look like a broken page */
function pstateInto(g,icon,title,text,label,fn){
  g.innerHTML='<div class=pstate><div class=pic>'+icon+'</div><b>'+esc(title)+'</b><p>'+esc(text)+'</p>'
    +(label?'<button class="pri pbtn">'+esc(label)+'</button>':'')+'</div>';
  var b=g.querySelector('.pbtn');
  if(b&&fn)b.onclick=fn;
}
/* the TV is not answering: in the app this wakes it, in a browser nothing can (a page cannot send UDP) */
function turnOn(){if(native())return wakeNow();say(t('Turn the TV on with its own remote'),'warn',4000)}
function noTv(g){pstateInto(g,'<svg class=ic viewBox="0 0 24 24" aria-hidden=true><path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></svg>',t('The TV is off'),t('Turn it on to see this.'),t('Turn on the TV'),turnOn)}
function loadApps(){
  var g=$('apgrid');
  if(!g||!tok)return;
  if(tvDown){appsIn=false;return noTv(g)}
  g.innerHTML=skeleton(9);
  var x=new XMLHttpRequest();
  x.open('GET','/api/apps?t='+encodeURIComponent(tok));
  x.onload=function(){
    if(x.status!==200)return noTv(g); /* a TV that answers with an error is as unreachable as one that is off */
    var j={};try{j=JSON.parse(x.responseText)}catch(e){}
    var list=j.apps||[];
    if(!list.length){appsIn=false;pstateInto(g,'<svg class=ic viewBox="0 0 24 24" aria-hidden=true><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',t('No apps'),t('Nothing was found to show here.'),t('Refresh'),loadApps);return}
    appsIn=true;
    g.innerHTML=list.map(function(a){
      return '<button data-app="'+esc(a.id)+'"><img alt="" src="/icon/'+encodeURIComponent(a.id)+'?t='+encodeURIComponent(tok)+'"><span>'+esc(a.title)+'</span></button>'
    }).join('');
    Array.prototype.forEach.call(g.querySelectorAll('[data-app]'),function(b){
      b.onclick=function(){
        openApp(b.getAttribute('data-app'), b.querySelector('span').textContent)
      }
    });
  };
  x.onerror=function(){appsIn=false;noTv(g)};
  x.send();
}
Array.prototype.forEach.call(document.querySelectorAll('.tab'),function(b){b.onclick=function(){tab(b.id.slice(1))}});
function sheet(on){$('scrim').className=on?'':'hide'}
$('bnum').onclick=function(){sheet(true)};$('xnum').onclick=function(){sheet(false)};$('scrim').onclick=function(e){if(e.target===$('scrim'))sheet(false)};
/* every drawer closes when it is pulled down, from anywhere but a key or its close button: the same gesture in the numbers,
   the inputs and the power sheet */
function pullDown(panel,closer){
  var el=$(panel),y0=0,dy=0,on=false;
  function start(e){if(e.touches.length!==1)return;var t=e.target;if(t&&t.closest&&t.closest('[data-k],button'))return;y0=e.touches[0].clientY;dy=0;on=true;el.style.transition='none'}
  function move(e){if(!on)return;var d=e.touches[0].clientY-y0;dy=d>0?d:0;if(dy>0)e.preventDefault();el.style.transform=dy?'translateY('+dy+'px)':''}
  function end(){if(!on)return;on=false;el.style.transition='';el.style.transform='';if(dy>72){var b=$(closer);if(b)b.click()}}
  el.addEventListener('touchstart',start,{passive:true});el.addEventListener('touchmove',move,{passive:false});
  ['touchend','touchcancel'].forEach(function(ev){el.addEventListener(ev,end)});
}
pullDown('insheet','xins');pullDown('sheet','xnum');pullDown('pwsheet','xpw');
/* text: what is typed goes to the TV as it is typed; the page remembers what it has sent in prev */
function delN(c){while(c>0){var k=Math.min(c,50);if(!send({t:'del',c:k}))return false;c-=k}return true}function sync(){var v=$('txt').value,ok;if(v===prev)return;
 if(v.indexOf(prev)===0)ok=send({t:'text',s:v.slice(prev.length)});
 else if(prev.indexOf(v)===0)ok=delN(prev.length-v.length);
 else ok=delN(prev.length)&&send({t:'text',s:v});
 if(ok){prev=v;say(t('Typing live on TV'),'info',900)}else $('txt').value=prev}
/* phone keyboards compose words (isComposing stays true until a space): send every change, a replaced word is deleted and typed again */
$('txt').addEventListener('input',function(){sync()});$('txt').addEventListener('compositionend',function(){sync()});
/* the Keyboard tab opens a drawer, the same kind as Inputs and Numbers; the phone's keyboard comes up with it. Typing is live: the line under the TV name says so for a moment */
function kbdOpen(on){$('kbs').className=on?'':'hide';if(on)setTimeout(function(){try{$('txt').focus()}catch(e){}},60);else try{$('txt').blur()}catch(e){}}
/* This remote: the TV's name opens what this phone knows about the connection, and where it is logged out. Logging out tells the TV
   (when it answers) to forget this phone, closes the connection and deletes everything the page and the app kept. */
var me={name:'',seen:0,created:0},leaving=false,lgAck=null;
function thOpen(on){$('ths').className=on?'':'hide';if(!on)return;
 $('thname').textContent=$('tvname').textContent;$('kvas').textContent=me.name||'-';
 $('kvon').textContent=me.created?new Date(me.created).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'-';$('kvad').textContent=location.host}
function cfmOpen(on){$('cfm').className=on?'dlgw':'hide dlgw';if(!on)return;
 $('cfh').textContent=t('Log out of %s?').replace('%s',function(){return $('tvname').textContent});
 $('cfp').textContent=ready?t('This phone stops controlling the TV. It is also removed from the TV’s list of paired phones, and everything this phone stored about the TV is deleted. To use it again you pair with a new code.')
  :t('The TV cannot be reached right now, so it cannot be told. This phone stops controlling the TV and everything it stored about the TV is deleted, but the TV keeps listing it until you remove it in the manager app. To use it again you pair with a new code.')}
function lgDraw(a){var rows=[t('Closing the connection'),a[1]==='skip'?t('The TV could not be reached: its list is left as it is'):t('Removing this phone from the TV’s list'),t('Deleting what this phone stored')];
 $('lgl').innerHTML=rows.map(function(r,i){return '<div class="'+a[i]+'"><i>'+(a[i]==='done'?'✓':'')+'</i>'+r+'</div>'}).join('')}
function wipe(){pendClear();store('');tok='';try{var k,del=[];for(k=0;k<localStorage.length;k++)if(/^cytv/.test(localStorage.key(k)))del.push(localStorage.key(k));del.forEach(function(x){localStorage.removeItem(x)})}catch(e){}
 me={name:'',seen:0,created:0};mac='';wol=null;appsIn=false;liveIn=false;pwrState='';$('tvname').textContent='TV';$('apgrid').innerHTML='';$('lvgrid').innerHTML='';$('txt').value='';prev='';$('code').value='';$('pname').value=guess();cells();tab('kb')}
/* when the page's own socket is not open the TV may still answer (on standby with Quick Start+, or a socket that just dropped): a short one of its own tells it */
function tellTv(cb){var w,done=false;function end(ok){if(done)return;done=true;try{w.close()}catch(e){}cb(ok)}
 try{w=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws')}catch(e){return cb(false)}
 setTimeout(function(){end(false)},3000);
 w.onopen=function(){w.send(JSON.stringify({t:'hello',token:tok}))};
 w.onmessage=function(e){var m;try{m=JSON.parse(e.data)}catch(x){return}
  if(m.t==='ready')w.send('{"t":"logout"}');else if(m.t==='bye'||(m.t==='denied'&&m.reason==='revoked'))end(true);else if(m.t==='denied')end(false)};
 w.onerror=function(){end(false)}}
function logout(){
 var up=!!(ready&&ws&&ws.readyState===1),fired=false;
 leaving=true;cfmOpen(false);thOpen(false);$('lgp').className='dlgw';lgDraw(['run','','']);
 function fin(ok){if(fired)return;fired=true;lgAck=null;var w=ok;
  drop();lgDraw(['done',w?'done':'skip','run']);
  setTimeout(function(){lgDraw(['done',w?'done':'skip','done'])},600);
  setTimeout(function(){
   wipe();$('lgp').className='hide dlgw';leaving=false;
   showPair('');pnote(w?t('Logged out. This phone was removed from the TV’s list.'):t('Logged out on this phone. The TV could not be reached, so it still lists this phone: remove it in the manager app, Phone remote, Paired phones.'),w?'ok':'warn',w?3000:10000);
   try{if(window.CYTV_APP&&CYTV_APP.forget)CYTV_APP.forget(w?'removed':'left')}catch(e){}
  },1300)}
 if(up){lgAck=function(){fin(true)};if(!send({t:'logout'}))tellTv(fin);else setTimeout(function(){fin(false)},3000)}
 else tellTv(fin)}
$('who').onclick=function(){if(tok)thOpen(true)};$('who').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();if(tok)thOpen(true)}};
$('xth').onclick=function(){thOpen(false)};$('ths').onclick=function(e){if(e.target===$('ths'))thOpen(false)};
$('lgo').onclick=function(){cfmOpen(true)};$('cfno').onclick=function(){cfmOpen(false)};$('cfyes').onclick=logout;pullDown('thsheet','xth');
Array.prototype.forEach.call(document.querySelectorAll('.qkb'),function(b){b.onclick=function(){kbdOpen(true)}});$('xkb').onclick=function(){kbdOpen(false)};$('kbs').onclick=function(e){if(e.target===$('kbs'))kbdOpen(false)};
pullDown('kbsheet','xkb');
/* a button in the drawer must not take the focus from the box, or the phone's keyboard would close */
Array.prototype.forEach.call(document.querySelectorAll('#clrtxt,#deltxt,#entertxt'),function(b){b.addEventListener('mousedown',function(e){e.preventDefault()})});
$('txt').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('entertxt').onclick()}});
/* Delete repeats while it is held: after 400 ms, every 80 ms */
var delT=null,delI=null;function delOne(){if(prev){if(delN(1)){prev=prev.slice(0,-1);$('txt').value=prev}}else send({t:'del',c:1})}
function delStop(){clearTimeout(delT);clearInterval(delI);delT=delI=null}
function delStart(e){e.preventDefault();delStop();delOne();buzz();delT=setTimeout(function(){delI=setInterval(delOne,80)},400)}
$('deltxt').addEventListener('mousedown',function(e){if(e.button===0)delStart(e)});$('deltxt').addEventListener('touchstart',delStart,{passive:false});
['mouseup','mouseleave','touchend','touchcancel'].forEach(function(ev){$('deltxt').addEventListener(ev,delStop)});
$('deltxt').onclick=function(e){if(e.detail===0)delOne()};

$('clrtxt').onclick=function(){if(delN(prev.length)){prev='';$('txt').value=''}};
$('entertxt').onclick=function(){sync();if(send({t:'enter'})){prev='';$('txt').value='';kbdOpen(false)}};
function cells(){var c=$('code'),v=c.value=c.value.replace(/\\D/g,''),k=document.querySelectorAll('.cell'),on=document.activeElement===c;
 for(var i=0;i<k.length;i++){k[i].textContent=v.charAt(i);k[i].className=on&&i===Math.min(v.length,k.length-1)?'cell cur':'cell'}}
['input','focus','blur'].forEach(function(ev){$('code').addEventListener(ev,cells)});
$('go').onclick=pair;$('code').onkeydown=function(e){if(e.keyCode===13)pair()};
/* in the app the pairing screen is the second step (the app's first screen found the TV): the label says so and the steps are not repeated; in a browser it is the first screen and keeps them */
if(IOSWEB){$('ioscard').className='ioscard';$('iostip').className='';try{var fa=document.activeElement;if(fa&&fa.blur)fa.blur();setTimeout(function(){window.scrollTo(0,0)},60)}catch(e){}} /* the code box's autofocus must not scroll the card away */
if(window.CYTV_APP){var eb=$('eb'),ps=$('psub');eb.textContent=eb.getAttribute('data-app');ps.textContent=ps.getAttribute('data-app');$('steps').className='hide'}
$('pname').value=guess();cells();try{var tn=localStorage.getItem('cytv-tvname');if(tn)$('tvname').textContent=tn}catch(e){}tok=stored();try{mac=localStorage.getItem(MK)||''}catch(e){}tab('kb');if(tok){show('remote');connect()}else show('pairbox');mark();autoPair();
`;

const STYLE = `html,body{direction:ltr}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
body{font:16px -apple-system,system-ui,'Plus Jakarta Sans',sans-serif;background:#101116;color:#f4f5f7;margin:0;max-width:430px;margin:0 auto}
.hide{display:none!important}p{color:#a3a8b8;margin:6px 0;line-height:1.45}
button,input,textarea{font:inherit;color:#f4f5f7;background:#1a1c23;border:1px solid #2e3140;border-radius:18px;padding:0;margin:0;-webkit-user-select:auto;user-select:auto}
button{display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;touch-action:manipulation}button.on{background:#2a2d3a}
.ic{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}.ic.fl{fill:currentColor}.ic.big{width:30px;height:30px}
.ic+span,span+.ic{margin-left:8px}
.row{display:flex;padding:0 20px}.row>*+*{margin-left:10px}.row>*{flex:1}
/* The screen is a column the height of the window: the top bar and the tab bar are its ends and never move, the tab's panel between
   them is the only thing that scrolls. No fixed offsets to guess, and nothing can hide the last row behind the tab bar. */
/* The height comes from the phone's own viewport (fit() below sets --appH): 100vh counts the strip a mobile browser's address bar
   covers, which put the fixed tab bar behind it. The calc() is the fallback for the moment before the script runs. */
#remote{display:flex;flex-direction:column;height:100vh}
#remote{height:var(--appH, 100vh)}
.head{flex:none;display:flex;align-items:center;padding:20px 20px 8px}
/* On the Home Screen of an iPhone the page runs full screen (viewport-fit=cover, a see-through status bar): the top bar, the tab bar and the
   sheets keep clear of the status bar and the home indicator. Where max() is unknown the plain value before it stays. */
.head{padding-top:max(20px,calc(env(safe-area-inset-top,0px) + 8px))}
.head>*+*{margin-left:12px}
#kb,#tp,#ap,#lv{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:12px}
/* the Remote and the Touchpad sit in the middle of the space between the top bar and the tab bar; when they do not fit the panel scrolls (auto margins never cut the top off) */
#kb,#tp{display:flex;flex-direction:column;padding-bottom:0}#kb>.cv,#tp>.cv{margin:auto 0}
.who{flex:1;min-width:0;font-size:17px;font-weight:700}.st{display:flex;align-items:flex-start;font-size:13px;font-weight:600;color:#a3a8b8;margin-top:2px}
.who{cursor:pointer}.who:focus-visible{outline:2px solid #ff8a5b;outline-offset:3px;border-radius:10px}.tvrow{display:flex;align-items:center}.tvrow #tvname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tvrow .ic{flex:none;width:16px;height:16px;margin-left:6px;stroke:#ff8a5b}
.kv{margin:14px 0 0;border:1px solid #2e3140;border-radius:16px;background:#14161d;overflow:hidden}.kv div{display:flex;justify-content:space-between;padding:12px 14px}.kv div+div{border-top:1px solid #2e3140}.kv dt{color:#a3a8b8;flex:none;margin-right:12px}.kv dd{margin:0;font-weight:600;text-align:right;min-width:0;overflow-wrap:anywhere}
.outb{display:block;width:100%;height:54px;margin-top:16px;border-radius:20px;font-size:16px;font-weight:800;color:#f0a0a0;border:1px solid #5a3434;background:#1d1517}.drawer .ghostb{display:block;width:100%;height:54px;margin-top:10px;border-radius:20px}
.dlgw{position:fixed;left:0;right:0;top:0;bottom:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:0 20px;background:rgba(8,9,12,.66)}
.dlg{width:100%;max-width:390px;background:#1a1c23;border:1px solid #2e3140;border-radius:24px;padding:22px 20px 18px}.dlg h3{margin:0 0 8px;font-size:20px;line-height:1.2}.dlg p{margin:0;font-size:14.5px}.dlg .two{display:flex;margin-top:18px}.dlg .two button{flex:1;height:50px;border-radius:20px;margin:0}.dlg .two button+button{margin-left:10px}
.prog{margin-top:20px}.prog div{display:flex;align-items:center;color:#a3a8b8;font-size:14.5px}.prog div+div{margin-top:10px}.prog i{flex:none;width:20px;height:20px;border-radius:50%;border:2px solid #2e3140;margin-right:10px;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:12px;color:#1b1008}.prog .done{color:#f4f5f7}.prog .done i{background:#4ade80;border-color:#4ade80}.prog .skip{color:#7b8092}.prog .skip i{border-style:dashed}.prog .run i{border-color:#ff8a5b;border-top-color:transparent;animation:lgsp .9s linear infinite}@keyframes lgsp{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.prog .run i{animation:none}}
.st i{flex:none;width:8px;height:8px;border-radius:50%;background:#a3a8b8;margin:5px 6px 0 0}.st span{min-width:0;overflow:hidden;line-height:1.3;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}.st.msg{color:#dde0ea}.st.msg i{background:#dde0ea}.st.ok{color:#7be0a4}.st.ok i{background:#4ade80}.st.w{color:#f0d58a}.st.w i{background:#f0d58a}.st.off{color:#f0a0a0}.st.off i{background:#f0a0a0}
.info{flex:none;width:44px;height:44px;border-radius:14px}
/* a separate rule for what the header says while the TV is off lives in mark(); the remote itself is never disabled */
.dpw{position:relative;width:340px;max-width:calc(100% - 32px);height:262px;margin:14px auto 0}
.dp{position:absolute;left:50%;top:15px;margin-left:-116px;width:232px;height:232px;border-radius:50%;background:#1a1c23;border:1px solid #2e3140;box-shadow:inset 0 0 0 8px #151720}
.dp button{position:absolute;width:56px;height:56px;border:0;background:transparent;border-radius:50%}.dp button.on{background:#2a2d3a}
.dp .u{left:87px;top:9px}.dp .d{left:87px;bottom:9px}.dp .l{left:9px;top:87px}.dp .r{right:9px;top:87px}
.dp .ok{left:71px;top:71px;width:88px;height:88px;background:#ff8a5b;color:#1b1008;font-size:22px;font-weight:800;box-shadow:0 0 0 6px rgba(255,138,91,.14),0 10px 28px rgba(255,138,91,.28)}.dp .ok.on{background:#ffb08f}
.cn{position:absolute;width:52px;height:52px;border-radius:50%;padding:0}.cn .ic{width:22px;height:22px}.cn.tl{left:0;top:0}.cn.tr{right:0;top:0}.cn.bl{left:0;bottom:0}.cn.br{right:0;bottom:0}
.mid3{display:flex;align-items:center;padding:12px 20px 0}.mid3>*+*{margin-left:14px}
.pill{flex:none;width:76px;height:140px;border-radius:38px;background:#1a1c23;border:1px solid #2e3140;display:flex;flex-direction:column;overflow:hidden}
.pill button{flex:1;border:0;border-radius:0;background:transparent}.pill button.on{background:#2a2d3a}.pill b{display:block;height:20px;text-align:center;font-size:11px;letter-spacing:.12em;color:#a3a8b8}
.cen{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center}.cen button{width:64px;height:64px;border-radius:50%}.cen small{font-size:11px;color:#a3a8b8;font-weight:700;margin-top:6px}
.playbar{display:flex;margin:12px 20px 0;height:44px;border-radius:22px;background:#1a1c23;border:1px solid #2e3140;overflow:hidden}.playbar button{flex:1;height:42px;border:0;border-radius:0;background:transparent}.playbar button+button{border-left:1px solid #2e3140}.playbar button.on{background:#2a2d3a}.playbar .ic{width:20px;height:20px}
.qr{display:flex;margin:12px 20px 0}.qr button{flex:1;height:44px;border-radius:22px;font-size:13px}.qr button+button{margin-left:8px}.qr .ic{width:20px;height:20px}
/* a row of the screen's column, the same height as the 64px the script takes off: no fixed positioning to be swallowed by a phone's
   address bar, nothing can end up outside the visible area */
.tabbar{flex:none;display:flex;border-top:1px solid #2e3140;background:#13141a;padding:0 12px 4px}.tabbar{padding-bottom:max(4px,env(safe-area-inset-bottom,0px))}
.tab{flex:1;height:60px;border:0;border-radius:0;background:transparent;flex-direction:column;font-size:12px;font-weight:600;color:#a3a8b8}.tab .ic{margin:0 0 4px}.tab.on{background:transparent;color:#ff8a5b}
.pad{position:relative;margin:18px auto 0;width:calc(100% - 40px);max-width:390px;height:calc(100vh - 380px);min-height:300px;max-height:432px;border-radius:28px;border:1px solid #2e3140;background:radial-gradient(circle at 50% 38%,#1c1f2a 0%,#14161d 62%,#111319 100%);overflow:hidden;touch-action:none;transition:border-color .12s,box-shadow .12s}
.pad:before{content:'';position:absolute;left:0;right:0;top:0;bottom:0;background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1.5px);background-size:22px 22px;background-position:11px 11px;pointer-events:none}
.pad.on{border-color:rgba(255,138,91,.5);box-shadow:0 0 0 4px rgba(255,138,91,.08)}
.pfing{position:absolute;left:-28px;top:-28px;width:56px;height:56px;border-radius:50%;background:rgba(255,138,91,.18);border:1px solid rgba(255,138,91,.4);opacity:0;pointer-events:none;transition:opacity .12s}.pad.on .pfing{opacity:1}
/* the hint sits at the bottom edge inside the pad, clear of the scroll rail on the right (the rail is 34px wide, 10px from the edge) */
.padhint{position:absolute;left:20px;right:64px;bottom:14px;margin:0;text-align:center;font-size:13px;line-height:1.45;color:#a3a8b8;font-weight:500;pointer-events:none}
.sbar{position:absolute;right:10px;top:10px;bottom:10px;width:30px;border-radius:15px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06);touch-action:none}.sbar .ic{position:absolute;left:7px;width:14px;height:14px;margin:0;color:rgba(163,168,184,.6)}.sbar .up{top:10px}.sbar .dn{bottom:10px}
.sthumb{position:absolute;left:3px;right:3px;top:50%;height:88px;margin-top:-44px;border-radius:11px;background:#3a3e4d;transition:background .12s}.sthumb:after{content:'';position:absolute;left:7px;right:7px;top:50%;height:2px;margin-top:-1px;border-radius:1px;background:#a3a8b8}.sbar.drag .sthumb{background:#ff8a5b}.sbar.drag .sthumb:after{background:#101116}
.padrow{margin:16px 0 0}.padrow button{flex-direction:column;height:64px;border-radius:20px;font-size:12px;font-weight:600}.padrow .ic{margin:0 0 4px;width:24px;height:24px}.padrow>*+*{margin-left:8px}.padrow button.pri{font-weight:700}
@media (prefers-reduced-motion:reduce){.pad,.pfing,.sthumb{transition:none}}
#ap{padding:6px 20px 12px} /* the grid sits right under the top bar */
.apgrid{display:grid;grid-template-columns:repeat(3,1fr);margin:-6px}
.apgrid>*{margin:6px}
.apgrid button{flex-direction:column;height:104px;border-radius:18px;background:#1a1c23;padding:10px 6px}
.apgrid img{width:46px;height:46px;object-fit:contain;margin-bottom:8px}
.apgrid span{font:600 12px/1.25 ui-sans-serif,system-ui;color:#dde0ea;text-align:center;overflow:hidden;max-height:2.5em}
.apmsg{grid-column:1/-1;margin:14px 6px;color:#a3a8b8;font-size:14px}
.skel{position:relative;height:104px;border-radius:18px;background:#1a1c23;border:1px solid #2e3140;overflow:hidden}
.skel i{position:absolute;left:0;right:0;top:0;bottom:0;background:linear-gradient(90deg,rgba(255,255,255,.03),rgba(255,255,255,.10),rgba(255,255,255,.03));animation:sk 1.1s ease-in-out infinite}
@keyframes sk{0%{opacity:.35}50%{opacity:.95}100%{opacity:.35}}
.lvgrid .skel{height:64px}
#lv{padding:6px 20px 12px}
.lvgrid{display:grid;grid-template-columns:repeat(2,1fr);margin:-6px}
.lvgrid>*{margin:6px}
.lvgrid button{justify-content:flex-start;height:72px;border-radius:16px;background:#1a1c23;padding:0 12px;overflow:hidden}
.lvgrid .lvi{flex:none;width:42px;height:42px;border-radius:10px;object-fit:contain;background:#232631;margin-right:10px}
.lvgrid .lvt{flex:1;font:600 13px/1.3 ui-sans-serif,system-ui;color:#dde0ea;text-align:left;overflow:hidden;max-height:2.6em}
.lvgrid .lvn{flex:none;width:42px;height:42px;border-radius:10px;background:#232631;display:flex;align-items:center;justify-content:center;margin-right:10px;font:800 19px ui-monospace,monospace;color:#ff8a5b}
.lvgrid p{grid-column:1/-1}
.pstate{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:26px 12px 8px}
.pstate .pic{width:60px;height:60px;border-radius:18px;background:#1a1c23;border:1px solid #2e3140;display:flex;align-items:center;justify-content:center;color:#ff8a5b;margin-bottom:14px}
.pstate .pic .ic{width:30px;height:30px}
.pstate b{font-size:17px;font-weight:800;color:#f4f5f7;margin-bottom:8px}
.pstate p{font-size:14px;line-height:1.45;color:#a3a8b8;margin:0 0 18px;max-width:280px}
.pstate .pri,.lvgrid .pstate .pri,.apgrid .pstate .pri{width:100%;max-width:280px;height:54px;border-radius:18px;font-size:16px;background:#ff8a5b;color:#1b1008;border:0;font-weight:800;justify-content:center}
.pri{background:#ff8a5b;border:0;color:#1b1008;font-weight:800}.pri.on{background:#ffb08f}
.txbox{position:relative}
textarea{display:block;width:100%;padding:14px 16px;border-radius:16px;border:1px solid #2e3140;background:#101116;color:#f4f5f7;font-size:18px;line-height:26px;resize:none;outline:none;caret-color:#ff8a5b}textarea::placeholder{color:#a3a8b8}
textarea:focus{border:1.5px solid #ff8a5b;box-shadow:0 0 0 4px rgba(255,138,91,.14);padding:13.5px 15.5px}

.kbrow{display:flex;margin-top:12px}.kbrow>*+*{margin-left:8px}.kbrow button{height:56px;border-radius:18px}.kbrow .ghostb{flex:none;background:transparent;border:1px solid #2e3140;color:#a3a8b8;font-weight:700;font-size:14px}.kbrow #clrtxt{width:88px}.kbrow #deltxt{width:64px}.kbrow .pri{flex:1}.kbrow .pri span{margin-right:8px}
/* every drawer: the same dark sheet at the bottom of the screen, the same handle, the same title row and close button */
#ins,#scrim,#pws,#kbs,#ths{position:fixed;left:0;right:0;top:0;bottom:0;z-index:6;display:flex;align-items:flex-end;justify-content:center;background:rgba(8,9,12,.66)}
.drawer{width:100%;max-width:430px;margin:0 auto;background:#1a1c23;border-top:1px solid #2e3140;border-radius:22px 22px 0 0;padding:10px 20px 26px;max-height:82vh;overflow-y:auto;transition:transform .18s ease}.drawer{padding-bottom:max(26px,calc(env(safe-area-inset-bottom,0px) + 12px))}
.drawer .grab{width:40px;height:5px;border-radius:3px;background:#3a3e50;margin:0 auto 14px}
.drawer .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.drawer .top b{font-size:18px}
.drawer .top button{flex:none;width:44px;height:44px;border:0;border-radius:14px;background:#232631;display:flex;align-items:center;justify-content:center;color:#dde0ea}
.drawer .top button svg{width:18px;height:18px}
.inslist button{width:100%;height:56px;border-radius:16px;margin-top:8px;justify-content:flex-start;padding:0 16px;font-size:16px}
.inslist button.off{opacity:.5}
/* the power drawer: one row for each thing the TV's power service can be told to do, the name over a line that says what it costs */
.pwlist button{display:flex;width:100%;min-height:62px;margin-top:8px;padding:9px 14px;border:1px solid #2e3140;border-radius:16px;background:#1d2028;text-align:left;justify-content:flex-start}
.pwlist .ic{flex:none;width:22px;height:22px;margin-right:14px;color:#dde0ea}
.pwlist button>span{display:block;min-width:0}
.pwlist b{display:block;font-size:16px;font-weight:700;color:#f4f5f7}
.pwlist small{display:block;margin-top:1px;font-size:12.5px;line-height:1.35;color:#a3a8b8}
.pwlist button.arm{border-color:#6b2b2b;background:#2a1717}
.pwlist button.arm b{color:#ff9f9f}

.num{display:grid;grid-template-columns:repeat(3,1fr);margin:-5px}.num>*{margin:5px}.num button{height:64px;border-radius:18px;font-size:24px}.num .tx2{font-size:15px}
.col{display:flex;margin-top:9px}.col>*+*{margin-left:10px}.col button{flex:1;height:44px;border:0;border-radius:14px}.cr{background:#e5484d}.cg{background:#30a46c}.cy{background:#f5c451}.cb{background:#3e63dd}
#pairbox{position:relative;overflow:hidden;min-height:100vh;display:flex;flex-direction:column;padding:72px 20px 24px;padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))}#pairbox{padding-top:max(72px,calc(env(safe-area-inset-top,0px) + 32px))}
.hapov{position:absolute;z-index:2;top:0;left:0;right:0;bottom:0;border-radius:inherit;-webkit-touch-callout:none;cursor:pointer}
.ioscard{margin:0 0 24px;padding:16px;border-radius:20px;background:#1d1714;border:1px solid #5a3b2c;font-size:15px;line-height:1.5;color:#dde0ea}.ioscard b{display:block;color:#ffb08f}
.ioscard ol{margin:10px 0 0;padding-left:22px}.ioscard li+li{margin-top:6px}.ioscard p{margin:10px 0 0;font-size:14px}#pairbox>*{position:relative}
#pairbox .glow{position:absolute;left:-100px;top:-140px;width:320px;height:320px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,138,91,.14),transparent)}
#pairbox .eyebrow{font-size:13px;font-weight:600;letter-spacing:.02em;color:#7b8092;margin:0 0 8px;min-height:20px}
#pairbox h1{font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-.02em;margin:0 0 8px}#pairbox .sub{font-size:16px;line-height:1.5;color:#a3a8b8;margin:0 0 24px}
.steps{margin:0 0 24px;padding:16px;border-radius:20px;background:#14161c;border:1px solid #23262f}.steps>div{display:flex;align-items:flex-start;font-size:15px;line-height:1.5;color:#dde0ea}.steps>div+div{margin-top:16px}
.steps b{color:#fff}
.steps i{flex:none;width:28px;height:28px;border-radius:50%;background:rgba(255,138,91,.14);display:flex;align-items:center;justify-content:center;font:800 14px system-ui;color:#ff8a5b;font-style:normal;margin-right:12px}
#pairbox label{display:block;font-size:14px;line-height:1.5;font-weight:600;color:#a3a8b8;margin:0 0 8px}
.cellwrap{position:relative;margin:0 0 24px}.cells{display:flex}
.cell{flex:1;min-width:0;max-width:56px;height:64px;margin-left:8px;border-radius:16px;background:#14161c;border:1.5px solid #646b82;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700}.cell:first-child{margin-left:0}.cell:nth-child(4){margin-left:20px}.cell.cur{border-color:#ff8a5b;box-shadow:0 0 0 3px rgba(255,138,91,.2)}
#pairbox .cellwrap input{position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;opacity:0;border:0;font-size:16px}
#pairbox #pname{width:100%;padding:0 16px;height:56px;margin:0;border-radius:16px;background:#14161c;border:1.5px solid #646b82;font-weight:400;font-size:17px;outline:0}#pairbox #pname:focus{border-color:#ff8a5b;box-shadow:0 0 0 3px rgba(255,138,91,.2)}
#pairbox .actions{margin-top:auto;padding-top:24px}#pairbox .pri{width:100%;height:58px;border-radius:18px;font-size:18px;margin:0;box-shadow:0 10px 24px rgba(255,138,91,.25)}#pairbox .pri:active{transform:scale(.98)}
#pairbox .note{display:flex;align-items:flex-start;font-size:14px;line-height:1.5;color:#a3a8b8;margin-top:16px}#pairbox .note .ic{width:18px;height:18px;margin:2px 10px 0 0}#pnote{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 12px);z-index:60;width:calc(100% - 32px);max-width:398px;margin:0;padding:12px 16px 12px 14px;border-radius:16px;font-size:14px;line-height:1.45;text-align:left;pointer-events:none;opacity:0;transform:translate(-50%,-24px);transition:transform .25s ease,opacity .25s ease;box-shadow:0 12px 30px rgba(0,0,0,.45);background:#1b1d25;border:1px solid #2e3140;border-left:4px solid #8a8fa0;color:#dde0ea}#pnote.ok{background:#12231b;border-left-color:#30a46c;color:#bfe9cf}#pnote.warn{background:#2a2412;border-left-color:#f5c451;color:#ffe9a8}#pnote.on{opacity:1;transform:translate(-50%,0)}@media (prefers-reduced-motion:reduce){#pnote{transition:none}}

/* the app's on/off button: it carries the state, so it is wider than a plain icon button */
.pwr{position:relative;width:auto;min-width:80px;padding:0 14px;justify-content:center;overflow:hidden;transition:background-color .22s,border-color .22s,color .22s}
.pwr #pwrlb{font-size:13px;font-weight:800;letter-spacing:.02em;margin-left:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:104px}.pwr #pwrlb.lbin{animation:plbin .22s ease-out both}
@keyframes plbin{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.pwr #pwrlb.lbin{animation:none}}.pwr.on{color:#ffb08f;border-color:#5a3a2b;background:#241a17}
.pwr.pend{color:#ffb08f;border-color:#6b4330;background:#2a1d18}.pwr.pendoff{color:#c9ccd8;border-color:#3a3e50;background:#20222b}
.pi{position:relative;width:24px;height:24px;flex:none}.pi .ic{position:absolute;left:0;top:0}
#pwring{position:absolute;left:-5px;top:-5px;width:34px;height:34px;color:#ff8a5b;fill:none;animation:pspin .9s linear infinite}
.pop{position:absolute;left:-5px;top:-5px;width:34px;height:34px;border-radius:50%;border:2px solid #4ade80;animation:ppop .45s ease-out forwards}
.pwr.nudge{animation:pnudge .3s ease-out}
#remote[data-p] #kb,#remote[data-p] #tp,#remote[data-p] #ap,#remote[data-p] #lv{opacity:.55;transition:opacity .2s}#remote[data-p=on] #kb,#remote[data-p=on] #tp,#remote[data-p=on] #ap,#remote[data-p=on] #lv{pointer-events:none}
@keyframes pspin{to{transform:rotate(360deg)}}@keyframes ppop{0%{transform:scale(1);opacity:1}100%{transform:scale(1.5);opacity:0}}@keyframes pnudge{0%{transform:scale(1)}40%{transform:scale(.94)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){#pwring{animation:ppulse 1.6s ease-in-out infinite}.pop,.pwr.nudge{animation:none}}@keyframes ppulse{0%,100%{opacity:1}50%{opacity:.35}}
`;

const P = {
  back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  rew: '<path d="M11 5 3 12l8 7ZM21 5l-8 7 8 7Z"/>',
  play: '<path d="M8 5v14l11-7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  ff: '<path d="m13 5 8 7-8 7ZM3 5l8 7-8 7Z"/>',
  live: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7.5 4 4.5 4 4.5-4"/>',
  input: '<path d="M3 12h11M10 8l4 4-4 4M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/>',
  apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  remote: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><circle cx="12" cy="9" r="2"/><path d="M12 15v.01"/>',
  pad: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M9 20h6"/>',
  kb: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  del: '<path d="M21 5H9l-6 7 6 7h12Z"/><path d="m13 9 4 6M17 9l-4 6"/>',
  enter: '<path d="M20 6v6a3 3 0 0 1-3 3H5"/><path d="m9 11-4 4 4 4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  power: '<path d="M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0"/>',
  screenoff: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m4 4 16 16"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6Z"/>',
  restart: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
}; // prettier-ignore

function phonePage(i18n, lang, preCode, hint) {
  // a code in the address the page was opened with: it goes into the input on the server, before any script runs
  const pre = /^[0-9]{6}$/.test(String(preCode || '')) ? String(preCode) : '';
  let cellHtml = '';
  for (let i = 0; i < 6; i++) cellHtml += '<div class=cell>' + (pre.charAt(i) || '') + '</div>';
  const T = s => esc(i18n.tr(lang, s));
  const ic = (p, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden=true>${P[p]}</svg>`;
  // a button that sends one key: aria-label names it, rep=1 repeats while held
  const key = (k, inner, label, cls, rep) =>
    `<button${cls ? ' class="' + cls + '"' : ''} data-k=${k}${rep ? ' data-r=1' : ''} aria-label="${esc(label)}">${inner}</button>`;
  const digits =
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => key(d, d, d)).join('') +
    key('EXIT', `<span class=tx2>${T('Exit')}</span>`, T('Exit')) +
    key('0', '0', '0') +
    '<div></div>';
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name=referrer content=no-referrer>
<link rel=manifest href="/manifest.webmanifest${pre ? '?code=' + pre : ''}"><link rel=apple-touch-icon href="/apple-touch-icon.png?v=${ICON_V}">
<meta name=apple-mobile-web-app-capable content=yes><meta name=mobile-web-app-capable content=yes><meta name=apple-mobile-web-app-status-bar-style content=black-translucent>
<meta name=apple-mobile-web-app-title content="${T('TV remote')}"><meta name=theme-color content=#101116>
<meta http-equiv=cache-control content=no-store>
<meta http-equiv=pragma content=no-cache><title>${T('Phone remote')}</title>
<style>${STYLE}</style>
<div id=pairbox class=hide><div class=glow></div><p class=eyebrow id=eb data-app="${T('Step 2 of 2')}">&nbsp;</p><h1>${T('Enter the code')}</h1><p class=sub id=psub data-app="${T('The 6-digit code is on the TV screen.')}">${T('Use this device as a remote for your TV. You only do this once.')}</p>
<div id=ioscard class="ioscard hide"><b>${T('On an iPhone or iPad, put the remote on the Home Screen first')}</b>
<ol><li>${T('In Safari, tap Share (in iOS 26 it is in the ••• menu).')}</li><li>${T('Choose Add to Home Screen, keep Open as Web App on, and tap Add.')}</li><li>${T('Open TV remote from the Home Screen and pair it there with the code from the TV.')}</li></ol>
<p>${T('The Home Screen app keeps its own login: a device paired here in Safari has to pair again in the app.')}</p></div>
<div class=steps id=steps><div><i>1</i><span>${T('On the TV, open the Phone remote page and choose')} <b>${T('Pair a phone')}</b>. ${T('It shows a QR code and a 6-digit code.')}</span></div><div><i>2</i><span>${T('Type the 6-digit code below.')}</span></div></div>
<label for=code>${T('Code from the TV')}</label><div class=cellwrap><div class=cells>${cellHtml}</div><input id=code inputmode=numeric maxlength=6 autocomplete=one-time-code autofocus value="${pre}"></div>
<label for=pname>${T('Name of this device')}</label><input id=pname maxlength=30>
<div class=actions><button class=pri id=go>${T('Pair this device')}</button>
<div class=note>${ic('lock')}<span>${T('Only devices you pair can control the TV. You can block or remove any device from the TV later.')}</span></div></div></div>
<div id=remote class=hide>
<div class=head><div class=who id=who role=button tabindex=0 aria-haspopup=dialog aria-label="${T('This remote')}"><div class=tvrow><div id=tvname>TV</div>${ic('chev')}</div><div class="st w" id=st><i></i><span id=stt>${T('Connecting…')}</span></div></div><button id=pwr class=info aria-label="${T('Power')}"><span class=pi>${ic('power')}<svg id=pwring class=hide viewBox="0 0 34 34" aria-hidden=true><circle cx=17 cy=17 r=15 stroke=currentColor stroke-width=2 stroke-linecap=round stroke-dasharray="70 100"></circle></svg><span id=pwpop class="pop hide"></span></span><span id=pwrlb class=hide></span></button></div>
<div id=kb><div class=cv>
<div class=dpw><div class=dp>${key('UP', ic('up', 'big'), T('Up'), 'u', 1)}${key('DOWN', ic('down', 'big'), T('Down'), 'd', 1)}${key('LEFT', ic('left', 'big'), T('Left'), 'l', 1)}${key('RIGHT', ic('right', 'big'), T('Right'), 'r', 1)}${key('ENTER', T('OK'), T('OK'), 'ok')}</div>
${key('MENU', ic('menu'), T('Menu'), 'cn tl')}<button id=bnum class="cn tr" aria-label="${T('Numbers and colours')}"><span style="font-size:15px">123</span></button>${key('BACK', ic('back'), T('Back'), 'cn bl')}${key('HOME', ic('home'), T('Home'), 'cn br')}</div>
<div class=mid3>
<div class=pill>${key('VOLUMEUP', ic('plus'), T('Volume up'), '', 1)}<b>VOL</b>${key('VOLUMEDOWN', ic('minus'), T('Volume down'), '', 1)}</div>
<div class=cen>${key('MUTE', ic('mute'), T('Mute'))}<small>${T('Mute')}</small></div>
<div class=pill>${key('CHANNELUP', ic('up'), T('Channel up'), '', 1)}<b>CH</b>${key('CHANNELDOWN', ic('down'), T('Channel down'), '', 1)}</div></div>
<div class=playbar>${key('REWIND', ic('rew', 'fl'), T('Rewind'), '', 1)}${key('PLAY', ic('play', 'fl'), T('Play'))}${key('PAUSE', ic('pause'), T('Pause'))}${key('FASTFORWARD', ic('ff', 'fl'), T('Fast forward'), '', 1)}</div>
<div class=qr><button class=qin aria-label="${T('Inputs')}">${ic('input')}<span>${T('Inputs')}</span></button><button class=qkb aria-label="${T('Keyboard')}">${ic('kb')}<span>${T('Keyboard')}</span></button></div></div></div>
<div id=tp><div class=cv><div class=pad id=pad role=application aria-label="${T('Touchpad')}" aria-describedby=padhint><div class=pfing id=pfing></div><div class=sbar id=sbar aria-hidden=true><svg class="ic up" viewBox="0 0 24 24" aria-hidden=true><path d="m6 14 6-6 6 6"/></svg><svg class="ic dn" viewBox="0 0 24 24" aria-hidden=true><path d="m6 10 6 6 6-6"/></svg><div class=sthumb id=sthumb></div></div><p class=padhint id=padhint>${T('Swipe to move around, tap for OK, tap with two fingers for Back.')}</p></div>

<div class="row padrow">${key('BACK', ic('back') + '<span>' + T('Back') + '</span>', T('Back'))}${key('ENTER', ic('enter') + '<span>' + T('OK') + '</span>', T('OK'), 'pri')}${key('HOME', ic('home') + '<span>' + T('Home') + '</span>', T('Home'))}</div>
<div class=qr><button class=qin aria-label="${T('Inputs')}">${ic('input')}<span>${T('Inputs')}</span></button><button class=qkb aria-label="${T('Keyboard')}">${ic('kb')}<span>${T('Keyboard')}</span></button></div></div></div>
<div id=ap class=hide><div class=apgrid id=apgrid></div></div>
<div id=lv class=hide><div class=lvgrid id=lvgrid></div></div>
<div id=tabbar class=hide><div class=tabbar><button class=tab id=bkb>${ic('remote')}${T('Remote')}</button><button class=tab id=btp>${ic('pad')}${T('Touchpad')}</button><button class=tab id=bap>${ic('apps')}${T('Apps')}</button><button class=tab id=blv>${ic('live')}${T('Live')}</button></div></div>
</div>
<div id=ins class=hide><div id=insheet class=drawer role=dialog aria-label="${T('Inputs')}"><div class=grab></div><div class=top><b>${T('Inputs')}</b><button id=xins aria-label="${T('Close')}">${ic('close')}</button></div><div id=inslist class=inslist></div></div></div>
<div id=kbs class=hide><div id=kbsheet class=drawer role=dialog aria-label="${T('Keyboard')}"><div class=grab></div><div class=top><b>${T('Keyboard')}</b><button id=xkb aria-label="${T('Close')}">${ic('close')}</button></div>
<div class=txbox><textarea id=txt rows=3 autocomplete=off autocapitalize=off autocorrect=off spellcheck=false enterkeyhint=send placeholder="${T('Type here')}" aria-label="${T('Text for the TV')}"></textarea></div>
<div class=kbrow><button id=clrtxt class=ghostb>${T('Clear')}</button><button id=deltxt class=ghostb aria-label="${T('Delete')}">${ic('del')}</button><button id=entertxt class=pri><span>${T('Enter')}</span>${ic('enter')}</button></div></div></div>
<div id=ths class=hide><div id=thsheet class=drawer role=dialog aria-label="${T('This remote')}"><div class=grab></div><div class=top><b id=thname></b><button id=xth aria-label="${T('Close')}">${ic('close')}</button></div>
<p>${T('This phone is paired with the TV.')}</p><p id=iostip class=hide>${T('Tip: in Safari, Share > Add to Home Screen turns this remote into an app. It pairs once more in the app.')}</p>
<dl class=kv><div><dt>${T('Paired as')}</dt><dd id=kvas></dd></div><div><dt>${T('Paired on')}</dt><dd id=kvon></dd></div><div><dt>${T('TV address')}</dt><dd id=kvad></dd></div></dl>
<button id=lgo class=outb>${T('Log out of this TV')}</button></div></div>
<div id=pnote role=status aria-live=polite></div>
<div id=cfm class="hide dlgw"><div class=dlg role=alertdialog aria-labelledby=cfh><h3 id=cfh></h3><p id=cfp></p><div class=two><button id=cfno class=ghostb>${T('Stay paired')}</button><button id=cfyes class=pri>${T('Log out')}</button></div></div></div>
<div id=lgp class="hide dlgw"><div class=dlg role=status><h3>${T('Logging out…')}</h3><div class=prog id=lgl></div></div></div>
<div id=scrim class=hide><div id=sheet class=drawer role=dialog aria-label="${T('Numbers and colours')}"><div class=grab></div><div class=top><b>${T('Numbers')}</b><button id=xnum aria-label="${T('Close')}">${ic('close')}</button></div>
<div class=num>${digits}</div>
<div class=col>${key('RED', '', T('Red'), 'cr')}${key('GREEN', '', T('Green'), 'cg')}${key('YELLOW', '', T('Yellow'), 'cy')}${key('BLUE', '', T('Blue'), 'cb')}</div></div></div>
<div id=pws class=hide><div id=pwsheet class=drawer role=dialog aria-label="${T('Power')}"><div class=grab></div><div class=top><b>${T('Power')}</b><button id=xpw aria-label="${T('Close')}">${ic('close')}</button></div>
<div id=pwlist class=pwlist><button class=pwrow data-a=off>${ic('screenoff')}<span><b>${T('Screen off')}</b><small>${T('The picture goes dark, the TV stays on.')}</small></span></button>
<button class=pwrow data-a=standby>${ic('moon')}<span><b>${T('Standby')}</b><small>${T('The soft off. This page wakes it in seconds.')}</small></span></button>
<button class=pwrow data-a=reboot>${ic('restart')}<span><b>${T('Restart')}</b><small>${T('The TV starts again: back in a minute.')}</small></span></button>
<button class=pwrow data-a=shutdown>${ic('power')}<span><b>${T('Shut down')}</b><small>${T('Only the remote of the TV turns it back on.')}</small></span></button></div>
</div></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>var HINT=' +
    JSON.stringify(String(hint || ''))
      .split('<')
      .join(String.fromCharCode(92) + 'u003c') +
    ';</script><script>' +
    PHONE_JS +
    '</script></html>'
  );
}

// The manifest that makes the phone page an app on the Home Screen (service.js serves it at /manifest.webmanifest). The page links it with
// the pairing code it was opened with, if any, and the code goes into start_url: on an iPhone the app keeps its own storage, apart from
// Safari's, so it must pair by itself, and this way it opens with the code from the TV's QR code filled in.
function manifest(i18n, lang, code) {
  const pre = /^[0-9]{6}$/.test(String(code || '')) ? String(code) : '';
  return JSON.stringify({
    id: '/',
    name: i18n.tr(lang, 'Phone remote'),
    short_name: i18n.tr(lang, 'TV remote'),
    lang,
    dir: 'ltr',
    start_url: pre ? '/?code=' + pre : '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#101116',
    theme_color: '#101116',
    icons: [
      { src: '/icon-180.png?v=' + ICON_V, sizes: '180x180', type: 'image/png' },
      { src: '/icon-512.png?v=' + ICON_V, sizes: '512x512', type: 'image/png' },
    ],
  });
}

module.exports = { phonePage, PHONE_JS, manifest, ICON_V };
