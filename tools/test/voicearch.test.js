// Voice and the kernel (issue 175): a 32-bit ARMv7 kernel gets the 32-bit recogniser (cytv-asr32), a 64-bit one (or a machine that is
// not ARM) the 64-bit one (cytv-asr), and an older 32-bit ARM core (armv6 and before) cannot run either: nothing is offered or downloaded.
const { ok, call, sleep, helper, memoryConfig, run } = require('./lib');
const fs = require('fs'),
  path = require('path');

const load = arch => {
  process.env.CYTV_KERNEL_ARCH = arch;
  const f = require.resolve(path.join(helper, 'voice.js'));
  delete require.cache[f];
  return require(f).create({ config: memoryConfig(), notify: { show: async () => {} } });
};

run(async () => {
  const svc = process.env.CYTV_SERVICE_DIR;
  fs.mkdirSync(path.join(svc, 'voice'));
  const ask = (v, act, body, method) => call(v, '/api/voice/' + act, method || 'POST', body);
  const tmp = path.join(process.env.CYTV_DIR, 'voice', 'tmp');

  // an ARMv6 kernel: neither program can run
  let v = load('armv6l');
  let r = await ask(v, 'status', null, 'GET');
  ok(/ARMv7 or newer/.test(r.j.unsupported) && /armv6l/.test(r.j.unsupported), 'an ARMv6 kernel: the status says why voice cannot run');
  await ask(v, 'install');
  await sleep(300);
  r = await ask(v, 'status', null, 'GET');
  ok(r.j.job.state === 'error' && /ARMv7 or newer/.test(r.j.job.message), 'install stops with the reason: ' + JSON.stringify(r.j.job));
  ok(!/^Install failed/.test(r.j.job.message), 'the reason is shown as it is, not as a failed download');
  ok(!fs.existsSync(tmp), 'nothing was downloaded or unpacked');
  ok(r.j.installed === false, 'nothing is installed');

  // a 32-bit ARMv7 kernel (the 43UP7550PTZ of issue 175): voice is offered, with the 32-bit program
  for (const arch of ['armv7l', 'armv7']) {
    v = load(arch);
    r = await ask(v, 'status', null, 'GET');
    ok(r.j.unsupported === '', arch + ': voice is offered on a 32-bit ARMv7 kernel');
  }
  fs.writeFileSync(path.join(svc, 'voice', 'cytv-asr'), 'x'); // only the 64-bit program in the package
  v = load('armv7l');
  await ask(v, 'install');
  await sleep(300);
  r = await ask(v, 'status', null, 'GET');
  ok(
    r.j.job.state === 'error' && r.j.job.message === 'This package has no voice program (cytv-asr32); update CleanYourTV first.',
    'armv7l installs the 32-bit program, so a package without it is refused: ' + r.j.job.message
  );
  ok(!fs.existsSync(tmp), 'nothing was downloaded for it');

  // a 64-bit kernel installs the 64-bit program
  fs.unlinkSync(path.join(svc, 'voice', 'cytv-asr'));
  fs.writeFileSync(path.join(svc, 'voice', 'cytv-asr32'), 'x');
  v = load('aarch64');
  await ask(v, 'install');
  await sleep(300);
  r = await ask(v, 'status', null, 'GET');
  ok(r.j.job.message === 'This package has no voice program (cytv-asr); update CleanYourTV first.', 'aarch64 installs the 64-bit program');

  for (const arch of ['armv8l', 'aarch64', 'x86_64', 'arm64']) {
    v = load(arch);
    r = await ask(v, 'status', null, 'GET');
    ok(r.j.unsupported === '', arch + ': a 64-bit kernel, or not an ARM TV, is not judged');
  }
});
