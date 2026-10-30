'use strict';
// Close Netflix before shutdown, once the user has returned to a confirmed native source.

function controller(current, close, log, clock) {
  clock = clock || { setTimeout: setTimeout, clearTimeout: clearTimeout };
  var visited = false;
  var pending = null;
  var stopped = false;
  function cancel() {
    if (pending) clock.clearTimeout(pending.timer);
    pending = null;
  }
  function handle(state) {
    if (stopped) return;
    var id = state && state.returnValue === true && typeof state.appId === 'string' ? state.appId : '';
    if (id === 'netflix') {
      cancel();
      visited = true;
    } else if (visited && /^(com\.webos\.app\.livetv|com\.webos\.app\.hdmi[1-4])$/.test(id || '')) {
      if (pending && pending.id === id) return;
      cancel();
      var job = { id: id, timer: null };
      pending = job;
      job.timer = clock.setTimeout(function () {
        current(function (err, fresh) {
          if (stopped || pending !== job) return;
          pending = null;
          if (err || !fresh || fresh.returnValue !== true || fresh.appId !== id) return;
          visited = false;
          close(function (closeErr) {
            if (!stopped) log(closeErr ? 'close-uncertain' : 'close-accepted');
          });
        });
      }, 2000);
    } else {
      cancel();
    }
  }
  return {
    handle: handle,
    stop: function () {
      stopped = true;
      cancel();
    },
  };
}

function reader(handle) {
  var buffer = '';
  return function (chunk) {
    buffer += chunk;
    if (buffer.length > 16384) throw new Error('subscription output too large');
    var end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      var line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) handle(JSON.parse(line));
    }
  };
}

function main() {
  var service = process.argv.length === 3 && process.argv[2] === '--service';
  if (process.argv.length !== 2 && !service) {
    console.error('Usage: netflix-source-exit.js [--service]');
    process.exitCode = 1;
    return;
  }
  var cp = require('child_process');
  var children = [];
  var stopping = false;
  var ready = false;
  var deadline;
  var startup;
  function log(event) {
    console.log(JSON.stringify({ event: event, time: Date.now() }));
  }
  function stop(code) {
    if (stopping) return;
    stopping = true;
    control.stop();
    clearTimeout(deadline);
    clearTimeout(startup);
    children.forEach(function (child) {
      try {
        child.kill('SIGTERM');
      } catch (_) {}
    });
    setTimeout(function () {
      process.exit(code);
    }, 200);
  }
  function call(method, payload, done) {
    var child = cp.spawn('luna-send', ['-n', '1', '-w', '3000', 'luna://com.webos.applicationManager/' + method, payload], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    var output = '';
    var finished = false;
    var timer = setTimeout(function () {
      finish(new Error('call timed out'));
      child.kill('SIGTERM');
    }, 4000);
    function finish(err) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      var index = children.indexOf(child);
      if (index !== -1) children.splice(index, 1);
      if (!stopping) done(err, reply);
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', function (chunk) {
      if (finished) return;
      output += chunk;
      if (output.length > 16384) {
        finish(new Error('call output too large'));
        child.kill('SIGTERM');
      }
    });
    child.stderr.resume();
    child.on('error', finish);
    var reply;
    child.on('close', function (code) {
      if (finished) return;
      try {
        reply = JSON.parse(output);
        if (code !== 0 || reply.returnValue !== true) throw new Error('call not confirmed');
        finish(null);
      } catch (err) {
        finish(err);
      }
    });
  }
  var control = controller(
    function (done) {
      call('getForegroundAppInfo', '{}', done);
    },
    function (done) {
      call('closeByAppId', '{"id":"netflix"}', done);
    },
    log
  );
  var feed = reader(function (state) {
    if (!ready && state && state.returnValue === true && state.subscribed === true && typeof state.appId === 'string') {
      ready = true;
      clearTimeout(startup);
      log('ready');
    }
    if (ready && !stopping) control.handle(state);
  });
  var subscription = cp.spawn('luna-send', ['-i', 'luna://com.webos.applicationManager/getForegroundAppInfo', '{"subscribe":true}'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(subscription);
  subscription.stdout.setEncoding('utf8');
  subscription.stdout.on('data', function (chunk) {
    if (stopping) return;
    try {
      feed(chunk);
    } catch (_) {
      log('invalid-subscription');
      stop(1);
    }
  });
  subscription.stderr.resume();
  subscription.on('error', function () {
    stop(1);
  });
  subscription.on('close', function () {
    stop(1);
  });
  startup = setTimeout(function () {
    log('not-ready');
    stop(1);
  }, 5000);
  if (!service) {
    deadline = setTimeout(function () {
      log('expired');
      stop(0);
    }, 120000);
  }
  ['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(function (signal) {
    process.on(signal, function () {
      stop(0);
    });
  });
}

module.exports = { controller: controller, reader: reader };
if (require.main === module) main();
