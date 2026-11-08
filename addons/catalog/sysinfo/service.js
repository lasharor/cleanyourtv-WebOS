// TV status: memory, swap, load and uptime, read from /proc (GET /api/addons/sysinfo/stats).
const fs = require('fs');

// "MemTotal:  987348 kB" lines -> {MemTotal: 987348, ...} in kB
function parseMeminfo(text) {
  const out = {};
  String(text)
    .split('\n')
    .forEach(l => {
      const m = /^(\w+):\s+(\d+)/.exec(l);
      if (m) out[m[1]] = parseInt(m[2], 10);
    });
  return out;
}

function stats(read) {
  const mem = parseMeminfo(read('meminfo')),
    load = String(read('loadavg')).split(/\s+/).slice(0, 3).map(parseFloat),
    up = parseFloat(String(read('uptime')).split(/\s+/)[0]);
  const total = mem.MemTotal || 0,
    // MemAvailable is missing on old kernels: free plus caches is the next best
    avail = mem.MemAvailable !== undefined ? mem.MemAvailable : (mem.MemFree || 0) + (mem.Buffers || 0) + (mem.Cached || 0);
  return {
    memTotalMB: Math.round(total / 1024),
    memUsedMB: Math.round((total - avail) / 1024),
    swapTotalMB: Math.round((mem.SwapTotal || 0) / 1024),
    swapUsedMB: Math.round(((mem.SwapTotal || 0) - (mem.SwapFree || 0)) / 1024),
    load: load.map(n => (isNaN(n) ? 0 : n)),
    uptimeS: isNaN(up) ? 0 : Math.round(up),
  };
}

function create(ctx) {
  const read = f => {
    try {
      return fs.readFileSync(ctx.proc + '/' + f, 'utf8'); // ctx.proc: the TV's /proc
    } catch (_) {
      return '';
    }
  };
  async function handle(req, res, p) {
    res.writeHead(p === '/stats' ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(p === '/stats' ? stats(read) : { error: 'not found' }));
  }
  return { handle };
}

module.exports = { create, parseMeminfo, stats };
