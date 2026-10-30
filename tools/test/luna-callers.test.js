// Report and voice use the shared policy. All child processes and microphone sockets are stand-ins.
const fs = require('fs'),
  cp = require('child_process'),
  net = require('net'),
  EventEmitter = require('events');
const { ok, req, run, sleep, memoryConfig } = require('./lib');

run(async () => {
  const luna = req('luna'),
    exec = req('exec'),
    P = req('paths');
  const oldSync = luna.sync,
    oldSh = exec.shSync,
    calls = [];
  luna.sync = (uri, payload, opts) => {
    calls.push({ uri, payload, opts });
    return '{"returnValue": true}';
  };
  exec.shSync = () => '';
  try {
    const report = req('sharelog').report();
    ok(
      calls.length === 5 && calls[0].payload.keys[0] === 'modelName',
      'Share log routes all five Luna calls through the shared synchronous wrapper'
    );
    ok(
      calls.slice(1).every(c => c.opts.wait === 4000) && /registered/.test(report),
      'Share log keeps its registration waits and report shape'
    );
  } finally {
    luna.sync = oldSync;
    exec.shSync = oldSh;
  }

  const oldInterval = global.setInterval,
    oldExecFile = exec.execFile,
    foreground = [];
  let poll;
  global.setInterval = fn => {
    poll = fn;
    return 0;
  };
  exec.execFile = (cmd, args, opts, cb) => {
    foreground.push(opts);
    cb(null, '{"returnValue":false}');
  };
  try {
    req('apps')
      .create({ config: memoryConfig(), luna: async () => ({ returnValue: true }), audio: { start() {} } })
      .start();
    poll();
    fs.writeFileSync(P.D + '/luna-stdin-open', '');
    poll();
    fs.unlinkSync(P.D + '/luna-stdin-open');
    ok(
      foreground.length === 2 && !foreground[0].keepStdinOpen && foreground[1].keepStdinOpen && foreground[1].timeout === 6000,
      'foreground polling uses the shared policy and keeps its deadline'
    );
  } finally {
    global.setInterval = oldInterval;
    exec.execFile = oldExecFile;
  }

  const oldSpawn = cp.spawn,
    oldConnect = net.connect,
    streams = [];
  cp.spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.kill = signal => {
      child.signal = signal || 'SIGTERM';
      return true;
    };
    streams.push({ cmd, args, opts, child });
    setTimeout(() => child.emit('error', new Error('stand-in stream ended')), 10);
    return child;
  };
  net.connect = () => {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    return socket;
  };
  fs.mkdirSync(P.VOICE);
  for (const file of ['installed', 'cytv-asr']) fs.writeFileSync(P.VOICE + '/' + file, '');
  try {
    const voice = req('voice').create({ config: memoryConfig(), notify: { show: async () => {} } });
    await voice.listen();
    await sleep(40);
    fs.writeFileSync(P.D + '/luna-stdin-open', '');
    await voice.listen();
    await sleep(40);
    ok(
      streams.length === 2 && streams[0].opts.stdio[0] === 'ignore' && streams[1].opts.stdio[0] === 'pipe',
      'optional voice capture follows the shared default and persistent opt-in'
    );
    ok(
      streams.length === 2 && streams.every(s => s.args[0] === '-i' && s.child.signal === 'SIGTERM'),
      'voice keeps its subscription and termination behavior without opening a microphone'
    );
  } finally {
    cp.spawn = oldSpawn;
    net.connect = oldConnect;
  }
});
