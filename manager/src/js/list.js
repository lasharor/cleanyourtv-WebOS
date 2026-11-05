/* turn to another tab: what its list needs (the add-ons, the Android box) is read, and the list is drawn again */
function setTab(n) {
  if (offline || view !== 'main' || n < 0 || n >= TABS.length || n === tab) return;
  tab = n;
  idx = 0;
  listY = 0;
  build();
  draw();
  if (TABS[n].id === 'addons') loadAddons();
  if (TABS[n].id === 'features')
    api('/api/androidbox').then(
      function (r) {
        ab = r;
        if (view === 'main' && TABS[tab].id === 'features') {
          build();
          draw();
        }
      },
      function () {}
    );
}
var listY = 0;
/* the list can be taller than the screen: keep the focused row in view and show a fade where more rows are hidden */
function scrollList() {
  var wrap = $('listwrap'),
    list = $('list'),
    el = list.children[idx],
    wh = wrap.clientHeight,
    lh = list.scrollHeight;
  if (el && wh) {
    var top = el.offsetTop,
      bot = top + el.offsetHeight;
    if (top - 50 < listY) listY = Math.max(0, top - 50);
    else if (bot + 50 > listY + wh) listY = bot + 50 - wh;
    listY = Math.max(0, Math.min(listY, Math.max(0, lh - wh)));
  } else listY = 0;
  list.style.transform = listY ? 'translateY(' + -listY + 'px)' : '';
  wrap.classList.toggle('mu', listY > 0);
  wrap.classList.toggle('md', listY + wh < lh - 2);
}
var curLang = null;
function draw() {
  /* the Language setting (Manager > More > Language) arrives with the status */
  var want = (st && st.lang) || '';
  if (want !== curLang) {
    curLang = want;
    setLang(want);
  }
  drawTabs();
  var h = '';
  rows.forEach(function (r, i) {
    h += r.sep
      ? '<div class="sep"></div>'
      : '<div class="row' +
        (i === idx ? ' f' : '') +
        (r.dim ? ' dim' : '') +
        '" data-i="' +
        i +
        '"><span class="lb"></span>' +
        (r.sub ? '<span class="st"></span>' : '') +
        '</div>';
  });
  $('list').innerHTML = h;
  scrollList();
  var el = $('list').children;
  rows.forEach(function (r, i) {
    if (r.sep) return;
    el[i].querySelector('.lb').textContent = tr(r.label);
    if (r.sub) el[i].querySelector('.st').textContent = tr(r.sub);
  });
  var inf = infoFor(rows[idx]),
    ie = $('info');
  ie.textContent = '';
  $('head').className = '';
  drawAbout(rows[idx], ie);
  $('sub').style.wordBreak = '';
  if (view === 'notifyhow' || view === 'voicehow') {
    $('sub').textContent = tr(kText);
    $('sub').style.whiteSpace = 'pre-line';
    $('sub').style.wordBreak = 'break-all';
    return;
  }
  if (view === 'notifyapi') {
    $('sub').textContent = tr('Network notifications');
    return;
  }
  if (view === 'models') {
    $('sub').textContent = tr('Choose the model that answers');
    return;
  }
  if (view === 'agents') {
    $('sub').textContent = tr('Choose the Home Assistant agent');
    return;
  }
  if (view === 'channel') {
    $('sub').textContent = tr('Where updates come from');
    return;
  }
  if (view === 'addon') {
    $('sub').textContent = tr('Add-on');
    return;
  }
  if (view === 'addonrepos' || view === 'addonrepo') {
    $('sub').textContent = tr('Add-on repositories');
    return;
  }
  if (view === 'confirm-addon' || view === 'confirm-repo') {
    $('sub').textContent = tr('Code from outside the project');
    return;
  }
  if (view === 'livetv') {
    $('sub').textContent = tr('Live TV: your own playlist');
    return;
  }
  if (view === 'confirm-live-reset') {
    $('sub').textContent = tr('Remove the playlist?');
    return;
  }
  if (view === 'themeopts') {
    $('sub').textContent = tr('Theme options');
    return;
  }
  if (view === 'theme') {
    $('sub').textContent = tr('Choose how Home looks. The change shows the next time you open Home.');
    return;
  }
  if (view === 'accent') {
    $('sub').textContent = tr('The colour of the focus ring and highlights');
    return;
  }
  if (view === 'voice') {
    var vv = vo || {},
      ls = vv.last
        ? vv.last.text
          ? 'Last heard: \u201C' +
            vv.last.text +
            '\u201D' +
            (vv.last.ms ? ' (' + (vv.last.ms / 1000).toFixed(1) + ' s)' : '') +
            (vv.last.error ? '\nNot sent: ' + vv.last.error : '')
          : 'Last try: ' + vv.last.state + (vv.last.error ? '\n' + vv.last.error : '')
        : '';
    $('sub').textContent = tr('Voice \u00B7 ' + (vv.engine || '') + (ls ? '\n' + ls : ''));
    $('sub').style.whiteSpace = 'pre-line';
    if (inf) {
      var b2 = document.createElement('b');
      b2.textContent = tr(inf.t);
      ie.appendChild(b2);
      ie.appendChild(document.createTextNode(tr(inf.d)));
    }
    return;
  }
  if (view === 'keys') {
    $('sub').textContent = tr(kText);
    $('sub').style.whiteSpace = 'pre-line';
    return;
  }
  if (view.indexOf('remap') === 0) {
    $('sub').textContent = tr(rmSub());
    $('sub').style.whiteSpace = 'pre-line';
    if (inf) {
      var b3 = document.createElement('b');
      b3.textContent = tr(inf.t);
      ie.appendChild(b3);
      ie.appendChild(document.createTextNode(tr(inf.d)));
    }
    return;
  }
  if (inf) {
    var b = document.createElement('b');
    b.textContent = tr(inf.t);
    ie.appendChild(b);
    ie.appendChild(document.createTextNode(tr(inf.d)));
  }
  if (view === 'inputkey') {
    $('sub').textContent = tr('Input key');
    return;
  }
  if (view === 'volumebar') {
    $('sub').textContent = tr('Volume bar');
    return;
  }
  if (view === 'confirm-home' || view === 'confirm-uninstall') {
    $('sub').textContent = tr(view === 'confirm-uninstall' ? 'Remove CleanYourTV?' : 'Switch Home?');
    return;
  }
  if (!offline && st) {
    var m = [];
    m.push('Launcher ' + st.frontend.version + ' · service ' + st.service.version);
    if (st.checkError) m.push('Updates: ' + st.checkError);
    else if (st.release) m.push('Latest release ' + st.release.version);
    $('sub').textContent = tr(m.join('\n'));
    $('sub').style.whiteSpace = 'pre-line';
  } else
    $('sub').textContent = tr(
      offline ? 'The service is not running. Set it up to replace LG’s Home, take over the Input key and keep everything up to date.' : ''
    );
}
/* an add-on's picture and what it does, left of the list (the Add-ons tab and an add-on's own screen), as the Theme menu on Home does */
function drawAbout(r, ie) {
  if (!r || !r.about) return;
  $('head').className = 'ab'; /* the version lines make room for the picture */
  if (r.pv || r.pvu) {
    var im = document.createElement('img');
    im.alt = '';
    im.onerror = function () {
      im.style.display = 'none';
    };
    im.src = API + (r.pvu || '/api/addons/preview/' + r.pv);
    ie.appendChild(im);
  }
  var b = document.createElement('b');
  b.textContent = r.ablabel ? tr(r.ablabel) : r.label;
  ie.appendChild(b);
  var box = document.createElement('div'),
    txt = document.createElement('div');
  box.className = 'abt' + (r.pv || r.pvu ? '' : ' tall');
  txt.className = 'abi';
  txt.textContent = tr(r.about);
  box.appendChild(txt);
  ie.appendChild(box);
  aboutScroll(box, txt);
}
/* a text longer than its box (the remote has no way to scroll it) drifts up after a pause, rests at the end, then starts over */
var abTimer = 0;
function aboutScroll(box, txt) {
  clearTimeout(abTimer);
  var over = txt.offsetHeight - box.clientHeight;
  if (over <= 2) return;
  box.className += ' ov';
  var step = function (to, wait) {
    abTimer = setTimeout(function () {
      if (!box.parentNode) return;
      txt.style.transition = to ? 'transform ' + (over / 28).toFixed(1) + 's linear' : 'none';
      txt.style.transform = 'translateY(' + -to + 'px)';
      step(to ? 0 : over, to ? over * 36 + 2500 : 2500);
    }, wait);
  };
  step(over, 2500);
}
/* the tab bar: every screen shows it, the one you are in marked; inside a sub-screen it only tells where you are */
function drawTabs() {
  var el = $('tabs');
  if (offline || !st) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.className = view === 'main' ? '' : 'sub';
  if (el.childNodes.length !== TABS.length) {
    el.textContent = '';
    TABS.forEach(function (tb, i) {
      var d = document.createElement('div');
      d.className = 'tab';
      d.setAttribute('data-t', String(i));
      el.appendChild(d);
    });
  }
  TABS.forEach(function (tb, i) {
    var d = el.childNodes[i];
    d.textContent = tr(tb.label);
    d.className = 'tab' + (i === tab ? ' on' : '');
  });
}
function next(dir) {
  var n = rows.length,
    i = idx;
  do {
    i = (i + dir + n) % n;
  } while (rows[i].sep);
  idx = i;
  draw();
}
function act() {
  var r = rows[idx];
  if (r && r.fn && !(st && st.job && st.job.state === 'working' && r.dim)) r.fn();
}
