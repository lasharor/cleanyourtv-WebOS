/* ---------- Live TV (plays the user's M3U playlist in the TV's own video player) ---------- */
var LIVE_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 130"><rect width="130" height="130" fill="#ef4f5f"/><rect x="25" y="36" width="80" height="54" rx="13" fill="none" stroke="#fff" stroke-width="8"/><path d="M58 52 L58 74 L77 63 Z" fill="#fff"/><path d="M48 104 H82" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>'
  );
var LIVE = (function () {
  var chans = [],
    groups = [],
    byNum = {},
    byKey = {},
    cur = 0,
    epgNow = {},
    video = null,
    variants = [],
    vi = 0,
    beginT = 0,
    pend = false,
    osdT = 0,
    numT = 0,
    numBuf = '',
    spinT = 0,
    failed = false,
    loaded = false,
    setupT = 0,
    fetchT = 0;
  var streams = [],
    si = 0,
    reloads = 0,
    started = false,
    stallT = 0,
    playedT = 0,
    gen = 0,
    tuneT = 0,
    toastT = 0,
    statsT = 0;
  var S = { fav: [], recent: [], failed: {} },
    F = { cc: '', lang: '', q: '' },
    Q = '',
    fac = { cc: [], lang: [], q: [] },
    searching = false,
    stats = false;
  var L = { open: false, g: 0, col: 'c', ci: 0, list: [] },
    FP = { open: false, i: 0 },
    M = { open: false, i: 0, items: [] },
    o = { on: false };
  var tuneAt = 0; /* when the channel was chosen, for the timing in perfMark */
  var START_MS = 15000,
    STALL_MS = 8000;
  function lesc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function layer(id, on) {
    $(id).classList.toggle('on', !!on);
  }
  function msg(h) {
    setHtml($('lv-msg'), h);
    layer('lv-msg', true);
  }
  function toastL(s) {
    var e = $('lv-toast');
    e.textContent = s;
    layer('lv-toast', true);
    clearTimeout(toastT);
    toastT = setTimeout(function () {
      layer('lv-toast', false);
    }, 2200);
  }
  /* A plain .m3u8 address is set as the element's src (the type is not needed); anything else keeps its <source type> variants. */
  function variantsFor(url) {
    var v = [];
    if (/\.m3u8(\?|$)/.test(url)) return [{ src: url, type: '' }];
    /* An Xtream .ts link plays at once as a plain src (1-2 s); the provider's HLS and a typed .ts on webOS 5/6 only stall until START_MS.
       They stay as fallbacks (issues 9 and 13). */
    if (/\/live\/.+\.ts(\?|$)/.test(url)) {
      v.push({ src: url, type: '' });
      v.push({ src: url.replace(/\.ts(\?|$)/, '.m3u8$1'), type: 'application/x-mpegURL' });
      v.push({ src: url, type: 'application/x-mpegURL' });
      return v;
    }
    /* Any other address (often without an extension, e.g. http://host:port/user/pass/8078) also starts as a plain src: typed as HLS
       first it took about 30 s on webOS 5, plain about 2 s (issue 13). HLS stays as the fallback. */
    v.push({ src: url, type: '' });
    v.push({ src: url, type: 'application/x-mpegURL' });
    return v;
  }

  /* ---------- what the viewer did (kept in the service) ---------- */
  function isFav(c) {
    return S.fav.indexOf(c.key) >= 0;
  }
  function post(b) {
    api(LIVE_API + '/state', b).catch(function () {});
  }
  function toggleFav(c) {
    if (!c || !c.key) return;
    var on = !isFav(c);
    S.fav = S.fav.filter(function (k) {
      return k !== c.key;
    });
    if (on) S.fav.unshift(c.key);
    post({ op: 'fav', key: c.key, on: on });
    toastL(t(on ? 'Added to favourites' : 'Removed from favourites'));
    if (L.open) {
      L.list = listFor(L.g);
      L.ci = Math.max(0, Math.min(L.ci, L.list.length - 1));
      drawList();
    }
  }
  function markPlayed(c) {
    if (!c || !c.key) return;
    S.recent = [c.key]
      .concat(
        S.recent.filter(function (k) {
          return k !== c.key;
        })
      )
      .slice(0, 30);
    post({ op: 'recent', key: c.key });
    if (S.failed[c.key]) {
      delete S.failed[c.key];
      post({ op: 'failed', key: c.key, on: false });
    }
  }

  /* ---------- the player: one <video>, several streams per channel, tuning screen, recovery ---------- */
  /* One <video> element for the whole session: creating and destroying it on every channel change makes the TV rebuild its video plane. */
  var lastTime = -1,
    lastProgressAt = 0 /* when the picture time last moved, for the stall watchdog */,
    progressT = 0,
    healthyT = 0;
  /* Some TVs (webOS 25) freeze a stream without a 'waiting' event, so nothing armed the stall timer (issue 109): a started stream whose
     picture time has not moved for STALL_MS is reloaded by stalled(), as after 'waiting'. When 'waiting' fires first, startVariant() has
     reset 'started' by then and this does nothing. */
  function watchProgress() {
    if (!started || pend || !video || video.paused || video.ended || document.hidden) return;
    if (lastProgressAt && Date.now() - lastProgressAt >= STALL_MS) {
      lastProgressAt = Date.now();
      stalled();
    }
  }
  function ensureVideo() {
    if (video) return video;
    var v = document.createElement('video');
    v.autoplay = true;
    video = v;
    /* Not every TV fires 'playing' again after 'waiting' (or at all for some streams), so moving picture time counts as playing too */
    function onPlaying() {
      clearTimeout(spinT);
      clearTimeout(stallT);
      lastProgressAt = Date.now();
      layer('lv-spin', false);
      layer('lv-tune', false);
      if (!started) {
        started = true;
        /* after half a minute of playing the one reload a stall gets is available again: a freeze every few hours is not a dead stream */
        clearTimeout(healthyT);
        healthyT = setTimeout(function () {
          reloads = 0;
        }, 30000);
        perfMark('live playing ' + (Date.now() - tuneAt) + ' variant ' + vi + (variants[vi] && variants[vi].type ? ' typed' : ' src'));
        clearTimeout(playedT);
        var c = byNum[cur];
        playedT = setTimeout(function () {
          markPlayed(c);
        }, 3000);
      }
    }
    v.addEventListener('playing', onPlaying);
    v.addEventListener('timeupdate', function () {
      if (v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        if (v.currentTime > 0) onPlaying();
      }
    });
    v.addEventListener('waiting', function () {
      layer('lv-spin', true);
      if (started) {
        clearTimeout(stallT);
        stallT = setTimeout(stalled, STALL_MS);
      }
    });
    /* capture: a failing <source> reports on the <source>, and that event does not bubble; an old, removed <source> is ignored */
    v.addEventListener(
      'error',
      function (e) {
        if (e.target === v || e.target.parentNode === v) onError();
      },
      true
    );
    $('lv-stage').appendChild(v);
    progressT = setInterval(watchProgress, 1000);
    return v;
  }
  function release() {
    clearTimeout(spinT);
    clearTimeout(beginT);
    clearTimeout(stallT);
    clearTimeout(playedT);
    clearTimeout(tuneT);
    clearTimeout(healthyT);
    clearInterval(progressT);
    progressT = 0;
    pend = false;
    if (video) {
      try {
        video.pause();
        video.removeAttribute('src');
        while (video.firstChild) video.removeChild(video.firstChild);
        video.load();
      } catch (e) {}
      if (video.parentNode) video.parentNode.removeChild(video);
      video = null;
    }
  }
  function tuneText() {
    var c = byNum[cur];
    return t('Tuning...') + (streams.length > 1 ? '  ' + t('Stream') + ' ' + (si + 1) + '/' + streams.length : '');
  }
  function showTune() {
    var c = byNum[cur];
    $('lv-tune').textContent = (c ? c.name + '  ' : '') + tuneText();
    layer('lv-tune', true);
  }
  function stalled() {
    /* a live stream that stopped: reload it once, then move on */
    if (!video || pend || !started) return;
    if (reloads < 1) {
      reloads++;
      startVariant();
    } else onError();
  }
  function onError() {
    if (!video || pend) return;
    if (vi < variants.length - 1) {
      vi++;
      startVariant();
      return;
    }
    if (si < streams.length - 1) {
      si++;
      reloads = 0;
      variants = variantsFor(streams[si].url);
      vi = 0;
      startVariant();
      return;
    } /* the channel's next stream */
    giveUp();
  }
  function startVariant() {
    clearTimeout(spinT);
    clearTimeout(stallT);
    clearTimeout(healthyT);
    pend = false;
    started = false;
    lastTime = -1;
    lastProgressAt = 0;
    var v = ensureVideo(),
      d = variants[vi];
    layer('lv-spin', true);
    showTune();
    while (v.firstChild) v.removeChild(v.firstChild);
    if (!d.type) {
      v.src = d.src;
    } else {
      v.removeAttribute('src');
      var src = document.createElement('source');
      src.src = d.src;
      src.type = d.type;
      v.appendChild(src);
      v.load();
    }
    spinT = setTimeout(function () {
      if (v === video && !started && !failed && !(v.readyState >= 3 && !v.paused)) onError();
    }, START_MS);
  }
  var WHY = {
    refused: 'The server refused the stream: it may be blocked in your country or need special request headers.',
    gone: 'The stream was not found (404): the channel is offline or its address has changed.',
    server: 'The stream server reported an error.',
    notvideo: 'The address answers with a web page, not a video.',
    drm: 'This stream is protected by DRM and cannot be played here.',
    unreachable: 'The stream server cannot be reached.',
    slow: 'The stream is too slow to start.',
    ok: 'The stream answers, but the TV could not play it: probably a format it cannot decode.',
    unknown: 'This channel is not available.',
  };
  function giveUp() {
    clearTimeout(spinT);
    clearTimeout(stallT);
    layer('lv-spin', false);
    layer('lv-tune', false);
    failed = true;
    var c = byNum[cur],
      g = gen;
    if (!c) return;
    if (c.key && !S.failed[c.key]) {
      S.failed[c.key] = Date.now();
      post({ op: 'failed', key: c.key, on: true });
    }
    var head = '<b>' + lesc(c.name) + '</b>',
      tail = '<div class="small">' + t('Press OK to try again.') + '</div>';
    msg(head + '<div>' + t('This channel is not available.') + '</div><div class="small">' + t('Checking why...') + '</div>');
    api(LIVE_API + '/probe?key=' + encodeURIComponent(c.key) + '&i=0').then(
      function (r) {
        if (g !== gen || !failed) return;
        msg(head + '<div>' + t(WHY[r.reason] || WHY.unknown) + '</div>' + tail);
      },
      function () {
        if (g === gen && failed) msg(head + '<div>' + t(WHY.unknown) + '</div>' + tail);
      }
    );
  }
  /* defer: while zapping (Up/Down) the new channel starts only once the keys have paused, so skipped channels never reach the provider */
  /* a channel with no stream address (the LG tuner's) is opened by the add-on that brought it (LG's Live TV on that channel), and this page
     steps aside. The guide lists it and shows its programmes like any other channel. */
  function openChannel(c) {
    api(LIVE_API + '/open', { id: c.id }).then(
      function (r) {
        if (r && r.error) toastL(t(r.error));
        else {
          /* a channel of the TV's own tuner has no stream here: it is remembered so the guide opens on it next time */
          try {
            localStorage.setItem('live.tuned', String(c.num));
          } catch (e) {}
          /* LG's Live TV is in front now. The page stays where it is, with the guide closed, so the Guide button finds it ready and opens the
             guide at once instead of going through the launcher's Home first */
          closeList();
        }
      },
      function () {
        toastL(t('The helper is not reachable.'));
      }
    );
  }
  /* the channel to play when the page opens: the last one, or the first that has a stream */
  function firstPlayable(pref) {
    if (byNum[pref] && byNum[pref].url) return pref;
    for (var i = 0; i < chans.length; i++) if (chans[i].url) return chans[i].num;
    return 0;
  }
  function play(num, quiet, defer) {
    var c = byNum[num];
    if (!c) return;
    if (!c.url) return openChannel(c);
    gen++;
    cur = num;
    try {
      localStorage.setItem('live.last', String(num));
    } catch (e) {}
    tuneAt = Date.now();
    streams = [{ url: c.url, q: c.q }].concat(c.alt);
    si = 0;
    reloads = 0;
    failed = false;
    variants = variantsFor(c.url);
    vi = 0;
    layer('lv-msg', false);
    clearTimeout(beginT);
    clearTimeout(spinT);
    clearTimeout(stallT);
    clearTimeout(playedT);
    if (defer) {
      pend = true;
      if (video) {
        try {
          video.pause();
        } catch (e) {}
      }
      layer('lv-spin', true);
      showTune();
      beginT = setTimeout(function () {
        startVariant();
        loadEpg([c.id]);
      }, defer);
    } else {
      startVariant();
      loadEpg([c.id]);
    }
    if (!quiet) showOsd();
    else fillOsd();
  }
  function pickStream(i) {
    var c = byNum[cur];
    if (!c || i < 0 || i >= streams.length) return;
    gen++;
    failed = false;
    si = i;
    reloads = 0;
    variants = variantsFor(streams[si].url);
    vi = 0;
    layer('lv-msg', false);
    startVariant();
  }

  /* ---------- the banner ---------- */
  function hm(ts) {
    var d = new Date(ts * 1000);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function facts(c) {
    var a = [];
    if (c.cc) a.push(cname(c.cc));
    if (c.lang) a.push(c.lang);
    if (c.q) a.push(c.q);
    if (c.alt.length) a.push(c.alt.length + 1 + ' ' + t('streams'));
    return a.join('  ·  ');
  }
  function fillOsd() {
    var c = byNum[cur];
    if (!c) return;
    $('lv-onum').textContent = c.num;
    $('lv-oname').textContent = c.name;
    var lg = $('lv-ologo');
    if (c.logo) {
      lg.src = c.logo;
      lg.style.display = '';
    } else lg.style.display = 'none';
    var e = epgNow[c.id],
      now = Math.floor(Date.now() / 1000),
      f = facts(c);
    if (e && e.now) {
      $('lv-onow').textContent = hm(e.now[0]) + '  ' + e.now[2];
      $('lv-obar').style.width = Math.max(0, Math.min(100, ((now - e.now[0]) / (e.now[1] - e.now[0])) * 100)) + '%';
    } else {
      $('lv-onow').textContent = e ? '' : t('No guide data');
      $('lv-obar').style.width = '0';
    }
    $('lv-onext').textContent = e && e.next ? t('Next') + '  ' + hm(e.next[0]) + '  ' + e.next[2] : f;
    $('lv-ofacts').textContent = e && e.next ? f : '';
  }
  function showOsd() {
    fillOsd();
    layer('lv-osd', true);
    clearTimeout(osdT);
    osdT = setTimeout(function () {
      layer('lv-osd', false);
    }, 5500);
  }
  function loadEpg(ids, cb) {
    ids = ids.filter(function (i) {
      return i;
    });
    if (!ids.length) {
      cb && cb();
      return;
    }
    api(LIVE_API + '/epg?ids=' + encodeURIComponent(ids.join(',')))
      .then(function (x) {
        for (var k in x) epgNow[k] = x[k];
        if (byNum[cur] && ids.indexOf(byNum[cur].id) >= 0) fillOsd();
        cb && cb();
      })
      .catch(function () {
        cb && cb();
      });
  }
  setInterval(function () {
    if (o.on && byNum[cur]) loadEpg([byNum[cur].id]);
  }, 30000);

  /* ---------- the guide: tabs, favourites, recents, filters, search ---------- */
  var full = {};
  function cname(code) {
    try {
      if (window.Intl && Intl.DisplayNames) {
        var n = new Intl.DisplayNames([LOC], { type: 'region' }).of(code);
        if (n && n !== code) return n;
      }
    } catch (e) {}
    return code;
  }
  function passes(c) {
    if (F.cc && c.cc !== F.cc) return false;
    if (F.lang && c.lang !== F.lang) return false;
    if (F.q && c.q !== F.q) return false;
    if (Q) {
      var s = (c.name + ' ' + c.cc + ' ' + cname(c.cc || '') + ' ' + c.lang + ' ' + c.cats.join(' ')).toLowerCase();
      if (s.indexOf(Q) < 0) return false;
    }
    return true;
  }
  function baseList(g) {
    if (g === 0) return chans;
    if (g === 1)
      return S.fav
        .map(function (k) {
          return byKey[k];
        })
        .filter(Boolean);
    if (g === 2)
      return S.recent
        .map(function (k) {
          return byKey[k];
        })
        .filter(Boolean);
    var n = groups[g - 3];
    return chans.filter(function (c) {
      return c.cats.indexOf(n) >= 0;
    });
  }
  function listFor(g) {
    return baseList(g).filter(passes);
  }
  function tabNames() {
    return [t('All channels'), t('Favourites'), t('Recent')].concat(groups);
  }
  function gcolor() {
    var n = tabNames()[L.g],
      c = hsl2rgb(hashHue(n), 0.5, 0.42);
    $('lv-glow').style.setProperty('--c', c.join(','));
  }
  /* the tab the guide opens on: the one the playing channel was chosen from ('0' All channels, '1' Favourites, '2' Recent, 'g:<name>' a
     category) while it still holds the channel, else the channel's first category, else All channels */
  function guideTab(tab, groups, c, holds) {
    var g = -1;
    if (/^[012]$/.test(tab)) g = +tab;
    else if (tab.indexOf('g:') === 0 && groups.indexOf(tab.slice(2)) >= 0) g = groups.indexOf(tab.slice(2)) + 3;
    if (g >= 0 && holds(g)) return g;
    var gi = c.cats[0] ? groups.indexOf(c.cats[0]) : -1;
    return gi >= 0 ? gi + 3 : 0;
  }
  /* remembers the tab a channel is chosen from, so the guide opens on it again */
  function keepTab() {
    try {
      localStorage.setItem('live.tab', L.g < 3 ? String(L.g) : 'g:' + groups[L.g - 3]);
    } catch (e) {}
  }
  function openList() {
    L.open = true;
    var c = byNum[cur],
      tuned = 0;
    try {
      tuned = +localStorage.getItem('live.tuned') || 0;
    } catch (e) {}
    if (!c && tuned) c = byNum[tuned];
    var tab = '';
    try {
      tab = localStorage.getItem('live.tab') || '';
    } catch (e) {}
    L.g = c
      ? guideTab(tab, groups, c, function (g) {
          return listFor(g).indexOf(c) >= 0;
        })
      : 0;
    if (
      !c &&
      groups.length &&
      !chans.some(function (x) {
        return x.url;
      })
    )
      L.g = 3; /* a guide with no streams (the TV's tuner): its own tab */
    L.list = listFor(L.g);
    L.ci = Math.max(0, L.list.indexOf(c));
    drawList();
    $('lv').classList.add('gd');
    layer('lv-guide', true);
    fetchVisible();
  }
  function closeList() {
    L.open = false;
    endSearch(false);
    FP.open = false;
    layer('lv-filter', false);
    $('lv').classList.remove('gd');
    layer('lv-guide', false);
  }
  function pct(p, now) {
    return Math.max(0, Math.min(100, ((now - p[0]) / (p[1] - p[0])) * 100));
  }
  var STAR = '<svg class="st" viewBox="0 0 24 24"><path d="M12 2l3 7 7 .6-5.3 4.7 1.7 7.2L12 17.8 5.6 21.5l1.7-7.2L2 9.6 9 9z"/></svg>';
  function badges(c) {
    var h = '';
    if (isFav(c)) h += STAR;
    if (c.q) h += '<span class="bd">' + c.q + '</span>';
    if (c.fl & 1) h += '<span class="bd w">GEO</span>';
    if (c.fl & 2) h += '<span class="bd w">NOT 24/7</span>';
    if (c.fl & 4) h += '<span class="bd w">HEADERS</span>';
    if (c.alt.length) h += '<span class="bd">×' + (c.alt.length + 1) + '</span>';
    if (c.key && S.failed[c.key]) h += '<span class="bd w">!</span>';
    return h ? '<div class="bds">' + h + '</div>' : '';
  }
  function filterText() {
    var a = [];
    if (F.cc) a.push(cname(F.cc));
    if (F.lang) a.push(F.lang);
    if (F.q) a.push(F.q);
    if (Q) a.push('“' + Q + '”');
    return a.join('  ·  ');
  }
  function drawList(keepWindow) {
    var now = Math.floor(Date.now() / 1000),
      names = tabNames();
    $('lv-gtitle').textContent = ADDON === 'iptv' ? t('Live TV') : t('TV guide');
    var d = new Date(),
      tabs = '';
    if (L.g > 0)
      tabs +=
        '<div class="ctab m" data-g="' +
        (L.g - 1) +
        '">‹</div><div class="ctab" data-g="' +
        (L.g - 1) +
        '">' +
        lesc(names[L.g - 1]) +
        '</div>';
    tabs += '<div class="ctab on">' + lesc(names[L.g]) + '</div>';
    if (L.g < names.length - 1)
      tabs +=
        '<div class="ctab" data-g="' +
        (L.g + 1) +
        '">' +
        lesc(names[L.g + 1]) +
        '</div><div class="ctab m" data-g="' +
        (L.g + 1) +
        '">›</div>';
    var ft = filterText();
    if (ft) tabs += '<div class="ctab f">' + lesc(t('Filters') + ': ' + ft) + '</div>';
    setHtml($('lv-gtabs'), tabs);
    $('lv-gclock').textContent = d.toLocaleTimeString(LOC, clockOpts());
    gcolor();
    var N = 7,
      cs = Math.max(0, Math.min(L.ci - 3, L.list.length - N)),
      h = '';
    if (keepWindow && L.cs !== undefined) cs = Math.max(0, Math.min(L.cs, L.list.length - N)); // hovering must not slide the rows under the pointer
    L.cs = cs;
    for (var j = cs; j < Math.min(L.list.length, cs + N); j++) {
      var c = L.list[j],
        e = epgNow[c.id],
        pn = e && e.now;
      h +=
        '<div class="crow' +
        (j === L.ci ? ' f' : '') +
        (c.num === cur ? ' cur' : '') +
        '" data-j="' +
        j +
        '"><div class="n">' +
        (L.g >= 3 && c.lg ? c.lg : c.num) +
        '</div>' +
        (c.logo ? '<img class="lg" src="' + lesc(c.logo) + '" alt="">' : '<div class="lg"></div>') +
        '<div class="t"><div class="nm">' +
        lesc(c.name) +
        '</div><div class="nw">' +
        (pn ? lesc(hm(pn[0]) + '  ' + pn[2]) : e ? '' : lesc(t('No guide data'))) +
        '</div>' +
        (pn ? '<div class="pbar"><i style="width:' + pct(pn, now) + '%"></i></div>' : '') +
        '</div>' +
        badges(c) +
        '</div>';
    }
    if (!L.list.length)
      h =
        '<div class="empty">' +
        lesc(
          t(
            L.g === 1 && !S.fav.length
              ? 'No favourites yet. Press the green button on a channel.'
              : L.g === 2 && !S.recent.length
                ? 'Nothing watched yet.'
                : 'No channels match.'
          )
        ) +
        '</div>';
    setHtml($('lv-rows'), h);
    drawDetail();
  }
  function drawDetail() {
    var c = L.list[L.ci];
    if (!c) {
      setHtml($('lv-detail'), '');
      return;
    }
    var f = full[c.id],
      now = Math.floor(Date.now() / 1000),
      h =
        '<div class="dn">' +
        lesc(c.name) +
        '</div><div class="dg">' +
        lesc(c.cats.join(', ')) +
        '</div><div class="dg">' +
        lesc(facts(c)) +
        '</div>';
    if (f && f.list && f.list.length) {
      var p = f.list[0],
        live = p[0] <= now;
      h +=
        '<div class="card"><div class="dt">' +
        lesc(hm(p[0]) + ' – ' + hm(p[1])) +
        '</div><div class="dp">' +
        lesc(p[2]) +
        '</div>' +
        (p[3] ? '<div class="dd">' + lesc(p[3]) + '</div>' : '') +
        (live ? '<div class="pbar"><i style="width:' + pct(p, now) + '%"></i></div>' : '') +
        '</div>';
      if (f.list.length > 1) {
        h += '<h3>' + t('Later') + '</h3>';
        for (var i = 1; i < Math.min(5, f.list.length); i++)
          h += '<div class="up"><div class="tm">' + hm(f.list[i][0]) + '</div><div class="tt">' + lesc(f.list[i][2]) + '</div></div>';
      }
    } else h += '<div class="card"><div class="dt">' + lesc(f ? t('No guide data') : '…') + '</div></div>';
    setHtml($('lv-detail'), h);
  }
  function fetchVisible() {
    clearTimeout(fetchT);
    fetchT = setTimeout(function () {
      var cs = Math.max(0, Math.min(L.ci - 3, L.list.length - 7)),
        ids = L.list
          .slice(cs, cs + 7)
          .map(function (c) {
            return c.id;
          })
          .filter(function (i) {
            return i && !epgNow[i];
          });
      if (ids.length)
        loadEpg(ids, function () {
          if (L.open) drawList();
        });
      var c = L.list[L.ci];
      if (c && c.id && !full[c.id])
        api(LIVE_API + '/epg?full=1&ids=' + encodeURIComponent(c.id))
          .then(function (x) {
            full[c.id] = x[c.id] || { list: [] };
            if (L.open) drawDetail();
          })
          .catch(function () {});
    }, 160);
  }
  function relist() {
    L.list = listFor(L.g);
    L.ci = 0;
    drawList();
    fetchVisible();
  }

  /* search: the TV's own keyboard types into an input; the list follows what is typed */
  function startSearch() {
    searching = true;
    if (L.g > 2) {
      L.g = 0;
      L.list = listFor(0);
      L.ci = 0;
      drawList();
    } /* a search looks through all channels, not one category */
    var i = $('lv-search');
    i.value = Q;
    i.placeholder = t('Search...');
    i.style.display = 'block';
    i.focus();
  }
  function endSearch(keep) {
    if (!searching) return;
    searching = false;
    var i = $('lv-search');
    if (!keep) {
      Q = '';
      i.value = '';
    }
    i.style.display = 'none';
    i.blur();
    if (L.open) relist();
  }
  $('lv-search').addEventListener('input', function () {
    Q = this.value.trim().toLowerCase();
    if (L.open) relist();
  });

  /* filters */
  function fvals(k) {
    return [''].concat(fac[k]);
  }
  function filterRows() {
    return [
      { k: 'cc', label: t('Country'), val: F.cc ? cname(F.cc) : t('All') },
      { k: 'lang', label: t('Language'), val: F.lang || t('All') },
      { k: 'q', label: t('Quality'), val: F.q || t('All') },
      { k: 'clear', label: t('Clear filters'), val: '' },
    ];
  }
  function drawFilter() {
    var r = filterRows(),
      h = '<h3>' + lesc(t('Filters')) + '</h3>';
    for (var i = 0; i < r.length; i++)
      h +=
        '<div class="mrow' +
        (i === FP.i ? ' f' : '') +
        '" data-i="' +
        i +
        '"><div class="ml">' +
        lesc(r[i].label) +
        '</div><div class="mv">' +
        (r[i].k === 'clear' ? '' : '‹ ') +
        lesc(r[i].val) +
        (r[i].k === 'clear' ? '' : ' ›') +
        '</div></div>';
    setHtml($('lv-filter'), h);
  }
  function stepFilter(k, d) {
    var v = fvals(k),
      i = v.indexOf(F[k]);
    i = (i + d + v.length) % v.length;
    F[k] = v[i];
    relist();
    drawFilter();
  }
  function filterKey(k) {
    if (k === 38) {
      if (FP.i > 0) FP.i--;
    } else if (k === 40) {
      if (FP.i < 3) FP.i++;
    } else if (k === 37 || k === 39) {
      var r = filterRows()[FP.i];
      if (r.k !== 'clear') stepFilter(r.k, k === 37 ? -1 : 1);
      return;
    } else if (k === 13) {
      var r2 = filterRows()[FP.i];
      if (r2.k === 'clear') {
        F = { cc: '', lang: '', q: '' };
        relist();
      } else FP.open = false;
    } else if (k === 405 || k === 461 || k === 27 || k === 8) {
      FP.open = false;
    }
    if (!FP.open) {
      layer('lv-filter', false);
      drawList();
      return;
    }
    drawFilter();
  }

  /* the player menu (Yellow while watching) */
  function menuItems() {
    var c = byNum[cur],
      it = [
        {
          label: t('Favourite'),
          sub: t(isFav(c) ? 'On' : 'Off'),
          fn: function () {
            toggleFav(c);
            drawMenu();
          },
        },
      ];
    if (streams.length > 1)
      streams.forEach(function (s, i) {
        it.push({
          label: t('Stream') + ' ' + (i + 1) + (s.q ? '  ' + s.q : ''),
          sub: i === si ? '✓' : '',
          fn: function () {
            M.open = false;
            layer('lv-menu', false);
            pickStream(i);
          },
        });
      });
    it.push({
      label: t('Statistics'),
      sub: t(stats ? 'On' : 'Off'),
      fn: function () {
        setStats(!stats);
        drawMenu();
      },
    });
    it.push({
      label: t('Close'),
      sub: '',
      fn: function () {
        M.open = false;
        layer('lv-menu', false);
      },
    });
    return it;
  }
  function drawMenu() {
    M.items = menuItems();
    if (M.i >= M.items.length) M.i = M.items.length - 1;
    var h = '<h3>' + lesc(byNum[cur].name) + '</h3>';
    for (var i = 0; i < M.items.length; i++)
      h +=
        '<div class="mrow' +
        (i === M.i ? ' f' : '') +
        '" data-i="' +
        i +
        '"><div class="ml">' +
        lesc(M.items[i].label) +
        '</div><div class="mv">' +
        lesc(M.items[i].sub) +
        '</div></div>';
    setHtml($('lv-menu'), h);
  }
  function openMenu() {
    M.open = true;
    M.i = 0;
    drawMenu();
    layer('lv-menu', true);
  }
  function menuKey(k) {
    if (k === 38) {
      if (M.i > 0) M.i--;
    } else if (k === 40) {
      if (M.i < M.items.length - 1) M.i++;
    } else if (k === 13) {
      M.items[M.i].fn();
      return;
    } else if (k === 405 || k === 461 || k === 27 || k === 8) {
      M.open = false;
      layer('lv-menu', false);
      return;
    }
    drawMenu();
  }

  /* statistics (Blue while watching): what the TV tells a web page about the picture */
  function statsText() {
    var v = video;
    if (!v) return '';
    var q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null,
      ahead = 0;
    try {
      if (v.buffered && v.buffered.length) ahead = v.buffered.end(v.buffered.length - 1) - v.currentTime;
    } catch (e) {}
    return (
      (v.videoWidth ? v.videoWidth + '×' + v.videoHeight : 'no picture') +
      '\n' +
      t('buffer') +
      ' ' +
      ahead.toFixed(1) +
      ' s\n' +
      (q ? t('frames') + ' ' + q.totalVideoFrames + ', ' + t('dropped') + ' ' + q.droppedVideoFrames + '\n' : '') +
      t('Stream') +
      ' ' +
      (si + 1) +
      '/' +
      streams.length +
      (reloads ? '  (' + t('reloaded') + ')' : '')
    );
  }
  function setStats(on) {
    stats = on;
    clearInterval(statsT);
    layer('lv-stats', on);
    if (on) {
      $('lv-stats').textContent = statsText();
      statsT = setInterval(function () {
        $('lv-stats').textContent = statsText();
      }, 1000);
    }
  }

  function digit(d) {
    numBuf += d;
    if (numBuf.length > 5) numBuf = numBuf.slice(-5);
    $('lv-numin').textContent = numBuf;
    layer('lv-numin', true);
    clearTimeout(numT);
    numT = setTimeout(function () {
      var n = parseInt(numBuf, 10);
      numBuf = '';
      layer('lv-numin', false);
      if (byNum[n]) play(n);
      else showOsd();
    }, 1800);
  }
  function setup() {
    api(LIVE_API + '/pair', {}).then(function (p) {
      msg(
        '<b>' +
          t('Set up Live TV') +
          '</b><div>' +
          t('Open this address on your phone or computer:') +
          '</div><b>' +
          lesc(p.url) +
          '</b><div>' +
          t('and enter this code:') +
          '</div><b>' +
          lesc(p.code) +
          '</b><div class="small">' +
          t('Then paste your M3U playlist address. This page closes by itself.') +
          '</div>' +
          '<div class="small">' +
          t('This plays your own playlist, not the TV\u2019s tuner. For antenna or cable, add a TV button in Customise.') +
          '</div>'
      );
      clearInterval(setupT);
      setupT = setInterval(function () {
        if (!o.on) {
          clearInterval(setupT);
          return;
        }
        api(LIVE_API + '/status').then(function (s) {
          if (s.configured) {
            clearInterval(setupT);
            boot();
          }
        });
      }, 2500);
    });
  }
  function facets() {
    function top(k) {
      var n = {};
      chans.forEach(function (c) {
        if (c[k]) n[c[k]] = (n[c[k]] || 0) + 1;
      });
      return Object.keys(n)
        .sort(function (a, b) {
          return n[b] - n[a] || (a < b ? -1 : 1);
        })
        .slice(0, 40);
    }
    fac = {
      cc: top('cc'),
      lang: top('lang'),
      q: ['SD', 'HD', 'FHD', '4K'].filter(function (q) {
        return chans.some(function (c) {
          return c.q === q;
        });
      }),
    };
  }
  function boot() {
    msg('<div>' + t('Loading channels...') + '</div>');
    api(LIVE_API + '/status')
      .then(function (s) {
        if (!s.configured) {
          setup();
          return;
        }
        var tries = 0;
        (function load() {
          if (!o.on) return;
          api(LIVE_API + '/channels').then(function (x) {
            if (!x.channels.length) {
              if (++tries > 40) {
                msg('<div>' + lesc(s.error || 'No channels') + '</div>');
                return;
              }
              setTimeout(load, 2000);
              return;
            }
            groups = x.groups;
            chans = x.channels.map(function (r) {
              return {
                num: r[0],
                id: r[1],
                name: r[2],
                group: r[3],
                logo: r[4],
                url: r[5],
                key: r[6] || '',
                cc: r[7] || '',
                lang: r[8] || '',
                q: r[9] || '',
                fl: r[10] || 0,
                cats: r[11] || (r[3] ? [r[3]] : []),
                alt: (r[12] || []).map(function (a) {
                  return { url: a[0], q: a[1] };
                }),
                lg: r[13] || '' /* the number a source has for the channel itself (the TV's tuner), shown in the tab of its group */,
              };
            });
            byNum = {};
            byKey = {};
            chans.forEach(function (c) {
              byNum[c.num] = c;
              if (c.key) byKey[c.key] = c;
            });
            loaded = true;
            facets();
            var last = 0;
            try {
              last = parseInt(localStorage.getItem('live.last'), 10);
            } catch (e) {}
            api(LIVE_API + '/state')
              .then(
                function (st) {
                  S = { fav: st.fav || [], recent: st.recent || [], failed: st.failed || {} };
                },
                function () {}
              )
              .then(function () {
                layer('lv-msg', false);
                var first = firstPlayable(last);
                if (first) play(first);
                /* nothing to play (a guide of channels the add-on opens): the guide is all there is to show */
                if (guideNext || !first) {
                  guideNext = false;
                  openList();
                }
              });
          });
        })();
      })
      .catch(function () {
        msg('<div>' + t('The helper is not reachable.') + '</div>');
        setTimeout(function () {
          if (o.on) boot();
        }, 3000);
      });
  }
  function step(d) {
    var i = chans.indexOf(byNum[cur]),
      n = chans.length;
    /* Up and Down zap through the channels that have a stream */
    for (var k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (chans[i].url) {
        play(chans[i].num, false, 180);
        return;
      }
    }
  }
  var guideNext = false;
  o.enter = function (guide) {
    o.on = true;
    guideNext = !!guide;
    $('lv').classList.add('on');
    if (loaded && byNum[cur]) {
      play(cur);
      if (guideNext) {
        guideNext = false;
        openList();
      }
    } else boot();
  };
  /* playback the TV paused while it hid the window for a moment (see liveGuard in input.js) */
  o.resume = function () {
    if (o.on && video && video.paused) {
      try {
        var r = video.play();
        if (r && r.catch) r.catch(function () {});
      } catch (e) {}
    }
  };
  o.toggleGuide = function () {
    if (!loaded) return;
    if (L.open) closeList();
    else {
      M.open = false;
      layer('lv-menu', false);
      openList();
    }
  };
  o.exit = function () {
    o.on = false;
    closeList();
    M.open = false;
    layer('lv-menu', false);
    setStats(false);
    full = {};
    release();
    clearTimeout(osdT);
    clearTimeout(numT);
    clearTimeout(toastT);
    clearInterval(setupT);
    layer('lv-osd', false);
    layer('lv-numin', false);
    layer('lv-msg', false);
    layer('lv-spin', false);
    layer('lv-tune', false);
    layer('lv-toast', false);
    $('lv').classList.remove('on');
    if (o.leave) o.leave(); /* the page asks the launcher to close its frame (js/start.js) */
  };
  o.key = function (e) {
    var k = e.keyCode;
    if (searching) {
      /* the input has the keys; only Enter and Back are ours */
      if (k === 13) {
        e.preventDefault();
        endSearch(true);
      } else if (k === 461 || k === 27) {
        e.preventDefault();
        if (Q) endSearch(false);
        else endSearch(true);
      }
      return;
    }
    e.preventDefault();
    if (!loaded) {
      if (k === 461 || k === 27 || k === 8) o.exit();
      return;
    }
    if (FP.open) {
      filterKey(k);
      return;
    }
    if (M.open) {
      menuKey(k);
      return;
    }
    if (L.open) {
      var n7 = 7;
      if (k === 38) {
        if (L.ci > 0) L.ci--;
      } else if (k === 40) {
        if (L.ci < L.list.length - 1) L.ci++;
      } else if (k === 33 || k === 427) {
        L.ci = Math.max(0, L.ci - n7);
      } else if (k === 34 || k === 428) {
        L.ci = Math.min(L.list.length - 1, L.ci + n7);
      } else if (k === 37) {
        if (L.g > 0) {
          L.g--;
          L.list = listFor(L.g);
          L.ci = 0;
        }
      } else if (k === 39) {
        if (L.g < groups.length + 2) {
          L.g++;
          L.list = listFor(L.g);
          L.ci = 0;
        }
      } else if (k === 13) {
        if (L.list[L.ci]) {
          var n = L.list[L.ci].num;
          keepTab();
          closeList();
          play(n);
          return;
        }
      } else if (k === 458) {
        closeList();
        return;
      } else if (k === 404) {
        toggleFav(L.list[L.ci]);
        return;
      } else if (k === 405) {
        FP.open = true;
        FP.i = 0;
        drawFilter();
        layer('lv-filter', true);
        return;
      } else if (k === 403) {
        startSearch();
        return;
      } else if (k === 461 || k === 27 || k === 8) {
        if (Q || F.cc || F.lang || F.q) {
          Q = '';
          F = { cc: '', lang: '', q: '' };
          relist();
          return;
        }
        /* the TV guide of the tuner has no player under it to go back to: Back leaves the page (the launcher goes back to the TV) */
        if (ADDON !== 'iptv') o.exit();
        else closeList();
        return;
      } else if (k >= 48 && k <= 57) {
        closeList();
        digit(k - 48);
        return;
      } else return;
      drawList();
      fetchVisible();
      return;
    }
    if (k === 13) {
      if (failed) play(cur);
      else openList();
    } else if (k === 404) toggleFav(byNum[cur]);
    else if (k === 405) openMenu();
    else if (k === 406) setStats(!stats);
    else if (k === 38 || k === 33 || k === 427) step(1);
    else if (k === 40 || k === 34 || k === 428) step(-1);
    else if (k === 458) openList();
    else if (k === 457 || k === 37 || k === 39) showOsd();
    else if (k >= 48 && k <= 57) digit(k - 48);
    else if (k >= 96 && k <= 105) digit(k - 96);
    else if (k === 461 || k === 27 || k === 8) o.exit();
  };

  /* ---- the pointer (Magic Remote): the same actions as the keys, on every screen ----
     hover selects, a click opens or picks, the wheel scrolls (or zaps while watching), holding a click is the options: a channel's
     favourite in the guide, the player menu on the picture. A click outside a panel closes it. */
  var lvEl = $('lv'),
    holdP = 0,
    heldP = false,
    wheelAt = 0,
    pX = -1,
    pY = -1;
  function near(ev, sel) {
    return ev.target && ev.target.closest ? ev.target.closest(sel) : null;
  }
  function num(el, a) {
    return +el.getAttribute(a);
  }
  lvEl.addEventListener('mousemove', function (ev) {
    if (!o.on || !loaded || searching || Date.now() - lastKey < 1500) return;
    if (pX < 0) {
      pX = ev.clientX;
      pY = ev.clientY;
      return;
    }
    if (Math.abs(ev.clientX - pX) + Math.abs(ev.clientY - pY) < 24) return; // real movement only, as on the home screen
    pX = ev.clientX;
    pY = ev.clientY;
    var el;
    if (FP.open) {
      el = near(ev, '#lv-filter .mrow');
      if (el && num(el, 'data-i') !== FP.i) {
        FP.i = num(el, 'data-i');
        drawFilter();
      }
    } else if (M.open) {
      el = near(ev, '#lv-menu .mrow');
      if (el && num(el, 'data-i') !== M.i) {
        M.i = num(el, 'data-i');
        drawMenu();
      }
    } else if (L.open) {
      el = near(ev, '.crow');
      if (el && num(el, 'data-j') !== L.ci) {
        L.ci = num(el, 'data-j');
        drawList(true);
        fetchVisible();
      }
    } else showOsd();
  });
  lvEl.addEventListener('mousedown', function (ev) {
    heldP = false;
    clearTimeout(holdP);
    if (!o.on || !loaded || searching || FP.open || M.open) return;
    var el = L.open ? near(ev, '.crow') : null;
    if (L.open && !el) return;
    holdP = setTimeout(function () {
      heldP = true;
      if (el) toggleFav(L.list[num(el, 'data-j')]);
      else openMenu();
    }, 650);
  });
  lvEl.addEventListener('mouseup', function () {
    clearTimeout(holdP);
  });
  lvEl.addEventListener('click', function (ev) {
    if (heldP) {
      heldP = false;
      return;
    }
    if (!o.on) return;
    if (searching) {
      if (ev.target.id !== 'lv-search') endSearch(true);
      return;
    }
    if (!loaded) return;
    var el;
    if (FP.open) {
      el = near(ev, '#lv-filter .mrow');
      if (!el) {
        FP.open = false;
        layer('lv-filter', false);
        drawList();
        return;
      }
      FP.i = num(el, 'data-i');
      var r = filterRows()[FP.i];
      if (r.k === 'clear') {
        F = { cc: '', lang: '', q: '' };
        relist();
        drawFilter();
      } else stepFilter(r.k, 1);
      return;
    }
    if (M.open) {
      el = near(ev, '#lv-menu .mrow');
      if (!el) {
        M.open = false;
        layer('lv-menu', false);
        return;
      }
      M.i = num(el, 'data-i');
      M.items[M.i].fn();
      return;
    }
    if (L.open) {
      el = near(ev, '.crow');
      if (el) {
        var ch = L.list[num(el, 'data-j')];
        if (ch) {
          keepTab();
          closeList();
          play(ch.num);
        }
        return;
      }
      el = near(ev, '.ctab');
      if (el && el.hasAttribute('data-g')) {
        L.g = num(el, 'data-g');
        L.list = listFor(L.g);
        L.ci = 0;
        drawList();
        fetchVisible();
      } else if (el && el.classList.contains('f')) {
        FP.open = true;
        FP.i = 0;
        drawFilter();
        layer('lv-filter', true);
      }
      return;
    }
    if (failed) play(cur);
    else openList();
  });
  lvEl.addEventListener(
    'wheel',
    function (ev) {
      if (!o.on || searching || !ev.deltaY) return;
      ev.preventDefault();
      lastKey = Date.now(); // lastKey also keeps the pointer from taking the selection back while rows slide under it
      var now = lastKey,
        d = ev.deltaY > 0 ? 1 : -1;
      if (FP.open) {
        if (now - wheelAt < 90) return;
        wheelAt = now;
        FP.i = Math.max(0, Math.min(3, FP.i + d));
        drawFilter();
        return;
      }
      if (M.open) {
        if (now - wheelAt < 90) return;
        wheelAt = now;
        M.i = Math.max(0, Math.min(M.items.length - 1, M.i + d));
        drawMenu();
        return;
      }
      if (L.open) {
        if (now - wheelAt < 70) return;
        wheelAt = now;
        L.ci = Math.max(0, Math.min(L.list.length - 1, L.ci + d));
        drawList();
        fetchVisible();
        return;
      }
      if (!loaded || now - wheelAt < 300) return;
      wheelAt = now;
      step(d > 0 ? -1 : 1);
    },
    { passive: false }
  );
  return o;
})();
