// Home Assistant for the cards (cards.js): the states of entities, a toggle, and a camera's picture. It uses the address and the
// long-lived access token already set for Voice (config voice.ha, typed on the voice phone page), so nothing new is stored. The states
// come from one /api/states request that is kept 20 seconds, however many cards ask.
//   create({config}) -> { ready(), states(ids) -> [{id, name, state, unit, domain, on}], toggle(id), camera(id) -> {type, body},
//                         entities() -> [{id, name}] for the phone page, weather(id, temp, kind) -> {now, kind, list, at} }
const fetch = require('./fetch');
const answers = require('./answers');
// what OK on a card may switch: things that are on or off, and scenes and scripts that run. Not locks, alarms or covers.
const TOGGLE = ['light', 'switch', 'fan', 'input_boolean', 'automation'],
  RUN = ['scene', 'script'],
  ID = /^[a-z_]+\.[\w]{1,120}$/;

function create(opts) {
  const config = opts.config;
  const ha = () => Object.assign({}, answers.HA_DEFAULTS, (config.get().voice || {}).ha || {});
  const ready = () => answers.haReady(ha());
  function call(path, method, payload, max) {
    const h = ha();
    return fetch
      .read(h.url + path, {
        method: method || 'GET',
        headers: { authorization: 'Bearer ' + h.token, 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        totalMs: 15000,
        redirects: 0,
        anyStatus: true,
        maxBytes: max || 4 << 20,
        insecure: !!(h.selfSigned && /^https:/.test(h.url)),
      })
      .then(r => {
        if (r.status === 401 || r.status === 403) throw new Error('Home Assistant refused the access token');
        if (r.status < 200 || r.status >= 300) throw new Error('Home Assistant answered ' + r.status);
        return r;
      });
  }
  let all = null; // { at, list }
  async function list() {
    if (all && Date.now() - all.at < 20000) return all.list;
    const r = await call('/api/states');
    let l = [];
    try {
      l = JSON.parse(r.body.toString('utf8'));
    } catch (_) {
      throw new Error('Home Assistant did not answer with JSON');
    }
    all = { at: Date.now(), list: Array.isArray(l) ? l : [] };
    return all.list;
  }
  const short = e => {
    const id = String(e.entity_id || ''),
      a = e.attributes || {},
      domain = id.split('.')[0];
    return {
      id,
      name: String(a.friendly_name || id).slice(0, 60),
      state: String(e.state === undefined ? '' : e.state).slice(0, 60),
      unit: String(a.unit_of_measurement || '').slice(0, 12),
      domain,
      can: TOGGLE.indexOf(domain) >= 0 || RUN.indexOf(domain) >= 0,
    };
  };
  async function states(ids) {
    if (!ready()) return { error: 'Home Assistant is not set up' };
    const want = (Array.isArray(ids) ? ids : []).filter(i => typeof i === 'string' && ID.test(i)).slice(0, 96);
    try {
      const by = {};
      for (const e of await list()) by[e.entity_id] = e;
      return {
        states: want.map(id =>
          by[id] ? short(by[id]) : { id, name: id, state: 'unavailable', unit: '', domain: id.split('.')[0], can: false }
        ),
      };
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }
  async function toggle(id) {
    if (!ready()) return { error: 'Home Assistant is not set up' };
    if (typeof id !== 'string' || !ID.test(id)) return { error: 'bad entity' };
    const domain = id.split('.')[0];
    const svc = TOGGLE.indexOf(domain) >= 0 ? domain + '/toggle' : RUN.indexOf(domain) >= 0 ? domain + '/turn_on' : '';
    if (!svc) return { error: 'this entity cannot be switched from the TV' };
    try {
      await call('/api/services/' + svc, 'POST', { entity_id: id }, 1 << 20);
      all = null; // the next states show the change
      return { ok: true };
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }
  async function camera(id) {
    if (!ready() || typeof id !== 'string' || !/^camera\.[\w]{1,120}$/.test(id)) return null;
    try {
      const r = await call('/api/camera_proxy/' + id, 'GET', undefined, 4 << 20);
      const type = String(r.headers['content-type'] || 'image/jpeg');
      return /^image\//.test(type) ? { type, body: r.body } : null;
    } catch (_) {
      return null;
    }
  }
  // ---- the weather card (ha-weather): a weather entity's condition and the forecast, and optionally a sensor for the temperature
  // outside. The forecast comes from weather.get_forecasts (Home Assistant 2023.9 and newer), kept 15 minutes per entity and kind;
  // an older Home Assistant that still has the forecast attribute is read from there.
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0) : null);
  const FC_KINDS = ['daily', 'hourly', 'twice_daily'];
  let fcCache = {};
  async function forecast(id, kind, attr) {
    const k = id + '|' + kind,
      c = fcCache[k];
    if (c && Date.now() - c.at < 900000) return c.list;
    let list = null;
    try {
      const r = await call('/api/services/weather/get_forecasts?return_response', 'POST', { entity_id: id, type: kind }, 1 << 20);
      const j = JSON.parse(r.body.toString('utf8'));
      const resp = j && j.service_response ? j.service_response : j;
      if (resp && resp[id] && Array.isArray(resp[id].forecast)) list = resp[id].forecast;
    } catch (_) {}
    if (!list && Array.isArray(attr)) list = attr; // Home Assistant before 2024.3
    list = (list || []).slice(0, 8).map(f => ({
      t: String(f.datetime || '').slice(0, 30),
      cond: String(f.condition || '').slice(0, 30),
      hi: num(f.temperature),
      lo: num(f.templow),
      rain: num(f.precipitation_probability),
    }));
    if (Object.keys(fcCache).length > 20) fcCache = {};
    fcCache[k] = { at: Date.now(), list };
    return list;
  }
  async function weather(id, temp, kind) {
    if (!ready()) return { error: 'Home Assistant is not set up' };
    if (typeof id !== 'string' || !/^weather\.[\w]{1,120}$/.test(id)) return { error: 'Choose a weather entity from your phone' };
    if (typeof temp !== 'string' || !ID.test(temp)) temp = '';
    if (FC_KINDS.indexOf(kind) < 0 && kind !== 'none') kind = 'daily';
    try {
      const by = {};
      for (const e of await list()) by[e.entity_id] = e;
      const w = by[id];
      if (!w) return { error: 'not available' };
      const a = w.attributes || {},
        s = temp && by[temp],
        sTemp = s ? parseFloat(s.state) : NaN;
      const out = {
        now: {
          cond: String(w.state || '').slice(0, 30),
          temp: isFinite(sTemp) ? Math.round(sTemp * 10) / 10 : num(a.temperature),
          unit: String((s && isFinite(sTemp) && (s.attributes || {}).unit_of_measurement) || a.temperature_unit || '°C').slice(0, 6),
          hum: num(a.humidity),
          wind: num(a.wind_speed),
          windUnit: String(a.wind_speed_unit || '').slice(0, 8),
          name: String(a.friendly_name || id).slice(0, 60),
        },
        kind,
        list: kind === 'none' ? [] : await forecast(id, kind, a.forecast),
        at: Date.now(),
      };
      return out;
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }
  async function entities() {
    if (!ready()) return [];
    return (await list())
      .map(short)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 2000)
      .map(e => ({ id: e.id, name: e.name }));
  }
  // the entities for the launcher's Home Assistant menu: id, name, domain and unit, of the given domains (all when none), at most 600
  async function pick(domains) {
    if (!ready()) return { error: 'Home Assistant is not set up' };
    const want = (Array.isArray(domains) ? domains : []).filter(d => typeof d === 'string' && /^[a-z_]{1,40}$/.test(d)).slice(0, 20);
    try {
      return {
        entities: (await list())
          .map(short)
          .filter(e => !want.length || want.indexOf(e.domain) >= 0)
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 600)
          .map(e => ({ id: e.id, name: e.name, domain: e.domain, unit: e.unit })),
      };
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }
  return { ready, states, toggle, camera, entities, weather, pick };
}

module.exports = { create, TOGGLE, RUN };
