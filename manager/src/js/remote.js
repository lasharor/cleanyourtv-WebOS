/* Phone remote: a page on a paired phone that works as the TV's remote (the phoneremote add-on). On/off, pairing by QR code, the paired phones */
/* "1 phone" / "2 phones": the caller passes it through tr(), which matches "%d phone" and "%d phones" */
function prCount(n) {
  return n + (n === 1 ? ' phone' : ' phones');
}
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
var prListenShown = '',
  prLiveBusy = false,
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
      /* the port 8799 could not be opened: say why once (not on every poll, which would hide other messages), and still follow the list */
      if (r.listenError !== prListenShown) {
        prListenShown = r.listenError || '';
        if (prListenShown) banner(tr(prListenShown), 'err');
      }
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
      if (r.listenError) banner(tr(r.listenError), 'err'); /* the change applied: the port could not be opened, so say that too */
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
/* " · paired 2 Nov": when the phone was paired, for the lists of phones (" · " is the pages' joiner: each side is translated on its own) */
function prPaired(p) {
  return p && p.created
    ? ' \u00B7 ' + tr('paired ' + new Date(p.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))
    : '';
}
/* the setting "Remove unused phones" in words: 14 -> "after 2 weeks", 0 -> "never" */
function prExpireLabel(d) {
  d = d === undefined ? 14 : d;
  return d === 0
    ? tr('never')
    : d === 30
      ? tr('after 1 month')
      : d === 14
        ? tr('after 2 weeks')
        : d === 7
          ? tr('after 1 week')
          : tr('after ' + d + (d === 1 ? ' day' : ' days'));
}
function prAgo(t) {
  var m = Math.round((Date.now() - t) / 60000);
  return !t
    ? tr('never')
    : m < 1
      ? tr('just now')
      : m < 60
        ? tr(m + ' min ago')
        : m < 1440
          ? tr(Math.round(m / 60) + ' h ago')
          : tr(Math.round(m / 1440) + ' days ago');
}
/* the QR screen: the pairing window is open while it is on screen (it is asked for again every few seconds and closed when leaving) */
function openPrPair() {
  if (!pr || !pr.enabled) {
    api('/api/phoneremote', { enabled: true }).then(
      function (r) {
        /* go on only when the remote really is on: a reply without "enabled" would post again for ever */
        if (r && r.enabled) {
          pr = r;
          openPrPair();
          return;
        }
        banner((r && r.error) || 'The service did not answer', 'err');
      },
      function () {
        banner('The service did not answer', 'err');
      }
    );
    return;
  }
  shareMode = 'remote';
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
/* draw the code when what it points at has changed: the pairing code changes after every pairing, */
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
        setTimeout(prWatch, 2000); /* the screen is still open: ask again instead of stopping here */
        return;
      }
      pr = r;
      var p = r.pairing;
      if (p) {
        showQr(p.qr);
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
          $('sharemsg').textContent = tr('The code works once. The page is not encrypted: what you type travels over your Wi-Fi.');
      } else $('sharemsg').textContent = tr('The pairing window closed. Press Back and open it again.');
      /* the port 8799 could not be opened (another program has it): say why, and still follow the window and show the code */
      if (r.listenError) $('sharemsg').textContent = tr(r.listenError);
      setTimeout(prWatch, 2000);
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
      setTimeout(prWatch, 2000); /* a request that never arrived is tried again too */
    }
  );
}
