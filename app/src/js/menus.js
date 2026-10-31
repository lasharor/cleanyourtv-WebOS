/* ---------- menus ---------- */
var stack = [],
  ovEl = null;
/* webOS 5's Chromium (68) can leave the old text in the compositor tile when an element's content is replaced, so menu and list text shows
   twice (issue 4). There the element is swapped for a fresh one instead of rewriting its content; newer engines just set innerHTML. */
var OLDGPU = (function () {
  var m = /Chrome\/(\d+)/.exec(navigator.userAgent || '');
  return !!m && +m[1] < 79;
})();
function setHtml(el, h) {
  if (!OLDGPU || !el.parentNode) {
    el.innerHTML = h;
    return el;
  }
  var n = el.cloneNode(false);
  n.innerHTML = h;
  el.parentNode.replaceChild(n, el);
  return n;
}
/* A menu can be built by a function (build): after a row with stay changes something, the menu is built again and stays open with the
   new values, and the menu below is built again when Back returns to it. A note row is text only: the focus skips it. */
function openMenu(title, items, idx, build) {
  var m = { title: title, items: build ? build() : items, idx: idx || 0, build: build || null };
  m.idx = usable(m, m.idx);
  stack.push(m);
  drawMenu();
}
function openBuilt(title, build, idx) {
  openMenu(title, null, idx, build);
}
function skip(it) {
  return !it || it.sep || it.note !== undefined;
}
/* the row at i, or the nearest one after (then before) it that can take the focus */
function usable(m, i) {
  var n = m.items.length;
  i = Math.max(0, Math.min(i, n - 1));
  for (var j = i; j < n; j++) if (!skip(m.items[j])) return j;
  for (j = i; j >= 0; j--) if (!skip(m.items[j])) return j;
  return i;
}
function refreshMenu() {
  var m = stack[stack.length - 1];
  if (!m) return;
  if (m.build) {
    /* the focus stays on the row with the same label (after "Move right" a "Move left" row can appear above it) */
    var was = m.items[m.idx] && m.items[m.idx].label;
    m.items = m.build();
    for (var i = 0; i < m.items.length; i++)
      if (was && m.items[i].label === was && !skip(m.items[i])) {
        m.idx = i;
        break;
      }
    m.idx = usable(m, m.idx);
  }
  drawMenu();
}
function closeMenus() {
  stack = [];
  if (ovEl) {
    ovEl.remove();
    ovEl = null;
  }
  drawSide(null);
}
/* a menu whose rows carry a picture (pv, the theme list) shows it with a description left of the list. Its own element, outside
   the menu that is redrawn on every key, so the picture is only loaded again when the focused row's picture changes. */
var sideEl = null;
function drawSide(it) {
  if (!it) {
    if (sideEl) sideEl.remove();
    sideEl = null;
    return;
  }
  if (!sideEl) {
    sideEl = document.createElement('div');
    sideEl.id = 'ovside';
    sideEl.innerHTML = '<div class="pvbox"><img alt=""></div><div class="pt"></div><div class="pd"></div>';
    document.body.appendChild(sideEl);
  }
  var img = sideEl.querySelector('img'),
    url = it.pv ? API + '/api/theme/preview/' + it.pv : '';
  if (img.getAttribute('data-u') !== url) {
    img.setAttribute('data-u', url);
    img.style.visibility = 'hidden';
    img.onload = function () {
      img.style.visibility = '';
    };
    if (url) img.src = url;
    else img.removeAttribute('src');
  }
  sideEl.querySelector('.pt').textContent = it.label;
  sideEl.querySelector('.pd').textContent = it.desc || '';
}
function backMenu() {
  stack.pop();
  if (stack.length) refreshMenu();
  else closeMenus();
}
/* Hovering never moves the list, except on its first or last visible row, where it scrolls one row: 1 down, -1 up, 0 not at all.
   k: the row under the pointer, start: the first row on show, N: how many are on show, len: how many rows there are */
function hoverDir(k, start, N, len) {
  if (k === start + N - 1 && start + N < len) return 1;
  if (k === start && start > 0) return -1;
  return 0;
}
function drawMenu(win) {
  // win: the first visible row, when the pointer asks for a window (otherwise the selection sits on the fourth row)
  var m = stack[stack.length - 1],
    N = 8,
    start = Math.max(0, Math.min(m.idx - 3, m.items.length - N));
  if (typeof win === 'number') start = Math.max(0, Math.min(win, m.items.length - N));
  m.start = start;
  if (!ovEl) {
    ovEl = document.createElement('div');
    ovEl.id = 'ov';
    document.body.appendChild(ovEl);
  }
  var h = '<div class="panel"><h2></h2><div class="more">' + (start > 0 ? '▲' : '') + '</div>';
  for (var i = start; i < Math.min(m.items.length, start + N); i++) {
    var it = m.items[i];
    if (it.sep) {
      h += '<div class="msep"></div>';
      continue;
    }
    if (it.note !== undefined) {
      h += '<div class="mnote" data-n="' + i + '"></div>';
      continue;
    }
    h +=
      '<div class="row' +
      (i === m.idx ? ' f' : '') +
      (it.dim ? ' dim' : '') +
      '" data-i="' +
      i +
      '">' +
      (it.icon ? svg(it.icon) : '') +
      '<span class="lb"></span>' +
      (it.sub ? '<span class="st"></span>' : '') +
      '</div>';
  }
  h += '<div class="more">' + (start + N < m.items.length ? '▼' : '') + '</div></div>';
  ovEl = setHtml(ovEl, h);
  var side = m.items.some(function (x) {
    return x.desc !== undefined;
  });
  ovEl.className = side ? 'ws' : '';
  drawSide(side && !skip(m.items[m.idx]) ? m.items[m.idx] : null);
  ovEl.querySelector('h2').textContent = m.title;
  [].forEach.call(ovEl.querySelectorAll('.mnote'), function (el) {
    el.textContent = m.items[+el.getAttribute('data-n')].note;
  });
  [].forEach.call(ovEl.querySelectorAll('.row'), function (row) {
    var it = m.items[+row.getAttribute('data-i')];
    row.querySelector('.lb').textContent = it.label;
    if (it.sub) row.querySelector('.st').textContent = it.sub;
    var pt = 0,
      rowHeld = false;
    if (it.hold) {
      row.addEventListener('mousedown', function () {
        rowHeld = false;
        clearTimeout(pt);
        pt = setTimeout(function () {
          rowHeld = true;
          it.hold();
        }, 650);
      });
      row.addEventListener('mouseup', function () {
        clearTimeout(pt);
      });
    }
    row.addEventListener('click', function () {
      if (rowHeld) return void (rowHeld = false);
      m.idx = +row.getAttribute('data-i');
      pickMenu();
    });
    row.addEventListener('mousemove', function (ev) {
      var k = +row.getAttribute('data-i');
      if (m.idx === k || Date.now() - lastKey < 1500) return;
      if (lastMX >= 0 && Math.abs(ev.clientX - lastMX) + Math.abs(ev.clientY - lastMY) < 24) return; // real movement only
      lastMX = ev.clientX;
      lastMY = ev.clientY;
      // hovering never moves the list, except on the first and last visible row, where it scrolls one row, at most about three times a second
      var s0 = m.start || 0,
        now = Date.now(),
        dir = hoverDir(k, s0, N, m.items.length);
      if (dir && now - (m.scrollAt || 0) < 350) dir = 0;
      if (dir) m.scrollAt = now;
      m.idx = k;
      drawMenu(s0 + dir);
    });
  });
}
/* a row without stay closes the menus (it opened an app or finished a task); with stay the menu stays and shows the new values */
function pickMenu() {
  var m = stack[stack.length - 1],
    it = m.items[m.idx];
  if (it && it.fn && !skip(it)) {
    var n = stack.length;
    it.fn();
    if (stack.length !== n || stack[stack.length - 1] !== m) return;
    if (it.stay) refreshMenu();
    else closeMenus();
  }
}
/* the next row up or down that can take the focus, or -1 */
function menuStep(m, d) {
  for (var i = m.idx + d; i >= 0 && i < m.items.length; i += d) if (!skip(m.items[i])) return i;
  return -1;
}
function menuKey(k) {
  var m = stack[stack.length - 1],
    n = k === 38 ? menuStep(m, -1) : k === 40 ? menuStep(m, 1) : -1;
  if (n >= 0) {
    m.idx = n;
    drawMenu();
  } else if (k === 38 || k === 40) {
    /* the first or last row: nothing to move to */
  } else if (k === 13) pickMenu();
  else if (k === 461 || k === 27 || k === 8) backMenu();
  else return false;
  return true;
}

/* The wheel on the home screen goes tile by tile in reading order: along the dock, then along the grid row after row (the end of a row
   goes on with the next one), and the other way back. The top buttons stay with the Up key and the pointer; from them the wheel goes
   down to the first tile. */
function homeStep(dir) {
  var first = rows[1] === rows[0] ? 2 : 1; // without a dock, row 1 is the row of buttons again
  if (r < first) {
    if (dir > 0) setFocus(first, 0);
    return;
  }
  var nr = r,
    nc = c + dir;
  if (nc < 0) {
    nr = r - 1;
    if (nr < first) return;
    nc = rows[nr].length - 1;
  } else if (nc >= rows[r].length) {
    nr = r + 1;
    if (nr >= rows.length) return;
    nc = 0;
  }
  setFocus(nr, nc);
}
/* the Magic Remote's wheel moves an open menu one row per notch, and on the home screen one tile (homeStep); lastKey keeps the pointer
   from taking the selection back while the list moves under it. Live TV has its own wheel handling. */
var lastWheel = 0;
document.addEventListener(
  'wheel',
  function (e) {
    if (LIVE.on || !e.deltaY) return;
    e.preventDefault();
    lastKey = Date.now();
    if (lastKey - lastWheel < (stack.length ? 70 : 100)) return;
    lastWheel = lastKey;
    if (stack.length) menuKey(e.deltaY > 0 ? 40 : 38);
    else if (moving) handleMoveKey(e.deltaY > 0 ? 39 : 37); /* while a tile is moved, the wheel moves it along the row */
    else homeStep(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false }
);

/* Back on the home screen lists the running apps to close them, as LG's Home does with its Recents on a second Back (issue 16) */
function runningMenu() {
  api('/api/running').then(
    function (x) {
      if (x.error) return toast(t('Could not read the open apps. Try again in a moment.'), true);
      openMenu(t('Running apps'), runningItems(x.apps || []));
      stack[stack.length - 1].running = true;
    },
    function () {
      toast(t('Could not read the open apps. Try again in a moment.'), true);
    }
  );
}
/* the list is only true for the moment it was read: it goes when Home is left, so it is never shown out of date */
function closeRunningMenu() {
  if (
    stack.some(function (m) {
      return m.running;
    })
  )
    closeMenus();
}
function runningItems(list) {
  if (!list.length) return [{ label: t('No apps are running'), dim: true }];
  var items = list.map(function (a) {
    return {
      label: a.title,
      sub: t('Close'),
      stay: true,
      fn: function () {
        closeRunning(list, [a.id]);
      },
    };
  });
  if (list.length > 1)
    items.push({
      label: t('Close all'),
      stay: true,
      fn: function () {
        closeRunning(
          list,
          list.map(function (a) {
            return a.id;
          })
        );
      },
    });
  return items;
}
/* the app manager's running list lags by seconds after a close, so the rows go at once instead of after a new reading */
function closeRunning(list, ids) {
  var m = stack[stack.length - 1],
    left = list.filter(function (a) {
      return ids.indexOf(a.id) < 0;
    });
  api('/api/running/close', ids.length > 1 ? { all: true } : { id: ids[0] }).then(
    function (x) {
      if (!x || x.returnValue !== true) toast(t('Could not close the app. Try again, or close it from the app itself.'), true);
    },
    function () {
      toast(t('Could not close the app. Try again, or close it from the app itself.'), true);
    }
  );
  ids.forEach(function (id) {
    delete running[id];
  });
  markRunning();
  m.items = runningItems(left);
  m.idx = Math.min(m.idx, m.items.length - 1);
  drawMenu();
}

function inputsMenu() {
  api('/api/inputs').then(function (x) {
    var items = (x.devices || [])
      .filter(function (d) {
        return d.appId;
      })
      .map(function (d) {
        /* LG's own Live TV (the tuner) is an input too: it opens LG's player with the antenna or cable channels. It is not pinned to
           Home like an HDMI port (a button does that), so it has no hold action */
        if (d.tuner)
          return {
            icon: 'tv',
            label: t('TV'),
            sub: t('Tuner') + (d.activate ? ' \u00B7 ' + t('Active') : ''),
            fn: function () {
              launch(d.appId);
            },
          };
        var port = 'HDMI ' + d.port,
          named = d.label && d.label !== port && d.label !== 'HDMI ' + d.port,
          parts = [];
        if (named) parts.push(port);
        if (d.hdmiPlugIn) parts.push(t('Connected'));
        if (d.activate) parts.push(t('Active'));
        return {
          icon: 'hdmi',
          label: d.label || port,
          sub: parts.join(' \u00B7 '),
          dim: !d.hdmiPlugIn,
          fn: function () {
            launch(d.appId);
          },
          /* hold OK: pin the input to Home, where it is a tile like an app */
          hold: function () {
            inputMenu(d.appId, d.label || port);
          },
        };
      });
    openMenu(t('Inputs'), items);
  });
}
function isPinned(id) {
  return apps.some(function (a) {
    return a.id === id && a.input;
  });
}
function inputMenu(id, name) {
  var on = isPinned(id);
  openMenu(name, [
    {
      label: t('Open'),
      fn: function () {
        launch(id);
      },
    },
    {
      label: on ? t('Remove from Home') : t('Add to Home'),
      fn: function () {
        pinInput(id, name, !on);
      },
    },
  ]);
}
/* the service keeps the pinned inputs (also for the Inputs picker) and lists them with the apps */
function pinInput(id, name, on) {
  api('/api/inputs/pin', { id: id, on: on }).then(
    function (x) {
      if (!x || x.returnValue !== true) return toast(t('Could not change Home. Try again in a moment.'), true);
      toast((on ? t('%s added to Home') : t('%s removed from Home')).replace('%s', name));
      lastSig = '';
      load();
    },
    function () {
      toast(t('Could not change Home. Try again in a moment.'), true);
    }
  );
}

function appMenu(a) {
  openBuilt(a.title, function () {
    var di = dockIds(),
      pos = di.indexOf(a.id),
      items = [
        {
          label: t('Open'),
          fn: function () {
            launch(a.id);
          },
        },
        {
          label: t('Move'),
          fn: function () {
            startMoving(a.id);
          },
        },
      ];
    if (pos >= 0) {
      items.push({
        label: t('Remove from dock'),
        stay: true,
        fn: function () {
          setDock(
            di.filter(function (i) {
              return i !== a.id;
            })
          );
        },
      });
    } else if (di.length < TH.dockN)
      items.push({
        label: t('Add to dock'),
        stay: true,
        fn: function () {
          setDock(di.concat(a.id));
        },
      });
    else
      items.push({
        label: t('Add to dock...'),
        stay: true,
        fn: function () {
          openMenu(
            t('Replace which app?'),
            di.map(function (id, i) {
              return {
                label: title(id),
                stay: true,
                fn: function () {
                  var d = di.slice();
                  d[i] = a.id;
                  setDock(d);
                  backMenu();
                },
              };
            })
          );
        },
      });
    if (a.input)
      items.push({
        label: t('Remove from Home'),
        fn: function () {
          pinInput(a.id, a.title, false);
        },
      });
    else {
      items.push({
        label: t('Hide app'),
        fn: function () {
          hideApp(a.id);
          toast(t('%s is hidden. Customise > Hidden apps shows it again.').replace('%s', a.title));
        },
      });
      if (a.removable)
        items.push({
          label: t('Uninstall'),
          icon: 'trash',
          fn: function () {
            confirmUninstall(a);
          },
        });
    }
    return items;
  });
}

function disintegrateApp(a, done) {
  var el = tiles[a.id];
  if (!el || !el.parentNode) {
    if (done) done();
    return;
  }
  var rect = el.getBoundingClientRect();
  var col = el.style.getPropertyValue('--c') || '120, 140, 180';

  el.classList.add('disintegrate-prep');

  setTimeout(function () {
    el.classList.remove('disintegrate-prep');
    el.classList.add('disintegrate');

    var box = document.createElement('div');
    box.className = 'disintegrate-box';
    box.style.left = Math.round(rect.left) + 'px';
    box.style.top = Math.round(rect.top) + 'px';
    box.style.width = Math.round(rect.width) + 'px';
    box.style.height = Math.round(rect.height) + 'px';
    document.body.appendChild(box);

    var N = 10;
    var particles = [];
    for (var i = 0; i < N; i++) {
      var p = document.createElement('span');
      p.className = 'disintegrate-p';
      var size = Math.floor(7 + Math.random() * 6);
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.background = i % 2 === 0 ? 'rgb(' + col + ')' : 'rgba(255, 255, 255, 0.85)';

      var startX = rect.width / 2 - size / 2;
      var startY = rect.height / 2 - size / 2;
      p.style.left = Math.round(startX) + 'px';
      p.style.top = Math.round(startY) + 'px';
      box.appendChild(p);

      var angle = (i / N) * 2 * Math.PI + (Math.random() - 0.5) * 0.4;
      var dist = Math.round(65 + Math.random() * 65);
      var dx = Math.round(Math.cos(angle) * dist);
      var dy = Math.round(Math.sin(angle) * dist);
      particles.push({ el: p, dx: dx, dy: dy });
    }

    /* force layout reflow so the browser commits the initial translate3d(0, 0, 0) */
    void box.offsetHeight;

    setTimeout(function () {
      for (var j = 0; j < particles.length; j++) {
        var pt = particles[j];
        pt.el.style.transform = 'translate3d(' + pt.dx + 'px, ' + pt.dy + 'px, 0) scale(0)';
        pt.el.style.opacity = '0';
      }
    }, 20);

    setTimeout(function () {
      box.remove();
      if (el && el.parentNode) el.remove();
      delete tiles[a.id];
      if (done) done();
    }, 400);
  }, 50);
}

/* Power off completely (issue 50): the TV switches off for good, unlike the remote's power key, which keeps Quick Start+ standby. The
   next start is a cold boot, so the launcher takes its usual time, and Wake-on-LAN does not wake the TV. Asked first, never one press. */
function confirmPowerOff() {
  openMenu(t('Power off completely?'), [
    {
      label: t('Power off completely'),
      sub: t('The next start is slower, and Wake-on-LAN no longer wakes the TV.'),
      icon: 'power',
      fn: function () {
        closeMenus();
        toast(t('Powering off...'));
        api('/api/power/off', {}).then(
          function () {},
          function () {
            toast(t('The service did not answer.'), true);
          }
        );
      },
    },
    {
      label: t('Cancel'),
      fn: function () {
        backMenu();
      },
    },
  ]);
}
function confirmUninstall(a) {
  openMenu(t('Uninstall %s?').replace('%s', a.title), [
    {
      label: t('Uninstall'),
      icon: 'trash',
      fn: function () {
        closeMenus();
        toast(t('Uninstalling %s...').replace('%s', a.title));
        /* the tile goes only once the TV has removed the app; a failed removal leaves Home, the dock and the hidden list as they were */
        api('/api/apps/uninstall', { id: a.id })
          .then(
            function (res) {
              return res;
            },
            function () {
              return { returnValue: false };
            }
          )
          .then(function (res) {
            if (!res || !res.returnValue) {
              toast(t('Could not uninstall %s.').replace('%s', a.title), true);
              return;
            }
            disintegrateApp(a, function () {
              apps = apps.filter(function (x) {
                return x.id !== a.id;
              });
              if (cfg.dock)
                cfg.dock = cfg.dock.filter(function (x) {
                  return x !== a.id;
                });
              if (cfg.hidden)
                cfg.hidden = cfg.hidden.filter(function (x) {
                  return x !== a.id;
                });
              delete tiles[a.id];
              store();
              lastSig = '';
              rebuild();
              if (rows[r]) {
                c = Math.min(c, rows[r].length - 1);
                if (rows[r][c]) setFocus(r, c);
              }
              toast(t('%s uninstalled.').replace('%s', a.title));
              load();
            });
          });
      },
    },
    {
      label: t('Cancel'),
      fn: function () {
        backMenu();
      },
    },
  ]);
}

function removeButton(o) {
  cfg.topbar = topbar().filter(function (b) {
    return b !== o;
  });
  saveCfg();
}
/* moves a button one place among the shown ones (a hidden Live TV button keeps its place in the saved list) */
function moveButton(o, d) {
  var tb = topbar().slice(),
    i = tb.indexOf(o),
    j = i + d;
  while (j >= 0 && j < tb.length && !liveOn() && tb[j].action === 'live') j += d;
  if (i < 0 || j < 0 || j >= tb.length) return;
  tb[i] = tb[j];
  tb[j] = o;
  cfg.topbar = tb;
  saveCfg();
}
function barMenu(o) {
  openBuilt(barLabel(o), function () {
    var sb = shownBar(),
      pos = sb.indexOf(o),
      items = [];
    if (pos > 0)
      items.push({
        label: t('Move left'),
        stay: true,
        fn: function () {
          moveButton(o, -1);
        },
      });
    if (pos >= 0 && pos < sb.length - 1)
      items.push({
        label: t('Move right'),
        stay: true,
        fn: function () {
          moveButton(o, 1);
        },
      });
    items.push({
      label: t('Remove this button'),
      stay: true,
      fn: function () {
        removeButton(o);
        backMenu();
      },
    });
    return items;
  });
}
/* Customise: how Home looks. What the TV and the service do is in the manager app (More settings...) */
function customizeMenu() {
  openBuilt(t('Customise'), function () {
    var nh = hiddenIds().length;
    return [
      /* the cards in the theme's places, chosen with the remote (hamenu.js); first, so it is found */
      (TH.slots || []).length ? { label: 'Home Assistant', sub: t('Cards on Home'), stay: true, fn: haMenu } : null,
      { label: t('Dock'), stay: true, fn: dockMenu },
      { label: t('Top buttons'), stay: true, fn: topButtonsMenu },
      { label: t('Hidden apps'), sub: nh ? String(nh) : '', stay: true, fn: hiddenMenu },
      {
        label: t('App order'),
        sub: cfg.sort === 'alpha' ? t('A to Z') : cfg.sort === 'custom' ? t('Custom static') : t('Most used first'),
        stay: true,
        fn: function () {
          cfg.sort = cfg.sort === 'alpha' ? 'custom' : cfg.sort === 'custom' ? 'usage' : 'alpha';
          if (cfg.sort === 'custom' && (!cfg.order || !cfg.order.length)) {
            cfg.order = gridAppIds();
          }
          saveCfg();
        },
      },
      cfg.sort === 'custom'
        ? {
            label: t('Arrange apps...'),
            stay: true,
            fn: gridAppsMenu,
          }
        : null,
      {
        label: t('Show app name'),
        sub: cfg.shelfShow === false ? t('Off') : t('On'),
        stay: true,
        fn: function () {
          if (cfg.shelfShow === false) delete cfg.shelfShow;
          else cfg.shelfShow = false;
          applyShelfPref();
          saveCfg();
        },
      },
      {
        label: t('Mark running apps'),
        sub: cfg.runDots === true ? t('Green dot') : t('No dot'),
        stay: true,
        fn: function () {
          if (cfg.runDots === true) delete cfg.runDots;
          else cfg.runDots = true;
          saveCfg();
        },
      },
      {
        label: t('Clock'),
        sub: cfg.clock === '24' ? t('24-hour') : cfg.clock === '12' ? t('12-hour') : t('Automatic'),
        stay: true,
        fn: function () {
          cfg.clock = cfg.clock === '24' ? '12' : cfg.clock === '12' ? 'auto' : '24';
          saveCfg();
          tick();
        },
      },
      { sep: true },
      { label: t('Theme'), stay: true, fn: themeMenu },
      /* only where the theme has slots for cards */
      (TH.slots || []).length
        ? {
            label: t('Cards'),
            sub: t('in the CleanYourTV app'),
            fn: function () {
              launch('com.cleanyourtv.manager', { open: 'cards' });
            },
          }
        : null,
      {
        label: t('Wallpapers'),
        sub: cfg.wall && cfg.wall.on ? t('On') : t('Off'),
        stay: true,
        fn: wallMenu,
      },
      { label: t('Accent colour'), stay: true, fn: accentMenu },
      { sep: true },
      {
        label: t('More settings...'),
        sub: t('Home, Live TV, Debloat, updates'),
        fn: function () {
          launch('com.cleanyourtv.manager');
        },
      },
      /* the hidden gestures, said where people already look instead of over Home (issue: hold OK was undiscoverable) */
      { note: t('Hold OK on an app for its options. Back on Home lists the open apps.') },
    ].filter(function (it) {
      return it;
    });
  });
}
/* Wallpapers: switched on here and how often the photo changes; the photos are added in the manager (uploads from a phone, Immich) */
function wallMenu() {
  openBuilt(t('Wallpapers'), function () {
    var w = cfg.wall || { on: false },
      e = wallSecs(),
      n = +String((cfg.wallpapers && cfg.wallpapers.stamp) || '0').split(':')[0] || 0,
      EV = [0, 10, 30, 60, 180, 300, 900, 3600],
      name = function (x) {
        return !x
          ? t('Each time Home opens')
          : x < 60
            ? t('Every %s s').replace('%s', x)
            : x === 60
              ? t('Every minute')
              : t('Every %s min').replace('%s', x / 60);
      };
    return [
      {
        label: t('Use Wallpapers'),
        sub: (w.on ? t('On') : t('Off')) + ' \u00B7 ' + (n ? t(n + ' photos') : t('no photos yet')),
        stay: true,
        fn: function () {
          cfg.wall = { on: !w.on, secs: e };
          saveCfg();
        },
      },
      {
        label: t('New photo'),
        sub: name(e),
        stay: true,
        fn: function () {
          var k = EV.indexOf(e);
          cfg.wall = { on: !!w.on, secs: EV[(k < 0 ? 6 : k + 1) % EV.length] };
          saveCfg();
        },
      },
      { sep: true },
      {
        label: t('Add photos...'),
        sub: t('in the CleanYourTV app'),
        fn: function () {
          launch('com.cleanyourtv.manager', { open: 'wallpapers' });
        },
      },
    ];
  });
}
/* the apps that can go in the dock or on a button: not hidden, not Live TV, A to Z */
function pickApp(heading, skip, cb) {
  var list = apps
    .filter(function (a) {
      return a.id !== '__live' && !isHidden(a.id) && skip.indexOf(a.id) < 0;
    })
    .sort(function (a, b) {
      return a.title.localeCompare(b.title);
    });
  openMenu(
    heading,
    list.map(function (a) {
      return {
        label: a.title,
        stay: true,
        fn: function () {
          cb(a);
        },
      };
    })
  );
}
function dockMenu() {
  openBuilt(t('Dock'), function () {
    var di = dockIds(),
      items = di.map(function (id, i) {
        return {
          label: title(id),
          stay: true,
          fn: function () {
            dockSlotMenu(i);
          },
        };
      });
    if (di.length < TH.dockN)
      items.push({
        label: t('Add an app...'),
        stay: true,
        fn: function () {
          pickApp(t('Add to dock'), di, function (a) {
            setDock(dockIds().concat(a.id));
            backMenu();
          });
        },
      });
    return items;
  });
}
function gridAppsMenu() {
  openBuilt(t('Apps'), function () {
    var ga = gridApps();
    return ga.map(function (a) {
      return {
        label: a.title,
        fn: function () {
          startMoving(a.id);
        },
      };
    });
  });
}
/* one app in the dock; after a move the menu stays on the same app (now in its new place), so it can be moved again */
function dockSlotMenu(start) {
  var id = dockIds()[start];
  openBuilt(title(id), function () {
    var di = dockIds(),
      i = di.indexOf(id),
      move = function (d) {
        var x = di.slice();
        x[i] = x[i + d];
        x[i + d] = id;
        setDock(x);
      },
      items = [
        {
          label: t('Replace with...'),
          stay: true,
          fn: function () {
            pickApp(title(id), [id], function (a) {
              /* an app that is in the dock already swaps places with this one */
              var x = di.slice(),
                j = x.indexOf(a.id);
              if (j >= 0) x[j] = id;
              x[i] = a.id;
              setDock(x);
              backMenu();
              backMenu();
            });
          },
        },
      ];
    if (i > 0)
      items.push({
        label: t('Move left'),
        stay: true,
        fn: function () {
          move(-1);
        },
      });
    if (i >= 0 && i < di.length - 1)
      items.push({
        label: t('Move right'),
        stay: true,
        fn: function () {
          move(1);
        },
      });
    items.push({
      label: t('Remove from dock'),
      stay: true,
      fn: function () {
        setDock(
          di.filter(function (x) {
            return x !== id;
          })
        );
        backMenu();
      },
    });
    return items;
  });
}
function topButtonsMenu() {
  openBuilt(t('Top buttons'), function () {
    var items = shownBar().map(function (o) {
      return {
        icon: o.icon,
        label: barLabel(o),
        stay: true,
        fn: function () {
          barMenu(o);
        },
      };
    });
    items.push({ label: t('Add a button...'), stay: true, fn: addButtonMenu });
    return items;
  });
}
/* themes come from the service (GET /api/theme/list); choosing one applies it, a theme not on the TV is downloaded first */
function themeList(then) {
  api('/api/theme/list').then(
    function (r) {
      if (r.error) return toast(r.error, true);
      then(r);
    },
    function () {
      toast(t('Could not load the themes. Try again in a moment.'), true);
    }
  );
}
/* the service answers with the theme list again; the open theme or accent menu is built from it, so it shows the new choice */
function themeCall(path, b, after) {
  api(path, b).then(
    function (r) {
      if (r.error) return toast(r.error, true);
      lastSig = '';
      load();
      if (after) after(r);
    },
    function () {
      toast(t('Could not load the themes. Try again in a moment.'), true);
    }
  );
}
function themeMenu() {
  themeList(function (data) {
    var at = 0,
      build = function () {
        var r = data,
          cur = (r.current && r.current.id) || 'classic',
          name = function (id) {
            var n = id;
            (r.themes || []).forEach(function (x) {
              if (x.id === id) n = x.name;
            });
            return n;
          },
          items = (r.themes || []).map(function (x, i) {
            if (x.id === cur) at = i;
            return {
              label: x.name,
              pv: x.preview ? x.id : '',
              desc: (x.description || '') + (x.author ? '\n\n' + x.author : ''),
              sub: x.id === cur ? t('Selected') : x.installed || x.id === 'classic' ? '' : t('Downloads when chosen'),
              stay: true,
              fn: function () {
                if (x.id === cur) return;
                if (!x.installed) toast(t('Getting the theme...'));
                themeCall('/api/theme/set', { id: x.id }, update);
              },
            };
          });
        if (r.previous && r.previous.id) {
          items.push({ sep: true });
          items.push({
            icon: 'restore',
            label: t('Go back to the previous theme'),
            sub: name(r.previous.id),
            pv: (r.themes || []).some(function (x) {
              return x.id === r.previous.id && x.preview;
            })
              ? r.previous.id
              : '',
            desc: '',
            stay: true,
            fn: function () {
              themeCall('/api/theme/revert', {}, update);
            },
          });
        }
        return items;
      },
      update = function (r) {
        data = r;
        if (stack.length && stack[stack.length - 1].build === build) refreshMenu();
      };
    build();
    if (data.catalogue && !data.catalogue.ok) toast(t('Could not reach GitHub: showing the themes on this TV'));
    openBuilt(t('Theme'), build, at);
  });
}
function accentMenu() {
  themeList(function (data) {
    var at = 0,
      build = function () {
        var cur = (data.current && data.current.accent) || '';
        return (data.accents || []).map(function (a, i) {
          if (a.hex === cur) at = i;
          return {
            label: a.name === 'Theme default' ? t('Theme default') : t(a.name), // the other names are colours the service lists
            sub: a.hex === cur ? t('Selected') : '',
            stay: true,
            fn: function () {
              themeCall('/api/theme/set', { accent: a.hex }, update);
            },
          };
        });
      },
      update = function (r) {
        data = r;
        if (stack.length && stack[stack.length - 1].build === build) refreshMenu();
      };
    build();
    openBuilt(t('Accent colour'), build, at);
  });
}
function addButtonMenu() {
  var add = function (b) {
    cfg.topbar = topbar().concat([b]);
    saveCfg();
  };
  var items = PRESETS.filter(function (p) {
    /* LG's own Live TV: the button is offered only where that app is installed, as the Inputs list offers the tuner */
    return (liveOn() || p.action !== 'live') && (tunerOn || p.app !== 'com.webos.app.livetv');
  }).map(function (p) {
    return {
      icon: p.icon,
      label: barLabel(p),
      stay: true,
      fn: function () {
        add(p);
        backMenu();
      },
    };
  });
  items.push({
    label: t('An app...'),
    stay: true,
    fn: function () {
      pickApp(t('Pick an app'), [], function (a) {
        add({ label: a.title, icon: 'grid', app: a.id });
        backMenu();
        backMenu();
      });
    },
  });
  openMenu(t('Add a button'), items);
}
function hiddenIds() {
  return (cfg.hidden || []).filter(function (id) {
    return apps.some(function (a) {
      return a.id === id;
    });
  });
}
function hiddenMenu() {
  openBuilt(t('Hidden apps'), function () {
    var h = hiddenIds();
    if (!h.length) return [{ note: t('No hidden apps. To hide one, hold OK on it on Home and choose Hide app.') }];
    return [{ note: t('OK shows an app on Home again.') }].concat(
      h.map(function (id) {
        return {
          label: title(id),
          stay: true,
          fn: function () {
            unhideApp(id);
          },
        };
      })
    );
  });
}
