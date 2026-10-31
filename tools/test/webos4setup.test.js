'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  crypto = require('crypto'),
  net = require('net');
const { root, tmp, ok, run } = require('./lib');
const mkdir = require('../../helper/netcompat').mkdirp;
const profile = require('../../webos4/profile.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
run(async () => {
  let seq = 0;
  function fixture(options) {
    const opts = options || {},
      dir = path.join(tmp, 'setup-' + seq++),
      kit = path.join(dir, 'kit'),
      bin = path.join(dir, 'bin'),
      tv = path.join(dir, 'tv');
    for (const folder of [
      kit,
      bin,
      path.join(tv, 'var/lib/webosbrew/init.d'),
      path.join(tv, 'media/developer/cleanyourtv'),
      path.join(kit, 'webos4'),
      path.join(kit, 'scripts'),
      path.join(kit, 'artifacts'),
    ])
      mkdir(folder);
    for (const name of [
      'install.sh',
      'scripts/bootstrap.sh',
      'scripts/check-tv.sh',
      'webos4/setup.sh',
      'webos4/setup.js',
      'webos4/profile.json',
    ])
      fs.copyFileSync(path.join(root, name), path.join(kit, name));
    fs.writeFileSync(path.join(tv, 'media/developer/cleanyourtv/KEEP'), 'stable configuration');
    fs.writeFileSync(path.join(tv, 'var/lib/webosbrew/init.d/10-cleanyourtv-home'), 'stable boot');
    const installDir = tv + profile.directory,
      registered = path.join(dir, 'registered'),
      events = path.join(dir, 'events');
    if (opts.fresh) fs.writeFileSync(path.join(dir, 'fresh'), '1');
    const mock = `var fs=require('fs'),p=require('path'),a=process.argv.slice(2),name=p.basename(process.argv[1]);
var registered=${JSON.stringify(registered)},events=${JSON.stringify(events)},dir=${JSON.stringify(dir)},id=${JSON.stringify(profile.appId)};
if(name==='curl'){if(a.join(' ').indexOf(':8765')>=0){if(fs.existsSync(p.join(dir,'fresh'))&&!fs.existsSync(p.join(${JSON.stringify(installDir)},'state/bridge-owned.pid')))process.exit(7);console.log(JSON.stringify({version:'0.2.0',readOnly:false,node:'v18.17.1'}));}else console.log(JSON.stringify({trial:true}));}
else if(name==='luna-send'){var uri=a[a.length-2],body=JSON.parse(a[a.length-1]);
if(/getSystemInfo$/.test(uri))console.log(JSON.stringify({returnValue:true,sdkVersion:fs.existsSync(p.join(dir,'bad-sdk'))?'5.0.0':'4.4.0'}));
else if(/getAppInfo$/.test(uri))console.log(JSON.stringify({returnValue:fs.existsSync(registered),appInfo:{id:id,type:'web'}}));
else if(/install$/.test(uri)){fs.appendFileSync(events,JSON.stringify({uri:uri,body:body})+'\\n');if(fs.existsSync(p.join(dir,'fail-install')))console.log('{"returnValue":false}');else{if(!fs.existsSync(p.join(dir,'uncertain-install')))fs.writeFileSync(registered,'1');console.log('{"returnValue":true}');}}
else if(/launch$/.test(uri)){fs.appendFileSync(events,JSON.stringify({uri:uri,body:body})+'\\n');console.log('{"returnValue":true}');}
else process.exit(9);}
else {fs.appendFileSync(events,'FORBIDDEN '+name+'\\n');process.exit(9);}`;
    for (const name of ['luna-send', 'curl', 'systemctl', 'initctl', 'reboot', 'pkill'])
      fs.writeFileSync(path.join(bin, name), '#!' + process.execPath + '\n' + mock, { mode: 0o700 });
    const files = {
      'original-service.sh': '#!/bin/sh\nHERE=$(dirname "$0")\nexec ' + process.execPath + ' "$HERE/helper/webos4-original.js"\n',
      'helper/webos4-original.js':
        "var fs=require('fs'),p=require('path'),d=p.resolve(__dirname,'../state');try{fs.mkdirSync(d);}catch(e){}fs.writeFileSync(p.join(d,'helper.pid'),String(process.pid));if(process.env.CYTV_WEBOS4_OWN_BRIDGE==='1')fs.writeFileSync(p.join(d,'bridge-owned.pid'),String(process.pid));process.on('SIGTERM',function(){try{fs.unlinkSync(p.join(d,'bridge-owned.pid'));}catch(e){}process.exit(0);});setInterval(function(){},1000);",
      'webos4/profile.json': JSON.stringify(profile),
      'themes/classic/theme.json': '{}',
    };
    if (opts.traversal) files['../escape'] = 'unsafe';
    const entries = Object.keys(files).map(name => ({ name, sha256: sha(files[name]) }));
    const archive = path.join(kit, 'artifacts/cleanyourtv-original-helper.tgz');
    const script =
      "import tarfile,io,json,sys\nf=json.loads(sys.argv[2])\nwith tarfile.open(sys.argv[1],'w:gz') as t:\n for name,body in f.items():\n  b=body.encode();i=tarfile.TarInfo(name);i.size=len(b);i.mode=0o700;t.addfile(i,io.BytesIO(b))\n";
    const packed = cp.spawnSync('python3', ['-c', script, archive, JSON.stringify(files)]);
    if (packed.status) throw Error(String(packed.stderr));
    fs.writeFileSync(
      path.join(kit, 'artifacts/payload-manifest.json'),
      JSON.stringify({ schema: 1, appId: profile.appId, files: entries })
    );
    fs.writeFileSync(path.join(kit, 'artifacts/' + profile.appId + '_0.2.0_all.ipk'), 'test package');
    for (const name of fs.readdirSync(path.join(kit, 'artifacts')))
      fs.writeFileSync(
        path.join(kit, 'artifacts', name + '.sha256'),
        sha(fs.readFileSync(path.join(kit, 'artifacts', name))) + '  ' + name + '\n'
      );
    const env = Object.assign({}, process.env, { CYTV_TEST_ROOT: tv, CYTV_WEBOS4_TEST_BIN: bin });
    return {
      dir,
      kit,
      installDir,
      registered,
      events,
      exec: mode => cp.spawnSync('sh', [path.join(kit, 'install.sh'), '--webos4', mode], { env, encoding: 'utf8', timeout: 20000 }),
      mutations: () => (fs.existsSync(events) ? fs.readFileSync(events, 'utf8').trim().split('\n').filter(Boolean) : []),
      intact: () =>
        fs.readFileSync(path.join(tv, 'media/developer/cleanyourtv/KEEP'), 'utf8') === 'stable configuration' &&
        fs.readFileSync(path.join(tv, 'var/lib/webosbrew/init.d/10-cleanyourtv-home'), 'utf8') === 'stable boot',
    };
  }
  const normal = fixture();
  ok(
    normal.exec('check').status === 0 && normal.mutations().length === 0 && !fs.existsSync(normal.installDir),
    'original installer selects webOS 4 check without writes'
  );
  let result = normal.exec('install');
  ok(
    result.status === 0 && normal.mutations().length === 1 && normal.intact(),
    'webOS 4 installation stages original modules and installs one separate app without touching stable files: ' + result.stderr
  );
  ok(
    normal.exec('install').status === 0 && normal.mutations().length === 1,
    'repeated install preserves files and does not repeat installation'
  );
  try {
    result = normal.exec('start');
    ok(result.status === 0 && /ready/.test(result.stdout), 'manual service starts and confirms its own process and API: ' + result.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(normal.installDir, 'installation.json'), 'utf8'));
    const mismatched = JSON.parse(JSON.stringify(saved));
    mismatched.process.start = 'different-start';
    fs.writeFileSync(path.join(normal.installDir, 'installation.json'), JSON.stringify(mismatched));
    const refusedStop = normal.exec('stop').status !== 0;
    let stillAlive = false;
    try {
      process.kill(saved.process.pid, 0);
      stillAlive = true;
    } catch (_) {}
    fs.writeFileSync(path.join(normal.installDir, 'installation.json'), JSON.stringify(saved));
    ok(refusedStop && stillAlive, 'a mismatched process start time prevents termination');
    ok(
      normal.exec('start').status === 0 &&
        JSON.parse(fs.readFileSync(path.join(normal.installDir, 'installation.json'), 'utf8')).process.pid === saved.process.pid,
      'repeated start reuses the same owned process'
    );
    fs.writeFileSync(path.join(normal.installDir, 'themes/classic/theme.json'), '{"name":"changed data"}');
    ok(
      normal.exec('show').status === 0 && normal.mutations().length === 2 && normal.intact(),
      'manual display launches only the candidate once; theme data may change without invalidating code'
    );
    fs.writeFileSync(path.join(normal.installDir, 'helper/webos4-original.js'), 'altered code');
    ok(normal.exec('show').status !== 0 && normal.mutations().length === 2, 'altered executable code prevents another activation');
  } finally {
    normal.exec('stop');
  }
  ok(/"running":false/.test(normal.exec('status').stdout) && normal.intact(), 'stop leaves the stable deployment and boot entry intact');
  const fresh = fixture({ fresh: true });
  ok(
    fresh.exec('check').status === 0 && fresh.exec('install').status === 0 && fresh.intact(),
    'a fresh TV can stage the original UI without a research helper'
  );
  try {
    result = fresh.exec('start');
    ok(
      result.status === 0 && fs.existsSync(path.join(fresh.installDir, 'state/bridge-owned.pid')),
      'a fresh start requests the validated bridge inside the owned original process: ' + result.stderr
    );
    ok(fresh.exec('show').status === 0, 'fresh installation opens only its candidate after both APIs are ready');
  } finally {
    fresh.exec('stop');
  }
  ok(
    !fs.existsSync(path.join(fresh.installDir, 'state/bridge-owned.pid')) && fresh.intact(),
    'stopping a fresh trial also stops its own bridge without touching stable files'
  );
  const changed = path.join(normal.kit, 'artifacts/' + profile.appId + '_0.2.0_all.ipk');
  fs.writeFileSync(changed, 'new UI package');
  fs.writeFileSync(changed + '.sha256', sha(fs.readFileSync(changed)) + '  ' + path.basename(changed) + '\n');
  ok(
    normal.exec('install').status !== 0 && normal.mutations().length === 2 && normal.intact(),
    'a different release is not silently installed over the existing candidate'
  );
  const badSdk = fixture();
  fs.writeFileSync(path.join(badSdk.dir, 'bad-sdk'), '1');
  ok(
    badSdk.exec('install').status !== 0 && !fs.existsSync(badSdk.installDir) && badSdk.mutations().length === 0,
    'unknown SDK changes nothing'
  );
  const locked = fixture();
  fs.mkdirSync(locked.installDir + '.lock');
  ok(
    locked.exec('install').status !== 0 && !fs.existsSync(locked.installDir) && locked.mutations().length === 0,
    'concurrent or unresolved installer actions are refused without touching the deployment'
  );
  const corrupt = fixture();
  fs.appendFileSync(path.join(corrupt.kit, 'artifacts/cleanyourtv-original-helper.tgz'), 'bad');
  ok(
    corrupt.exec('install').status !== 0 && !fs.existsSync(corrupt.installDir),
    'corrupt bundle rejected before creating installation directory'
  );
  const unsafe = fixture({ traversal: true });
  ok(unsafe.exec('install').status !== 0 && !fs.existsSync(unsafe.installDir), 'archive traversal rejected before extraction');
  const conflict = fixture();
  fs.writeFileSync(conflict.registered, '1');
  ok(conflict.exec('install').status !== 0 && conflict.mutations().length === 0, 'unowned existing app is not overwritten');
  const failure = fixture();
  fs.writeFileSync(path.join(failure.dir, 'fail-install'), '1');
  ok(
    failure.exec('install').status !== 0 && failure.exec('install').status !== 0 && failure.mutations().length === 1 && failure.intact(),
    'failed or uncertain install is not retried and no service or boot change follows'
  );
  const occupied = fixture();
  const uncertain = fixture();
  fs.writeFileSync(path.join(uncertain.dir, 'uncertain-install'), '1');
  ok(
    uncertain.exec('install').status !== 0 &&
      uncertain.exec('install').status !== 0 &&
      uncertain.mutations().length === 1 &&
      uncertain.intact(),
    'accepted install without registration remains uncertain, without retry or helper start'
  );
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(profile.port, '127.0.0.1', resolve);
  });
  try {
    ok(
      occupied.exec('install').status !== 0 && !fs.existsSync(occupied.installDir),
      'occupied service port is refused without stopping its owner'
    );
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
  const foreignBridge = fixture({ fresh: true });
  const bridgeListener = net.createServer();
  await new Promise((resolve, reject) => {
    bridgeListener.once('error', reject);
    bridgeListener.listen(profile.stablePort, '127.0.0.1', resolve);
  });
  try {
    ok(
      foreignBridge.exec('install').status !== 0 && !fs.existsSync(foreignBridge.installDir) && foreignBridge.mutations().length === 0,
      'an incompatible bridge-port owner prevents installation and is never stopped'
    );
  } finally {
    await new Promise(resolve => bridgeListener.close(resolve));
  }
});
