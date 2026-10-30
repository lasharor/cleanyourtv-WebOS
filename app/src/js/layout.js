/* ---------- layout ---------- */
function rebuild(animate) {
  var rects = {};
  if (animate && moving) {
    for (var k in tiles) {
      var el = tiles[k];
      if (el && el.parentNode) {
        rects[k] = el.getBoundingClientRect();
      }
    }
  }
  var by = {};
  apps.forEach(function (a) {
    by[a.id] = a;
  });
  var di = dockIds(),
    dock = di.map(function (i) {
      return by[i];
    });
  var rest = gridApps();
  var oldE = rows[r] && rows[r][c],
    keep = moving || (oldE && oldE._a ? oldE._a.id : null);
  if (oldE) oldE.classList.remove('f');
  var dk = $('dock'),
    gd = $('grid'),
    bar = $('bar');
  dk.textContent = '';
  gd.textContent = '';
  var tb;
  if (!moving) {
    bar.textContent = '';
    tb = shownBar()
      .concat([{ label: 'Customise', icon: 'edit', action: 'customize', fixed: true }])
      .map(function (o) {
        var p = document.createElement('div');
        p.className = 'pill';
        p._o = o;
        p.innerHTML = svg(o.icon) + '<span></span>';
        p.lastChild.textContent = barLabel(o);
        hit(p);
        bar.appendChild(p);
        return p;
      });
    drawCards();
  } else {
    tb = Array.prototype.slice.call(bar.children);
  }
  var d = dock.map(function (a) {
    var t = tile(a);
    dk.appendChild(t);
    fit(t, true);
    return t;
  });
  var g = rest.map(function (a) {
    var t = tile(a);
    gd.appendChild(t);
    fit(t, false);
    return t;
  });
  var top = tb.concat(cardTargets());
  placeShelf(d.length);
  rows = [top, d.length ? d : top];
  for (var i = 0; i < g.length; i += TH.cols) rows.push(g.slice(i, i + TH.cols));
  var nr = Math.min(r, rows.length - 1),
    nc = c;
  if (keep && tiles[keep]) {
    var p = posOf(tiles[keep]);
    if (p) {
      nr = p[0];
      nc = p[1];
    }
  }
  setFocus(nr, nc, true);
  if (moving && tiles[moving]) tiles[moving].classList.add('moving');
  markRunning();
  if (animate && moving) {
    var animating = [];
    for (k in rects) {
      el = tiles[k];
      if (el && el.parentNode) {
        var oldR = rects[k],
          newR = el.getBoundingClientRect(),
          dx = oldR.left - newR.left,
          dy = oldR.top - newR.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          var isMv = el.classList.contains('moving');
          el.style.transition = 'none';
          el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)' + (isMv ? ' scale(1.08)' : '');
          animating.push({ el: el, isMv: isMv });
        }
      }
    }
    if (animating.length) {
      void animating[0].el.offsetWidth;
      animating.forEach(function (item) {
        item.el.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
        item.el.style.transform = item.isMv ? 'scale(1.08)' : '';
      });
      setTimeout(function () {
        animating.forEach(function (item) {
          item.el.style.transition = '';
          if (!item.isMv) item.el.style.transform = '';
        });
      }, 220);
    }
  }
}

var moving = null;
function startMoving(id) {
  while (stack.length) backMenu();
  if (cfg.sort !== 'custom') {
    cfg.sort = 'custom';
    cfg.order = gridAppIds();
  }
  if (!cfg.dock) cfg.dock = dockIds();
  moving = id;
  if (tiles[id]) {
    tiles[id].classList.add('moving');
    var p = posOf(tiles[id]);
    if (p) setFocus(p[0], p[1], true);
  }
  toast(t('Use arrows to move, press OK when done'));
}
function stopMoving() {
  if (!moving) return;
  var id = moving;
  moving = null;
  if (tiles[id]) tiles[id].classList.remove('moving');
  saveCfg();
}
function getGridOrder() {
  var gi = gridAppIds(),
    ord = [];
  if (cfg.sort === 'custom' && cfg.order) {
    cfg.order.forEach(function (x) {
      if (gi.indexOf(x) >= 0 && ord.indexOf(x) < 0) ord.push(x);
    });
  }
  gi.forEach(function (x) {
    if (ord.indexOf(x) < 0) ord.push(x);
  });
  return ord;
}
function swapDockAndGrid(dpos, gpos) {
  var di = dockIds(),
    gi = gridAppIds();
  if (dpos < 0 || dpos >= di.length || gpos < 0 || gpos >= gi.length) return;
  var dockApp = di[dpos],
    gridApp = gi[gpos],
    newDock = di.slice(),
    ord = getGridOrder();
  newDock[dpos] = gridApp;
  var idx = ord.indexOf(gridApp);
  if (idx >= 0) ord[idx] = dockApp;
  else ord.push(dockApp);
  cfg.sort = 'custom';
  cfg.dock = newDock;
  cfg.order = ord;
  rebuild(true);
}
function moveGridApp(id, d) {
  var ord = getGridOrder(),
    i = ord.indexOf(id),
    j = i + d;
  if (i < 0 || j < 0 || j >= ord.length) return;
  var tmp = ord[i];
  ord[i] = ord[j];
  ord[j] = tmp;
  cfg.sort = 'custom';
  cfg.order = ord;
  rebuild(true);
}
function handleMoveKey(k) {
  if (!moving) return;
  var di = dockIds(),
    dpos = di.indexOf(moving),
    gi = gridAppIds(),
    cols = TH.cols || 4,
    d;
  if (dpos >= 0) {
    if (k === 37) {
      if (dpos > 0) {
        d = di.slice();
        d[dpos] = d[dpos - 1];
        d[dpos - 1] = moving;
        cfg.dock = d;
        rebuild(true);
      }
    } else if (k === 39) {
      if (dpos < di.length - 1) {
        d = di.slice();
        d[dpos] = d[dpos + 1];
        d[dpos + 1] = moving;
        cfg.dock = d;
        rebuild(true);
      } else {
        if (gi.length > 0) swapDockAndGrid(dpos, 0);
      }
    } else if (k === 40) {
      var targetGpos = Math.min(dpos, Math.min(cols - 1, gi.length - 1));
      if (targetGpos >= 0) {
        swapDockAndGrid(dpos, targetGpos);
      } else if (di.length > 1) {
        cfg.sort = 'custom';
        cfg.dock = di.filter(function (x) {
          return x !== moving;
        });
        cfg.order = [moving];
        rebuild(true);
      }
    }
    return;
  }
  var gpos = gi.indexOf(moving);
  if (k === 37) {
    if (gpos > 0) {
      moveGridApp(moving, -1);
    } else if (di.length > 0) {
      swapDockAndGrid(di.length - 1, 0);
    }
  } else if (k === 39) {
    if (gpos >= 0 && gpos < gi.length - 1) {
      moveGridApp(moving, 1);
    }
  } else if (k === 38) {
    if (gpos >= cols) {
      moveGridApp(moving, -cols);
    } else if (di.length > 0) {
      var col = gpos % cols;
      if (col < di.length) {
        swapDockAndGrid(col, gpos);
      } else if (di.length < TH.dockN) {
        var ord = getGridOrder().filter(function (x) {
          return x !== moving;
        });
        cfg.sort = 'custom';
        cfg.dock = di.concat(moving);
        cfg.order = ord;
        rebuild(true);
      } else {
        swapDockAndGrid(di.length - 1, gpos);
      }
    }
  } else if (k === 40) {
    if (gpos >= 0 && gpos + cols < gi.length) {
      moveGridApp(moving, cols);
    } else if (gpos < gi.length - 1 && Math.floor(gpos / cols) < Math.floor((gi.length - 1) / cols)) {
      moveGridApp(moving, gi.length - 1 - gpos);
    }
  }
}

/* the apps that are open get a green dot; read each time Home is shown, kept only in memory */
var running = {};
function markRunning() {
  var on = cfg.runDots === true;
  for (var id in tiles) {
    var d = tiles[id],
      dot = d.querySelector('.rd');
    if (on && running[id] && !dot) {
      dot = document.createElement('i');
      dot.className = 'rd';
      d.appendChild(dot);
    } else if ((!on || !running[id]) && dot) dot.remove();
  }
}
function readRunning() {
  api('/api/running').then(
    function (x) {
      running = {};
      (x.apps || []).forEach(function (a) {
        running[a.id] = true;
      });
      markRunning();
    },
    function () {}
  );
}
function load() {
  readRunning();
  api('/api/apps')
    .then(function (x) {
      if (x.version && oldSvc(x.version) && !warned) {
        warned = true;
        toast('The service (' + x.version + ') is older than this launcher needs: update it in the CleanYourTV manager');
      }
      usage = x.usage || {};
      var rank = Object.keys(usage).sort(function (a, b) {
        return usage[b] - usage[a];
      });
      var sig = JSON.stringify([
        x.apps.map(function (a) {
          return a.input ? [a.id, a.title, a.off] : [a.id, !!a.removable, a.iv || 0, a.it ? 1 : 0];
        }),
        x.config,
        rank,
      ]);
      retryTileIcons();
      if (sig === lastSig) return;
      lastSig = sig;
      apps = x.apps.map(function (a) {
        return a.input
          ? { id: a.id, title: a.title, input: a.input, off: !!a.off }
          : { id: a.id, title: a.title, removable: !!a.removable, iv: a.iv || 0, it: a.it ? 1 : 0 };
      });
      cfg = x.config || {};
      tunerOn = x.tuner === true; // the service found LG's own Live TV (the tuner): Customise can offer a TV button
      useLang(cfg.lang);
      applyTheme(cfg.theme);
      if (liveOn()) apps.push({ id: '__live', title: t('Live TV') });
      store();
      rebuild();
      WALL.sync();
      if (!perfReady) {
        perfReady = true;
        perfMark('launcher ready ' + Math.round(performance.now()));
      }
    })
    .catch(function () {
      toast(t('Helper not reachable, retrying...'));
      setTimeout(load, 3000);
    });
}

var refreshT = 0,
  refreshT2 = 0;
function refreshSoon() {
  clearTimeout(refreshT);
  clearTimeout(refreshT2);
  refreshT = setTimeout(load, 1800);
  refreshT2 = setTimeout(load, 4500);
}
