// luna-send, bounded by diag.execFile. Most TVs use closed stdin; the validated
// workaround keeps it open on firmware where EOF can exit before executing a call.
const exec = require('./exec');
const fs = require('fs'),
  P = require('./paths');

// Read on each call: the flag survives updates and can be removed without a restart.
function keepStdinOpen(opts) {
  if (opts && typeof opts.keepStdinOpen === 'boolean') return opts.keepStdinOpen;
  if (process.env.CYTV_LUNA_STDIN === 'open') return true;
  if (process.env.CYTV_LUNA_STDIN === 'closed') return false;
  try {
    return fs.statSync(P.D + '/luna-stdin-open').isFile();
  } catch (_) {
    return false;
  }
}

function luna(uri, payload, opts) {
  const o = opts || {};
  const wait = o.wait || 5000;
  const script = 'luna-send -n 1 -w ' + wait + ' -f "$1" "$2" </dev/null';
  const keep = keepStdinOpen(o);
  const result = keep
    ? exec.run('/usr/bin/luna-send', ['-n', '1', '-w', String(wait), '-f', uri, JSON.stringify(payload || {})], {
        timeout: o.timeout || wait + 3000,
        keepStdinOpen: true,
      })
    : exec.run('/bin/sh', ['-c', script, 'sh', uri, JSON.stringify(payload || {})], { timeout: o.timeout || wait + 3000 });
  return result.then(r => {
    try {
      return JSON.parse(r.out);
    } catch (_) {
      return { returnValue: false, errorText: r.error || 'bad json' };
    }
  });
}

// Share log is synchronous. The shell wrapper holds its own FIFO while spawnSync
// enforces the deadline; passing input: '' would close stdin before Luna replied.
function sync(uri, payload, opts) {
  const o = opts || {},
    wait = o.wait || 5000;
  return exec.runSync(
    '/bin/sh',
    [
      '-c',
      'luna_exec() { exec luna-send "$@" </dev/null; }; if [ -r "$1" ]; then . "$1"; fi; shift; luna_exec "$@"',
      'sh',
      P.D + '/luna-compat.sh',
      '-n',
      '1',
      '-w',
      String(wait),
      '-f',
      uri,
      JSON.stringify(payload || {}),
    ],
    { timeout: o.timeout || wait + 3000, env: Object.assign({}, P.ENV, { CYTV_LUNA_STDIN: keepStdinOpen(o) ? 'open' : 'closed' }) }
  );
}

module.exports = Object.assign(luna, { keepStdinOpen, sync });
