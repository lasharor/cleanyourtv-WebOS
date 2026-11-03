// The weather add-on (addons/catalog/weather): the forecast card's data from a stand-in for Open-Meteo (now, hours, days, air quality),
// the answer kept for 30 minutes, a failing service, the detail for the launcher's drawer (Now, Hours, Days),
// the words in the language of the screens, and the card as the service offers it (a card type with a page, data and two actions).
const fs = require('fs'),
  path = require('path');
const { root, ok, serve, req, run, tmp } = require('./lib');

run(async () => {
  process.env.CYTV_ADDONS = path.join(tmp, 'addons');
  process.env.CYTV_ADDON_DATA = path.join(tmp, 'addon-data');
  process.env.CYTV_ADDONS_BUNDLED = path.join(tmp, 'bundled');
  const nc = req('netcompat');

  // ---- a stand-in for Open-Meteo ----
  let asked = 0,
    fail = false,
    lastUrl = '';
  const hours = [],
    time = [];
  for (let i = 0; i < 24; i++) hours.push('2026-11-03T' + (i < 10 ? '0' : '') + i + ':00');
  for (let i = 0; i < 7; i++) time.push('2026-11-0' + (3 + i));
  const forecast = {
    utc_offset_seconds: 3600,
    current: {
      temperature_2m: 14.4,
      weather_code: 3,
      is_day: 1,
      apparent_temperature: 12.2,
      relative_humidity_2m: 71,
      wind_speed_10m: 18.6,
      wind_direction_10m: 200,
      surface_pressure: 1008.4,
      uv_index: 2.34,
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 10 + i),
      weather_code: hours.map(() => 61),
      precipitation_probability: hours.map(() => 40),
      wind_speed_10m: hours.map(() => 10),
      is_day: hours.map(() => 1),
    },
    daily: {
      time,
      weather_code: time.map(() => 0),
      temperature_2m_max: time.map((_, i) => 15 + i),
      temperature_2m_min: time.map((_, i) => 5 + i),
      precipitation_probability_max: time.map(() => 20),
      sunrise: time.map(d => d + 'T06:41'),
      sunset: time.map(d => d + 'T16:52'),
    },
  };
  const om = await serve((q, res) => {
    lastUrl = q.url;
    asked++;
    if (fail) {
      res.writeHead(500);
      return res.end('{}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(forecast));
  });
  process.env.CYTV_WEATHER_URL = om.url;

  const addonDir = path.join(root, 'addons', 'catalog', 'weather');
  const M = require(path.join(addonDir, 'service.js'));
  let lang = '';
  const dataDir = path.join(process.env.CYTV_DIR, 'addon-data', 'weather');
  const ctx = {
    id: 'weather',
    dir: addonDir,
    dataDir,
    log: () => {},
    fetch: req('fetch'),
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => lang, wallpaperSize: () => '4k' },
    settings: { get: () => ({}), set: () => {} },
  };
  const w = M.create(ctx);
  const opt = { place: 'Amsterdam', lat: '52.37', lon: '4.9', unit: 'c' };

  let d = await w.cards.feed('forecast', {});
  ok(
    d.empty === true && d.labels['Choose a city'] && d.labels['Select to set it on the TV'],
    'with no city chosen the card is told so, and asks nobody'
  );
  d = await w.cards.feed('forecast', opt);
  ok(
    d.now.temp === 14 &&
      d.now.icon === 'cloud' &&
      d.now.text === 'Cloudy' &&
      d.now.feels === 12 &&
      d.now.humidity === 71 &&
      d.now.wind === 19 &&
      d.now.uv === 2.3 &&
      d.now.pressure === 1008,
    'now: temperature, icon and word, feels like, humidity, wind, UV and pressure: ' + JSON.stringify(d.now)
  );
  ok(
    d.now.rain === 20 && d.now.sunrise === '2026-11-03T06:41' && d.now.sunset === '2026-11-03T16:52' && d.now.air === null,
    "today's rain chance, sunrise and sunset are given; no air quality service in the stand-in"
  );
  ok(
    d.wx && d.wx.detail && d.wx.detail.hours.length === 24 && d.wx.detail.hours[3].temp === 13 && d.wx.detail.week.length === 7,
    'the detail for the drawer: 24 hours and 7 days'
  );
  ok(
    d.hours.length === 6 && d.hours[0].icon && typeof d.hours[1].temp === 'number' && d.labels.Now === 'Now',
    'the feed gives the next six hours for the Rich look'
  );
  ok(
    d.days.length === 7 && d.days[1].max === 16 && d.days[1].min === 6 && d.days[0].icon === 'sun',
    'seven days with the highest and lowest'
  );
  ok(
    d.unit === 'c' && d.city === 'Amsterdam' && d.labels.Humidity === 'Humidity' && d.wx.unit === 'c',
    'the unit, the city and the labels'
  );
  ok(
    /latitude=52\.37&longitude=4\.9/.test(lastUrl) && !/fahrenheit/.test(lastUrl),
    'only the coordinates of the city are sent (to 0.01 degree)'
  );
  const before = asked;
  await w.cards.feed('forecast', opt);
  ok(asked === before, 'a second answer within 30 minutes asks nobody');
  d = await w.cards.feed('forecast', Object.assign({}, opt, { unit: 'f' }));
  ok(/temperature_unit=fahrenheit&wind_speed_unit=mph/.test(lastUrl) && d.unit === 'f', 'Fahrenheit asks for mph too');

  // ---- the actions: the card has none of its own (the launcher opens the drawer and the settings) ----
  ok((await w.cards.action('forecast', opt, 'hours')).error === 'no such action', 'the service has no actions to run');

  // ---- the words ----
  lang = 'nl';
  d = await w.cards.feed('forecast', opt);
  ok(d.now.text === 'Bewolkt' && d.labels.Humidity === 'Vochtigheid', 'the words are in the language of the screens: ' + d.now.text);
  lang = '';

  // ---- when Open-Meteo is not there ----
  fail = true;
  d = await w.cards.feed('forecast', { place: 'Oslo', lat: '59.9', lon: '10.7', unit: 'c' });
  ok(d.error && !d.now, 'a place that cannot be asked says so');
  d = await w.cards.feed('forecast', opt);
  ok(d.now && d.now.temp === 14, 'a place that was asked before keeps its last answer while the service is away');
  fail = false;
  om.server.close();

  // ---- the card as the service offers it ----
  const addons = req('addons');
  const man = JSON.parse(fs.readFileSync(path.join(addonDir, 'addon.json'), 'utf8'));
  const chk = addons.check(man, '1.6.17');
  ok(
    chk.manifest && chk.manifest.provides.join() === 'cards' && chk.manifest.permissions.join() === 'net.fetch',
    'the manifest is accepted and asks for the network only'
  );
  ok(addons.check(man, '1.6.16').error, 'it needs the service that has cards for add-ons');
  const c = chk.manifest.cards[0];
  ok(
    c.id === 'forecast' && c.page === 'card.html' && c.poll === 60 && c.actions.map(a => a.name).join() === 'open,settings',
    'one card with a page, a poll, the button that opens the drawer and the one that opens the settings on the TV'
  );
  const lk = (c.options || []).filter(o => o.key === 'look')[0];
  ok(lk && lk.default === 'minimal' && lk.choices.map(x => x[0]).join() === 'minimal,rich', 'Look is Minimal (the default) or Rich');
  for (const f of ['card.html', 'card.js', 'card.css']) ok(fs.existsSync(path.join(addonDir, 'cards', 'forecast', f)), f + ' is there');
  const page = fs.readFileSync(path.join(addonDir, 'cards', 'forecast', 'card.js'), 'utf8');
  ok(!/XMLHttpRequest|fetch\(|WebSocket|new Image|=>|\bconst\b|\blet\b/.test(page), 'the page is ES5 and makes no request');
  ok(
    /fullButton\('open'/.test(page) && !/name: '(now|hours|days)'|getElementById\('tabs'\)/.test(page),
    'the whole card is one button that opens the drawer, with no tabs'
  );
  ok(
    /fullButton\('settings'/.test(page) && /Select to set it on the TV/.test(page),
    'with no city the whole card is one button to the settings'
  );
});
