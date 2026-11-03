/* Phone remote: a page on a paired phone that works as the TV's remote (helper/phoneremote.js). On/off, pairing by QR code, the paired phones */
var qrShown = ''; /* the text the QR code on screen was drawn from */
function openPhoneRemote() {
  api('/api/phoneremote').then(
    function (r) {
      pr = r;
      if (view !== 'phoneremote') push('phoneremote');
      else {
        build();
        if (idx >= rows.length) idx = 0;
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function prRefresh() {
  if (view === 'phoneremote') openPhoneRemote();
}
/* The phone screens follow the TV: a phone that logs out, connects or is removed elsewhere shows at once, with no need to leave and open them again. */
var prLiveBusy = false,
  prLiveTimer = 0;
function prIsPhoneView() {
  return view === 'phoneremote' || view === 'phones' || view === 'prphone' || view === 'prexpire';
}
/* runs only while one of those screens is open: build() starts it, and it ends itself the moment another screen is shown */
function prLiveStart() {
  if (!prLiveTimer) prLiveTimer = setInterval(prLiveTick, 2500);
}
function prLiveKey(r) {
  return JSON.stringify(r ? [r.enabled, r.expireDays, r.listening, r.phones] : 0);
}
function prLiveTick() {
  if (!prIsPhoneView()) {
    clearInterval(prLiveTimer);
    prLiveTimer = 0;
    return;
  }
  if (prLiveBusy) return;
  prLiveBusy = true;
  api('/api/phoneremote').then(
    function (r) {
      prLiveBusy = false;
      if (!r || r.error || !prIsPhoneView()) return;
      if (prLiveKey(r) === prLiveKey(pr)) return; /* nothing changed: leave the screen alone (no redraw, no flicker) */
      pr = r;
      if (view === 'prphone') {
        var now = (r.phones || []).filter(function (p) {
          return prSel && p.id === prSel.id;
        })[0];
        if (!now) {
          banner('This phone was removed', 'ok');
          pop();
          return;
        }
        prSel = now;
      }
      build();
      if (idx >= rows.length) idx = Math.max(0, rows.length - 1);
      draw();
    },
    function () {
      prLiveBusy = false;
    }
  );
}
/* one change (on/off, block, remove): the service answers with the new state; the screens of one phone and the confirmation go back */
function prCall(path, b, msg) {
  api(path, b || {}).then(
    function (r) {
      if (r.error) {
        banner(r.error, 'err');
        return;
      }
      pr = r;
      if (msg) banner(msg, 'ok');
      if (view !== 'phoneremote') pop();
      else {
        build();
        if (idx >= rows.length) idx = 0;
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* " · paired 2 Nov": when the phone was paired, for the lists of phones */
function prPaired(p) {
  return p && p.created ? ' \u00B7 paired ' + new Date(p.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
}
/* the setting "Remove unused phones" in words: 14 -> "after 2 weeks", 0 -> "never" */
function prExpireLabel(d) {
  d = d === undefined ? 14 : d;
  return d === 0
    ? 'never'
    : d === 30
      ? 'after 1 month'
      : d === 14
        ? 'after 2 weeks'
        : d === 7
          ? 'after 1 week'
          : 'after ' + d + (d === 1 ? ' day' : ' days');
}
function prAgo(t) {
  var m = Math.round((Date.now() - t) / 60000);
  return !t
    ? 'never'
    : m < 1
      ? 'just now'
      : m < 60
        ? m + ' min ago'
        : m < 1440
          ? Math.round(m / 60) + ' h ago'
          : Math.round(m / 1440) + ' days ago';
}
/* the QR screen: the pairing window is open while it is on screen (it is asked for again every few seconds and closed when leaving) */
function openPrPair() {
  if (!pr || !pr.enabled) {
    api('/api/phoneremote', { enabled: true }).then(function (r) {
      pr = r;
      openPrPair();
    });
    return;
  }
  shareMode = 'remote';
  prApp = false; // the ordinary flow: the code opens the page in the phone's browser
  prSeen = 0;
  qrShown = '';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('Phone remote');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Type the code shown here on the phone. Next time it connects by itself.</li>'
  );
  $('sharemsg').textContent = tr('Preparing…');
  prWatch(true);
}
/* draw the code when what it points at has changed: the pairing code changes after every pairing, and the app link carries it */
function showQr(text) {
  if (text === qrShown) return;
  qrShown = text;
  drawQr(text);
  $('qrbox').style.visibility = 'visible';
}
function prWatch(first) {
  if (view !== 'share' || shareMode !== 'remote') return;
  api('/api/phoneremote/pair', {}).then(
    function (r) {
      if (view !== 'share' || shareMode !== 'remote') return;
      if (r.error) {
        $('sharemsg').textContent = tr(r.error);
        return;
      }
      pr = r;
      var p = r.pairing;
      if (p) {
        // the phone took the app just now: the same code should open the app and pair it, not the browser page
        var app = prApp; // only the screen that came from the install flow carries the app's code
        showQr(app ? 'cytv://add?host=' + appHost(p.url) + '&code=' + p.code : p.qr);
        $('shareurl').textContent = tr(p.url + '   code ' + p.code);
        if (first) prSeen = p.paired ? p.paired.at : 0; /* a phone paired before this screen opened does not count */
        if (p.paired && p.paired.at > prSeen) {
          /* a phone paired: leave the QR screen (this closes the window) and say so */
          var who = p.paired.name;
          closeShare();
          banner(tr('Paired') + ': ' + who, 'ok');
          setTimeout(function () {
            if ($('banner').textContent === tr('Paired') + ': ' + who) banner('');
          }, 5000);
          return;
        } else if (first)
          $('sharemsg').textContent = app
            ? tr('Scan it with the camera: the app opens with the code filled in.')
            : tr('The code works once. The page is not encrypted: what you type travels over your Wi-Fi.');
      } else $('sharemsg').textContent = tr('The pairing window closed. Press Back and open it again.');
      setTimeout(prWatch, 2000);
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}

/* The app: one code, the download. The file is served by the same port as the phone remote, so the pairing window (which is what opens
   the port) is asked for again every few seconds. As soon as the phone takes the file, this screen is the pairing screen: scanning it then
   opens the app with the code filled in, so the next step is right there. */
function appHost(url) {
  return String(url || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}
function openPrApp() {
  if (!pr || !pr.enabled) {
    api('/api/phoneremote', { enabled: true }).then(function (r) {
      pr = r;
      openPrApp();
    });
    return;
  }
  shareMode = 'app';
  prApp = false;
  prDl = -1;
  qrShown = '';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('Install the app (Android)');
  $('share').querySelector('ol').innerHTML = tr(
    '<li><b>Android only.</b> Scan the code with the phone camera.</li><li>Open the download and install it — <b>TV Remote</b> (let the browser install apps).</li><li>The TV then shows the pairing code: scan it and the app is ready.</li>'
  );
  $('sharemsg').textContent = tr('Preparing…');
  prWatchApp(true);
}
function prWatchApp(first) {
  if (view !== 'share' || shareMode !== 'app') return;
  api('/api/phoneremote/pair', {}).then(
    function (r) {
      if (view !== 'share' || shareMode !== 'app') return;
      if (r.error) {
        $('sharemsg').textContent = tr(r.error);
        return;
      }
      pr = r;
      var a = r.app || {};
      if (!a.available) {
        $('sharemsg').textContent = tr('This build has no app in it.');
        return;
      }
      if (prDl < 0) prDl = a.downloads; // a download from before this screen does not count
      if (a.downloads > prDl) {
        /* the phone has the file: no second screen to find, this one becomes the pairing screen */
        shareMode = 'remote';
        prApp = true;
        prSeen = 0;
        qrShown = '';
        $('share').querySelector('h2').textContent = tr('Phone remote');
        $('share').querySelector('ol').innerHTML = tr(
          '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Open the app: it is paired already and stays so.</li>'
        );
        $('sharemsg').textContent = tr('The app is on the phone: pair it now.');
        banner(tr('The app is on the phone: pair it now.'), 'ok');
        prWatch(true);
        return;
      }
      showQr(a.qr || a.url);
      $('shareurl').textContent = a.qr || a.url; // with the code in it, so it can also be typed
      if (first) $('sharemsg').textContent = tr('The phone downloads the app from the TV. This screen moves on to pairing by itself.');
      setTimeout(prWatchApp, 2000);
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
