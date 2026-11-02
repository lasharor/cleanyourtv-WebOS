# Making a card

A downloadable card is a folder in `cards/catalog/<id>/` with a `card.json` and a `preview.jpg`. It has **no script and no CSS**: the
launcher draws it from its template, like the Text card, so a card cannot run anything and is light on the TV's weak graphics chip.
`node tools/card-index.js` lists it in `cards/index.json` (a hash for every file; a test fails when the index is old), and the manager's
**Cards** > **Get more cards** reads that from GitHub, as the themes and the add-ons do.

```json
{
  "id": "countdown",
  "name": "Countdown",
  "version": "1.0.0",
  "description": "The days left until a date you choose.",
  "about": "A longer text for the manager, next to the picture.",
  "size": "medium",
  "options": [
    { "key": "title", "kind": "text", "label": "What are you counting down to?", "default": "Holiday" },
    { "key": "date", "kind": "text", "label": "Date (YYYY-MM-DD)", "default": "2026-12-24" }
  ],
  "template": "# {{opt.title}}\n**{{opt.date|days}}** days to go"
}
```

- `id`: lower-case letters, digits and hyphens, 2 to 28, the folder name. The card type is `x-<id>`.
- `size`: `small`, `medium` (default) or `large`. An option with the key `size` and the values `small`, `medium` or `large` lets the person choose.
- `options`: at most 10, typed on the phone page (**Cards** > **Set up from your phone**). `kind` is `text`, `long` (several lines),
  `choice` (with `choices: [[value, label], ...]`) or `place` (a place searched by name, like the weather card's; the key must be `place`, and
  the card gets `{{opt.place}}`, `{{opt.lat}}` and `{{opt.lon}}`). `default` is used until something is filled in; a choice without a default starts at its first choice.
- `template`: at most 1500 characters. What the Text card knows: `{{greeting}}`, `{{time}}`, `{{date}}`, `{{weekday}}`,
  `{{weather.temp}}` and `{{weather.text}}` (with a weather card on Home); `**bold**`, `*italic*` and a line starting with `#` for a heading.
  And for downloaded cards: `{{opt.<key>}}` (what was filled in), `{{year}}`, `{{year.percent}}`, `{{year.left}}`, and the filters
  `{{opt.date|days}}` (days until a date, `YYYY-MM-DD`), `|ago` (days since), `|upper` and `|lower`.
  Also `{{hijri}}` (today in the Islamic calendar), `{{adhkar}}` (one short remembrance in Arabic, a new one every `opt.secs` seconds, 30 by
  default) and, for a card with a `place`, `{{prayer.name}}`, `{{prayer.time}}`, `{{prayer.left}}` of the next prayer and `{{prayer.fajr}}`,
  `{{prayer.sunrise}}`, `{{prayer.dhuhr}}`, `{{prayer.asr}}`, `{{prayer.maghrib}}`, `{{prayer.isha}}` with `{{prayer.name.fajr}}` and so on for
  their names. They are worked out on the TV (`app/src/js/prayer.js`; the options `method`: `ummalqura`, `mwl`, `isna`, `egypt`, `karachi`,
  and `asr`: `standard` or `hanafi`), so they need no network. A line starting with `###` is a big light line (a time), one starting with `>`
  a small dim one, and a line in Arabic runs from the right.
- `preview.jpg` (or `.png`, `.webp`): 800 x 450, at most 600 KB. It is read from GitHub for the manager and never installed.
  `node tools/theme-preview.mjs` renders the launcher in headless Chrome; set a card in the slot and crop the corner.

An installed card is kept in `cardpacks/<id>/` on the TV. Removing it puts the theme's own card back in the places that used it.
The service checks every field (`helper/cardcatalog.js`) and installs nothing whose files do not match the index.
