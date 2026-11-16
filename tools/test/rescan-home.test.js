// rescan-home.sh: sam reads the mounted Home again after a moment of another UI language, and the language always comes back.
// The real script runs with a stand-in luna-send that keeps the settings in a file; never calls the TV.
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');
run(async () => {
  const jt = path.join(root, 'scripts', 'jtool.js');
  const jtool = args => cp.spawnSync(process.execPath, [jt].concat(args), { encoding: 'utf8' });
  const reply = path.join(tmp, 'locale-reply.json');
  const info = { keyboards: ['en'], locales: { UI: 'it-IT', FMT: 'en-GB', TV: 'en-GB' }, clock: 'locale', timezone: '' };
  fs.writeFileSync(reply, JSON.stringify({ returnValue: true, settings: { localeInfo: info } }));
  ok(jtool(['localeui', reply]).stdout.trim() === 'it-IT', 'jtool localeui: the UI language from the settings reply');
  ok(jtool(['localetemp', 'it-IT']).stdout.trim() === 'it', 'jtool localetemp: the bare language, so the words stay the same');
  ok(jtool(['localetemp', 'de']).stdout.trim() === 'de-DE', 'jtool localetemp: a language without a region gets one');
  const set = JSON.parse(jtool(['localeset', reply, 'it']).stdout);
  ok(
    set.settings.localeInfo.locales.UI === 'it' &&
      set.settings.localeInfo.locales.FMT === 'en-GB' &&
      set.settings.localeInfo.keyboards[0] === 'en' &&
      set.settings.localeInfo.clock === 'locale',
    'jtool localeset: only locales.UI changes, the rest of localeInfo is sent back as it was'
  );
  fs.writeFileSync(reply, '{"returnValue":false}');
  ok(jtool(['localeset', reply, 'it']).status === 1, 'jtool localeset: no localeInfo, no request');

  // ---- the script ----
  const bin = path.join(tmp, 'rbin'),
    service = path.join(tmp, 'rservice'),
    home = path.join(tmp, 'rhome'),
    state = path.join(tmp, 'rstate'),
    log = path.join(tmp, 'rboot.log');
  for (const d of [bin, service, home, state]) fs.mkdirSync(d);
  fs.copyFileSync(jt, path.join(service, 'jtool.js'));
  fs.copyFileSync(path.join(root, 'scripts/luna-compat.sh'), path.join(service, 'luna-compat.sh'));
  fs.writeFileSync(path.join(home, 'appinfo.json'), JSON.stringify({ id: 'com.webos.app.home', type: 'web', main: 'index.html' }));
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  // the stand-in: settingsservice keeps UI in $S/ui and lists the changes; sam reports the type in $S/type, which turns web after
  // the first change unless $S/stuck exists (an app manager that does not rescan)
  fs.writeFileSync(
    path.join(bin, 'luna-send'),
    [
      '#!/bin/sh',
      'for a; do uri=$prev; prev=$a; done',
      'case "$uri" in',
      '*getSystemSettings) printf \'{"returnValue":true,"settings":{"localeInfo":{"locales":{"UI":"%s","FMT":"en-GB"},"clock":"locale"}}}\\n\' "$(cat $S/ui)" ;;',
      '*setSystemSettings)',
      '  [ -e $S/setfails ] && { echo \'{"returnValue":false}\'; exit 0; }',
      '  echo "$prev" | sed -n \'s/.*"UI":"\\([^"]*\\)".*/\\1/p\' > $S/ui; cat $S/ui >> $S/changes',
      '  [ -e $S/stuck ] || echo web > $S/type',
      '  echo \'{"returnValue":true,"method":"setSystemSettings"}\' ;;',
      '*getAppInfo) printf \'{"returnValue":true,"appInfo":{"id":"com.webos.app.home","type":"%s"}}\\n\' "$(cat $S/type)" ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  const script = fs
    .readFileSync(path.join(root, 'scripts/rescan-home.sh'), 'utf8')
    .replace(/^export PATH=.*$/m, 'export PATH="' + bin + ':$PATH"')
    .replace('L=/media/developer/cleanyourtv', 'L="' + service + '"')
    .replace('H=/usr/palm/applications/com.webos.app.home', 'H="' + home + '"')
    .replace('LOG=/tmp/cleanyourtv-boot.log', 'LOG="' + log + '"')
    .replace('T=/tmp/cleanyourtv-locale.json', 'T="' + path.join(tmp, 'rlocale.json') + '"')
    .replace(/^up\(\).*$/m, 'up() { echo 1; }')
    .replace(/sleep [0-9]+/g, 'sleep 0');
  const restoreFile = path.join(service, 'locale-ui.restore');
  const sh = (args, setup) => {
    for (const f of fs.readdirSync(state)) fs.unlinkSync(path.join(state, f));
    fs.writeFileSync(path.join(state, 'ui'), 'it-IT\n');
    fs.writeFileSync(path.join(state, 'type'), 'flutter\n');
    fs.writeFileSync(path.join(state, 'changes'), '');
    fs.writeFileSync(log, '');
    if (setup) setup();
    const r = cp.spawnSync('sh', ['-s'].concat(args), {
      input: script,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { S: state }),
    });
    return {
      status: r.status,
      ui: fs.readFileSync(path.join(state, 'ui'), 'utf8').trim(),
      changes: fs.readFileSync(path.join(state, 'changes'), 'utf8').trim().split('\n').filter(Boolean),
      log: fs.readFileSync(log, 'utf8'),
    };
  };
  let r = sh([]);
  ok(r.status === 0, 'rescan-home: sam reports the launcher after the rescan (exit 0, no sam restart)');
  ok(r.changes.join(' ') === 'it it-IT' && r.ui === 'it-IT', 'rescan-home: UI language it for a moment, then it-IT again');
  ok(!fs.existsSync(restoreFile) && /Home is web/.test(r.log), 'rescan-home: nothing left to restore, and the boot log says so');
  r = sh([], () => fs.writeFileSync(path.join(state, 'stuck'), ''));
  ok(r.status === 1 && r.ui === 'it-IT', 'rescan-home: an app manager that does not rescan gives exit 1 (sam is restarted), language back');
  ok(/still flutter/.test(r.log), 'rescan-home: the boot log names what sam still reports');
  r = sh([], () => fs.writeFileSync(path.join(state, 'setfails'), ''));
  ok(r.status === 1 && r.ui === 'it-IT' && !fs.existsSync(restoreFile), 'rescan-home: a refused change leaves the language alone');
  r = sh(['restore'], () => {
    fs.writeFileSync(path.join(state, 'ui'), 'it\n');
    fs.writeFileSync(restoreFile, 'it-IT\n');
  });
  ok(r.status === 0 && r.ui === 'it-IT' && !fs.existsSync(restoreFile), 'rescan-home restore: a language left changed comes back at boot');
  ok(r.changes.length === 1, 'rescan-home restore: no rescan of its own');
  // the restore cannot happen yet (settings service not ready): the main run must not take the changed language for the user's own
  r = sh([], () => {
    fs.writeFileSync(path.join(state, 'ui'), 'it\n');
    fs.writeFileSync(path.join(state, 'setfails'), '');
    fs.writeFileSync(restoreFile, 'it-IT\n');
  });
  ok(
    r.status === 1 && r.ui === 'it' && r.changes.length === 0 && fs.readFileSync(restoreFile, 'utf8').trim() === 'it-IT',
    'rescan-home: a language still waiting to be restored is not overwritten, and there is no rescan (sam is restarted instead)'
  );
  ok(/not back yet/.test(r.log), 'rescan-home: the boot log says why there was no rescan');
  fs.unlinkSync(restoreFile);
});
