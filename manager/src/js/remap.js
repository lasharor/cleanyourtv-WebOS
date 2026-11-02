/* Key remapping: a remote button (the Netflix or Prime key, a colour key, ...) opens an app, an input, Live TV, Home or the Inputs list.
   The button's code is learned from the TV, never assumed (helper/remap.js). */
var rm = null,
  rmCode = '',
  rmList = [];
function rmDescribe(e) {
  if (e.type === 'app') return 'Opens ' + (e.label || e.id);
  if (e.type === 'input') return 'Switches to ' + (e.label || e.id);
  if (e.type === 'live') return 'Opens Live TV';
  if (e.type === 'home') return 'Goes to Home';
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
  var body = { code: rmCode, type: entry.type, id: entry.id, label: entry.label };
  api('/api/remap', body).then(
    function (r) {
      if (r.error) {
        banner(
          r.error === 'taken'
            ? 'That button already has another job'
            : r.error === 'too many keys'
              ? 'Up to 12 buttons can be used'
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
function rmRemove(code) {
  api('/api/remap', { code: code, remove: true }).then(
    function () {
      banner('The button is back to LG\u2019s own action', 'ok');
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
              return;
            }
            if (l.state === 'unsupported') {
              kText = 'CleanYourTV could not attach to the remote keys on this TV, so buttons cannot be learned.\nUse Share log to report this.';
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
/* the apps or the inputs to choose from */
function rmChoose(kind) {
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
      push(kind === 'input' ? 'remapinputs' : 'remapapps');
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
    if (!on) {
      rows.push({ sep: true });
      rows.push({ label: 'Back', fn: pop });
      return;
    }
    rows.push({ sep: true });
    codes.forEach(function (c) {
      rows.push({
        label: 'Button ' + c,
        sub: rmDescribe(keys[c]),
        fn: function () {
          rmCode = c;
          push('remapkey');
        },
      });
    });
    if (!codes.length) rows.push({ label: 'No buttons yet', sub: 'every button is still LG\u2019s', fn: function () {} });
    rows.push({ sep: true });
    rows.push({
      label: 'Add a button',
      sub: rm && rm.hook === false ? 'not available on this firmware' : 'press it, then choose what it does',
      dim: !!rm && rm.hook === false,
      fn: function () {
        if (!rm || rm.hook !== false) rmLearn();
      },
    });
    rows.push({
      label: 'Give every button back to LG',
      dim: !codes.length,
      fn: function () {
        if (codes.length) rmClear();
      },
    });
    rows.push({ label: 'Back', fn: pop });
  } else if (view === 'remapkey') {
    rows.push({
      label: 'Change what it does',
      sub: rmDescribe(((rm && rm.keys) || {})[rmCode] || { type: '' }),
      fn: function () {
        push('remapact');
      },
    });
    rows.push({
      label: 'Give the button back to LG',
      fn: function () {
        rmRemove(rmCode);
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
  if (view === 'remapact' || view === 'remapkey') return 'Button ' + rmCode;
  if (view === 'remapapps') return 'Open which app?';
  if (view === 'remapinputs') return 'Switch to which input?';
  if (view === 'remap' && !(rm && rm.enabled)) return 'Off. Switch it on to remap buttons.';
  return 'Remap buttons';
}
