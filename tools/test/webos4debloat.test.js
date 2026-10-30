'use strict';
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  cp = require('child_process');
const { root, tmp, ok, run } = require('./lib');
run(async () => {
  for (const entry of [
    ['debloat-stop.sh', 'd27223621f37957b7046c09a6a0a9f6c503e759d7b24038275617af14c535655'],
    ['debloat-undo.sh', '509310012f0d9e4541419e43c98540b1dd9452d23b49f13142a9d21fd6ce9990'],
  ]) {
    const file = path.join(root, 'webos4/research-debloat', entry[0]);
    const body = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    ok(
      crypto.createHash('sha256').update(body).digest('hex') === entry[1] && cp.spawnSync('sh', ['-n', file]).status === 0,
      'the physically tested debloat snapshot is preserved and parses: ' + entry[0]
    );
  }
  const dir = path.join(tmp, 'debloat'),
    bin = path.join(dir, 'bin'),
    base = path.join(dir, 'base'),
    hosts = path.join(dir, 'hosts'),
    mounts = path.join(dir, 'mounts'),
    calls = path.join(dir, 'calls');
  for (const p of [dir, bin, base]) fs.mkdirSync(p);
  fs.writeFileSync(hosts, '127.0.0.1 localhost\n');
  fs.writeFileSync(mounts, '');
  fs.writeFileSync(path.join(bin, 'acr2'), 'original acr2');
  fs.writeFileSync(path.join(bin, 'admanager'), 'original admanager');
  const mock = `var fs=require('fs'),p=require('path'),name=p.basename(process.argv[1]),a=process.argv.slice(2);
var mounts=${JSON.stringify(mounts)},calls=${JSON.stringify(calls)};
fs.appendFileSync(calls,JSON.stringify([name].concat(a))+'\\n');
if(name==='initctl'){if(a[0]==='status')console.log('remotelogger start/running');}
else if(name==='mount'){var target=a[2];fs.copyFileSync(target,target+'.original');fs.copyFileSync(a[1],target);fs.appendFileSync(mounts,'device '+target+' ext4 rw 0 0\\n');}
else if(name==='umount'){fs.copyFileSync(a[0]+'.original',a[0]);fs.writeFileSync(mounts,fs.readFileSync(mounts,'utf8').split('\\n').filter(function(l){return l.indexOf(' '+a[0]+' ')<0;}).join('\\n'));}`;
  for (const name of ['initctl', 'mount', 'umount', 'pkill'])
    fs.writeFileSync(path.join(bin, name), '#!' + process.execPath + '\n' + mock, { mode: 0o700 });
  const env = Object.assign({}, process.env, {
    PATH: bin + ':' + process.env.PATH,
    CYTV_DEBLOAT_DIR: base,
    CYTV_DEBLOAT_HOSTS: hosts,
    CYTV_DEBLOAT_SBIN: bin,
    CYTV_DEBLOAT_MOUNTS: mounts,
    CYTV_DEBLOAT_INITCTL: path.join(bin, 'initctl'),
  });
  const exec = file => cp.spawnSync('sh', [path.join(root, 'webos4', file)], { env, encoding: 'utf8' });
  ok(
    exec('debloat-stop.sh').status === 0 && /cleanyourtv-debloat/.test(fs.readFileSync(hosts, 'utf8')),
    'debloat stops Upstart telemetry and mounts hosts/stubs'
  );
  const before = fs
    .readFileSync(calls, 'utf8')
    .split('\n')
    .filter(l => /\["mount"/.test(l)).length;
  ok(
    exec('debloat-stop.sh').status === 0 &&
      fs
        .readFileSync(calls, 'utf8')
        .split('\n')
        .filter(l => /\["mount"/.test(l)).length === before,
    'reapplying debloat does not stack mounts'
  );
  ok(
    exec('debloat-undo.sh').status === 0 &&
      fs.readFileSync(hosts, 'utf8') === '127.0.0.1 localhost\n' &&
      fs.readFileSync(path.join(bin, 'acr2'), 'utf8') === 'original acr2',
    'undo restores original hosts and binaries through unmount only'
  );
  const count = fs.readFileSync(calls, 'utf8').length;
  ok(exec('debloat-stop.sh').status === 0 && fs.readFileSync(calls, 'utf8').length === count, 'disable marker prevents future debloat');
  fs.unlinkSync(path.join(base, 'DISABLE-DEBLOAT'));
  fs.writeFileSync(mounts, 'foreign ' + path.join(bin, 'acr2') + ' ext4 rw 0 0\n');
  ok(
    exec('debloat-stop.sh').status !== 0 &&
      exec('debloat-undo.sh').status !== 0 &&
      fs.readFileSync(path.join(bin, 'acr2'), 'utf8') === 'original acr2',
    'foreign mounts are refused and left intact'
  );
});
