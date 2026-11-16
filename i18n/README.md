# Translations

Every screen of CleanYourTV (the launcher, the manager app, the Inputs list) is written in English and translated where text is
shown. The translations are one file per language in this folder.

| File | What it is |
|---|---|
| `en.json` | Every English text the screens use. The key and the value are the same; it is the list to translate from. |
| `nl.json`, `de.json`, ... | One language: `{"Hidden apps": "Verborgen apps", ...}`. `_name` is the language in its own words, `_dir` is `ltr` or `rtl`. |
| `runtime.js` | The code the pages use to translate (`t()`). |

The guide for translators is [Languages](https://lasharor.github.io/cleanyourtv-WebOS/languages/) in the documentation.
`tools/build-pages.js` puts the translations each page uses into that page, so the TV needs no network for them. The language is the
TV's menu language, or the one chosen in the manager app under **More** > **Language**.

## Adding or improving a language

1. Copy `en.json` to `<code>.json` (the two-letter code, for example `it.json`), set `_name` (`"Italiano"`) and replace each value
   with the translation. Leave out what you do not know: those texts stay English.
2. Keep `%s` (any text) and `%d` (a number) in the translation, as many as the English has.
3. A text with a count can have plural forms instead of one translation: `"%d photos": {"one": "%d foto", "other": "%d foto’s"}`.
   The forms are the Unicode CLDR categories `zero`, `one`, `two`, `few`, `many` and `other` (Russian uses `one`, `few`, `many`);
   the form follows the first number in the text. `other` is required. `en.json` has the English forms the same way.
4. For a right-to-left language (Arabic, Hebrew) set `"_dir": "rtl"`: the home screen, its menus, the Inputs list and this app
   are then mirrored, and Left and Right follow the mirrored layout. Live TV keeps its left-to-right layout for now.
5. Run `node tools/build-pages.js`, then `node tools/i18n.js` to see how complete the language is and whether a file has an error.
6. Open a pull request. Texts that are too long for a row or a button end in "..." on the TV; a shorter wording reads better.

## Adding a text to a page

Write it in English and pass it through `t('...')` (`tr()` in the manager). Then run `node tools/i18n.js --sync` to add it to
`en.json`, add the translations you know to the language files and run `node tools/build-pages.js`.

## Adding an add-on

The `name`, `description`, `about` and tile label in an add-on's `addon.json` are written in English and collected from the
manifest by `node tools/i18n.js --sync`, so they need no `t('...')`: translate them in the language files like any other text.
`tools/test/i18n.test.js` fails when one of them is missing from `en.json` or `nl.json`.
