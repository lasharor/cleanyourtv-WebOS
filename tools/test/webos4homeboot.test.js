'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  crypto = require('crypto');
const { root, tmp, ok, run } = require('./lib');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
run(async () => {
  let sequence = 0;
  function fixture() {
    const dir = path.join(tmp, 'boot-' + sequence++),
      bin = path.join(dir, 'bin'),
      base = path.join(dir, 'base');
    for (const folder of [dir, bin, base, path.join(base, 'helper'), path.join(base, 'state')]) fs.mkdirSync(folder);
    const target = path.join(dir, 'live.js'),
      patch = path.join(dir, 'systemUi.js'),
      mounts = path.join(dir, 'mounts');
    const boot = path.join(dir, 'boot');
    fs.copyFileSync(path.join(root, 'webos4/10-cleanyourtv-home'), path.join(dir, '10-cleanyourtv-home'));
    const ready = path.join(dir, 'ready'),
      calls = path.join(dir, 'calls'),
      input = path.join(dir, 'inputhook');
    const binds = path.join(dir, 'binds.json'),
      original = 'synthetic original\n';
    fs.writeFileSync(target, original);
    fs.writeFileSync(mounts, '');
    fs.writeFileSync(binds, '{}');
    fs.writeFileSync(patch, 'synthetic patch\n');
    fs.copyFileSync(path.join(root, 'helper/webos4.js'), path.join(base, 'helper/webos4.js'));
    for (const name of ['original', 'cleanyourtv']) {
      const config = fs
        .readFileSync(path.join(root, 'webos4/keyfilters-' + name + '.json'), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\/var\/lib\/webosbrew\/cleanyourtv-home\/systemUi.js/g, patch);
      fs.writeFileSync(path.join(dir, 'keyfilters-' + name + '.json'), config);
    }
    const configFile = path.join(dir, 'config.json');
    fs.copyFileSync(path.join(dir, 'keyfilters-original.json'), configFile);
    const runHelper = '#!/bin/sh\nprintf \'{"version":"0.2.0","readOnly":false}\' >"' + ready + '"\n';
    fs.writeFileSync(path.join(base, 'run_helper.sh'), runHelper);
    const mock = `var fs=require('fs'),p=require('path'),name=p.basename(process.argv[1]),args=process.argv.slice(2);
var ready=${JSON.stringify(ready)},calls=${JSON.stringify(calls)},dir=${JSON.stringify(dir)};
function record(v){fs.appendFileSync(calls,JSON.stringify(v)+'\\n');}
if(name==='curl'){if(!fs.existsSync(ready))process.exit(7);process.stdout.write(fs.readFileSync(ready));}
else if(name==='sleep'){}
else if(name==='mount'){record(['mount']);fs.copyFileSync(${JSON.stringify(patch)},${JSON.stringify(target)});fs.writeFileSync(${JSON.stringify(mounts)},'device ${target} ext4 rw 0 0\\n');}
else if(name==='umount'){record(['umount']);fs.writeFileSync(${JSON.stringify(target)},${JSON.stringify(original)});fs.writeFileSync(${JSON.stringify(mounts)},'');}
else if(name==='initctl'){record(args);if(fs.existsSync(p.join(dir,'fail-restart')))process.exit(1);}
else if(name==='luna-send'){var uri=args[args.length-2],payload=JSON.parse(args[args.length-1]);record([uri,payload]);
if(/getConfigs$/.test(uri)){var config=JSON.parse(fs.readFileSync(${JSON.stringify(configFile)},'utf8'));config.returnValue=true;console.log(JSON.stringify(config));}
else if(/setConfigs$/.test(uri)){if(fs.existsSync(p.join(dir,'fail-config'))){console.log(JSON.stringify({returnValue:false}));}
else {if(!fs.existsSync(p.join(dir,'ignore-config')))fs.writeFileSync(${JSON.stringify(configFile)},JSON.stringify(payload));console.log(JSON.stringify({returnValue:true}));}}
else process.exit(8);}
else process.exit(9);`;
    for (const name of ['curl', 'sleep', 'mount', 'umount', 'initctl', 'luna-send'])
      fs.writeFileSync(path.join(bin, name), '#!' + process.execPath + '\n' + mock, { mode: 0o700 });
    let script = fs.readFileSync(path.join(root, 'webos4/home-startup.sh'), 'utf8').replace(/\r\n/g, '\n');
    script = script
      .replace('a28d9fee1256258b56727dd3827c3925c07badbb51349a8c1a8189fdfbbb1279', sha(original))
      .replace('bf89d18f597ade2b226c6cacefadfd1eb578af936b846afba957d9bd0e99874e', sha('synthetic patch\n'))
      .replace('1b0d05a975c2601b6bf6f0e0065266271793f906f8e94ff9802e7155604af4f5', sha('synthetic legacy patch\n'))
      .replace('/usr/lib/qt5/qml/KeyFilters/systemUi.js', target)
      .replace('/media/developer/cleanyourtv', base)
      .replace('/tmp/cytv-home-startup.lock', path.join(dir, 'lock'))
      .replace('/var/lib/webosbrew/init.d/10-cleanyourtv-home', boot)
      .replace(/\/proc\/mounts/g, mounts)
      .replace('/home/root/.config/lginputhook/keybinds.json', binds)
      .replace('/tmp/inputhook', input)
      .replace(/\/usr\/bin\/node/g, process.execPath)
      .replace('/sbin/initctl', path.join(bin, 'initctl'))
      .replace(
        '4afb42bc3f369966ddb3fbeda670eacec735699768a48387b331c69bb162255f',
        sha(fs.readFileSync(path.join(dir, 'keyfilters-original.json')))
      )
      .replace(
        'e8d66484e0ed92e5283ae66a6a33d48b37bee549aec6275c5dd2f793b5a5950e',
        sha(fs.readFileSync(path.join(dir, 'keyfilters-cleanyourtv.json')))
      )
      .replace('d22f69ece11fd8610cec55a9ea6a86d6083c5c1882c24f58170cc5d40d870f26', sha(runHelper))
      .replace(
        'ed1e72cd29e375452bbf03cad4ddc5bafb6936912a13004f5cb24c969a5cb8fc',
        sha(fs.readFileSync(path.join(base, 'helper/webos4.js')))
      );
    const program = path.join(dir, 'home-startup.sh');
    fs.writeFileSync(program, script);
    return {
      dir,
      base,
      boot,
      target,
      patch,
      mounts,
      ready,
      calls,
      input,
      binds,
      configFile,
      exec: action =>
        cp.spawnSync('sh', [program, action], {
          env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH }),
          encoding: 'utf8',
        }),
      requests: () =>
        fs.existsSync(calls)
          ? fs
              .readFileSync(calls, 'utf8')
              .trim()
              .split('\n')
              .map(JSON.parse)
              .filter(r => !/getConfigs$/.test(r[0]))
          : [],
    };
  }
  ok(
    cp.spawnSync('sh', ['-n', path.join(root, 'webos4/home-startup.sh')]).status === 0 &&
      cp.spawnSync('sh', ['-n', path.join(root, 'webos4/10-cleanyourtv-home')]).status === 0,
    'HOME startup and boot entry parse'
  );
  const normal = fixture();
  ok(
    normal.exec('start').status === 0 && /helper-ready/.test(normal.exec('status').stdout),
    'cold start starts the helper before installing HOME'
  );
  const requests = normal.requests();
  ok(
    requests.length === 2 &&
      requests[0][0] === 'mount' &&
      /setConfigs$/.test(requests[1][0]) &&
      fs.readFileSync(normal.mounts, 'utf8') !== '' &&
      /cleanyourtv/.test(normal.exec('status').stdout),
    'fresh boot mounts the RAM patch and reloads key filters without closing apps or restarting graphics'
  );
  const before = normal.requests().length;
  fs.copyFileSync(path.join(normal.dir, '10-cleanyourtv-home'), normal.boot);
  fs.chmodSync(normal.boot, 0o700);
  ok(/boot-enabled/.test(normal.exec('status').stdout), 'status requires the installed executable to match the owned boot template');
  ok(
    normal.exec('start').status === 0 && normal.requests().length === before,
    'a repeated start reuses the active configuration without another update'
  );
  ok(
    normal.exec('disable').status === 0 &&
      /disabled/.test(normal.exec('status').stdout) &&
      normal.exec('start').status === 0 &&
      normal.requests().length === 4 &&
      JSON.stringify(JSON.parse(fs.readFileSync(normal.configFile, 'utf8'))) ===
        JSON.stringify(JSON.parse(fs.readFileSync(path.join(normal.dir, 'keyfilters-original.json'), 'utf8'))) &&
      fs.readFileSync(normal.mounts, 'utf8') === '',
    'disable restores the original filters immediately, suppresses future startup and never restarts graphics'
  );
  const alternateBoot = fixture();
  fs.copyFileSync(path.join(alternateBoot.dir, 'keyfilters-cleanyourtv.json'), alternateBoot.configFile);
  ok(
    alternateBoot.exec('start').status === 0 &&
      /setConfigs$/.test(alternateBoot.requests()[1][0]) &&
      JSON.stringify(JSON.parse(fs.readFileSync(alternateBoot.configFile, 'utf8'))) ===
        JSON.stringify(JSON.parse(fs.readFileSync(path.join(alternateBoot.dir, 'keyfilters-original.json'), 'utf8'))),
    'a boot with the alternate spelling toggles back and reloads the fresh RAM patch exactly once'
  );
  ok(
    alternateBoot.exec('disable').status === 0 &&
      alternateBoot.requests().length === 4 &&
      alternateBoot.requests()[2][0] === 'umount' &&
      /setConfigs$/.test(alternateBoot.requests()[3][0]) &&
      fs.readFileSync(alternateBoot.target, 'utf8') === 'synthetic original\n',
    'disable reloads LG even when the current configuration already uses the original spelling'
  );
  for (const kind of ['original', 'patch', 'binds', 'hook', 'template']) {
    const bad = fixture();
    if (kind === 'original') fs.writeFileSync(bad.target, 'unknown file');
    if (kind === 'patch') fs.writeFileSync(bad.patch, 'unknown patch');
    if (kind === 'binds') fs.writeFileSync(bad.binds, '{"773":{}}');
    if (kind === 'hook') fs.writeFileSync(bad.input, 'loaded');
    if (kind === 'template') fs.appendFileSync(path.join(bad.dir, 'keyfilters-cleanyourtv.json'), ' ');
    ok(
      bad.exec('start').status !== 0 && bad.requests().length === 0 && !fs.existsSync(bad.ready),
      'unsafe preflight changes nothing: ' + kind
    );
  }
  const foreign = fixture();
  fs.writeFileSync(foreign.mounts, 'device ' + foreign.target + ' ext4 rw 0 0\n');
  fs.writeFileSync(foreign.target, 'foreign mount');
  ok(
    foreign.exec('start').status !== 0 && foreign.exec('disable').status !== 0 && foreign.requests().length === 0,
    'unrelated mounted content is neither replaced nor unmounted'
  );
  const legacy = fixture();
  const legacyCode = 'synthetic legacy patch\n';
  fs.writeFileSync(legacy.target, legacyCode);
  fs.writeFileSync(legacy.mounts, 'device ' + legacy.target + ' ext4 rw 0 0\n');
  ok(
    /legacy-patch-mounted/.test(legacy.exec('status').stdout) &&
      legacy.exec('start').status === 0 &&
      legacy.requests().length === 0 &&
      legacy.exec('disable').status === 0 &&
      fs.readFileSync(legacy.mounts, 'utf8') === '',
    'migration preserves the already active legacy RAM patch without closing apps or restarting graphics'
  );
  const locked = fixture();
  fs.mkdirSync(path.join(locked.dir, 'lock'));
  ok(
    locked.exec('start').status !== 0 &&
      locked.exec('disable').status !== 0 &&
      locked.requests().length === 0 &&
      !fs.existsSync(path.join(locked.dir, 'DISABLED')),
    'start and disable cannot race each other'
  );
  const unknown = fixture();
  const altered = JSON.parse(fs.readFileSync(unknown.configFile, 'utf8'));
  altered.configs['com.webos.surfacemanager.keyFilters'][0].file = '/foreign.js';
  fs.writeFileSync(unknown.configFile, JSON.stringify(altered));
  ok(
    unknown.exec('start').status !== 0 &&
      unknown.exec('disable').status !== 0 &&
      unknown.requests().length === 0 &&
      !fs.existsSync(unknown.ready),
    'unknown key filters are preserved without helper startup, update or disable'
  );
  const reordered = fixture();
  const reorderedConfig = JSON.parse(fs.readFileSync(reordered.configFile, 'utf8'));
  reorderedConfig.configs['com.webos.surfacemanager.keyFilters'].forEach((v, i, a) => {
    a[i] = { file: v.file, handler: v.handler };
  });
  fs.writeFileSync(reordered.configFile, JSON.stringify(reorderedConfig));
  ok(reordered.exec('start').status === 0, 'object field order does not change filter identity');
  const extra = fixture();
  const extraConfig = JSON.parse(fs.readFileSync(extra.configFile, 'utf8'));
  extraConfig.configs['com.webos.surfacemanager.keyFilters'][0].extra = true;
  fs.writeFileSync(extra.configFile, JSON.stringify(extraConfig));
  ok(extra.exec('start').status !== 0 && extra.requests().length === 0, 'extra policy fields are not silently discarded');
  const stalled = fixture();
  const live = cp.spawn(process.execPath, ['-e', 'setInterval(function(){},1000)', path.join(stalled.base, 'helper/webos4.js')], {
    stdio: 'ignore',
  });
  try {
    fs.writeFileSync(path.join(stalled.base, 'state/helper.pid'), String(live.pid));
    ok(
      stalled.exec('start').status !== 0 && stalled.requests().length === 0 && !fs.existsSync(stalled.ready),
      'a matching live but unresponsive helper is left alone without starting another copy'
    );
  } finally {
    live.kill('SIGTERM');
  }
  for (const mode of ['fail-config', 'ignore-config']) {
    const failure = fixture();
    fs.writeFileSync(path.join(failure.dir, mode), '1');
    ok(
      failure.exec('start').status !== 0 &&
        failure.requests().length === 3 &&
        failure.requests()[0][0] === 'mount' &&
        /setConfigs$/.test(failure.requests()[1][0]) &&
        failure.requests()[2][0] === 'umount' &&
        fs.existsSync(path.join(failure.dir, 'DISABLED')) &&
        fs.readFileSync(failure.mounts, 'utf8') === '',
      'an uncertain update is attempted once, unmounted and disabled without closing apps or restarting graphics: ' + mode
    );
  }
  const originalConfig = JSON.parse(fs.readFileSync(path.join(root, 'webos4/keyfilters-original.json'), 'utf8')).configs[
    'com.webos.surfacemanager.keyFilters'
  ];
  const homeConfig = JSON.parse(fs.readFileSync(path.join(root, 'webos4/keyfilters-cleanyourtv.json'), 'utf8')).configs[
    'com.webos.surfacemanager.keyFilters'
  ];
  ok(
    originalConfig.length === 12 &&
      originalConfig.filter((v, i) => v.file !== homeConfig[i].file).length === 4 &&
      originalConfig.every(
        (v, i) =>
          v.handler === homeConfig[i].handler &&
          (v.file === homeConfig[i].file ||
            (v.file === '/usr/lib/qt5/qml/KeyFilters/systemUi.js' && homeConfig[i].file === '/usr/lib/qt5/qml/KeyFilters/./systemUi.js'))
      ),
    'all 12 handlers keep their order and only four paths gain a dot segment, preserving LG fallback without the RAM mount'
  );
});
