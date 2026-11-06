/* first paint straight from the last known layout, then refresh from the helper */
try {
  var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (cached && cached.apps && cached.apps.length) {
    apps = cached.apps;
    cfg = cached.cfg || {};
    useLang(cfg.lang);
    applyTheme(cfg.theme);
    usage = cached.usage || {};
    colors = cached.colors || {};
    rebuild();
    perfMark('launcher cached ' + Math.round(performance.now()));
  }
} catch (e) {}
load();
var pagesLoaded = PAGER.load();
refreshSoon();
wantInputs(pagesLoaded);
api('/api/frontend-ok', { version: VERSION }).catch(function () {}); // lets the manager know an updated launcher started
