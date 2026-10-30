// Manual HOME experiments only; the guardian runs on the TV independently of SSH/the PC.
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var bind = require('./home-bind');
var variants = {
  probe: 'Detectar HOME sin abrir ninguna app',
  plain: 'Abrir CleanYourTV por el bus privado, solo id',
  recent: 'Abrir CleanYourTV con la receta recent de LG',
  public: 'Abrir CleanYourTV por el bus publico, solo id',
  observe: 'Observar HOME directamente sin cambiar su asignacion',
};

// The tested ARM input_event layout is 16 bytes; reads need not end at a frame boundary.
function homeEvents(onHome) {
  var pending = new Buffer(0);
  return function (bytes) {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 16) {
      if (pending.readUInt16LE(8) === 1 && pending.readUInt16LE(10) === 773 && pending.readInt32LE(12) === 1) onHome();
      pending = pending.slice(16);
    }
  };
}

function launch(variant) {
  if (!Object.prototype.hasOwnProperty.call(variants, variant)) throw new Error('Unknown variant');
  if (variant === 'probe') return null;
  var payload = { id: 'com.cleanyourtv.webos4' };
  if (variant === 'recent') {
    payload.checkUpdateOnLaunch = false;
    payload.reason = 'recent';
    payload.autoInstallation = false;
    payload.params = { reason: 'recent' };
  }
  return {
    file: variant === 'public' ? 'luna-send-pub' : 'luna-send',
    args: ['-n', '1', '-w', '10000', '-f', 'luna://com.webos.applicationManager/launch', JSON.stringify(payload)],
  };
}

function create(opts) {
  var temp = opts.temp || '/tmp';
  var active = path.join(opts.dir, 'active.json');
  var events = path.join(opts.dir, 'events.jsonl');
  var lock = path.join(temp, 'cytv-home-lab.lock');
  var pressLock = path.join(temp, 'cytv-home-lab-press.lock');
  var ctl = bind.create({
    binds: opts.binds,
    state: path.join(opts.dir, 'binding.json'),
    temp: temp,
    script: path.join(opts.dir, 'home-lab.sh'),
  });
  var timer = opts.timer || setTimeout;
  var spawn = opts.spawn || cp.spawn;
  var observerBusy = false;
  function observerMarker(r) {
    if (path.dirname(r.marker) !== temp || !/^cytv-home-observe-\d+-\d+$/.test(path.basename(r.marker)))
      throw new Error('Invalid observer marker');
    return r.marker;
  }
  function read() {
    return fs.existsSync(active) ? JSON.parse(fs.readFileSync(active, 'utf8')) : null;
  }
  function save(r) {
    var pending = active + '.' + process.pid;
    fs.writeFileSync(pending, JSON.stringify(r) + '\n', { mode: parseInt('600', 8) });
    fs.renameSync(pending, active);
  }
  function log(event, data) {
    fs.appendFileSync(events, JSON.stringify({ at: new Date().toISOString(), event: event, data: data }) + '\n', {
      mode: parseInt('600', 8),
    });
  }
  function restore(id) {
    var r = read();
    if (!r || r.id !== id) return false;
    if (r.variant === 'observe') {
      var marker = observerMarker(r);
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    } else ctl.restore(r.marker);
    r.phase = 'restored';
    save(r);
    log('restored', { id: id });
    return true;
  }
  function run(variant, id, done) {
    launch(variant);
    if (!/^\d{13}-[a-f0-9]{8}$/.test(id)) throw new Error('Invalid run id');
    fs.mkdirSync(lock, parseInt('700', 8));
    var finished = false;
    var reader = null;
    var attempts = 0;
    function finish() {
      if (finished) return;
      try {
        restore(id);
        if (reader) reader.destroy();
        finished = true;
        fs.rmdirSync(lock);
        done();
      } catch (e) {
        log('restore-error', { id: id, message: e.message });
        // Only recovery is retried; app launches are never retried.
        if (++attempts < 5) timer(finish, 1000);
        else done(e);
      }
    }
    // Arm recovery before assigning HOME, including the startup failure path.
    timer(finish, 120000);
    try {
      var r;
      if (variant === 'observe') {
        var bindings = JSON.parse(fs.readFileSync(opts.binds, 'utf8'));
        if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || Object.prototype.hasOwnProperty.call(bindings, '773'))
          throw new Error('Observer requires HOME to remain assigned to LG');
        r = { marker: path.join(temp, 'cytv-home-observe-' + process.pid + '-' + Date.now()), expiresAt: Date.now() + 120000 };
        fs.writeFileSync(r.marker, id, { flag: 'wx', mode: parseInt('600', 8) });
      } else r = ctl.enable('773');
      save({
        id: id,
        variant: variant,
        phase: variant === 'observe' ? 'starting' : 'ready',
        marker: r.marker,
        expiresAt: r.expiresAt,
        presses: 0,
        lastPressAt: 0,
      });
      if (variant === 'observe') {
        reader = opts.readInput ? opts.readInput() : fs.createReadStream('/dev/input/event1', { highWaterMark: 64 });
        reader.on('open', function () {
          var current = read();
          if (finished || !current || current.id !== id || current.phase !== 'starting') return;
          current.phase = 'ready';
          save(current);
          log('ready', { id: id, variant: variant, expiresAt: r.expiresAt });
        });
        reader.on(
          'data',
          homeEvents(function () {
            // LG keeps receiving HOME; activate our launcher once after its native handling.
            timer(function () {
              press(function (error) {
                if (error) finish();
              });
            }, 300);
          })
        );
        reader.on('error', function (error) {
          log('reader-error', { id: id, code: error.code });
          finish();
        });
        reader.on('end', finish);
      } else log('ready', { id: id, variant: variant, expiresAt: r.expiresAt });
    } catch (e) {
      // enable may have written recovery state before failing to write the binding.
      if (variant === 'observe') {
        if (r && fs.existsSync(r.marker)) fs.unlinkSync(r.marker);
        if (reader) reader.destroy();
      } else ctl.restore();
      finished = true;
      fs.rmdirSync(lock);
      throw e;
    }
    function watch() {
      if (finished) return;
      var r = read();
      if (!r || r.id !== id || r.phase === 'restored' || Date.now() >= r.expiresAt || !fs.existsSync(r.marker)) return finish();
      timer(watch, 1000);
    }
    timer(watch, 1000);
    return finish;
  }
  function press(done) {
    // check must run even after expiry/reboot, to release the persistent binding.
    var r = read();
    if (r && r.variant === 'observe') {
      if (Date.now() >= r.expiresAt || !fs.existsSync(observerMarker(r))) {
        restore(r.id);
        return done();
      }
    } else if (!ctl.check()) return done();
    if (!r || r.phase !== 'ready' || Date.now() >= r.expiresAt) return done();
    if (Date.now() - r.lastPressAt < 2000) return done();
    if (r.variant === 'observe') {
      if (observerBusy) return done();
      // All observer events share one process; no filesystem lock can survive its exit.
      observerBusy = true;
    } else {
      try {
        fs.mkdirSync(pressLock, parseInt('700', 8));
      } catch (e) {
        if (e.code === 'EEXIST') return done();
        throw e;
      }
    }
    var finished = false;
    function finish(error) {
      if (finished) return;
      finished = true;
      if (r.variant === 'observe') observerBusy = false;
      else fs.rmdirSync(pressLock);
      done(error);
    }
    try {
      r.lastPressAt = Date.now();
      r.presses++;
      save(r);
      log('press', { id: r.id, variant: r.variant, count: r.presses });
      var request = launch(r.variant);
      if (!request) return finish();
      var child = spawn(request.file, request.args, { stdio: ['ignore', 'pipe', 'pipe'] });
      var output = '';
      child.stdout.on('data', function (b) {
        output = (output + b.toString()).slice(0, 4096);
      });
      child.stderr.on('data', function () {});
      child.on('error', function () {
        log('launch', { id: r.id, uncertain: true, error: 'spawn' });
        finish();
      });
      child.on('close', function (code) {
        if (finished) return;
        var reply;
        try {
          reply = JSON.parse(output);
        } catch (_) {}
        log('launch', {
          id: r.id,
          code: code,
          returnValue: reply ? reply.returnValue === true : null,
          uncertain: !reply || reply.returnValue !== true,
        });
        finish();
      });
      timer(function () {
        if (finished) return;
        child.kill('SIGKILL');
        log('launch', { id: r.id, uncertain: true, error: 'timeout' });
        finish();
      }, 11000);
    } catch (e) {
      finish(e);
    }
  }
  return { run: run, press: press, restore: restore, read: read };
}

module.exports = { create: create, launch: launch, variants: variants, homeEvents: homeEvents };
if (require.main === module) {
  var lab = create({ dir: __dirname, binds: '/home/root/.config/lginputhook/keybinds.json' });
  var end = function (error) {
    if (error) process.stderr.write(error.message + '\n');
    process.exit(error ? 1 : 0);
  };
  try {
    process.umask(parseInt('077', 8));
    var args = process.argv.slice(2);
    if (args[0] === 'run' && args.length === 3) {
      var stop = lab.run(args[1], args[2], end);
      ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(function (sig) {
        process.on(sig, stop);
      });
      process.on('uncaughtException', function (e) {
        process.stderr.write(e.message + '\n');
        stop();
      });
    } else if (args[0] === 'press' && args.length === 1) lab.press(end);
    else if (args[0] === 'restore' && args.length === 2) {
      lab.restore(args[1]);
      end();
    } else if (args[0] === 'status' && args.length === 1) {
      process.stdout.write(JSON.stringify(lab.read()) + '\n');
      end();
    } else throw new Error('Usage: home-lab.js run <variant> <id> | press | restore <id> | status');
  } catch (e) {
    end(e);
  }
}
