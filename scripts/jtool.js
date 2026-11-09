#!/usr/bin/env node
// Small JSON helper for the shell scripts, so they need node (the service needs it anyway) and not python3.
// Plain ES5 on purpose: older webOS images ship an old node.
var fs = require('fs');
function rj(f, d) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return d;
  }
}
function wj(f, o) {
  fs.writeFileSync(f, JSON.stringify(o, null, 2));
}
var a = process.argv.slice(2),
  cmd = a[0];

if (cmd === 'kind') {
  // kind <appinfo.json>  ->  "<id> <type>"
  var o = rj(a[1], {});
  console.log((o.id || '') + ' ' + (o.type || ''));
} else if (cmd === 'newer') {
  // newer <a.json> <b.json>  ->  exit 0 when a's version is higher
  var v = function (f) {
    return String(rj(f, {}).version || '0')
      .split('.')
      .map(function (x) {
        return parseInt(x, 10) || 0;
      });
  };
  var x = v(a[1]),
    y = v(a[2]),
    r = 1;
  for (var i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) {
      r = (x[i] || 0) > (y[i] || 0) ? 0 : 1;
      break;
    }
  }
  process.exit(r);
} else if (cmd === 'options') {
  // options <config.json> <debloat 1|0|''> <inputKey 1|0|''>
  var c = rj(a[1], {}),
    op = (c.options = c.options || {});
  if (op.debloat === undefined) op.debloat = true;
  if (op.inputKey === undefined) op.inputKey = true;
  var was = JSON.stringify({ debloat: op.debloat, inputKey: op.inputKey });
  if (a[2] !== '' && a[2] !== undefined) op.debloat = a[2] === '1';
  if (a[3] !== '' && a[3] !== undefined) op.inputKey = a[3] === '1';
  wj(a[1], c);
  // the setup log shows what the options are and whether this run changed them (an update passes no values and keeps them)
  var now = JSON.stringify({ debloat: op.debloat, inputKey: op.inputKey });
  console.log('[cleanyourtv] options: ' + now + (now === was ? ' (kept)' : ' (were ' + was + ')'));
} else if (cmd === 'opt') {
  // opt <config.json> <name>  ->  1 or 0
  var oo = rj(a[1], {}).options || {};
  console.log(oo[a[2]] === false ? 0 : 1);
} else if (cmd === 'stage') {
  // stage <stock home appinfo.json> <out>
  var h = rj(a[1], {});
  if (h.type !== 'web' && h.type !== 'flutter') {
    // another kind of Home app (native, QML): drop what only applies to that kind
    ['nativeLifeCycleInterfaceVersion', 'containerBasedApp', 'supportQuickStart', 'windowGroup', 'qmlIncludePath', 'qtModules'].forEach(
      function (k) {
        delete h[k];
      }
    );
  }
  h.type = 'web';
  h.main = 'index.html';
  delete h.splashBackground;
  delete h.noSplashOnLaunch;
  h.bgColor = '#000000';
  h.transparent = false;
  fs.writeFileSync(a[2], JSON.stringify(h, null, 1));
} else if (cmd === 'saver') {
  // saver <stock screen saver appinfo.json> <out>
  // our page replaces LG's screen saver: a web app that covers the running app with LG's own window type (screenSaver, below), so
  // tvpowerd counts it as the screen saver, and gives the app back when the page closes
  var s = rj(a[1], {});
  ['nativeLifeCycleInterfaceVersion', 'containerBasedApp', 'supportQuickStart', 'windowGroup', 'qmlIncludePath', 'qtModules'].forEach(
    function (k) {
      delete s[k];
    }
  );
  s.type = 'web';
  s.main = 'index.html';
  // the page paints its own black background: no launch splash and no spinner, which showed as a grey "loading" screen for a second
  delete s.splashBackground;
  s.noSplashOnLaunch = true;
  s.spinnerOnLaunch = false;
  // LG's own saver has the window type "screenSaver", and tvpowerd only counts that as the screen saver: with an overlay window it
  // started the app but never entered the Screen Saver state, and after the app closed it never armed again. Keep LG's type.
  if (!s.defaultWindowType) s.defaultWindowType = 'screenSaver';
  s.transparent = false;
  s.bgColor = '#000000';
  fs.writeFileSync(a[2], JSON.stringify(s, null, 1));
} else if (cmd === 'exe') {
  // exe <stock home appinfo.json>  ->  the program of a native Home app (its "main", absolute or in its folder)
  var e = rj(a[1], {}),
    m = String(e.main || ''),
    cand = [m.charAt(0) === '/' ? m : '/usr/palm/applications/' + (e.id || '') + '/' + m, '/usr/bin/' + (e.id || '')];
  for (var ci = 0; ci < cand.length; ci++) {
    if (e.id && fs.existsSync(cand[ci]) && fs.statSync(cand[ci]).isFile()) {
      console.log(cand[ci]);
      process.exit(0);
    }
  }
  process.exit(1);
} else if (cmd === 'wamlaunch') {
  // wamlaunch <launcher appinfo.json> <folder> <out> [instance id]  ->  the request that asks webapp-mgr to open a page (home-standin.sh),
  // and <out>.str with the app description as a string, the form older webapp-mgr versions may expect
  var w = rj(a[1], {});
  w.folderPath = a[2];
  var req = { appDesc: w, parameters: {}, launchingAppId: '', launchingProcId: '', instanceId: a[4] || 'cleanyourtv-home' };
  fs.writeFileSync(a[3], JSON.stringify(req));
  req.appDesc = JSON.stringify(w);
  fs.writeFileSync(a[3] + '.str', JSON.stringify(req));
} else if (cmd === 'wintype') {
  // wintype <appinfo.json> <type>  ->  set defaultWindowType; exit 0 when it changed, 1 when it already was that
  var wo = rj(a[1], null);
  if (!wo || wo.defaultWindowType === a[2]) process.exit(1);
  wo.defaultWindowType = a[2];
  wj(a[1], wo);
} else if (cmd === 'rmbind') {
  // rmbind  ->  drop our Input-key bind from the inputhook's keybinds.json
  var p = '/home/root/.config/lginputhook/keybinds.json',
    b = rj(p, null);
  if (b) {
    Object.keys(b).forEach(function (k) {
      if (b[k] && String(b[k].command || '').indexOf('cleanyourtv') >= 0) delete b[k];
    });
    fs.writeFileSync(p, JSON.stringify(b));
  }
} else {
  console.error('usage: jtool.js kind|newer|options|opt|stage|saver|exe|wamlaunch|wintype|rmbind');
  process.exit(2);
}
