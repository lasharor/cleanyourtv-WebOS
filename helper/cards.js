// Cards: small widgets in the slots a theme declares (themeschema.js: slots), chosen per slot in the manager app (Cards;
// POST /api/cards/status and /api/cards/set) and kept as config.cards, {<slot id>: {type, ...options}}, keyed by slot so a card stays when
// another theme has a slot with the same id. {type: 'none'} leaves a slot empty that the theme would fill by default.
// Only the shape is checked here (sanitize); the launcher draws the cards (app/src/js/cards.js), so a newer launcher can bring a card
// type without a service update. The options are typed on a phone page (create: POST /api/cards/pair, a short-lived server on the LAN,
// port 8792, that needs the code shown on the TV): a form per card for the types in TYPES, and the cards as JSON for everything else.
const http = require('http');
const web = require('./web'),
  i18n = require('./i18n'),
  nc = require('./netcompat');
const SLOT_ID = /^[a-z][a-z0-9-]{0,19}$/,
  TYPE = /^[a-z][a-z0-9-]{0,30}$/,
  MAX_SLOTS = 12;

// an option value: text, a number, true/false, or a short list of those or of small objects of those (an entities list)
function value(v, depth) {
  if (typeof v === 'string') return v.slice(0, 1000);
  if (typeof v === 'number') return isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v) && depth < 2)
    return v
      .slice(0, 40)
      .map(x => value(x, depth + 1))
      .filter(x => x !== undefined);
  if (v && typeof v === 'object' && depth > 0 && depth < 2) return options(v, depth + 1);
  return undefined;
}
function options(o, depth) {
  const out = {};
  for (const k of Object.keys(o).slice(0, 30)) {
    if (!/^[a-zA-Z][\w-]{0,30}$/.test(k)) continue;
    const v = value(o[k], depth);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
// the cards as the launcher sent them, or undefined when there is nothing usable
function sanitize(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return undefined;
  const out = {};
  for (const id of Object.keys(c).slice(0, MAX_SLOTS)) {
    const card = c[id];
    if (!SLOT_ID.test(id) || !card || typeof card !== 'object' || !TYPE.test(card.type)) continue;
    out[id] = Object.assign(options(card, 0), { type: card.type });
  }
  return out;
}

// the forms on the phone page: per card type its options (text, a longer text, or a choice); labels are English and translated there
const TYPES = [
  {
    type: 'greeting',
    name: 'Greeting',
    about: 'Good morning, good afternoon or good evening by the time of day, with a name and a second line: the date or the weather.',
    fields: [
      { key: 'name', kind: 'text', label: 'Name (optional)' },
      {
        key: 'line',
        kind: 'choice',
        label: 'Second line (where there is room)',
        choices: [
          ['', 'None'],
          ['date', 'The date'],
          ['weather', 'The weather (from a weather card)'],
        ],
      },
    ],
  },
  {
    type: 'weather',
    name: 'Weather',
    about: 'The weather now at a place you choose on your phone, with the next days if you like.',
    fields: [
      { key: 'place', kind: 'place', label: 'Place' },
      {
        key: 'unit',
        kind: 'choice',
        label: 'Temperature',
        choices: [
          ['', '°C'],
          ['f', '°F'],
        ],
      },
      {
        key: 'show',
        kind: 'choice',
        label: 'Show',
        choices: [
          ['', 'Now'],
          ['days', 'Now and the next days'],
        ],
      },
    ],
  },
  {
    type: 'ha-entity',
    name: 'Home Assistant entity',
    about: 'One Home Assistant entity with an icon and its state. OK switches a light, a switch or a scene.',
    ha: true,
    fields: [
      { key: 'entity', kind: 'entity', label: 'Entity' },
      { key: 'name', kind: 'text', label: 'Name (optional)' },
    ],
  },
  {
    type: 'ha-entities',
    name: 'Home Assistant entities',
    about: 'Several Home Assistant entities in a list under a title, each with its state.',
    ha: true,
    fields: [
      { key: 'title', kind: 'text', label: 'Title (optional)' },
      { key: 'entities', kind: 'entities', label: 'Entities, one per line' },
      {
        key: 'background',
        kind: 'choice',
        label: 'Card background',
        choices: [
          ['', 'Theme default'],
          ['dark', 'Dark background'],
        ],
      },
    ],
  },
  {
    type: 'ha-weather',
    name: 'Home Assistant weather',
    about: 'The weather from a Home Assistant weather entity, with the temperature outside and the forecast.',
    ha: true,
    fields: [
      { key: 'entity', kind: 'entity', label: 'Weather entity', only: 'weather' },
      { key: 'temp', kind: 'entity', label: 'Outside temperature sensor (optional)', only: 'sensor' },
      {
        key: 'show',
        kind: 'choice',
        label: 'Forecast',
        choices: [
          ['', 'The next days'],
          ['hourly', 'The next hours'],
          ['none', 'None'],
        ],
      },
    ],
  },
  {
    type: 'ha-camera',
    name: 'Home Assistant camera',
    about: 'A Home Assistant camera: a new picture every 10, 30 or 60 seconds.',
    ha: true,
    fields: [
      { key: 'entity', kind: 'entity', label: 'Camera', only: 'camera' },
      {
        key: 'every',
        kind: 'choice',
        label: 'New picture',
        choices: [
          ['', 'Every 10 seconds'],
          ['30', 'Every 30 seconds'],
          ['60', 'Every minute'],
        ],
      },
    ],
  },
  {
    type: 'template',
    name: 'Text',
    about: 'Your own text, with the greeting, time, date and weather filled in as they change.',
    fields: [
      { key: 'text', kind: 'long', label: 'Text' },
      {
        key: 'size',
        kind: 'choice',
        label: 'Size',
        choices: [
          ['', 'Medium'],
          ['small', 'Small'],
          ['large', 'Large'],
        ],
      },
    ],
  },
];
// the usual slot ids, named as in the launcher
const SLOT_NAMES = {
  greeting: 'Above the clock',
  'under-clock': 'Under the clock',
  'clock-side': 'Beside the clock',
  side: 'Right column',
  row: 'Above the dock',
};
const PAIR_PORT = 8792, // after the Wallpapers page (8791)
  PAIR_MS = 10 * 60 * 1000;

// what an add-on says about places is data for the launcher's list: text without control characters or angle brackets, coordinates in range
function cleanPlaces(list) {
  const text = (v, n) =>
    typeof v === 'string'
      ? Array.from(v)
          .filter(ch => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127 && ch !== '<' && ch !== '>')
          .join('')
          .trim()
          .slice(0, n)
      : '';
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (out.length >= 10) break;
    if (!p || typeof p !== 'object') continue;
    const lat = p.lat,
      lon = p.lon,
      name = text(p.name, 40);
    if (!name || typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ name, area: text(p.area, 80), lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
  }
  return out;
}

function create(ctx) {
  const config = ctx.config,
    weather = require('./weather').create({ path: require('./paths').WEATHER }),
    ha = require('./hacards').create({ config }),
    packs = require('./cardcatalog').create(ctx);
  const slots = () => {
    const th = ctx.feature('theme'),
      r = th && th.resolved();
    return (r && r.slots) || [];
  };
  // the downloaded cards as card types (x-<id>), their options as the fields of the form on the phone page
  /** @returns {any[]} */
  function packTypes() {
    const have = packs.all();
    return Object.keys(have).map(id => ({
      type: 'x-' + id,
      name: have[id].name,
      pack: have[id],
      fields: have[id].options.map(o =>
        Object.assign({ key: o.key, kind: o.kind, label: o.label, default: o.default }, o.choices ? { choices: o.choices } : {})
      ),
    }));
  }
  function state(lang) {
    const T = x => i18n.tr(lang, x);
    return {
      slots: slots().map(sl => ({ id: sl.id, name: T(SLOT_NAMES[sl.id] || sl.id), card: sl.card })),
      cards: config.get().cards || {},
      ha: ha.ready(),
      types: /** @type {any[]} */ (TYPES).concat(packTypes()).map(ty => ({
        type: ty.type,
        name: T(ty.name),
        about: ty.about ? T(ty.about) : ty.pack ? ty.pack.about || ty.pack.description : '',
        preview: ty.pack ? ty.pack.id : ty.type,
        drawer: ty.pack && ty.pack.drawer ? { label: T(ty.pack.drawer.label) } : null,
        settings: ty.pack && ty.pack.settings ? { title: T(ty.pack.settings.title) } : null,
        fields: ty.fields.map(f => Object.assign({}, f, { label: T(f.label), choices: f.choices && f.choices.map(c => [c[0], T(c[1])]) })),
      })),
    };
  }
  // the manager's Cards screen: a card type for one slot ('none' leaves it empty); the options stay when the same type is chosen again
  function setType(slot, type) {
    if (!slots().some(sl => sl.id === slot)) return { error: 'this theme has no such place' };
    if (type !== 'none' && !(/** @type {any[]} */ (TYPES).concat(packTypes()).some(ty => ty.type === type)))
      return { error: 'unknown card type' };
    config.update('cards (manager)', conf => {
      const c = Object.assign({}, conf.cards || {}),
        old = c[slot] || {};
      c[slot] = old.type === type ? old : { type };
      conf.cards = c;
    });
    return { ok: true };
  }
  // an option value from the launcher's settings panel of a card, checked against what the card declares: {value} or {error}
  function checkOption(f, v) {
    if (f.kind === 'choice') return f.choices.some(c => c[0] === v) ? { value: v } : { error: 'not a choice of this card' };
    if (typeof v !== 'string') return { error: 'not a text' };
    const t = Array.from(v)
      .filter(ch => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127 && ch !== '<' && ch !== '>')
      .join('')
      .trim()
      .slice(0, f.kind === 'place' ? 40 : 200);
    return { value: t };
  }
  // the launcher's settings panel of a card: {type, set} -> every place that holds a card of this downloaded or add-on type gets those options
  // (the city with its coordinates, the unit, the size). Only options the card declares count, and a city has both coordinates or none.
  function setOptions(type, set) {
    const ty = packTypes().filter(x => x.type === type)[0];
    if (!ty) return { error: 'unknown card type' };
    // only a card of an add-on that declares settings has a panel; a downloaded card or one without settings is not changed from here
    if (!ty.pack || !ty.pack.addon || !ty.pack.settings) return { error: 'this card has no settings' };
    if (!set || typeof set !== 'object' || Array.isArray(set)) return { error: 'no options' };
    const patch = {};
    for (const f of ty.fields) {
      if (!(f.key in set)) continue;
      const r = checkOption(f, set[f.key]);
      if (r.error) return { error: r.error };
      patch[f.key] = r.value;
      if (f.kind === 'place') {
        const lat = set.lat,
          lon = set.lon;
        if (typeof lat === 'number' && typeof lon === 'number' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          patch.lat = Math.round(lat * 100) / 100;
          patch.lon = Math.round(lon * 100) / 100;
        } else return { error: 'a city needs its coordinates' };
      }
    }
    const have = Object.keys(config.get().cards || {}).filter(id => (config.get().cards[id] || {}).type === type);
    if (!have.length) return { error: 'this card is not on Home' };
    const next = Object.assign({}, config.get().cards);
    config.update('cards (launcher)', conf => {
      for (const id of have) next[id] = Object.assign({}, next[id], patch);
      conf.cards = next;
    });
    return { ok: true, cards: next };
  }
  function save(cards) {
    const c = sanitize(cards) || {};
    config.update('cards (phone)', conf => {
      if (Object.keys(c).length) conf.cards = c;
      else delete conf.cards;
    });
    return c;
  }

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function startPair() {
    stopPair();
    const code = String(nc.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => phone(req, res, code, () => ++bad));
    pair = { code, srv, url: 'http://' + web.lanIp() + ':' + PAIR_PORT, until: Date.now() + PAIR_MS, timer: setTimeout(stopPair, PAIR_MS) };
    const out = { url: pair.url, code, qr: pair.url + '/#' + code, seconds: PAIR_MS / 1000 };
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve(out));
    });
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, pair.until - Date.now());
  }
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  async function phone(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      lang = i18n.lang(req, config.get().lang),
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phonePage(lang));
    }
    if (u.indexOf('/api/') !== 0) return web.notFound(res);
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    if (u === '/api/state') return json(state(lang));
    if (u === '/api/save' && req.method === 'POST') return json({ ok: true, cards: save((await web.body(req, 65536)).cards) });
    if (u === '/api/entities') {
      try {
        return json({ entities: await ha.entities() });
      } catch (e) {
        return json({ error: String(e.message || e), entities: [] });
      }
    }
    if (u === '/api/places' && req.method === 'POST') {
      try {
        return json({ places: await weather.search((await web.body(req, 4096)).q, lang) });
      } catch (e) {
        return json({ error: String(e.message || e) });
      }
    }
    json({ error: 'not found' }, 404);
  }

  // ---- cards of add-ons (addon.json "cards"): the launcher asks the add-on for the card's data and sends it the card's actions ----
  const FEED_MAX = 128 * 1024; // a cover as a data: address fits; anything larger is refused
  // the add-on behind the card in a slot: {opt} (the card's options as the add-on gets them: defaults filled in, a place with its
  // coordinates) with the card and the add-on's service; {error} when the slot holds no such card
  function addonCard(slot) {
    const c = (config.get().cards || {})[slot];
    const e =
      c &&
      typeof c.type === 'string' &&
      /^x-/.test(c.type) &&
      ctx
        .feature('addons')
        .cardsOf()
        .filter(x => 'x-' + x.card.id === c.type)[0];
    if (!e || !e.mod || !e.mod.cards) return { error: 'no such card' };
    const opt = {};
    for (const q of e.card.options) {
      const v = c[q.key];
      opt[q.key] = v !== undefined && v !== '' ? v : q.kind === 'choice' && !q.default ? q.choices[0][0] : q.default;
      if (q.kind === 'place') {
        opt.lat = c.lat;
        opt.lon = c.lon;
      }
    }
    return { e, opt };
  }
  // a call into the add-on that always ends: its answer, {error}, or {error} after 15 seconds
  /** @param {() => any} fn */
  function inAddon(fn) {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve({ error: 'the add-on did not answer' }), 15000);
      Promise.resolve()
        .then(fn)
        .then(
          r => {
            clearTimeout(t);
            resolve(r && typeof r === 'object' && !Array.isArray(r) ? r : {});
          },
          err => {
            clearTimeout(t);
            resolve({ error: String((err && err.message) || err).slice(0, 160) });
          }
        );
    });
  }
  async function addonFeed(slot) {
    const a = addonCard(String(slot || ''));
    if (a.error) return a;
    if (typeof a.e.mod.cards.feed !== 'function') return {};
    const r = await inAddon(() => a.e.mod.cards.feed(a.e.card.id, a.opt));
    return JSON.stringify(r).length > FEED_MAX ? { error: 'the answer is too large' } : r;
  }
  async function addonAction(slot, name, arg) {
    const a = addonCard(String(slot || ''));
    if (a.error) return a;
    if (!a.e.card.actions.some(x => x.name === name) || typeof a.e.mod.cards.action !== 'function') return { error: 'no such action' };
    // the actions of the drawer and of the settings belong to the launcher (it opens the sheet or the panel), never to the add-on
    if ((a.e.card.drawer && a.e.card.drawer.action === name) || (a.e.card.settings && a.e.card.settings.action === name))
      return { error: 'no such action' };
    const v = typeof arg === 'string' ? arg.slice(0, 100) : typeof arg === 'number' && isFinite(arg) ? arg : '';
    return inAddon(() => a.e.mod.cards.action(a.e.card.id, a.opt, name, v));
  }

  async function handle(req, res, u, body) {
    // a Home Assistant camera's picture for the camera card (GET, so the launcher can use it as an image)
    if (u.indexOf('/card/') === 0) return packs.serve(req, res, u);
    if (await packs.handle(req, res, u, body)) return;
    const cam = /^\/api\/cards\/ha\/camera\/(camera\.[\w]{1,120})$/.exec(u);
    if (cam) {
      const img = await ha.camera(cam[1]);
      if (!img) return web.notFound(res);
      res.writeHead(200, { 'content-type': img.type, 'cache-control': 'no-store' });
      return res.end(img.body);
    }
    if (req.method !== 'POST') return web.notFound(res);
    const b = await body(req);
    if (u === '/api/cards/pair') return web.json(res, b.stop ? (stopPair(), {}) : await startPair());
    // the manager's Cards screen: the theme's places with their cards, and a card type picked for one of them
    if (u === '/api/cards/status') return web.json(res, state(i18n.lang(req, config.get().lang)));
    // a card of an add-on: {slot} -> its data; {slot, name, arg} -> an action of one of its buttons
    if (u === '/api/cards/feed' || u === '/api/cards/action') i18n.screen(b.lang);
    if (u === '/api/cards/feed') return web.json(res, await addonFeed(b.slot));
    if (u === '/api/cards/action') return web.json(res, await addonAction(b.slot, String(b.name || ''), b.arg));
    if (u === '/api/cards/set') return web.json(res, setType(String(b.slot || ''), String(b.type || '')));
    // the launcher's settings panel of a card: {type, set: {place, lat, lon, unit, size}} -> those options on every place with that card
    if (u === '/api/cards/options') return web.json(res, setOptions(String(b.type || ''), b.set));
    // a city search for a card (the settings panel): {type, q} -> {places: [{name, area, lat, lon}]}, answered by the service of the card's
    // add-on through its optional hook cards.places(q, lang) -> {places: [...]}
    if (u === '/api/cards/places') {
      const e = ctx
          .feature('addons')
          .cardsOf()
          .filter(x => 'x-' + x.card.id === String(b.type || ''))[0],
        q = String(b.q || '')
          .trim()
          .slice(0, 60);
      if (!e || !e.mod || !e.mod.cards || typeof e.mod.cards.places !== 'function' || q.length < 2) return web.json(res, { places: [] });
      const lang = i18n.lang(req, config.get().lang),
        r = await inAddon(() => e.mod.cards.places(q, lang));
      return web.json(res, r.error ? { error: 'City search is not available now.', places: [] } : { places: cleanPlaces(r.places) });
    }
    // the weather card: {lat, lon, unit} -> the weather there (Open-Meteo, at most every 30 minutes)
    if (u === '/api/cards/weather') return web.json(res, await weather.get(b.lat, b.lon, b.unit));
    // Home Assistant cards: {ids} -> their states (kept 20 s); {id} -> switched (lights, switches, fans, scenes, scripts)
    if (u === '/api/cards/ha') return web.json(res, await ha.states(b.ids));
    if (u === '/api/cards/ha/toggle') return web.json(res, await ha.toggle(b.id));
    // the Home Assistant weather card: {id, temp, kind} -> the condition now and the forecast (kept 15 minutes)
    if (u === '/api/cards/ha/weather')
      return web.json(res, await ha.weather(String(b.id || ''), String(b.temp || ''), b.kind === undefined ? 'daily' : String(b.kind)));
    // the launcher's Customise > Home Assistant: {domains} -> the entities to choose from
    if (u === '/api/cards/ha/entities') return web.json(res, Object.assign({ ha: ha.ready() }, await ha.pick(b.domains)));
    web.notFound(res);
  }
  // the files of a page card are under /card/<id>/ (cardcatalog.js)
  return { name: 'cards', prefix: '/api/cards/', match: packs.match, handle, stop: stopPair, packs: () => packs.all() };
}

// the phone page: a form per slot (the card type, then its options), and all cards as JSON. Plain script for iOS Safari and Android
// Chrome, in the phone's language (i18n.js).
const PHONE_JS = `var code='',S={},$=function(i){return document.getElementById(i)};
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function msg(s,e){$('msg').innerHTML=s?'<p class="m'+(e?' e':'')+'"></p>':'';if(s)$('msg').firstChild.textContent=s}
function showLogin(s){$('login').className='';$('main').className='hide';$('sum').textContent=s||''}
function el(tag,attrs,text){var e=document.createElement(tag);for(var k in attrs||{})e.setAttribute(k,attrs[k]);if(text!==undefined)e.textContent=text;return e}
function typeOf(n){for(var i=0;i<S.types.length;i++)if(S.types[i].type===n)return S.types[i];return null}
/* the card a slot shows now: the chosen one, else the theme's default, else none */
function cardOf(sl){var c=S.cards[sl.id];return c&&c.type?c:{type:sl.card||'none'}}
function draw(){var box=$('slots');box.innerHTML='';$('sum').textContent=S.slots.length?'':t('This theme has no places for cards. Choose a theme with cards (Lock Screen) in Customise > Theme.');
 S.slots.forEach(function(sl){var c=cardOf(sl),sec=el('section',{'class':'sl','data-id':sl.id});sec.appendChild(el('h2',{},sl.name));
  var sel=el('select',{'data-k':'type'});sel.appendChild(el('option',{value:'none'},t('Empty')));S.types.forEach(function(ty){sel.appendChild(el('option',{value:ty.type},ty.name))});
  if(c.type!=='none'&&!typeOf(c.type))sel.appendChild(el('option',{value:c.type},c.type));sel.value=c.type;sec.appendChild(sel);
  var f=el('div',{'class':'f'});sec.appendChild(f);fields(f,c);sel.onchange=function(){var o=S.cards[sl.id]&&S.cards[sl.id].type===sel.value?S.cards[sl.id]:{type:sel.value};fields(f,o)};box.appendChild(sec)});
 $('raw').value=JSON.stringify(S.cards,null,2)}
function fields(f,c){f.innerHTML='';var ty=typeOf(c.type);if(!ty)return;ty.fields.forEach(function(fd){var l=el('label',{},fd.label),i;
  if(fd.kind==='choice'){i=el('select',{'data-k':fd.key});fd.choices.forEach(function(ch){i.appendChild(el('option',{value:ch[0]},ch[1]))})}
  else if(fd.kind==='long'){i=el('textarea',{'data-k':fd.key,rows:4})}else if(fd.kind==='place'){f.appendChild(l);place(f,c);return}else if(fd.kind==='entities'){i=el('textarea',{'data-k':fd.key,rows:5,list:'ents',autocapitalize:'off',spellcheck:'false'})}else if(fd.kind==='entity'){i=el('input',{'data-k':fd.key,type:'text',list:fd.only==='camera'?'cams':fd.only==='weather'?'wxs':fd.only==='sensor'?'sens':'ents',autocomplete:'off',autocapitalize:'off'})}else i=el('input',{'data-k':fd.key,type:'text',autocomplete:'off'});
  if(fd.default)i.setAttribute('placeholder',fd.default);i.value=c[fd.key]===undefined?'':String(c[fd.key]);f.appendChild(l);f.appendChild(i)});
 if(ty.ha&&!S.ha)f.insertBefore(el('p',{'class':'m e'},t('Home Assistant is not set up yet: set its address and token in the manager app, More > Home Assistant.')),f.firstChild);
 if(c.type==='template')f.appendChild(el('p',{'class':'h'},t('Use {{greeting}}, {{time}}, {{date}} and {{weekday}} for what changes, and {{weather.temp}} and {{weather.text}} when a weather card is on Home; **bold**, *italic* and a line starting with # for a heading.')))}
/* a place for the weather: searched by name (Open-Meteo, through the TV), its coordinates kept in two hidden fields */
function place(f,c){var i=el('input',{'data-k':'place',type:'search',autocomplete:'off',placeholder:t('City or town')}),la=el('input',{'data-k':'lat','data-n':'1',type:'hidden'}),lo=el('input',{'data-k':'lon','data-n':'1',type:'hidden'}),
  b=el('button',{type:'button'},t('Search')),r=el('div',{'class':'pl'});i.value=c.place||'';la.value=c.lat===undefined?'':c.lat;lo.value=c.lon===undefined?'':c.lon;
  [i,b,r,la,lo].forEach(function(x){f.appendChild(x)});
  b.onclick=function(){r.textContent=t('Searching...');api('places',{q:i.value}).then(function(j){r.innerHTML='';if(j.error)return r.appendChild(el('p',{},t(j.error)));if(!(j.places||[]).length)return r.appendChild(el('p',{},t('Not found')));
   j.places.forEach(function(p){var o=el('button',{type:'button','class':'po'},p.name+(p.area?' \\u00B7 '+p.area:''));o.onclick=function(){i.value=p.name;la.value=p.lat;lo.value=p.lon;r.innerHTML='';r.appendChild(el('p',{},t('Chosen: %s').replace('%s',p.name)))};r.appendChild(o)})})}}
/* the forms into cards; options of a type the page has no form for stay as they were */
function fromForms(){var out={};[].forEach.call(document.querySelectorAll('section.sl'),function(sec){var id=sec.getAttribute('data-id'),ty=sec.querySelector('[data-k=type]').value,old=S.cards[id]||{},c={type:ty};
  if(!typeOf(ty)&&old.type===ty)c=old;[].forEach.call(sec.querySelectorAll('.f [data-k]'),function(i){if(i.value!=='')c[i.getAttribute('data-k')]=i.getAttribute('data-n')?+i.value:i.value});
  var sl=null;S.slots.forEach(function(x){if(x.id===id)sl=x});if(ty==='none'&&!(sl&&sl.card))return;out[id]=c});
 for(var k in S.cards)if(!(k in out)&&!S.slots.some(function(x){return x.id===k}))out[k]=S.cards[k];return out}
function save(cards){msg(t('Saving…'));api('save',{cards:cards}).then(function(r){if(r.error)return msg(t(r.error),1);S.cards=r.cards||{};draw();msg(t('Saved. Open Home on the TV to see it.'))},function(e){msg(e.error,1)})}
/* the entities of Home Assistant, offered while typing an entity id */
function ents(){if(!S.ha)return;api('entities').then(function(j){var a=$('ents'),b=$('cams'),w=$('wxs'),n=$('sens');a.innerHTML=b.innerHTML=w.innerHTML=n.innerHTML='';(j.entities||[]).forEach(function(e){var o=el('option',{value:e.id},e.name);a.appendChild(o);if(/^camera\\./.test(e.id))b.appendChild(o.cloneNode(true));if(/^weather\\./.test(e.id))w.appendChild(o.cloneNode(true));if(/^sensor\\./.test(e.id))n.appendChild(o.cloneNode(true))})})}
function state(){return api('state').then(function(s){S=s;$('login').className='hide';$('main').className='';draw();ents()})}
$('save').onclick=function(){save(fromForms())};
$('rs').onclick=function(){var c;try{c=JSON.parse($('raw').value||'{}')}catch(e){return msg(t('This is not valid JSON.'),1)}save(c)};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;
function phonePage(lang) {
  const T = s => web.esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${T('Cards')}</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:0 0 10px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input,select,textarea{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0}
button{text-align:center}button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}textarea{resize:vertical}label{display:block;color:#aaa;margin:12px 0 0;font-size:15px}
.sl{padding:16px;border-radius:14px;background:#15161b;margin:14px 0}.h{font-size:14px}.hide{display:none}details{margin:28px 0}summary{color:#aaa}
.pl .po{text-align:left;margin:6px 0}#raw{font:13px ui-monospace,Menlo,monospace;min-height:220px}[dir=rtl] body{text-align:right}</style>
<h1>${T('Cards')}</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<datalist id=ents></datalist><datalist id=cams></datalist><datalist id=wxs></datalist><datalist id=sens></datalist><div id=main class=hide><div id=msg></div><div id=slots></div><button class=p id=save>${T('Save')}</button>
<details><summary>${T('Edit as JSON')}</summary><p class=h>${T('All cards at once, by slot: {"greeting": {"type": "greeting", "name": "Sam"}}. A type the TV does not know yet leaves its slot empty.')}</p>
<textarea id=raw spellcheck=false autocapitalize=off></textarea><button id=rs>${T('Save JSON')}</button></details></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { SLOT_ID, TYPE, MAX_SLOTS, TYPES, PAIR_PORT, sanitize, create };
