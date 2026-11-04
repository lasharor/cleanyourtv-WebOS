/* ---------- Customise > Home Assistant: the cards in the theme's places, chosen with the remote ----------
   For each place (above the dock, the right column, ...) the kind of card and what it shows: one or more entities, a camera, and
   where the launcher has the Home Assistant weather card, a weather entity and an outside temperature sensor. The entities come from Home Assistant through the service
   (POST /api/cards/ha/entities); the choice is saved with the launcher's settings (cfg.cards, the same as the phone page writes). */
var HAM_PLACES = {
  greeting: 'Above the clock',
  'under-clock': 'Under the clock',
  'clock-side': 'Beside the clock',
  side: 'Right column',
  row: 'Above the dock',
};
/* [type, name, what it is]: the texts are the service's (helper/cards.js), so they are in the translations; a picture of each is at
   /api/cards/preview/<type> */
var HAM_KINDS = [
  ['none', 'Empty', ''],
  [
    'ha-weather',
    'Home Assistant weather',
    'The weather from a Home Assistant weather entity, with the temperature outside and the forecast.',
  ],
  ['ha-entity', 'Home Assistant entity', 'One Home Assistant entity with an icon and its state. OK switches a light, a switch or a scene.'],
  ['ha-entities', 'Home Assistant entities', 'Several Home Assistant entities in a list under a title, each with its state.'],
  ['ha-camera', 'Home Assistant camera', 'A Home Assistant camera: a new picture every 10, 30 or 60 seconds.'],
  [
    'greeting',
    'Greeting',
    'Good morning, good afternoon or good evening by the time of day, with a name and a second line: the date or the weather.',
  ],
];
/* the kinds of entity to choose from for an entity card, in this order */
var HAM_DOMAINS = [
  ['light', 'Lights'],
  ['switch', 'Switches'],
  ['sensor', 'Sensors'],
  ['binary_sensor', 'Binary sensors'],
  ['climate', 'Climate'],
  ['fan', 'Fans'],
  ['cover', 'Covers'],
  ['media_player', 'Media players'],
  ['scene', 'Scenes'],
  ['script', 'Scripts'],
  ['automation', 'Automations'],
  ['input_boolean', 'Helpers'],
];
var hamReady = null; /* Home Assistant set up on the TV? null until asked */
var hamNames = {}; /* entity id -> its name, from the lists already loaded */
function hamPlace(sl) {
  return HAM_PLACES[sl.id] ? t(HAM_PLACES[sl.id]) : sl.id;
}
function hamKind(type) {
  for (var i = 0; i < HAM_KINDS.length; i++) if (HAM_KINDS[i][0] === type) return t(HAM_KINDS[i][1]);
  var pk = /^x-(.+)$/.exec(type);
  if (pk && CARD_PACKS[pk[1]]) return CARD_PACKS[pk[1]].name; /* a downloaded card */
  return type;
}
function hamName(id) {
  return hamNames[id] || (HA.by[id] && HA.by[id].name) || id;
}
/* the card a place shows now: the chosen one, or the theme's own, or none */
function hamCard(sl) {
  var c = (cfg.cards || {})[sl.id];
  if (c && c.type) return c;
  return { type: sl.card || 'none' };
}
function hamSave(sl, c) {
  var all = {},
    k;
  for (k in cfg.cards || {}) all[k] = cfg.cards[k];
  all[sl.id] = c;
  cfg.cards = all;
  saveCfg();
}
/* a copy of the place's card to change (so the menu keeps showing the saved one until it is saved) */
function hamCopy(sl) {
  var c = hamCard(sl),
    o = {},
    k;
  for (k in c) o[k] = c[k];
  return o;
}
/* what a card shows, in a few words, for the row of its place */
function hamSummary(c) {
  if (c.type === 'ha-weather' || c.type === 'ha-entity' || c.type === 'ha-camera')
    return hamKind(c.type) + (c.entity ? ' · ' + hamName(c.entity) : '');
  if (c.type === 'ha-entities') {
    var n = String(c.entities || '')
      .split(/[\s,]+/)
      .filter(function (x) {
        return x;
      }).length;
    return hamKind(c.type) + ' · ' + n;
  }
  return hamKind(c.type);
}
/* Home Assistant's entities of some domains (all with none), then a menu to choose one; extra rows come first */
function hamPick(title, domains, keep, extra, cb) {
  toast(t('Asking Home Assistant...'));
  api('/api/cards/ha/entities', { domains: domains })
    .then(function (r) {
      $('toast').classList.remove('on');
      hamReady = r.ha !== false;
      if (r.error) return toast(t(r.error), true);
      var list = (r.entities || []).filter(function (e) {
        hamNames[e.id] = e.name;
        return !keep || keep(e);
      });
      if (!list.length && !(extra || []).length) return toast(t('Home Assistant has no entities of this kind.'), true);
      openMenu(
        title,
        (extra || []).concat(list).map(function (e) {
          return {
            label: e.name !== undefined ? e.name : e.label,
            sub: e.id ? e.id + (e.unit ? ' · ' + e.unit : '') : '',
            stay: true,
            fn: function () {
              cb(e.id || '');
            },
          };
        })
      );
    })
    .catch(function () {
      toast(t('The service did not answer.'), true);
    });
}
/* first the kind of entity, then the entity */
function hamPickAny(title, cb) {
  openMenu(
    title,
    HAM_DOMAINS.map(function (d) {
      return {
        label: t(d[1]),
        stay: true,
        fn: function () {
          hamPick(t(d[1]), [d[0]], null, null, function (id) {
            cb(id);
            backMenu();
            backMenu();
          });
        },
      };
    })
  );
}
/* Customise > Home Assistant: the places of the theme with what each shows */
function haMenu() {
  /* asked each time the menu opens: the link may have been set up in the manager app since */
  api('/api/cards/status', {}).then(
    function (s) {
      hamReady = !!s.ha;
      refreshMenu();
    },
    function () {}
  );
  openBuilt('Home Assistant', function () {
    /* the link with Home Assistant (address and token): set up from a phone, through the manager app's Home Assistant screen */
    var items = [
      {
        label: t('Connection'),
        sub: hamReady === null ? '\u2026' : hamReady ? t('Set up') : t('Not set up'),
        fn: function () {
          launch('com.cleanyourtv.manager', { open: 'ha' });
        },
      },
      { sep: true },
    ];
    (TH.slots || []).forEach(function (sl) {
      items.push({
        label: hamPlace(sl),
        sub: hamSummary(hamCard(sl)),
        stay: true,
        fn: function () {
          hamPlaceMenu(sl);
        },
      });
    });
    if (!(TH.slots || []).length)
      items.push({ note: t('This theme has no places for cards. Choose a theme with cards (Lock Screen) in Customise > Theme.') });
    if (hamReady === false)
      items.push(
        { sep: true },
        { note: t('Choose Connection to link Home Assistant: a code on the TV, the address and a token on your phone.') }
      );
    return items;
  });
}
/* one place: the kind of card, then what it shows */
function hamPlaceMenu(sl) {
  openBuilt(hamPlace(sl), function () {
    var c = hamCard(sl),
      items = [
        {
          label: t('Card'),
          sub: hamKind(c.type),
          stay: true,
          fn: function () {
            hamKindMenu(sl);
          },
        },
      ];
    if (c.type === 'ha-weather') {
      var show = c.show === 'hourly' ? t('The next hours') : c.show === 'none' ? t('None') : t('The next days');
      items.push(
        {
          label: t('Weather entity'),
          sub: c.entity ? hamName(c.entity) : t('Choose...'),
          stay: true,
          fn: function () {
            hamPick(t('Weather entity'), ['weather'], null, null, function (id) {
              var o = hamCopy(sl);
              o.entity = id;
              hamSave(sl, o);
              backMenu();
            });
          },
        },
        {
          label: t('Outside temperature'),
          sub: c.temp ? hamName(c.temp) : t('From the weather entity'),
          stay: true,
          fn: function () {
            hamPick(
              t('Outside temperature'),
              ['sensor'],
              function (e) {
                return /°\s?[CF]$/.test(e.unit);
              },
              [{ label: t('From the weather entity'), id: '' }],
              function (id) {
                var o = hamCopy(sl);
                if (id) o.temp = id;
                else delete o.temp;
                hamSave(sl, o);
                backMenu();
              }
            );
          },
        },
        {
          label: t('Forecast'),
          sub: show,
          stay: true,
          fn: function () {
            var o = hamCopy(sl);
            o.show = !o.show ? 'hourly' : o.show === 'hourly' ? 'none' : '';
            if (!o.show) delete o.show;
            hamSave(sl, o);
          },
        }
      );
    }
    if (c.type === 'ha-entity')
      items.push({
        label: t('Entity'),
        sub: c.entity ? hamName(c.entity) : t('Choose...'),
        stay: true,
        fn: function () {
          hamPickAny(t('Entity'), function (id) {
            var o = hamCopy(sl);
            o.entity = id;
            hamSave(sl, o);
          });
        },
      });
    if (c.type === 'ha-entities') {
      var ids = String(c.entities || '')
        .split(/[\s,]+/)
        .filter(function (x) {
          return x;
        });
      ids.forEach(function (id) {
        items.push({
          label: hamName(id),
          sub: t('OK removes it'),
          stay: true,
          fn: function () {
            var o = hamCopy(sl);
            o.entities = ids
              .filter(function (x) {
                return x !== id;
              })
              .join('\n');
            hamSave(sl, o);
          },
        });
      });
      if (ids.length < 12)
        items.push({
          label: t('Add an entity'),
          stay: true,
          fn: function () {
            hamPickAny(t('Add an entity'), function (id) {
              var o = hamCopy(sl);
              if (ids.indexOf(id) < 0) o.entities = ids.concat(id).join('\n');
              hamSave(sl, o);
            });
          },
        });
    }
    if (c.type === 'ha-camera') {
      var ev = +c.every || 10;
      items.push(
        {
          label: t('Camera'),
          sub: c.entity ? hamName(c.entity) : t('Choose...'),
          stay: true,
          fn: function () {
            hamPick(t('Camera'), ['camera'], null, null, function (id) {
              var o = hamCopy(sl);
              o.entity = id;
              hamSave(sl, o);
              backMenu();
            });
          },
        },
        {
          label: t('New picture'),
          sub: ev === 60 ? t('Every minute') : ev === 30 ? t('Every 30 seconds') : t('Every 10 seconds'),
          stay: true,
          fn: function () {
            var o = hamCopy(sl);
            o.every = ev === 10 ? '30' : ev === 30 ? '60' : '';
            if (!o.every) delete o.every;
            hamSave(sl, o);
          },
        }
      );
    }
    items.push({ sep: true }, { note: t('Names and texts for the other cards are typed on your phone: Cards in the CleanYourTV app.') });
    return items;
  });
}
/* the kind of card for a place; the options stay when the same kind is chosen again. Each kind has its picture and what it is, left of the
   list as in the Theme menu; the cards downloaded from the catalog (manager > Cards > Get more cards) come after the launcher's own. */
function hamKindMenu(sl) {
  var cur = hamCard(sl).type,
    kinds = HAM_KINDS.filter(function (k) {
      return k[0] === 'none' || CARD_TYPES[k[0]];
    }).map(function (k) {
      return { type: k[0], name: t(k[1]), about: k[2] ? t(k[2]) : t('Leave this place empty.'), pic: k[0] === 'none' ? '' : k[0] };
    });
  Object.keys(CARD_PACKS).forEach(function (id) {
    kinds.push({ type: 'x-' + id, name: CARD_PACKS[id].name, about: CARD_PACKS[id].about, pic: id });
  });
  openMenu(
    hamPlace(sl),
    kinds.map(function (k) {
      return {
        label: k.name,
        sub: k.type === cur ? '\u2713' : '',
        desc: k.about,
        pvu: k.pic ? '/api/cards/preview/' + k.pic : '',
        stay: true,
        fn: function () {
          if (k.type !== cur) hamSave(sl, { type: k.type });
          backMenu();
        },
      };
    }),
    Math.max(
      0,
      kinds
        .map(function (k) {
          return k.type;
        })
        .indexOf(cur)
    )
  );
}
