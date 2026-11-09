document.addEventListener('keydown', function (e) {
  var k = e.keyCode;
  if (k === 38) next(-1);
  else if (k === 40) next(1);
  else if (k === 37) {
    if (rows[idx] && rows[idx].left) rows[idx].left();
    else setTab(tab - 1);
  } else if (k === 39) {
    if (rows[idx] && rows[idx].right) rows[idx].right();
    else setTab(tab + 1);
  } else if (k === 13) act();
  else if ((k === 33 || k === 34) && view === 'providers') provKey(k === 33 ? -1 : 1); /* Channel up / down (PageUp / PageDown on webOS) */
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
  var tb = e.target.closest && e.target.closest('.tab');
  if (tb) {
    setTab(+tb.getAttribute('data-t'));
    return;
  }
  var r = e.target.closest && e.target.closest('.row');
  if (r && !(rows[+r.getAttribute('data-i')] || {}).nofocus) {
    idx = +r.getAttribute('data-i');
    draw();
    act();
  }
});
document.addEventListener('mousemove', function (e) {
  var r = e.target.closest && e.target.closest('.row');
  if (r && +r.getAttribute('data-i') !== idx && !(rows[+r.getAttribute('data-i')] || {}).nofocus) {
    idx = +r.getAttribute('data-i');
    draw();
  }
});
document.addEventListener('wheel', function (e) {
  if (e.deltaY > 0) next(1);
  else if (e.deltaY < 0) next(-1);
}); /* the Magic Remote wheel */
/* opened with {"open":"wallpapers"}, {"open":"cards"}, {"open":"addons"} or {"open":"ha"} (the launcher's Customise menu), or {"open":"icons", "app": id}
   (a tile's Change icon): straight to that screen */
var cardsFromHome = false;
function wantView() {
  var p = {};
  try {
    p = JSON.parse(window.webOSSystem.launchParams || '{}');
  } catch (e) {}
  if (p && p.open === 'remaplearned') rmResume();
  if (p && p.open === 'wallpapers') openWallpapers();
  if (p && p.open === 'icons') openIconPair(String(p.app || ''));
  if (p && p.open === 'addons') wantTab = 2;
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
  /* the launcher's Customise > Weather > More on your phone: the QR code of the cards page at once, Back returns to the cards */
  if (p && p.open === 'cardspair') {
    cardsFromHome = true;
    api('/api/cards/status', {}).then(
      function (r) {
        cs = r;
        push('cards');
        openCardsPair();
      },
      function () {
        banner('The service did not answer', 'err');
      }
    );
  }
}
document.addEventListener('webOSRelaunch', function () {
  view = 'main';
  tab = 0;
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
