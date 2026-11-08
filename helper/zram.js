// Compressed memory (zram, issue 93). webOS kernels ship the zram driver but LG leaves it unused: the only swap is eswap, a partition
// on the eMMC. Switched on, the pages apps are not using are kept compressed in RAM (lz4) ahead of eswap, which helps TVs with
// little memory. options.zram in config.json is the size in MB (absent: off); the service applies it each time it starts, and the
// boot script starts the service, so it survives a reboot without a boot script of its own. Nothing is written to disk: switching it
// off, or a reboot without the service, leaves the TV as LG ships it. The switch is in the manager app (Experimental).
//   GET  /api/zram          what the TV has now (status())
//   POST /api/zram {size}   a size from SIZES, or 0 for off: saved, then applied at once
const fs = require('fs');
const P = require('./paths'),
  exec = require('./exec'),
  web = require('./web');

const SIZES = [256, 512, 768, 1024];
const DEV = '/dev/zram0';
const PRIORITY = '10'; // ahead of eswap (-2), so idle pages go to RAM first
// How many pages a swap read brings in at once (2^n). LG sets 3 late in boot (memchute-ready.sh, on rest-boot-done), right for eswap
// on the eMMC; with zram every page is decompressed, so reading ahead only costs CPU and memory: 0.
const CLUSTER = () => P.PROC + '/sys/vm/page-cluster';
const MARKER = () => P.D + '/zram-applying'; // exists while a change is under way: if the TV hangs in it, the next start leaves zram off
const MARGIN = 64; // MB of free memory to keep when the stored pages come back into RAM
let clusterBefore = '3';
function cluster(on) {
  const now = read(CLUSTER()).trim();
  if (on && now && now !== '0') clusterBefore = now;
  if (now) write(CLUSTER(), on ? '0' : clusterBefore);
}

const read = f => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch (_) {
    return '';
  }
};
const write = (f, v) => {
  try {
    fs.writeFileSync(f, String(v));
    return true;
  } catch (_) {
    return false;
  }
};
const mb = bytes => Math.round((+bytes || 0) / 1048576);
const why = r => String(r.err || r.error || 'failed').trim();

// the swap areas in /proc/swaps: [{name, size, used}] in MB (the file counts kB)
function swaps() {
  return read(P.PROC + '/swaps')
    .split('\n')
    .slice(1)
    .map(l => l.trim().split(/\s+/))
    .filter(f => f.length >= 4)
    .map(f => ({ name: f[0], size: Math.round(+f[2] / 1024), used: Math.round(+f[3] / 1024) }));
}

// zram as the TV has it now. stored: the pages kept in it; ram: the memory they take, compressed (mm_stat: orig_data_size,
// compr_data_size, mem_used_total, ...). other: the rest of the swap (eswap). memAvailable: MemAvailable from /proc/meminfo.
function status() {
  const all = swaps(),
    z = all.filter(s => s.name === DEV)[0],
    rest = all.filter(s => s.name !== DEV),
    mm = read(P.ZRAM + '/mm_stat')
      .trim()
      .split(/\s+/),
    avail = /^MemAvailable:\s+(\d+)/m.exec(read(P.PROC + '/meminfo'));
  return {
    available: fs.existsSync(P.ZRAM + '/disksize'),
    on: !!z,
    size: z ? z.size : 0,
    stored: z ? mb(mm[0]) : 0,
    ram: z ? mb(mm[2]) : 0,
    other: { size: rest.reduce((n, s) => n + s.size, 0), used: rest.reduce((n, s) => n + s.used, 0) },
    memAvailable: avail ? Math.round(+avail[1] / 1024) : 0,
  };
}

// switch zram off, then on again with `size` MB (0: leave it off); resolves '' or what went wrong
async function apply(size, run) {
  write(MARKER(), 1);
  try {
    return await change(size, run);
  } finally {
    try {
      fs.unlinkSync(MARKER());
    } catch (_) {}
  }
}
async function change(size, run) {
  const now = status();
  if (now.on) {
    // the pages come back into RAM or go to eswap: that needs free memory (what they take uncompressed, less what zram gives back)
    // and can take a while. Short of memory, the TV could stall or kill apps, so wait for the user to close some.
    const need = now.stored - now.ram + MARGIN;
    if (now.memAvailable && now.memAvailable < need)
      return (
        'Not enough free memory to switch compressed memory off now (' +
        now.memAvailable +
        ' MB free, ' +
        need +
        ' MB needed). Close some apps and try again.'
      );
    const r = await run('swapoff', [DEV], { timeout: 120000 });
    if (!r.ok) return 'swapoff: ' + why(r);
  }
  write(P.ZRAM + '/reset', 1);
  if (!size) {
    cluster(false);
    return '';
  }
  if (/\blz4\b/.test(read(P.ZRAM + '/comp_algorithm'))) write(P.ZRAM + '/comp_algorithm', 'lz4'); // the fastest; else the kernel's default
  if (!write(P.ZRAM + '/disksize', size * 1048576)) return 'zram: the size could not be set';
  let r = await run('mkswap', [DEV]);
  if (r.ok) r = await run('swapon', ['-p', PRIORITY, DEV]);
  if (!r.ok) {
    write(P.ZRAM + '/reset', 1);
    cluster(false);
    return why(r);
  }
  cluster(true);
  return '';
}

// ctx.run: how programs are started (exec.run; the tests pass their own)
function create(ctx) {
  const { config } = ctx;
  const run = ctx.run || exec.run;
  const saved = () => {
    const s = config.options().zram;
    return SIZES.indexOf(s) >= 0 ? s : 0;
  };
  let busy = null; // one change at a time: a second one waits for the first
  const queue = size => (busy = (busy || Promise.resolve('')).then(() => apply(size, run)).catch(e => String((e && e.message) || e)));
  const reply = (res, error) => web.json(res, Object.assign(status(), { setting: saved(), sizes: SIZES }, error ? { error } : {}));
  async function handle(req, res, u, body) {
    if (req.method !== 'POST') return reply(res, '');
    const b = await body(req),
      size = +b.size || 0;
    if (size && SIZES.indexOf(size) < 0) return web.json(res, { error: 'size must be one of ' + SIZES.join(', ') + ' (MB) or 0' }, 400);
    if (size && !status().available) return web.json(res, { error: 'this TV has no zram' }, 400);
    const error = await queue(size);
    // saved only when it worked, so the saved size is what the TV has (and what it gets again at the next start)
    if (!error)
      config.update('launcher', c => {
        c.options = c.options || {};
        if (size) c.options.zram = size;
        else delete c.options.zram;
      });
    else console.error('zram: ' + error);
    reply(res, error);
  }
  // at every start of the service (that is, at every boot): zram as saved, unless it is already on (the service was restarted)
  function start() {
    if (fs.existsSync(MARKER())) {
      // the last change never finished (the TV hung or lost power in it): leave zram off, and forget the size so it does not come back
      try {
        fs.unlinkSync(MARKER());
      } catch (_) {}
      config.update('launcher', c => {
        if (c.options) delete c.options.zram;
      });
      console.log('zram: the last change did not finish, so zram stays off; switch it on again in the manager (Experimental)');
      return;
    }
    const size = saved();
    if (size && status().available && !status().on) queue(size).then(e => console.log('zram: ' + (e ? e : size + ' MB on')));
    // LG's boot sets page-cluster after the service has started: set it again once that is over
    if (size) setTimeout(() => status().on && cluster(true), 120000).unref();
  }
  return { name: 'zram', paths: ['/api/zram'], handle, start, status };
}

module.exports = { create, status, apply, SIZES };
