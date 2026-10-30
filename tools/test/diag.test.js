// Running programs (exec.js, diag.js): the time limit is kept without Node's own (which can abort Node 8), output limits, and the last
// operations survive a process that died.
const fs = require('fs');
const { ok, req, run } = require('./lib');
const diag = req('diag'),
  exec = req('exec');

run(async () => {
  const dx = (cmd, args, o) => new Promise(res => diag.execFile(cmd, args, o || {}, (e, out, err) => res({ e, out, err })));
  let r = await dx('/bin/sh', ['-c', 'echo hi; echo oops 1>&2']);
  ok(r.e === null && r.out === 'hi\n' && r.err === 'oops\n', 'execFile returns stdout and stderr');
  const eofProbe =
    'process.stdin.on("end",function(){console.log("EOF");process.exit(0)});process.stdin.resume();setTimeout(function(){console.log("OPEN");process.exit(0)},100)';
  r = await dx(process.execPath, ['-e', eofProbe]);
  ok(r.out.trim() === 'EOF', 'stdin stays closed by default');
  r = await dx(process.execPath, ['-e', eofProbe], { keepStdinOpen: true, timeout: 2000 });
  ok(r.e === null && r.out.trim() === 'OPEN', 'the webOS 7 adapter can retain stdin without losing its time limit');
  const openStarted = Date.now();
  r = await dx(process.execPath, ['-e', 'process.stdin.resume();setInterval(function(){},1000)'], {
    keepStdinOpen: true,
    timeout: 300,
  });
  ok(r.e && r.e.killed === true && Date.now() - openStarted < 2000, 'an open stdin pipe cannot bypass the process time limit');
  r = await dx('/bin/sh', ['-c', 'exit 3']);
  ok(r.e && r.e.code === 3, 'a failing command reports its exit code');
  const t0 = Date.now();
  r = await dx('/bin/sh', ['-c', 'sleep 5'], { timeout: 300 });
  ok(r.e && r.e.killed === true && Date.now() - t0 < 2000, 'a command that takes too long is killed once and reported');
  r = await dx('/nonexistent/command', []);
  ok(r.e && /ENOENT/.test(String(r.e.code || r.e.message)), 'a missing command is reported');
  r = await dx('/bin/sh', ['-c', 'head -c 3000000 /dev/zero | tr "\\0" "a"'], { maxBuffer: 1000 });
  ok(r.e === null && r.out.length >= 1000 && r.out.length < 200000, 'output beyond maxBuffer is dropped, not a crash');

  let x = await exec.sh('echo a; exit 2');
  ok(x.ok === false && x.code === 2 && x.out === 'a\n', 'exec.sh resolves with the exit code and the output, it never rejects');
  x = await exec.run('/bin/sh', ['-c', 'sleep 5'], { timeout: 200 });
  ok(x.ok === false && /timed out/.test(x.error), 'exec.run keeps the time limit');
  ok(
    exec.shSync('echo sync') === 'sync\n' &&
      /failed|not found/.test(exec.shSync('exit 1; ', 2000) + exec.shSync('nonexistent-cmd-xyz 2>&1')),
    'exec.shSync for the report collector'
  );
  const luna = req('luna');
  const lr = await luna('luna://x/y', {}, { timeout: 2000 });
  ok(lr.returnValue === false && typeof lr.errorText === 'string', 'luna without luna-send answers returnValue false, never throws');

  diag.note('request', 'GET http://192.168.1.3:36400/live/user/secret/123.m3u8');
  ok(
    diag.ops().some(o => /\/live\/\*\/\*\/123/.test(o)) && !diag.ops().some(o => /secret/.test(o)),
    'logged operations hide the credentials of a stream address'
  );
  fs.writeFileSync(
    process.env.CYTV_RUNFILE,
    JSON.stringify({ pid: 999999, started: 1790000000, ops: ['1790000001 exec luna-send -n 1', '1790000002 request GET http://x/y'] })
  );
  const logged = [];
  const oe = console.error;
  console.error = function () {
    logged.push([].slice.call(arguments).join(' '));
  };
  diag.start();
  console.error = oe;
  ok(
    logged.length === 1 && /ended without a clean exit/.test(logged[0]) && /luna-send/.test(logged[0]),
    'a start that finds the file of a dead process logs its last operations'
  );
  ok(JSON.parse(fs.readFileSync(process.env.CYTV_RUNFILE, 'utf8')).pid === process.pid, 'the file now belongs to the running process');
});
