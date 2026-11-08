// Compressed memory (zram.js, issue 93): the zram device and /proc are folders here, and the programs (mkswap, swapon, swapoff)
// are a stand-in that writes /proc/swaps the way the kernel would.
const fs = require('fs'),
  path = require('path');
const { ok, call, tmp, memoryConfig, run } = require('./lib');
const Z = path.join(tmp, 'zram0');
process.env.CYTV_ZRAM = Z;
const zram = require(path.join(__dirname, '..', '..', 'helper', 'zram'));
const PROC = process.env.CYTV_PROC;

const ESWAP = '/dev/mapper/eswap                       partition\t614396\t262144\t-2\n';
const HEAD = 'Filename\t\t\t\tType\t\tSize\tUsed\tPriority\n';
function tv(o) {
  fs.mkdirSync(Z);
  fs.writeFileSync(Z + '/disksize', '0\n');
  fs.writeFileSync(Z + '/comp_algorithm', o.algos || 'lzo lzo-rle [lz4] zstd\n');
  fs.writeFileSync(Z + '/mm_stat', '0 0 0 0 0 0 0 0\n');
  fs.writeFileSync(PROC + '/swaps', HEAD + ESWAP);
  for (const d of [PROC + '/sys', PROC + '/sys/vm']) if (!fs.existsSync(d)) fs.mkdirSync(d);
  fs.writeFileSync(PROC + '/sys/vm/page-cluster', '3\n');
  fs.writeFileSync(PROC + '/meminfo', 'MemTotal:        1769072 kB\nMemAvailable:     409468 kB\n');
}
function reset() {
  for (const f of fs.readdirSync(Z)) fs.unlinkSync(path.join(Z, f));
  fs.rmdirSync(Z);
}

// the programs: what was run, and /proc/swaps as the kernel keeps it
function programs(fail) {
  const calls = [];
  const runner = async (cmd, args) => {
    calls.push(cmd + ' ' + args.join(' '));
    if (fail === cmd) return { ok: false, code: 1, out: '', err: cmd + ': failed\n', error: 'failed' };
    if (cmd === 'swapon') {
      const kb = Math.round(+fs.readFileSync(Z + '/disksize', 'utf8') / 1024);
      fs.writeFileSync(PROC + '/swaps', HEAD + ESWAP + '/dev/zram0                              partition\t' + kb + '\t0\t10\n');
    }
    if (cmd === 'swapoff') fs.writeFileSync(PROC + '/swaps', HEAD + ESWAP);
    return { ok: true, code: 0, out: '', err: '', error: '' };
  };
  return { calls, runner };
}

run(async () => {
  // a kernel without zram: nothing offered, nothing switched on
  fs.writeFileSync(PROC + '/swaps', HEAD + ESWAP);
  let p = programs();
  let z = zram.create({ config: memoryConfig(), run: p.runner });
  let x = await call(z, '/api/zram');
  ok(x.j.available === false && x.j.on === false, 'no zram device: not available');
  ok(x.j.other.size === 600 && x.j.other.used === 256, 'the other swap (eswap) in MB');
  x = await call(z, '/api/zram', 'POST', { size: 512 });
  ok(x.code === 400 && !p.calls.length, 'switching it on where there is no zram is refused');

  tv({});
  const conf = memoryConfig();
  p = programs();
  z = zram.create({ config: conf, run: p.runner });
  x = await call(z, '/api/zram');
  ok(x.j.available && !x.j.on && x.j.setting === 0 && x.j.memAvailable === 400, 'off as LG ships it, with the free memory');
  ok(x.j.sizes.join() === '256,512,768,1024', 'the sizes to choose from');

  x = await call(z, '/api/zram', 'POST', { size: 300 });
  ok(x.code === 400 && conf.options().zram === undefined && !p.calls.length, 'a size not in the list is refused and not saved');

  x = await call(z, '/api/zram', 'POST', { size: 512 });
  ok(x.j.on && x.j.size === 512 && !x.j.error, 'switched on at 512 MB');
  ok(fs.readFileSync(Z + '/comp_algorithm', 'utf8') === 'lz4', 'with lz4');
  ok(+fs.readFileSync(Z + '/disksize', 'utf8') === 512 * 1048576, 'the size written to the device');
  ok(p.calls.join('|') === 'mkswap /dev/zram0|swapon -p 10 /dev/zram0', 'mkswap, then swapon ahead of eswap (priority 10)');
  ok(conf.options().zram === 512 && x.j.setting === 512, 'saved in options.zram');
  const cl = () => fs.readFileSync(PROC + '/sys/vm/page-cluster', 'utf8').trim();
  ok(cl() === '0', 'swap reads one page at a time (page-cluster 0)');

  fs.writeFileSync(Z + '/mm_stat', '50765824 18892856 20066304 0 20066304 273 0 871\n');
  x = await call(z, '/api/zram');
  ok(x.j.stored === 48 && x.j.ram === 19, 'what it keeps and the memory that takes, in MB');

  p.calls.length = 0;
  x = await call(z, '/api/zram', 'POST', { size: 768 });
  ok(x.j.on && x.j.size === 768 && p.calls[0] === 'swapoff /dev/zram0', 'a new size: off, then on again with it');

  p.calls.length = 0;
  x = await call(z, '/api/zram', 'POST', { size: 0 });
  ok(!x.j.on && conf.options().zram === undefined && p.calls.join() === 'swapoff /dev/zram0', 'switched off and forgotten');
  ok(fs.readFileSync(Z + '/reset', 'utf8') === '1', 'the device is reset (its memory freed)');
  ok(cl() === '3', "and page-cluster is LG's value again");

  // at the start of the service (each boot): the saved size is applied once
  fs.writeFileSync(PROC + '/swaps', HEAD + ESWAP);
  p = programs();
  z = zram.create({ config: memoryConfig({ options: { zram: 256 } }), run: p.runner });
  z.start();
  await new Promise(r => setTimeout(r, 50));
  ok(zram.status().on && zram.status().size === 256, 'the service switches it on at start, with the saved size');
  p.calls.length = 0;
  z.start();
  await new Promise(r => setTimeout(r, 50));
  ok(!p.calls.length, 'a restarted service leaves it on as it is');
  z = zram.create({ config: memoryConfig({ options: { zram: 300 } }), run: programs().runner });
  fs.writeFileSync(PROC + '/swaps', HEAD + ESWAP);
  z.start();
  ok(!zram.status().on, 'a size not in the list in config.json is ignored');

  // short of memory: switching off would pull the pages back into RAM, so it waits
  fs.writeFileSync(PROC + '/swaps', HEAD + ESWAP);
  p = programs();
  z = zram.create({ config: memoryConfig(), run: p.runner });
  await call(z, '/api/zram', 'POST', { size: 512 });
  fs.writeFileSync(Z + '/mm_stat', '524288000 100000000 120000000 0 120000000 0 0 0\n'); // 500 MB stored, 114 MB of RAM
  fs.writeFileSync(PROC + '/meminfo', 'MemTotal: 1769072 kB\nMemAvailable: 204800 kB\n'); // 200 MB free, about 450 needed
  p.calls.length = 0;
  x = await call(z, '/api/zram', 'POST', { size: 0 });
  ok(/Not enough free memory/.test(x.j.error) && x.j.on && !p.calls.length, 'too little free memory: refused, still on, nothing run');
  const marker = path.join(require(path.join(__dirname, '..', '..', 'helper', 'paths')).D, 'zram-applying');
  ok(!fs.existsSync(marker), 'and no marker is left');
  fs.writeFileSync(PROC + '/meminfo', 'MemTotal: 1769072 kB\nMemAvailable: 819200 kB\n');
  x = await call(z, '/api/zram', 'POST', { size: 0 });
  ok(!x.j.on, 'with enough free memory it switches off');

  // a change that never finished (marker left behind): the next start leaves zram off and forgets the size
  fs.writeFileSync(PROC + '/swaps', HEAD + ESWAP);
  fs.writeFileSync(marker, '1');
  const conf3 = memoryConfig({ options: { zram: 512 } });
  z = zram.create({ config: conf3, run: programs().runner });
  z.start();
  await new Promise(r => setTimeout(r, 50));
  ok(!zram.status().on && conf3.options().zram === undefined, 'after an unfinished change zram stays off and the size is forgotten');
  ok(!fs.existsSync(marker), 'the marker is removed');

  // a failing swapon leaves the device reset and says why
  p = programs('swapon');
  z = zram.create({ config: memoryConfig(), run: p.runner });
  x = await call(z, '/api/zram', 'POST', { size: 512 });
  ok(!x.j.on && /swapon: failed/.test(x.j.error), 'a failure is reported');
  ok(fs.readFileSync(Z + '/reset', 'utf8') === '1', 'and the device is reset');

  // a kernel without lz4 keeps its own default algorithm
  reset();
  tv({ algos: '[lzo] zstd\n' });
  z = zram.create({ config: memoryConfig(), run: programs().runner });
  x = await call(z, '/api/zram', 'POST', { size: 256 });
  ok(x.j.on && fs.readFileSync(Z + '/comp_algorithm', 'utf8') === '[lzo] zstd\n', 'without lz4 the default algorithm stays');
});
