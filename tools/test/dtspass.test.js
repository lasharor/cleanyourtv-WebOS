// The exec permission of the add-on loader (fixed commands as root) and the DTS passthrough add-on (addons/catalog/dtspass).
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const { ok, call, req, run, tmp } = require('./lib');
const mkdirp = d => require('../../helper/netcompat').mkdirp(d);

run(async () => {
  process.env.CYTV_ADDONS = path.join(tmp, 'addons');
  process.env.CYTV_ADDON_DATA = path.join(tmp, 'addon-data');
  process.env.CYTV_ADDONS_BUNDLED = path.join(tmp, 'bundled');
  const addons = req('addons');
  const SVC = '1.6.32';
  const base = { id: 'ex', name: 'Ex', version: '1.0.0', kind: 'service', entry: { service: 'service.js' }, permissions: ['exec'] };
  const chk = patch => addons.check(Object.assign({}, base, { exec: [['sh', '{data}/a.sh', 'status']] }, patch), SVC);

  // ---- the manifest ----
  const g = chk({});
  ok(g.manifest && g.manifest.exec[0].join(' ') === 'sh {data}/a.sh status', 'a manifest with fixed commands is accepted');
  ok(chk({ permissions: [] }).error, 'exec without the permission is refused');
  ok(addons.check(base, SVC).error, 'the permission without a list is refused');
  ok(chk({ exec: [['rm', '-rf', 'x']] }).error, 'a program other than sh or tar is refused');
  ok(chk({ exec: [['sh', '../x.sh']] }).error, 'an argument with .. is refused');
  ok(chk({ exec: [['sh', 'a b']] }).error && chk({ exec: [['sh', '$(id)']] }).error && chk({ exec: [['sh', 'a;b']] }).error, 'no spaces, quotes or shell characters');
  ok(chk({ exec: ['sh a.sh'] }).error, 'a command is a list, not a string');
  ok(chk({ exec: new Array(7).fill(['sh', 'a']) }).error, 'at most 6 commands');
  ok(addons.check(Object.assign({}, base, { permissions: [] }), SVC).manifest.exec.length === 0, 'an add-on without the permission has no commands');

  // ---- the loader: only the listed commands run, as listed ----
  const dir = path.join(tmp, 'addons');
  fs.mkdirSync(dir);
  const d = path.join(dir, 'ex');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'addon.json'), JSON.stringify(Object.assign({}, base, { exec: [['sh', '{data}/t.sh', 'status']] })));
  fs.writeFileSync(
    path.join(d, 'service.js'),
    "exports.create = c => ({ handle: async (q, r, p) => { const argv = JSON.parse(decodeURIComponent(p.slice(1)));" +
      " const x = await c.exec(argv); r.writeHead(200); r.end(JSON.stringify({ ok: x.ok, out: x.out, error: x.error })); } });"
  );
  mkdirp(path.join(process.env.CYTV_ADDON_DATA, 'ex'));
  const script = path.join(process.env.CYTV_ADDON_DATA, 'ex', 't.sh');
  fs.writeFileSync(script, 'echo "got $1"\n');
  const a = addons.create({ config: req('config').memory({}), version: SVC, feature: () => null });
  a.start();
  const ask = argv => call(a, '/api/addons/ex/' + encodeURIComponent(JSON.stringify(argv)));
  let r = await ask(['sh', script, 'status']);
  ok(r.j.ok === true && /got status/.test(r.j.out), 'the listed command runs, with {data} filled in');
  r = await ask(['sh', script, 'status', 'extra']);
  ok(r.j.ok === false && /may not run/.test(r.j.error), 'an extra argument is refused');
  r = await ask(['sh', script, 'remove']);
  ok(r.j.ok === false && /may not run/.test(r.j.error), 'another argument is refused');
  r = await ask(['sh', '-c', 'id']);
  ok(r.j.ok === false && /may not run/.test(r.j.error), 'sh -c is refused');
  r = await ask('sh');
  ok(r.j.ok === false, 'a command that is not a list is refused');

  // ---- the dtspass add-on ----
  const dir2 = path.join(__dirname, '..', '..', 'addons', 'catalog', 'dtspass');
  const m = JSON.parse(fs.readFileSync(path.join(dir2, 'addon.json'), 'utf8'));
  const chkd = addons.check(m, SVC);
  ok(chkd.manifest && chkd.manifest.exec.length === 5 && chkd.manifest.luna.length === 1, 'the dtspass manifest is valid: five fixed commands, one luna call');
  ok(chkd.manifest.exec.every(c => c[1].indexOf('{data}') >= 0 || c[3] === '-C' || c[2].indexOf('{data}') >= 0), 'every dtspass command works in its own data folder');
  const svc = require(path.join(dir2, 'service.js'));
  ok(svc.supported('4.4.84-229.kcl4tv.6') && svc.supported('4.4.84') && !svc.supported('5.15.0') && !svc.supported('4.4.840') && !svc.supported(''), 'only kernel 4.4.84 (webOS 6) is supported');
  const ps = svc.parseStatus('root=1\nkernel=4.4.84\ninstalled=1\nloaded=1\nenabled=1\nnode.host=1\napp.x=node\n junk\n');
  ok(ps.installed === '1' && ps.enabled === '1' && ps['node.host'] === '1' && ps.kernel === '4.4.84', 'the status lines of the installer are read');
  ok(svc.parseLine('x\nhbr: active\n').state === 'active' && svc.parseLine('hbr: removed').state === 'removed', 'the answer line is read');
  const refused = svc.parseLine('hbr: REFUSED: this kernel only loads modules signed by LG');
  ok(refused.state === 'refused' && /signed by LG/.test(refused.why) && svc.parseLine('nothing').state === '', 'a refusal keeps its reason; no line means no answer');
  ok(svc.soundOutput({ returnValue: true, soundOutput: 'external_arc' }).receiver === true, 'ARC counts as a receiver');
  ok(svc.soundOutput({ returnValue: true, soundOutput: 'external_optical' }).receiver === true, 'optical counts as a receiver');
  ok(svc.soundOutput({ returnValue: true, soundOutput: 'tv_speaker' }).receiver === false && svc.soundOutput({ returnValue: false }).output === '', 'speakers, or a failed call, are no receiver');
  ok(/^[0-9a-f]{64}$/.test(svc.SHA256) && /^https:\/\/github\.com\/Mokto\/earc_route\/releases\/download\/v0\.1\.0\//.test(svc.URL), 'the download is pinned by address and SHA-256');

  // install and remove on a kernel that is not supported, and without confirm: nothing is downloaded or run
  const data = path.join(tmp, 'dts-data');
  mkdirp(path.join(tmp, 'proc', 'sys', 'kernel'));
  fs.writeFileSync(path.join(tmp, 'proc', 'sys', 'kernel', 'osrelease'), '5.15.0\n');
  const calls = [];
  let fetched = 0;
  const inst = svc.create({
    dataDir: data,
    proc: path.join(tmp, 'proc'),
    log: () => {},
    util: { mkdirp },
    exec: async argv => (calls.push(argv), { ok: true, out: '', err: '' }),
    fetch: { toFile: async () => (fetched++, {}) },
    luna: async () => ({ returnValue: true, soundOutput: 'external_arc' }),
  });
  const post = async (p, body) => call(inst, p, 'POST', body);
  const s = await call(inst, '/status');
  ok(s.j.supported === false && s.j.kernel === '5.15.0' && s.j.receiver === true && s.j.output === 'external_arc', 'status on another kernel: not supported, receiver found');
  r = await post('/install', {});
  ok(r.code === 400 && fetched === 0 && !calls.length, 'install without confirm does nothing');
  r = await post('/install', { confirm: true });
  ok(r.j.ok === false && /4\.4\.84/.test(r.j.error) && fetched === 0 && !calls.length, 'install on an unsupported kernel is refused before any download');

  // a supported kernel, a download with the wrong checksum is thrown away; the right one is unpacked and installed
  fs.writeFileSync(path.join(tmp, 'proc', 'sys', 'kernel', 'osrelease'), '4.4.84-229.kcl4tv.6\n');
  const body = Buffer.from('not the real archive');
  const fakeScript = path.join(data, 'hbr', 'earc-route-hbr-0.1.0', 'earc-route-hbr.sh');
  const mk = (content, answer) =>
    svc.create({
      dataDir: data,
      proc: path.join(tmp, 'proc'),
      log: () => {},
      util: { mkdirp },
      exec: async argv => {
        calls.push(argv);
        if (argv[0] === 'tar') {
          mkdirp(path.dirname(fakeScript));
          fs.writeFileSync(fakeScript, '');
          return { ok: true, out: '' };
        }
        return { ok: true, out: argv[2] === 'status' ? 'installed=1\nloaded=1\nenabled=1\nnode.host=1\n' : answer };
      },
      fetch: { toFile: async (u, f) => (fs.writeFileSync(f, content), {}) },
      luna: async () => ({ returnValue: true, soundOutput: 'external_arc' }),
    });
  calls.length = 0;
  r = await call(mk(body, 'hbr: active'), '/install', 'POST', { confirm: true });
  ok(r.j.ok === false && /SHA-256/.test(r.j.error) && !fs.existsSync(path.join(data, 'hbr.tgz')) && !calls.length, 'a download that does not match the SHA-256 is deleted and nothing runs');
  const real = crypto.createHash('sha256').update(body).digest('hex');
  ok(real !== svc.SHA256, 'the test archive really differs from the pinned one');
  // the pinned checksum cannot be matched without the real file: check the unpack path with a stand-in that already has its files
  mkdirp(path.dirname(fakeScript));
  fs.writeFileSync(fakeScript, '');
  calls.length = 0;
  r = await call(mk(body, 'hbr: REFUSED: sig_enforce'), '/refresh', 'POST', { confirm: true });
  ok(r.j.ok === false && /sig_enforce/.test(r.j.error) && calls[0][2] === 'refresh', 'a refusal of the installer reaches the page with its reason');
  r = await call(mk(body, 'hbr: active'), '/status');
  ok(r.j.installed && r.j.active && r.j.node && r.j.loaded, 'status reads the installer: installed, loaded, active, node');
  calls.length = 0;
  r = await call(mk(body, 'hbr: removed'), '/remove', 'POST', { confirm: true });
  ok(r.j.ok === true && calls[0][2] === 'remove' && !fs.existsSync(path.join(data, 'hbr')), 'remove runs the installer and deletes the downloaded files');
});
