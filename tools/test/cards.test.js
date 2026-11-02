// Cards (cards.js): the phone page opens with a code, lists the theme's slots and the card types with their options, saves the cards
// (checked for shape) where the launcher reads them, and the launcher page draws the greeting and a text card.
const fs = require('fs'),
  http = require('http'),
  path = require('path'),
  vm = require('vm');
const { root, ok, call, sleep, serve, req, memoryConfig, run } = require('./lib');

// the source of one top-level function of a launcher script, from "function name(" to its closing brace
function source(js, name) {
  const start = js.indexOf('function ' + name + '(');
  let depth = 0;
  for (let i = js.indexOf('{', start); start >= 0 && i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
  }
  return '';
}

// a string cut in the middle of an emoji: a high surrogate without its pair, or a low one with no high one before it
function hasHalfCharacter(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

function phone(method, p, body, code) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 8792, path: p, method, headers: { 'x-code': code || '' } }, res => {
      const b = [];
      res.on('data', c => b.push(c));
      res.on('end', () => {
        const t = Buffer.concat(b).toString();
        let j = null;
        try {
          j = JSON.parse(t);
        } catch (_) {}
        resolve({ code: res.statusCode, text: t, j });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

run(async () => {
  // Open-Meteo stand-ins: the forecast and the place search
  let asked = 0;
  const om = await serve((rq, rs) => {
    rs.writeHead(200, { 'content-type': 'application/json' });
    if (/\/search/.test(rq.url))
      return rs.end(
        JSON.stringify({ results: [{ name: 'Utrecht', admin1: 'Utrecht', country: 'Nederland', latitude: 52.0908, longitude: 5.1222 }] })
      );
    asked++;
    rs.end(
      JSON.stringify({
        current: { temperature_2m: 11.6, weather_code: 3, is_day: 1 },
        daily: {
          time: ['2026-10-27', '2026-10-28'],
          weather_code: [3, 61],
          temperature_2m_max: [13.2, 12],
          temperature_2m_min: [7.9, 6.1],
        },
      })
    );
  });
  process.env.CYTV_WEATHER_URL = om.url + '/v1/forecast';
  process.env.CYTV_GEO_URL = om.url + '/v1/search';
  const C = req('cards');
  const config = memoryConfig({ lang: 'nl', cards: { greeting: { type: 'greeting', name: 'Sam' } } });
  const theme = {
    name: 'theme',
    resolved: () => ({
      slots: [
        { id: 'greeting', card: 'greeting' },
        { id: 'side', card: '' },
        { id: 'odd-one', card: '' },
      ],
    }),
  };
  const cards = C.create({ config, feature: n => (n === 'theme' ? theme : null) });
  let r = await call(cards, '/api/cards/pair', 'POST', {});
  const code = r.j.code;
  ok(/^\d{6}$/.test(code) && /:8792\/#\d{6}$/.test(r.j.qr), 'the cards page opens with a 6-digit code, which the QR code carries');
  await sleep(100);
  let p = await phone('GET', '/');
  ok(
    p.code === 200 && /<title>Kaarten<\/title>/.test(p.text) && /JSON/.test(p.text),
    'the page is in the chosen language and has a JSON editor'
  );
  p = await phone('GET', '/api/state', undefined, '000000');
  ok(p.code === 403, 'the API needs the code');
  p = await phone('GET', '/api/state', undefined, code);
  ok(
    p.j.slots.length === 3 &&
      p.j.slots[0].name === 'Boven de klok' &&
      p.j.slots[2].name === 'odd-one' &&
      p.j.cards.greeting.name === undefined &&
      p.j.name === 'Sam' &&
      p.j.types.some(t => t.type === 'greeting' && t.fields.some(f => f.key === 'name' && f.kind === 'yourname')) &&
      p.j.types.some(t => t.type === 'template' && t.fields.some(f => f.key === 'text')),
    'the state lists the slots (named in the language), the saved cards and the card types with their options'
  );
  p = await phone(
    'POST',
    '/api/save',
    { cards: { side: { type: 'template', text: 'Hi {{greeting}}', size: 'large' }, 'B A D': { type: 'x' } } },
    code
  );
  ok(
    p.j.ok && JSON.stringify(config.get().cards) === JSON.stringify({ side: { type: 'template', text: 'Hi {{greeting}}', size: 'large' } }),
    'saving replaces the cards with what the page sent, checked for shape'
  );
  await phone('POST', '/api/save', { cards: {} }, code);
  ok(config.get().cards === undefined, 'saving no cards removes them');
  // "Your name" in the Home greeting: typed on the same page, kept as config.name
  p = await phone('GET', '/');
  // Save reads every section.sl as a card slot (it needs the card type select), so the name box must not be one
  ok(
    /id=yname/.test(p.text) && /<section class="nm hide"/.test(p.text) && !/<section class=sl>/.test(p.text),
    'the page has a field for your name, which is not mistaken for a card place'
  );
  ok(
    /\$\('sum'\)\.textContent=NAMEONLY\?/.test(p.text),
    'the page opened for the name alone does not talk about the card places (a theme without cards has none)'
  );
  ok(
    config.get().name === 'Sam',
    'a name typed on a Greeting card before there was Your name became the name (the state above shows the card without one)'
  );
  p = await phone('POST', '/api/save', { cards: {}, name: '  Alex  ' }, code);
  ok(p.j.ok && p.j.name === 'Alex' && config.get().name === 'Alex', 'the name is saved, trimmed');
  p = await phone('GET', '/api/state', undefined, code);
  ok(p.j.name === 'Alex', 'the state gives the name back to the page');
  p = await phone('POST', '/api/save', { cards: {} }, code);
  ok(p.j.ok && p.j.name === undefined && config.get().name === 'Alex', 'saving only cards (the JSON editor) leaves the name alone');
  p = await phone('POST', '/api/save', { cards: {}, name: '<img src=x onerror=alert(1)>\u202e\u0000 ' + 'x'.repeat(100) }, code);
  ok(
    !/[<>\u202e\u0000]/.test(config.get().name) && Array.from(config.get().name).length <= 30 && p.j.name === config.get().name,
    'markup, direction marks and control characters are removed from the name, and it is cut at 30 characters'
  );
  p = await phone('POST', '/api/save', { cards: {}, name: 'עדן' }, code);
  ok(config.get().name === 'עדן', 'a Hebrew name is kept as typed');
  p = await phone('POST', '/api/save', { cards: {}, name: 42 }, code);
  ok(config.get().name === 'עדן', 'a name that is not text changes nothing');
  p = await phone('POST', '/api/save', { cards: {}, name: '' }, code);
  ok(p.j.name === '' && config.get().name === undefined, 'an empty name clears it');
  // a greeting card written as JSON with a name: adopted when there is no name, dropped when there is one
  await phone('POST', '/api/save', { cards: {}, name: '' }, code);
  p = await phone('POST', '/api/save', { cards: { greeting: { type: 'greeting', name: 'Noa', line: 'date' } } }, code);
  ok(
    config.get().name === 'Noa' && p.j.cards.greeting.name === undefined && p.j.cards.greeting.line === 'date',
    'a name in a Greeting card (JSON editor) becomes Your name when there is none; the card keeps its other options'
  );
  p = await phone('POST', '/api/save', { cards: { greeting: { type: 'greeting', name: 'Other' } } }, code);
  ok(
    config.get().name === 'Noa' && config.get().cards.greeting.name === undefined,
    'with a name set, a name in a Greeting card is dropped'
  );
  await phone('POST', '/api/save', { cards: {}, name: '' }, code);
  // the same setting typed on the TV with its keyboard (the manager app's Your name screen): the service's own route
  r = await call(cards, '/api/cards/name', 'POST', { name: '  Alex <b> ' });
  ok(
    r.j.ok && r.j.name === 'Alex b' && config.get().name === 'Alex b',
    'a name typed on the TV is saved, cleaned like the one from the phone'
  );
  r = await call(cards, '/api/cards/name', 'POST', { name: 5 });
  ok(r.j.error && config.get().name === 'Alex b', 'a name that is not text is refused');
  r = await call(cards, '/api/cards/name', 'POST', { name: '' });
  ok(r.j.ok && r.j.name === '' && config.get().name === undefined, 'an empty name typed on the TV clears it');
  // the launcher draws it: greetText() as the launcher has it, with the texts of en.json
  {
    const js = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'cards.js'), 'utf8');
    const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'en.json'), 'utf8'));
    const sb = { cfg: {}, t: s => en[s] || s };
    vm.createContext(sb);
    vm.runInContext(source(js, 'greetText'), sb, { filename: 'greetText' });
    const at = h => {
      sb.Date = class extends Date {
        getHours() {
          return h;
        }
      };
      return vm.runInContext('greetText()', sb);
    };
    ok(at(9) === 'Good morning' && at(14) === 'Good afternoon' && at(20) === 'Good evening', 'without a name the greeting is what it was');
    sb.cfg.name = 'Alex';
    ok(
      at(9) === 'Good morning, \u2068Alex\u2069' && at(20) === 'Good evening, \u2068Alex\u2069',
      'with a name set the greeting says it, between direction isolates so a right-to-left name keeps its order'
    );
    sb.cfg.name = '$& $1 עדן';
    ok(at(20) === 'Good evening, \u2068$& $1 עדן\u2069', 'a name is put in as it is, even with $ in it');
    // a name of emoji: the service keeps 30 characters, the launcher's own cut must not leave half of one behind
    sb.cfg.name = '😀'.repeat(19) + 'a' + '😀';
    const cut = at(20);
    ok(!hasHalfCharacter(cut), 'a cut through an emoji leaves no half character in the greeting: ' + JSON.stringify(cut.slice(-3)));
    delete sb.cfg.name;
    ok(at(20) === 'Good evening', 'clearing the name takes it out of the greeting');
  }
  // the manager's Cards screen: the places and a card type for one of them
  r = await call(cards, '/api/cards/status', 'POST', {});
  ok(r.j.slots.length === 3 && r.j.types.some(t => t.type === 'ha-camera'), 'the manager gets the places and the card types');
  r = await call(cards, '/api/cards/set', 'POST', { slot: 'side', type: 'ha-camera' });
  ok(r.j.ok && config.get().cards.side.type === 'ha-camera', 'the manager picks a card for a place');
  config.update('test', c => {
    c.cards.side.entity = 'camera.door';
  });
  await call(cards, '/api/cards/set', 'POST', { slot: 'side', type: 'ha-camera' });
  ok(config.get().cards.side.entity === 'camera.door', 'picking the same type again keeps its options');
  await call(cards, '/api/cards/set', 'POST', { slot: 'greeting', type: 'none' });
  ok(config.get().cards.greeting.type === 'none', 'a place the theme fills can be left empty');
  r = await call(cards, '/api/cards/set', 'POST', { slot: 'nowhere', type: 'greeting' });
  const bad = await call(cards, '/api/cards/set', 'POST', { slot: 'side', type: 'rocket' });
  ok(r.j.error && bad.j.error && config.get().cards.side.type === 'ha-camera', 'an unknown place or card type is refused');
  await phone('POST', '/api/save', { cards: {} }, code);
  p = await phone('POST', '/api/places', { q: 'Utrecht' }, code);
  ok(
    p.j.places.length === 1 && p.j.places[0].lat === 52.09 && p.j.places[0].area === 'Utrecht, Nederland',
    'the phone page finds a place by name'
  );
  r = await call(cards, '/api/cards/weather', 'POST', { lat: 52.09, lon: 5.12 });
  const r2 = await call(cards, '/api/cards/weather', 'POST', { lat: 52.09, lon: 5.12 });
  ok(
    r.j.now.temp === 12 && r.j.now.code === 3 && r.j.days.length === 2 && r.j.days[1].max === 12 && r2.j.at === r.j.at && asked === 1,
    'the weather of a place is asked once and then kept (at most every 30 minutes)'
  );
  r = await call(cards, '/api/cards/weather', 'POST', { lat: 'x' });
  ok(r.j.error === 'no place chosen', 'no weather without a place');
  // Home Assistant cards, with the address and token set for Voice
  const calls = [];
  const has = await serve((rq, rs) => {
    calls.push(rq.method + ' ' + rq.url + ' ' + rq.headers.authorization);
    if (rq.url === '/api/states') {
      rs.writeHead(200, { 'content-type': 'application/json' });
      return rs.end(
        JSON.stringify([
          { entity_id: 'light.living', state: 'on', attributes: { friendly_name: 'Living room' } },
          { entity_id: 'sensor.temp', state: '8.4', attributes: { friendly_name: 'Outside', unit_of_measurement: '°C' } },
          { entity_id: 'lock.door', state: 'locked', attributes: {} },
          {
            entity_id: 'weather.home',
            state: 'rainy',
            attributes: {
              friendly_name: 'Home',
              temperature: 9,
              temperature_unit: '°C',
              humidity: 81,
              wind_speed: 14.2,
              wind_speed_unit: 'km/h',
            },
          },
        ])
      );
    }
    if (rq.url === '/api/camera_proxy/camera.door') {
      rs.writeHead(200, { 'content-type': 'image/jpeg' });
      return rs.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    }
    if (rq.url === '/api/services/weather/get_forecasts?return_response') {
      rs.writeHead(200, { 'content-type': 'application/json' });
      return rs.end(
        JSON.stringify({
          changed_states: [],
          service_response: {
            'weather.home': {
              forecast: [
                { datetime: '2026-10-29T11:00:00+00:00', condition: 'rainy', temperature: 11.4, templow: 4, precipitation_probability: 70 },
                { datetime: '2026-10-30T11:00:00+00:00', condition: 'sunny', temperature: 10, templow: 3.2 },
              ],
            },
          },
        })
      );
    }
    if (/^\/api\/services\//.test(rq.url)) {
      rs.writeHead(200, { 'content-type': 'application/json' });
      return rs.end('[]');
    }
    rs.writeHead(404);
    rs.end();
  });
  r = await call(cards, '/api/cards/ha', 'POST', { ids: ['light.living'] });
  ok(r.j.error === 'Home Assistant is not set up', 'Home Assistant cards need the address and token from Voice');
  config.update('test', c => {
    c.voice = { ha: { url: has.url, token: 'tok' } };
  });
  r = await call(cards, '/api/cards/ha', 'POST', { ids: ['light.living', 'sensor.temp', 'switch.gone', 'bad id'] });
  const st = r.j.states || [];
  ok(
    st.length === 3 &&
      st[0].name === 'Living room' &&
      st[0].state === 'on' &&
      st[0].can === true &&
      st[1].unit === '°C' &&
      st[1].can === false &&
      st[2].state === 'unavailable' &&
      calls.filter(c => /states/.test(c)).length === 1 &&
      /Bearer tok/.test(calls[0]),
    'the states come from one request with the Voice token; a missing entity is unavailable and a bad id is left out'
  );
  await call(cards, '/api/cards/ha', 'POST', { ids: ['sensor.temp'] });
  ok(calls.filter(c => /states/.test(c)).length === 1, 'the states are kept for a while, however many cards ask');
  r = await call(cards, '/api/cards/ha/toggle', 'POST', { id: 'light.living' });
  const r3 = await call(cards, '/api/cards/ha/toggle', 'POST', { id: 'lock.door' });
  ok(
    r.j.ok && calls.some(c => /POST \/api\/services\/light\/toggle/.test(c)) && /cannot be switched/.test(r3.j.error),
    'OK switches a light, but never a lock'
  );
  r = await call(cards, '/api/cards/ha/camera/camera.door');
  const r4 = await call(cards, '/api/cards/ha/camera/light.living');
  ok(r.code === 200 && r4.code === 404, "a camera's picture is passed on, and only for camera entities");
  r = await call(cards, '/api/cards/ha/entities', 'POST', { domains: ['sensor'] });
  const r6 = await call(cards, '/api/cards/ha/entities', 'POST', {});
  ok(
    r.j.ha === true && r.j.entities.length === 1 && r.j.entities[0].unit === '°C' && r6.j.entities.length === 4,
    "the launcher's Home Assistant menu gets the entities of the domains it asks for (all without), with their units"
  );
  p = await phone('GET', '/api/entities', undefined, code);
  ok(p.j.entities.length === 4 && p.j.entities[0].id === 'light.living', 'the phone page lists the entities to choose from');
  // the Home Assistant weather card: the condition, the temperature from a sensor when one is chosen, and the forecast
  r = await call(cards, '/api/cards/ha/weather', 'POST', { id: 'weather.home', temp: 'sensor.temp', kind: 'daily' });
  ok(
    r.j.now.cond === 'rainy' &&
      r.j.now.temp === 8.4 &&
      r.j.now.hum === 81 &&
      r.j.now.wind === 14 &&
      r.j.list.length === 2 &&
      r.j.list[0].hi === 11 &&
      r.j.list[0].rain === 70 &&
      r.j.list[1].rain === null &&
      calls.some(c => /POST \/api\/services\/weather\/get_forecasts\?return_response/.test(c)),
    'the weather card reads the condition, the outside sensor and the forecast from weather.get_forecasts'
  );
  const nf = calls.filter(c => /get_forecasts/.test(c)).length;
  r = await call(cards, '/api/cards/ha/weather', 'POST', { id: 'weather.home', kind: 'daily' });
  ok(
    r.j.now.temp === 9 && calls.filter(c => /get_forecasts/.test(c)).length === nf,
    "without a sensor the entity's own temperature; the forecast is kept"
  );
  r = await call(cards, '/api/cards/ha/weather', 'POST', { id: 'sensor.temp' });
  const r5 = await call(cards, '/api/cards/ha/weather', 'POST', { id: 'weather.home', kind: 'none' });
  ok(!!r.j.error && r5.j.list.length === 0, 'only a weather entity, and no forecast when none is wanted');
  has.server.close();
  await call(cards, '/api/cards/pair', 'POST', { stop: true });
  await sleep(50);
  p = await phone('GET', '/').catch(() => ({ code: 0 }));
  ok(p.code === 0, 'the page is closed after stop');
  // the manager's Your name screen: the QR code opens the page with only the name
  r = await call(cards, '/api/cards/pair', 'POST', { name: true });
  ok(
    r.j.qr.indexOf(':8792/?name=1#' + r.j.code) > 0 && r.j.code !== code,
    'the Your name screen gets a QR code for the page with just the name'
  );
  p = await phone('GET', '/');
  ok(p.code === 200 && /NAMEONLY/.test(p.text), 'the page is the same one; it reads ?name=1 to show only the name');
  p = await phone('POST', '/api/save', { name: 'Dana' }, r.j.code);
  ok(
    p.j.ok && p.j.name === 'Dana' && p.j.cards === undefined && config.get().name === 'Dana',
    'saving only the name leaves the cards alone'
  );
  await phone('POST', '/api/save', { name: '' }, r.j.code);
  await call(cards, '/api/cards/pair', 'POST', { stop: true });
  await sleep(50);
  om.server.close();
});
