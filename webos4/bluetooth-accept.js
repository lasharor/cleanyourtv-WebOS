// Standalone webOS 4 audio confirmation; never pairs, launches apps or changes source settings.
'use strict';
var fs = require('fs');
var cp = require('child_process');
var crypto = require('crypto');
var SERVICE = 'com.webos.service.btaudiosrc';

function validTarget(t) {
  return (
    !!t &&
    typeof t.name === 'string' &&
    t.name.length > 0 &&
    t.name.length <= 128 &&
    !/[\x00-\x1f]/.test(t.name) &&
    typeof t.address === 'string' &&
    /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(t.address)
  );
}
function action(a, button) {
  return (
    !!a &&
    a.serviceURI === 'luna://' + SERVICE + '/' &&
    a.serviceMethod === 'onClickListener' &&
    !!a.launchParams &&
    a.launchParams.type === 3 &&
    a.launchParams.button === button &&
    Object.keys(a.launchParams).length === 2
  );
}
function matches(x, name) {
  var a = x && x.alertInfo;
  return (
    !!x &&
    x.returnValue === true &&
    x.alertAction === 'open' &&
    !!a &&
    a.sourceId === SERVICE &&
    typeof a.alertId === 'string' &&
    a.alertId.indexOf(SERVICE + '-') === 0 &&
    typeof a.message === 'string' &&
    a.message.indexOf('[' + name + '] ') === 0 &&
    Array.isArray(a.buttons) &&
    a.buttons.length === 2 &&
    !!a.buttons[0] &&
    action(a.buttons[0].action, 4) &&
    !!a.buttons[1] &&
    action(a.buttons[1].action, 5) &&
    action(a.onCloseAction, 4)
  );
}
function configured(x, target) {
  if (!x || x.returnValue !== true || !Array.isArray(x.devices)) return null;
  var own = x.devices.filter(function (d) {
    return d && d.name === target.name;
  });
  return own.length === 1 &&
    own[0].address === target.address &&
    own[0].paired === true &&
    own[0].pairing === false &&
    Array.isArray(own[0].connectedProfiles)
    ? own[0]
    : null;
}
function connected(x, target) {
  var d = configured(x, target);
  return !!d && d.connectedProfiles.indexOf('a2dp') !== -1;
}

function validUi(ui) {
  var c = ui && ui.crop;
  return (
    !!ui &&
    !!c &&
    [ui.width, ui.height, c.x, c.y, c.width, c.height].every(function (n) {
      return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 8192;
    }) &&
    c.width > 0 &&
    c.height > 0 &&
    c.x + c.width <= ui.width &&
    c.y + c.height <= ui.height &&
    /^[0-9a-f]{64}$/.test(ui.no) &&
    /^[0-9a-f]{64}$/.test(ui.yes) &&
    ui.no !== ui.yes
  );
}
function pixelState(b, ui) {
  if (!validUi(ui) || b.length < 54 || b.toString('ascii', 0, 2) !== 'BM') return 'other';
  var offset = b.readUInt32LE(10),
    width = b.readInt32LE(18),
    height = b.readInt32LE(22);
  if (width !== ui.width || height !== ui.height || b.readUInt16LE(28) !== 24 || b.readUInt32LE(30) !== 0) return 'other';
  var stride = Math.floor((width * 3 + 3) / 4) * 4,
    c = ui.crop;
  if (offset < 54 || offset + stride * height > b.length) return 'other';
  var hash = crypto.createHash('sha256');
  for (var y = c.y; y < c.y + c.height; y++) {
    var start = offset + (height - 1 - y) * stride + c.x * 3;
    hash.update(b.slice(start, start + c.width * 3));
  }
  var digest = hash.digest('hex');
  return digest === ui.no ? 'no' : digest === ui.yes ? 'yes' : 'other';
}
function create(target, call, log, capture, clock) {
  if (!validTarget(target) || typeof capture !== 'function') throw new Error('Invalid audio target/capture');
  clock = clock || { setTimeout: setTimeout, clearTimeout: clearTimeout };
  var pending = null,
    lastId = '',
    stopped = false;
  function finish(ticket, event) {
    if (stopped || pending !== ticket) return;
    clock.clearTimeout(ticket.timer);
    clock.clearTimeout(ticket.expiry);
    pending = null;
    log(event);
  }
  function begin(id) {
    var ticket = { id: id, sent: false, rightSent: false, waiting: 'focus' };
    pending = ticket;
    ticket.expiry = clock.setTimeout(function () {
      finish(ticket, ticket.sent ? 'uncertain' : 'timeout-' + (ticket.rightSent ? 'after-right-' : 'before-key-') + ticket.waiting);
    }, 15000);
    return ticket;
  }
  function wait(ticket) {
    if (stopped || pending !== ticket) return;
    clock.clearTimeout(ticket.timer);
    ticket.timer = clock.setTimeout(function () {
      examine(ticket);
    }, 500);
  }
  function key(ticket, name, done) {
    // The device may change while waiting for a boot-time dialog to gain focus.
    verify(ticket, false, function () {
      ticket.waiting = 'image';
      capture(function (err, visible) {
        if (stopped || pending !== ticket) return;
        if (err || visible !== (name === 'ENTER' ? 'yes' : 'no')) {
          wait(ticket);
          return;
        }
        ticket.waiting = 'focus';
        call('com.webos.surfacemanager/getCurrentState', {}, function (err, state) {
          if (stopped || pending !== ticket) return;
          if (err || !state || state.returnValue !== true || state.currentState !== 'alertView') {
            wait(ticket);
            return;
          }
          if (name === 'ENTER') ticket.sent = true;
          else ticket.rightSent = true;
          call('com.webos.service.networkinput/sendSpecialKey', { key: name }, function (err, reply) {
            if (stopped || pending !== ticket) return;
            if (err || !reply || reply.returnValue !== true) {
              finish(ticket, 'uncertain');
              return;
            }
            done();
          });
        });
      });
    });
  }
  function examine(ticket) {
    if (stopped || pending !== ticket) return;
    ticket.waiting = 'focus';
    call('com.webos.surfacemanager/getCurrentState', {}, function (err, state) {
      if (stopped || pending !== ticket) return;
      if (err || !state || state.returnValue !== true || state.currentState !== 'alertView') {
        wait(ticket);
        return;
      }
      ticket.waiting = 'image';
      capture(function (err, visible) {
        if (stopped || pending !== ticket) return;
        if (!err && visible === 'yes') {
          key(ticket, 'ENTER', function () {
            finish(ticket, 'accepted');
          });
        } else if (!err && visible === 'no' && !ticket.rightSent) {
          key(ticket, 'RIGHT', function () {
            examine(ticket);
          });
        } else wait(ticket);
      });
    });
  }
  function verify(ticket, startup, done) {
    ticket.waiting = 'device';
    call('com.webos.service.bluetooth2/device/getStatus', {}, function (err, status) {
      if (stopped || pending !== ticket) return;
      if (err || !connected(status, target)) {
        var own = !err && configured(status, target);
        var otherAudio =
          own &&
          status.devices.some(function (d) {
            return d && Array.isArray(d.connectedProfiles) && d.connectedProfiles.indexOf('a2dp') !== -1;
          });
        if (startup && own && !otherAudio) {
          call('com.webos.service.bluetooth2/a2dp/connect', { address: target.address }, function (err, reply) {
            finish(
              ticket,
              err
                ? 'startup-connect-uncertain'
                : reply && reply.returnValue === true
                  ? 'startup-connect-requested'
                  : 'startup-connect-unavailable'
            );
          });
        } else finish(ticket, 'skipped-device-state');
        return;
      }
      call(SERVICE + '/getConnectedDevice', {}, function (err, active) {
        if (stopped || pending !== ticket) return;
        if (err || !active || active.returnValue !== true || active.connected !== true || active.name !== target.name) {
          finish(ticket, 'skipped-active-device');
          return;
        }
        if (done) done();
        else examine(ticket);
      });
    });
  }
  return {
    stop: function () {
      stopped = true;
      if (pending) {
        clock.clearTimeout(pending.timer);
        clock.clearTimeout(pending.expiry);
      }
      pending = null;
    },
    existing: function () {
      if (stopped || pending) return;
      verify(begin('startup'), true);
    },
    handle: function (x) {
      if (stopped) return;
      if (
        pending &&
        !pending.sent &&
        x &&
        x.alertAction === 'close' &&
        (!x.alertInfo || !x.alertInfo.alertId || x.alertInfo.alertId === pending.id)
      ) {
        finish(pending, 'cancelled');
        return;
      }
      if (pending && x && x.alertAction === 'open' && x.alertInfo && x.alertInfo.alertId !== pending.id)
        finish(pending, 'cancelled-replaced');
      if (pending || !matches(x, target.name) || x.alertInfo.alertId === lastId) return;
      var ticket = begin(x.alertInfo.alertId);
      lastId = ticket.id;
      verify(ticket);
    },
  };
}

function main(file, trial) {
  var stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 63) !== 0) throw new Error('Audio config must be a private root-owned file');
  var target = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!validTarget(target) || !validUi(target.ui)) throw new Error('Invalid audio target/calibration');
  var captureDir = '/tmp/cytv-bluetooth-' + process.pid;
  fs.mkdirSync(captureDir, 448);
  var captureFile = captureDir + '/screen.bmp';
  var stopped = false,
    children = [],
    buffer = '',
    ready = false;
  var acceptor = create(
    target,
    call,
    function (event) {
      console.log('EVENT ' + event);
    },
    capture
  );
  function capture(done) {
    call('com.webos.surfacemanager/captureCompositorOutput', { output: captureFile, format: 'BMP' }, function (err, reply) {
      if (err || !reply || reply.returnValue !== true || reply.output !== captureFile) {
        done(new Error('Capture failed'));
        return;
      }
      try {
        if (fs.statSync(captureFile).size > 27000000) throw new Error('Oversized capture');
        var visible = pixelState(fs.readFileSync(captureFile), target.ui);
        fs.unlinkSync(captureFile);
        done(null, visible);
      } catch (e) {
        done(new Error('Capture invalid'));
      }
    });
  }

  function track(p) {
    children.push(p);
    p.on('exit', function () {
      var i = children.indexOf(p);
      if (i !== -1) children.splice(i, 1);
    });
    return p;
  }
  function stop(code) {
    if (stopped) return;
    stopped = true;
    acceptor.stop();
    children.slice().forEach(function (p) {
      try {
        p.kill('SIGTERM');
      } catch (e) {}
    });
    try {
      fs.unlinkSync(captureFile);
    } catch (e) {}
    try {
      fs.rmdirSync(captureDir);
    } catch (e) {}
    console.log('STOPPED');
    setTimeout(function () {
      process.exit(code);
    }, 250);
  }
  function call(method, payload, done) {
    if (stopped) return;
    var out = '',
      finished = false,
      timer;
    // A closed stdin pipe can make this firmware's luna-send exit with an empty reply; use /dev/null.
    var p = track(
      cp.spawn('luna-send', ['-n', '1', '-w', '3000', 'luna://' + method, JSON.stringify(payload)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
    function finish(err, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (!stopped) done(err, value);
    }
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', function (data) {
      if (finished) return;
      out += data;
      if (out.length > 65536) {
        p.kill('SIGTERM');
        finish(new Error('Oversized response'));
      }
    });
    p.stderr.on('data', function () {});
    p.on('error', function () {
      finish(new Error('Request process failed'));
    });
    p.on('close', function (code) {
      if (finished || stopped) return;
      if (code !== 0) {
        finish(new Error('Request failed'));
        return;
      }
      var value;
      try {
        value = JSON.parse(out);
      } catch (e) {
        finish(new Error('Invalid response'));
        return;
      }
      finish(null, value);
    });
    timer = setTimeout(function () {
      p.kill('SIGTERM');
      finish(new Error('Uncertain response'));
    }, 3500);
  }
  var sub = track(
    cp.spawn('luna-send', ['-i', 'luna://com.webos.notification/getAlertNotification', '{"subscribe":true}'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  );
  sub.on('error', function () {
    stop(1);
  });
  sub.on('exit', function () {
    if (!stopped) stop(1);
  });
  sub.stdout.setEncoding('utf8');
  sub.stdout.on('data', function (data) {
    if (stopped) return;
    buffer += data;
    if (buffer.length > 65536) {
      stop(1);
      return;
    }
    var i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      var line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      var x;
      try {
        x = JSON.parse(line);
      } catch (e) {
        stop(1);
        return;
      }
      if (!x || x.returnValue === false) {
        stop(1);
        return;
      }
      if (!ready && x.subscribed === true && x.returnValue === true) {
        ready = true;
        console.log('READY');
        acceptor.existing();
      }
      if (ready) acceptor.handle(x);
    }
  });
  sub.stderr.on('data', function () {
    stop(1);
  });
  setTimeout(function () {
    if (!ready) stop(1);
  }, 7000);
  if (trial)
    setTimeout(function () {
      stop(0);
    }, 25000);
  process.on('SIGTERM', function () {
    stop(0);
  });
  process.on('SIGINT', function () {
    stop(0);
  });
  process.on('SIGHUP', function () {
    stop(0);
  });
}

module.exports = {
  validUi: validUi,
  pixelState: pixelState,
  validTarget: validTarget,
  matches: matches,
  connected: connected,
  create: create,
};
if (require.main === module) {
  if (process.argv.length < 3 || process.argv.length > 4 || (process.argv[3] && process.argv[3] !== '--trial')) {
    console.error('Usage: node bluetooth-accept.js <private-config.json> [--trial]');
    process.exit(2);
  }
  try {
    main(process.argv[2], process.argv[3] === '--trial');
  } catch (e) {
    console.error('Bluetooth startup refused: invalid or inaccessible private config');
    process.exit(1);
  }
}
