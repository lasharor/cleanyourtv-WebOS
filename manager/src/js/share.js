function drawQr(url) {
  var q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  var n = q.getModuleCount(),
    cell = Math.max(4, Math.floor(640 / (n + 8))),
    cv = $('qr'),
    size = cell * (n + 8),
    g;
  cv.width = cv.height = size;
  g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
}
function openShare() {
  shareMode = 'log';
  push('share');
  $('share').querySelector('h2').textContent = tr('Share the log');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Tap <b>Copy</b> on the page and paste it into your message.</li>'
  );
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('sharemsg').textContent = tr('Preparing the report\u2026');
  rootExec('rm -f /tmp/cytv-sharelog.json; nohup node ' + SVC + '/helper/sharelog.js > /tmp/cytv-sharelog.out 2>&1 &').then(function () {
    pollShare(0);
  });
}
function pollShare(n) {
  if (view !== 'share') return;
  rootExec('cat /tmp/cytv-sharelog.json 2>/dev/null').then(function (m) {
    var st = null;
    try {
      st = JSON.parse(JSON.parse(m).stdoutString || 'null');
    } catch (e) {}
    if (st && st.url) {
      drawQr(st.url);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = st.url;
      $('sharemsg').textContent = tr(
        'The page is open for ten minutes. It lists versions, the setup log and the service log; addresses and URL paths are masked.'
      );
      return;
    }
    if (n > 45) {
      $('sharemsg').textContent = tr('Could not prepare the report (is the Homebrew Channel installed?).');
      return;
    }
    setTimeout(function () {
      pollShare(n + 1);
    }, 1000);
  });
}
function closeShare() {
  $('share').style.display = 'none';
  if (shareMode === 'notify') {
    pop();
    return;
  }
  if (shareMode === 'live') {
    pop();
    liveRefresh();
    return;
  }
  if (shareMode === 'cards') {
    api('/api/cards/pair', { stop: true }).catch(function () {});
    pop();
    openCards();
    return;
  }
  if (shareMode === 'icons') {
    api('/api/icons/pair', { stop: true }).catch(function () {});
    pop();
    return;
  }
  if (shareMode === 'wall') {
    api('/api/wallpapers/pair', { stop: true }).catch(function () {});
    pop();
    wallRefresh();
    return;
  }
  if (shareMode === 'abox') {
    api('/api/androidbox/pair', { stop: true }).catch(function () {});
    pop();
    abRefresh();
    return;
  }
  if (shareMode === 'pair') {
    api('/api/voice/pair-stop', {}).catch(function () {});
    pop();
    voiceRefresh();
    return;
  }
  rootExec('pkill -f "[s]harelog.js"; rm -f /tmp/cytv-sharelog.json');
  pop();
}
