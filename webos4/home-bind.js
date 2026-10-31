// Two-minute HOME trial only. ES5 also lets the system Node undo it if the helper is stopped.
'use strict';
var fs = require('fs');
var path = require('path');

function create(opts) {
  if (!/^\/[\w./-]+$/.test(opts.script)) throw new Error('Expected an absolute TV script path');
  var command = 'sh ' + opts.script;
  var temp = opts.temp || '/tmp';
  // A reboot must not leave a persistent lock that prevents HOME recovery.
  var lock = path.join(temp, 'cytv-home-bind.lock');
  function readObject(file) {
    var value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid configuration');
    return value;
  }
  function atomic(file, value) {
    var pending = file + '.cytv-' + process.pid;
    try {
      fs.writeFileSync(pending, JSON.stringify(value) + '\n', { flag: 'wx', mode: parseInt('600', 8) });
      fs.renameSync(pending, file);
    } finally {
      if (fs.existsSync(pending)) fs.unlinkSync(pending);
    }
  }
  function locked(fn) {
    fs.mkdirSync(lock, parseInt('700', 8));
    try {
      return fn();
    } finally {
      fs.rmdirSync(lock);
    }
  }
  function record() {
    if (!fs.existsSync(opts.state)) return null;
    var r = readObject(opts.state);
    if (
      !/^[1-9]\d{0,4}$/.test(r.key) ||
      +r.key > 65535 ||
      r.command !== command ||
      typeof r.marker !== 'string' ||
      path.dirname(r.marker) !== temp ||
      !/^cytv-home-trial-\d+-\d+$/.test(path.basename(r.marker)) ||
      typeof r.expiresAt !== 'number'
    )
      throw new Error('Invalid HOME trial record');
    return r;
  }
  function enable(key) {
    key = String(key);
    if (!/^[1-9]\d{0,4}$/.test(key) || +key > 65535) throw new Error('Invalid key code');
    return locked(function () {
      if (fs.existsSync(opts.state)) throw new Error('Restore the previous trial first');
      var binds = readObject(opts.binds);
      if (Object.prototype.hasOwnProperty.call(binds, key)) throw new Error('Key already assigned; nothing changed');
      var r = {
        key: key,
        command: command,
        marker: path.join(temp, 'cytv-home-trial-' + process.pid + '-' + Date.now()),
        expiresAt: Date.now() + 120000,
      };
      fs.writeFileSync(r.marker, 'temporary HOME trial\n', { flag: 'wx', mode: parseInt('600', 8) });
      // Save recovery information before assigning the key.
      atomic(opts.state, r);
      binds[key] = { action: 'exec', command: command };
      atomic(opts.binds, binds);
      return r;
    });
  }
  function restore(expectedMarker) {
    return locked(function () {
      var r = record();
      if (expectedMarker && (!r || r.marker !== expectedMarker)) return false;
      var binds = readObject(opts.binds);
      if (r && binds[r.key] && (binds[r.key].action !== 'exec' || binds[r.key].command !== command))
        throw new Error('HOME assignment changed; refusing to overwrite it');
      var changed = false;
      // Also recover if a reboot interrupted the state write: only our exact command is removed.
      Object.keys(binds).forEach(function (key) {
        if (binds[key] && binds[key].action === 'exec' && binds[key].command === command) {
          delete binds[key];
          changed = true;
        }
      });
      if (changed) atomic(opts.binds, binds);
      if (r && fs.existsSync(r.marker)) fs.unlinkSync(r.marker);
      if (r) fs.unlinkSync(opts.state);
      return changed;
    });
  }
  function check() {
    var r = record();
    if (r && r.expiresAt > Date.now() && fs.existsSync(r.marker)) return true;
    restore();
    return false;
  }
  return { enable: enable, restore: restore, check: check };
}

module.exports = { create: create };
if (require.main === module) {
  try {
    process.umask(parseInt('077', 8));
    var ctl = create({
      binds: '/home/root/.config/lginputhook/keybinds.json',
      state: path.join(__dirname, '..', 'state', 'home-trial.json'),
      script: path.join(__dirname, 'home.sh'),
    });
    var args = process.argv.slice(2);
    if (args[0] === 'enable' && args.length === 2) process.stdout.write(JSON.stringify(ctl.enable(args[1])) + '\n');
    else if (args[0] === 'restore' && args.length <= 2) ctl.restore(args[1]);
    else if (args[0] === 'check' && args.length === 1) {
      if (!ctl.check()) process.exit(1);
    } else throw new Error('Usage: home-bind.js enable <observed-key-code> | restore [marker] | check');
  } catch (e) {
    process.stderr.write('HOME trial: ' + e.message + '\n');
    process.exit(1);
  }
}
