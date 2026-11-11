/* Key remapping: a remote button (the Netflix or Prime key, a colour key, ...) opens an app, an input, Live TV, Home or the Inputs list, changes the volume,
   turns the screen or the TV off, opens the TV's settings, or does nothing. A button has an "Everywhere" action and, if you like, another action
   "Only in <app>" for each app that can be in front.
   The button's code is learned from the TV, never assumed (helper/remap.js). */
var rm = null,
  rmCode = '',
  rmKey = '' /* LG's name of the button just learned, KEY_AMAZON */,
  rmBtn = '' /* the same as text, "Prime Video" */,
  rmList = [],
  rmApp = '' /* the app the action being chosen is for; '' is Everywhere */,
  rmAppName = '';
/* "Prime Video button", or "Button 1038" when the name is not known */
function rmButton(code, e) {
  var n = e ? e.name : code === rmCode ? rmBtn : '';
  return n ? n + ' button' : 'Button ' + code;
}
/* the actions with fixed calls: the name in the list, and a note where it turns the TV off or changes the sound */
var RM_EXTRA = {
  mute: ['Mutes or unmutes', 'Mute', ''],
  volume_up: ['Turns the volume up', 'Volume up', ''],
  volume_down: ['Turns the volume down', 'Volume down', ''],
  screen_off: ['Turns the screen off', 'Turn the screen off', 'the TV keeps running'],
  standby: ['Puts the TV in standby', 'Put the TV in standby', 'turns the TV off'],
  settings: ['Opens the TV\u2019s settings', 'Open the TV\u2019s settings', ''],
};
function rmDescribe(e) {
  if (e.type === 'app') return 'Opens ' + (e.label || e.id);
  if (e.type === 'input') return 'Switches to ' + (e.label || e.id);
  if (e.type === 'live') return 'Opens Live TV';
  if (e.type === 'home') return 'Goes to Home';
  if (e.type === 'none') return 'Does nothing';
  if (RM_EXTRA[e.type]) return RM_EXTRA[e.type][0];
  return 'Shows the Inputs list';
}
function openRemap() {
  api('/api/remap').then(
    function (r) {
      rm = r;
      if (view !== 'remap') push('remap');
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
/* the switch: the feature is off until it is switched on, and while it is off nothing runs for it */
function rmToggle() {
  var on = !(rm && rm.enabled);
  api('/api/remap', { enabled: on }).then(
    function () {
      banner(on ? 'Key remapping is on' : 'Key remapping is off', 'ok');
      openRemap();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
/* back to the list of keys, however many screens were opened on the way */
function rmBack() {
  while (view !== 'remap' && idxStack.length) {
    var p = idxStack.pop();
    view = p[0];
    idx = p[1];
  }
  openRemap();
}
function rmSave(entry) {
  var body = { code: rmCode, type: entry.type, id: entry.id, label: entry.label, key: rmKey };
  if (rmApp) {
    body.app = rmApp;
    body.appName = rmAppName;
  }
  api('/api/remap', body).then(
    function (r) {
      if (r.error) {
        banner(
          r.error === 'taken'
            ? 'That button already has another job'
            : r.error === 'too many keys'
              ? 'Up to 12 buttons can be used'
              : r.error === 'too many entries'
                ? 'Up to 8 apps can have their own action'
                : r.error === 'off'
                  ? 'Key remapping is off'
                  : r.error,
          'err'
        );
        return;
      }
      banner('Saved', 'ok');
      rmBack();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function rmRemove(code, app) {
  var body = { code: code, remove: true };
  if (app) body.app = app;
  api('/api/remap', body).then(
    function () {
      banner(app ? 'That entry is removed' : 'The button is back to LG\u2019s own action', 'ok');
      rmBack();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function rmClear() {
  api('/api/remap', { clear: true }).then(
    function () {
      banner('Every button is back to LG\u2019s own action', 'ok');
      rmBack();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function rmLearn() {
  api('/api/remap/learn', {}).then(function () {
    push('remaplearn');
    kText = 'Press the remote button you want to use.';
    build();
    draw();
    (function poll() {
      kTimer = setTimeout(function () {
        api('/api/remap/learn-state').then(
          function (l) {
            if (view !== 'remaplearn') return;
            if (l.state === 'got') {
              rmCode = String(l.code);
              rmApp = '';
              rmKey = l.key || '';
              rmBtn = l.button || '';
              view = 'remapact'; /* Back from here returns to the list */
              idx = 0;
              build();
              draw();
              return;
            }
            if (l.state === 'taken') {
              kText = 'That button is already the Input, Guide, voice or Home key. Press another button, or clear that key first.';
              build();
              draw();
              /* the code was not taken over: learn again so that another button can be pressed without going back */
              api('/api/remap/learn', {}).then(poll, function () {
                banner('The service did not answer', 'err');
              });
              return;
            }
            if (l.state === 'unsupported') {
              kText =
                'CleanYourTV could not attach to the remote keys on this TV, so buttons cannot be learned.\nUse Share log to report this.';
              build();
              draw();
              return;
            }
            if (l.state === 'blind') {
              kText =
                'No button reaches CleanYourTV on this TV: LG’s input service passes them another way, so buttons cannot be learned.\nUse Share log to report this.';
              build();
              draw();
              return;
            }
            if (l.state === 'timeout') {
              kText = 'No button was pressed. Go back to try again.';
              build();
              draw();
              return;
            }
            poll();
          },
          function () {
            poll();
          }
        );
      }, 500);
    })();
  });
}
/* the manager was opened again by the service after the button's own action (Netflix, the store) covered it: carry on with the learned button */
function rmResume() {
  api('/api/remap/learn-state').then(function (l) {
    if (l.state !== 'got' || !l.resume || l.name !== 'remap') return;
    api('/api/remap').then(function (r) {
      rm = r;
      /* the same levels as after rmLearn, so that Back returns to the list of buttons */
      push('remap');
      push('remaplearn');
      rmCode = String(l.code);
      rmApp = '';
      rmKey = l.key || '';
      rmBtn = l.button || '';
      view = 'remapact';
      idx = 0;
      build();
      draw();
    });
  });
}
/* the apps or the inputs to choose from */
function rmChoose(kind) {
  /* kind 'for' lists the apps to give their own action; 'app' the apps to open */
  api(kind === 'input' ? '/api/inputs' : '/api/apps').then(
    function (r) {
      rmList = [];
      if (kind === 'input')
        ((r && r.devices) || []).forEach(function (d) {
          if (d && d.appId) rmList.push({ id: d.appId, title: d.label || d.id || d.appId });
        });
      else
        ((r && r.apps) || []).forEach(function (a) {
          if (a && a.id && !a.input) rmList.push({ id: a.id, title: a.title || a.id });
        });
      push(kind === 'input' ? 'remapinputs' : kind === 'for' ? 'remapfor' : 'remapapps');
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function rmRows() {
  if (view === 'remap') {
    var keys = (rm && rm.keys) || {},
      codes = Object.keys(keys),
      on = !!(rm && rm.enabled);
    rows.push({ label: 'Key remapping', sub: onoff(on), fn: rmToggle });
    rows.push({ sep: true });
    /* the saved buttons stay listed while the feature is off (they are kept), but only while it is on can one be changed */
    codes.forEach(function (c) {
      rows.push({
        label: rmDescribe(keys[c]),
        sub:
          rmButton(c, keys[c]) +
          (keys[c].apps && keys[c].apps.length ? ' \u00b7 and ' + keys[c].apps.length + ' app' + (keys[c].apps.length > 1 ? 's' : '') : ''),
        dim: !on,
        fn: on
          ? function () {
              rmCode = c;
              rmApp = '';
              rmKey = '';
              rmBtn = keys[c].name || '';
              push('remapkey');
            }
          : function () {},
      });
    });
    if (!codes.length) rows.push({ label: 'No buttons yet', sub: 'every button is still LG\u2019s', fn: function () {} });
    if (on)
      rows.push({
        label: 'Add a button',
        sub:
          rm.hook === false
            ? 'not available on this firmware'
            : rm.blind
              ? 'no button reaches the hook on this TV'
              : 'press it, then choose what it does',
        dim: rm.hook === false,
        fn: function () {
          if (rm.hook !== false) rmLearn();
        },
      });
    if (codes.length)
      rows.push({
        label: 'Give every button back to LG',
        fn: function () {
          push('remapclear');
        },
      });
    rows.push({ label: 'Back', fn: pop });
  } else if (view === 'remapclear') {
    rows.push({ label: 'Give every button back to LG', fn: rmClear });
    rows.push({ label: 'No, keep them', fn: pop });
  } else if (view === 'remapkey') {
    var btn = ((rm && rm.keys) || {})[rmCode] || { type: '' };
    rows.push({
      label: 'Everywhere',
      sub: rmDescribe(btn),
      fn: function () {
        rmApp = '';
        push('remapact');
      },
    });
    (btn.apps || []).forEach(function (a) {
      rows.push({
        label: 'Only in ' + (a.appName || a.app),
        sub: rmDescribe(a),
        fn: function () {
          rmApp = a.app;
          rmAppName = a.appName || a.app;
          push('remapentry');
        },
      });
    });
    if ((btn.apps || []).length < ((rm && rm.maxApps) || 8))
      rows.push({
        label: 'Add an entry for one app',
        sub: 'another action while that app is in front',
        fn: function () {
          rmChoose('for');
        },
      });
    rows.push({
      label: 'Give the button back to LG',
      fn: function () {
        rmRemove(rmCode, '');
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
  } else if (view === 'remapentry') {
    rows.push({
      label: 'Change what it does',
      fn: function () {
        push('remapact');
      },
    });
    rows.push({
      label: 'Remove this entry',
      sub: 'the Everywhere action runs in that app',
      fn: function () {
        rmRemove(rmCode, rmApp);
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
  } else if (view === 'remaplearn') {
    rows.push({ label: 'Cancel', fn: pop });
  } else if (view === 'remapact') {
    rows.push({
      label: 'Open an app',
      fn: function () {
        rmChoose('app');
      },
    });
    rows.push({
      label: 'Switch to an input',
      fn: function () {
        rmChoose('input');
      },
    });
    rows.push({
      label: 'Open Live TV',
      sub: 'needs CleanYourTV as Home',
      fn: function () {
        rmSave({ type: 'live' });
      },
    });
    rows.push({
      label: 'Go to Home',
      fn: function () {
        rmSave({ type: 'home' });
      },
    });
    rows.push({
      label: 'Show the Inputs list',
      fn: function () {
        rmSave({ type: 'picker' });
      },
    });
    ['mute', 'volume_up', 'volume_down', 'screen_off', 'standby', 'settings'].forEach(function (t) {
      rows.push({
        label: RM_EXTRA[t][1],
        sub: RM_EXTRA[t][2],
        fn: function () {
          rmSave({ type: t });
        },
      });
    });
    rows.push({
      label: 'Do nothing',
      sub: "blocks the button's own action",
      fn: function () {
        rmSave({ type: 'none' });
      },
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
  } else if (view === 'remapfor') {
    if (!rmList.length) rows.push({ label: 'No apps found', fn: function () {} });
    rmList.forEach(function (a) {
      rows.push({
        label: a.title,
        fn: function () {
          rmApp = a.id;
          rmAppName = a.title;
          push('remapact');
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
  } else {
    var kind = view === 'remapinputs' ? 'input' : 'app';
    if (!rmList.length) rows.push({ label: kind === 'input' ? 'No inputs found' : 'No apps found', fn: function () {} });
    rmList.forEach(function (a) {
      rows.push({
        label: a.title,
        fn: function () {
          rmSave({ type: kind, id: a.id, label: a.title });
        },
      });
    });
    rows.push({ sep: true });
    rows.push({ label: 'Back', fn: pop });
  }
}
function rmSub() {
  if (view === 'remaplearn') return kText;
  if (view === 'remapclear') return 'Remove every remapped button?';
  if (view === 'remapact') return rmButton(rmCode) + (rmApp ? ' \u00b7 only in ' + (rmAppName || rmApp) : ' \u00b7 everywhere');
  if (view === 'remapentry') return rmButton(rmCode) + ' \u00b7 only in ' + (rmAppName || rmApp);
  if (view === 'remapkey') return rmButton(rmCode);
  if (view === 'remapfor') return 'Which app gets its own action?';
  if (view === 'remapapps') return 'Open which app?';
  if (view === 'remapinputs') return 'Switch to which input?';
  if (view === 'remap' && !(rm && rm.enabled)) return 'Off. Switch it on to remap buttons.';
  return 'Remap buttons';
}
