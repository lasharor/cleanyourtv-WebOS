// CleanYourTV webOS 4 – Homebar-style Hybrid Launcher.
// Compatible with Chromium 53 on LG webOS 4.4.3.
// Strict ES5: var, function, XMLHttpRequest, no modern syntax.
'use strict';

var API = 'http://127.0.0.1:8765';
var STORAGE_KEY = 'cytv.webos4.favs.v5';
var MAX_FAV = 7;
var COLS_DRAWER = 6;

var SYSTEM_ICONS = {
  'com.palm.app.settings': '<path d="M6 3v18M12 3v18M18 3v18M3 8h6M9 16h6M15 10h6"/>',
  'org.webosbrew.inputhook': '<rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="9" r="3"/><path d="M10 16h4M10 19h4"/>',
  'com.webos.app.miracast': '<path d="M3 9V4h18v14h-7M3 13a8 8 0 0 1 8 8M3 17a4 4 0 0 1 4 4M3 21h.01"/>',
  'com.webos.app.recordings': '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="12" cy="12" r="4"/>',
  'com.webos.app.scheduler': '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6M17 2v6M3 11h18M8 15h2M14 15h2M8 18h2"/>',
};

// Featured hero cards for the middle row
var FEATURED_APPS = [
  { id: 'youtube.leanback.v4', title: 'YouTube', desc: 'Vídeos, música y tus canales', surface: '#ffffff', tag: 'Vídeos' },
  { id: 'netflix', title: 'Netflix', desc: 'Series, películas y documentales', surface: '#ffffff', tag: 'Cine y series' },
  { id: 'com.disney.disneyplus-prod', title: 'Disney+', desc: 'Disney, Pixar, Marvel y Star Wars', surface: '#054553', tag: 'Para todos' },
  { id: 'com.telefonica.app.nux', title: 'Movistar Plus+', desc: 'Cine y deporte en directo', surface: '#000000', tag: 'Televisión' },
  { id: 'com.webos.app.livetv', title: 'Live TV', desc: 'Tus canales de antena', surface: '#a3c125', tag: 'Antena · TDT' },
];

// Display names for known apps; installation status always comes from the helper.
var APP_DETAILS = [
  { id: 'youtube.leanback.v4', title: 'YouTube', glow: '#b32d2e' },
  { id: 'netflix', title: 'Netflix', glow: '#a61c1d' },
  { id: 'com.disney.disneyplus-prod', title: 'Disney+', glow: '#113ccf' },
  { id: 'com.telefonica.app.nux', title: 'Movistar Plus+', glow: '#005c8a' },
  { id: 'dazn', title: 'DAZN', glow: '#f8f850' },
  { id: 'spotify-beehive', title: 'Spotify', glow: '#1db954' },
  { id: 'com.webos.app.livetv', title: 'Live TV', glow: '#22d3ee' },
  { id: 'channelplus.eu', title: 'LG Channels', glow: '#a50034' },
  { id: 'com.webos.app.browser', title: 'Navegador web', glow: '#38bdf8' },
  { id: 'com.palm.app.settings', title: 'Ajustes', glow: '#e2e8f0' },
  { id: 'com.webos.app.discovery', title: 'LG Content Store', glow: '#f43f5e' },
  { id: 'com.webos.app.photovideo', title: 'Foto y Video', glow: '#f59e0b' },
  { id: 'com.webos.app.music', title: 'Musica', glow: '#ec4899' },
  { id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel', glow: '#22c55e' },
  { id: 'org.webosbrew.inputhook', title: 'LG Input Hook', glow: '#4b4860' },
  { id: 'com.webos.app.miracast', title: 'Screen Share', glow: '#284b63' },
  { id: 'com.webos.app.recordings', title: 'Grabaciones', glow: '#4a5d4e' },
  { id: 'com.webos.app.scheduler', title: 'Programador', glow: '#455561' },
];

var INPUTS_LIST = [
  {
    id: 'com.webos.app.livetv',
    label: 'Live TV',
    sub: 'Sintonizador / TDT',
    badge: 'Activa',
    icon: 'tv',
    params: { reason: 'recent' },
    active: true,
  },
  { id: 'com.webos.app.hdmi1', label: 'PC', sub: 'HDMI 1', badge: 'Activa', icon: 'hdmi', params: { deviceId: 'HDMI_1' }, active: true },
  { id: 'com.webos.app.hdmi2', label: 'HDMI 2', sub: 'Puerto 2', badge: 'Disponible', icon: 'hdmi', params: { deviceId: 'HDMI_2' } },
  {
    id: 'com.webos.app.externalinput.av1',
    label: 'AV',
    sub: 'Video compuesto',
    badge: 'Disponible',
    icon: 'av',
    params: { deviceId: 'AV_1' },
  },
  { id: 'com.webos.app.photovideo', label: 'AVM FRITZ!Media', sub: 'Servidor Multimedia', badge: 'Red', icon: 'media', params: {} },
  { id: 'airplay', label: 'AirPlay', sub: 'Apple AirPlay', badge: 'Listo', icon: 'airplay', params: {} },
  { id: 'com.webos.app.miracast', label: 'Screen Share', sub: 'Pantalla compartida', badge: 'Listo', icon: 'cast', params: {} },
  {
    id: 'com.webos.app.hdmi3',
    label: 'HDMI 3',
    sub: 'Puerto 3',
    badge: 'Inactiva',
    icon: 'hdmi',
    params: { deviceId: 'HDMI_3' },
    dim: true,
  },
  {
    id: 'com.webos.app.externalinput.component',
    label: 'Componente',
    sub: 'Entrada YPbPr',
    badge: 'Inactiva',
    icon: 'av',
    params: { deviceId: 'COMP_1' },
    dim: true,
  },
];

var INPUT_SVGS = {
  tv: '<svg class="input-svg" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 18v3M7 3l5 3 5-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  hdmi: '<svg class="input-svg" viewBox="0 0 24 24"><path d="M4 8h16v7l-3 3H7l-3-3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 11v3M12 11v3M15 11v3" stroke="currentColor" stroke-width="2"/></svg>',
  av: '<svg class="input-svg" viewBox="0 0 24 24"><circle cx="7" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 8V4M17 8V4" stroke="currentColor" stroke-width="2"/></svg>',
  airplay:
    '<svg class="input-svg" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><polygon points="12,15 17,21 7,21" fill="currentColor"/></svg>',
  cast: '<svg class="input-svg" viewBox="0 0 24 24"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8A13 13 0 0 1 14 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="2" y="4" width="20" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="3" cy="19" r="1" fill="currentColor"/></svg>',
  media:
    '<svg class="input-svg" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="2" fill="currentColor"/><polyline points="21,15 16,10 5,20" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

// State
var allApps = [];
var loadingApps = false;
var checkingConnection = false;
var favIds = [
  'youtube.leanback.v4',
  'netflix',
  'com.disney.disneyplus-prod',
  'com.telefonica.app.nux',
  'dazn',
  'spotify-beehive',
  'com.webos.app.livetv',
];
var view = 'home'; // 'home' | 'apps' | 'inputs'
var dockButtons = [];
var featuredButtons = [];
var appButtons = [];
var pillButtons = [];
var inputButtons = [];
var currentRow = 2; // 0 = pills, 1 = featured, 2 = dock
var currentCol = 0;
var toastTimer = null;
var previousAppId = null;

function rememberPrevious(params) {
  try {
    if (typeof params === 'string') params = JSON.parse(params);
  } catch (_) {
    params = null;
  }
  var id = params && params.cytvPreviousAppId;
  previousAppId = typeof id === 'string' && /^[\w.\-]{1,200}$/.test(id) && id !== 'com.cleanyourtv.webos4' ? id : null;
}
function launched(event) {
  var platform = window.PalmSystem || window.webOSSystem;
  rememberPrevious(event && event.detail ? event.detail : platform && platform.launchParams);
}
document.addEventListener('webOSLaunch', launched);
document.addEventListener('webOSRelaunch', launched);

// DOM references
function $(id) {
  return document.getElementById(id);
}
var elClock = $('clock');
var elDate = $('date');
var elDock = $('dock');
var elFeatured = $('featured-row');
var elApps = $('apps');
var elDrawer = $('drawer');
var elAppCount = $('app-count');
var elFavCount = $('fav-count');
var elToast = $('toast');
var elSelection = $('live-banner-text');
var elMode = $('mode');
var elInputsModal = $('inputs-modal');
var elInputsGrid = $('inputs-grid');

// Clock and calendar
function tickClock() {
  var d = new Date();
  var h = d.getHours();
  var m = d.getMinutes();
  elClock.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  var days = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
  var months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  elDate.textContent = days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()];
}

// Toast
function toast(msg) {
  clearTimeout(toastTimer);
  elToast.textContent = msg;
  elToast.className = 'on';
  toastTimer = setTimeout(function () {
    elToast.className = '';
  }, 3000);
}

function describeApp(app) {
  elSelection.textContent = app.title + (app.desc ? ' · ' + app.desc : '');
}

// LocalStorage favorites
function saveFavs() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favIds));
  } catch (_) {}
}
function loadFavs() {
  var saved;
  try {
    saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (_) {
    saved = null;
  }
  if (Array.isArray(saved) && saved.length > 0) {
    favIds = [];
    for (var i = 0; i < saved.length && favIds.length < MAX_FAV; i++) {
      if (typeof saved[i] === 'string' && favIds.indexOf(saved[i]) < 0) favIds.push(saved[i]);
    }
  }
}

function isFav(id) {
  return favIds.indexOf(id) >= 0;
}

function byId(id) {
  for (var i = 0; i < allApps.length; i++) if (allApps[i].id === id) return allApps[i];
  return null;
}

function readHelper(path, done) {
  var xhr;
  var finished = false;
  function finish(error, data) {
    if (finished) return;
    finished = true;
    done(error, data);
  }
  try {
    xhr = new XMLHttpRequest();
    xhr.open('GET', API + path, true);
    xhr.timeout = 10000;
    xhr.onload = function () {
      if (xhr.status !== 200) return finish(true);
      var data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (_) {
        return finish(true);
      }
      finish(false, data);
    };
    xhr.onerror = xhr.ontimeout = function () {
      finish(true);
    };
    xhr.send();
  } catch (_) {
    finish(true);
  }
}

function loadApps() {
  if (loadingApps) return;
  loadingApps = true;
  readHelper('/api/apps', function (error, data) {
    loadingApps = false;
    if (
      error ||
      !data ||
      !Array.isArray(data.apps) ||
      !data.apps.every(function (app) {
        return (
          app && typeof app.id === 'string' && /^[\w.\-]{1,200}$/.test(app.id) && (app.title === undefined || typeof app.title === 'string')
        );
      })
    ) {
      elMode.textContent = 'Sin conexión con el helper';
      toast('No se pudo consultar la lista de aplicaciones');
      return;
    }
    var focused = document.activeElement;
    var id = focused && focused._app && focused._app.id;
    var action = focused && focused._action;
    var wasLibrary = appButtons.indexOf(focused) >= 0;
    var wasFeatured = featuredButtons.indexOf(focused) >= 0;
    allApps = data.apps.map(function (app) {
      var title = app.title || app.id;
      for (var i = 0; i < APP_DETAILS.length; i++) {
        if (APP_DETAILS[i].id === app.id) {
          title = APP_DETAILS[i].title;
          break;
        }
      }
      return { id: app.id, title: title };
    });
    renderDock();
    renderApps();
    elMode.textContent = allApps.length + ' apps · Conectado';
    if (id || action) {
      var buttons = wasLibrary ? appButtons : wasFeatured ? featuredButtons : dockButtons;
      for (var j = 0; j < buttons.length; j++) {
        if ((id && buttons[j]._app && buttons[j]._app.id === id) || (action && buttons[j]._action === action)) {
          buttons[j].focus();
          return;
        }
      }
      if (buttons.length) buttons[0].focus();
    }
  });
}

function checkConnection() {
  if (checkingConnection) return;
  checkingConnection = true;
  var started = Date.now();
  elMode.textContent = 'Comprobando conexión…';
  readHelper('/api/service', function (error, data) {
    checkingConnection = false;
    if (error || !data || typeof data.version !== 'string' || typeof data.readOnly !== 'boolean') {
      elMode.textContent = 'Sin conexión con el helper';
      toast('El helper no responde. Vuelve a comprobar la conexión.');
      return;
    }
    elMode.textContent = 'Conectado · ' + (data.readOnly ? 'solo lectura' : Date.now() - started + ' ms');
    toast('Conexión correcta con el helper');
  });
}

function appIconMarkup(id) {
  if (Object.prototype.hasOwnProperty.call(SYSTEM_ICONS, id))
    return '<svg class="brand-svg system-icon" viewBox="0 0 24 24" aria-hidden="true">' + SYSTEM_ICONS[id] + '</svg>';
  if (/^[\w.-]{1,200}$/.test(id) && byId(id))
    return '<img class="brand-image" src="' + API + '/icon/' + encodeURIComponent(id) + '" alt="" draggable="false">';
  return '<svg class="brand-svg" viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="10" width="17" height="17" rx="4" fill="currentColor"/><rect x="37" y="10" width="17" height="17" rx="4" fill="currentColor"/><rect x="10" y="37" width="17" height="17" rx="4" fill="currentColor"/><rect x="37" y="37" width="17" height="17" rx="4" fill="currentColor"/></svg>';
}

// Application Launch: the helper applies LG's captured source activation requests.
function launchApp(id, params) {
  var targetApp = byId(id);
  var title = targetApp ? targetApp.title : id;
  if (!targetApp) {
    for (var i = 0; i < INPUTS_LIST.length; i++) {
      if (INPUTS_LIST[i].id === id) {
        title = INPUTS_LIST[i].label;
        break;
      }
    }
  }
  toast('Abriendo ' + title + '…');

  var payload = { id: id };
  if (params) {
    payload.params = params;
  } else {
    if (id === 'com.webos.app.hdmi1') payload.params = { deviceId: 'HDMI_1' };
    else if (id === 'com.webos.app.hdmi2') payload.params = { deviceId: 'HDMI_2' };
    else if (id === 'com.webos.app.hdmi3') payload.params = { deviceId: 'HDMI_3' };
    else if (id === 'com.webos.app.externalinput.av1') payload.params = { deviceId: 'AV_1' };
    else if (id === 'com.webos.app.externalinput.component') payload.params = { deviceId: 'COMP_1' };
  }

  // Keep this page available for HOME; hidden-page close timers can fire when it resumes.
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API + '/api/launch', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 10000;
    xhr.onload = function () {
      var result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch (_) {
        return;
      }
      if (xhr.status !== 200 || result.returnValue !== true) toast('No se pudo abrir ' + title);
    };
    xhr.onerror = function () {
      toast('El helper no está disponible. Comprueba Conexión.');
    };
    xhr.ontimeout = function () {
      // The first request may have reached LG: never race it with another launch.
      toast('La apertura tarda en responder. Comprueba la fuente antes de volver a abrirla.');
    };
    xhr.send(JSON.stringify(payload));
  } catch (_) {
    toast('No se pudo contactar con el helper. Comprueba Conexión.');
  }
}

// Toggle favorites with Yellow key
function toggleFav(app) {
  var pos = favIds.indexOf(app.id);
  if (pos >= 0) {
    favIds.splice(pos, 1);
    toast('Quitado de favoritos: ' + (app.title || app.id));
  } else {
    if (favIds.length >= MAX_FAV) {
      toast('Maximo ' + MAX_FAV + ' favoritos. Quita uno primero.');
      return;
    }
    favIds.push(app.id);
    toast('Anadido a favoritos: ' + (app.title || app.id));
  }
  saveFavs();
  renderDock();
  renderApps();
}

// Render Featured Widescreen Cards in the middle of parent layout
function renderFeatured() {
  var nodes = [];
  for (var i = 0; i < FEATURED_APPS.length; i++) {
    (function (item) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'hero-card';

      var top = document.createElement('div');
      top.className = 'hero-top';
      top.style.backgroundColor = item.surface;

      var iconWrap = document.createElement('div');
      iconWrap.className = 'hero-icon-wrap';
      iconWrap.innerHTML = appIconMarkup(item.id);
      top.appendChild(iconWrap);

      var tag = document.createElement('span');
      tag.className = 'hero-tag';
      tag.textContent = item.tag || 'Destacada';
      card.appendChild(top);

      var info = document.createElement('div');
      info.className = 'hero-info';
      info.appendChild(tag);

      var title = document.createElement('div');
      title.className = 'hero-title';
      title.textContent = item.title;
      info.appendChild(title);

      var desc = document.createElement('div');
      desc.className = 'hero-desc';
      desc.textContent = item.desc;
      info.appendChild(desc);

      card.appendChild(info);

      card.onclick = function () {
        launchApp(item.id);
      };
      card.onfocus = function () {
        describeApp(item);
      };
      card._app = item;
      nodes.push(card);
    })(FEATURED_APPS[i]);
  }

  while (elFeatured.firstChild) elFeatured.removeChild(elFeatured.firstChild);
  for (var j = 0; j < nodes.length; j++) elFeatured.appendChild(nodes[j]);
  featuredButtons = nodes;
}

// Action button creator for dock
function actionBtn(label, iconSvg, actionId, handler) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dock-item dock-action';
  btn._action = actionId;

  var iconDiv = document.createElement('div');
  iconDiv.innerHTML = iconSvg;
  btn.appendChild(iconDiv.firstChild);

  var title = document.createElement('span');
  title.className = 'dock-title';
  title.textContent = label;
  btn.appendChild(title);

  btn.onclick = handler;
  btn.onfocus = function () {
    elSelection.textContent = label;
  };
  return btn;
}

// Render Homebar-style Bottom Dock
function renderDock() {
  var nodes = [];

  for (var i = 0; i < favIds.length; i++) {
    var app = byId(favIds[i]);
    if (!app) continue;
    (function (a) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dock-item';

      var iconDiv = document.createElement('div');
      iconDiv.className = 'dock-icon-svg';
      iconDiv.innerHTML = appIconMarkup(a.id);
      btn.appendChild(iconDiv);

      var ttl = document.createElement('span');
      ttl.className = 'dock-title';
      ttl.textContent = a.title || a.id;
      btn.appendChild(ttl);

      btn.onclick = function () {
        launchApp(a.id);
      };
      btn.onfocus = function () {
        describeApp(a);
      };
      btn._app = a;
      nodes.push(btn);
    })(app);
  }

  // All Apps Action
  var allIcon = '<svg class="dock-icon-svg" viewBox="0 0 24 24"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>';
  nodes.push(actionBtn('Todas', allIcon, 'apps', showApps));

  // This checks only the local helper; it never installs or updates software.
  var connectionIcon =
    '<svg class="dock-icon-svg" viewBox="0 0 24 24"><path d="M7 3v5M17 3v5M5 8h14v3a7 7 0 0 1-7 7v3M5 8V6M19 8V6"/></svg>';
  nodes.push(actionBtn('Conexión', connectionIcon, 'connection', checkConnection));

  while (elDock.firstChild) elDock.removeChild(elDock.firstChild);
  for (var j = 0; j < nodes.length; j++) elDock.appendChild(nodes[j]);
  dockButtons = nodes;

  elFavCount.textContent = nodes.length - 2 + '/' + MAX_FAV;
}

// Render All-Apps Library Drawer
function renderApps() {
  var nodes = [];
  for (var i = 0; i < allApps.length; i++) {
    (function (app) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-item';

      var iconDiv = document.createElement('div');
      iconDiv.className = 'app-icon-svg';
      iconDiv.innerHTML = appIconMarkup(app.id);
      btn.appendChild(iconDiv);

      var ttl = document.createElement('span');
      ttl.className = 'app-title';
      ttl.textContent = app.title || app.id;
      btn.appendChild(ttl);

      if (isFav(app.id)) {
        var star = document.createElement('span');
        star.className = 'fav-star';
        star.textContent = '\u2605';
        btn.appendChild(star);
      }

      btn.onclick = function () {
        launchApp(app.id);
      };
      btn.onfocus = function () {
        describeApp(app);
      };
      btn._app = app;
      nodes.push(btn);
    })(allApps[i]);
  }

  while (elApps.firstChild) elApps.removeChild(elApps.firstChild);
  for (var j = 0; j < nodes.length; j++) elApps.appendChild(nodes[j]);
  appButtons = nodes;
  elAppCount.textContent = '(' + allApps.length + ')';
}

// Render Inputs Selector Grid
function renderInputs() {
  var nodes = [];
  for (var i = 0; i < INPUTS_LIST.length; i++) {
    (function (inp) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'input-tile' + (inp.active ? ' is-active' : '') + (inp.dim ? ' is-dim' : '');
      var svgIcon = INPUT_SVGS[inp.icon] || INPUT_SVGS.hdmi;

      btn.innerHTML =
        svgIcon +
        '<div class="input-label">' +
        inp.label +
        '</div>' +
        '<div class="input-sub">' +
        (inp.sub || '') +
        '</div>' +
        '<div class="input-badge">' +
        inp.badge +
        '</div>';

      btn.onclick = function () {
        hideInputs();
        launchApp(inp.id, inp.params);
      };
      nodes.push(btn);
    })(INPUTS_LIST[i]);
  }

  while (elInputsGrid.firstChild) elInputsGrid.removeChild(elInputsGrid.firstChild);
  for (var j = 0; j < nodes.length; j++) elInputsGrid.appendChild(nodes[j]);
  inputButtons = nodes;
}

// Show/Hide Library Drawer
function showApps() {
  if (view === 'apps') return;
  loadApps();
  view = 'apps';
  elDrawer.style.display = 'flex';
  if (appButtons.length) {
    appButtons[0].focus();
    appButtons[0].scrollIntoView(false);
  }
}
function hideApps() {
  view = 'home';
  elDrawer.style.display = 'none';
  currentRow = 2; // dock
  for (var i = 0; i < dockButtons.length; i++) {
    if (dockButtons[i]._action === 'apps') {
      dockButtons[i].focus();
      return;
    }
  }
  if (dockButtons.length) dockButtons[0].focus();
}

// Show/Hide Inputs Selector
function showInputs() {
  view = 'inputs';
  elInputsModal.style.display = 'flex';
  if (inputButtons.length) inputButtons[0].focus();
}
function hideInputs() {
  view = 'home';
  elInputsModal.style.display = 'none';
  pillButtons[1].focus(); // Entradas pill
}

// Quick action pill handlers
pillButtons = [$('pill-live'), $('pill-inputs'), $('pill-settings')];

$('pill-live').onclick = function () {
  launchApp('com.webos.app.livetv', { reason: 'recent' });
};
$('pill-inputs').onclick = function () {
  showInputs();
};
$('pill-settings').onclick = function () {
  launchApp('com.palm.app.settings');
};

for (var p = 0; p < pillButtons.length; p++) {
  pillButtons[p].onfocus = function () {
    elSelection.textContent = this.textContent.trim();
  };
}

// Navigate array with arrow keys
function navigate(arr, index, delta) {
  var next = index + delta;
  if (next < 0 || next >= arr.length) return;
  arr[next].focus();
  if (arr === appButtons) arr[next].scrollIntoView(false);
}

// Keyboard / Remote D-pad Navigation
document.addEventListener('keydown', function (ev) {
  var key = ev.keyCode;
  var cur = document.activeElement;

  // Back / Return / Esc (461 = LG Back, 27 = Esc)
  if (key === 461 || key === 27) {
    ev.preventDefault();
    if (ev.repeat) return;
    if (view === 'apps') {
      hideApps();
      return;
    }
    if (view === 'inputs') {
      hideInputs();
      return;
    }
    if (previousAppId) launchApp(previousAppId);
    else toast('No hay una app anterior. Abre CleanYourTV con HOME.');
    return;
  }

  // Yellow key (405) – toggle favorite
  if (key === 405 && cur && cur._app) {
    ev.preventDefault();
    toggleFav(cur._app);
    return;
  }

  // OK / Enter (13)
  if (key === 13) {
    ev.preventDefault();
    if (cur && cur.click) cur.click();
    return;
  }

  // Arrow keys (37 = Left, 38 = Up, 39 = Right, 40 = Down)
  if (key < 37 || key > 40) return;
  ev.preventDefault();

  // Mode: Inputs Selector Modal (5 columns grid)
  if (view === 'inputs') {
    var inIdx = inputButtons.indexOf(cur);
    if (inIdx < 0) {
      if (inputButtons.length) inputButtons[0].focus();
      return;
    }
    var COLS_INP = 5;
    if (key === 37 && inIdx % COLS_INP !== 0) navigate(inputButtons, inIdx, -1);
    if (key === 39 && inIdx % COLS_INP !== COLS_INP - 1) navigate(inputButtons, inIdx, 1);
    if (key === 38) {
      if (inIdx >= COLS_INP) navigate(inputButtons, inIdx, -COLS_INP);
    }
    if (key === 40) {
      if (inIdx + COLS_INP < inputButtons.length) navigate(inputButtons, inIdx, COLS_INP);
    }
    return;
  }

  // Mode: All-Apps Library Drawer
  if (view === 'apps') {
    var idx = appButtons.indexOf(cur);
    if (idx < 0) {
      if (appButtons.length) appButtons[0].focus();
      return;
    }
    if (key === 37 && idx % COLS_DRAWER !== 0) navigate(appButtons, idx, -1);
    if (key === 39 && idx % COLS_DRAWER !== COLS_DRAWER - 1) navigate(appButtons, idx, 1);
    if (key === 38) {
      if (idx < COLS_DRAWER) hideApps();
      else navigate(appButtons, idx, -COLS_DRAWER);
    }
    if (key === 40) {
      if (idx + COLS_DRAWER >= appButtons.length) hideApps();
      else navigate(appButtons, idx, COLS_DRAWER);
    }
    return;
  }

  // Mode: Main Parent Layout (Pills -> Featured -> Dock)
  var pIdx = pillButtons.indexOf(cur);
  var fIdx = featuredButtons.indexOf(cur);
  var dIdx = dockButtons.indexOf(cur);

  // Top Row: Pills
  if (pIdx >= 0) {
    if (key === 37) navigate(pillButtons, pIdx, -1);
    if (key === 39) navigate(pillButtons, pIdx, 1);
    if (key === 40) {
      // Down moves into Featured Cards
      if (featuredButtons.length) featuredButtons[Math.min(pIdx, featuredButtons.length - 1)].focus();
    }
    return;
  }

  // Middle Row: Featured Cards
  if (fIdx >= 0) {
    if (key === 37) navigate(featuredButtons, fIdx, -1);
    if (key === 39) navigate(featuredButtons, fIdx, 1);
    if (key === 38) {
      // Up moves into Pills
      if (pillButtons.length) pillButtons[Math.min(fIdx, pillButtons.length - 1)].focus();
    }
    if (key === 40) {
      // Down moves into Bottom Dock
      if (dockButtons.length) dockButtons[Math.min(fIdx, dockButtons.length - 1)].focus();
    }
    return;
  }

  // Bottom Row: Homebar Dock
  if (dIdx >= 0) {
    if (key === 37) navigate(dockButtons, dIdx, -1);
    if (key === 39) navigate(dockButtons, dIdx, 1);
    if (key === 38) {
      if (featuredButtons.length) featuredButtons[Math.min(dIdx, featuredButtons.length - 1)].focus();
    }
    return;
  }

  // Fallback: focus first dock button
  if (dockButtons.length) dockButtons[0].focus();
});

// Initialization
launched();
loadFavs();
renderFeatured();
renderDock();
renderApps();
renderInputs();
loadApps();
tickClock();
setInterval(tickClock, 10000);

// Default focus on the first dock item
if (dockButtons.length) {
  setTimeout(function () {
    dockButtons[0].focus();
  }, 100);
}
