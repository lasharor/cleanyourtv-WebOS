// The one way the service starts other programs. Node 8 (webOS 5 and 6) can abort with "uv_close: Assertion
// !uv__is_closing(handle)" when its own `timeout` option kills a child, so the time limit is kept by diag.execFile instead, and
// every start is noted for the report after an abnormal exit (see diag.js).
const cp = require('child_process');
const diag = require('./diag'),
  P = require('./paths');

// run a program; resolves {ok, code, out, err, error} and never rejects.
// Node 8 (webOS 5 and 6) sometimes aborts the child it has just forked, before the program runs: the child prints Node's
// "uv_close: Assertion !uv__is_closing(handle)" to the service log and ends with SIGABRT. On an LG 65UP77006LB (webOS 6.5.3) it
// happened to the first program started while the service was starting, at every start (issue 125: there it was mkswap, so zram did
// not come on). Such a child is started again, up to three times, half a second apart: it ended within 2 seconds, by SIGABRT, without
// a byte of output, so the program never ran. Once was not always enough: on that TV the second start aborted as well after a power
// on from standby. It is not only a start-up and standby thing: on the same TV it happened five times in one session, long after the
// service was up, while the TV was loaded (load average 35, 400 MB of swap in use), so a fork that fails under memory pressure looks
// likelier than a start-up race (issue 272). Every case so far was recovered by the first start again.
function run(cmd, args, opts) {
  const o = Object.assign({ env: P.ENV, timeout: 60000, maxBuffer: 8 << 20 }, opts || {});
  const once = () =>
    new Promise(resolve => {
      const t0 = Date.now();
      diag.execFile(cmd, args || [], o, (e, out, err) =>
        resolve({
          ok: !e,
          code: e ? e.code : 0,
          out: String(out || ''),
          err: String(err || ''),
          error: e ? String(e.message || e) : '',
          abortedAtStart: !!e && e.message === 'exit SIGABRT' && !out && !err && Date.now() - t0 < 2000,
        })
      );
    });
  const attempt = n =>
    once().then(r => {
      if (!r.abortedAtStart || n >= RETRIES) return clean(r);
      diag.note('exec', 'aborted at start (Node 8), again: ' + label(cmd, args));
      console.log(
        'exec: ' + label(cmd, args) + ' ended by SIGABRT before it ran (Node 8); started again (' + (n + 1) + ' of ' + RETRIES + ')'
      );
      return new Promise(res => setTimeout(res, RETRY_MS)).then(() => attempt(n + 1));
    });
  return attempt(0);
}
const RETRIES = 3,
  RETRY_MS = 500;
// what the log says about the program that aborted. For /bin/sh that is the start of its script, which is what tells the caller: the
// log used to say only "/bin/sh". Blanks are squeezed and the text is cut, so one line stays one line.
const label = (cmd, args) => {
  const a = Array.isArray(args) ? args : [];
  const text = (cmd === '/bin/sh' && a[0] === '-c' ? a[1] : a.join(' ')) || '';
  const short = String(text).replace(/\s+/g, ' ').trim();
  return short ? cmd + ' (' + (short.length > 60 ? short.slice(0, 60) + '...' : short) + ')' : cmd;
};
const clean = r => {
  delete r.abortedAtStart;
  return r;
};
// run a shell command line
const sh = (script, ms) => run('/bin/sh', ['-c', script], { timeout: ms || 60000 });
// the callback form, for code that streams or needs the child
const execFile = (cmd, args, opts, cb) => diag.execFile(cmd, args, Object.assign({ env: P.ENV }, opts || {}), cb);
// a shell command line that keeps running after this process (restarts, uninstall)
function detached(script) {
  diag.note('exec', 'detached ' + script.slice(0, 100));
  const c = cp.spawn('/bin/sh', ['-c', script], { env: P.ENV, detached: true, stdio: 'ignore' });
  c.unref();
  return c;
}
// for the standalone tools (sharelog.js) that collect a report step by step; spawnSync keeps its own time limit safely
function runSync(cmd, args, opts) {
  const r = cp.spawnSync(
    cmd,
    args,
    Object.assign(
      {
        env: P.ENV,
        timeout: 8000,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
      opts || {}
    )
  );
  if (r.error) return '(failed: ' + String(r.error.message).split('\n')[0] + ')';
  return (r.stdout || '') + (r.status === 0 ? '' : r.stderr || '');
}
const shSync = (script, ms) => runSync('/bin/sh', ['-c', script], { timeout: ms || 8000 });

module.exports = { run, sh, execFile, detached, shSync, runSync };
