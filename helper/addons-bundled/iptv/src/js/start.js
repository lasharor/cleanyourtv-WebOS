/* ---------- the launcher's messages ---------- */
function tellLauncher(what) {
  try {
    parent.postMessage({ cytvAddon: what, id: ADDON }, '*');
  } catch (e) {}
}
window.addEventListener('message', function (ev) {
  var d = ev.data || {};
  if (d.cytv === 'init') {
    var v = d.vars || {};
    for (var k in v) if (v[k]) document.documentElement.style.setProperty('--' + k, v[k]);
  } else if (d.cytv === 'guide') LIVE.toggleGuide();
  else if (d.cytv === 'resume') LIVE.resume();
  else if (d.cytv === 'key')
    /* a key the launcher got while it had the focus */
    LIVE.key({
      keyCode: d.keyCode,
      preventDefault: function () {},
    });
});
document.addEventListener('keydown', function (e) {
  lastKey = Date.now();
  LIVE.key(e);
});
LIVE.leave = function () {
  tellLauncher('close');
};
LIVE.enter(Q.guide === '1');
