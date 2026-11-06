// The service's own abilities as tools for the voice assistant (answers.js, while llm.agent is on): list and open apps, the inputs, a
// card on the screen, and turning the TV off. The same shape as an add-on that provides "tools": {list(), call(name, args, opts)},
// in MCP form ({content: [{type: 'text', text}], isError}). Each tool runs the code the service's API already runs (apps.js, notify.js);
// nothing here goes through HTTP. power_off is marked destructive: answers.js asks the person first, and it runs here only with
// {confirmed: true}.
const S = (props, req) => ({ type: 'object', properties: props || {}, required: req || [] });
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
    description: 'Show a short card with a title and a line of text on the TV screen.',
    inputSchema: S({ title: { type: 'string' }, text: { type: 'string' } }, ['title']),
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
        await n.show({ title: String(x.title || '').slice(0, 80), text: String(x.text || '').slice(0, 300), seconds: 10 });
        return done({ shown: true });
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

  return { id: 'core', name: 'CleanYourTV', tools: { list: () => TOOLS.slice(), call } };
}

module.exports = { create, TOOLS };
