// The reports people attach to an issue (helper/sharelog.js and tools/diagnose.sh): what they must not carry. "Your name" is
// personal data like an address or a token, and it reaches both: the manager's status reply is in the share log, and config.json
// is printed by the diagnose report.
const fs = require('fs'),
  path = require('path');
const { ok, root, run } = require('./lib');

run(async () => {
  const { redact } = require(path.join(root, 'helper', 'sharelog.js'));
  const status = JSON.stringify({
    service: { version: '1.2.3' },
    name: 'Alex',
    options: { liveTv: true, token: 'abc123' },
    notify: { address: '192.168.1.7' },
    playlist: 'https://example.org/private/list.m3u',
  });
  const out = redact(status);
  ok(out.indexOf('Alex') < 0 && /"name":"…"/.test(out), 'the name in the manager status is masked in the report');
  ok(out.indexOf('abc123') < 0 && /"token":"…"/.test(out), 'a token is still masked');
  ok(out.indexOf('192.168.1.7') < 0 && /x\.x\.x\.x/.test(out), 'an address is still masked');
  ok(out.indexOf('list.m3u') < 0, 'a URL path is still masked');
  ok(redact('the cards are set') === 'the cards are set', 'a line without any of these is left as it is');
  const quoted = redact(JSON.stringify({ name: 'Alex "the" Great' }));
  ok(quoted.indexOf('Great') < 0 && /"name":"…"/.test(quoted), 'a name with a quote in it is masked whole');
  // the status reply is shortened to 2500 characters: a cut in the middle of the name must not let the rest through
  ok(redact('{"name":"Alex').indexOf('Alex') < 0, 'a report cut in the middle of the name still hides it');
  ok(redact('{"name":"Alex\nkept text').indexOf('kept text') > 0, 'and the lines after it are kept');
  // tools/diagnose.sh prints config.json with the secret-looking values hidden: the name is one of them
  const diag = fs.readFileSync(path.join(root, 'tools', 'diagnose.sh'), 'utf8');
  const mask = /if\((\/[^/]+\/i)\.test\(k\)/.exec(diag);
  const re = mask && new RegExp(mask[1].replace(/^\/|\/i$/g, ''), 'i');
  ok(
    re && re.test('name') && re.test('token') && re.test('playlist'),
    'the diagnose report hides the name in config.json (and the secrets)'
  );
  ok(re && !re.test('dock') && !re.test('options'), 'and still prints the settings that are not personal');
});
