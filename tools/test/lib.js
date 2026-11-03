// Shared by the tests in tools/test: each *.test.js is a script that runs on its own (node tools/test/<name>.test.js) and is run by
// tools/test.js under Node 8.12 (webOS 5 and 6) and the current Node. It prints one line per check ("ok   ..." or "FAIL ...") and
// exits with 1 when a check failed. Nothing leaves this machine: servers are local stand-ins.
'use strict';
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  http = require('http'),
  cp = require('child_process');

const root = path.join(__dirname, '..', '..');
const helper = path.join(root, 'helper');
// a temporary folder for this test file; the service's folders point into it (see helper/paths.js)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-test-'));
process.env.CYTV_DIR = path.join(tmp, 'cytv');
process.env.CYTV_SERVICE_DIR = path.join(tmp, 'svc');
process.env.CYTV_LIVE_DIR = path.join(tmp, 'live', 'deep'); // exercises mkdir -p as well
process.env.CYTV_RUNFILE = path.join(tmp, 'run.json');
process.env.CYTV_PROC = path.join(tmp, 'proc');
process.env.CYTV_HOOK_CFG = path.join(tmp, 'hookcfg'); // the hook keybinds.json and log, not the TV ones
process.env.CYTV_HOOK_LOG = path.join(tmp, 'hook.log');
process.env.CYTV_SYSLOG = path.join(tmp, 'messages'); // LG's system log (the names of the remote's buttons), not the TV one
process.env.CYTV_HOME_PARAMS = path.join(tmp, 'home-params'); // what a key script asks the launcher to open
for (const d of [process.env.CYTV_DIR, process.env.CYTV_SERVICE_DIR, process.env.CYTV_PROC]) fs.mkdirSync(d);

let failed = 0;
function ok(cond, name) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name);
  if (!cond) failed++;
}
// a request and a response for a handler(req, res, path, body), without a server
function fake(url, method) {
  const res = {
    code: 0,
    out: '',
    headers: null,
    headersSent: false,
    writeHead(c, h) {
      this.code = c;
      this.headers = h || null;
      this.headersSent = true;
    },
    setHeader() {},
    end(s) {
      this.out = s === undefined ? '' : s;
    },
  };
  return { req: { url, method: method || 'GET', headers: {} }, res };
}
// call a feature's handle() and return {code, j (the JSON reply), out}
async function call(feature, url, method, body) {
  const x = fake(url, method);
  await feature.handle(x.req, x.res, url.split('?')[0], async () => (body === undefined ? {} : body));
  let j = null;
  try {
    j = JSON.parse(x.res.out);
  } catch (_) {}
  return { code: x.res.code, j, out: x.res.out };
}
// a local server; resolves with it and its base address
function serve(handler) {
  const s = http.createServer(handler);
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ server: s, url: 'http://127.0.0.1:' + s.address().port })));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const req = name => require(path.join(helper, name));
// a settings store in memory, as the service's config.js gives it
const memoryConfig = initial => req('config').memory(initial || {});

// run the async body of a test file, then report and clean up
function run(body) {
  body()
    .catch(e => {
      console.log('FAIL the test stopped: ' + ((e && e.stack) || e));
      failed++;
    })
    .then(() => {
      cp.spawnSync('rm', ['-rf', tmp]);
      process.exit(failed ? 1 : 0);
    });
}

module.exports = { root, helper, tmp, ok, fake, call, serve, sleep, req, memoryConfig, run };
