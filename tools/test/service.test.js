// The service as a whole: every file parses and loads on this Node, and nothing in it needs a Node newer than 8.12 (webOS 5 and 6).
// The rules below catch what a newer Node accepts and Node 8 does not; AGENTS.md lists them.
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const { root, helper, ok, run } = require('./lib');

run(async () => {
  const files = fs
    .readdirSync(helper)
    .filter(f => /\.js$/.test(f))
    .map(f => path.join(helper, f))
    .concat(path.join(root, 'scripts', 'jtool.js'))
    // add-ons run in the service too: the bundled ones and the catalog's service files must run on Node 8 as well
    .concat(
      ['helper/addons-bundled/iptv/service.js']
        .concat(
          fs
            .readdirSync(path.join(root, 'addons', 'catalog'))
            .filter(d => fs.existsSync(path.join(root, 'addons', 'catalog', d, 'service.js')))
            // every .js file of a service add-on runs in the service (service.js and the files it requires)
            .reduce(
              (all, d) =>
                all.concat(
                  fs
                    .readdirSync(path.join(root, 'addons', 'catalog', d))
                    .filter(f => /\.js$/.test(f))
                    .map(f => 'addons/catalog/' + d + '/' + f)
                ),
              []
            )
        )
        .map(f => path.join(root, f))
    );
  for (const f of files) {
    const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    ok(r.status === 0, 'syntax ' + path.relative(root, f) + (r.status ? '\n' + r.stderr : ''));
  }
  // every module loads (helper.js starts the service and sharelog.js is a program: they are only parsed above)
  for (const f of files.filter(f => /helper[\\/][a-z]+\.js$/.test(f) && !/(helper|sharelog|selfupdate)\.js$/.test(f))) {
    try {
      require(f);
      ok(true, 'loads ' + path.basename(f));
    } catch (e) {
      ok(false, 'loads ' + path.basename(f) + ': ' + e.message);
    }
  }
  // code that works on a newer Node but not on Node 8
  const rules = [
    [/\?\?|\?\.[A-Za-z_\[(]/, 'optional chaining or ??'],
    [/\bfs\.(rmSync|cpSync)\b|\bfs\.promises\b|\bfs\/promises\b/, 'an fs function newer than Node 8'],
    [/mkdirSync\([^)]*recursive/, 'mkdirSync({recursive}) (use netcompat.mkdirp)'],
    [/\b(cp|child_process)\.(execFile|exec|spawn)\([^\n]*\btimeout:/, 'the timeout option on an asynchronous child process (use exec.js)'],
    [/\bhttps?\.(get|request)\(\s*[^,()]+,\s*\{/, 'http(s).get(url, options, cb) (use netcompat or fetch.js)'],
    [/\bcrypto\.randomInt\b/, 'crypto.randomInt (use netcompat.randomInt)'],
    [
      /\.(flat|flatMap|matchAll|replaceAll|findLast)\(|\bObject\.fromEntries\b|\bPromise\.(allSettled|any)\b|\bglobalThis\b|\|\|=|&&=|\bstructuredClone\b/,
      'a function or operator newer than Node 8',
    ],
    [/catch\s*\{/, 'catch without a variable (Node 10)'],
  ];
  const bad = [];
  for (const f of files) {
    const base = path.basename(f);
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const code = line.replace(/^\s*\/\/.*$/, '');
        if (!code.trim()) return;
        for (const r of rules)
          if (r[0].test(code) && !(base === 'netcompat.js' && /randomInt|recursive/.test(code)))
            bad.push(base + ':' + (i + 1) + ' ' + r[1]);
      });
  }
  ok(!bad.length, 'nothing needs a Node newer than 8.12' + (bad.length ? ':\n  ' + bad.join('\n  ') : ''));
  // the TV's paths are in paths.js only, so a test (or another TV) can move them
  const fixed = [];
  for (const f of files.filter(f => !/(paths|jtool)\.js$/.test(f)))
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/'\/media\/developer\/cleanyourtv|'\/proc['\/]/.test(line.replace(/\/\/.*$/, ''))) fixed.push(path.basename(f) + ':' + (i + 1));
      });
  ok(!fixed.length, 'the service folder and /proc are named only in paths.js' + (fixed.length ? ': ' + fixed.join(', ') : ''));
  const direct = files.filter(
    f => !/(exec|diag|selfupdate)\.js$/.test(f) && /\bcp\.(execFile|exec|spawn)\(|execSync\(/.test(fs.readFileSync(f, 'utf8'))
  );
  ok(
    direct.length <= 1,
    'programs are started through exec.js (voice.js keeps its long-running recogniser and stream): ' +
      direct.map(f => path.basename(f)).join(', ')
  );
});
