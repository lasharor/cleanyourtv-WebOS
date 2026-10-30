'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  crypto = require('crypto');
const { root, tmp, ok, run } = require('./lib');
const mkdir = require('../../helper/netcompat').mkdirp;
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
run(async () => {
  let sequence = 0;
  function fixture(options) {
    const opts = options || {},
      dir = path.join(tmp, 'runtime-' + sequence++),
      kit = path.join(dir, 'kit'),
      tv = path.join(dir, 'tv'),
      bin = path.join(dir, 'bin');
    for (const folder of [
      path.join(kit, 'webos4'),
      path.join(kit, 'scripts'),
      path.join(kit, 'artifacts'),
      path.join(tv, 'var/lib/webosbrew'),
      path.join(tv, 'usr/bin'),
      bin,
    ])
      mkdir(folder);
    for (const name of ['install.sh', 'scripts/bootstrap.sh', 'webos4/setup.sh', 'webos4/runtime-install.js'])
      fs.copyFileSync(path.join(root, name), path.join(kit, name));
    fs.writeFileSync(path.join(tv, 'usr/bin/node'), 'stock Node untouched');
    const files = { node18: 'validated ARM runtime fixture', 'lib/libtest.so.1': 'validated shared library fixture' };
    const manifest = {
      schema: 1,
      node: 'v18.17.1',
      arch: 'armv7',
      files: Object.keys(files).map(name => ({ name, size: Buffer.byteLength(files[name]), sha256: sha(files[name]) })),
    };
    const raw = JSON.stringify(manifest) + '\n';
    const profile = Object.assign({}, require('../../webos4/profile.json'), { runtimeManifestSha256: sha(raw) });
    fs.writeFileSync(path.join(kit, 'webos4/profile.json'), JSON.stringify(profile));
    fs.writeFileSync(path.join(kit, 'webos4/runtime-manifest.json'), raw);
    const mock = `var fs=require('fs'),p=require('path'),d=${JSON.stringify(dir)},name=p.basename(process.argv[1]);
if(name==='luna-send'){console.log(JSON.stringify({returnValue:true,sdkVersion:fs.existsSync(p.join(d,'bad-sdk'))?'5.0.0':'4.4.0'}));}
else {fs.appendFileSync(p.join(d,'probe'),'checked\\n');console.log(fs.existsSync(p.join(d,'bad-version'))?'v17.0.0':'v18.17.1');}`;
    for (const name of ['luna-send', 'runtime-probe'])
      fs.writeFileSync(path.join(bin, name), '#!' + process.execPath + '\n' + mock, { mode: 0o700 });
    const archive = path.join(kit, 'artifacts/node-v18.17.1-webos4-armv7.tgz');
    const code =
      "import tarfile,json,sys,io\nf=json.loads(sys.argv[2])\nwith tarfile.open(sys.argv[1],'w:gz') as t:\n for n,b in f.items():\n  i=tarfile.TarInfo(n);i.size=len(b.encode());i.mode=0o700\n  if sys.argv[3]=='link' and n=='node18':i.type=tarfile.SYMTYPE;i.linkname='/usr/bin/node';i.size=0;t.addfile(i)\n  else:t.addfile(i,io.BytesIO(b.encode()))\n";
    const packed = cp.spawnSync('python3', [
      '-c',
      code,
      archive,
      JSON.stringify(opts.missing ? { node18: files.node18 } : files),
      opts.link ? 'link' : 'regular',
    ]);
    if (packed.status) throw Error(String(packed.stderr));
    fs.writeFileSync(archive + '.sha256', sha(fs.readFileSync(archive)) + '  ' + path.basename(archive) + '\n');
    const env = Object.assign({}, process.env, { CYTV_TEST_ROOT: tv, CYTV_WEBOS4_TEST_BIN: bin });
    return {
      dir,
      kit,
      tv,
      archive,
      target: tv + profile.runtime,
      exec: () =>
        cp.spawnSync('sh', [path.join(kit, 'install.sh'), '--webos4', 'runtime-install'], { env, encoding: 'utf8', timeout: 10000 }),
      stock: () => fs.readFileSync(path.join(tv, 'usr/bin/node'), 'utf8') === 'stock Node untouched',
    };
  }
  const normal = fixture();
  let result = normal.exec();
  ok(
    result.status === 0 &&
      fs.existsSync(path.join(normal.target, 'node18')) &&
      fs.existsSync(path.join(normal.target, 'lib/libtest.so.1')) &&
      normal.stock(),
    'system-Node bootstrap installs runtime and complete libraries separately: ' + result.stderr
  );
  ok(normal.exec().status === 0 && normal.stock(), 'repeated runtime install validates and reuses the existing tree');
  const modified = fixture();
  fs.appendFileSync(modified.archive, 'corrupt');
  ok(
    modified.exec().status !== 0 && !fs.existsSync(modified.target) && modified.stock(),
    'invalid runtime checksum does not publish or replace system Node'
  );
  const badSdk = fixture();
  fs.writeFileSync(path.join(badSdk.dir, 'bad-sdk'), '1');
  ok(badSdk.exec().status !== 0 && !fs.existsSync(badSdk.target), 'unknown SDK refuses runtime installation');
  const badVersion = fixture();
  fs.writeFileSync(path.join(badVersion.dir, 'bad-version'), '1');
  ok(
    badVersion.exec().status !== 0 && !fs.existsSync(badVersion.target) && badVersion.stock(),
    'runtime is not published if its loader/version smoke fails'
  );
  const missing = fixture({ missing: true });
  ok(missing.exec().status !== 0 && !fs.existsSync(missing.target), 'incomplete shared library tree is rejected before extraction');
  const linked = fixture({ link: true });
  ok(linked.exec().status !== 0 && !fs.existsSync(linked.target) && linked.stock(), 'runtime archive links cannot replace system files');
  const manifest = fixture();
  fs.appendFileSync(path.join(manifest.kit, 'webos4/runtime-manifest.json'), ' ');
  ok(manifest.exec().status !== 0 && !fs.existsSync(manifest.target), 'unpinned runtime manifest is refused');
  fs.writeFileSync(path.join(normal.target, 'node18'), 'foreign runtime');
  ok(
    normal.exec().status !== 0 && fs.readFileSync(path.join(normal.target, 'node18'), 'utf8') === 'foreign runtime' && normal.stock(),
    'existing foreign runtime is preserved, never overwritten'
  );
});
