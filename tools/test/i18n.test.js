// Translations (i18n/ and i18n/runtime.js): the files are valid, the pages carry what they use, and t() finds whole texts, the parts
// of a joined text and templates, and falls back to English.
const fs = require('fs'),
  path = require('path');
const { ok, root, run } = require('./lib');

run(async () => {
  const r = require(path.join(root, 'tools', 'i18n.js')).report();
  ok(!r.problems.length, 'the language files are valid, with matching %s and %d' + (r.problems.length ? ': ' + r.problems.join('; ') : ''));
  ok(r.rows.length >= 4 && r.rows.every(x => x.name), 'every language names itself: ' + r.rows.map(x => x.code + ' ' + x.name).join(', '));
  const B = require(path.join(root, 'tools', 'build-pages.js'));
  const fresh = B.PAGES.every(p => B.fresh(p));
  ok(fresh, 'the pages (and the picker part between its marks) carry the current translations');
  // a checkout on Windows may have CRLF: the translations and the runtime are put into the page from i18n/, and a CR there is a page
  // that differs between Linux and Windows (and a "pages are stale" check that fails on one of them)
  ok(!/\r/.test(B.build('manager/src') + B.build('app/src') + B.build('picker/app/index.html')), 'the built pages carry no CR');

  // the runtime as a page has it, with a small table
  const runtime = fs.readFileSync(path.join(root, 'i18n', 'runtime.js'), 'utf8');
  const make = (locale, table) =>
    new Function(
      'window',
      'navigator',
      'document',
      'I18N',
      runtime +
        '; return { t: t, setLang: setLang, lang: function () { return LANG; }, languages: languages, rtl: rtl, dir: function () { return document.documentElement.dir; } };'
    )({ webOSSystem: { locale: locale } }, { language: 'en' }, { documentElement: {} }, table);
  const T = {
    nl: {
      _name: 'Nederlands',
      _pct: 90,
      'Hidden apps': 'Verborgen apps',
      '%d photos': '%d foto’s',
      'synced %s': 'gesynchroniseerd %s',
      '%d min ago': '%d min geleden',
      'Launcher %s · service %s': 'Launcher %s · service %s',
      'Latest release %s': 'Nieuwste release %s',
      On: 'Aan',
    },
  };
  const a = make('nl-NL', T);
  ok(a.lang() === 'nl' && a.t('Hidden apps') === 'Verborgen apps', 'the TV language is used, and a whole text is found');
  ok(
    a.t('3 photos · synced 5 min ago') === '3 foto’s · gesynchroniseerd 5 min geleden',
    'the parts of a joined text and templates within templates'
  );
  ok(
    a.t('Launcher 1.5 · service 1.6\nLatest release 1.6') === 'Launcher 1.5 · service 1.6\nNieuwste release 1.6',
    'a template with " · " in it and lines'
  );
  ok(a.t('An error from the service') === 'An error from the service' && a.t('') === '', 'a text without a translation stays English');
  ok(a.t('%d photos') === '%d foto’s', 'a template looked up as it is, for pages that fill it in themselves');
  a.setLang('en');
  ok(a.lang() === 'en' && a.t('Hidden apps') === 'Hidden apps', 'the Language setting can choose English');
  a.setLang('xx');
  ok(a.lang() === 'en', 'a language the page has no translations for falls back to English');
  a.setLang('');
  ok(a.lang() === 'nl', 'Automatic follows the TV again');
  const b = make('ja-JP', T);
  ok(
    b.lang() === 'en' &&
      b
        .languages()
        .map(x => x.code + x.pct)
        .join() === 'en100,nl90',
    'a TV language without translations shows English; the Language list has every language with how complete it is'
  );

  // the service's phone pages: the phone's language first, then the one chosen in the manager, then English
  const I = require(path.join(root, 'helper', 'i18n.js'));
  ok(
    I.screen() === '' && I.screen('nl') === 'nl' && I.screen('x1') === 'nl' && I.screen() === 'nl',
    'the language Home is shown in is kept (two letters only), for the add-ons while the Language setting follows the TV'
  );
  const req = al => ({ headers: al === undefined ? {} : { 'accept-language': al } });
  ok(
    I.lang(req('nl-NL,nl;q=0.9,en;q=0.8'), '') === 'nl' &&
      I.lang(req('ja-JP,de;q=0.7'), '') === 'de' &&
      I.lang(req('ja-JP'), 'fr') === 'fr' &&
      I.lang(req(), '') === 'en' &&
      I.lang(req('en-GB,nl;q=0.5'), '') === 'en',
    "a phone page picks the phone's language, then the manager's choice, then English"
  );
  ok(
    I.tr('nl', 'Upload photos') === 'Foto’s uploaden' &&
      I.tr('de', 'Installing launcher 1.5.4') === 'Launcher 1.5.4 wird installiert' &&
      I.tr('en', 'Upload photos') === 'Upload photos',
    'the service translates whole texts and templates'
  );
  const sc = I.script('nl', "t('Wrong code.');fm('Photo %d of %d · sending',1,2)");
  ok(
    /var I18N = \{"nl":/.test(sc) && /Verkeerde code/.test(sc) && /setLang\("nl"\)/.test(sc) && !/Foto’s uploaden/.test(sc),
    "a phone page's script gets only the translations it uses"
  );
  ok(I.script('en', '').indexOf('var I18N = {}') >= 0, 'in English the page carries no translations');

  // longer words (German, Russian): every one-line text of a row or button is cut with "..." instead of running out of it
  const css = f => fs.readFileSync(path.join(root, f), 'utf8');
  const cut = (text, sel) => {
    const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(text);
    return !!m && /text-overflow:\s*ellipsis/.test(m[1]) && /overflow:\s*hidden/.test(m[1]) && /white-space:\s*nowrap/.test(m[1]);
  };
  const L = css('app/index.html'),
    M = css('manager/app/index.html');
  ok(
    cut(L, '.row .lb') && cut(L, '.row .st') && cut(L, '.pill span') && cut(L, '#name') && cut(M, '.row .lb') && cut(M, '.row .st'),
    'menu rows, sub-labels, top buttons and the app name end in "..." when a translation is too long'
  );

  // plural forms follow the language's rules; English has its own forms
  const P = {
    en: { '%d photos': { one: '%d photo', other: '%d photos' } },
    ru: {
      _name: 'Русский',
      '%d photos': { one: '%d фото', few: '%d фотографии', many: '%d фотографий', other: '%d фото' },
      'synced %s': 'синхронизировано %s',
    },
    fr: { _name: 'Français', '%d photos': { one: '%d photo', other: '%d photos' } },
    he: { _name: 'עברית', _dir: 'rtl', Back: 'חזרה' },
  };
  const ru = make('ru-RU', P);
  ok(
    ru.t('1 photos') === '1 фото' &&
      ru.t('3 photos') === '3 фотографии' &&
      ru.t('11 photos') === '11 фотографий' &&
      ru.t('22 photos') === '22 фотографии',
    'Russian plural forms: one, few, many'
  );
  const fr = make('fr-FR', P);
  ok(fr.t('0 photos') === '0 photo' && fr.t('2 photos') === '2 photos', 'French counts 0 and 1 as one');
  const en = make('en-GB', P);
  ok(
    en.t('1 photos') === '1 photo' && en.t('5 photos') === '5 photos' && en.t('Back') === 'Back',
    'English has its own plural forms and otherwise stays as written'
  );
  const he = make('he-IL', P);
  ok(
    he.rtl() && he.dir() === 'rtl' && he.t('Back') === 'חזרה' && !fr.rtl() && fr.dir() === 'ltr',
    'a right-to-left language turns the page right-to-left'
  );
  ok(
    I.tr('nl', '1 photos') === '1 foto' && I.tr('nl', '4 photos') === '4 foto’s' && I.tr('en', '1 photos') === '1 photo',
    'the service picks plural forms too (its own rules: Node 8 has no Intl.PluralRules)'
  );
  // the manager's rows ({label, sub, about}) are translated where the list draws them: their texts must be in en.json, or no language
  // can translate them (the Add-ons screen stayed English in Dutch)
  const { rowTexts } = require(path.join(root, 'tools', 'i18n.js'));
  const sample = rowTexts(
    "rows.push({ label: 'Page of the book', sub: onoff(x) + ' · Home is page 1' });\n" +
      "rows.push({ label: a.enabled ? 'Switch off' : 'Switch on', sub:\n  (s === 'running' ? 'on' : 'off') + (b ? ' · ships with CleanYourTV' : ''),\n  fn: f });\n" +
      "rows.push({ label: name === 'input' ? 'Skip' : 'Close', sub: HR[r || 'ha-first'], about: 'com.webos.app.hdmi' });\n" +
      "rows.push({ label: 'Update to ' + v, sub: lm.model || 'openrouter/auto' });"
  );
  ok(
    ['Page of the book', 'Home is page 1', 'Switch off', 'Switch on', 'on', 'off', 'ships with CleanYourTV', 'Skip', 'Close'].every(
      k => sample.indexOf(k) >= 0
    ) && !['input', 'ha-first', 'com.webos.app.hdmi', 'Update to', 'openrouter/auto'].some(k => sample.indexOf(k) >= 0),
    'the texts of the manager rows are found, not values, keys or pieces of a built text: ' + JSON.stringify(sample)
  );
  const enKeys = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'en.json'), 'utf8'));
  const mgrSrc = B.plain(
    fs
      .readdirSync(path.join(root, 'manager', 'src', 'js'))
      .map(f => fs.readFileSync(path.join(root, 'manager', 'src', 'js', f), 'utf8'))
      .join('\n')
  );
  const absent = rowTexts(mgrSrc).filter(k => !Object.prototype.hasOwnProperty.call(enKeys, k));
  ok(
    absent.length === 0,
    'en.json lists every text of the manager rows (node tools/i18n.js --sync): ' + JSON.stringify(absent.slice(0, 5))
  );
  // a catalog add-on's page that translates through the service's table with its own short name (the phone remote: T('...'))
  const phonePage = fs.readFileSync(path.join(root, 'addons', 'catalog', 'phoneremote', 'page.js'), 'utf8');
  const phoneTexts = (phonePage.match(/\bT\('((?:[^'\\]|\\.)+)'\)/g) || []).map(x => x.slice(3, -2).replace(/\\'/g, "'"));
  const phoneAbsent = phoneTexts.filter(k => !Object.prototype.hasOwnProperty.call(enKeys, k));
  ok(phoneTexts.length > 20 && phoneAbsent.length === 0, "en.json lists the phone remote page's texts: " + JSON.stringify(phoneAbsent));

  // an add-on's own words (name, description, about, tile label) are in the tables too, or the Add-ons screen and the tile stay
  // English in every other language
  const manifests = [];
  for (const d of ['addons/catalog', 'helper/addons-bundled']) {
    const base = path.join(root, d);
    if (!fs.existsSync(base)) continue;
    for (const id of fs.readdirSync(base).sort()) {
      const file = path.join(base, id, 'addon.json');
      if (fs.existsSync(file)) manifests.push([d + '/' + id, JSON.parse(fs.readFileSync(file, 'utf8'))]);
    }
  }
  const addonTexts = B.addonText();
  const missed = [];
  for (const [where, m] of manifests) {
    for (const t of [m.name, m.description, m.about, m.tile && m.tile.label]) {
      if (t && addonTexts.indexOf(String(t)) < 0) missed.push(where + ': ' + String(t).slice(0, 40));
    }
  }
  ok(
    manifests.length > 5 && missed.length === 0,
    'the words of every add-on manifest are collected (node tools/i18n.js --sync): ' + JSON.stringify(missed.slice(0, 5))
  );
  ok(
    addonTexts.every(t => t && typeof t === 'string' && t.trim()) &&
      addonTexts.length === addonTexts.filter((t, i) => addonTexts.indexOf(t) === i).length,
    'and each of them once, never empty: ' + addonTexts.length + ' texts'
  );
  const nlKeys = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'nl.json'), 'utf8'));
  const noEn = addonTexts.filter(t => !Object.prototype.hasOwnProperty.call(enKeys, t));
  const noNl = addonTexts.filter(t => !Object.prototype.hasOwnProperty.call(nlKeys, t));
  ok(noEn.length === 0, 'en.json lists them: ' + JSON.stringify(noEn.slice(0, 3).map(t => t.slice(0, 40))));
  ok(
    noNl.length === 0,
    'and nl.json translates them, so a new add-on without a translation is caught here: ' +
      JSON.stringify(noNl.slice(0, 3).map(t => t.slice(0, 40)))
  );
  // the words the Add-ons screen puts around them
  const banner = ['%s installed', '%s on', '%s off', 'Add-ons updated', 'restart the TV to apply it'];
  ok(
    banner.every(k => Object.prototype.hasOwnProperty.call(enKeys, k)),
    'en.json lists what the Add-ons screen says around them: ' + JSON.stringify(banner.filter(k => !enKeys[k]))
  );
});
