// The ports the service opens: its own API and every phone page, add-ons included. Two modules that claim the same number are a
// race, not a merge conflict: both are valid code and the tests of each pass alone, and on the TV the second listen fails with
// EADDRINUSE, so which page breaks depends on the order the service and the add-ons happen to start in. The App icons add-on and
// the Spotify page were both 8794 (found while rebasing the Spotify branch, by reading docs/security.md — nothing checked it).
// This reads the numbers out of the code, so the next page that copies a port fails here rather than on someone's TV, and it keeps
// the table in docs/security.md true as well.
const fs = require('fs'),
  path = require('path');
const { root, helper, ok, run } = require('./lib');

// every .js under helper/, the bundled add-ons included (helper/addons-bundled/<id>/service.js), and the catalog add-ons (addons/)
function walk(dir, out) {
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n);
    if (fs.statSync(f).isDirectory()) walk(f, out);
    else if (/\.js$/.test(n)) out.push(f);
  }
  return out;
}

// the shapes a fixed port is written in: const PORT = 8765; const PAIR_PORT = 8792, // after ...; and the notification page's
// default in DEFAULTS (its port is a setting, but the default is a claim too)
const SHAPES = [/\bconst\s+(PAIR_PORT|PORT)\s*=\s*(\d{4,5})/g, /\bconst\s+(DEFAULTS)\s*=\s*\{[^}]*\bport:\s*(\d{4,5})/g];

run(async () => {
  const claims = [];
  for (const f of walk(helper, []).concat(walk(path.join(root, 'addons'), []))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const re of SHAPES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) claims.push({ where: path.relative(root, f).replace(/\\/g, '/'), name: m[1], port: +m[2] });
    }
  }
  const all = claims.map(c => c.port + ' ' + c.where).join(', ');
  ok(claims.length >= 8, 'the ports are found in the code: ' + all);

  // the race this file exists for
  const byPort = {};
  claims.forEach(c => (byPort[c.port] = (byPort[c.port] || []).concat(c.where)));
  const dup = Object.keys(byPort).filter(p => byPort[p].length > 1);
  ok(
    !dup.length,
    dup.length
      ? 'two files claim the same port: ' +
          dup.map(p => p + ' in ' + byPort[p].join(' and ')).join('; ') +
          ' (one of them needs a free port)'
      : 'no two files claim the same port'
  );

  // the table in docs/security.md is the list people read before opening a page to their network: a port the code opens but the
  // table omits is how the 8794 collision stayed invisible
  const docs = fs.readFileSync(path.join(root, 'docs', 'security.md'), 'utf8');
  const missing = claims.filter(c => !new RegExp('\\b' + c.port + '\\b').test(docs));
  ok(
    !missing.length,
    missing.length
      ? 'opened but not in the port table of docs/security.md: ' + missing.map(c => c.port + ' (' + c.where + ')').join(', ')
      : 'every port the code opens is in the port table of docs/security.md'
  );
  // and the other way round: a row for a page that no longer exists sends people looking for nothing. "8768 and up" is the
  // share-log page, which takes the first free port in a range, so it is not a fixed claim.
  const rows = [];
  docs.replace(/^\| (\d{4})\b(?! and up)/gm, (m, p) => (rows.push(+p), m));
  const stale = rows.filter(p => !claims.some(c => c.port === p));
  ok(
    !stale.length,
    stale.length
      ? 'docs/security.md lists a port no file claims: ' + stale.join(', ')
      : 'and the table lists no port the code does not open'
  );
});
