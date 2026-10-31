'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  crypto = require('crypto');
const { root, tmp, ok, run } = require('./lib');

const script = path.join(root, 'webos4/shutdownfix.sh');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
// Stand-in for LG's file: only the line the hook rewrites matters, and the hashes are replaced in a private copy of the script.
const original =
  'script\n\tDIR="/var/luna/preferences"\n\tif [ -e $DIR/devmode_enabled ] ; then\n\t\trm -f $DIR/devmode_enabled\n\tfi\nend script\n';
const fixed = original.replace('if [ -e $DIR/devmode_enabled ] ;', 'if [ -e $DIR/devmode_enabled ] && [ ! -d $DIR/devmode_enabled ] ;');

run(async () => {
  const body = fs
    .readFileSync(script, 'utf8')
    .replace(/ORIGINAL=\w+/, 'ORIGINAL=' + sha(original))
    .replace(/FIXED=\w+/, 'FIXED=' + sha(fixed));
  const copy = path.join(tmp, 'shutdownfix.sh');
  fs.writeFileSync(copy, body);
  let n = 0;
  const scenario = (name, setup) => {
    const dir = path.join(tmp, 'sf' + ++n);
    fs.mkdirSync(dir);
    fs.mkdirSync(path.join(dir, 'base'));
    fs.mkdirSync(path.join(dir, 'prefs'));
    fs.mkdirSync(path.join(dir, 'prefs', 'devmode_enabled'));
    fs.writeFileSync(path.join(dir, 'shutdown.conf'), original);
    fs.writeFileSync(path.join(dir, 'mounts'), '');
    fs.writeFileSync(path.join(dir, 'calls'), '');
    const calls = path.join(dir, 'calls');
    fs.writeFileSync(path.join(dir, 'mount.sh'), '#!/bin/sh\necho "mount $*" >> "' + calls + '"\n');
    fs.writeFileSync(path.join(dir, 'initctl.sh'), '#!/bin/sh\necho "initctl $*" >> "' + calls + '"\n');
    if (setup) setup(dir);
    const env = Object.assign({}, process.env, {
      CYTV_SF_CONF: path.join(dir, 'shutdown.conf'),
      CYTV_SF_PREFS: path.join(dir, 'prefs'),
      CYTV_SF_BASE: path.join(dir, 'base'),
      CYTV_SF_OUT: path.join(dir, 'out.conf'),
      CYTV_SF_MOUNTS: path.join(dir, 'mounts'),
      CYTV_SF_LOG: path.join(dir, 'log'),
      CYTV_SF_MOUNT: 'sh ' + path.join(dir, 'mount.sh'),
      CYTV_SF_INITCTL: 'sh ' + path.join(dir, 'initctl.sh'),
    });
    const result = cp.spawnSync('sh', [copy], { env, encoding: 'utf8' });
    return {
      dir,
      status: result.status,
      calls: fs.readFileSync(calls, 'utf8'),
      log: fs.existsSync(path.join(dir, 'log')) ? fs.readFileSync(path.join(dir, 'log'), 'utf8') : '',
      out: path.join(dir, 'out.conf'),
    };
  };

  const good = scenario('good');
  ok(
    good.status === 0 && /mount --bind .*out\.conf .*shutdown\.conf/.test(good.calls) && /initctl reload-configuration/.test(good.calls),
    'with the known file and a devmode directory it mounts the fixed copy and reloads Upstart'
  );
  ok(fs.readFileSync(good.out, 'utf8') === fixed, "the generated copy differs from LG's file only by the extra condition");
  ok(fs.statSync(path.join(good.dir, 'prefs', 'devmode_enabled')).isDirectory(), 'it never touches the devmode directory');

  const off = scenario('off', dir => fs.writeFileSync(path.join(dir, 'base', 'DISABLE-SHUTDOWNFIX'), ''));
  ok(off.status === 0 && off.calls === '' && /disabled/.test(off.log), 'the disable marker stops it before anything is mounted');

  const file = scenario('file', dir => {
    fs.rmdirSync(path.join(dir, 'prefs', 'devmode_enabled'));
    fs.writeFileSync(path.join(dir, 'prefs', 'devmode_enabled'), '');
  });
  ok(
    file.status === 0 && file.calls === '' && /not a directory/.test(file.log),
    "when devmode_enabled is a normal file LG's script is left alone"
  );

  const unknown = scenario('unknown', dir => fs.writeFileSync(path.join(dir, 'shutdown.conf'), original + '# firmware update\n'));
  ok(
    unknown.status === 0 && unknown.calls === '' && /not the known one/.test(unknown.log) && !fs.existsSync(unknown.out),
    'an unknown shutdown.conf (new firmware) is left alone'
  );

  const again = scenario('again', dir =>
    fs.writeFileSync(path.join(dir, 'mounts'), 'x ' + path.join(dir, 'shutdown.conf') + ' ext4 ro 0 0\n')
  );
  ok(again.status === 0 && again.calls === '' && /already mounted/.test(again.log), 'a second run does not stack another mount');
});
