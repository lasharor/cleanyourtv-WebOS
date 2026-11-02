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
- `minService` (optional): the oldest service the card works with, for example `1.6.15`. A service that is older shows the card as "needs service 1.6.15" and does not install it.
- `size`: `small`, `medium` (default) or `large`. An option with the key `size` and the values `small`, `medium` or `large` lets the person choose.
- `options`: at most 10, typed on the phone page (**Cards** > **Set up from your phone**). `kind` is `text`, `long` (several lines),
  `choice` (with `choices: [[value, label], ...]`) or `place` (a place searched by name, like the weather card's; the key must be `place`, and
  the card gets `{{opt.place}}`, `{{opt.lat}}` and `{{opt.lon}}`). `default` is used until something is filled in; a choice without a default starts at its first choice.
- `template`: at most 1500 characters (a card has a `template` or a `page`, see below). What the Text card knows: `{{greeting}}`, `{{time}}`, `{{date}}`, `{{weekday}}`,
  `{{weather.temp}}` and `{{weather.text}}` (with a weather card on Home); `**bold**`, `*italic*` and a line starting with `#` for a heading.
  And for downloaded cards: `{{opt.<key>}}` (what was filled in), `{{year}}`, `{{year.percent}}`, `{{year.left}}`, and the filters
  `{{opt.date|days}}` (days until a date, `YYYY-MM-DD`), `|ago` (days since), `|upper` and `|lower`.
  A line starting with `###` is a big light line (a time), one starting with `>` a small dim one, and a line in Arabic runs from the right.
- `preview.jpg` (or `.png`, `.webp`): 800 x 450, at most 600 KB. It is read from GitHub for the manager and never installed.
  `node tools/theme-preview.mjs` renders the launcher in headless Chrome; set a card in the slot and crop the corner.

An installed card is kept in `cardpacks/<id>/` on the TV. Removing it puts the theme's own card back in the places that used it.
The service checks every field (`helper/cardcatalog.js`) and installs nothing whose files do not match the index.

## A card with its own page

When a template is not enough, a card can bring its own code: instead of `template`, `card.json` has `"page": "card.html"`, and the folder holds
the page and whatever it loads (`.js`, `.css`, `.svg`, `.woff2`, `.png`, `.jpg`, at most 8 files of 64 KB each). The launcher knows nothing of what
the card does. It shows the page in a **closed frame**: the service serves it from `/card/<id>/` with a content security policy that allows no network
(`default-src 'none'`, scripts and styles from the card itself, pictures only as `data:`), the frame has `sandbox="allow-scripts"` so it cannot
reach the launcher or the service, and it never takes the remote's keys. Prayer times and Adhkar are two such cards.

The launcher tells the page what it needs with a message, when the page has loaded and whenever it changes:

```js
window.addEventListener('message', function (e) {
  var m = e.data && e.data.cytvCard;       // {opt, lang, clock, size, align, dir, ink, font, fs}
  if (m && typeof m === 'object') { /* draw with m.opt (the options), m.lang and m.clock for toLocaleTimeString, m.ink for the colour... */ }
});
parent.postMessage({ cytvCard: 'ready' }, '*');   // asks for the message above
```

`opt` holds the options (a `place` option gives `opt.place`, `opt.lat` and `opt.lon`), `lang` is the launcher's language, `clock` the options of
the launcher's clock format for `toLocaleTimeString(lang, clock)`, `size` is small, medium or large, `align` and `dir` how the text runs, `ink`, `font`
and `fs` the colour, typeface and size scale of the text of the theme. The page keeps its own time (`setInterval`), draws on a transparent
background and fills its frame. Write ES5: it runs on Chromium 68 (webOS 5) too.
