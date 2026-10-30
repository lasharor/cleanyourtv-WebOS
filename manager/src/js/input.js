document.addEventListener('keydown', function (e) {
  var k = e.keyCode;
  if (k === 38) next(-1);
  else if (k === 40) next(1);
  else if (k === 13) act();
  else if (k === 461 || k === 27 || k === 8 || k === 10009) {
    if (view === 'share') closeShare();
    else if (view === 'keys') closeKeys();
    else if (view !== 'main') pop();
    else {
      try {
        window.close();
      } catch (x) {}
    }
  }
  e.preventDefault();
});
document.addEventListener('click', function (e) {
  if (e.target.closest && e.target.closest('#shareclose')) {
    closeShare();
    return;
  }
  var r = e.target.closest && e.target.closest('.row');
  if (r) {
    idx = +r.getAttribute('data-i');
    draw();
    act();
  }
});
document.addEventListener('mousemove', function (e) {
  var r = e.target.closest && e.target.closest('.row');
  if (r && +r.getAttribute('data-i') !== idx) {
    idx = +r.getAttribute('data-i');
    draw();
  }
});
document.addEventListener('wheel', function (e) {
  if (e.deltaY > 0) next(1);
  else if (e.deltaY < 0) next(-1);
}); /* the Magic Remote wheel */
/* opened with {"open":"wallpapers"}, {"open":"cards"} or {"open":"ha"} (the launcher's Customise menu), or {"open":"icons", "app": id}
   (a tile's Change icon): straight to that screen */
var cardsFromHome = false;
function wantView() {
  var p = {};
  try {
    p = JSON.parse(window.webOSSystem.launchParams || '{}');
  } catch (e) {}
  if (p && p.open === 'wallpapers') openWallpapers();
  if (p && p.open === 'icons') openIconPair(String(p.app || ''));
  /* the launcher's Customise > Home Assistant > Connection: the Home Assistant screen with its phone page */
  if (p && p.open === 'ha')
    api('/api/voice/status').then(
      function (v) {
        vo = v;
        push('ha');
        openHaPair();
      },
      function () {}
    );
  if (p && p.open === 'volumebar') push('volumebar');
  if (p && p.open === 'cards') {
    cardsFromHome = true;
    openCards();
  }
}
document.addEventListener('webOSRelaunch', function () {
  view = 'main';
  idx = 0;
  idxStack = [];
  listY = 0;
  load();
  wantView();
});
$('shareclose').textContent = tr('Close');
banner('Reading status…', 'work');
load();
wantView();
