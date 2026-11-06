function aiHelp() {
  return 'Answers from language models: OpenRouter, a server of yours with the OpenAI-compatible API (Ollama, for example), or several, asked in order. If one does not answer, the next one is. Run these on the TV (ssh):\n\ncurl -X POST localhost:8765/api/voice/set -d \'{"llm":{"enabled":true,"providers":[{"type":"server","base":"http://192.168.1.20:11434/v1","model":"llama3.2:3b"},{"type":"openrouter","key":"sk-or-...","model":"openrouter/auto"}]}}\'\n\nOptional: "system" sets the instructions; a provider takes "name", "key", "waitS" (10, 25, 30, 45 or 60) and "off". Ask by text from anywhere on the TV:\ncurl -X POST localhost:8765/api/voice/ask -d \'{"text":"What is the capital of Peru?"}\'\n\nSpoken and typed questions go as text to the providers in their order; no audio does. Each key stays on the TV and goes only to its own provider.\n\nHome Assistant (Assist), with a long-lived access token:\ncurl -X POST localhost:8765/api/voice/set -d \'{"ha":{"url":"http://homeassistant.local:8123","token":"..."}}\'\nOptional: "route" is ha-first, ha-only or ai-only; "selfSigned":true accepts a self-signed certificate; "agent" is a conversation entity.';
}
function liveRefresh() {
  api('/api/live/status').then(
    function (r) {
      lv = r;
      if (view === 'livetv') {
        build();
        if (idx >= rows.length) idx = 0;
        draw();
      }
    },
    function () {}
  );
}
function openNotifyQr() {
  if (!napi || !napi.enabled) {
    banner('Switch notifications on first', 'err');
    return;
  }
  shareMode = 'notify';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('Notification address and token');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera and open the page: it shows the address and the token with <b>Copy</b> buttons.</li><li>The token is a <b>secret</b>: anyone who sees this code while it is open can read it.</li>'
  );
  $('sharemsg').textContent = tr('Preparing\u2026');
  api('/api/manager/notify-api', { page: true }).then(
    function (r) {
      if (view !== 'share') return;
      if (!r.pageUrl) {
        $('sharemsg').textContent = tr('The notification listener is not running.');
        return;
      }
      drawQr(r.pageUrl);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = r.pageUrl;
      $('sharemsg').textContent = tr(
        'The page opens for ten minutes. It is not encrypted: the token travels over your Wi-Fi, so use a network you trust.'
      );
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
/* MCP on the network (helper/toolhub.js): a page on the phone with the address and the token */
function openMcpQr() {
  if (!mnet || !mnet.lan) {
    banner('Switch MCP on the network on first', 'err');
    return;
  }
  shareMode = 'mcp';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('MCP address and token');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera and open the page: it shows the address and the token with <b>Copy</b> buttons.</li><li>The token is a <b>secret</b>: anyone who sees this code while it is open can read it.</li>'
  );
  $('sharemsg').textContent = tr('Preparing…');
  api('/api/mcp/lan', { page: true }).then(
    function (r) {
      if (view !== 'share' || shareMode !== 'mcp') return;
      if (!r.pageUrl) {
        $('sharemsg').textContent = tr('The MCP port is not open.');
        return;
      }
      drawQr(r.pageUrl);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = r.pageUrl;
      $('sharemsg').textContent = tr(
        'The page opens for ten minutes. It is not encrypted: the token travels over your Wi-Fi, so use a network you trust.'
      );
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
/* Add-ons (helper/addons.js): the ones on the TV and the project's catalog */
function loadAddons() {
  Promise.all([
    api('/api/addons'),
    api('/api/addons/catalog'),
    api('/api/addons/repos').catch(function () {
      return null; /* a service older than the repositories */
    }),
  ]).then(
    function (r) {
      ad.installed = (r[0] && r[0].addons) || [];
      ad.catalog = (r[1] && r[1].addons) || [];
      ad.error = (r[1] && r[1].error) || '';
      ad.reposOk = !!(r[2] && Array.isArray(r[2].repos));
      ad.repos = ad.reposOk ? r[2].repos : [];
      ad.paused = !!(r[0] && r[0].paused);
      ad.book = (r[0] && r[0].book) || ad.book;
      if (view === 'addon' && !addonSel()) pop();
      if (view === 'addonrepo' && !repoSel()) pop();
      build();
      if (idx >= rows.length) idx = Math.max(0, rows.length - 1);
      draw();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function repoSel() {
  for (var i = 0; i < ad.repos.length; i++) if (ad.repos[i].name === ad.repoSel) return ad.repos[i];
  return null;
}
/* Add-ons > Repositories > Add from your phone: the address is typed on the phone (a page on port 8800) */
/* first the warning, with Cancel as the default; its deliberate button opens the page for the phone */
function openRepoDialog() {
  ad.pend = {};
  push('confirm-repo');
}
function openRepoPair() {
  pairScreen('addonpair', 'repos', 'Add a repository', '/api/addons/repos/phone');
}
function addonSel() {
  for (var i = 0; i < ad.installed.length; i++) if (ad.installed[i].id === ad.sel) return ad.installed[i];
  return null;
}
function addonDo(path, body, done, after) {
  banner('Working\u2026', 'work');
  api(path, body).then(
    function (r) {
      if (r.error) {
        /* refused, or a stop that failed: the add-on may still be running, so show the real status and do not go on as if it had worked */
        banner(r.error, 'err');
        loadAddons();
        return;
      }
      banner(r.restartNeeded ? done + ' \u00B7 restart the TV to apply it' : done, 'ok');
      loadAddons();
      if (after && !r.restartNeeded) after();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* the book: which add-ons are pages of the launcher, in which order, and whether the strip at the bottom of Home shows */
/* where the page strip can be put by the user ('' leaves it to the theme); the order is the order of the row when it is chosen again */
var STRIP_POS = ['', 'bottom-center', 'bottom-left', 'bottom-right', 'top-left', 'top-center', 'top-right'];
function stripPosLabel(p) {
  return p ? p.replace('-', ' ') : 'theme default';
}
function bookPages() {
  return ad.installed
    .filter(function (a) {
      return a.bookable;
    })
    .sort(function (a, b) {
      return a.order - b.order;
    });
}
function bookSet(body, done) {
  banner('Working\u2026', 'work');
  api('/api/addons/book', body).then(
    function (r) {
      if (r.error) return banner(r.error, 'err');
      banner(done, 'ok');
      loadAddons();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function bookMove(id, d) {
  var all = bookPages(),
    ids = all
      .filter(function (a) {
        return a.inBook;
      })
      .map(function (a) {
        return a.id;
      }),
    i = ids.indexOf(id),
    j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) return;
  ids.splice(j, 0, ids.splice(i, 1)[0]);
  /* the pages that are left out keep their place after the others */
  all.forEach(function (a) {
    if (ids.indexOf(a.id) < 0) ids.push(a.id);
  });
  bookSet({ order: ids }, 'Page moved');
}
function bookShow(id, on) {
  var hidden = ad.book.hidden.filter(function (h) {
    return h !== id;
  });
  if (!on) hidden.push(id);
  bookSet({ hidden: hidden }, on ? 'Page shown' : 'Page hidden');
}
function openLiveTv() {
  api('/api/live/status').then(
    function (r) {
      lv = r;
      push('livetv');
    },
    function () {
      lv = null;
      push('livetv');
    }
  );
}
/* Wallpapers: photos uploaded from a phone and the photo sources of add-ons (helper/wallpapers.js); the launcher's Customise switches them on */
function openWallpapers() {
  api('/api/wallpapers/status').then(
    function (r) {
      wp = r;
      if (view !== 'wallpapers') push('wallpapers');
      else {
        build();
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function wallRefresh() {
  if (view === 'wallpapers') openWallpapers();
}
function wallCall(path, b, msg) {
  api(path, b || {}).then(
    function (r) {
      wp = r;
      if (msg) banner(msg, 'ok');
      if (view !== 'wallpapers') pop();
      else {
        build();
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function openWallPair() {
  shareMode = 'wall';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('Wallpapers');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Choose the photos to upload.</li>'
  );
  $('sharemsg').textContent = tr('Preparing\u2026');
  api('/api/wallpapers/pair', {}).then(
    function (r) {
      if (view !== 'share' || shareMode !== 'wall') return;
      if (r.error) {
        $('sharemsg').textContent = tr(r.error);
        return;
      }
      drawQr(r.qr);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = tr(r.url + '   code ' + r.code);
      $('sharemsg').textContent = tr(
        'The page stays open while you use it, at most an hour. It is not encrypted: your photos travel over your Wi-Fi.'
      );
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
/* a photo source (an add-on that provides wallpapers: Immich, Unsplash, ...) has its own settings page on the phone, and so has any
   add-on whose service offers one (Add-ons > the add-on > Set up from your phone) */
var wallSrc = '',
  pairPath = '';
function openSourcePair(id, label) {
  pairScreen('wallsrc', id, label, '/api/wallpapers/source/' + id + '/settings');
}
function openAddonPair(id, label) {
  pairScreen('addonpair', id, label, '/api/addons/' + id + '/settings');
}
function pairScreen(mode, id, label, path) {
  wallSrc = id;
  pairPath = path;
  shareMode = mode;
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = label;
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li>'
  );
  $('sharemsg').textContent = tr('Preparing\u2026');
  api(path, {}).then(
    function (r) {
      if (view !== 'share' || shareMode !== mode) return;
      if (r.error) {
        $('sharemsg').textContent = tr(r.error);
        return;
      }
      drawQr(r.qr);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = tr(r.url + '   code ' + r.code);
      $('sharemsg').textContent = tr('The page stays open while you use it. It is not encrypted: what you type travels over your Wi-Fi.');
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
/* More > App icons, or a tile's Change icon on Home ({open: 'icons', app}): the phone page of the App icons add-on, the app first */
function openIconPair(app) {
  shareMode = 'icons';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('App icons');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Choose <b>Change</b> next to an app, then a picture, <b>Full tile</b> or <b>Icon</b>.</li>'
  );
  $('sharemsg').textContent = tr('Preparing…');
  /* scale: this screen's pixels per CSS pixel (2 on a 4K TV, as on Home), so the sizes shown are the panel's own pixels */
  api('/api/icons/pair', { app: app, scale: window.devicePixelRatio || 1 }).then(
    function (r) {
      if (view !== 'share' || shareMode !== 'icons') return;
      if (r.error) {
        $('sharemsg').textContent = tr(r.error);
        return;
      }
      drawQr(r.qr);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = tr(r.url + '   code ' + r.code);
      /* the sizes that fit the theme's tiles: two more steps of the list, which has room for them below the others */
      var z = r.sizes;
      if (z) {
        var ol = $('share').querySelector('ol'),
          li = document.createElement('li');
        li.textContent = tr('Best size for Full tile: %s pixels. Edges that don’t fit are trimmed, keeping the middle.').replace(
          '%s',
          z.tile.w + ' × ' + z.tile.h
        );
        ol.appendChild(li);
        li = document.createElement('li');
        li.textContent = tr('Best size for Icon: %s pixels. Ideally with a transparent background.').replace('%s', z.icon + ' × ' + z.icon);
        ol.appendChild(li);
      }
      $('sharemsg').textContent = tr(
        'The page stays open while you use it, at most an hour. It is not encrypted: the pictures travel over your Wi-Fi.'
      );
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
function openHaPair() {
  openPair('ha');
}
/* More > Home Assistant: its address and token live with Voice's settings (/api/voice/status), Voice and the cards both use them */
function openHa() {
  api('/api/voice/status').then(
    function (v) {
      vo = v;
      push('ha');
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* Cards: a card for each place of the theme (/api/cards/status, /api/cards/set); also opened from the launcher's Customise > Cards */
var cs = null,
  cardSlot = null;
/* Cards > Get more cards: the catalog of downloadable cards (helper/cardcatalog.js), with a picture and a text each */
var cardCat = { cards: [], error: '', sel: '' };
function openCardCatalog() {
  api('/api/cards/catalog').then(
    function (r) {
      cardCat.cards = (r && r.cards) || [];
      cardCat.error = (r && r.error) || '';
      if (view !== 'cardcat' && view !== 'cardone') push('cardcat');
      else {
        build();
        if (idx >= rows.length) idx = Math.max(0, rows.length - 1);
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function cardSel() {
  for (var i = 0; i < cardCat.cards.length; i++) if (cardCat.cards[i].id === cardCat.sel) return cardCat.cards[i];
  return null;
}
function cardDo(path, id, done) {
  banner('Working…', 'work');
  api(path, { id: id }, 60000).then(
    function (r) {
      if (r.error) return banner(r.error, 'err');
      banner(done, 'ok');
      if (view === 'cardone') pop();
      openCardCatalog();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function openCards() {
  api('/api/cards/status', {}).then(
    function (r) {
      cs = r;
      if (view !== 'cards') push('cards');
      else {
        build();
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* the card type a place shows: the one chosen, else the theme's own; null when it stays empty */
function cardTypeOf(sl) {
  var c = ((cs && cs.cards) || {})[sl.id];
  var ty = c && c.type ? c.type : sl.card || 'none';
  return ty === 'none' ? null : ty;
}
function cardTypeName(ty) {
  var n = ty;
  ((cs && cs.types) || []).forEach(function (x) {
    if (x.type === ty) n = x.name;
  });
  return n;
}
function setCardType(ty) {
  api('/api/cards/set', { slot: cardSlot.id, type: ty }).then(
    function (r) {
      if (r.error) {
        banner(r.error, 'err');
        return;
      }
      pop();
      openCards();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* Android box: apps that open on an Android box (NVIDIA Shield, ...) over ADB instead of on the TV (helper/androidbox.js) */
function openAndroidBox() {
  api('/api/androidbox').then(
    function (r) {
      ab = r;
      if (view !== 'androidbox') push('androidbox');
      else {
        build();
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* Apps on the box: the TV's apps, each opening on the box or on the TV (OK switches); the usual Android package is filled in where it is known */
function openAbApps() {
  api('/api/androidbox/apps').then(
    function (r) {
      abl = r.apps || [];
      if (view !== 'abapps') push('abapps');
      else {
        build();
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function abToggle(a) {
  api('/api/androidbox/app', { id: a.id, on: !a.on }).then(
    function (r) {
      if (r.error) {
        banner(r.error, 'err');
        return;
      }
      ab = r;
      banner('');
      openAbApps();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function abRefresh() {
  if (view === 'androidbox') openAndroidBox();
}
function abTest() {
  banner('Connecting\u2026 accept the question on the box if it asks', 'work');
  api('/api/androidbox/test', {}, 50000).then(
    function (r) {
      if (r.ok) banner('Connected: ' + (r.model || 'Android box'), 'ok');
      else banner(r.error || 'The box did not answer', 'err');
      abRefresh();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function abOff() {
  api('/api/androidbox', { host: '' }).then(
    function (r) {
      ab = r;
      banner('Apps open on the TV again', 'ok');
      build();
      draw();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function abWatch(base, n) {
  if (view !== 'share' || shareMode !== 'abox') return;
  setTimeout(function () {
    if (view !== 'share' || shareMode !== 'abox') return;
    api('/api/androidbox').then(
      function (r) {
        ab = r;
        if (r.savedAt > base) {
          $('sharemsg').textContent = tr('Saved. Press Back, then choose Test the connection.');
          base = r.savedAt;
        }
        abWatch(base, n + 1);
      },
      function () {
        abWatch(base, n + 1);
      }
    );
  }, 2000);
}
function openAbPair() {
  shareMode = 'abox';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('Android box');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Fill in the address of the box and its HDMI input, then tap <b>Save</b>.</li>'
  );
  $('sharemsg').textContent = tr('Preparing\u2026');
  api('/api/androidbox/pair', {}).then(
    function (r) {
      if (view !== 'share' || shareMode !== 'abox') return;
      if (r.error) {
        $('sharemsg').textContent = tr(r.error);
        return;
      }
      drawQr(r.qr);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = tr(r.url + '   code ' + r.code);
      $('sharemsg').textContent = tr('The page stays open for ten minutes. It is not encrypted: what you type travels over your Wi-Fi.');
      abWatch((ab && ab.savedAt) || 0, 0);
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
/* Cards: the options of the cards in the theme's slots, typed on a phone page (helper/cards.js) */
function openCardsPair() {
  shareMode = 'cards';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('Cards');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Choose a card for each place and fill in its options, then tap <b>Save</b>.</li>'
  );
  $('sharemsg').textContent = tr('Preparing\u2026');
  api('/api/cards/pair', {}).then(
    function (r) {
      if (view !== 'share' || shareMode !== 'cards') return;
      if (r.error) {
        $('sharemsg').textContent = tr(r.error);
        return;
      }
      drawQr(r.qr);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = tr(r.url + '   code ' + r.code);
      $('sharemsg').textContent = tr(
        'The page stays open while you use it, at most an hour. It is not encrypted: what you type travels over your Wi-Fi.'
      );
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
function openLivePair() {
  shareMode = 'live';
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr('Set up Live TV');
  $('share').querySelector('ol').innerHTML = tr(
    '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Enter the <b>code</b> below and your playlist address.</li>'
  );
  $('sharemsg').textContent = tr('Preparing\u2026');
  api('/api/live/pair', {}).then(
    function (r) {
      if (view !== 'share') return;
      drawQr(r.url);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = tr(r.url + '   code ' + r.code);
      $('sharemsg').textContent = tr(
        'The page stays open for ten minutes. It is not encrypted: the playlist address, which may hold an access key, travels over your Wi-Fi.'
      );
      (function poll(n) {
        if (view !== 'share' || shareMode !== 'live') return;
        api('/api/live/status').then(
          function (s2) {
            if (s2.configured && (!lv || !lv.configured || s2.channels !== lv.channels)) {
              lv = s2;
              closeShare();
              banner('Playlist saved', 'ok');
              return;
            }
            if (n < 300)
              setTimeout(function () {
                poll(n + 1);
              }, 2000);
          },
          function () {
            setTimeout(function () {
              poll(n + 1);
            }, 3000);
          }
        );
      })(0);
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
function openChannel() {
  banner('Looking for the dev build\u2026', 'work');
  api('/api/manager/tests').then(
    function (r) {
      banner('');
      tst = r;
      push('channel');
      for (var k = 0; k < rows.length; k++)
        if (rows[k].sub && /^selected/.test(rows[k].sub)) {
          idx = k;
          draw();
          break;
        }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function setChannel(tag) {
  banner('Switching\u2026', 'work');
  api('/api/manager/channel', { tag: tag }).then(
    function (s) {
      if (s.error) {
        banner(s.error, 'err');
        return;
      }
      st = s;
      pop();
      banner(
        tag
          ? 'Following the dev builds. If the Launcher or Service row offers an update, that is the dev build.'
          : 'Back on the stable releases',
        'ok'
      );
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* the models of one provider (pvId): OpenRouter can pick a model itself, a server of yours lists only the models it has */
function openModels() {
  var p = llmFind(pvId);
  if (!p) return;
  banner('Loading the model list…', 'work');
  api('/api/voice/models?id=' + encodeURIComponent(p.id)).then(
    function (r) {
      if (r.error) {
        banner(r.error, 'err');
        return;
      }
      banner('');
      mdl = (p.type === 'server' ? [] : [{ id: 'openrouter/auto', name: 'Auto (OpenRouter picks)', price: null }]).concat(r.picks || []);
      var cur = p.model;
      if (
        cur &&
        !mdl.some(function (x) {
          return x.id === cur;
        })
      )
        mdl.splice(p.type === 'server' ? 0 : 1, 0, { id: cur, name: cur, price: null });
      push('models');
      for (var k = 0; k < rows.length; k++)
        if (rows[k].sub && /selected$/.test(rows[k].sub)) {
          idx = k;
          draw();
          break;
        }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function haTest() {
  banner('Asking Home Assistant\u2026', 'work');
  api('/api/voice/ha-test', {}).then(
    function (r) {
      if (r.error) {
        banner(r.error, 'err');
        return;
      }
      banner('Connected to ' + (r.name || 'Home Assistant') + (r.version ? ' ' + r.version : ''), 'ok');
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function openAgents() {
  banner('Asking Home Assistant\u2026', 'work');
  api('/api/voice/ha-agents').then(
    function (r) {
      if (r.error) {
        banner(r.error, 'err');
        return;
      }
      banner('');
      agl = r.agents || [];
      push('agents');
      var cur = ((vo || {}).ha || {}).agent;
      for (var k = 0; k < rows.length; k++)
        if (rows[k].sub && /selected$/.test(rows[k].sub)) {
          idx = k;
          draw();
          break;
        }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function pickAgent(id) {
  api('/api/voice/set', { ha: { agent: id } }).then(
    function (x) {
      if (x.error) {
        banner(x.error, 'err');
        return;
      }
      vo = x;
      banner(id ? 'Agent: ' + id : 'Default agent', 'ok');
      pop();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function pickModel(id) {
  api('/api/voice/set', { llm: { provider: { id: pvId, model: id } } }).then(
    function (x) {
      if (x.error) {
        banner(x.error, 'err');
        return;
      }
      vo = x;
      banner('Model: ' + id, 'ok');
      pop();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* the phone page of Voice, or with only 'ha' the one for Home Assistant (address and token, used by Voice and the cards) */
function openPair(only) {
  shareMode = 'pair';
  pairBase = (vo && vo.pairedAt) || 0;
  push('share');
  $('share').style.display = 'block';
  $('shareurl').textContent = '';
  $('qrbox').style.visibility = 'hidden';
  $('share').querySelector('h2').textContent = tr(only === 'ha' ? 'Home Assistant' : 'Set up from your phone');
  $('share').querySelector('ol').innerHTML =
    only === 'ha'
      ? tr(
          '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Enter the <b>address</b> of Home Assistant and a <b>long-lived access token</b>, and tap <b>Save</b>.</li>'
        )
      : tr(
          '<li>Phone on the <b>same Wi-Fi</b> as the TV.</li><li>Scan the code with the camera.</li><li>Add <b>OpenRouter</b> or <b>your own server</b>, choose a model, and tap <b>Save</b>.</li>'
        );
  $('sharemsg').textContent = tr('Preparing\u2026');
  api('/api/voice/pair', only === 'ha' ? { only: 'ha' } : {}).then(
    function (r) {
      if (view !== 'share') return;
      drawQr(r.url);
      $('qrbox').style.visibility = 'visible';
      $('shareurl').textContent = tr(r.url);
      $('sharemsg').textContent = tr(
        'The page stays open for ten minutes, or until you save. It is not encrypted: the key travels over your Wi-Fi, so use a network you trust.'
      );
      pollPair(0);
    },
    function () {
      $('sharemsg').textContent = tr('The service did not answer.');
    }
  );
}
function pollPair(n) {
  if (view !== 'share' || shareMode !== 'pair') return;
  api('/api/voice/status').then(
    function (v) {
      if (v.pairedAt > pairBase) {
        vo = v;
        closeShare();
        banner('Saved', 'ok');
        return;
      }
      if (!v.pairing && n > 1) {
        $('sharemsg').textContent = tr('The page has closed. Close this and try again.');
        return;
      }
      setTimeout(function () {
        pollPair(n + 1);
      }, 2000);
    },
    function () {
      setTimeout(function () {
        pollPair(n + 1);
      }, 3000);
    }
  );
}
function voiceRefresh() {
  clearTimeout(pollT);
  api('/api/voice/status').then(
    function (v) {
      vo = v;
      var j = v.job || {};
      if (j.state === 'working') banner(j.message, 'work');
      else if (j.state === 'error') banner(j.message, 'err');
      else if (v.listening) banner('Listening…', 'work');
      else banner('');
      if (view === 'voice' || view === 'ha') {
        build();
        if (idx >= rows.length) idx = 0;
        draw();
      }
      if (j.state === 'working' || v.listening) pollT = setTimeout(voiceRefresh, 1000);
      else
        api('/api/manager/status').then(function (s) {
          st = s;
        });
    },
    function () {
      pollT = setTimeout(voiceRefresh, 2000);
    }
  );
}
/* AI chat: an ordered list of providers (OpenRouter, servers of yours); the first answers, the next is asked when one fails */
var pvId = '' /* the provider the Provider screen shows */,
  pvRm = { id: '', t: 0 } /* Remove asks for a second OK within 5 s */,
  pvBusy = false;
var PV_OK = '#9be3b0',
  PV_ERR = '#ff9a8a',
  PV_NONE = '#8a8d96', // not tried yet: a grey that shows on the dark rows and on the light focused row
  PV_HELP =
    'OK opens this provider. Channel up and down move it in the order. The dot is its last result: green answered, red did not, grey not tried yet. Addresses and keys are set on your phone.';
function llmList() {
  return ((vo || {}).llm || {}).providers || [];
}
function llmIndex(id) {
  var l = llmList();
  for (var i = 0; i < l.length; i++) if (id && l[i].id === id) return i;
  return -1;
}
function llmFind(id) {
  var i = llmIndex(id);
  return i < 0 ? null : llmList()[i];
}
/* the names of the providers that are not switched off, in the order they are asked */
function llmChain(l) {
  return l
    .filter(function (p) {
      return !p.off;
    })
    .map(function (p) {
      return p.name;
    })
    .join(' → ');
}
function llmHost(base) {
  return String(base || '')
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*/, '');
}
function llmAgo(at) {
  var t = +at || 0;
  if (t && t < 1e12) t *= 1000; /* seconds or milliseconds */
  var s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
function llmSecs(ms) {
  return ((ms || 0) / 1000).toFixed(1) + ' s';
}
/* the last try of a provider: "answered 2 min ago (1.1 s)", "did not answer 5 min ago", "not tried yet" */
function llmLast(p) {
  var l = p.last;
  if (!l) return 'not tried yet';
  return l.ok ? 'answered ' + llmAgo(l.at) + ' (' + llmSecs(l.ms) + ')' : 'did not answer ' + llmAgo(l.at);
}
function llmDot(p) {
  return !p.last ? PV_NONE : p.last.ok ? PV_OK : PV_ERR;
}
function llmModel(p) {
  return p.model || (p.type === 'server' ? 'no model chosen' : 'openrouter/auto');
}
/* a failed test in plain words */
function llmErr(r) {
  if (/time/i.test(r.error || '')) return 'Did not answer in time';
  if (r.stage === 'connect') return 'Could not connect';
  if (r.stage === 'auth') return 'Refused the key';
  return r.error || 'Did not answer in time';
}
/* POST /api/voice/set {llm: body}; then() redraws itself, else the list is drawn again */
function llmSet(body, okMsg, then) {
  api('/api/voice/set', { llm: body }).then(
    function (x) {
      if (x.error) {
        banner(x.error, 'err');
        return;
      }
      vo = x;
      if (okMsg) banner(okMsg, 'ok');
      if (then) then();
      else {
        build();
        draw();
      }
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* the row of the Providers screen to return to: Back from a provider's screen lands on it after it moved */
function llmBackTo(id) {
  var top = idxStack[idxStack.length - 1];
  if (top && top[0] === 'providers') top[1] = Math.max(0, llmIndex(id));
}
/* moves a provider to position to (0 is first); the focus follows it */
function llmMove(id, to) {
  var l = llmList(),
    from = llmIndex(id);
  if (from < 0 || to < 0 || to >= l.length || to === from) return;
  var ids = l.map(function (p) {
    return p.id;
  });
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  llmSet({ order: ids }, 'Order saved', function () {
    if (view === 'providers') idx = Math.max(0, llmIndex(id));
    else llmBackTo(id);
    build();
    draw();
  });
}
/* reads the status again (a test records its result there) and redraws the screen that shows it */
function llmStatus() {
  api('/api/voice/status').then(
    function (v) {
      vo = v;
      if (view === 'providers' || view === 'provider' || view === 'voice') {
        build();
        if (idx >= rows.length) idx = 0;
        draw();
      }
    },
    function () {}
  );
}
function llmTestCall(p) {
  return api('/api/voice/test', { id: p.id }, ((p.waitS || 25) + 20) * 1000);
}
/* asks every provider "Say OK", one after the other, a banner for each */
function llmTestAll() {
  if (pvBusy) return;
  var l = llmList().slice(),
    i = 0;
  pvBusy = true;
  var step = function () {
    if (i >= l.length) {
      pvBusy = false;
      llmStatus();
      return;
    }
    var p = l[i++];
    banner('Asking ' + p.name + '…', 'work');
    llmTestCall(p).then(
      function (r) {
        banner(p.name + ': ' + (r.ok ? 'answered in ' + llmSecs(r.ms) : llmErr(r)), r.ok ? 'ok' : 'err');
        step();
      },
      function () {
        banner(p.name + ': ' + 'The service did not answer', 'err');
        step();
      }
    );
  };
  step();
}
/* the Providers screen: one row per provider in the order they are asked */
function provRows() {
  var l = llmList();
  if (!l.length) {
    rows.push({
      label: 'Set up from your phone',
      sub: 'add OpenRouter or your own server',
      info: {
        t: 'Set up from your phone',
        d: 'Shows a QR code. On a phone on the same Wi-Fi, add OpenRouter or a server of yours, set their keys, models and order, and write instructions. Nothing is typed on the TV.',
      },
      fn: openPair,
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  l.forEach(function (p, i) {
    rows.push({
      label: p.name + (i === 0 && l.length > 1 ? ' · first' : ''),
      sub: p.off ? 'off' : llmModel(p) + ' · ' + llmLast(p),
      dim: !!p.off,
      dot: llmDot(p),
      pid: p.id,
      info: { t: 'AI providers', d: PV_HELP },
      fn: function () {
        pvId = p.id;
        pvRm.id = '';
        push('provider');
      },
    });
  });
  rows.push({ sep: true });
  rows.push({ label: 'Test all', sub: 'asks each one “Say OK”', fn: llmTestAll });
  rows.push({ label: 'Add a provider', sub: 'on your phone', fn: openPair });
  rows.push({ label: 'Back', fn: pop });
}
/* Channel up (-1) or down (+1) on a provider row of the Providers screen moves it in the order */
function provKey(dir) {
  if (view !== 'providers' || pvBusy) return;
  var r = rows[idx];
  if (r && r.pid) llmMove(r.pid, llmIndex(r.pid) + dir);
}
/* the Provider screen: one provider (pvId) */
function provOneRows() {
  var p = llmFind(pvId),
    l = llmList();
  if (!p) {
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  var i = llmIndex(p.id),
    last = i === l.length - 1;
  rows.push({
    label: 'Test now',
    sub: (p.hasKey ? 'key saved' : 'no key') + ' · ' + llmLast(p),
    fn: function () {
      if (pvBusy) return;
      pvBusy = true;
      banner('Asking ' + p.name + '…', 'work');
      llmTestCall(p).then(
        function (r) {
          pvBusy = false;
          if (r.ok) banner('Answered in ' + llmSecs(r.ms) + ': “' + String(r.answer || '').slice(0, 80) + '”', 'ok');
          else banner(llmErr(r), 'err');
          llmStatus();
        },
        function () {
          pvBusy = false;
          banner('The service did not answer', 'err');
        }
      );
    },
  });
  rows.push({ label: 'Model', sub: llmModel(p), fn: openModels });
  rows.push({
    label: 'Wait for an answer',
    sub: (p.waitS || 25) + ' s',
    fn: function () {
      var w = [10, 25, 30, 45, 60],
        n = w[(w.indexOf(p.waitS || 25) + 1) % w.length];
      llmSet({ provider: { id: p.id, waitS: n } });
    },
  });
  rows.push({
    label: 'Use this provider',
    sub: onoff(!p.off),
    fn: function () {
      llmSet({ provider: { id: p.id, off: !p.off } });
    },
  });
  rows.push({ sep: true });
  rows.push({
    label: 'Make first',
    sub: i === 0 ? 'first' : '',
    dim: i === 0,
    fn: function () {
      if (i === 0) return;
      llmSet({ first: p.id }, 'Order saved', function () {
        llmBackTo(p.id);
        build();
        draw();
      });
    },
  });
  rows.push({
    label: 'Move up',
    dim: i === 0,
    fn: function () {
      llmMove(p.id, i - 1);
    },
  });
  rows.push({
    label: 'Move down',
    dim: last,
    fn: function () {
      llmMove(p.id, i + 1);
    },
  });
  rows.push({
    label: 'Remove',
    sub: 'press OK twice',
    info: {
      t: 'Remove',
      d: 'Removes this provider and its key from the TV. Press OK twice. The ones after it move up a place; if no provider is left that can answer, AI chat switches off.',
    },
    fn: function () {
      var now = Date.now();
      if (pvRm.id !== p.id || now - pvRm.t > 5000) {
        pvRm = { id: p.id, t: now };
        banner('Press OK again to remove ' + p.name, 'err');
        return;
      }
      pvRm.id = '';
      var nx = i === 0 ? l[1] : null;
      llmSet({ remove: p.id }, nx ? nx.name + ' now answers first' : p.name + ' removed', function () {
        pop();
        if (idx >= rows.length) idx = 0;
        if (rows[idx].sep) idx = Math.max(0, idx - 1); /* the last provider went: the one above it */
        draw();
      });
    },
  });
  rows.push({ sep: true });
  rows.push({ label: 'Back', fn: pop });
}
