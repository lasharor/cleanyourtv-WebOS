// Weather for the weather card (cards.js), from Open-Meteo: free, no key, no account. The service asks for a place's weather at most
// every 30 minutes and keeps the last answer in weather.json, so Home shows it at once and while the internet is away. Only the
// coordinates of the chosen place leave the TV; the place is searched by name on the phone page (search).
//   create({path}) -> { get(lat, lon, unit) -> {now, days, detail, at} | {error}, search(name, lang) -> [{name, area, lat, lon}] }
// detail is for the weather drawer on Home: feels-like, humidity, wind, pressure, UV, 24 hours, 7 days with sunrise and sunset, and the
// air quality (a second request, to Open-Meteo's air quality service, which may fail without the weather failing).
const fs = require('fs');
const fetch = require('./fetch');
const FORECAST = process.env.CYTV_WEATHER_URL || 'https://api.open-meteo.com/v1/forecast',
  GEO = process.env.CYTV_GEO_URL || 'https://geocoding-api.open-meteo.com/v1/search',
  // the air quality: off when the forecast is a stand-in and the air quality is not (tests, no real network)
  AIR = process.env.CYTV_AIR_URL || (process.env.CYTV_WEATHER_URL ? '' : 'https://air-quality-api.open-meteo.com/v1/air-quality'),
  EVERY = 30 * 60 * 1000,
  OLD = 24 * 3600 * 1000; // older than a day is not shown

const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
const r1 = n => Math.round(n * 100) / 100;
const whole = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
const dec = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null);
// a time at the place as Open-Meteo writes it, 2026-10-31T19:48 (no zone): kept to the minute, '' when it is not one
const local = s => (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(String(s)) ? String(s).slice(0, 16) : '');
function read(url) {
  return fetch
    .read(url, {
      headers: { 'User-Agent': 'cleanyourtv-weather' },
      maxBytes: 256 * 1024,
      totalMs: 15000,
      allowHttp: () => !!(process.env.CYTV_WEATHER_URL || process.env.CYTV_GEO_URL || process.env.CYTV_AIR_URL),
    })
    .then(r => JSON.parse(r.body.toString('utf8')));
}

function create(opts) {
  const file = opts.path;
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (_) {}
  const busy = {};
  const keep = () => {
    try {
      // only recent places stay in the file
      for (const k of Object.keys(cache)) if (Date.now() - cache[k].at > OLD) delete cache[k];
      fs.writeFileSync(file + '.tmp', JSON.stringify(cache));
      fs.renameSync(file + '.tmp', file);
    } catch (_) {}
  };
  // the air quality of a place (the European index and the fine dust), which is nice to have: null when it is not there or the
  // service is not reachable
  async function airNow(lat, lon) {
    if (!AIR) return null;
    try {
      const c =
        (await read(AIR + '?latitude=' + lat + '&longitude=' + lon + '&current=european_aqi,pm10,pm2_5&timezone=auto')).current || {};
      if (typeof c.european_aqi !== 'number') return null;
      return { aqi: Math.round(c.european_aqi), pm25: dec(c.pm2_5), pm10: dec(c.pm10) };
    } catch (_) {
      return null;
    }
  }
  async function fetchNow(lat, lon, unit) {
    const q =
      '?latitude=' +
      lat +
      '&longitude=' +
      lon +
      '&current=temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,' +
      'surface_pressure,uv_index' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m,is_day&forecast_hours=24' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
      '&timezone=auto&forecast_days=7' +
      (unit === 'f' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '');
    const both = await Promise.all([read(FORECAST + q), airNow(lat, lon)]),
      j = both[0];
    const c = j.current || {},
      d = j.daily || {},
      h = j.hourly || {};
    if (typeof c.temperature_2m !== 'number') throw new Error('no weather for this place');
    const at = (a, i) => (Array.isArray(a) ? a[i] : undefined);
    return {
      at: Date.now(),
      unit,
      now: { temp: Math.round(c.temperature_2m), code: c.weather_code | 0, day: c.is_day !== 0 },
      days: (d.time || []).slice(0, 4).map((t, i) => ({
        date: String(t).slice(0, 10),
        code: (d.weather_code || [])[i] | 0,
        max: Math.round((d.temperature_2m_max || [])[i]),
        min: Math.round((d.temperature_2m_min || [])[i]),
      })),
      // what the weather drawer shows (everything may be missing: null, '' or an empty list)
      detail: {
        feels: whole(c.apparent_temperature),
        humidity: whole(c.relative_humidity_2m),
        wind: whole(c.wind_speed_10m),
        dir: whole(c.wind_direction_10m),
        pressure: whole(c.surface_pressure),
        uv: dec(c.uv_index),
        offset: whole(j.utc_offset_seconds), // the place's time zone, to know when it is there
        hours: (h.time || []).slice(0, 24).map((t, i) => ({
          t: local(t),
          temp: whole(at(h.temperature_2m, i)),
          code: at(h.weather_code, i) | 0,
          rain: whole(at(h.precipitation_probability, i)),
          wind: whole(at(h.wind_speed_10m, i)),
          day: at(h.is_day, i) !== 0,
        })),
        week: (d.time || []).slice(0, 7).map((t, i) => ({
          date: String(t).slice(0, 10),
          code: at(d.weather_code, i) | 0,
          max: whole(at(d.temperature_2m_max, i)),
          min: whole(at(d.temperature_2m_min, i)),
          rain: whole(at(d.precipitation_probability_max, i)),
          sunrise: local(at(d.sunrise, i)),
          sunset: local(at(d.sunset, i)),
        })),
        air: both[1],
      },
    };
  }
  // the weather of a place: the kept answer when it is recent, else a new one (the kept one if that fails)
  async function get(lat, lon, unit) {
    if (!num(lat, -90, 90) || !num(lon, -180, 180)) return { error: 'no place chosen' };
    unit = unit === 'f' ? 'f' : 'c';
    const key = r1(lat) + ',' + r1(lon) + ',' + unit,
      had = cache[key];
    // (an answer kept by an earlier version has no detail for the drawer: asked again)
    if (had && had.detail && Date.now() - had.at < EVERY) return had;
    if (!busy[key])
      // (no .finally: Node 8 on webOS 5 and 6 does not have it)
      busy[key] = fetchNow(r1(lat), r1(lon), unit).then(
        w => {
          delete busy[key];
          cache[key] = w;
          keep();
          return w;
        },
        e => {
          delete busy[key];
          throw e;
        }
      );
    try {
      return await busy[key];
    } catch (e) {
      return had && Date.now() - had.at < OLD ? had : { error: String(e.message || e) };
    }
  }
  // places by name, for the phone page
  async function search(name, lang) {
    const n = String(name || '')
      .trim()
      .slice(0, 80);
    if (n.length < 2) return [];
    const j = await read(GEO + '?count=6&format=json&name=' + encodeURIComponent(n) + '&language=' + encodeURIComponent(lang || 'en'));
    return (j.results || [])
      .filter(p => num(p.latitude, -90, 90) && num(p.longitude, -180, 180))
      .map(p => ({
        name: String(p.name || '').slice(0, 60),
        area: [p.admin1, p.country].filter(Boolean).join(', ').slice(0, 80),
        lat: r1(p.latitude),
        lon: r1(p.longitude),
      }));
  }
  return { get, search };
}

module.exports = { create };
