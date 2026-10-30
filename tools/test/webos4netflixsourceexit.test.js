'use strict';
const { ok, run, tmp, root } = require('./lib');
const trial = require('../../webos4/netflix-source-exit');
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');

run(async () => {
  function harness() {
    let timer,
      query,
      closes = 0,
      queries = 0;
    const logs = [];
    const control = trial.controller(
      done => {
        queries++;
        query = done;
      },
      done => {
        closes++;
        done(new Error('uncertain'));
      },
      event => logs.push(event),
      {
        setTimeout: (fn, ms) => {
          timer = fn;
          ok(ms === 2000, 'source must settle for two seconds');
          return fn;
        },
        clearTimeout: id => {
          if (timer === id) timer = null;
        },
      }
    );
    return {
      state: id => control.handle({ returnValue: true, appId: id }),
      control,
      logs,
      tick: () => {
        const fn = timer;
        timer = null;
        if (fn) fn();
      },
      reply: (id, err) => query(err, { returnValue: true, appId: id }),
      closes: () => closes,
      queries: () => queries,
    };
  }
  const h = harness();
  h.state('com.webos.app.hdmi1');
  h.tick();
  ok(h.queries() === 0, 'startup on a source never closes an existing background app');
  h.state('netflix');
  for (const id of [
    'com.webos.app.home',
    'com.webos.app.settings',
    'youtube.leanback.v4',
    'com.webos.app.hdmi5',
    'com.webos.app.hdmi1.extra',
  ]) {
    h.state(id);
    h.tick();
  }
  ok(h.queries() === 0, 'menus, other apps and unknown sources never trigger a close');
  h.state('com.webos.app.hdmi1');
  h.state('com.webos.app.hdmi1');
  ok(h.queries() === 0 && h.closes() === 0, 'duplicate notifications do not bypass the settling delay');
  h.tick();
  h.state('com.webos.app.hdmi1');
  ok(h.queries() === 1 && h.closes() === 0, 'one fresh foreground query is required, including while duplicates arrive');
  h.reply('com.webos.app.hdmi1');
  h.state('com.webos.app.hdmi1');
  h.tick();
  ok(
    h.closes() === 1 && h.logs[0] === 'close-uncertain' && h.queries() === 1,
    'uncertain close is never retried without another Netflix visit'
  );

  for (const id of ['com.webos.app.livetv', 'com.webos.app.hdmi1', 'com.webos.app.hdmi2', 'com.webos.app.hdmi3', 'com.webos.app.hdmi4']) {
    const a = harness();
    a.state('netflix');
    a.state(id);
    a.tick();
    a.reply(id);
    ok(a.closes() === 1, 'only a confirmed allowed source closes Netflix: ' + id);
  }
  const cancel = harness();
  cancel.state('netflix');
  cancel.state('com.webos.app.livetv');
  cancel.state('netflix');
  cancel.tick();
  ok(cancel.queries() === 0, 'returning to Netflix cancels the pending timer');
  cancel.state('com.webos.app.livetv');
  cancel.tick();
  cancel.state('netflix');
  cancel.reply('com.webos.app.livetv');
  ok(cancel.closes() === 0, 'returning during the query invalidates its late reply');
  const mismatch = harness();
  mismatch.state('netflix');
  mismatch.state('com.webos.app.hdmi1');
  mismatch.tick();
  mismatch.reply('netflix');
  ok(mismatch.closes() === 0, 'a fresh foreground mismatch fails closed');
  mismatch.state('com.webos.app.hdmi1');
  mismatch.tick();
  mismatch.reply('com.webos.app.hdmi1', new Error('query failed'));
  ok(mismatch.closes() === 0, 'a failed foreground query cannot close Netflix');
  const invalid = harness();
  invalid.state('netflix');
  invalid.state('com.webos.app.hdmi1');
  invalid.control.handle({ returnValue: false });
  invalid.tick();
  ok(invalid.queries() === 0, 'invalid subscription data cancels a pending close');
  const stopped = harness();
  stopped.state('netflix');
  stopped.state('com.webos.app.hdmi1');
  stopped.control.stop();
  stopped.tick();
  ok(stopped.queries() === 0, 'stop cancels the settling timer');
  const late = harness();
  late.state('netflix');
  late.state('com.webos.app.hdmi1');
  late.tick();
  late.control.stop();
  late.reply('com.webos.app.hdmi1');
  ok(late.closes() === 0, 'stop also invalidates an in-flight foreground query');

  const values = [];
  const feed = trial.reader(value => values.push(value));
  feed('{"returnValue":tr');
  ok(values.length === 0, 'partial records do not trigger actions');
  feed('ue,"appId":"netflix"}\r\n\n{"appId":"com.webos.app.livetv"}\n');
  ok(values.length === 2 && values[0].returnValue === true, 'fragmented and batched records are parsed independently');
  for (const value of ['x'.repeat(16385), 'invalid\n']) {
    let failed = false;
    try {
      trial.reader(() => {})(value);
    } catch (_) {
      failed = true;
    }
    ok(failed, 'oversized or malformed subscription data fails closed');
  }

  if (process.platform !== 'win32') {
    const bin = path.join(tmp, 'bin'),
      calls = path.join(tmp, 'calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'luna-send'),
      '#!' +
        process.execPath +
        '\n' +
        'var fs=require("fs");\n' +
        'if(process.argv[2]==="-i") {\n' +
        'console.log(JSON.stringify({returnValue:true,subscribed:true,appId:"netflix"}));\n' +
        'setTimeout(function(){console.log(JSON.stringify({returnValue:true,appId:"com.webos.app.hdmi1"}));},50);\n' +
        'setTimeout(function(){console.log(JSON.stringify({returnValue:true,appId:"com.webos.app.hdmi1"}));},100);\n' +
        'setInterval(function(){},1000);\n' +
        '} else {fs.appendFileSync(process.env.CYTV_TEST_CALLS,JSON.stringify(process.argv.slice(2))+"\\n");console.log(JSON.stringify({returnValue:true,appId:"com.webos.app.hdmi1"}));}\n'
    );
    fs.chmodSync(path.join(bin, 'luna-send'), 0o755);
    const child = cp.spawn(process.execPath, [path.resolve(__dirname, '../../webos4/netflix-source-exit.js')], {
      env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH, CYTV_TEST_CALLS: calls }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = await new Promise(resolve => {
      let output = '',
        accepted = false;
      const timeout = setTimeout(() => child.kill('SIGTERM'), 7000);
      child.stdout.on('data', data => {
        output += data;
        if (!accepted && /close-accepted/.test(output)) {
          accepted = true;
          setTimeout(() => child.kill('SIGTERM'), 300);
        }
      });
      child.stderr.resume();
      child.on('close', code => {
        clearTimeout(timeout);
        resolve({ code, output });
      });
    });
    const requests = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [];
    ok(
      result.code === 0 && /ready/.test(result.output) && /close-accepted/.test(result.output),
      'real trial subscribes, queries, closes and stops through SIGTERM'
    );
    ok(
      requests.length === 2 &&
        requests[0][4] === 'luna://com.webos.applicationManager/getForegroundAppInfo' &&
        requests[0][5] === '{}' &&
        requests[1][4] === 'luna://com.webos.applicationManager/closeByAppId' &&
        requests[1][5] === '{"id":"netflix"}',
      'real process sends one foreground query then only the fixed Netflix close'
    );

    const program = path.resolve(__dirname, '../../webos4/netflix-source-exit.js');
    ok(cp.spawnSync(process.execPath, [program, '--unknown']).status === 1, 'unknown runtime modes cannot start an observer');
    const wrapper = path.join(tmp, 'netflix.sh'),
      boot = path.join(tmp, 'boot'),
      pidfile = path.join(tmp, 'service.pid');
    fs.copyFileSync(program, path.join(tmp, 'netflix-source-exit.js'));
    fs.copyFileSync(path.join(root, 'webos4/30-cleanyourtv-netflix'), path.join(tmp, '30-cleanyourtv-netflix'));
    fs.writeFileSync(
      wrapper,
      fs
        .readFileSync(path.join(root, 'webos4/netflix.sh'), 'utf8')
        .replace(/\/usr\/bin\/node/g, process.execPath)
        .replace('/tmp/cytv-netflix.start', path.join(tmp, 'lock'))
        .replace('/var/lib/webosbrew/init.d/30-cleanyourtv-netflix', boot)
    );
    const env = Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH, CYTV_TEST_CALLS: calls });
    function shell(action) {
      return cp.spawnSync('sh', [wrapper, action], { env, encoding: 'utf8' });
    }
    ok(
      cp.spawnSync('sh', ['-n', wrapper]).status === 0 && cp.spawnSync('sh', ['-n', path.join(tmp, '30-cleanyourtv-netflix')]).status === 0,
      'service controller and isolated boot entry parse'
    );
    fs.writeFileSync(boot, 'unrelated boot entry');
    ok(
      shell('enable').status !== 0 && fs.readFileSync(boot, 'utf8') === 'unrelated boot entry' && !fs.existsSync(pidfile),
      'an unrelated boot entry blocks installation without starting a process'
    );
    fs.unlinkSync(boot);
    try {
      ok(
        shell('enable').status === 0 && fs.existsSync(boot) && /running\nboot-enabled/.test(shell('status').stdout),
        'enable starts the owned service and creates its exact boot entry'
      );
      const identity = fs.readFileSync(pidfile, 'utf8');
      ok(
        shell('start').stdout.trim() === 'already-running' && fs.readFileSync(pidfile, 'utf8') === identity,
        'repeated start reuses the same process'
      );
      const parts = identity.trim().split(' ');
      fs.writeFileSync(pidfile, parts[0] + ' ' + (Number(parts[1]) + 1) + '\n');
      ok(
        /^stopped\n/.test(shell('status').stdout) && shell('stop').status === 0,
        'a reused PID with the wrong start time is not treated as owned'
      );
      process.kill(Number(parts[0]), 0);
      fs.writeFileSync(pidfile, identity);
      ok(
        shell('disable').status === 0 &&
          !fs.existsSync(boot) &&
          !fs.existsSync(pidfile) &&
          /^stopped\nboot-disabled/.test(shell('status').stdout),
        'disable removes only the owned boot entry and stops the verified service'
      );
    } finally {
      shell('disable');
    }
  }
});
