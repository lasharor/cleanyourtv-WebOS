// Bootstrap for system Node 0.12. Installs only the exact previously validated runtime in a private directory.
'use strict';
var fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  crypto = require('crypto');
var profile = require('./profile.json');
var prefix = process.env.CYTV_TEST_ROOT || '';
var target = prefix + profile.runtime;
var manifestFile = path.join(__dirname, 'runtime-manifest.json');
function hash(file) {
  var digest = crypto.createHash('sha256'),
    fd = fs.openSync(file, 'r'),
    buffer = new Buffer(1024 * 1024),
    count;
  try {
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.slice(0, count));
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest('hex');
}
function run(program, args) {
  var env = process.env;
  if (prefix && env.CYTV_WEBOS4_TEST_BIN) {
    env = {};
    Object.keys(process.env).forEach(function (key) {
      env[key] = process.env[key];
    });
    env.PATH = process.env.CYTV_WEBOS4_TEST_BIN + ':' + process.env.PATH;
  }
  var r = cp.spawnSync(program, args, { env: env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
  if (r.error || r.status !== 0) throw Error(program + ' failed: ' + String(r.error || r.stderr || '').slice(0, 120));
  return r.stdout;
}
function verify(directory, manifest) {
  manifest.files.forEach(function (entry) {
    var file = path.join(directory, entry.name),
      stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== entry.size || hash(file) !== entry.sha256)
      throw Error('Runtime file differs: ' + entry.name);
  });
  if (!prefix) {
    var fd = fs.openSync(path.join(directory, 'node18'), 'r'),
      header = new Buffer(20);
    try {
      fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (header.slice(0, 4).toString() !== '\x7fELF' || header[4] !== 1 || header[5] !== 1 || header.readUInt16LE(18) !== 40)
      throw Error('Not the validated 32-bit ARM runtime');
  }
}
function version(directory) {
  var value = run(prefix ? path.join(process.env.CYTV_WEBOS4_TEST_BIN, 'runtime-probe') : '/lib/ld-linux.so.3', [
    '--library-path',
    path.join(directory, 'lib') + ':/lib:/usr/lib',
    path.join(directory, 'node18'),
    '--version',
  ]).trim();
  if (value !== profile.node) throw Error('Runtime load/version check failed');
}
function main() {
  if (hash(manifestFile) !== profile.runtimeManifestSha256) throw Error('Untrusted runtime manifest');
  var manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (
    manifest.schema !== 1 ||
    manifest.node !== profile.node ||
    manifest.arch !== 'armv7' ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw Error('Unknown runtime manifest');
  var names = manifest.files.map(function (entry) {
    if (typeof entry.name !== 'string' || !/^(node18|lib\/[\w.+-]+)$/.test(entry.name) || !/^[a-f0-9]{64}$/.test(entry.sha256 || ''))
      throw Error('Unsafe runtime entry');
    return entry.name;
  });
  if (
    names.indexOf('node18') < 0 ||
    names.filter(function (name, i) {
      return names.indexOf(name) !== i;
    }).length
  )
    throw Error('Invalid runtime file set');
  var info = JSON.parse(
    run('luna-send', ['-n', '1', '-w', '5000', 'luna://com.webos.service.tv.systemproperty/getSystemInfo', '{"keys":["sdkVersion"]}'])
  );
  if (info.returnValue !== true || info.sdkVersion !== profile.sdk) throw Error('Unknown SDK: runtime unchanged');
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink()) throw Error('Runtime destination is a symlink');
    verify(target, manifest);
    version(target);
    console.log('Validated isolated runtime already installed');
    return;
  }
  var archive = path.join(__dirname, '../artifacts/node-v18.17.1-webos4-armv7.tgz');
  var sum = fs
    .readFileSync(archive + '.sha256', 'utf8')
    .trim()
    .split(/\s+/);
  if (sum.length !== 2 || sum[1] !== path.basename(archive) || hash(archive) !== sum[0]) throw Error('Runtime archive checksum mismatch');
  var listed = run('tar', ['-tzf', archive]).trim().split('\n');
  var types = run('tar', ['-tvzf', archive]).trim().split('\n');
  if (
    types.some(function (line) {
      return line[0] !== '-';
    }) ||
    listed.sort().join('\n') !== names.slice().sort().join('\n')
  )
    throw Error('Unexpected runtime archive entries/links');
  var parent = path.dirname(target),
    ancestor = path.dirname(parent);
  if (!fs.lstatSync(ancestor).isDirectory() || fs.lstatSync(ancestor).isSymbolicLink()) throw Error('Unknown runtime parent');
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, 448);
  if (!fs.lstatSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink() || fs.statSync(parent).mode & 18)
    throw Error('Unsafe runtime directory permissions');
  var lock = path.join(parent, '.install-lock');
  fs.mkdirSync(lock, 448);
  var stage = path.join(parent, '.stage-' + process.pid + '-' + Date.now());
  try {
    fs.mkdirSync(stage, 448);
    run('tar', ['-xzf', archive, '-C', stage]);
    verify(stage, manifest);
    fs.chmodSync(path.join(stage, 'node18'), 448);
    version(stage);
    fs.renameSync(stage, target);
    console.log('Node ' + profile.node + ' and validated libraries installed in a private directory; system Node untouched');
  } finally {
    fs.rmdirSync(lock);
  }
}
if (require.main === module) {
  process.umask(63);
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { main: main, hash: hash, verify: verify };
