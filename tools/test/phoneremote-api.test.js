// The phone remote protocol page (docs/phone-remote-api.md) and the code that speaks it (service.js, remotekeys.js, page.js): every
// message type, close code, key name and window.CYTV_APP hook the page names exists in the code, and the other way round, so a client
// built from the page cannot be met by a TV that answers something else. No TV: this reads the two files.
'use strict';
const fs = require('fs'),
  path = require('path');
const { ok, run, root } = require('./lib');

const DOC = path.join(root, 'docs', 'phone-remote-api.md');
const ADDON = path.join(root, 'addons', 'catalog', 'phoneremote');
const doc = fs.readFileSync(DOC, 'utf8');
const service = fs.readFileSync(path.join(ADDON, 'service.js'), 'utf8');
const page = fs.readFileSync(path.join(ADDON, 'page.js'), 'utf8');
const KEYS = require(path.join(ADDON, 'remotekeys')).KEYS;

// a markdown table right after a heading (or after a table header line): its first cell when that is a single `code` word
function tableAfter(text, start) {
  const lines = text.split('\n');
  let i = 0;
  for (; i < lines.length; i++) if (start.test(lines[i])) break;
  if (i === lines.length) return [];
  // the heading, then the table's own header and separator
  for (; i < lines.length && !/^\|/.test(lines[i]); i++);
  const out = [];
  for (; i < lines.length && /^\|/.test(lines[i]); i++) {
    const m = /^\| `([^`]+)`/.exec(lines[i]);
    if (m) out.push(m[1]);
  }
  return out;
}
const sorted = a => a.slice().sort().join(', ');
const same = (a, b) => sorted(a) === sorted(b);
const only = (a, b) => a.filter(x => b.indexOf(x) < 0);

// ---- the code ----
// the actions of a connection (the client messages that do something), and the three handled before them
const ACTIONS = (() => {
  const i = service.indexOf('const ACTIONS = {'),
    j = service.indexOf('\n  };', i),
    block = service.slice(i, j),
    out = [];
  const re = /^\s{4}([a-zA-Z]+):/gm;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
})();
const before = (() => {
  const out = [],
    re = /m\.t === '(\w+)'/g;
  let m;
  while ((m = re.exec(service))) out.push(m[1]);
  return out;
})();
const SERVER = (() => {
  const out = [];
  let m;
  const a = /t: '(\w+)'/g,
    b = /\{"t":"(\w+)"\}/g;
  while ((m = a.exec(service))) out.push(m[1]);
  while ((m = b.exec(service))) out.push(m[1]);
  return out.filter((x, i, all) => all.indexOf(x) === i);
})();
const CLOSE = (() => {
  const out = [],
    re = /\.close\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(service))) {
    const codes = String(m[1]).match(/\b(4\d{3}|1000)\b/g) || [];
    codes.forEach(c => out.indexOf(c) < 0 && out.push(c));
  }
  return out;
})();
const HOOKS = (() => {
  const out = [],
    re = /CYTV_APP\.(\w+)/g;
  let m;
  while ((m = re.exec(page))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
})();

// ---- the page ----
const docClient = tableAfter(doc, /^### Messages from the client$/);
const docServer = tableAfter(doc, /^\| From the TV \|/);
const docClose = tableAfter(doc, /^\| Close code \|/);
const docHooks = tableAfter(doc, /^## The page's `window\.CYTV_APP` hooks$/).map(x => x.replace(/\(.*$/, ''));
const docKeys = (() => {
  const line = doc.split('\n').filter(l => l.indexOf('The key names are:') === 0)[0] || '';
  const m = /`([^`]+)`/.exec(line);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
})();

run(async () => {
  ok(docClient.length >= 10, 'the page lists the client messages (' + docClient.length + ')');
  ok(docServer.length >= 6, 'the page lists the messages from the TV (' + docServer.length + ')');

  // the client's messages: the actions, and the four handled before an action
  const codeClient = ACTIONS.concat(['ping', 'power', 'logout']);
  ok(
    only(docClient, codeClient).length === 0,
    'every client message in the page is one the service answers: missing ' + only(docClient, codeClient).join(', ')
  );
  ok(
    only(codeClient, docClient).length === 0,
    'every client message of the service is in the page: missing ' + only(codeClient, docClient).join(', ')
  );
  ok(doc.indexOf('"t": "hello"') >= 0 && before.indexOf('hello') >= 0, 'the first message (hello) is in both');
  ok(
    only(codeClient, ACTIONS).join(',') === 'ping,power,logout',
    'the messages before an action are the three the page names (ping, power, logout)'
  );

  ok(
    only(docServer, SERVER).length === 0 && only(SERVER, docServer).length === 0,
    'the messages from the TV are the same in both: page ' + sorted(docServer) + ', code ' + sorted(SERVER)
  );

  ok(
    only(docClose, CLOSE).length === 0 && only(CLOSE, docClose).length === 0,
    'the close codes are the same in both: page ' + sorted(docClose) + ', code ' + sorted(CLOSE)
  );

  ok(same(docKeys, KEYS), 'the key names are the same in both: page ' + docKeys.length + ', code ' + KEYS.length);
  ok(docKeys.indexOf('POWER') >= 0 && KEYS.indexOf('POWER') >= 0, 'POWER is one of them, as the phone page sends it');

  ok(
    same(docHooks, HOOKS) && HOOKS.length === 7,
    'the window.CYTV_APP hooks are the same in both: page ' + sorted(docHooks) + ', page.js ' + sorted(HOOKS)
  );
  ok(
    ['wake', 'setMac', 'deviceName', 'buzz', 'up', 'forget', 'setName'].every(h => docHooks.indexOf(h) >= 0),
    'the hooks a wrapper can rely on are written down'
  );
});
