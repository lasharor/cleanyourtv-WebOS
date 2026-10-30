// Version-specific original installer branch. No stable-file writes, boot changes or graphics restarts.
'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  crypto = require('crypto'),
  net = require('net');
const profile = require('./profile.json');
const prefix = process.env.CYTV_TEST_ROOT || '';
const directory = prefix + profile.directory;
const marker = path.join(directory, 'installation.json');
const kit = path.resolve(__dirname, '..');
const artifactDir = path.join(kit, 'artifacts');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function run(command, args) {
  const env =
    prefix && process.env.CYTV_WEBOS4_TEST_BIN
      ? Object.assign({}, process.env, { PATH: process.env.CYTV_WEBOS4_TEST_BIN + ':' + process.env.PATH })
      : process.env;
  const result = cp.spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 35000,
    maxBuffer: 2 << 20,
  });
  if (result.error || result.status !== 0)
    throw new Error(command + ' failed: ' + (result.error || result.stderr || '').toString().slice(0, 180));
  return result.stdout;
}
function luna(method, body) {
  return JSON.parse(run('luna-send', ['-n', '1', '-w', '10000', 'luna://' + method, JSON.stringify(body)]));
}
function service(port) {
  return JSON.parse(run('curl', ['-fsS', '--max-time', '2', 'http://127.0.0.1:' + port + '/api/service']));
}
function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(value) {
  fs.writeFileSync(marker + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(marker + '.tmp', marker);
}
function receipt() {
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Foreign installation path');
  const value = read(marker);
  if (value.appId !== profile.appId || value.schema !== 1) throw Error('Unowned installation');
  return value;
}
function identity(pid) {
  if (!Number.isInteger(pid) || pid < 2) return null;
  try {
    const base = '/proc/' + pid;
    if (
      fs
        .readFileSync(base + '/cmdline', 'utf8')
        .split('\0')
        .indexOf(path.join(directory, 'helper/webos4-original.js')) < 0
    )
      return null;
    const stat = fs.readFileSync(base + '/stat', 'utf8');
    return { pid, start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] };
  } catch (_) {
    return null;
  }
}
function ownedProcess(value) {
  const live = value.process && identity(value.process.pid);
  return live && live.start === value.process.start ? live : null;
}
function registered() {
  const result = luna('com.webos.applicationManager/getAppInfo', { id: profile.appId });
  return result.returnValue === true && result.appInfo && result.appInfo.id === profile.appId;
}
function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(Error('Service port occupied; owner left alone')));
    server.listen(port || profile.port, '127.0.0.1', () => server.close(resolve));
  });
}
async function preflight() {
  if (!prefix && process.version !== profile.node) throw Error('Unexpected isolated runtime');
  const info = luna('com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['sdkVersion'] });
  if (info.returnValue !== true || info.sdkVersion !== profile.sdk) throw Error('Unknown SDK: nothing installed');
  try {
    const stable = service(profile.stablePort);
    if (stable.version === '0.2.0' && stable.readOnly === false && stable.node === profile.node) return true;
  } catch (_) {}
  await freePort(profile.stablePort);
  return false;
}
function artifact(name) {
  const file = path.join(artifactDir, name),
    content = fs.readFileSync(file);
  const checksum = fs
    .readFileSync(file + '.sha256', 'utf8')
    .trim()
    .split(/\s+/);
  if (checksum.length !== 2 || checksum[1] !== name || !/^[a-f0-9]{64}$/.test(checksum[0]) || sha(content) !== checksum[0])
    throw Error('Artifact checksum mismatch: ' + name);
  return { file, sha: checksum[0] };
}
function checkBundle(file, manifest) {
  if (manifest.schema !== 1 || manifest.appId !== profile.appId || !Array.isArray(manifest.files)) throw Error('Unknown manifest');
  const expected = manifest.files.map(entry => entry.name);
  if (
    new Set(expected).size !== expected.length ||
    !expected.length ||
    manifest.files.some(entry => typeof entry.name !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256 || ''))
  )
    throw Error('Invalid manifest entries');
  if (expected.some(name => !/^[\w./-]+$/.test(name) || name[0] === '/' || name.split('/').indexOf('..') >= 0))
    throw Error('Unsafe archive path');
  const names = run('tar', ['-tzf', file]).trim().split('\n');
  const types = run('tar', ['-tvzf', file]).trim().split('\n');
  if (
    types.some(line => line[0] !== '-') ||
    names.length !== expected.length ||
    names.slice().sort().join('\n') !== expected.slice().sort().join('\n')
  )
    throw Error('Unexpected archive entries or links');
}
function verifyTree(manifest, immutableOnly) {
  for (const entry of manifest.files) {
    if (immutableOnly && entry.name.indexOf('themes/') === 0) continue;
    const file = path.join(directory, entry.name),
      stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || sha(fs.readFileSync(file)) !== entry.sha256)
      throw Error('Installed content differs: ' + entry.name);
  }
}
async function stop(value) {
  const live = ownedProcess(value);
  if (!live) {
    if (value.process && fs.existsSync('/proc/' + value.process.pid)) throw Error('PID identity differs; process left alone');
    console.log('Trial already stopped');
    return;
  }
  process.kill(live.pid, 'SIGTERM');
  for (let i = 0; i < 20 && ownedProcess(value); i++) await pause(100);
  if (ownedProcess(value)) throw Error('Trial termination uncertain; no force kill issued');
  delete value.process;
  save(value);
  console.log('Trial stopped; stable installation unchanged');
}
async function action(mode) {
  if (['check', 'install', 'start', 'stop', 'status', 'show'].indexOf(mode) < 0)
    throw Error('Usage: --webos4 check | install | start | stop | status | show');
  if (mode === 'check') {
    await preflight();
    console.log('webOS 4 profile ready; original UI and six feature modules; no boot/updater/input-hook changes');
    return;
  }
  if (mode === 'install') {
    await preflight();
    const helper = artifact('cleanyourtv-original-helper.tgz');
    const ipk = artifact(profile.appId + '_0.2.0_all.ipk');
    const manifestArtifact = artifact('payload-manifest.json');
    const manifest = read(manifestArtifact.file);
    checkBundle(helper.file, manifest);
    if (fs.existsSync(directory)) {
      const old = receipt();
      if (old.bundleSha256 !== helper.sha || old.ipkSha256 !== ipk.sha)
        throw Error('Different release: existing installation preserved; no automatic update');
      if (old.installed && registered()) {
        verifyTree(read(path.join(directory, 'payload-manifest.json')), true);
        console.log('Already installed; nothing rewritten');
        return;
      }
      throw Error('Existing or uncertain installation preserved; inspect before another install request');
    }
    if (registered()) throw Error('Trial app already registered without owned receipt; left alone');
    await freePort();
    const parent = path.dirname(directory);
    if (!fs.lstatSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()) throw Error('Installation parent is a symlink');
    fs.mkdirSync(directory, 0o700);
    const value = {
      schema: 1,
      appId: profile.appId,
      bundleSha256: helper.sha,
      ipkSha256: ipk.sha,
      installed: false,
      installRequestSent: false,
    };
    save(value);
    run('tar', ['-xzf', helper.file, '-C', directory]);
    verifyTree(manifest);
    fs.copyFileSync(manifestArtifact.file, path.join(directory, 'payload-manifest.json'));
    fs.copyFileSync(ipk.file, path.join(directory, 'candidate.ipk'));
    value.installRequestSent = true;
    save(value);
    const reply = luna('com.webos.appInstallService/dev/install', {
      id: profile.appId,
      ipkUrl: path.join(directory, 'candidate.ipk'),
      subscribe: false,
    });
    if (reply.returnValue === false) throw Error('Package installation rejected; no retry');
    let found = false;
    for (let i = 0; i < 10; i++) {
      if (registered()) {
        found = true;
        break;
      }
      await pause(500);
    }
    if (!found) throw Error('Package registration uncertain; no retry, helper not started');
    value.installed = true;
    save(value);
    console.log('Original UI installed separately; stable HOME, runtime and boot preserved');
    return;
  }
  const value = receipt();
  if (mode === 'stop') {
    await stop(value);
    return;
  }
  if (mode === 'status') {
    console.log(JSON.stringify({ installed: value.installed, running: !!ownedProcess(value), directory, appId: profile.appId }));
    return;
  }
  const reuseBridge = await preflight();
  if (!value.installed || !registered()) throw Error('Trial app not registered; nothing started');
  verifyTree(read(path.join(directory, 'payload-manifest.json')), true);
  if (mode === 'show') {
    if (!ownedProcess(value)) throw Error('Trial helper not running');
    if (!reuseBridge) throw Error('Native bridge unavailable; nothing launched');
    const result = luna('com.webos.applicationManager/launch', { id: profile.appId });
    if (result.returnValue !== true) throw Error('App launch uncertain; no retry');
    console.log('One trial-app launch accepted; picture and remote require confirmation');
    return;
  }
  if (ownedProcess(value)) {
    if (!reuseBridge) throw Error('Running trial has no native bridge; nothing restarted');
    console.log('Trial already running');
    return;
  }
  if (
    fs.existsSync(path.join(directory, 'state/helper.pid')) &&
    identity(+fs.readFileSync(path.join(directory, 'state/helper.pid'), 'utf8'))
  )
    throw Error('Unrecorded live trial process; no duplicate started');
  await freePort();
  const log = fs.openSync(path.join(directory, 'helper.log'), 'a', 0o600);
  const child = cp.spawn('sh', [path.join(directory, 'original-service.sh'), 'run'], {
    detached: true,
    stdio: ['ignore', log, log],
    env: Object.assign({}, process.env, { CYTV_WEBOS4_OWN_BRIDGE: reuseBridge ? '0' : '1' }),
  });
  child.unref();
  fs.closeSync(log);
  for (let i = 0; i < 30; i++) {
    await pause(200);
    try {
      const live = identity(+fs.readFileSync(path.join(directory, 'state/helper.pid'), 'utf8'));
      if (!live) continue;
      value.process = live;
      save(value);
      const bridge = service(profile.stablePort);
      if (service(profile.port).trial === true && bridge.version === '0.2.0' && bridge.readOnly === false && bridge.node === profile.node) {
        console.log('Original modules ready; no graphics restart or source closure');
        return;
      }
    } catch (_) {}
  }
  await stop(value);
  throw Error('Trial helper did not become ready; stopped without altering stable setup');
}
async function main(mode) {
  if (['install', 'start', 'stop', 'show'].indexOf(mode) < 0) return action(mode);
  const lock = directory + '.lock';
  try {
    fs.mkdirSync(lock, 0o700);
  } catch (_) {
    throw Error('Another installer action or an unresolved lock exists; nothing retried');
  }
  try {
    return await action(mode);
  } finally {
    fs.rmdirSync(lock);
  }
}
if (require.main === module) {
  process.umask(0o077);
  (process.argv.length > 3 ? Promise.reject(Error('Unexpected installer arguments')) : main(process.argv[2] || 'check')).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { main, checkBundle };
