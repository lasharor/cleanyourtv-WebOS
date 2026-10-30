function build() {
  rows = [];
  if (view === 'share') {
    rows.push({ label: 'Close', fn: closeShare });
    return;
  }
  if (view === 'keys') {
    rows = kRows;
    return;
  }
  if (view === 'notifyhow' || view === 'voicehow') {
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'channel') {
    var cc = (st && st.channel) || '',
      db = ((tst && tst.builds) || [])[0];
    rows.push({
      label: 'Stable releases',
      sub: (cc ? '' : 'selected \u00B7 ') + 'a release a day at most',
      fn: function () {
        setChannel('');
      },
    });
    rows.push({
      label: 'Dev builds',
      sub:
        (cc ? 'selected \u00B7 ' : '') +
        (db
          ? 'every change' +
            (db.build ? ' \u00B7 build ' + db.build : '') +
            (db.published ? ' \u00B7 ' + String(db.published).slice(0, 10) : '')
          : tst && tst.error
            ? String(tst.error)
            : 'every change \u00B7 none published right now'),
      fn: function () {
        setChannel('dev');
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'models') {
    var cur = ((vo || {}).llm || {}).model;
    mdl.forEach(function (x) {
      rows.push({
        label: x.name,
        sub: x.id + (x.price != null ? ' \u00B7 $' + x.price + ' per million words in' : '') + (x.id === cur ? ' \u00B7 selected' : ''),
        fn: function () {
          pickModel(x.id);
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'agents') {
    var ca = ((vo || {}).ha || {}).agent || '';
    rows.push({
      label: 'Default agent',
      sub: 'Home Assistant\u2019s own' + (ca ? '' : ' \u00B7 selected'),
      fn: function () {
        pickAgent('');
      },
    });
    agl.forEach(function (x) {
      rows.push({
        label: x.name,
        sub: x.id + (x.id === ca ? ' \u00B7 selected' : ''),
        fn: function () {
          pickAgent(x.id);
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'voice') {
    var v = vo || {},
      wk = v.job && v.job.state === 'working';
    var vk = (st.keys && st.keys.voice) || '',
      lm = v.llm || {};
    var ha = v.ha || {},
      haOk = !!ha.configured,
      HR = { 'ha-first': 'Home Assistant first, then the AI', 'ha-only': 'Home Assistant only', 'ai-only': 'The AI only' };
    if (!v.installed) {
      rows.push({
        label: 'Install voice',
        sub: wk ? 'installing…' : 'downloads about 80 MB',
        dim: wk,
        fn: function () {
          if (wk) return;
          api('/api/voice/install', {}).then(
            function (x) {
              vo = x;
              build();
              draw();
              voiceRefresh();
            },
            function () {
              banner('The service did not answer', 'err');
            }
          );
        },
      });
    } else {
      rows.push({
        label: 'Listen on the voice button',
        sub: vk ? onoff(v.enabled) : 'learn a button first',
        dim: !vk,
        fn: function () {
          if (!vk) return;
          api('/api/voice/set', { enabled: !v.enabled })
            .then(function (x) {
              vo = x;
              return api('/api/manager/status');
            })
            .then(
              function (s2) {
                st = s2;
                build();
                draw();
              },
              function () {
                banner('The service did not answer', 'err');
              }
            );
        },
      });
      rows.push({
        label: 'Learn the voice button',
        sub: vk ? 'now: ' + vk : 'not learned',
        fn: function () {
          openKeys('voice');
        },
      });
      rows.push({
        label: 'Try it now',
        sub: v.listening ? 'listening…' : 'speak when the card appears',
        dim: v.listening,
        fn: function () {
          if (v.listening) return;
          api('/api/voice/listen', {}).then(
            function (x) {
              if (x.error) banner(x.error, 'err');
              else banner('Speak now…', 'work');
              voiceRefresh();
            },
            function () {
              banner('The service did not answer', 'err');
            }
          );
        },
      });
      rows.push({
        label: 'Switch off LG\u2019s voice assistant',
        sub: onoff(v.suppressLg) + (v.suppressLg && v.enabled && !v.lgPaused ? ' \u00B7 not paused yet' : ''),
        fn: function () {
          api('/api/voice/set', { suppressLg: !v.suppressLg }).then(
            function (x) {
              vo = x;
              build();
              draw();
            },
            function () {
              banner('The service did not answer', 'err');
            }
          );
        },
      });
    }
    rows.push({ sep: true });
    rows.push({
      label: 'Home Assistant (Assist)',
      sub: haOk
        ? ha.url.replace(/^https?:\/\//, '').replace(/\/.*/, '') + ' \u00B7 ' + HR[ha.route]
        : 'not set \u00B7 More > Home Assistant',
      fn: function () {
        if (!haOk) {
          openHa();
          return;
        }
        haTest();
      },
    });
    rows.push({
      label: 'Which answers first',
      sub: HR[ha.route || 'ha-first'],
      fn: function () {
        var o = ['ha-first', 'ha-only', 'ai-only'],
          n = o[(o.indexOf(ha.route || 'ha-first') + 1) % 3];
        api('/api/voice/set', { ha: { route: n } }).then(
          function (x) {
            if (x.error) {
              banner(x.error, 'err');
              return;
            }
            vo = x;
            build();
            draw();
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    rows.push({
      label: 'Assist agent',
      sub: haOk ? ha.agent || 'default' : 'set up Home Assistant first',
      dim: !haOk,
      fn: function () {
        if (haOk) openAgents();
      },
    });
    rows.push({
      label: 'AI chat (OpenRouter)',
      sub: lm.hasKey ? onoff(lm.enabled) + ' \u00B7 ' + lm.model : 'no key set',
      fn: function () {
        if (!lm.hasKey) {
          openPair();
          return;
        }
        api('/api/voice/set', { llm: { enabled: !lm.enabled } }).then(
          function (x) {
            if (x.error) {
              banner(x.error, 'err');
              return;
            }
            vo = x;
            build();
            draw();
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    rows.push({ label: 'Model', sub: lm.model || 'openrouter/auto', fn: openModels });
    rows.push({
      label: 'Send the text to',
      sub: v.url ? v.url.replace(/^(https?:\/\/[^\/]+).*/, '$1') : 'not set · shows a card only',
      fn: function () {
        kText =
          'Set the address of your server (from a shell on the TV):\n\ncurl -X POST localhost:8765/api/voice/set -d \'{"url":"http://server:port/path","token":"optional secret"}\'\n\nThe TV sends: POST, JSON {"text":"..."}, with "Authorization: Bearer <token>" when a token is set. If your server answers with JSON {"text":"..."} (or plain text), the answer is shown as a card. Only the recognised text is sent, never audio.';
        push('voicehow');
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Set up from your phone', sub: 'key, model, server', fn: openPair });
    rows.push({
      label: 'Set up with commands',
      sub: 'for scripts and ssh',
      fn: function () {
        kText = aiHelp();
        push('voicehow');
      },
    });
    rows.push({
      label: 'Forget the conversation',
      fn: function () {
        api('/api/voice/forget', {}).then(
          function () {
            banner('Conversation cleared', 'ok');
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    if (v.installed) {
      rows.push({ sep: true });
      rows.push({
        label: 'Remove voice',
        sub: 'deletes the ' + Math.round((v.bytes || 0) / 1048576) + ' MB download',
        fn: function () {
          api('/api/voice/uninstall', {})
            .then(function (x) {
              vo = x;
              return api('/api/manager/status');
            })
            .then(
              function (s2) {
                st = s2;
                banner('Voice removed', 'ok');
                build();
                draw();
              },
              function () {
                banner('The service did not answer', 'err');
              }
            );
        },
      });
    }
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'notifyapi') {
    rows.push({
      label: 'Accept notifications from the network',
      sub: onoff(napi && napi.enabled),
      fn: function () {
        api('/api/manager/notify-api', { enabled: !(napi && napi.enabled) }).then(
          function (n) {
            napi = n;
            api('/api/manager/status').then(function (s2) {
              st = s2;
              build();
              draw();
            });
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    if (napi && napi.enabled) {
      rows.push({
        label: 'How to send',
        sub: 'address, token, example',
        fn: function () {
          kText =
            'Send a POST request:\nhttp://' +
            napi.ip +
            ':' +
            napi.port +
            '/notify\n\nHeader:\nAuthorization: Bearer ' +
            napi.token +
            '\n\nBody (JSON):\n{"title":"Front door","text":"Someone is at the door","image":"http://…/snapshot.jpg","seconds":15}';
          push('notifyhow');
        },
      });
      rows.push({ label: 'Show as QR code', sub: 'scan with a phone to copy the address and token', fn: openNotifyQr });
      rows.push({
        label: 'New token',
        sub: 'the old one stops working',
        fn: function () {
          api('/api/manager/notify-api', { regenerate: true }).then(function (n) {
            napi = n;
            banner('New token created. Open \u201CHow to send\u201D to see it.', 'ok');
            build();
            draw();
          });
        },
      });
    }
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (offline) {
    // before the setup: a newer package first, then choose, set up, then the extras
    updIdx = 0;
    if (upd) {
      rows.push({ label: 'Update to ' + upd.updateTo, sub: 'recommended first · installed ' + upd.installed, fn: offlineUpdate });
      rows.push({ sep: true });
    }
    rows.push({
      label: 'Debloat LG’s ads and telemetry',
      sub: onoff(setup.debloat),
      fn: function () {
        setup.debloat = !setup.debloat;
        build();
        draw();
      },
    });
    rows.push({
      label: 'Take over the Input key',
      sub: onoff(setup.inputKey),
      fn: function () {
        setup.inputKey = !setup.inputKey;
        build();
        draw();
      },
    });
    rows.push({ sep: true });
    setupIdx = rows.length;
    rows.push({
      label: 'Set up now',
      sub: 'the screen blinks once',
      fn: function () {
        doSetup(false);
      },
    });
    if (forceOffer)
      rows.push({
        label: 'Set up anyway',
        sub: 'untested firmware; a failed start restarts the TV',
        fn: function () {
          doSetup(true);
        },
      });
    rows.push({ sep: true });
    rows.push({ label: 'Check for updates', sub: 'works without the service', fn: offlineCheck });
    rows.push({ label: 'Share log', sub: 'QR code for your phone', fn: openShare });
    return;
  }
  if (view === 'confirm-home' || view === 'confirm-uninstall') {
    var un = view === 'confirm-uninstall',
      on = !(st.home && st.home.enabled);
    rows.push({ label: 'Cancel', fn: pop });
    rows.push({
      label: un ? 'Yes, remove CleanYourTV' : on ? 'Yes, use CleanYourTV as Home' : 'Yes, use LG’s Home',
      sub: un ? 'settings and apps are deleted; the TV restarts' : 'the TV restarts',
      fn: function () {
        api(un ? '/api/manager/uninstall' : '/api/manager/home', un ? {} : { enabled: on }).catch(function () {});
        banner(
          un
            ? 'Removing CleanYourTV… the TV restarts in a moment and LG’s Home comes back.'
            : on
              ? 'Switching to CleanYourTV… the TV restarts in a moment.'
              : 'Switching to LG’s Home… the TV restarts in a moment.',
          'work'
        );
      },
    });
    return;
  }
  if (view === 'livetv') {
    var lo = st.options.liveTv !== false,
      l2 = lv || {},
      gk = (st.keys && st.keys.guide) || '';
    rows.push({
      label: 'Show Live TV',
      sub: onoff(lo),
      fn: function () {
        opt({ liveTv: !lo });
      },
    });
    rows.push({
      label: 'Show LG\u2019s own Live TV',
      sub: onoff(st.options.tuner !== false),
      fn: function () {
        opt({ tuner: st.options.tuner === false });
      },
    });
    rows.push({
      label: 'Playlist',
      sub: l2.configured
        ? l2.channels +
          ' channels' +
          (l2.epg ? ' \u00B7 guide for ' + l2.epg + ' programmes' : '') +
          (l2.state && l2.state !== 'idle' ? ' \u00B7 ' + l2.state : '')
        : 'not set \u00B7 set up from your phone',
      fn: openLivePair,
    });
    rows.push({
      label: 'Refresh playlist and guide',
      sub: l2.error ? String(l2.error).slice(0, 70) : '',
      dim: !l2.configured,
      fn: function () {
        if (!l2.configured) return;
        banner('Refreshing\u2026', 'work');
        api('/api/live/refresh', {}).then(
          function () {
            banner('Refreshing in the background', 'ok');
            setTimeout(liveRefresh, 3000);
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    rows.push({
      label: 'Learn the Guide key',
      sub: lo ? (gk ? 'now: ' + gk : 'not learned \u00B7 LG\u2019s guide stays') : 'Live TV is off',
      dim: !lo,
      fn: function () {
        if (lo) openKeys('guide');
      },
    });
    rows.push({ sep: true });
    rows.push({
      label: 'Clear recent channels',
      fn: function () {
        api('/api/live/state', { op: 'clear' }).then(
          function () {
            banner('Recent channels cleared', 'ok');
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    rows.push({
      label: 'Remove the playlist',
      sub: l2.configured ? '' : 'nothing to remove',
      dim: !l2.configured,
      fn: function () {
        if (l2.configured) push('confirm-live-reset');
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'confirm-live-reset') {
    rows.push({
      label: 'Yes, remove the playlist',
      sub: 'the address, the channel list, the guide and your favourites are deleted',
      fn: function () {
        api('/api/live/reset', {}).then(
          function () {
            banner('Playlist removed', 'ok');
            pop();
            liveRefresh();
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    rows.push({ label: 'No, keep it', fn: pop });
    return;
  }
  if (view === 'volumebar') {
    var curV = (st.options && st.options.volumeTheme) || 'system';
    rows.push({
      label: 'Volume bar',
      sub: 'Replaces LG\u2019s own bar; System default puts it back. Tried on webOS 5 only.',
      fn: function () {},
    });
    var themes = [
      { id: 'pill', label: tr('Pill'), sub: tr('Vertical pill on the right') },
      { id: 'capsule', label: tr('Capsule'), sub: tr('Horizontal bar at the top') },
      { id: 'dial', label: tr('Dial'), sub: tr('Circular dial on the right') },
      { id: 'system', label: tr('System default (LG webOS)'), sub: tr('Stock TV volume bar') },
    ];
    themes.forEach(function (t) {
      rows.push({
        label: t.label,
        sub: (t.id === curV ? 'selected \u00B7 ' : '') + t.sub,
        fn: function () {
          opt({ volumeTheme: t.id });
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'inputkey') {
    var hk = st.inputhook || {},
      na = hk.hook && !hk.hook.attached;
    rows.push({
      label: 'Input key opens our Inputs list',
      sub: na ? 'not available on this firmware' : onoff(st.options.inputKey),
      fn: function () {
        opt({ inputKey: !st.options.inputKey });
      },
    });
    rows.push({
      label: 'Learn the Input key',
      sub: st.keys && st.keys.inputIsDefault ? 'default (' + st.keys.input + ')' : 'learned: ' + (st.keys && st.keys.input),
      fn: function () {
        openKeys('input');
      },
    });
    var pk = st.picker || {},
      pkMode = pk.mode || 'overlay',
      PKT = {
        overlay: 'over the running app, ready in the background (instant)',
        ondemand: 'over the running app, started when pressed',
        launcher: 'the launcher\u2019s Inputs list',
      };
    rows.push({
      label: 'Input key shows',
      sub:
        (pk.released ? 'LG\u2019s own list: CleanYourTV is not the Home' : PKT[pkMode]) +
        (pk.reason && !pk.released ? ' \u00B7 ' + pk.reason : ''),
      fn: function () {
        var o = ['overlay', 'ondemand', 'launcher'];
        opt({ pickerMode: o[(o.indexOf(pkMode) + 1) % 3] });
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'home') {
    rows.push({
      label: 'Use CleanYourTV as Home',
      sub: onoff(st.home && st.home.enabled) + ' \u00B7 switching restarts the TV',
      fn: function () {
        push('confirm-home');
      },
    });
    rows.push({
      label: 'Learn the Home key',
      sub: 'optional · ' + (st.keys && st.keys.home ? 'now: ' + st.keys.home : 'not learned'),
      fn: function () {
        openKeys('home');
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'debloat') {
    DEBLOAT.forEach(function (g) {
      rows.push({
        label: g.label,
        sub: onoff(debloatOn(g.id)) + ' \u00B7 ' + g.what,
        fn: function () {
          debloatToggle(g.id);
        },
      });
    });
    rows.push({ sep: true });
    var anyOff = DEBLOAT.some(function (g) {
      return !debloatOn(g.id);
    });
    rows.push({
      label: anyOff ? 'Switch all on' : 'Switch all off',
      fn: function () {
        opt(anyOff ? { debloat: true, debloatOff: [] } : { debloat: false, debloatOff: [] });
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'experimental') {
    rows.push({
      label: 'Experimental',
      sub: 'off by default · tried on one TV · switch off to get LG\u2019s own setup back',
      fn: function () {},
    });
    rows.push({
      label: 'Volume bar',
      sub: volumeSub((st.options || {}).volumeTheme) + ' \u00B7 replaces LG\u2019s own bar',
      fn: function () {
        push('volumebar');
      },
    });
    if (zr && zr.available) {
      rows.push({
        label: 'Compressed memory',
        sub: onoff(zr.on) + ' \u00B7 keeps idle memory compressed in RAM instead of on the built-in storage',
        fn: function () {
          zramSet(zr.on ? 0 : zrSize);
        },
      });
      rows.push({
        label: 'Size',
        sub: zrSize + ' MB',
        fn: function () {
          var s = zr.sizes || [256, 512, 768, 1024];
          zrSize = s[(s.indexOf(zrSize) + 1) % s.length];
          if (zr.on) zramSet(zrSize);
          else {
            build();
            draw();
          }
        },
      });
      rows.push({
        label: 'Refresh',
        sub: (zr.on ? zr.stored + ' MB kept in ' + zr.ram + ' MB of memory \u00B7 ' : '') + 'free memory ' + zr.memAvailable + ' MB',
        fn: function () {
          zramLoad(true);
        },
      });
    } else {
      rows.push({ label: 'Compressed memory', sub: 'not available on this TV', fn: function () {} });
    }
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'language') {
    var curL = (st && st.lang) || '';
    var tvName = 'English';
    languages().forEach(function (x) {
      if (x.code === LANG_TV) tvName = x.name;
    });
    rows.push({
      label: 'Automatic',
      sub: (curL ? '' : 'selected \u00B7 ') + 'TV language: ' + tvName,
      fn: function () {
        opt({ lang: '' });
      },
    });
    languages().forEach(function (x) {
      rows.push({
        label: x.name,
        info: { t: x.name, d: x.pct + '%' },
        sub: (curL === x.code ? 'selected \u00B7 ' : '') + x.pct + '%',
        fn: function () {
          opt({ lang: x.code });
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'ha') {
    var h = (vo || {}).ha || {},
      hOk = !!h.configured;
    rows.push({
      label: 'Set up from your phone',
      sub: hOk ? h.url.replace(/^https?:\/\//, '') : 'address and access token',
      fn: openHaPair,
    });
    rows.push({
      label: 'Test the connection',
      sub: hOk ? '' : 'set up Home Assistant first',
      dim: !hOk,
      fn: function () {
        if (hOk) haTest();
      },
    });
    rows.push({ label: 'Cards', sub: 'entities and cameras on Home', fn: openCards });
    rows.push({ sep: true });
    rows.push({
      label: 'Forget Home Assistant',
      sub: hOk ? 'Voice and the cards stop using it' : 'not set up',
      dim: !hOk,
      fn: function () {
        if (hOk) push('confirm-ha-forget');
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'confirm-ha-forget') {
    rows.push({ label: 'Cancel', fn: pop });
    rows.push({
      label: 'Yes, forget Home Assistant',
      sub: 'the address and the token are removed from the TV',
      fn: function () {
        api('/api/voice/set', { ha: { clear: true } }).then(
          function (x) {
            if (x.error) {
              banner(x.error, 'err');
              return;
            }
            vo = x;
            banner('Home Assistant forgotten', 'ok');
            pop();
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    return;
  }
  if (view === 'cards') {
    var sls = (cs && cs.slots) || [];
    if (!sls.length) rows.push({ label: 'This theme has no places for cards', sub: 'Lock Screen, Bloom and Horizon have them', fn: null });
    sls.forEach(function (sl) {
      var ty = cardTypeOf(sl);
      rows.push({
        label: sl.name,
        sub: ty ? cardTypeName(ty) : 'Empty',
        fn: function () {
          cardSlot = sl;
          push('cardtype');
        },
      });
    });
    rows.push({ sep: true });
    rows.push({
      label: 'Set up from your phone',
      sub: 'names, texts, card options',
      dim: !sls.length,
      fn: sls.length ? openCardsPair : null,
    });
    rows.push({
      label: 'Home Assistant',
      sub: cs && cs.ha ? 'set up' : 'not set up',
      fn: openHa,
    });
    rows.push({ sep: true });
    rows.push({
      label: 'Back',
      fn: function () {
        /* opened from the launcher's Customise > Cards: back to Home, where the cards show what was chosen */
        if (cardsFromHome) {
          cardsFromHome = false;
          api('/api/launch', { id: 'com.webos.app.home' }).catch(function () {});
        }
        pop();
      },
    });
    return;
  }
  if (view === 'cardtype') {
    var curT = cardTypeOf(cardSlot) || 'none';
    rows.push({
      label: 'Empty',
      sub: curT === 'none' ? 'selected' : '',
      fn: function () {
        setCardType('none');
      },
    });
    ((cs && cs.types) || []).forEach(function (x) {
      rows.push({
        label: x.name,
        sub:
          (curT === x.type ? 'selected' : '') +
          (/^ha-/.test(x.type) && !cs.ha ? (curT === x.type ? ' \u00B7 ' : '') + 'needs Home Assistant' : ''),
        fn: function () {
          setCardType(x.type);
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'more') {
    rows.push({ label: 'Home Assistant', sub: st.voice && st.voice.ha ? 'set up' : 'not set up', fn: openHa });
    rows.push({
      label: 'Voice',
      sub: st.voice ? (st.voice.installed ? onoff(st.voice.enabled) : 'not installed') : '',
      fn: function () {
        api('/api/voice/status').then(
          function (v) {
            vo = v;
            push('voice');
            if ((v.job && v.job.state === 'working') || v.listening) voiceRefresh();
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    rows.push({
      label: 'Language',
      sub: (function () {
        var n = 'Automatic';
        languages().forEach(function (x) {
          if (x.code === st.lang) n = x.name;
        });
        return n;
      })(),
      fn: function () {
        push('language');
      },
    });
    rows.push({
      label: 'Network notifications',
      sub: onoff(st.notifyApi && st.notifyApi.enabled),
      fn: function () {
        api('/api/manager/notify-api').then(
          function (n) {
            napi = n;
            push('notifyapi');
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'abapps') {
    rows.push({
      label: 'Apps on the box',
      sub: 'OK moves an app to the box or back to the TV. The others stay on the TV.',
      fn: function () {},
    });
    abl.forEach(function (a) {
      rows.push({
        label: a.title || a.id,
        sub: a.on
          ? 'on the box \u00B7 ' + a.pkg
          : a.suggest
            ? 'on the TV \u00B7 ' + a.suggest + ' on the box'
            : 'on the TV \u00B7 needs its package from your phone',
        fn: function () {
          abToggle(a);
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'androidbox') {
    var a = ab || { configured: false, settings: null, key: {}, last: null },
      cfg = a.settings || {},
      lastRun = a.last;
    rows.push({
      label: 'Set up from your phone',
      sub: a.configured ? cfg.host + ' \u00B7 ' + cfg.input.replace('com.webos.app.hdmi', 'HDMI ') : 'address, HDMI input and apps',
      fn: openAbPair,
    });
    rows.push({
      label: 'Choose apps',
      sub: a.configured
        ? Object.keys(cfg.apps).length
          ? Object.keys(cfg.apps).join(', ')
          : 'none yet: the apps stay on the TV'
        : 'set it up first',
      dim: !a.configured,
      fn: function () {
        if (a.configured) openAbApps();
      },
    });
    rows.push({ sep: true });
    rows.push({
      label: 'Test the connection',
      sub: a.configured ? 'the first time, accept the question on the box' : 'set it up first',
      dim: !a.configured,
      fn: function () {
        if (a.configured) abTest();
      },
    });
    rows.push({
      label: 'Last start',
      sub: !lastRun ? 'none yet' : lastRun.ok ? lastRun.app + ' started' : lastRun.error,
      fn: null,
    });
    rows.push({
      label: 'Key of this TV',
      sub: a.key && a.key.ready ? 'ready' : 'made at the first test',
      fn: null,
    });
    if (a.configured) {
      rows.push({ sep: true });
      rows.push({ label: 'Switch off', sub: 'apps open on the TV again', fn: abOff });
    }
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'wallpapers') {
    var w = wp || { uploads: 0, immich: {}, total: 0, limits: { uploads: 100 }, bytes: 0 },
      im = w.immich || {},
      ago = function (t) {
        if (!t) return 'never';
        var m = Math.round((Date.now() - t) / 60000);
        return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
      };
    rows.push({ label: 'Manage from your phone', sub: 'upload photos, configure Immich', fn: openWallPair });
    rows.push({ sep: true });
    rows.push({ label: 'Local uploads', sub: w.uploads + ' photos', fn: openWallPair });
    rows.push({
      label: 'Immich',
      sub: !im.configured
        ? 'not connected \u00B7 set up from your phone'
        : im.state === 'syncing'
          ? 'syncing\u2026 ' + (im.done || 0) + ' new'
          : im.photos + ' photos \u00B7 synced ' + ago(im.lastSync) + (im.error ? ' \u00B7 ' + im.error : ''),
      fn: openWallPair,
    });
    rows.push({
      label: 'Total',
      sub: w.total + ' photos \u00B7 ' + Math.round(w.bytes / 1048576) + ' of 150 MB',
      fn: null,
    });
    rows.push({ sep: true });
    rows.push({
      label: 'Sync now',
      sub: im.configured ? (im.state === 'syncing' ? 'syncing\u2026' : 'Immich: new and changed photos') : 'connect Immich first',
      dim: !im.configured || im.state === 'syncing',
      fn: function () {
        if (im.configured && im.state !== 'syncing') wallCall('/api/wallpapers/sync', {}, 'Syncing with Immich\u2026');
      },
    });
    rows.push({
      label: 'Picture size',
      sub: w.size === 'hd' ? 'Full HD (1920 px)' : '4K (3840 px)',
      fn: function () {
        wallCall('/api/wallpapers/set', { size: w.size === 'hd' ? '4k' : 'hd' });
      },
    });
    rows.push({ sep: true });
    rows.push({
      label: 'Remove all uploads',
      sub: w.uploads ? '' : 'nothing to remove',
      dim: !w.uploads,
      fn: function () {
        if (w.uploads) push('confirm-wp-uploads');
      },
    });
    rows.push({
      label: 'Disconnect Immich',
      sub: im.configured ? '' : 'not connected',
      dim: !im.configured,
      fn: function () {
        if (im.configured) push('confirm-wp-immich');
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'confirm-wp-uploads' || view === 'confirm-wp-immich') {
    var upl = view === 'confirm-wp-uploads';
    rows.push({ label: 'Cancel', fn: pop });
    rows.push({
      label: upl ? 'Yes, remove all uploads' : 'Yes, disconnect Immich',
      sub: upl ? 'the uploaded photos are deleted from the TV' : 'the key is forgotten and its photos are deleted from the TV',
      fn: function () {
        wallCall(
          upl ? '/api/wallpapers/remove-uploads' : '/api/wallpapers/disconnect',
          {},
          upl ? 'Uploads removed' : 'Immich disconnected'
        );
      },
    });
    return;
  }
  if (view === 'confirm-reset') {
    rows.push({ label: 'Cancel', fn: pop });
    rows.push({
      label: 'Yes, reset Home',
      sub: 'dock, top buttons, hidden apps, app order and clock go back to the defaults',
      fn: function () {
        api('/api/config', {}).then(
          function () {
            pop();
            banner('Home is back to the defaults. Open Home to see it.', 'ok');
          },
          function () {
            banner('The service did not answer', 'err');
          }
        );
      },
    });
    return;
  }
  var fe = st.frontend,
    sv = st.service,
    busy = st.job && st.job.state === 'working';
  var uptxt = function (u) {
    return u
      ? 'Update to ' + u + (st.channel ? ' (dev build)' : '')
      : st.checking
        ? 'Checking…'
        : st.checkError
          ? /no release/.test(st.checkError)
            ? 'No release yet'
            : 'Cannot check'
          : 'Up to date';
  };
  // updates, then the settings, then support; the destructive row last
  rows.push({
    label: 'Launcher ' + fe.version,
    sub: uptxt(fe.updateTo),
    dim: busy,
    fn: fe.updateTo
      ? function () {
          run('/api/manager/update-frontend', { version: fe.updateTo });
        }
      : null,
  });
  rows.push({
    label: 'Service ' + sv.version,
    sub: uptxt(sv.updateTo),
    dim: busy,
    fn: sv.updateTo
      ? function () {
          run('/api/manager/update-service', { version: sv.updateTo });
        }
      : null,
  });
  rows.push({
    label: 'Check for updates',
    dim: busy,
    fn: function () {
      banner('Checking…', 'work');
      api('/api/manager/check', {}).then(refreshDone, refreshDone);
    },
  });
  rows.push({
    label: 'Update channel',
    sub: st.channel ? 'Dev builds' : 'Stable releases',
    dim: busy,
    fn: openChannel,
  });
  if (fe.previous)
    rows.push({
      label: 'Go back to launcher ' + fe.previous,
      dim: busy,
      fn: function () {
        run('/api/manager/rollback-frontend', {});
      },
    });
  rows.push({ sep: true });
  rows.push({
    label: 'CleanYourTV as Home',
    sub: onoff(st.home && st.home.enabled),
    fn: function () {
      push('home');
    },
  });
  rows.push({ label: 'Live TV', sub: onoff(st.options.liveTv !== false), fn: openLiveTv });
  rows.push({
    label: 'Wallpapers',
    sub: st.wallpapers ? st.wallpapers.total + ' photos' : '',
    fn: openWallpapers,
  });
  rows.push({
    label: 'App icons',
    sub: 'your own picture for an app',
    fn: function () {
      openIconPair('');
    },
  });
  rows.push({ label: 'Cards', sub: 'small widgets on Home', fn: openCards });
  rows.push({
    label: 'Android box',
    sub: ab && ab.configured ? ab.settings.host : ab ? 'off' : '',
    fn: openAndroidBox,
  });
  rows.push({
    label: 'Input key',
    sub: st.inputhook && st.inputhook.hook && !st.inputhook.hook.attached ? 'not available' : onoff(st.options.inputKey),
    fn: function () {
      push('inputkey');
    },
  });
  rows.push({
    label: 'Debloat',
    sub: (function () {
      var n = DEBLOAT.filter(function (g) {
        return debloatOn(g.id);
      }).length;
      return n === DEBLOAT.length ? onoff(true) : n ? n + ' of ' + DEBLOAT.length + ' on' : onoff(false);
    })(),
    fn: function () {
      push('debloat');
    },
  });
  rows.push({ label: 'Experimental', sub: 'compressed memory, volume bar', fn: zramLoad });
  rows.push({
    label: 'More',
    sub: 'Home Assistant, voice, language, network notifications',
    fn: function () {
      push('more');
    },
  });
  rows.push({ sep: true });
  rows.push({ label: 'Share log', sub: 'QR code for your phone', fn: openShare });
  rows.push({
    label: 'Reset Home customisation',
    fn: function () {
      push('confirm-reset');
    },
  });
  rows.push({
    label: 'Uninstall',
    fn: function () {
      push('confirm-uninstall');
    },
  });
}

/* the debloat's four groups (scripts/debloat-stop.sh); options.debloatOff lists the ones switched off */
var DEBLOAT = [
  { id: 'ads', label: 'Ads', what: 'ad services and ad servers' },
  { id: 'tracking', label: 'Viewing tracking (LivePlus)', what: 'acr2' },
  { id: 'logs', label: 'Telemetry logs', what: 'remotelogger, service-logger' },
  { id: 'suggestions', label: 'Suggestions and nudges', what: 'contentminer, nudge, sportsalarm' },
];
/* Experimental: compressed memory (zram, helper/zram.js). The service answers with what the TV has now. */
var zr = null,
  zrSize = 512;
function zramLoad(stay) {
  api('/api/zram').then(
    function (r) {
      zr = r;
      zrSize = r.size || r.setting || zrSize;
      if (stay === true) {
        build();
        draw();
      } else push('experimental');
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function zramSet(size) {
  banner('Applying\u2026', 'work');
  api('/api/zram', { size: size }, 130000).then(
    function (r) {
      zr = r;
      zrSize = r.size || r.setting || zrSize;
      banner(r.error || '', r.error ? 'err' : '');
      build();
      draw();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function debloatOn(id) {
  var o = st.options || {};
  return o.debloat !== false && (o.debloatOff || []).indexOf(id) < 0;
}
/* switching the last group off switches the debloat off; one group on while it is off switches it on with only that group */
function debloatToggle(id) {
  var o = st.options || {},
    off = (o.debloatOff || []).slice();
  if (debloatOn(id)) {
    off.push(id);
    return opt(off.length >= DEBLOAT.length ? { debloat: false, debloatOff: [] } : { debloatOff: off });
  }
  if (o.debloat === false)
    return opt({
      debloat: true,
      debloatOff: DEBLOAT.map(function (g) {
        return g.id;
      }).filter(function (g) {
        return g !== id;
      }),
    });
  opt({
    debloatOff: off.filter(function (g) {
      return g !== id;
    }),
  });
}

function volumeSub(theme) {
  if (theme === 'system') return tr('System default (LG webOS)');
  if (theme === 'capsule') return tr('Capsule');
  if (theme === 'dial') return tr('Dial');
  if (theme === 'pill') return tr('Pill');
  return tr('System default (LG webOS)');
}
