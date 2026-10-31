// Builds the pages the TV loads (one file each, as webOS expects) from their sources:
//   app/src/      -> app/index.html            the launcher
//   manager/src/  -> manager/app/index.html    the manager app
// A source folder has index.html with "@include <file>" lines, replaced by those files (CSS under css/, script under js/), and an
// "@i18n" line, replaced by the translations the page uses (from i18n/<language>.json, see i18n/README.md) and i18n/runtime.js.
// The Inputs picker is one hand-written file: its translations sit between the lines "/* @i18n */" and "/* @i18n end */" and are
// rewritten in place. Edit the sources, then run:
//   node tools/build-pages.js           writes the pages
//   node tools/build-pages.js --check   only checks that the pages match their sources (tools/check.sh runs this)
// The pages run on Chromium 68 (webOS 5): the script stays ES5 (tools/test/pages.test.js checks it). Runs on Node 8.
'use strict';
const fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..');
const PAGES = [
  ['webos4/src', 'webos4/app/index.html'],
  ['app/src', 'app/index.html'],
  ['manager/src', 'manager/app/index.html'],
  ['picker/app/index.html', 'picker/app/index.html'],
];
// the manager shows the service's own messages (update steps, sync errors): it carries the translations of texts in helper/ too
const EXTRA = { 'manager/src': ['helper'] };
const extraText = src =>
  (EXTRA[src] || [])
    .map(d =>
      fs
        .readdirSync(path.join(root, d))
        .filter(f => /\.js$/.test(f))
        .sort()
        .map(f => fs.readFileSync(path.join(root, d, f), 'utf8'))
        .join('\n')
    )
    .join('\n');
const I18N = path.join(root, 'i18n');

// ---- translations: every i18n/<language>.json except en.json, which lists all the English texts ----
function langs() {
  const out = {};
  for (const f of fs.readdirSync(I18N).sort()) {
    const m = /^([a-z]{2})\.json$/.exec(f);
    if (m && m[1] !== 'en') out[m[1]] = JSON.parse(fs.readFileSync(path.join(I18N, f), 'utf8'));
  }
  return out;
}
const english = () => Object.keys(JSON.parse(fs.readFileSync(path.join(I18N, 'en.json'), 'utf8'))).filter(k => k.charAt(0) !== '_');
// the page's text as it reads (escapes in its string literals resolved), to find which English texts it shows
const plain = text =>
  text
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'");
// a text is used when the page holds all of its fixed parts (a template "Update to %s (dev build)" is built from pieces)
const usedIn = (key, text) =>
  key
    .split(/%[sd]/)
    .filter(f => f.trim().length > 0)
    .every(f => text.indexOf(f) >= 0);
// a translation: a text, or plural forms with at least "other"
const filled = v => (typeof v === 'string' && v !== '') || (!!v && typeof v === 'object' && typeof v.other === 'string' && v.other !== '');
function i18nScript(pageText) {
  const text = plain(pageText),
    all = english(),
    used = all.filter(k => usedIn(k, text)),
    L = langs(),
    out = {};
  for (const c of Object.keys(L)) {
    const done = all.filter(k => filled(L[c][k])).length,
      o = {
        _name: L[c]._name || c,
        _dir: L[c]._dir === 'rtl' ? 'rtl' : 'ltr',
        _pct: all.length ? Math.floor((100 * done) / all.length) : 0,
      };
    for (const k of used) if (filled(L[c][k])) o[k] = L[c][k];
    out[c] = o;
  }
  // English plural forms ("%d photo" / "%d photos"): the only English the pages need from a file
  const en = JSON.parse(fs.readFileSync(path.join(I18N, 'en.json'), 'utf8')),
    ep = {};
  for (const k of used) if (en[k] && typeof en[k] === 'object') ep[k] = en[k];
  if (Object.keys(ep).length) out.en = ep;
  return 'var I18N = ' + JSON.stringify(out) + ';\n' + fs.readFileSync(path.join(I18N, 'runtime.js'), 'utf8').replace(/\n$/, '');
}

const MARK = '/* @i18n */',
  MARK_END = '/* @i18n end */';
function build(src) {
  if (/\.html$/.test(src)) {
    // the picker: rewrite the part between the marks
    const cur = fs.readFileSync(path.join(root, src), 'utf8'),
      a = cur.indexOf(MARK),
      b = cur.indexOf(MARK_END);
    if (a < 0 || b < a) throw new Error(src + ' has no ' + MARK + ' ... ' + MARK_END + ' part');
    const rest = cur.slice(0, a) + cur.slice(b + MARK_END.length);
    return cur.slice(0, a) + MARK + '\n' + i18nScript(rest) + '\n' + cur.slice(b);
  }
  const dir = path.join(root, src);
  const page = fs
    .readFileSync(path.join(dir, 'index.html'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map(line => {
      const m = /^@include (\S+)$/.exec(line);
      if (!m) return line;
      const f = path.join(dir, m[1]);
      if (f.indexOf(dir + path.sep) !== 0 || !fs.existsSync(f)) throw new Error(src + '/index.html includes a missing file: ' + m[1]);
      return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
    })
    .join('\n');
  const parts = page.split(/^@i18n$/m);
  return (parts.length === 2 ? parts[0] + i18nScript(parts[0] + parts[1] + '\n' + extraText(src)) + parts[1] : page) + '\n';
}

if (require.main === module) {
  const check = process.argv.indexOf('--check') >= 0;
  let stale = 0;
  for (const p of PAGES) {
    const out = build(p[0]),
      file = path.join(root, p[1]);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
    if (out === cur) {
      console.log('ok   ' + p[1] + ' matches ' + p[0]);
      continue;
    }
    if (check) {
      stale++;
      console.log('FAIL ' + p[1] + ' does not match ' + p[0] + ' (run: node tools/build-pages.js)');
    } else {
      fs.writeFileSync(file, out);
      console.log('wrote ' + p[1]);
    }
  }
  process.exit(stale ? 1 : 0);
}
module.exports = { build, PAGES, langs, english, usedIn, plain, filled };
