// The weather add-on: the service part of the forecast card (cards/forecast/). The card asks for its data every minute
// (cards.feed); the weather comes from Open-Meteo through weather.js, which asks for a place at most every 30 minutes and keeps the last answer.
// The answer has what the card shows (now, the next days, translated words) and wx, the weather as the drawer page of the add-on draws it
// (cards/forecast/drawer.html: Now, Hours and Days in the sheet of the launcher). The words of both pages are translated here, in the
// language of the screens (labels), so the pages in their closed frames need no translation. The city search of the launcher's settings
// panel is cards.places.
const path = require('path');
const wx = require('./weather');

function create(ctx) {
  const i18n = ctx.util.i18n;
  ctx.util.mkdirp(ctx.dataDir);
  const w = wx.create({ path: path.join(ctx.dataDir, 'weather.json'), fetch: ctx.fetch });
  const T = s => i18n.tr(i18n.lang(null, ctx.env.lang()), s);

  // WMO weather codes as Open-Meteo gives them: an icon (the page draws it) and a word
  function kind(code, day) {
    if (code === 0) return [day === false ? 'moon' : 'sun', 'Clear sky'];
    if (code <= 2) return ['part', 'Partly cloudy'];
    if (code === 3) return ['cloud', 'Cloudy'];
    if (code === 45 || code === 48) return ['fog', 'Fog'];
    if (code >= 51 && code <= 57) return ['rain', 'Drizzle'];
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', 'Rain'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', 'Snow'];
    if (code >= 95) return ['storm', 'Thunderstorm'];
    return ['cloud', 'Cloudy'];
  }
  const icon = (code, day) => kind(code, day)[0];
  const LABELS = [
    'Feels like',
    'Now',
    'High',
    'Low',
    'Humidity',
    'Wind',
    'Rain chance',
    'UV index',
    'Pressure',
    'Air quality',
    'Sunrise',
    'Sunset',
    'Choose a city',
    'Select to set it on the TV',
    // the drawer page
    'Weather',
    'Close',
    'Hours',
    'Days',
    'Today',
    'now',
    'Low',
    'Moderate',
    'Very high',
    'Extreme',
    'Good',
    'Fair',
    'Poor',
    'Very poor',
    'Extremely poor',
    'North',
    'North-east',
    'East',
    'South-east',
    'South',
    'South-west',
    'West',
    'North-west',
    'Rain likely from %s',
    'No rain expected in the next 24 hours',
    'Peak %s',
    'Warmer than it is',
    'Cooler than it is',
    'As it is',
    '%s of daylight',
    'Weather data by Open-Meteo.com',
    'Offline, data from %s',
    'Feels like %s',
    'Clear sky',
    'Partly cloudy',
    'Cloudy',
    'Fog',
    'Drizzle',
    'Rain',
    'Snow',
    'Thunderstorm',
  ];

  async function feed(id, opt) {
    const labels = {};
    LABELS.forEach(l => (labels[l] = T(l)));
    const lat = parseFloat(opt.lat),
      lon = parseFloat(opt.lon);
    if (!isFinite(lat) || !isFinite(lon)) return { empty: true, labels };
    const r = await w.get(lat, lon, opt.unit);
    if (r.error) return { error: T(r.error), labels };
    const d = r.detail || {},
      week = d.week || [];
    return {
      labels,
      unit: r.unit,
      at: r.at,
      city: String(opt.place || '').slice(0, 60),
      now: {
        temp: r.now.temp,
        icon: icon(r.now.code, r.now.day),
        text: T(kind(r.now.code, r.now.day)[1]),
        feels: d.feels,
        humidity: d.humidity,
        wind: d.wind,
        rain: week[0] ? week[0].rain : null,
        uv: d.uv,
        pressure: d.pressure,
        air: d.air,
        sunrise: week[0] ? week[0].sunrise : '',
        sunset: week[0] ? week[0].sunset : '',
      },
      hours: (d.hours || []).slice(0, 6).map(x => ({ t: x.t, icon: icon(x.code, x.day), temp: x.temp, rain: x.rain })),
      days: week.map(x => ({ date: x.date, icon: icon(x.code, true), max: x.max, min: x.min, rain: x.rain })),
      wx: { now: r.now, unit: r.unit, at: r.at, detail: r.detail },
    };
  }
  // the buttons of the card (open: the drawer, settings: the launcher's panel) are the launcher's own: nothing reaches the add-on
  function action() {
    return { error: 'no such action' };
  }
  // the city search of the settings panel: {places: [{name, area, lat, lon}]}
  async function places(q, lang) {
    try {
      return { places: await w.search(q, lang) };
    } catch (e) {
      return { error: 'City search is not available now.' };
    }
  }
  // ---- the tool for the voice assistant and MCP clients ("provides": ["tools"]): the drawer's forecast, one tool with an action ----
  const TOOL = {
    name: 'weather',
    description:
      'A detailed forecast (Open-Meteo). action forecast: now (feels like, humidity, wind, UV, air quality, sunrise, sunset), the next hours and the next days, for a place by name; find_place: the places with that name.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['forecast', 'find_place'] },
        place: { type: 'string', description: 'a city, such as Haifa' },
        unit: { type: 'string', enum: ['c', 'f'] },
        days: { type: 'number', description: 'for forecast: how many days, 1 to 7 (3 if not given)' },
      },
      required: ['action', 'place'],
    },
    group: 'Weather forecast', // the manager's Tools screen
    labels: { forecast: 'A detailed forecast', find_place: 'Find a place' },
  };
  const done = v => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }], isError: false });
  const bad = m => ({ content: [{ type: 'text', text: String(m) }], isError: true });
  const word = (code, day) => kind(code, day)[1].toLowerCase();
  async function callTool(name, args) {
    if (name !== 'weather') return bad('unknown tool: ' + name);
    const x = args && typeof args === 'object' ? args : {};
    const place = String(x.place || '').trim();
    if (place.length < 2) return bad('say a place');
    let hits;
    try {
      hits = await w.search(place, 'en');
    } catch (e) {
      return bad('the place search is not available now');
    }
    if (x.action === 'find_place') return done(hits.map(p => ({ name: p.name, area: p.area, lat: p.lat, lon: p.lon })));
    if (x.action !== 'forecast') return bad('action is forecast or find_place');
    if (!hits.length) return bad('no place called ' + place.slice(0, 60));
    const p = hits[0],
      unit = x.unit === 'f' ? 'f' : 'c',
      deg = unit === 'f' ? '\u00b0F' : '\u00b0C';
    const r = await w.get(p.lat, p.lon, unit);
    if (r.error) return bad(r.error);
    const d = r.detail || {},
      week = d.week || [],
      n = Math.max(1, Math.min(7, Math.round(+x.days) || 3));
    const t = v => (typeof v === 'number' ? v + deg : null);
    return done({
      place: p.name + (p.area ? ', ' + p.area : ''),
      now: {
        temp: t(r.now.temp),
        sky: word(r.now.code, r.now.day),
        feels: t(d.feels),
        humidity: typeof d.humidity === 'number' ? d.humidity + '%' : null,
        wind: typeof d.wind === 'number' ? d.wind + (unit === 'f' ? ' mph' : ' km/h') : null, // Fahrenheit asks for mph
        uv: d.uv,
        airQuality: d.air && typeof d.air.aqi === 'number' ? d.air.aqi + ' (European AQI)' : null,
        sunrise: week[0] ? week[0].sunrise : '',
        sunset: week[0] ? week[0].sunset : '',
      },
      hours: (d.hours || []).slice(0, 6).map(h => ({ time: h.t, temp: t(h.temp), sky: word(h.code, h.day), rain: h.rain + '%' })),
      days: week.slice(0, n).map(x2 => ({ date: x2.date, sky: word(x2.code, true), max: t(x2.max), min: t(x2.min), rain: x2.rain + '%' })),
    });
  }
  return { cards: { feed, action, places }, tools: { list: () => [TOOL], call: callTool }, handle: (q, r) => r.end('{}') };
}

module.exports = { create };
