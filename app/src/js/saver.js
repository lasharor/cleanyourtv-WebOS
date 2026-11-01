/* ---------- Screen saver: after a few minutes without a key the screen goes black and shows the time, the date (also in the Islamic
   calendar), the next prayer (when a prayer card has a place, prayer.js) and a dhikr, dim and drifting slowly round the screen, so an OLED
   panel keeps no picture in it. Any key wakes it and is not passed on, so waking the TV does not open anything. Switched on in Customise >
   Screen saver (cfg.saver = {on, mins}). Not shown over Live TV, a menu or while the launcher is in the background. ---------- */
var SAVER = (function () {
  var idleAt = Date.now(),
    shown = false,
    forced = false,
    el = null,
    drawT = 0,
    lastMX = -1,
    lastMY = -1,
    dhikr = '';
  function mins() {
    var m = +(cfg.saver || {}).mins;
    return m > 0 ? m : 5;
  }
  function wanted() {
    return !!(cfg.saver && cfg.saver.on);
  }
  function build() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'saver';
    el.innerHTML =
      '<div id="sv-box"><div id="sv-time"></div><div id="sv-date"></div><div id="sv-hijri"></div><div id="sv-pray"></div>' +
      '<div id="sv-dhikr" dir="rtl" lang="ar"></div></div>';
    document.body.appendChild(el);
    return el;
  }
  /* the text of the moment; a line that did not change is left alone (webOS 5 leaves old text behind when text is rewritten) */
  function set(id, text) {
    var e = $(id);
    if (e.textContent !== text) e.textContent = text;
  }
  function draw() {
    var now = new Date(),
      o = prayerOpts(),
      nx = o ? PRAYER.next(now, o) : null,
      d = adhkarAt(now, 30);
    set('sv-time', timeText());
    set('sv-date', dateText());
    set('sv-hijri', hijriText());
    set('sv-pray', nx ? prayerName(nx.id) + '  ' + prayerClock(nx.at) + '  ·  ' + prayerLeft(nx.at - now) : '');
    if (d !== dhikr) {
      /* a new element, so the fade starts again */
      dhikr = d;
      var box = $('sv-dhikr');
      box.innerHTML = '<div class="dh-t"></div>';
      box.firstChild.textContent = d;
    }
  }
  /* only when nothing else has the screen: not over Live TV, a menu, a card that is being moved, or a launcher in the background */
  function free() {
    return !document.hidden && !(window.LIVE && LIVE.on) && !(window.stack && stack.length) && !(window.moving && moving);
  }
  function show(force) {
    forced = force === true;
    build();
    draw();
    clearInterval(drawT);
    drawT = setInterval(draw, 10000);
    shown = true;
    /* the class on the next frame, so the fade in starts from black */
    setTimeout(function () {
      if (shown) el.classList.add('on');
    }, 30);
  }
  function hide() {
    if (!shown) return;
    shown = false;
    clearInterval(drawT);
    if (el) el.classList.remove('on');
    idleAt = Date.now();
    if (window.tick) tick();
  }
  /* any key wakes it, and that key does nothing else */
  document.addEventListener(
    'keydown',
    function (e) {
      idleAt = Date.now();
      if (!shown) return;
      hide();
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );
  document.addEventListener(
    'mousedown',
    function () {
      idleAt = Date.now();
      if (shown) hide();
    },
    true
  );
  /* the pointer: real movement only, not the jitter of a remote that is picked up */
  document.addEventListener(
    'mousemove',
    function (e) {
      if (lastMX < 0) {
        lastMX = e.clientX;
        lastMY = e.clientY;
        return;
      }
      if (Math.abs(e.clientX - lastMX) + Math.abs(e.clientY - lastMY) < 24) return;
      lastMX = e.clientX;
      lastMY = e.clientY;
      idleAt = Date.now();
      if (shown) hide();
    },
    true
  );
  setInterval(function () {
    if (shown) {
      if (!forced && (!wanted() || !free())) hide();
      return;
    }
    if (wanted() && free() && Date.now() - idleAt >= mins() * 60000) show();
  }, 5000);
  return {
    /* "Try it" in the menu: at once, whatever the idle time */
    show: function () {
      show(true);
    },
    hide: hide,
    mins: mins,
    on: function () {
      return shown;
    },
  };
})();
