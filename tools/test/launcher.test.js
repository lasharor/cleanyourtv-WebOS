// Direct HDMI input entries in the launcher dock.
'use strict';
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

run(async () => {
  let launched = '';
  const appId = 'com.webos.app.hdmi1',
    dockId = '__input__' + appId,
    context = {
      apps: [],
      cfg: { dock: [dockId] },
      inputDevices: [{ appId, label: 'HDMI 1', port: 1 }],
      DEFAULTS: { dock: [] },
      TH: { dockN: 4 },
      usage: {},
      launch: id => (launched = id),
    };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'config.js'), 'utf8'), context);

  ok(context.dockIds()[0] === dockId, 'a saved HDMI input is kept in the dock even though it is not an installed app');
  ok(context.title(dockId) === 'HDMI 1', 'the dock resolves the input label');
  context.act({ _a: context.inputDockItem(dockId) });
  ok(launched === appId, 'selecting the HDMI dock tile launches its input app directly');
  context.inputDevices = [];
  ok(context.dockIds().length === 0, 'a saved input missing from the TV is omitted safely');
});
