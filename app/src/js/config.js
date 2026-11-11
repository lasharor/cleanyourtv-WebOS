/* ---------- config (edited in the launcher, saved through the helper) ---------- */
function saveCfg() {
  api('/api/config', cfg).catch(function () {
    toast(t('Could not save the settings. Try again in a moment.'), true);
  });
  store();
  rebuild();
  WALL.sync(); /* a changed Wallpapers setting (on, off, the interval) takes effect at once, not only the next time Home opens */
}
function isHidden(id) {
  return (cfg.hidden || []).indexOf(id) >= 0;
}
function dockIds() {
  var by = {};
  apps.forEach(function (a) {
    by[a.id] = a;
  });
  var ids = cfg.dock && cfg.dock.length ? cfg.dock : DEFAULTS.dock;
  return ids
    .filter(function (i) {
      return by[i] && !isHidden(i);
    })
    .slice(0, TH.dockN);
}
function setDock(ids) {
  cfg.dock = ids.slice(0, TH.dockN);
  saveCfg();
}
function gridApps() {
  var di = dockIds();
  return apps
    .filter(function (a) {
      return !isHidden(a.id) && di.indexOf(a.id) < 0;
    })
    .sort(byOrder);
}
function gridAppIds() {
  return gridApps().map(function (a) {
    return a.id;
  });
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
  var tb = liveOn()
    ? topbar()
    : topbar().filter(function (o) {
        return o.action !== 'live';
      });
  return tb.concat(addonBar); /* the add-ons' entries (addons.js) come last and are not part of the saved layout */
}
function byOrder(a, b) {
  if (cfg.sort === 'custom') {
    var ord = cfg.order || [];
    var ia = ord.indexOf(a.id);
    var ib = ord.indexOf(b.id);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.title.localeCompare(b.title);
  }
  if (cfg.sort !== 'alpha') {
    var d = (usage[b.id] || 0) - (usage[a.id] || 0);
    if (Math.abs(d) > 1e-9) return d > 0 ? 1 : -1;
  }
  return a.title.localeCompare(b.title);
}
function title(id) {
  for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i].title;
  return id;
}

/* ---------- actions ---------- */
function act(e) {
  var a = e._a;
  if (a) {
    if (!a.sys) {
      e.classList.add('launching');
      setTimeout(function () {
        e.classList.remove('launching');
      }, 4000);
    }
    return launch(a.id);
  }
  var o = e._o || {};
  if (o.action === 'card') return cardAct(e);
  if (o.action === 'cardbtn') return cardBtnAct(e);
  if (o.action === 'customize') return customizeMenu();
  if (o.action === 'live') return LIVE.enter();
  if (o.action === 'addon') return PAGER.go(o.addon);
  if (o.action === 'inputs') return inputsMenu();
  if (o.action === 'bluetooth') return bluetoothMenu();
  if (o.action === 'poweroff') return confirmPowerOff();
  if (o.app) launch(o.app, o.params);
}
