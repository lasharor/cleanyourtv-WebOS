/* ---------- config (edited in the launcher, saved through the helper) ---------- */
function saveCfg() {
  api('/api/config', cfg).catch(function () {
    toast(t('Could not save settings'));
  });
  store();
  rebuild();
}
function isHidden(id) {
  return (cfg.hidden || []).indexOf(id) >= 0;
}
var INPUT_DOCK_PREFIX = '__input__';
function inputDockId(appId) {
  return INPUT_DOCK_PREFIX + appId;
}
function inputDockItem(id) {
  if (typeof id !== 'string' || id.indexOf(INPUT_DOCK_PREFIX) !== 0) return null;
  var appId = id.slice(INPUT_DOCK_PREFIX.length);
  for (var i = 0; i < inputDevices.length; i++) {
    var d = inputDevices[i];
    if (d.appId === appId)
      return {
        id: id,
        title: d.label || 'HDMI ' + d.port,
        inputAppId: d.appId,
        inputPort: d.port,
      };
  }
  return null;
}
function dockIds() {
  var by = {};
  apps.forEach(function (a) {
    by[a.id] = a;
  });
  var ids = cfg.dock && cfg.dock.length ? cfg.dock : DEFAULTS.dock;
  return ids
    .filter(function (i) {
      return (by[i] && !isHidden(i)) || !!inputDockItem(i);
    })
    .slice(0, TH.dockN);
}
function setDock(ids) {
  cfg.dock = ids.slice(0, TH.dockN);
  saveCfg();
}
function hideApp(id) {
  cfg.hidden = (cfg.hidden || []).concat(id);
  cfg.dock = dockIds().filter(function (i) {
    return i !== id;
  });
  saveCfg();
}
function unhideApp(id) {
  cfg.hidden = (cfg.hidden || []).filter(function (i) {
    return i !== id;
  });
  saveCfg();
}
function topbar() {
  return cfg.topbar ? cfg.topbar : DEFAULTS.topbar;
}
/* Live TV is optional (manager > Live TV): off hides every entry, the saved layout is kept for when it is switched on again */
function liveOn() {
  return !(cfg.options && cfg.options.liveTv === false);
}
function shownBar() {
  return liveOn()
    ? topbar()
    : topbar().filter(function (o) {
        return o.action !== 'live';
      });
}
function byOrder(a, b) {
  if (cfg.sort !== 'alpha') {
    var d = (usage[b.id] || 0) - (usage[a.id] || 0);
    if (Math.abs(d) > 1e-9) return d > 0 ? 1 : -1;
  }
  return a.title.localeCompare(b.title);
}
function title(id) {
  var input = inputDockItem(id);
  if (input) return input.title;
  for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i].title;
  return id;
}

/* ---------- actions ---------- */
function act(e) {
  var a = e._a;
  if (a) {
    if (a.inputAppId) return launch(a.inputAppId);
    if (!a.sys) {
      e.classList.add('launching');
      setTimeout(function () {
        e.classList.remove('launching');
      }, 4000);
    }
    return launch(a.id);
  }
  var o = e._o || {};
  if (o.action === 'customize') return customizeMenu();
  if (o.action === 'live') return LIVE.enter();
  if (o.action === 'inputs') return inputsMenu();
  if (o.app) launch(o.app, o.params);
}
