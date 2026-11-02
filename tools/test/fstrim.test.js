// Weekly trim of the eMMC (fstrim.js, issue 100): which partitions are trimmed, the discard check, the switch, "trim now", and when the
// weekly check trims. /proc, /sys/block and the programs are stand-ins.
const fs = require('fs'),
  path = require('path');
const { ok, call, tmp, memoryConfig, run } = require('./lib');
const SYS = path.join(tmp, 'sysblock');
process.env.CYTV_SYSBLOCK = SYS;
const fstrim = require(path.join(__dirname, '..', '..', 'helper', 'fstrim'));
const PROC = process.env.CYTV_PROC;

const MOUNTS = [
  '/dev/root / ext4 ro,relatime 0 0',
  'tmpfs /tmp tmpfs rw 0 0',
  '/dev/mmcblk0p57 /var ext4 rw,relatime,data=ordered 0 0',
  '/dev/mmcblk0p57 /home ext4 rw,relatime 0 0',
  '/dev/mmcblk0p58 /mnt/lg/appstore ext4 rw,relatime 0 0',
  '/dev/mmcblk0p58 /media ext4 rw,relatime 0 0',
  '/dev/mmcblk0p56 /usr/palm/applications/com.webos.app.home ext4 rw,relatime 0 0',
  '/dev/mmcblk0p56 /mnt/lg/db8 ext4 rw,relatime 0 0',
  '/dev/mmcblk0p60 /mnt/lg/uhdcp ext4 rw,relatime 0 0',
  '/dev/mmcblk0p61 /mnt/lg/ciplus/authcxt ext4 rw,relatime 0 0',
  '/dev/mmcblk0p62 /mnt/lg/readonly ext4 ro,relatime 0 0',
  '/dev/mmcblk0p63 /mnt/lg/data\\040with\\040space ext4 rw,relatime 0 0',
  '/dev/mapper/eswap /nowhere ext4 rw 0 0',
  '/dev/sda1 /media/usb ext4 rw 0 0',
  '/dev/mmcblk0p64 /mnt/lg/other vfat rw 0 0',
].join('\n');

function programs(fail) {
  const calls = [];
  const runner = async (cmd, args) => {
    calls.push(cmd + ' ' + args.join(' '));
    if (fail && args[1] === fail)
      return { ok: false, code: 1, out: '', err: 'fstrim: ' + fail + ': FITRIM ioctl failed\n', error: 'failed' };
    return { ok: true, code: 0, out: args[1] + ': 4194304 bytes trimmed\n', err: '', error: '' };
  };
  return { calls, runner };
}

run(async () => {
  fs.writeFileSync(PROC + '/mounts', MOUNTS + '\n');
  const parts = fstrim.partitions();
  ok(
    parts
      .map(p => p.mount)
      .sort()
      .join('|') === ['/mnt/lg/appstore', '/mnt/lg/data with space', '/mnt/lg/db8', '/var'].sort().join('|'),
    'the writable ext4 partitions on the built-in storage, one mount point each, without binds, key partitions, read-only or USB: ' +
      JSON.stringify(parts)
  );
  ok(
    fstrim.trimmed('/var: 21516288 bytes trimmed') === 21516288 &&
      fstrim.trimmed('/var: 20.5 MiB (21516288 bytes) trimmed') === 21516288 &&
      fstrim.trimmed('nothing') === 0,
    'both fstrim outputs are read'
  );

  // no discard on the storage: not available
  let p = programs();
  const conf = memoryConfig();
  let t0 = Date.parse('2026-11-02T12:00:00Z');
  const clock = { now: t0 };
  const mk = c => require(path.join(__dirname, '..', '..', 'helper', 'fstrim')).create({ config: c, run: p.runner, now: () => clock.now });
  let f = mk(conf);
  let x = await call(f, '/api/trim');
  ok(x.j.available === false && x.j.on === false && x.j.last === null, 'without discard support the weekly trim is not offered');
  x = await call(f, '/api/trim', 'POST', { on: true });
  ok(x.code === 400 && !conf.options().trim, 'and cannot be switched on');
  x = await call(f, '/api/trim', 'POST', { now: true });
  ok(x.code === 400 && !p.calls.length, 'nor run');

  require(path.join(__dirname, '..', '..', 'helper', 'netcompat')).mkdirp(path.join(SYS, 'mmcblk0', 'queue'));
  fs.writeFileSync(path.join(SYS, 'mmcblk0', 'queue', 'discard_max_bytes'), '51904512\n');
  x = await call(f, '/api/trim');
  ok(
    x.j.available === true && x.j.on === false && x.j.partitions.length === 4,
    'with discard support it is offered, off by default, with the partitions it would trim'
  );
  x = await call(f, '/api/trim', 'POST', { on: 'yes' });
  ok(x.code === 400, 'the switch must be true or false');

  // nothing runs while it is off, however old the last trim is
  p.calls.length = 0;
  await f.check();
  ok(!p.calls.length, 'off: the weekly check trims nothing');

  x = await call(f, '/api/trim', 'POST', { on: true });
  ok(x.j.on === true && conf.options().trim === true, 'switched on and saved');
  await f.check();
  ok(
    p.calls.length === 4 && p.calls.every(c => /^fstrim -v \//.test(c)),
    'on and never run: every partition is trimmed once: ' + p.calls.join('; ')
  );
  let l = JSON.parse(fs.readFileSync(process.env.CYTV_DIR + '/trim.json', 'utf8'));
  ok(l.ok === true && l.at === clock.now && l.mounts.length === 4 && l.mounts[0].bytes === 4194304, 'the result is kept in trim.json');
  p.calls.length = 0;
  clock.now += 6 * 24 * 3600 * 1000;
  await f.check();
  ok(!p.calls.length, 'six days later: not due yet');
  clock.now += 2 * 24 * 3600 * 1000;
  await f.check();
  ok(p.calls.length === 4, 'a week after the last trim: due again');

  // a failing partition is reported, the others still run
  p = programs('/mnt/lg/db8');
  f = mk(conf);
  x = await call(f, '/api/trim', 'POST', { now: true });
  const bad = (x.j.result.mounts || []).filter(m => m.error);
  ok(
    p.calls.length === 4 &&
      x.j.result.ok === false &&
      bad.length === 1 &&
      bad[0].mount === '/mnt/lg/db8' &&
      /FITRIM/.test(bad[0].error) &&
      x.j.last.ok === false,
    'one partition failing is reported and the others are still trimmed'
  );
  // trim now works with the weekly trim off
  conf.update('test', c => {
    delete c.options.trim;
  });
  p.calls.length = 0;
  x = await call(f, '/api/trim', 'POST', { now: true });
  ok(p.calls.length === 4 && x.j.on === false, 'Trim now also works with the weekly trim off');
  x = await call(f, '/api/trim', 'POST', { on: false });
  ok(x.j.on === false && conf.options().trim === undefined, 'off removes the option');
});
