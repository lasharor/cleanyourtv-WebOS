// The tool settings (toolprefs.js, the manager's AI agents (MCP) > Tools) and how toolhub.js applies them: the first run, new tools
// with "turn on" and "stay off", a group, one action of an add-on tool, a call to a tool that is off, an add-on that is switched off,
// a tool an update took away, and the 40-tool limit counted after the settings.
const { ok, req, run, call, memoryConfig } = require('./lib');

run(async () => {
  const config = memoryConfig({});
  const shown = [];
  const calls = [];
  const spotify = {
    name: 'spotify',
    description: 'Spotify.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['now_playing', 'play', 'pause'] } },
      required: ['action'],
    },
    group: 'Spotify',
    labels: { now_playing: 'What plays', play: 'Play', pause: 'Pause' },
  };
  let spotifyTools = [spotify];
  let addonsOn = { spotify: true, agent: true };
  const provider = (id, name, list) => ({
    id,
    name,
    mod: {
      tools: {
        list: () => list(),
        call: async (n, a) => (
          calls.push(id + ':' + n + ':' + (a && a.action)), { content: [{ type: 'text', text: 'ok' }], isError: false }
        ),
      },
    },
  });
  const signed = [{ name: 'recipes__open', description: 'Open the recipe app at a dish. More words.', inputSchema: {} }];
  const ctx = {
    config,
    notify: { show: async o => shown.push(o) },
    feature: n =>
      n === 'addons'
        ? {
            providers: w =>
              w === 'tools'
                ? [
                    provider('spotify', 'Spotify now playing', () => spotifyTools),
                    provider('agent', 'Agent tools (MCP)', () => signed),
                  ].filter(p => addonsOn[p.id])
                : [],
            list: () => [
              { id: 'spotify', name: 'Spotify now playing' },
              { id: 'agent', name: 'Agent tools (MCP)' },
            ],
          }
        : null,
  };
  const hub = req('toolhub').create(ctx);
  const names = async () => (await hub.list()).map(t => t.name);
  const status = async b => (await call(hub, '/api/mcp/tools', b ? 'POST' : 'GET', b)).j;

  // ---- the first time: every tool on, nothing new ----
  let n = await names();
  ok(n.indexOf('launch_app') >= 0 && n.indexOf('spotify') >= 0 && n.indexOf('recipes__open') >= 0, 'first run: every tool is listed');
  let t = config.get().tools;
  ok(
    t && t.newTools === 'on' && t.state['apps.launch_app'] === true && t.state['spotify.play'] === true && t.fresh.length === 0,
    'first run: every tool saved as on, none marked new'
  );
  ok(t.state['agent.recipes__open'] === true, 'a tool without actions is one item');
  let s = await status();
  const sg = s.groups.filter(g => g.id === 'spotify')[0];
  ok(
    s.groups
      .map(g => g.id)
      .slice(0, 4)
      .join() === 'apps,screen,tv,answers' &&
      sg.name === 'Spotify' &&
      sg.tool === 'spotify' &&
      sg.items[1].label === 'Play',
    'the groups: the four of the service, then the add-ons by the name their tool gives, with the labels: ' +
      s.groups.map(g => g.name).join(', ')
  );
  ok(
    s.groups.filter(g => g.id === 'tv')[0].items.filter(i => i.name === 'power_off')[0].confirm === true,
    'power_off is marked (voice only, after a yes)'
  );
  ok(
    s.groups
      .map(g => g.id)
      .slice(4)
      .join() === 'spotify,agent',
    'the add-ons in the order of the manager screen'
  );
  ok(
    req('toolprefs')
      .groupsOf([
        { provider: { id: 'zeta', name: 'Zeta' }, tools: [{ name: 'z', description: 'Z.' }] },
        { provider: { id: 'agent', name: 'Agent' }, tools: [{ name: 'a', description: 'A.' }] },
        { provider: { id: 'alpha', name: 'Alpha' }, tools: [{ name: 'y', description: 'Y.' }] },
        { provider: { id: 'iptv', name: 'Live TV' }, tools: [{ name: 'i', description: 'I.' }] },
      ])
      .map(g => g.id)
      .join() === 'iptv,agent,alpha,zeta',
    'known add-ons in their order (found on the TV: the loader gave them in its own order), others after them by name'
  );
  ok(s.on === s.all && s.all > 15, 'the count: all on');
  ok(JSON.stringify(s).indexOf('disconnect_from_tv') < 0, 'disconnect_from_tv is not a setting (always on)');

  // ---- one action off: the tool keeps the others ----
  s = await status({ key: 'spotify.play', on: false });
  let sp = (await hub.list()).filter(x => x.name === 'spotify')[0];
  ok(
    sp.inputSchema.properties.action.enum.join() === 'now_playing,pause',
    'an action that is off leaves the enum: ' + sp.inputSchema.properties.action.enum.join()
  );
  let r = await hub.call('spotify', { action: 'play' });
  ok(
    r.isError && /turned off on the TV/.test(r.content[0].text) && calls.length === 0,
    'a call to it is refused, saying it is turned off on the TV'
  );
  r = await hub.call('spotify', { action: 'pause' });
  ok(!r.isError && calls.join() === 'spotify:spotify:pause', 'the other actions still run');

  // ---- the whole group off, then a core tool off ----
  const keys = sg.items.map(i => i.key);
  s = await status({ group: 'spotify', on: false, keys });
  ok((await names()).indexOf('spotify') < 0, 'every action off: the tool is not listed');
  ok((await hub.call('spotify', { action: 'pause' })).isError, 'and is refused');
  ok(
    s.groups.filter(g => g.id === 'spotify')[0].items.every(i => !i.on),
    'the group shows all off'
  );
  s = await status({ group: 'spotify', on: true, keys });
  ok(
    (await names()).indexOf('spotify') >= 0 &&
      !(await hub.list()).filter(x => x.name === 'spotify')[0].inputSchema.properties.action.enum.length === false,
    'and on again, with every action'
  );
  await status({ key: 'apps.close_app', on: false });
  ok(
    (await names()).indexOf('close_app') < 0 && /turned off/.test((await hub.call('close_app', { id: 'x' })).content[0].text),
    'a service tool off: not listed, refused'
  );
  await status({ key: 'apps.close_app', on: true });

  // ---- new tools: on by default, marked new, no card ----
  spotifyTools = [
    Object.assign({}, spotify, {
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['now_playing', 'play', 'pause', 'queue'] } } },
    }),
  ];
  await names();
  t = config.get().tools;
  ok(
    t.state['spotify.queue'] === true && t.fresh.indexOf('spotify.queue') >= 0 && shown.length === 0,
    'a new action (an update): on, marked new, no card'
  );
  s = await status();
  ok(s.groups.filter(g => g.id === 'spotify')[0].items.filter(i => i.name === 'queue')[0].fresh === true, 'the screen shows it as new');
  s = await status({ seen: 'spotify', keys: s.groups.filter(g => g.id === 'spotify')[0].items.map(i => i.key) });
  ok(config.get().tools.fresh.length === 0, 'opening the group clears New');

  // ---- new tools stay off: off, marked new, a card ----
  await status({ newTools: 'off' });
  spotifyTools = [
    Object.assign({}, spotify, {
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['now_playing', 'play', 'pause', 'queue', 'shuffle'] } },
      },
    }),
  ];
  n = await names();
  t = config.get().tools;
  ok(
    t.newTools === 'off' && t.state['spotify.shuffle'] === false && t.fresh.indexOf('spotify.shuffle') >= 0,
    'with "stay off" a new action is saved as off and marked new'
  );
  ok(
    !(await hub.list()).filter(x => x.name === 'spotify')[0].inputSchema.properties.action.enum.some(a => a === 'shuffle'),
    'and is not offered'
  );
  ok(
    shown.length === 1 && /Spotify has 1 new tool/.test(shown[0].title) && /AI agents \(MCP\) > Tools/.test(shown[0].text),
    'a card says which part has new tools: ' + shown[0].title
  );
  ok(t.state['spotify.queue'] === true && t.state['spotify.play'] === true, 'changing the default did not flip the choices already made');
  await names();
  ok(shown.length === 1, 'the card comes once, not on every list');

  // ---- an add-on switched off keeps its choices; one an update took away is forgotten ----
  addonsOn.agent = false;
  await status({ key: 'agent.recipes__open', on: false }).catch(() => {});
  s = await status();
  const ag = s.groups.filter(g => g.id === 'agent')[0];
  ok(
    ag && ag.off === true && ag.name === 'Agent tools (MCP)' && ag.items.length === 1 && ag.items[0].on === false,
    'an add-on that is switched off: shown off, with its choices kept'
  );
  ok('agent.recipes__open' in config.get().tools.state, 'and they stay in config.json');
  addonsOn.spotify = false;
  s = await status();
  const offSp = s.groups.filter(g => g.id === 'spotify')[0];
  ok(
    offSp.off && offSp.name === 'Spotify' && offSp.tool === 'spotify' && offSp.items.filter(i => i.name === 'play')[0].label === 'Play',
    'an add-on that is off keeps the name, tool and labels it had (found in the browser: the side text had no tool name)'
  );
  addonsOn.spotify = true;
  addonsOn.agent = true;
  spotifyTools = [spotify];
  await names();
  t = config.get().tools.state;
  ok(
    !('spotify.queue' in t) && !('spotify.shuffle' in t) && t['agent.recipes__open'] === false,
    'actions an update took away are forgotten; the add-on back on has its choice again'
  );

  // ---- bad requests ----
  ok((await call(hub, '/api/mcp/tools', 'POST', { newTools: 'maybe' })).code === 400, 'newTools is on or off');
  ok((await call(hub, '/api/mcp/tools', 'POST', { key: 'apps.list_apps' })).code === 400, 'a key needs on');
  ok((await call(hub, '/api/mcp/tools', 'POST', { group: 'apps', on: true })).code === 400, 'a group needs its keys');

  // ---- the 40-tool limit counts the tools that are on ----
  const many = [];
  for (let i = 0; i < 45; i++) many.push({ name: 'x' + i, description: 'Tool ' + i + '.', inputSchema: {} });
  const big = req('toolhub').create({
    config: memoryConfig({}),
    feature: w => (w === 'addons' ? { providers: () => [provider('lots', 'Lots', () => many)], list: () => [] } : null),
  });
  ok((await big.list()).length === 40, 'at most 40 tools are sent');
  const bs = (await call(big, '/api/mcp/tools', 'GET')).j;
  const lots = bs.groups.filter(g => g.id === 'lots')[0];
  await call(big, '/api/mcp/tools', 'POST', { group: 'lots', on: false, keys: lots.items.slice(0, 30).map(i => i.key) });
  const after = (await big.list()).map(x => x.name);
  ok(after.length === 32 && after.indexOf('x44') >= 0, 'turning tools off frees room: ' + after.length + ' tools, x44 among them');
});
