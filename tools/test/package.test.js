// The release files (ipk/build.py, built into a temporary folder): what the TV gets, and what it must not get.
const fs = require('fs'),
  path = require('path'),
  zlib = require('zlib'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');

// the file names in a .tar.gz
function tarNames(buf) {
  const t = zlib.gunzipSync(buf),
    out = [];
  for (let o = 0; o + 512 <= t.length; ) {
    const name = t.toString('utf8', o, o + 100).replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(
      t
        .toString('utf8', o + 124, o + 136)
        .replace(/\0.*$/, '')
        .trim() || '0',
      8
    );
    out.push(name.replace(/^\.\//, ''));
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
// the members of an .ipk (an ar archive)
function arMembers(buf) {
  const out = {};
  for (let o = 8; o + 60 <= buf.length; ) {
    const name = buf
        .toString('utf8', o, o + 16)
        .trim()
        .replace(/\/$/, ''),
      size = parseInt(buf.toString('utf8', o + 48, o + 58).trim(), 10);
    out[name] = buf.slice(o + 60, o + 60 + size);
    o += 60 + size + (size % 2);
  }
  return out;
}

run(async () => {
  if (cp.spawnSync('python3', ['--version']).status !== 0) return ok(true, 'skipped: python3 is not installed');
  const dist = path.join(tmp, 'dist');
  const b = cp.spawnSync('python3', [path.join(root, 'ipk', 'build.py')], {
    cwd: root,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CYTV_DIST: dist }),
  });
  ok(b.status === 0, 'the package builds' + (b.status ? ': ' + b.stderr : ''));
  if (b.status) return;
  const files = fs.readdirSync(dist);
  const fe = files.filter(f => /^frontend-.*\.tgz$/.test(f))[0],
    ipk = files.filter(f => /\.ipk$/.test(f))[0];
  ok(
    fe && ipk && files.indexOf(fe + '.sha256') >= 0 && files.indexOf(ipk + '.sha256') >= 0,
    'the launcher, the package and their .sha256 files'
  );
  // the Homebrew Channel repository: the package of this release with its size and checksum
  const repo = JSON.parse(fs.readFileSync(path.join(dist, 'apps.json'), 'utf8')),
    man = JSON.parse(fs.readFileSync(path.join(dist, 'com.cleanyourtv.manager.manifest.json'), 'utf8')),
    ipkBuf = fs.readFileSync(path.join(dist, ipk));
  ok(
    repo.packages.length === 1 &&
      repo.packages[0].manifest.ipkHash.sha256 === require('crypto').createHash('sha256').update(ipkBuf).digest('hex') &&
      man.ipkSize === ipkBuf.length &&
      man.ipkUrl.endsWith('/' + ipk) &&
      repo.packages[0].manifestUrl.endsWith('/com.cleanyourtv.manager.manifest.json') &&
      man.rootRequired === true &&
      man.version === ipk.split('_')[1],
    'the Homebrew Channel repository (apps.json and the manifest) names this package, its size and checksum'
  );
  const feNames = tarNames(fs.readFileSync(path.join(dist, fe)));
  ok(feNames.indexOf('app/index.html') >= 0 && feNames.indexOf('app/version.json') >= 0, 'the launcher download holds the built page');
  ok(!feNames.some(n => /^app\/src\//.test(n)), "the launcher's source files are not shipped (they are built into index.html)");
  const data = tarNames(arMembers(fs.readFileSync(path.join(dist, ipk)))['data.tar.gz']);
  const svc = data.filter(n => /services\/com\.cleanyourtv\.manager\.service\//.test(n));
  ok(
    svc.some(n => /\/helper\/helper\.js$/.test(n)) &&
      svc.some(n => /\/helper\/tvprofile\.js$/.test(n)) &&
      svc.some(n => /\/bootstrap\.sh$/.test(n)),
    'the package holds the service and the setup'
  );
  ok(
    !data.some(n => /payload\/app\/src\//.test(n)),
    "the package's launcher has no source files either (the setup warned: omitting directory)"
  );
  ok(!data.some(n => /node_modules|\.lint-pages|\/tools\//.test(n)), 'no development files in the package');
  // the manager's launcher update reloads Home the way that also works on webOS 6 (issue 9)
  const upd = fs.readFileSync(path.join(root, 'helper', 'updates.js'), 'utf8');
  ok(
    /reload-home\.sh/.test(upd) && !/pkill -f "\[a\]pp-id=com\.webos\.app\.home"/.test(upd),
    'a launcher update reloads Home with reload-home.sh (webOS 6 restarts webapp-mgr)'
  );
  const w4dist = path.join(tmp, 'webos4');
  const w4 = cp.spawnSync('python3', [path.join(root, 'webos4/build.py')], {
    cwd: root,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CYTV_DIST: w4dist }),
  });
  ok(w4.status === 0, 'the standalone webOS 4 package builds' + (w4.status ? ': ' + w4.stderr : ''));
  if (w4.status) return;
  const w4files = fs.readdirSync(w4dist);
  const w4ipk = w4files.filter(f => /\.ipk$/.test(f))[0];
  const bundle = w4files.filter(f => /\.tgz$/.test(f) && !/-addons-/.test(f))[0];
  const addons = w4files.filter(f => /-addons-.*\.tgz$/.test(f))[0];
  const addonFiles = tarNames(fs.readFileSync(path.join(w4dist, addons)));
  ok(
    addonFiles.indexOf('webos4/debloat-stop.sh') >= 0 &&
      addonFiles.indexOf('webos4/debloat-undo.sh') >= 0 &&
      addonFiles.indexOf('webos4/generate-home-patch.py') >= 0 &&
      addonFiles.indexOf('webos4/research-debloat/debloat-stop.sh') >= 0 &&
      addonFiles.indexOf('webos4/research-debloat/debloat-undo.sh') >= 0 &&
      addonFiles.indexOf('webos4/research-debloat/README.md') >= 0 &&
      addonFiles.indexOf('webos4/keyfilters-original.json') >= 0 &&
      addonFiles.indexOf('webos4/keyfilters-cleanyourtv.json') >= 0 &&
      !addonFiles.some(n => /systemUi|runtime\/|state\//.test(n)),
    'optional tools include reversible debloat, HOME generation and reload templates without LG firmware or private state'
  );
  ok(
    [w4ipk, bundle, addons].every(name => w4files.indexOf(name + '.sha256') >= 0),
    'all three standalone artifacts have checksums'
  );
  ok(
    [w4ipk, bundle, addons].every(name => {
      const sum = fs.readFileSync(path.join(w4dist, name + '.sha256'), 'utf8');
      const hash = require('crypto')
        .createHash('sha256')
        .update(fs.readFileSync(path.join(w4dist, name)))
        .digest('hex');
      return sum === hash + '  ' + name + '\n';
    }),
    'standalone checksums match the artifacts and use Unix line endings on every host'
  );
  const w4data = tarNames(arMembers(fs.readFileSync(path.join(w4dist, w4ipk)))['data.tar.gz']);
  ok(!w4data.some(n => n.indexOf('/assets/icons/') >= 0), 'the standalone IPK does not redistribute third-party app artwork');
  ok(
    w4data.some(n => /applications\/com\.cleanyourtv\.webos4\/index.html$/.test(n)) &&
      w4data.some(n => /applications\/com\.cleanyourtv\.webos4\/icon.png$/.test(n)) &&
      w4data.some(n => /applications\/com\.cleanyourtv\.webos4\/LICENSE$/.test(n)) &&
      !w4data.some(n => /services\/|\\|bootstrap|init.d/.test(n)),
    'the standalone IPK contains a web app and no service, boot scripts or Windows paths'
  );
  const manual = tarNames(fs.readFileSync(path.join(w4dist, bundle)));
  ok(
    manual.indexOf('helper/webos4.js') >= 0 &&
      manual.indexOf('webos4/service.sh') >= 0 &&
      ['home-bind.js', 'home-lab.js', 'home-lab.sh', 'test-home.py', 'Probar-HOME.cmd'].every(
        name => manual.indexOf('webos4/' + name) >= 0
      ) &&
      !manual.some(n => /bootstrap|inputhook|manager|notify|voice|runtime\//.test(n)),
    'the helper bundle excludes advanced features, boot hooks and third-party runtimes'
  );
  const missing = [];
  for (const name of manual.filter(n => /^helper\/.+\.js$/.test(n))) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    source.replace(/require\('\.\/([^']+)'\)/g, (_, dep) => {
      if (dep !== 'cards' && dep !== 'audio' && manual.indexOf('helper/' + dep + '.js') < 0) missing.push(dep);
      return '';
    });
  }
  ok(!missing.length, 'every helper dependency is present in the manual bundle: ' + missing.join(', '));
  const originalDist = path.join(tmp, 'original-kit');
  const original = cp.spawnSync('python3', [path.join(root, 'webos4/build-original.py')], {
    cwd: root,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CYTV_DIST: originalDist }),
  });
  ok(original.status === 0, 'the original UI installer kit builds separately: ' + (original.stderr || ''));
  if (original.status) return;
  const originalFiles = tarNames(fs.readFileSync(path.join(originalDist, 'cleanyourtv-original-helper.tgz')));
  const kitFiles = tarNames(fs.readFileSync(path.join(originalDist, 'cleanyourtv-webos4-install-kit.tgz')));
  const payload = JSON.parse(fs.readFileSync(path.join(originalDist, 'payload-manifest.json'), 'utf8'));
  ok(
    originalFiles.indexOf('helper/webos4.js') >= 0 &&
      originalFiles.indexOf('helper/webos4-original.js') >= 0 &&
      originalFiles.slice().sort().join() ===
        payload.files
          .map(file => file.name)
          .sort()
          .join() &&
      !originalFiles.some(name => /helper\/(manager|updates|selfupdate|inputhook|voice)\.js$|node18|init\.d|systemUi/.test(name)),
    'the original helper manifest exactly covers its isolated modules and validated bridge, excluding incompatible services'
  );
  ok(
    [
      'install.sh',
      'scripts/bootstrap.sh',
      'scripts/check-tv.sh',
      'webos4/setup.sh',
      'webos4/setup.js',
      'webos4/profile.json',
      'webos4/runtime-install.js',
      'webos4/runtime-manifest.json',
      'artifacts/payload-manifest.json',
      'artifacts/cleanyourtv-original-helper.tgz',
    ].every(name => kitFiles.indexOf(name) >= 0) &&
      !kitFiles.some(name => /(^|\/)node18$|runtime\/|state\/|systemUi/.test(name)) &&
      fs
        .readdirSync(originalDist)
        .filter(name => /\.(tgz|ipk|json)$/.test(name))
        .every(name => {
          const digest = require('crypto')
            .createHash('sha256')
            .update(fs.readFileSync(path.join(originalDist, name)))
            .digest('hex');
          return fs.readFileSync(path.join(originalDist, name + '.sha256'), 'utf8') === digest + '  ' + name + '\n';
        }),
    'the kit includes both installer dispatchers and runtime bootstrap, has correct checksums and excludes unsupplied/private binaries'
  );
});
