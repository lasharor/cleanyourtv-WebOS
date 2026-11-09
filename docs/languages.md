# Languages

CleanYourTV's screens are in English, Dutch, German, French, Spanish, Catalan, Russian, Turkish, Arabic, Polish, Italian, Brazilian Portuguese, Vietnamese, Hungarian and Swedish: the launcher, its menus and Live TV, the manager app, the
Inputs list, and the pages a phone opens from a QR code (Wallpapers, Live TV setup, voice setup, Share log).

## Choosing the language

| Where | Language |
|---|---|
| The TV's screens | The TV's menu language. In the manager app, **More** > **Language** can choose another one: **Automatic** follows the TV again. The list shows how much of each language is translated; what is missing stays English. Dates and the clock follow the same choice. |
| A phone page | The phone's own language, then the one chosen in the manager, then English. |
| The Share log report | Always English, because it is read by the people who look into a bug report. |

## Adding or improving a language

The Catalan translation is complete but has not yet been reviewed by a native speaker; corrections are very welcome. The Vietnamese translation (by @hothach1509-eng, issue 111) is about 95% done and has not been reviewed by a second native speaker. The Hungarian translation (by @Davhentel, pull request 130) is about 96% done, was tested on a real TV by its author, and has not been reviewed by a second native speaker. The Swedish translation (by @Steefzar) is complete, was drafted with an AI assistant, had its uncertain terms reviewed by its author, a native speaker, and has not been tested on a real TV yet. The Russian,
Turkish and Arabic translations were machine-made and have not been reviewed by a native speaker yet; corrections are also welcome.

Translations are plain text files in the repository, one per language, so no programming is needed. Anyone can add a language or
fix a translation with a pull request; the next daily release then brings it to every TV.

1. Open [`i18n/en.json`](https://github.com/lasharor/cleanyourtv-WebOS/blob/dev/i18n/en.json). It lists every English text the
   screens use, as `"English text": "English text"`.
2. Copy it to `i18n/<code>.json`, where `<code>` is the two-letter code of the language (`it` for Italian, `pl` for Polish). Set
   `_name` to the language's name in that language (`"Italiano"`) and `_dir` to `ltr`, or `rtl` for a right-to-left language.
3. Replace each value with the translation. Leave out a line you are not sure about: that text stays English. Translating the
   texts of the launcher and the menus first gives the most visible result.
4. Keep the placeholders: `%s` is filled in with a text (a name, a version) and `%d` with a number, in the same order as in English.
5. A text with a number can have plural forms, as `"%d photos": {"one": "%d foto", "other": "%d foto’s"}`. The forms are the
   [Unicode CLDR plural categories](https://cldr.unicode.org/index/cldr-spec/plural-rules) (`zero`, `one`, `two`, `few`, `many`,
   `other`); `other` is required, and the form follows the first number in the text.
6. Keep translations short where you can: the TV is read from a few metres away, and a text too long for its row or button ends
   in "...".
7. Open a pull request against the `dev` branch. If you cannot use git, open a
   [New language issue](https://github.com/lasharor/cleanyourtv-WebOS/issues/new?template=new_language.yml) and attach the file.

The checks of the pull request run `node tools/i18n.js`: it shows how complete each language is, and it fails only when a file is
not valid JSON or a placeholder does not match the English text. To try a language on a TV before it is released, install the
[dev build](managing.md#dev-builds) once the pull request is merged.

## Right-to-left languages

With `"_dir": "rtl"` (Arabic, Hebrew) the home screen, its menus, the Inputs list and the manager app are mirrored, and Left and
Right on the remote follow the mirrored layout. Live TV keeps its left-to-right layout for now. Arabic is the first right-to-left language.

## For developers

New texts are written in English and passed through `t('...')` in the launcher and the picker, `tr()` in the manager, and
`i18n.tr()` in the service's phone pages. `node tools/i18n.js --sync` adds texts from `t('...')` calls to `en.json`, and
`node tools/build-pages.js` puts each page's translations into it. [`i18n/README.md`](https://github.com/lasharor/cleanyourtv-WebOS/blob/dev/i18n/README.md)
has the details.
