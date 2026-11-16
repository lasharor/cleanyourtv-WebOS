// The translations in i18n/: how complete each language is, and what is wrong in a file. tools/check.sh runs it.
//   node tools/i18n.js            a table per language; exits with 1 only when a file is broken
//   node tools/i18n.js --missing  also lists the English texts a language does not have yet
//   node tools/i18n.js --sync     adds every text the pages use but en.json does not list (run after adding a string to a page)
// A file is broken when it is not JSON, when a translation is neither a text nor plural forms ({"one": ..., "other": ...}), or
// when its %s / %d do not match the English text.
// Missing texts are fine: the page shows English for them. A text in en.json that no page uses is reported, not an error.
// Runs on Node 8.
'use strict';
const fs = require('fs'),
  path = require('path');
const B = require('./build-pages');
const root = path.join(__dirname, '..'),
  dir = path.join(root, 'i18n');

const holes = s => (String(s).match(/%[sd]/g) || []).join('');
const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
function pageText() {
  // what the pages show: their sources as built, without the translations themselves
  return B.plain(
    B.PAGES.map(p => {
      const f = path.join(root, p[1]);
      const s = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      return s.replace(/var I18N = .*;\n/, '');
    })
      .concat(
        // the service's phone pages and messages
        fs
          .readdirSync(path.join(root, 'helper'))
          .filter(f => /\.js$/.test(f))
          .map(f => fs.readFileSync(path.join(root, 'helper', f), 'utf8'))
          // and the bundled add-ons' services (the App icons phone page)
          .concat(
            fs
              .readdirSync(path.join(root, 'helper', 'addons-bundled'))
              .filter(d => fs.existsSync(path.join(root, 'helper', 'addons-bundled', d, 'service.js')))
              .map(d => fs.readFileSync(path.join(root, 'helper', 'addons-bundled', d, 'service.js'), 'utf8'))
          )
          // and a catalog add-on's service, when it translates through the service's table (the phone remote)
          .concat(
            fs
              .readdirSync(path.join(root, 'addons', 'catalog'))
              .filter(d => fs.existsSync(path.join(root, 'addons', 'catalog', d, 'service.js')))
              .map(d => fs.readFileSync(path.join(root, 'addons', 'catalog', d, 'service.js'), 'utf8'))
              .filter(s => s.indexOf('i18n.tr(') >= 0)
          )
          // and what the add-ons' manifests say: the manager and the launcher show those words (tools/build-pages.js, addonText)
          .concat(B.addonText())
      )
      .join('\n')
  );
}
function report() {
  const problems = [],
    rows = [];
  let en = {};
  try {
    en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
  } catch (e) {
    problems.push('en.json: ' + e.message);
  }
  const keys = Object.keys(en).filter(k => k.charAt(0) !== '_');
  const text = pageText();
  const unused = keys.filter(k => !B.usedIn(k, text));
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^([a-z]{2})\.json$/.exec(f);
    if (!m || m[1] === 'en') continue;
    let L;
    try {
      L = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      problems.push(f + ': not valid JSON: ' + e.message);
      continue;
    }
    if (typeof L._name !== 'string' || !L._name) problems.push(f + ': "_name" (the language in its own words) is missing');
    if (L._dir !== undefined && L._dir !== 'ltr' && L._dir !== 'rtl') problems.push(f + ': "_dir" must be "ltr" or "rtl"');
    let done = 0;
    const missing = [],
      stray = [];
    for (const k of Object.keys(L)) {
      if (k.charAt(0) === '_') continue;
      const forms = typeof L[k] === 'string' ? { other: L[k] } : L[k];
      if (!forms || typeof forms !== 'object' || typeof forms.other !== 'string')
        problems.push(f + ': the translation of "' + k + '" is neither a text nor plural forms with "other"');
      else
        for (const fm of Object.keys(forms)) {
          if (FORMS.indexOf(fm) < 0)
            problems.push(f + ': "' + k + '" has an unknown plural form "' + fm + '" (zero, one, two, few, many, other)');
          else if (forms[fm] && holes(forms[fm]).split('').sort().join('') !== holes(k).split('').sort().join(''))
            problems.push(f + ': "' + k + '" has ' + (holes(k) || 'no %s/%d') + ' but the translation has ' + (holes(forms[fm]) || 'none'));
        }
      if (!Object.prototype.hasOwnProperty.call(en, k)) stray.push(k);
    }
    for (const k of keys) {
      if (B.filled(L[k])) done++;
      else missing.push(k);
    }
    rows.push({ code: m[1], name: L._name, done, missing, stray });
  }
  return { keys, unused, rows, problems, text };
}

// The manager's rows: { label: '...', sub: '...', about: '...' } are translated where the list draws them (manager/src/js/list.js), so
// their texts are not inside tr('...'). The plain strings of such a value count (also both sides of a ? :, up to the next property or
// the end of the object), split at " · " as t() splits them. Left out: a piece that starts or ends with a space (part of a text built in
// code), a value that is compared (=== 'input') or used as a key ([...], || fallback), and names such as com.webos.app.hdmi.
function rowTexts(src) {
  const out = [],
    rowValue = /\b(?:label|sub|about)\s*:\s*([\s\S]*?)(?=,\s*[\w$]+\s*:(?!:)|\s*\})/g,
    lit = /'((?:[^'\\\n]|\\.)*)'/g;
  let m, l;
  while ((m = rowValue.exec(src))) {
    const value = m[1];
    while ((l = lit.exec(value))) {
      if (!l[1] || /(===?|!==?|\[|\|\|)\s*$/.test(value.slice(0, l.index)) || /^\s*(===?|!==?|\])/.test(value.slice(l.index + l[0].length)))
        continue;
      for (const piece of l[1].split(' \u00B7 '))
        if (piece === piece.trim() && /[A-Za-z]{2}/.test(piece) && !/[(/]$|^[\w-]+\.[\w.]+$/.test(piece) && out.indexOf(piece) < 0)
          out.push(piece);
    }
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.indexOf('--sync') >= 0) {
    // the texts the pages translate: t('...') and tr('...') calls with a plain string
    const enFile = path.join(dir, 'en.json'),
      en = JSON.parse(fs.readFileSync(enFile, 'utf8')),
      found = {};
    // the pages' scripts and the services that translate through the service's table (i18n.tr(lang, '...'): the catalog add-ons' services)
    let extra = '';
    for (const d of fs.readdirSync(path.join(root, 'addons', 'catalog'))) {
      const js = path.join(root, 'addons', 'catalog', d, 'src', 'js');
      if (fs.existsSync(js))
        extra +=
          '\n' +
          fs
            .readdirSync(js)
            .map(f => fs.readFileSync(path.join(js, f), 'utf8'))
            .join('\n');
      // its service and the other scripts beside it that translate through the service's table (the phone remote's page.js:
      // const T = s => esc(i18n.tr(lang, s)), so its texts are T('...'))
      for (const f of fs.readdirSync(path.join(root, 'addons', 'catalog', d)).filter(n => /\.js$/.test(n))) {
        const s = fs.readFileSync(path.join(root, 'addons', 'catalog', d, f), 'utf8');
        if (s.indexOf('i18n.tr(') >= 0) extra += '\n' + s.replace(/\bT\('/g, "t('");
      }
    }
    const src = B.plain(
      ['app/src/js', 'manager/src/js', 'helper/addons-bundled/iptv/src/js']
        .map(d =>
          fs
            .readdirSync(path.join(root, d))
            .map(f => fs.readFileSync(path.join(root, d, f), 'utf8'))
            .join('\n')
        )
        .join('\n') +
        fs.readFileSync(path.join(root, 'picker/app/index.html'), 'utf8') +
        extra
    );
    const re = /\btr?\('((?:[^'\\]|\\.)+)'\)/g,
      reI18n = /\bi18n\.tr\([^,]+,\s*'((?:[^'\\]|\\.)+)'\)/g;
    let m;
    while ((m = re.exec(src))) found[m[1]] = 1;
    while ((m = reI18n.exec(src))) found[m[1]] = 1;
    for (const k of B.addonText()) found[k] = 1;
    for (const k of rowTexts(
      B.plain(
        fs
          .readdirSync(path.join(root, 'manager/src/js'))
          .map(f => fs.readFileSync(path.join(root, 'manager/src/js', f), 'utf8'))
          .join('\n')
      )
    ))
      found[k] = 1;
    let added = 0;
    for (const k of Object.keys(found)) if (!Object.prototype.hasOwnProperty.call(en, k)) (en[k] = k), added++;
    fs.writeFileSync(enFile, JSON.stringify(en, null, 1) + '\n');
    console.log('en.json: ' + added + ' text(s) added');
    process.exit(0);
  }
  const r = report();
  console.log('language  translated            missing  not in en.json');
  for (const x of r.rows) {
    const pct = r.keys.length ? Math.floor((100 * x.done) / r.keys.length) : 0;
    console.log(
      ('  ' + x.code + ' ' + x.name).slice(0, 18).padEnd(18) +
        (x.done + '/' + r.keys.length + ' (' + pct + '%)').padEnd(22) +
        String(x.missing.length).padEnd(9) +
        x.stray.length
    );
    if (args.indexOf('--missing') >= 0) x.missing.forEach(k => console.log('      missing: ' + k));
  }
  if (r.unused.length)
    console.log(
      '  ' +
        r.unused.length +
        ' text(s) in en.json no page uses: ' +
        r.unused
          .slice(0, 5)
          .map(k => JSON.stringify(k))
          .join(', ') +
        (r.unused.length > 5 ? ', ...' : '')
    );
  r.problems.forEach(p => console.log('FAIL ' + p));
  process.exit(r.problems.length ? 1 : 0);
}
module.exports = { report, rowTexts };
