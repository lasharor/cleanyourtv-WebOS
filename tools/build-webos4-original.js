// Keep the upstream UI; adapt only its endpoint, Chromium 53 layout and uncertain launches.
'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
function page(html) {
  html = html.replace("var API = 'http://127.0.0.1:8765'", "var API = 'http://127.0.0.1:8764'");
  const oldApi = 'function api(p, body) {';
  if (html.indexOf(oldApi) < 0 || html.indexOf('function launch(id, params) {') < 0) throw new Error('Unknown upstream page');
  html = html.replace(
    oldApi,
    `function api(p, body) {
  if (p === '/api/launch') return new Promise(function(resolve,reject){
    var x=new XMLHttpRequest();x.open('POST',API+p);x.timeout=10000;x.setRequestHeader('Content-Type','application/json');
    x.onload=function(){try{if(x.status!==200)throw Error('Launch result uncertain');resolve(JSON.parse(x.responseText));}catch(e){reject(e);}};
    x.onerror=x.ontimeout=function(){reject(Error('Launch result uncertain'));};x.send(JSON.stringify(body));
  });`
  );
  const start = html.indexOf('function launch(id, params) {'),
    end = html.indexOf('\nfunction store()', start);
  if (end < 0) throw new Error('Unknown upstream launch boundary');
  html =
    html.slice(0, start) +
    `var trialLaunchBusy=false;
function launch(id,params){
  if(id==='__live')return LIVE.enter();
  if(trialLaunchBusy)return;
  trialLaunchBusy=true;
  api('/api/launch',{id:id}).then(function(x){trialLaunchBusy=false;if(!x||x.returnValue!==true)toast(t('Launch result uncertain. Check the TV before trying again.'),true);},function(){trialLaunchBusy=false;toast(t('Launch result uncertain. Check the TV before trying again.'),true);});
}` +
    html.slice(end);
  const runningStart = html.indexOf('function runningItems(list) {');
  const runningEnd = html.indexOf('\n/* the app manager', runningStart);
  if (runningStart < 0 || runningEnd < 0) throw new Error('Unknown upstream running-app menu');
  html =
    html.slice(0, runningStart) +
    `function runningItems(list){
    return list.length?list.map(function(a){return {label:a.title,dim:true};}):[{label:t('No apps are running'),dim:true}];
  }` +
    html.slice(runningEnd);
  // Chromium 53 has no CSS Grid; retain upstream spacing and tile dimensions with flex margins.
  return html.replace(
    '</style>',
    `#grid{display:flex;flex-wrap:wrap;justify-content:flex-start;margin-left:calc(var(--gap-x) / -2);width:calc(var(--grid-w) + var(--gap-x))}
#grid .tile{width:var(--tile-w);flex-shrink:0;margin:0 calc(var(--gap-x) / 2) var(--gap-y)}
[data-galign="center"] #grid{justify-content:center}
</style>`
  );
}
function build() {
  const out = process.env.CYTV_DIST || path.join(ROOT, 'dist/webos4-original-trial'),
    app = path.join(out, 'app');
  require('../helper/netcompat').mkdirp(app);
  const source = require('./build-pages').build('app/src');
  fs.writeFileSync(path.join(app, 'index.html'), page(source));
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'webos4/app/appinfo.json'), 'utf8'));
  info.id = 'com.cleanyourtv.webos4.original';
  info.title = 'CleanYourTV Original';
  fs.writeFileSync(path.join(app, 'appinfo.json'), JSON.stringify(info, null, 2) + '\n');
  fs.copyFileSync(path.join(ROOT, 'webos4/app/icon.png'), path.join(app, 'icon.png'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(app, 'LICENSE'));
  const result = cp.spawnSync('python3', [path.join(ROOT, 'ipk/build-ipk.py'), app, path.join(out, info.id + '_0.2.0_all.ipk')], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Original UI package failed');
  console.log(out);
}
if (require.main === module) build();
module.exports = { page, build };
