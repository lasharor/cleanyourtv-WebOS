/* ---- Customise > a card's settings: the options an add-on's card declares (a city, a choice), set on the TV for every place that shows it ---- */
var CSQ_TYPE = '';
/* the cards of this type on Home */
function csCards(type) {
  var out = [],
    c = cfg.cards || {},
    id;
  for (id in c) if (c[id] && c[id].type === type) out.push(c[id]);
  return out;
}
/* the settings of a place with the card: the first one with a city (they share what this panel sets) */
function csCard(type) {
  var l = csCards(type),
    i;
  for (i = 0; i < l.length; i++) if (l[i].place) return l[i];
  return l[0] || {};
}
function csPack(type) {
  return CARD_PACKS[String(type).slice(2)] || null;
}
function csOption(pack, kind) {
  var l = (pack && pack.options) || [],
    i;
  for (i = 0; i < l.length; i++) if (l[i].kind === kind) return l[i];
  return null;
}
/* the rows of Customise: one per card pack that has a settings panel */
function csRows() {
  var out = [];
  Object.keys(CARD_PACKS).forEach(function (id) {
    var pack = CARD_PACKS[id],
      po;
    if (!pack || !pack.settings) return;
    po = csOption(pack, 'place');
    out.push({
      label: t(pack.settings.title),
      sub: po ? csCard('x-' + id)[po.key] || t('Not set') : '',
      stay: true,
      fn: function () {
        csSettings('x-' + id);
      },
    });
  });
  return out;
}
function csSettings(type) {
  var pack = csPack(type);
  if (!pack || !pack.settings) return;
  openBuilt(t(pack.settings.title), function () {
    var c = csCard(type),
      rows = [],
      skipped = false;
    if (!csCards(type).length) rows.push({ note: t('This card is not on Home yet. Choose it for a place in Cards.') });
    (pack.options || []).forEach(function (o) {
      var v = c[o.key] !== undefined && c[o.key] !== null ? c[o.key] : o.default;
      if (o.kind === 'place') {
        rows.push({ label: t(o.label), sub: v || t('Not set'), stay: true, fn: function () { csSearch(type); } });
      } else if (o.kind === 'choice' && o.choices && o.choices.length) {
        var ch = o.choices,
          i = 0,
          n;
        for (n = 0; n < ch.length; n++) if (ch[n][0] === v) i = n;
        rows.push({
          label: t(o.label),
          sub: ch[i][1],
          stay: true,
          fn: function () {
            var set = {};
            set[o.key] = ch[(i + 1) % ch.length][0];
            csSet(type, set);
          },
        });
      } else skipped = true;
    });
    if (skipped)
      rows.push({
        label: t('More on your phone'),
        sub: t('Cards > Set up from your phone'),
        fn: function () {
          launch('com.cleanyourtv.manager', { open: 'cardspair' });
        },
      });
    return rows;
  });
}
/* the options of the card changed in the service for every place that has it; Home is drawn again at once and the panel shows the new values */
function csSet(type, set) {
  api('/api/cards/options', { type: type, set: set }).then(
    function (r) {
      if (r && r.error) return toast(t(r.error), true);
      cfg.cards = (r && r.cards) || cfg.cards;
      drawCards();
      refreshMenu();
    },
    function () {
      toast(t('The service did not answer.'), true);
    }
  );
}
/* the city: an input over the menu, typed with the TV's keyboard; OK searches, Back leaves the field */
function csSearch(type) {
  var el = $('csq'),
    po = csOption(csPack(type), 'place');
  if (!el) return;
  CSQ_TYPE = type;
  el.value = (po && csCard(type)[po.key]) || '';
  el.style.display = 'block';
  el.focus();
}
function csSearchEnd() {
  var el = $('csq');
  if (!el) return;
  el.value = '';
  el.style.display = 'none';
  el.blur();
}
/* OK in the field: the service's city search, then the cities it found as a menu; picking one saves it */
function csFind(type, q) {
  var v = String(q || '').replace(/^\s+|\s+$/g, '');
  if (v.length < 2) return toast(t('Type at least two letters.'), true);
  api('/api/cards/places', { type: type, q: v }).then(
    function (r) {
      var list = (r && r.places) || [];
      csSearchEnd();
      if (!list.length) return toast(t('No city found.'), true);
      openBuilt(t('City'), function () {
        return list.map(function (p) {
          return {
            label: p.name,
            sub: p.area || '',
            fn: function () {
              csSet(type, { place: p.name, lat: p.lat, lon: p.lon });
              backMenu();
            },
          };
        });
      });
    },
    function () {
      csSearchEnd();
      toast(t('City search is not available now.'), true);
    }
  );
}
