// Cards (cards.js): the phone page opens with a code, lists the theme's slots and the card types with their options, saves the cards
// (checked for shape) where the launcher reads them, and the launcher page draws the greeting and a text card.
const http = require('http');
const { ok, call, sleep, serve, req, memoryConfig, run } = require('./lib');

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
  let asked = 0,
    airAsked = 0,
    lastQuery = '';
  const om = await serve((rq, rs) => {
    rs.writeHead(200, { 'content-type': 'application/json' });
    if (/\/search/.test(rq.url))
      return rs.end(
        JSON.stringify({ results: [{ name: 'Utrecht', admin1: 'Utrecht', country: 'Nederland', latitude: 52.0908, longitude: 5.1222 }] })
      );
    if (/\/air/.test(rq.url)) {
      airAsked++;
      return rs.end(JSON.stringify({ current: { european_aqi: 31.4, pm2_5: 7.26, pm10: 12.04 } }));
    }
    asked++;
    lastQuery = rq.url;
    rs.end(
      JSON.stringify({
        utc_offset_seconds: 3600,
        current: {
          temperature_2m: 11.6,
          weather_code: 3,
          is_day: 1,
          apparent_temperature: 9.4,
          relative_humidity_2m: 71,
          wind_speed_10m: 14.2,
          wind_direction_10m: 315,
          surface_pressure: 1015.6,
          uv_index: 2.34,
        },
        hourly: {
          time: ['2026-10-27T14:00', '2026-10-27T15:00', 'nonsense'],
          temperature_2m: [11.6, 12.2, 12],
          weather_code: [3, 61, 3],
          precipitation_probability: [10, 65, 0],
          wind_speed_10m: [14.2, 18, 10],
          is_day: [1, 1, 0],
        },
        daily: {
          time: ['2026-10-27', '2026-10-28'],
          weather_code: [3, 61],
          temperature_2m_max: [13.2, 12],
          temperature_2m_min: [7.9, 6.1],
          precipitation_probability_max: [65, 40],
          sunrise: ['2026-10-27T07:40', '2026-10-28T07:41'],
          sunset: ['2026-10-27T17:12', '2026-10-28T17:10'],
        },
      })
    );
  });
  process.env.CYTV_WEATHER_URL = om.url + '/v1/forecast';
  process.env.CYTV_GEO_URL = om.url + '/v1/search';
  process.env.CYTV_AIR_URL = om.url + '/v1/air';
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
    p.j.slots.length === 4 &&
      p.j.slots[0].name === 'Boven de klok' &&
      p.j.slots[2].name === 'odd-one' &&
      p.j.cards.greeting.name === 'Sam' &&
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
  // the manager's Cards screen: the places and a card type for one of them
  r = await call(cards, '/api/cards/status', 'POST', {});
  ok(r.j.slots.length === 4 && r.j.types.some(t => t.type === 'ha-camera'), 'the manager gets the places and the card types');
  // under the clock: a built-in place every theme has, for any card the others take
  const wl = r.j.slots[3];
  ok(
    wl.id === 'under-clock' && wl.card === 'none' && wl.name === 'Onder de klok',
    'every theme also has a place under the clock (named in the language)'
  );
  for (const ty of ['weather', 'ha-camera', 'template', 'greeting']) {
    r = await call(cards, '/api/cards/set', 'POST', { slot: 'under-clock', type: ty });
    if (!(r.j.ok && config.get().cards['under-clock'].type === ty)) ok(false, 'the place under the clock takes a ' + ty + ' card');
  }
  ok(true, 'the place under the clock takes any kind of card');
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
  // what the phone page and the launcher may save for a weather card is checked: text trimmed, coordinates in range and in pairs, units
  p = await phone(
    'POST',
    '/api/save',
    {
      cards: {
        'under-clock': {
          type: 'weather',
          place: '  Utrecht' + String.fromCharCode(10) + '<b>x</b> ' + 'y'.repeat(80),
          lat: 52.0912,
          lon: 5.1234,
          unit: 'k',
          show: 'days',
          extra: 1,
        },
        side: { type: 'weather', place: 'Nowhere', lat: 91, lon: 5 },
        row: { type: 'weather', lat: 10, unit: 'f' },
      },
    },
    code
  );
  const sv = config.get().cards;
  ok(
    sv['under-clock'].type === 'weather' &&
      sv['under-clock'].place.length === 40 &&
      !/[<>]/.test(sv['under-clock'].place) &&
      sv['under-clock'].place.indexOf(String.fromCharCode(10)) < 0 &&
      sv['under-clock'].lat === 52.09 &&
      sv['under-clock'].lon === 5.12 &&
      sv['under-clock'].unit === undefined &&
      sv['under-clock'].show === 'days' &&
      sv['under-clock'].extra === undefined,
    'a weather card keeps a short place name, rounded coordinates, a known unit and show; other options are dropped'
  );
  ok(
    sv.side.place === 'Nowhere' &&
      sv.side.lat === undefined &&
      sv.side.lon === undefined &&
      sv.row.lat === undefined &&
      sv.row.unit === 'f',
    'coordinates out of range, or without their pair, are dropped'
  );
  await phone('POST', '/api/save', { cards: { 'under-clock': { type: 'template', text: 'x' } } }, code);
  ok(
    config.get().cards['under-clock'].type === 'template' && config.get().cards['under-clock'].text === 'x',
    'a text card can be saved for the place under the clock'
  );
  await phone('POST', '/api/save', { cards: {} }, code);
  p = await phone('POST', '/api/places', { q: 'Utrecht' }, code);
  ok(
    p.j.places.length === 1 && p.j.places[0].lat === 52.09 && p.j.places[0].area === 'Utrecht, Nederland',
    'the phone page finds a place by name'
  );
  // the launcher's own search (Customise > Weather > Place, typed on the TV): the same places, and no search for less than two letters
  r = await call(cards, '/api/cards/places', 'POST', { q: 'Utrecht' });
  const r1 = await call(cards, '/api/cards/places', 'POST', { q: 'U' });
  ok(
    r.j.places.length === 1 && r.j.places[0].lat === 52.09 && r.j.places[0].name === 'Utrecht' && r1.j.places.length === 0,
    'the launcher searches a place by name through the service'
  );
  r = await call(cards, '/api/cards/weather', 'POST', { lat: 52.09, lon: 5.12 });
  const r2 = await call(cards, '/api/cards/weather', 'POST', { lat: 52.09, lon: 5.12 });
  ok(
    r.j.now.temp === 12 && r.j.now.code === 3 && r.j.days.length === 2 && r.j.days[1].max === 12 && r2.j.at === r.j.at && asked === 1,
    'the weather of a place is asked once and then kept (at most every 30 minutes)'
  );
  // what the weather drawer shows: asked for in the same request, and kept with the rest
  const dt = r.j.detail;
  ok(
    /hourly=/.test(lastQuery) && /forecast_days=7/.test(lastQuery) && !/wind_speed_unit/.test(lastQuery) && airAsked === 1,
    'one forecast request with the hours and the week, and one for the air quality'
  );
  ok(
    dt.feels === 9 && dt.humidity === 71 && dt.wind === 14 && dt.dir === 315 && dt.pressure === 1016 && dt.uv === 2.3 && dt.offset === 3600,
    'the drawer gets what it feels like, humidity, wind, pressure, UV and the time zone'
  );
  ok(
    dt.hours.length === 3 &&
      dt.hours[1].temp === 12 &&
      dt.hours[1].rain === 65 &&
      dt.hours[0].t === '2026-10-27T14:00' &&
      dt.hours[2].t === '' &&
      dt.hours[2].day === false &&
      dt.week.length === 2 &&
      dt.week[0].rain === 65 &&
      dt.week[0].sunset === '2026-10-27T17:12',
    'the hours, and the days with their rain chance, sunrise and sunset, read as the place writes them'
  );
  ok(dt.air.aqi === 31 && dt.air.pm25 === 7.3 && dt.air.pm10 === 12, 'the air quality comes with the weather');
  ok(r.j.days.length === 2 && r.j.days[0].max === 13, 'the card keeps its own days');
  r = await call(cards, '/api/cards/weather', 'POST', { lat: 52.09, lon: 5.12, unit: 'f' });
  ok(/temperature_unit=fahrenheit/.test(lastQuery) && /wind_speed_unit=mph/.test(lastQuery), 'in Fahrenheit the wind is in miles an hour');
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
  // the report people attach to issues does not say where the TV is: the weather place and its coordinates are masked
  const red = require('../../helper/sharelog').redact(
    JSON.stringify({ cards: { 'under-clock': { type: 'weather', place: 'Utrecht', lat: 52.09, lon: -5.12, unit: 'f' } } })
  );
  ok(
    !/Utrecht|52\.09|5\.12/.test(red) && /"unit":"f"/.test(red) && /"type":"weather"/.test(red),
    'Share log masks the weather place and its coordinates'
  );
  om.server.close();
});
