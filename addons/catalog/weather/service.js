// The weather add-on: the service part of the forecast card (cards/forecast/). The card asks for its data every minute
// (cards.feed); the weather comes from Open-Meteo through weather.js, which asks for a place at most every 30 minutes and keeps the last answer.
// The answer has what the card shows (now, the next days, translated words) and wx, the weather as the launcher's drawer draws it (OK on
// the card opens it: Now, Hours and Days in a panel of the launcher). The words of the card are translated here, in the language of the
// screens, so the page in its closed frame needs no translation.
const path = require('path');
const wx = require('./weather');

function create(ctx) {
  const i18n = ctx.util.i18n;
  ctx.util.mkdirp(ctx.dataDir);
  const w = wx.create({ path: path.join(ctx.dataDir, 'weather.json'), fetch: ctx.fetch });
  const T = s => i18n.tr(i18n.lang(null, ctx.env.lang()), s);

  // WMO weather codes as Open-Meteo gives them: an icon (the page draws it) and a word
  function kind(code, day) {
    if (code === 0) return [day === false ? 'moon' : 'sun', 'Clear'];
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
  // the buttons of the card (open, settings) are the launcher's own: nothing reaches the add-on
  function action() {
    return { error: 'no such action' };
  }
  return { cards: { feed, action }, handle: (q, r) => r.end('{}') };
}

module.exports = { create };
