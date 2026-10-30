// Luna's opt-in stdin workaround must not change the default or interpolate payloads into a shell.
const fs = require('fs');
const { ok, req, run } = require('./lib');
const exec = req('exec'),
  luna = req('luna');

run(async () => {
  const oldRun = exec.run,
    oldStdin = process.env.CYTV_LUNA_STDIN,
    calls = [];
  exec.run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { out: '{"returnValue":true}' };
  };
  try {
    delete process.env.CYTV_LUNA_STDIN;
    await luna('luna://example/query', {});
    ok(calls[0].cmd === '/bin/sh' && /<\/dev\/null/.test(calls[0].args[1]), 'closed stdin remains the default');
    const flag = req('paths').D + '/luna-stdin-open';
    fs.writeFileSync(flag, '');
    ok(luna.keepStdinOpen(), 'a persistent flag enables the workaround without a boot environment edit');
    process.env.CYTV_LUNA_STDIN = 'closed';
    ok(!luna.keepStdinOpen(), 'an explicit closed environment overrides the flag');
    delete process.env.CYTV_LUNA_STDIN;
    ok(!luna.keepStdinOpen({ keepStdinOpen: false }), 'a per-call false overrides the persistent flag');
    fs.unlinkSync(flag);
    ok(!luna.keepStdinOpen(), 'removing the flag restores closed stdin without restarting the helper');
    fs.mkdirSync(flag);
    ok(!luna.keepStdinOpen(), 'a directory is not a flag, matching the shell decision');
    fs.rmdirSync(flag);
    const payload = { text: 'single\' double" $(not-a-command); <data>' };
    process.env.CYTV_LUNA_STDIN = 'open';
    const reply = await luna('luna://example/query', payload, { wait: 1234, timeout: 2345 });
    const c = calls[1];
    ok(reply.returnValue && c.cmd === '/usr/bin/luna-send' && c.opts.keepStdinOpen === true, 'environment opt-in uses an open pipe');
    ok(c.args[c.args.length - 1] === JSON.stringify(payload), 'the payload is a separate argument, not shell source');
    ok(c.args.indexOf('1234') >= 0 && c.opts.timeout === 2345, 'both Luna and process time limits are preserved');
    await luna('luna://example/query', {}, { keepStdinOpen: false });
    ok(calls[2].cmd === '/bin/sh', 'an explicit false overrides the environment opt-in');
    delete process.env.CYTV_LUNA_STDIN;
    await luna('luna://example/query', {}, { keepStdinOpen: true });
    ok(calls[3].cmd === '/usr/bin/luna-send' && calls[3].opts.timeout === 8000, 'a per-call opt-in retains the default deadline');
    exec.run = async () => ({ out: 'not JSON', error: 'test failure' });
    const bad = await luna('luna://example/query', {}, { keepStdinOpen: true });
    ok(bad.returnValue === false && typeof bad.errorText === 'string', 'invalid replies still resolve to a structured error');
  } finally {
    exec.run = oldRun;
    if (oldStdin === undefined) delete process.env.CYTV_LUNA_STDIN;
    else process.env.CYTV_LUNA_STDIN = oldStdin;
  }
});
