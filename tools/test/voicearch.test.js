// Voice on a TV whose kernel is 32-bit ARM (issue 175): the recogniser is a 64-bit program, so nothing is offered or downloaded there,
// and a kernel that says armv8l or aarch64 (or a machine that is not ARM) is not judged.
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
  fs.writeFileSync(path.join(svc, 'voice', 'cytv-asr'), 'x'); // the package has the program, so install() gets as far as the kernel
  const ask = (v, act, body, method) => call(v, '/api/voice/' + act, method || 'POST', body);

  let v = load('armv7l');
  let r = await ask(v, 'status', null, 'GET');
  ok(/64-bit kernel/.test(r.j.unsupported) && /armv7l/.test(r.j.unsupported), 'a 32-bit ARM kernel: the status says why voice cannot run');
  await ask(v, 'install');
  await sleep(300);
  r = await ask(v, 'status', null, 'GET');
  ok(r.j.job.state === 'error' && /64-bit kernel/.test(r.j.job.message), 'install stops with the reason: ' + JSON.stringify(r.j.job));
  ok(!/^Install failed/.test(r.j.job.message), 'the reason is shown as it is, not as a failed download');
  ok(!fs.existsSync(path.join(process.env.CYTV_DIR, 'voice', 'tmp')), 'nothing was downloaded or unpacked');
  ok(r.j.installed === false, 'nothing is installed');

  for (const arch of ['armv8l', 'aarch64', 'x86_64', 'arm64']) {
    v = load(arch);
    r = await ask(v, 'status', null, 'GET');
    ok(r.j.unsupported === '', arch + ': a 64-bit kernel, or not an ARM TV, is not judged');
  }
});
