// Translations for the pages the service serves itself (the phone pages for Wallpapers, Live TV and voice, Share log): the same
// i18n/<language>.json files as the TV's screens (copied next to the service by the setup; in a checkout, ../i18n). A phone page is in
// the phone's language (its Accept-Language), else the language chosen in the manager, else English.
//   lang(req, chosen)  -> a language code there is a file for, or 'en'
//   tr(lang, text)     -> the text in that language (whole, or the parts joined by " · " or lines, or a %s / %d template)
//   script(lang, html) -> a <script> with the translations a page's own script uses and t() (i18n/runtime.js), set to that language
// The service's own messages stay English: the TV's screens translate them where they show them.
const fs = require('fs'),
  path = require('path');

const DIRS = [path.join(__dirname, 'i18n'), path.join(__dirname, '..', 'i18n')];
let cache = null;
function load() {
  if (cache) return cache;
  cache = { langs: {}, runtime: '' };
  for (const d of DIRS) {
    let files = [];
    try {
      files = fs.readdirSync(d);
    } catch (_) {
      continue;
    }
    for (const f of files) {
      const m = /^([a-z]{2})\.json$/.exec(f);
      if (!m) continue;
      try {
        cache.langs[m[1]] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      } catch (_) {}
    }
    try {
      cache.runtime = fs.readFileSync(path.join(d, 'runtime.js'), 'utf8');
    } catch (_) {}
    if (Object.keys(cache.langs).length) break;
  }
  return cache;
}
function lang(req, chosen) {
  const L = load().langs,
    acc = String((req && req.headers && req.headers['accept-language']) || '');
  const asked = acc
    .split(',')
    .map(p => {
      const m = /^\s*([a-zA-Z]{2})(?:-[a-zA-Z0-9]+)?\s*(?:;\s*q=([0-9.]+))?/.exec(p);
      return m ? { c: m[1].toLowerCase(), q: m[2] === undefined ? 1 : parseFloat(m[2]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.q - a.q);
  for (const a of asked) if (a.c === 'en' || (L[a.c] && L[a.c]._name && a.c !== 'en')) return a.c;
  return chosen && chosen !== 'en' && L[chosen] ? chosen : 'en';
}

// the plural form of n (Unicode CLDR categories), for translations with forms {"one": ..., "other": ...}; Node 8 has no
// Intl.PluralRules, so the rules of the common languages are written out (as in i18n/runtime.js)
function pluralForm(code, n) {
  const i = Math.floor(Math.abs(n)),
    m10 = i % 10,
    m100 = i % 100,
    few = m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14);
  if (/^(ja|zh|ko|th|vi|id|ms|tr)$/.test(code)) return 'other';
  if (/^(fr|pt)$/.test(code)) return i < 2 ? 'one' : 'other';
  if (/^(ru|uk|be)$/.test(code)) return m10 === 1 && m100 !== 11 ? 'one' : few ? 'few' : 'many';
  if (code === 'pl') return i === 1 ? 'one' : few ? 'few' : 'many';
  if (/^(cs|sk)$/.test(code)) return i === 1 ? 'one' : i >= 2 && i <= 4 ? 'few' : 'other';
  if (code === 'ar')
    return i === 0 ? 'zero' : i === 1 ? 'one' : i === 2 ? 'two' : m100 >= 3 && m100 <= 10 ? 'few' : m100 >= 11 ? 'many' : 'other';
  if (code === 'he') return i === 1 ? 'one' : i === 2 ? 'two' : 'other';
  return n === 1 ? 'one' : 'other';
}
const form = (code, v, n) =>
  typeof v === 'string' ? v : !v ? '' : (n !== undefined && v[pluralForm(code, +String(n).replace(',', '.'))]) || v.other || '';
const templates = {};
function tpl(code) {
  if (templates[code]) return templates[code];
  const T = load().langs[code] || {},
    out = [];
  for (const k of Object.keys(T))
    if (k.charAt(0) !== '_' && /%[sd]/.test(k))
      out.push({
        re: new RegExp(
          '^' +
            k
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replace(/%s/g, '([\\s\\S]+?)')
              .replace(/%d/g, '([0-9][0-9.,]*)') +
            '$'
        ),
        key: k,
        joined: /\n| \u00B7 /.test(k),
      });
  out.sort((a, b) => b.key.length - a.key.length);
  return (templates[code] = out);
}
function tr(code, s) {
  const T = load().langs[code];
  if (!T || s === null || s === undefined || s === '') return s;
  s = String(s);
  if (Object.prototype.hasOwnProperty.call(T, s) && T[s]) return form(code, T[s]);
  const viaTpl = joined => {
    for (const x of tpl(code)) {
      if (x.joined !== joined) continue;
      const m = x.re.exec(s);
      if (m) {
        let j = 1,
          k = 0,
          first = 0;
        x.key.replace(/%[sd]/g, h => {
          k++;
          if (h === '%d' && !first) first = k;
          return h;
        });
        return form(code, T[x.key], first ? m[first] : undefined).replace(/%[sd]/g, () => tr(code, m[j++]));
      }
    }
    return null;
  };
  let r = viaTpl(true);
  if (r !== null) return r;
  if (s.indexOf('\n') >= 0)
    return s
      .split('\n')
      .map(x => tr(code, x))
      .join('\n');
  if (s.indexOf(' · ') >= 0)
    return s
      .split(' · ')
      .map(x => tr(code, x))
      .join(' · ');
  r = viaTpl(false);
  return r !== null ? r : s;
}
// the texts of a page's script that have a translation: every key whose fixed parts all appear in the script
function script(code, js) {
  const T = load().langs[code] || {},
    used = code === 'en' ? {} : { _name: T._name || code, _dir: T._dir === 'rtl' ? 'rtl' : 'ltr' };
  const text = String(js || '').replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  for (const k of Object.keys(T)) {
    if (k.charAt(0) === '_' || !T[k]) continue;
    const parts = k.split(/%[sd]/).filter(f => f.trim().length > 0);
    if (parts.length && parts.every(f => text.indexOf(f) >= 0)) used[k] = T[k];
  }
  // in English only the plural forms ("%d photo" / "%d photos") come from the file
  if (code === 'en') for (const k of Object.keys(used)) if (typeof used[k] !== 'object') delete used[k];
  const table = Object.keys(used).length ? { [code]: used } : {};
  return (
    '<script>var I18N = ' +
    JSON.stringify(table).replace(/</g, '\\u003c') +
    ';\n' +
    load().runtime +
    '\nsetLang(' +
    JSON.stringify(code) +
    ');</script>'
  );
}

// the language Home is shown in, as the launcher says with each request of a card of an add-on: the service cannot read the TV's
// language itself, so while the Language setting follows the TV, add-ons (env.lang()) translate into this one
let screenLang = '';
function screen(code) {
  if (typeof code === 'string' && /^[a-z]{2}$/.test(code)) screenLang = code;
  return screenLang;
}

module.exports = { lang, tr, script, load, screen };
