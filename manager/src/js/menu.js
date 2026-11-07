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
  if (view.indexOf('remap') === 0) {
    rmRows();
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
    var cur = (llmFind(pvId) || {}).model;
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
  if (view === 'providers') {
    provRows();
    return;
  }
  if (view === 'provider') {
    provOneRows();
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
    if (!v.installed && v.unsupported) {
      /* a 32-bit kernel cannot start the 64-bit recogniser: nothing is offered to download */
      rows.push({
        label: 'Voice is not available on this TV',
        sub: 'its kernel is 32-bit',
        info: { t: 'Voice is not available on this TV', d: v.unsupported },
        dim: true,
        fn: function () {},
      });
    } else if (!v.installed) {
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
    var lps = lm.providers || [],
      chain = llmChain(lps);
    rows.push({
      label: 'AI chat',
      sub: chain ? onoff(lm.enabled) + ' \u00B7 ' + chain : 'not set up',
      fn: function () {
        if (!lps.length) {
          openPair();
          return;
        }
        if (!chain) {
          push('providers');
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
    var lastP = llmFind(lm.lastVia);
    rows.push({
      label: 'AI providers',
      sub: lps.length ? lps.length + ' set up' + (lastP ? ' \u00B7 ' + lastP.name + ' answered last' : '') : 'none',
      fn: function () {
        push('providers');
      },
    });
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
    rows.push({
      label: 'Set up from your phone',
      sub: 'providers, keys, models',
      info: {
        t: 'Set up from your phone',
        d: 'Shows a QR code. On a phone on the same Wi-Fi, add OpenRouter or a server of yours, set their keys, models and order, and write instructions. Nothing is typed on the TV.',
      },
      fn: openPair,
    });
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
  if (view === 'addonrepos') {
    ad.repos.forEach(function (x) {
      rows.push({
        label: x.name,
        sub: x.url + (x.official ? ' · the project’s own' : ''),
        fn: function () {
          ad.repoSel = x.name;
          push('addonrepo');
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Add from your phone', sub: 'user/repo, or the address of a folder with an index.json', fn: openRepoDialog });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'addonrepo') {
    var rp = repoSel() || {};
    rows.push({ label: rp.name || '', sub: rp.url || '', fn: function () {} });
    if (rp.official)
      rows.push({ label: 'The project’s own repository always stays', sub: 'it cannot be removed', dim: true, fn: function () {} });
    else
      rows.push({
        label: 'Remove this repository',
        sub: 'what you installed from it stays installed',
        fn: function () {
          addonDo('/api/addons/repos', { remove: rp.name }, rp.name + ' removed');
        },
      });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  /* before anything from another repository: what it means, then Cancel (the default) or the deliberate button that says what it does */
  if (view === 'confirm-addon' || view === 'confirm-repo') {
    var pe = ad.pend || {},
      isRepo = view === 'confirm-repo',
      warn = trustAbout(isRepo ? [] : pe.items),
      wl = 'Code from outside the project';
    rows.push({ label: 'Cancel', about: warn, ablabel: wl, fn: pop });
    rows.push({
      label: isRepo
        ? 'Add a repository, from my phone'
        : pe.all
          ? 'Update code from other repositories'
          : 'Install code from ' + (pe.repo || ''),
      sub: isRepo ? '' : pe.all ? '' : pe.name,
      about: warn,
      ablabel: wl,
      fn: function () {
        pop();
        if (isRepo) openRepoPair();
        else if (pe.all) addonDo('/api/addons/update', { confirm: true }, 'Add-ons updated');
        else addonDo('/api/addons/install', { id: pe.id, repo: pe.repo, confirm: true }, pe.name + ' installed');
      },
    });
    return;
  }
  if (view === 'addon') {
    var a1 = addonSel() || {};
    rows.push({
      label: a1.name || '',
      pv: a1.preview ? a1.id : '',
      about: a1.about || a1.description,
      sub: (a1.description || '') + (a1.error ? ' \u00B7 ' + a1.error : ''),
      fn: function () {},
    });
    if (a1.bookable && a1.enabled && a1.status === 'running')
      rows.push({
        label: 'Open page',
        sub: a1.inBook ? 'shows it now · Back returns to Home' : 'not in the book · shows it now · Back returns to Home',
        fn: function () {
          /* Home turns to the page ({page: id}, app/src/js/input.js), also when it is out of the book */
          api('/api/launch', { id: 'com.webos.app.home', params: { page: a1.id } }).catch(function () {});
        },
      });
    if (a1.bookable) {
      var bp = bookPages().filter(function (p) {
          return p.inBook;
        }),
        bi = bp
          .map(function (p) {
            return p.id;
          })
          .indexOf(a1.id);
      rows.push({
        label: 'Page of the book',
        sub: onoff(a1.inBook) + (a1.inBook && bi >= 0 ? ' \u00B7 page ' + (bi + 2) : '') + ' \u00B7 Home is page 1',
        fn: function () {
          bookShow(a1.id, !a1.inBook);
        },
      });
      if (a1.inBook) {
        rows.push({
          label: 'Move earlier',
          dim: bi <= 0,
          fn: function () {
            bookMove(a1.id, -1);
          },
        });
        rows.push({
          label: 'Move later',
          dim: bi < 0 || bi >= bp.length - 1,
          fn: function () {
            bookMove(a1.id, 1);
          },
        });
      }
    }
    if ((a1.permissions || []).indexOf('key.guide') >= 0)
      rows.push({
        label: 'Learn the Guide key',
        sub: st.keys && st.keys.guide ? 'now: ' + st.keys.guide : 'not learned \u00B7 LG\u2019s guide stays',
        fn: function () {
          openKeys('guide');
        },
      });
    if (a1.settings)
      rows.push({
        label: 'Set up from your phone',
        fn: function () {
          openAddonPair(a1.id, a1.name);
        },
      });
    rows.push({
      label: a1.enabled ? 'Switch off' : 'Switch on',
      sub: a1.enabled ? 'on' : 'off',
      fn: function () {
        addonDo('/api/addons/' + a1.id + '/enable', { enabled: !a1.enabled }, a1.name + (a1.enabled ? ' off' : ' on'));
      },
    });
    if (!a1.bundled)
      rows.push({
        label: 'Remove',
        sub: 'deletes the add-on, keeps its data',
        fn: function () {
          addonDo('/api/addons/remove', { id: a1.id }, a1.name + ' removed');
        },
      });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
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
      sub: gk ? 'now: ' + gk : 'not learned \u00B7 LG\u2019s guide stays',
      fn: function () {
        openKeys('guide');
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
  if (view === 'preload') {
    rows.push({
      label: 'Preloaded apps',
      sub: 'LG starts these in the background so they open faster, and checks again every 5 minutes · off frees memory · set again at every boot',
      fn: function () {},
    });
    if (!preSet || !preSet.available)
      rows.push({ label: 'Not available', sub: (preSet && preSet.error) || 'this TV has no preload manager', fn: function () {} });
    else
      preSet.apps.forEach(function (a) {
        var fixed = preloadFixed(a);
        rows.push({
          label: preloadName(a.id),
          sub: fixed
            ? fixed
            : preloadState(a) +
              (a.enabled ? ' · ' + a.type : '') +
              ' · ' +
              a.memory +
              ' MB free needed' +
              (a.saved ? ' · changed by you' : ''),
          fn: function () {
            if (fixed) return banner(fixed, 'err');
            preApp = a.id;
            push('preloadapp');
          },
        });
      });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'preloadapp') {
    var pa = preloadApp(preApp);
    if (!pa) {
      pop();
      return;
    }
    /* only the modes this TV itself uses for some app (now, or when it started) and this app's own: criu or full are not offered where
       LG uses neither, since the row steps through them one by one and a TV without that kernel support could be left with a mode it cannot run */
    var seen = {};
    (preSet.apps || []).forEach(function (x) {
      seen[x.mode] = true;
      if (x.base) seen[x.base.mode] = true;
    });
    seen[pa.mode] = true;
    var states = ['off'].concat(
      preSet.modes.filter(function (m) {
        return seen[m];
      })
    );
    rows.push({
      label: preloadName(pa.id),
      sub: pa.id + ' · LG preloads it only while ' + pa.memory + ' MB of memory is free (LG’s own figure)',
      fn: function () {},
    });
    rows.push({
      label: 'State',
      sub:
        preloadState(pa) +
        ' · off: never preloaded · partial < semi-full < full: more of the app is started · criu: restored from a snapshot',
      fn: function () {
        var to = states[(states.indexOf(preloadState(pa)) + 1) % states.length];
        preloadSet(pa.id, to === 'off' ? { enabled: false } : { enabled: true, mode: to });
      },
    });
    rows.push({
      label: 'How often',
      sub: pa.type + ' · periodic: again at every check · oneshot: once',
      fn: function () {
        preloadSet(pa.id, { type: preSet.types[(preSet.types.indexOf(pa.type) + 1) % preSet.types.length] });
      },
    });
    rows.push({
      label: 'Back to the TV’s own',
      sub: pa.base ? (pa.base.enabled ? pa.base.mode : 'off') + ' · ' + pa.base.type + ' (as it was when the TV started)' : 'not known',
      fn: function () {
        if (pa.base) preloadSet(pa.id, { reset: true });
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'cardsidledim') {
    var dimEnabled = st.options.cardsIdleDim !== false;
    var dimMinutes = st.options.cardsIdleMinutes || 3;
    rows.push({
      label: 'Dim inactive cards',
      sub: onoff(dimEnabled),
      fn: function () {
        opt({ cardsIdleDim: !dimEnabled });
      },
    });
    if (dimEnabled) {
      [tr('3 minutes'), tr('5 minutes'), tr('10 minutes')].forEach(function (label, index) {
        var minutes = [3, 5, 10][index];
        rows.push({
          label: label,
          sub: minutes === dimMinutes ? 'selected' : '',
          fn: function () {
            opt({ cardsIdleMinutes: minutes });
          },
        });
      });
    }
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
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
      na = hk.hook && !hk.hook.attached,
      blind = hk.hook && hk.hook.blind;
    rows.push({
      label: 'Input key opens our Inputs list',
      sub: na ? 'not available on this firmware' : blind ? 'no button reaches the hook on this TV' : onoff(st.options.inputKey),
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
    rows.push({
      label: 'Learn the Guide key',
      sub: st.keys && st.keys.guide ? 'now: ' + st.keys.guide : 'not learned \u00B7 LG\u2019s guide stays',
      fn: function () {
        openKeys('guide');
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
      sub: 'for the pages of the book \u00B7 ' + (st.keys && st.keys.home ? 'now: ' + st.keys.home : 'now: 773 (the usual code)'),
      fn: function () {
        openKeys('home');
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
    rows.push({
      label: 'Preloaded apps',
      sub: 'choose which apps LG starts in the background, and how much',
      fn: preloadLoad,
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
    if (tm && tm.available) {
      rows.push({
        label: 'Weekly trim',
        sub: onoff(tm.on) + ' \u00B7 tells the built-in storage which blocks are free \u00B7 ' + trimLast(tm),
        fn: function () {
          trimSet(!tm.on);
        },
      });
      rows.push({
        label: 'Trim now',
        sub: tm.running ? 'running\u2026' : 'takes a few seconds',
        fn: trimNow,
      });
    } else {
      rows.push({ label: 'Weekly trim', sub: 'not available on this TV', fn: function () {} });
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
    rows.push({ label: 'Get more cards', sub: 'download from the catalog', fn: openCardCatalog });
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
  if (view === 'cardcat') {
    cardCat.cards.forEach(function (c) {
      rows.push({
        label: c.name,
        pvu: c.preview ? '/api/cards/preview/' + c.id : '',
        about: c.about || c.description,
        sub: c.needs
          ? 'needs service ' + c.needs
          : c.update
            ? 'Update to ' + c.version
            : c.installed
              ? 'installed \u00B7 ' + c.installed
              : 'Install \u00B7 ' + c.version,
        dim: !!c.needs,
        fn: function () {
          cardCat.sel = c.id;
          if (c.needs) banner('Update the service first: this card needs service ' + c.needs, 'err');
          else if (c.installed && !c.update) push('cardone');
          else cardDo('/api/cards/install', c.id, c.name + (c.update ? ' updated' : ' installed'));
        },
      });
    });
    if (!cardCat.cards.length && !cardCat.error) rows.push({ label: 'The catalog has no cards yet', dim: true, fn: function () {} });
    if (cardCat.error) rows.push({ label: 'The catalog could not be read', sub: cardCat.error, dim: true, fn: function () {} });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'cardone') {
    var c1 = cardSel() || {};
    rows.push({
      label: c1.name || '',
      pvu: c1.preview ? '/api/cards/preview/' + c1.id : '',
      about: c1.about || c1.description,
      sub: 'installed \u00B7 ' + (c1.installed || ''),
      fn: function () {},
    });
    rows.push({
      label: 'Remove',
      sub: 'a place that used it shows the theme\u2019s own card again',
      fn: function () {
        cardDo('/api/cards/remove', c1.id, c1.name + ' removed');
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
    return;
  }
  if (view === 'cardtype') {
    var curT = cardTypeOf(cardSlot) || 'none';
    rows.push({
      label: 'Empty',
      about: 'Leave this place empty.',
      sub: curT === 'none' ? 'selected' : '',
      fn: function () {
        setCardType('none');
      },
    });
    ((cs && cs.types) || []).forEach(function (x) {
      rows.push({
        label: x.name,
        about: x.about,
        pvu: x.preview ? '/api/cards/preview/' + x.preview : '',
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
    var w = wp || { uploads: 0, total: 0, limits: { uploads: 100 }, bytes: 0 },
      old = w.legacyImmich;
    rows.push({ label: 'Manage from your phone', sub: 'upload photos', fn: openWallPair });
    rows.push({ sep: true });
    rows.push({ label: 'Local uploads', sub: w.uploads + ' photos', fn: openWallPair });
    /* photo sources are add-ons (Immich, Unsplash, ...): one row each, with its own settings page on the phone */
    (w.sources || []).forEach(function (s) {
      rows.push({
        label: s.label,
        sub: (s.error || s.summary || s.photos + ' photos') + (s.live ? ' \u00B7 a new photo now and then' : ''),
        fn: s.settings
          ? function () {
              openSourcePair(s.id, s.label);
            }
          : null,
      });
    });
    /* a TV that used Immich before it became an add-on keeps that until the add-on is installed */
    if (old)
      rows.push({
        label: 'Immich is an add-on now',
        sub: 'install it in Add-ons to keep your Immich photos and settings',
        fn: function () {
          /* the Add-ons tab of the main list */
          while (view !== 'main' && idxStack.length) pop();
          for (var i = 0; i < TABS.length; i++) if (TABS[i].id === 'addons') setTab(i);
        },
      });
    rows.push({
      label: 'Total',
      sub: w.total + ' photos \u00B7 ' + Math.round(w.bytes / 1048576) + ' of 150 MB',
      fn: null,
    });
    rows.push({ sep: true });
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
    if (old)
      rows.push({
        label: 'Remove old Immich data',
        sub: old.photos + ' photos and the saved key',
        fn: function () {
          push('confirm-wp-immich');
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
      label: upl ? 'Yes, remove all uploads' : 'Yes, remove the old Immich data',
      sub: upl
        ? 'the uploaded photos are deleted from the TV'
        : 'the saved key is forgotten and the old Immich photos are deleted from the TV',
      fn: function () {
        wallCall(
          upl ? '/api/wallpapers/remove-uploads' : '/api/wallpapers/disconnect',
          {},
          upl ? 'Uploads removed' : 'Old Immich data removed'
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
  // the tabs: what each holds is in TABS (core.js); Left and Right turn to the next, the list below is that tab's options
  var tb = TABS[tab] ? TABS[tab].id : 'updates';
  if (tb === 'updates') {
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
    rows.push({
      label: 'Input key',
      sub:
        st.inputhook && st.inputhook.hook && (!st.inputhook.hook.attached || st.inputhook.hook.blind)
          ? 'not available'
          : onoff(st.options.inputKey),
      fn: function () {
        push('inputkey');
      },
    });
    rows.push({ label: 'Key remapping', sub: 'a button opens an app or input', fn: openRemap });
    rows.push({ sep: true });
    rows.push({ label: 'Share log', sub: 'QR code for your phone', fn: openShare });
  } else if (tb === 'features') {
    rows.push({ label: 'Live TV', sub: onoff(st.options.liveTv !== false), fn: openLiveTv });
    rows.push({
      label: 'Wallpapers',
      sub: st.wallpapers ? st.wallpapers.total + ' photos' : '',
      fn: openWallpapers,
    });
    if (st.icons)
      rows.push({
        label: 'App icons',
        sub: 'your own picture for an app',
        fn: function () {
          openIconPair('');
        },
      });
    rows.push({ label: 'Cards', sub: 'small widgets on Home', fn: openCards });
    rows.push({
      label: 'Dim inactive cards',
      sub: onoff(st.options.cardsIdleDim !== false),
      fn: function () {
        push('cardsidledim');
      },
    });
    rows.push({
      label: 'Android box',
      sub: ab && ab.configured ? ab.settings.host : ab ? 'off' : '',
      fn: openAndroidBox,
    });
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
  } else if (tb === 'addons') {
    addonRows();
  } else if (tb === 'debloat') {
    debloatRows();
  } else {
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
    rows.push({ label: 'Experimental', sub: 'compressed memory, volume bar', fn: zramLoad });
    rows.push({ sep: true });
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
}

/* an entry of a service older than the repositories has no `official`: everything it lists is the project's */
function isOfficial(e) {
  return e.official !== false;
}
/* the warning before code from another repository is installed or a repository is added, with what each add-on may do */
function trustAbout(items) {
  var out = [
    tr('The code of an add-on runs as root on the TV and can read and change anything on it and on your network.'),
    tr('The checksum only shows that a file is the one the repository published. It does not show that its author is trustworthy.'),
    tr('Only continue for people and projects you trust. The CleanYourTV project has not reviewed these add-ons.'),
    tr('Every repository is contacted whenever the add-ons list or a picture is opened, so its operator sees the TV’s address.'),
  ];
  (items || []).forEach(function (x) {
    var can = (x.can || []).map(function (c) {
      return tr(c);
    });
    out.push(x.name + ' ' + x.version + ' (' + x.repo + ') ' + tr('may') + ': ' + can.join(', ') + '.');
  });
  return out.join('\n\n');
}
function addonRows() {
  if (ad.paused)
    rows.push({
      label: 'Add-ons are paused',
      sub: 'the file DISABLE-ADDONS is present; remove it and restart',
      dim: true,
      fn: function () {},
    });
  ad.installed.forEach(function (a) {
    rows.push({
      label: a.name,
      pv: a.preview ? a.id : '',
      about: a.about || a.description,
      sub:
        (a.status === 'running' ? 'on' : a.status === 'off' ? 'off' : a.status === 'failed' ? 'failed' : a.status) +
        (a.version ? ' \u00B7 ' + a.version : '') +
        (a.bundled ? ' \u00B7 ships with CleanYourTV' : ''),
      fn: function () {
        ad.sel = a.id;
        push('addon');
      },
    });
  });
  var offer = ad.catalog.filter(function (e) {
    return !e.installed || e.update;
  });
  if (offer.length) rows.push({ sep: true });
  offer.forEach(function (e) {
    rows.push({
      label: e.name,
      pv: e.preview ? e.id : '',
      pvu: e.preview && !isOfficial(e) ? '/api/addons/preview/' + e.id + '?repo=' + e.repo : '',
      about: e.about || e.description,
      sub: (e.update ? 'Update to ' : 'Install \u00B7 ') + e.version + (isOfficial(e) ? '' : ' \u00B7 from ' + e.repo),
      fn: function () {
        if (isOfficial(e)) return addonDo('/api/addons/install', { id: e.id, repo: e.repo }, e.name + ' installed');
        ad.pend = { id: e.id, repo: e.repo, name: e.name, items: [e] };
        push('confirm-addon');
      },
    });
  });
  if (
    ad.reposOk &&
    ad.catalog.some(function (e) {
      return e.update;
    })
  )
    rows.push({
      label: 'Update all add-ons',
      sub: 'each from the repository it was installed from',
      fn: function () {
        var other = ad.catalog.filter(function (e) {
          return e.update && !isOfficial(e);
        });
        if (!other.length) return addonDo('/api/addons/update', {}, 'Add-ons updated');
        ad.pend = { all: true, items: other };
        push('confirm-addon');
      },
    });
  if (ad.reposOk) {
    rows.push({ sep: true });
    rows.push({
      label: 'Repositories',
      sub: ad.repos.length + (ad.repos.length === 1 ? ' source of add-ons' : ' sources of add-ons') + ' \u00B7 add your own',
      fn: function () {
        push('addonrepos');
      },
    });
  }
  if (bookPages().length) {
    rows.push({ sep: true });
    rows.push({
      label: 'Page strip position',
      sub: stripPosLabel(ad.book.position) + ' \u00B7 the theme sets its look and the default place',
      fn: function () {
        var i = STRIP_POS.indexOf(ad.book.position || '');
        bookSet({ position: STRIP_POS[(i + 1) % STRIP_POS.length] }, 'Saved');
      },
    });
    rows.push({
      label: 'Page strip on Home',
      sub: onoff(ad.book.strip !== false) + ' \u00B7 shows which button turns to which page',
      fn: function () {
        bookSet({ strip: ad.book.strip === false }, 'Saved');
      },
    });
  }
  if (ad.error) rows.push({ label: 'The catalog could not be read', sub: ad.error, dim: true, fn: function () {} });
}

function debloatRows() {
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
}

/* the debloat's four groups (scripts/debloat-stop.sh); options.debloatOff lists the ones switched off */
var DEBLOAT = [
  { id: 'ads', label: 'Ads', what: 'ad services and ad servers' },
  { id: 'tracking', label: 'Viewing tracking (LivePlus)', what: 'acr2' },
  { id: 'logs', label: 'Telemetry logs', what: 'remotelogger, service-logger' },
  { id: 'suggestions', label: 'Suggestions and nudges', what: 'contentminer, nudge, sportsalarm' },
];
/* Experimental: preloaded apps (helper/preload.js). The TV's policy per app: off, or how much of it is started (mode), and how often (type). */
var preSet = null,
  preApp = '';
var PRELOAD_NAMES = {
  'youtube.leanback.v4': 'YouTube',
  netflix: 'Netflix',
  amazon: 'Prime Video',
  'com.webos.app.browser': 'Web Browser',
  'com.webos.app.home': 'Home',
  'com.webos.app.fullhome': 'Home (full)',
  'com.webos.app.livetv': 'Live TV',
  'com.webos.app.livemenu': 'Live menu',
  'com.webos.app.voice': 'Voice',
  'com.webos.app.hdmi1': 'HDMI 1',
  'com.webos.app.hdmi2': 'HDMI 2',
  'com.webos.app.hdmi3': 'HDMI 3',
  'com.webos.app.hdmi4': 'HDMI 4',
  'google.assistant': 'Google Assistant',
  airplay: 'AirPlay',
};
function preloadName(id) {
  return PRELOAD_NAMES[id] || id;
}
function preloadApp(id) {
  var l = (preSet && preSet.apps) || [];
  for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
  return null;
}
/* the state of an app: "off", or its mode */
function preloadState(a) {
  return a.enabled ? a.mode : 'off';
}
function preloadFixed(a) {
  return !a.allowed ? 'LG does not preload it on this TV' : a.managed ? 'LG manages it' : '';
}
function preloadLoad(stay) {
  api('/api/preload').then(
    function (r) {
      preSet = r;
      if (stay === true) {
        build();
        draw();
      } else push('preload');
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function preloadSet(id, change) {
  var body = { id: id };
  for (var k in change) body[k] = change[k];
  api('/api/preload', body, 20000).then(
    function (r) {
      preSet = r;
      if (r.error) banner(r.error, 'err');
      build();
      draw();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* Experimental: compressed memory (zram, helper/zram.js). The service answers with what the TV has now. */
var zr = null,
  zrSize = 512,
  tm = null; /* the weekly trim (helper/fstrim.js) */
function zramLoad(stay) {
  api('/api/zram').then(
    function (r) {
      zr = r;
      zrSize = r.size || r.setting || zrSize;
      api('/api/trim').then(
        function (t) {
          tm = t;
          if (stay === true) {
            build();
            draw();
          } else push('experimental');
        },
        function () {
          tm = null;
          if (stay === true) {
            build();
            draw();
          } else push('experimental');
        }
      );
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* "last 2 Nov, 470 MB" or "not run yet" */
function trimLast(t) {
  var l = t && t.last;
  if (!l) return 'not run yet';
  var mb = 0;
  (l.mounts || []).forEach(function (m) {
    mb += m.bytes || 0;
  });
  return 'last ' + new Date(l.at).toLocaleDateString() + ', ' + Math.round(mb / 1048576) + ' MB' + (l.ok ? '' : ' (failed)');
}
function trimSet(on) {
  api('/api/trim', { on: on }).then(
    function (r) {
      if (r.error) return banner(r.error, 'err');
      tm = r;
      banner(on ? 'Weekly trim on: the first one runs a few minutes after the next start of the service' : 'Weekly trim off', 'ok');
      build();
      draw();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function trimNow() {
  banner('Trimming\u2026', 'work');
  api('/api/trim', { now: true }, 200000).then(
    function (r) {
      if (r.error) return banner(r.error, 'err');
      tm = r;
      var mb = 0;
      ((r.result && r.result.mounts) || []).forEach(function (m) {
        mb += m.bytes || 0;
      });
      banner(
        r.result && r.result.ok ? 'Trimmed ' + Math.round(mb / 1048576) + ' MB' : 'The trim failed on a partition: see Share log',
        r.result && r.result.ok ? 'ok' : 'err'
      );
      build();
      draw();
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
