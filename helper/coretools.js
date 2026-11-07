// The service's own abilities as tools for the voice assistant (answers.js, while llm.agent is on) and MCP clients: list, open and
// close apps, the inputs, what is on screen, Home and Live TV, the volume, the TV and its weather, a card on the screen, and turning
// the TV off. The same shape as an add-on that provides "tools": {list(), call(name, args, opts)}, in MCP form
// ({content: [{type: 'text', text}], isError}). Each tool runs the code the service's API already runs (apps.js, running.js,
// remap.js, audio.js, notify.js, the weather of cards.js); nothing here goes through HTTP. power_off is marked destructive:
// answers.js asks the person first, and it runs here only with {confirmed: true}.
const S = (props, req) => ({ type: 'object', properties: props || {}, required: req || [] });
const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];
const HOME = 'com.webos.app.home';
// the tools that change what is on screen: LG's screen saver is closed before them (see wake)
const ON_SCREEN = ['launch_app', 'switch_input', 'close_app', 'navigate', 'show_notification'];
// WMO weather codes as Open-Meteo gives them, in words (as the launcher's weather card names them)
function sky(code) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return 'cloudy';
}
const TOOLS = [
  {
    name: 'list_apps',
    description: 'List the apps installed on the TV (id and name), optionally only those whose name contains some words.',
    inputSchema: S({ query: { type: 'string', description: 'words of the app name, such as "youtube"' } }),
  },
  {
    name: 'launch_app',
    description: 'Open an installed app by its id (from list_apps).',
    inputSchema: S({ id: { type: 'string', description: 'the app id, such as youtube.leanback.v4' } }, ['id']),
  },
  {
    name: 'list_inputs',
    description: 'List the TV inputs (HDMI ports and Live TV) with their names and whether something is connected.',
    inputSchema: S(),
  },
  {
    name: 'switch_input',
    description: 'Switch the TV to an input, by its id (HDMI_1), its number (1 for HDMI 1) or its name (PlayStation).',
    inputSchema: S({ input: { type: 'string', description: 'HDMI_1, 1, or the name of the input' } }, ['input']),
  },
  {
    name: 'show_notification',
    description:
      'Show a short card on the TV screen: a title, a line of text, optionally a picture (an http or https address), how long it stays and where.',
    inputSchema: S(
      {
        title: { type: 'string' },
        text: { type: 'string' },
        image: { type: 'string', description: 'address of a picture (http or https)' },
        seconds: { type: 'number', description: 'how long it stays, 2 to 60 (10 if not given)' },
        position: { type: 'string', enum: POSITIONS, description: 'where on the screen (top-right if not given)' },
      },
      ['title']
    ),
  },
  {
    name: 'get_current_app',
    description: 'Say which app or input is on the screen now.',
    inputSchema: S(),
  },
  {
    name: 'list_running_apps',
    description: 'List the apps that are open (running) on the TV.',
    inputSchema: S(),
  },
  {
    name: 'close_app',
    description: 'Close one running app by its id (from list_running_apps).',
    inputSchema: S({ id: { type: 'string', description: 'the app id, such as netflix' } }, ['id']),
  },
  {
    name: 'navigate',
    description: "Go to the TV's Home screen, to the launcher's Live TV, or show the list of inputs.",
    inputSchema: S({ to: { type: 'string', enum: ['home', 'live_tv', 'input_list'] } }, ['to']),
  },
  {
    name: 'get_volume',
    description: 'Read the volume, whether the sound is muted, and where the sound goes (TV speakers, optical, HDMI ARC and so on).',
    inputSchema: S(),
  },
  {
    name: 'tv_info',
    description: 'The TV model, webOS version, CleanYourTV version, whether the screen is on, and whether an update is available.',
    inputSchema: S(),
  },
  {
    name: 'most_used_apps',
    description: 'List the apps used most on this TV, most used first.',
    inputSchema: S({ limit: { type: 'number', description: 'how many, 1 to 20 (5 if not given)' } }),
  },
  {
    name: 'get_weather',
    description:
      "The weather now and the next days for a place (by name). Without a place: the place of the weather card on the TV's Home.",
    inputSchema: S({
      place: { type: 'string', description: 'a city, such as Haifa' },
      unit: { type: 'string', enum: ['c', 'f'] },
    }),
  },
  {
    name: 'new_conversation',
    description: "Forget what was said to the TV's voice assistant so far, and start a new conversation.",
    inputSchema: S(),
  },
  {
    name: 'power_off',
    description: 'Turn the TV off completely.',
    inputSchema: S(),
    annotations: { destructiveHint: true },
  },
];

const done = v => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }], isError: false });
const fail = m => ({ content: [{ type: 'text', text: String(m) }], isError: true });
const words = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

function create(ctx) {
  const apps = () => ctx.feature && ctx.feature('apps');
  const notify = () => ctx.notify || (ctx.feature && ctx.feature('notify'));
  const feature = n => (ctx.feature && ctx.feature(n)) || null;
  const luna = (uri, params) => (ctx.luna ? ctx.luna(uri, params) : Promise.resolve({ returnValue: false, errorText: 'no luna' }));
  // app id -> name, from the launcher's app list
  async function titles() {
    const a = apps(),
      out = {};
    if (!a) return out;
    for (const p of (await a.listApps()) || []) if (p && p.id) out[p.id] = String(p.title || p.id);
    return out;
  }
  // LG's screen saver starts when nobody pressed a key for a while, and the Inputs list and cards open under it: every tool that
  // changes what is on screen closes it first (ON_SCREEN). Found by the wave 1 test on the TV.
  async function wake() {
    const pw = await luna('luna://com.webos.service.tvpower/power/getPowerState', {}).catch(() => null);
    if (pw && /saver/i.test(String(pw.state || '')))
      await luna('luna://com.webos.applicationManager/closeByAppId', { id: 'com.webos.app.screensaver' }).catch(() => null);
  }

  // the inputs as the launcher has them: [{id, appId, name, port, connected}]
  async function inputs() {
    const a = apps();
    if (!a || !a.inputs) return [];
    const r = await a.inputs();
    return ((r && r.devices) || [])
      .filter(d => d && d.appId)
      .map(d => ({
        id: String(d.id || ''),
        appId: d.appId,
        name: String(d.label || (d.tuner ? 'Live TV' : d.id || '')),
        port: d.port || 0,
        connected: d.tuner ? true : d.hdmiPlugIn !== false,
      }));
  }

  async function call(name, args, opts) {
    const a = apps(),
      x = args && typeof args === 'object' ? args : {};
    try {
      if (ON_SCREEN.indexOf(name) >= 0) await wake();
      if (name === 'list_apps') {
        if (!a) return fail('the app list is not available');
        const q = words(x.query);
        const list = (await a.listApps())
          .filter(p => p && p.id && !p.input && (!q || words(p.title).indexOf(q) >= 0 || words(p.id).indexOf(q) >= 0))
          .slice(0, 60)
          .map(p => ({ id: p.id, name: p.title }));
        return done(list);
      }
      if (name === 'launch_app') {
        if (!a) return fail('launching is not available');
        if (!/^[\w.\-]{2,120}$/.test(String(x.id || ''))) return fail('that is not an app id');
        const r = await a.launch(String(x.id));
        return r && r.returnValue === false ? fail(r.errorText || r.error || 'the app did not open') : done({ opened: x.id });
      }
      if (name === 'list_inputs') return done((await inputs()).map(i => ({ id: i.id, name: i.name, connected: i.connected })));
      if (name === 'switch_input') {
        if (!a) return fail('switching inputs is not available');
        const want = words(x.input),
          all = await inputs();
        const hit =
          all.filter(i => words(i.id) === want || words(i.name) === want)[0] ||
          all.filter(i => /^\d+$/.test(want) && (i.port === +want || words(i.id) === 'hdmi' + want))[0] ||
          all.filter(i => want && words(i.name).indexOf(want) >= 0)[0];
        if (!hit)
          return fail('this TV has no input called ' + String(x.input).slice(0, 40) + '; inputs: ' + all.map(i => i.name).join(', '));
        const r = await a.launch(hit.appId);
        return r && r.returnValue === false
          ? fail(r.errorText || r.error || 'the input did not open')
          : done({ input: hit.id, name: hit.name });
      }
      if (name === 'show_notification') {
        const n = notify();
        if (!n || !n.show) return fail('notifications are not available');
        if (x.image !== undefined && !/^https?:\/\/\S{3,500}$/.test(String(x.image))) return fail('image must be an http or https address');
        if (x.position !== undefined && POSITIONS.indexOf(x.position) < 0) return fail('position is one of ' + POSITIONS.join(', '));
        const card = {
          title: String(x.title || '').slice(0, 80),
          text: String(x.text || '').slice(0, 300),
          seconds: Math.max(2, Math.min(60, Math.round(+x.seconds) || 10)),
        };
        if (x.image) card.image = String(x.image);
        if (x.position) card.position = x.position;
        await n.show(card);
        return done({ shown: true, seconds: card.seconds, position: card.position || 'top-right' });
      }
      if (name === 'get_current_app') {
        const r = await luna('luna://com.webos.applicationManager/getForegroundAppInfo', {});
        const id = String((r && r.appId) || '');
        if (!id && (!r || r.returnValue === false)) return fail((r && r.errorText) || 'the TV did not say what is on screen');
        if (!id) return done({ id: '', name: 'nothing: the TV shows no app (it may be off or starting)' });
        if (id === HOME) return done({ id, name: 'Home' });
        const input = (await inputs()).filter(i => i.appId === id)[0];
        if (input) return done({ id, name: input.name, input: input.id });
        return done({ id, name: (await titles())[id] || id });
      }
      if (name === 'list_running_apps') {
        const run = feature('running');
        if (!run) return fail('the list of running apps is not available');
        const r = await run.list();
        if (r.error) return fail(r.error);
        return done(r.apps.map(p => Object.assign({ id: p.id, name: p.title }, p.background ? { background: true } : {})));
      }
      if (name === 'close_app') {
        const run = feature('running');
        if (!run) return fail('closing apps is not available');
        const id = String(x.id || '');
        if (id === HOME) return fail('Home cannot be closed; use navigate to go somewhere else');
        const listed = ((await run.list()).apps || []).filter(p => p.id === id)[0];
        if (!listed) return fail(id.slice(0, 80) + ' is not running; list_running_apps lists the apps that are');
        const closed = listed.background ? run.stop(id) : await run.close(id);
        return closed ? done({ closed: id }) : fail('the TV did not close ' + id.slice(0, 80));
      }
      if (name === 'navigate') {
        const rm = feature('remap');
        if (!rm || !rm.go) return fail('navigating is not available');
        if (['home', 'live_tv', 'input_list'].indexOf(x.to) < 0) return fail('to is home, live_tv or input_list');
        const r = await rm.go(x.to);
        return r && r.returnValue === false ? fail(r.errorText || 'the TV did not go there') : done({ went: x.to });
      }
      if (name === 'get_volume') {
        const au = ctx.audio;
        if (!au || !au.volume) return fail('the volume is not available');
        const v = au.volume();
        if (!v.known) return fail('the TV has not reported its volume yet; try again in a few seconds');
        return done({ volume: v.volume, max: v.max, muted: v.mute, output: v.output });
      }
      if (name === 'tv_info') {
        const p = (ctx.profile && ctx.profile.get()) || {},
          m = feature('manager');
        const pw = await luna('luna://com.webos.service.tvpower/power/getPowerState', {}).catch(() => ({}));
        const st = m && m.status ? await Promise.resolve(m.status()).catch(() => null) : null;
        const upd = st ? (st.service && st.service.updateTo) || (st.frontend && st.frontend.updateTo) || null : null;
        return done({
          model: p.model || '',
          webos: p.sdk ? 'SDK ' + p.sdk : '',
          firmware: p.firmware || '',
          cleanyourtv: ctx.version || '',
          power: (pw && pw.state) || 'unknown',
          update: st ? (upd ? 'available: ' + upd : st.checkedAt ? 'none' : 'not checked yet') : 'unknown',
        });
      }
      if (name === 'most_used_apps') {
        if (!a || !a.usageScores) return fail('app usage is not available');
        const n = Math.max(1, Math.min(20, Math.round(+x.limit) || 5)),
          sc = a.usageScores(),
          names = await titles();
        const list = Object.keys(sc)
          .filter(id => names[id] && sc[id] > 0)
          .sort((p, q) => sc[q] - sc[p])
          .slice(0, n)
          .map(id => ({ id, name: names[id] }));
        return done(list.length ? list : 'no app use has been counted yet');
      }
      if (name === 'get_weather') {
        const c = feature('cards'),
          w = c && c.weather;
        if (!w) return fail('the weather is not available');
        let at = null;
        if (x.place) {
          const hits = await w.search(String(x.place));
          if (!hits.length) return fail('no place called ' + String(x.place).slice(0, 60));
          at = { name: hits[0].name + (hits[0].area ? ', ' + hits[0].area : ''), lat: hits[0].lat, lon: hits[0].lon, unit: '' };
        } else {
          const cards = (ctx.config && ctx.config.get().cards) || {};
          // the built-in weather card first, else any card with a place (a downloaded forecast card keeps it the same way)
          const placed = Object.keys(cards)
            .map(k => cards[k])
            .filter(k => k && typeof k.lat === 'number' && typeof k.lon === 'number');
          const card = placed.filter(k => k.type === 'weather')[0] || placed[0];
          if (!card) return fail('say a place: there is no weather card with a place on Home');
          at = { name: String(card.place || ''), lat: card.lat, lon: card.lon, unit: card.unit || '' };
        }
        const unit = x.unit === 'f' || x.unit === 'c' ? x.unit : at.unit === 'f' ? 'f' : 'c';
        const r = await w.get(at.lat, at.lon, unit);
        if (r.error) return fail(r.error);
        const deg = unit === 'f' ? '\u00b0F' : '\u00b0C';
        return done({
          place: at.name,
          now: r.now.temp + deg + ', ' + sky(r.now.code),
          days: r.days.map(d => ({ date: d.date, sky: sky(d.code), max: d.max + deg, min: d.min + deg })),
        });
      }
      if (name === 'new_conversation') {
        require('./answers').forget();
        return done({ forgotten: true });
      }
      if (name === 'power_off') {
        if (!(opts && opts.confirmed === true))
          return Object.assign(fail('needs confirmation: the person must say yes first'), { confirm: true });
        if (!a) return fail('power is not available');
        a.powerOff();
        return done({ turningOff: true });
      }
      return fail('unknown tool: ' + name);
    } catch (e) {
      return fail(String((e && e.message) || e).slice(0, 200));
    }
  }

  // wake: for the add-ons' tools that change what is on screen
  return { id: 'core', name: 'CleanYourTV', tools: { list: () => TOOLS.slice(), call }, wake };
}

module.exports = { create, TOOLS, ON_SCREEN };
