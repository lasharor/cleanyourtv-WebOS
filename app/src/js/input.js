/* ---------- input: tap OK to open, hold OK for options ---------- */
var lastMove = 0,
  snapT = 0,
  downT = 0,
  held = false,
  downEnter = false,
  swallowUp = false,
  pressT = 0,
  lastKey = 0,
  lastMX = -1,
  lastMY = -1,
  lastEnter = 0,
  menuHold = null;
function hit(e) {
  e.addEventListener('mousedown', function () {
    held = false;
    clearTimeout(pressT);
    pressT = setTimeout(function () {
      held = true;
      options(e);
    }, 650);
  });
  e.addEventListener('mouseup', function () {
    clearTimeout(pressT);
  });
  e.addEventListener('click', function () {
    if (moving) {
      stopMoving();
      return;
    }
    if (held) {
      held = false;
      return;
    }
    var p = posOf(e); /* the focus goes to what was clicked, so the highlight shows what opens */
    if (p && !(p[0] === r && p[1] === c)) setFocus(p[0], p[1]);
    act(e);
  });
}
function options(e) {
  if (e._a && !e._a.sys) appMenu(e._a);
  else if (e._o && !e._o.fixed) barMenu(e._o);
}

/* Pointer focus follows real pointer movement only: a tile sliding under a still cursor, a cursor jitter when
   the remote is picked up, or a pointer move right after a button press must not steal the focus. The first move after a button press
   needs 24 px; after that every move of 4 px or more counts, so a cursor that comes to rest over a tile always focuses it (before, a
   cursor nudged less than 24 px over a tile left the focus elsewhere, while a click opened the tile under it). */
var pointerLive = false;
function pointerMoved(x, y) {
  if (lastMX < 0) {
    lastMX = x;
    lastMY = y;
    return false;
  }
  if (Math.abs(x - lastMX) + Math.abs(y - lastMY) < (pointerLive ? 4 : 24)) return false;
  lastMX = x;
  lastMY = y;
  pointerLive = true;
  return true;
}
document.addEventListener('mousemove', function (ev) {
  if (stack.length || LIVE.on || PAGER.on || CS.on || Date.now() - lastKey < 1500) return;
  if (!pointerMoved(ev.clientX, ev.clientY)) return;
  var el = ev.target.closest ? ev.target.closest('.tile,.pill,.card-btn') : null,
    p = el && posOf(el);
  if (p && !(p[0] === r && p[1] === c)) setFocus(p[0], p[1]);
});

document.addEventListener('keydown', function (e) {
  var k = e.keyCode;
  /* a right-to-left layout: Left moves to what is on the left, which is the next tile in the row (Live TV keeps left-to-right) */
  if (rtl() && !LIVE.on && (k === 37 || k === 39)) k = 76 - k;
  lastKey = Date.now();
  pointerLive = false;
  /* a card's sheet has the keys while it is open (it undoes the swap above itself) */
  if (CS.on) {
    csKey(k, e);
    return;
  }
  /* a city typed in a card's settings: OK searches, Back closes the field, the rest types */
  if (e.target && e.target.id === 'csq') {
    if (k === 13) csFind(CSQ_TYPE, e.target.value);
    if (k === 13 || k === 461 || k === 27) {
      csSearchEnd();
      e.preventDefault();
    }
    return;
  }
  if (PAGER.on) {
    PAGER.key(e);
    return;
  }
  if (LIVE.on) {
    LIVE.key(e);
    return;
  }
  if (!stack.length && !moving && PAGES.length && PAGER.pageKey(e)) return; /* the number and colour buttons turn the page */
  if (moving) {
    if (k === 13 || k === 461 || k === 27 || k === 8) {
      stopMoving();
      e.preventDefault();
      return;
    }
    if (k >= 37 && k <= 40) {
      handleMoveKey(k);
      e.preventDefault();
      return;
    }
  }
  if (stack.length) {
    if (k === 13) {
      if (downEnter && Date.now() - lastEnter < 1500) {
        lastEnter = Date.now();
        e.preventDefault();
        return;
      }
      downEnter = true;
      lastEnter = Date.now();
      swallowUp = true;
      /* a row with a hold action (an input in the Inputs list) opens on release; held, it shows its options */
      var mm = stack[stack.length - 1],
        it = mm.items[mm.idx];
      if (it && it.hold) {
        menuHold = it;
        held = false;
        clearTimeout(downT);
        downT = setTimeout(function () {
          held = true;
          it.hold();
        }, 650);
        e.preventDefault();
        return;
      }
    }
    if (menuKey(k)) e.preventDefault();
    return;
  }
  if ((TH.overlay || TH.push) && r >= 2 && (k === 461 || k === 27 || k === 8)) {
    setFocus(1, Math.min(c, rows[1].length - 1));
    e.preventDefault();
    return;
  } /* Back closes the grid overlay */
  if (k === 461 || k === 27 || k === 8) {
    runningMenu();
    e.preventDefault();
    return;
  } /* Back on the home screen: the running apps */
  var len = rows[r].length;
  if (k >= 37 && k <= 40) {
    var tn = performance.now();
    if (e.repeat || tn - lastMove < 90) {
      document.body.classList.add('snap');
      clearTimeout(snapT);
      snapT = setTimeout(function () {
        document.body.classList.remove('snap');
      }, 180);
    }
    lastMove = tn;
  }
  if (k === 37 && c > 0) setFocus(r, c - 1);
  else if (k === 39 && c < len - 1) setFocus(r, c + 1);
  else if (k === 38 && r > 0) setFocus(r - 1, mapCol(len, rows[r - 1].length, c));
  else if (k === 40 && r < rows.length - 1) setFocus(r + 1, mapCol(len, rows[r + 1].length, c));
  else if (k === 13) {
    /* webOS repeats keydown while OK is held, sometimes without e.repeat: only the first one starts the hold timer */
    if (!downEnter || Date.now() - lastEnter > 1500) {
      downEnter = true;
      held = false;
      clearTimeout(downT);
      var t = rows[r][c];
      t.classList.add('press');
      downT = setTimeout(function () {
        held = true;
        t.classList.remove('press');
        options(t);
      }, 650);
    }
    lastEnter = Date.now();
  } else return;
  e.preventDefault();
});
document.addEventListener('keyup', function (e) {
  if (e.keyCode !== 13) return;
  lastKey = Date.now();
  clearTimeout(downT);
  var pr = document.querySelector('.press');
  if (pr) pr.classList.remove('press');
  if (menuHold) {
    var was = held;
    menuHold = null;
    swallowUp = false;
    downEnter = false;
    held = false;
    if (!was) pickMenu();
    return;
  }
  if (swallowUp) {
    swallowUp = false;
    downEnter = false;
    return;
  }
  if (downEnter && !held) act(rows[r][c]);
  downEnter = false;
  held = false;
});
/* Some TVs (an OLED48C16LA, webOS 6, issue 26) hide the Home window for a moment right after a launch with {live:true}, then show
   it again with a relaunch of plain {keepAlive:true}. For 5 s after such a launch, neither closes Live TV. A Home key press is also a
   relaunch with {keepAlive:true} (webOS 25), so that relaunch is only ignored after such a hide. */
var liveGuard = 0,
  liveBlip = false;
function guarded() {
  return LIVE.on && Date.now() < liveGuard;
}
/* the Guide button goes to the TV guide add-on (LG tuner) when it is on, else to Live TV's guide: the two do not depend on each other */
/* the app that was in front when the Guide button was pressed (guidekey.sh passes it as "from"): Back in the guide returns to it */
var guideFrom = '';
function noteGuideFrom(p) {
  guideFrom = p && /^[A-Za-z0-9._-]{3,80}$/.test(p.from || '') && p.from !== 'com.webos.app.home' ? p.from : '';
}
function guidePage() {
  for (var i = 0; i < PAGES.length; i++) if (PAGES[i].guide) return PAGES[i].id;
  return '';
}
/* launching Home with {inputs:true} opens the Inputs list */
function wantInputs(pages) {
  var p = {};
  try {
    p = JSON.parse(webOSSystem.launchParams || '{}');
  } catch (e) {}
  /* the Guide button: which page has the guide is known once the add-on pages are loaded */
  if (p && p.guide && !p.inputs && pages) {
    $('homepage').style.visibility = 'hidden'; /* no flash of the dashboard on the way to the guide */
    pages.then(function () {
      wantInputs();
      if (!PAGER.on) $('homepage').style.visibility = 'visible';
    });
    return;
  }
  if (p && p.inputs) {
    closeMenus();
    inputsMenu();
  } else if (p && p.guide && guidePage()) {
    noteGuideFrom(p);
    closeMenus();
    PAGER.go(guidePage(), null, true);
  } else if (p && p.live && liveOn()) {
    closeMenus();
    liveGuard = Date.now() + 5000;
    liveBlip = false;
    LIVE.enter(!!p.guide);
  }
}
document.addEventListener('webOSRelaunch', function () {
  var p = {};
  try {
    p = JSON.parse(webOSSystem.launchParams || '{}');
  } catch (e) {}
  csClose();
  logLine('launcher relaunch ' + JSON.stringify(p).slice(0, 120) + (LIVE.on ? ' (live on)' : ''));
  if (p && p.guide && guidePage() && PAGER.on && PAGER.id === guidePage()) {
    noteGuideFrom(p);
    PAGER.send({ cytv: 'guide' });
    return;
  } /* the Guide button while the TV guide is open */
  if (LIVE.on && p && p.guide && liveOn()) {
    LIVE.toggleGuide();
    return;
  } /* the Guide button while Live TV is open */
  if (guarded() && liveBlip && p && p.keepAlive && !p.inputs && !p.live) {
    liveBlip = false;
    LIVE.resume();
    return;
  }
  csSearchEnd();
  if (PAGER.on && !(p && p.live)) PAGER.home(); /* Home pressed: back to the first page */
  load();
  refreshSoon();
  wantInputs(PAGER.load());
});
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    if (guarded()) {
      liveBlip = true;
      logLine('launcher hidden right after a Live TV launch: Live TV stays on');
      return;
    }
    WALL.hidden();
    stopMoving(); /* leaving Home while a tile is moved keeps where it is now */
    SCENES.hidden();
    if (LIVE.on) LIVE.exit();
    closeRunningMenu();
  } else if (guarded()) LIVE.resume();
  else {
    /* hidden in those 5 s and only shown again later: the TV really went elsewhere */
    if (liveBlip && LIVE.on) LIVE.exit();
    liveBlip = false;
    load();
    refreshSoon();
    WALL.shown();
    SCENES.shown();
  }
});

function tick() {
  var d = new Date();
  try {
    $('time').textContent = d.toLocaleTimeString(LOC, clockOpts());
    $('date').textContent = d.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (e) {
    $('time').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  /* greeting line (shown only when the theme turns clock.greeting on, with the stacked layout) */
  var g = $('greet');
  if (g) {
    var h = d.getHours();
    g.textContent = h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening');
  }
  tickCards();
  SCENES.tick();
}
setInterval(tick, 15000);
tick();
