// Weekly trim of the eMMC (issue 100, found by Reveal80). LG ships fstrim but never runs it, and none of the writable ext4 partitions
// is mounted with discard, so the flash is never told which blocks are free: writes get slower and wear goes up. Switched on
// (options.trim in config.json), the service trims the writable ext4 partitions on the built-in storage five minutes after it starts
// (that is, after the boot) when the last trim is a week old or there was none, and checks again every six hours for a TV that is
// never switched off. The key partitions (uhdcp, ciplus) are left alone. Nothing is changed on the TV but the flash being told what
// is free; fstrim of a mounted ext4 is what a discard mount does all the time. The switch is in the manager app (Experimental).
//   GET  /api/trim             what the TV has: the partitions found, the last run, whether it is on
//   POST /api/trim {on}        switch the weekly trim on or off (saved)
//   POST /api/trim {now: true} trim now and answer with the result
// The last run is kept in trim.json in the service folder, so a TV that is mostly in Quick Start+ still trims at its next cold boot.
const fs = require('fs');
const P = require('./paths'),
  exec = require('./exec'),
  web = require('./web');

const WEEK = 7 * 24 * 3600 * 1000;
const DELAY = 5 * 60 * 1000; // after the start of the service, so the boot itself is left alone
const EVERY = 6 * 3600 * 1000;
const KEEP_OUT = /uhdcp|ciplus|authcxt|keystore|\/key\b/; // the small partitions of keys and certificates: almost never written, better left alone
const LAST = () => P.D + '/trim.json';

const read = f => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch (_) {
    return '';
  }
};
// the octal escapes /proc/mounts uses for a space in a name
const unescape = s => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

// the writable ext4 partitions on the built-in storage, one mount point each: [{dev, mount}]
function partitions() {
  const by = {};
  for (const line of read(P.PROC + '/mounts').split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4) continue;
    const dev = f[0],
      mount = unescape(f[1]);
    if (!/^\/dev\/mmcblk\d+p\d+$/.test(dev) || f[2] !== 'ext4' || f[3].split(',').indexOf('rw') < 0) continue;
    if (KEEP_OUT.test(mount)) continue;
    // one filesystem is often mounted in several places (bind mounts, our own over LG's Home): trimming it once is enough, by a plain
    // mount point of its own
    const plain = m => m.indexOf('/usr/') !== 0 && m.indexOf('cleanyourtv') < 0;
    if (!by[dev] || (plain(mount) && !plain(by[dev]))) by[dev] = mount;
  }
  return Object.keys(by)
    .sort()
    .map(dev => ({ dev, mount: by[dev] }));
}
// does the storage take discard? /sys/block/mmcblk0/queue/discard_max_bytes is 0 or missing where it does not
function discard() {
  const dev = (partitions()[0] || {}).dev;
  const disk = dev && /\/dev\/(mmcblk\d+)p\d+/.exec(dev);
  return !!disk && +read(P.SYSBLOCK + '/' + disk[1] + '/queue/discard_max_bytes') > 0;
}
// "/var: 21516288 bytes trimmed" (BusyBox) or "/var: 20.5 MiB (21516288 bytes) trimmed" (util-linux)
function trimmed(out) {
  const m = /(\d+)\s*bytes/.exec(String(out));
  return m ? +m[1] : 0;
}

function create(ctx) {
  const { config } = ctx;
  const run = ctx.run || exec.run;
  const now = ctx.now || Date.now;
  const on = () => config.options().trim === true;
  const last = () => {
    try {
      return JSON.parse(read(LAST())) || null;
    } catch (_) {
      return null;
    }
  };
  let busy = null; // one run at a time
  async function trim() {
    const mounts = [];
    for (const p of partitions()) {
      const r = await run('fstrim', ['-v', p.mount], { timeout: 180000 });
      mounts.push(
        r.ok
          ? { mount: p.mount, bytes: trimmed(r.out) }
          : {
              mount: p.mount,
              bytes: 0,
              error: String(r.err || r.error || 'failed')
                .trim()
                .slice(0, 200),
            }
      );
    }
    const result = { at: now(), ok: mounts.length > 0 && mounts.every(m => !m.error), mounts };
    try {
      fs.writeFileSync(LAST(), JSON.stringify(result));
    } catch (_) {}
    console.log(
      'trim: ' + mounts.map(m => m.mount + ' ' + (m.error ? 'failed: ' + m.error : Math.round(m.bytes / 1048576) + ' MB')).join(', ')
    );
    return result;
  }
  // (no Promise.prototype.finally: Node.js 8)
  const once = () =>
    (busy =
      busy ||
      trim().then(
        r => {
          busy = null;
          return r;
        },
        e => {
          busy = null;
          throw e;
        }
      ));
  const due = () => {
    const l = last();
    return !l || now() - l.at >= WEEK;
  };
  const status = () => ({
    available: partitions().length > 0 && discard(),
    on: on(),
    partitions: partitions().map(p => p.mount),
    last: last(),
    nextDue: last() ? last().at + WEEK : 0,
    running: !!busy,
  });
  async function handle(req, res, u, body) {
    if (req.method !== 'POST') return web.json(res, status());
    const b = await body(req);
    if (b.now === true) {
      if (!status().available) return web.json(res, { error: 'this TV has no built-in storage to trim' }, 400);
      const r = await once();
      return web.json(res, Object.assign(status(), { result: r }));
    }
    if (typeof b.on !== 'boolean') return web.json(res, { error: 'on must be true or false' }, 400);
    if (b.on && !status().available) return web.json(res, { error: 'this TV has no built-in storage to trim' }, 400);
    config.update('launcher', c => {
      c.options = c.options || {};
      if (b.on) c.options.trim = true;
      else delete c.options.trim;
    });
    web.json(res, status());
  }
  // five minutes after the start, and then every few hours: trim when it is on, the storage takes it and the last trim is a week old
  function check() {
    if (on() && due() && status().available && !busy) return once().catch(e => console.error('trim: ' + ((e && e.message) || e)));
    return Promise.resolve(null);
  }
  function start() {
    setTimeout(check, DELAY).unref();
    setInterval(check, EVERY).unref();
  }
  return { name: 'fstrim', paths: ['/api/trim'], handle, start, status, check, once };
}

module.exports = { create, partitions, trimmed, discard, WEEK, DELAY };
