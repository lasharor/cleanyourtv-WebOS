// Which tools are on (manager app: Features > AI agents (MCP) > Tools). The same choice holds for the voice assistant and for network
// agents, since they share one tool list (toolhub.js).
//
// config.json "tools": {newTools: 'on' | 'off', state: {<key>: true|false}, fresh: [<key>], seen: {<add-on>: {name, tool, labels}}}
//   key: "<group>.<item>". The service's tools sit in four groups (apps, screen, tv, answers); an add-on is one group (its id). An add-on
//   tool with an "action" enum is one item per action ("spotify.play"); a tool without one is one item ("agent.recipes__open"), and a
//   second tool of the same add-on with actions is "<id>.<tool>.<action>".
// Every item gets an explicit on or off the first time it is seen (newTools decides which), so changing newTools later never flips a
// choice already made. The very first time (no "tools" in config.json yet) every tool is on and none is marked new. "fresh" holds the
// items that appeared since: the manager shows them as New until their group is opened. "seen" keeps an add-on group's name, tool
// and labels, so the screen can still show them while the add-on is switched off.
const CORE_GROUPS = [
  {
    id: 'apps',
    name: 'Apps and inputs',
    tools: [
      'list_apps',
      'launch_app',
      'close_app',
      'list_running_apps',
      'get_current_app',
      'most_used_apps',
      'list_inputs',
      'switch_input',
    ],
  },
  { id: 'screen', name: 'Screen and Home', tools: ['navigate', 'show_notification', 'theme', 'remote_buttons'] },
  { id: 'tv', name: 'TV and sound', tools: ['get_volume', 'tv_info', 'power_off'] },
  { id: 'answers', name: 'Answers', tools: ['get_weather', 'new_conversation'] },
];
const MORE = { id: 'more', name: 'More from the TV service' }; // a service tool no group above names (a newer service)
// what each of the service's tools does, in a few words (the rows of the manager's screen)
const CORE_LABELS = {
  list_apps: 'List the installed apps',
  launch_app: 'Open an app',
  close_app: 'Close a running app',
  list_running_apps: 'List the open apps',
  get_current_app: 'Say what is on screen',
  most_used_apps: 'The most used apps',
  list_inputs: 'List the HDMI inputs',
  switch_input: 'Switch to an input',
  navigate: 'Go to Home, Live TV or the Inputs list',
  show_notification: 'Show a card on the screen',
  theme: 'Change the look of Home',
  remote_buttons: 'Use a remapped remote button',
  get_volume: 'Read the volume',
  tv_info: 'The model and versions',
  power_off: 'Turn the TV off',
  get_weather: 'The weather for a place',
  new_conversation: 'Start a new conversation',
};
const ADDON_ORDER = ['spotify', 'weather', 'iptv', 'androidbox', 'unsplash', 'icons', 'agent'];
const ITEM = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const actionsOf = t => {
  const p = t && t.inputSchema && t.inputSchema.properties && t.inputSchema.properties.action;
  return p && Array.isArray(p.enum) ? p.enum.filter(a => typeof a === 'string' && ITEM.test(a)) : null;
};
const firstSentence = s =>
  String(s || '')
    .split(/\.\s/)[0]
    .replace(/\.$/, '')
    .slice(0, 80);

// the groups of what the providers give: [{id, name, kind, tool, items: [{key, name, label, confirm}]}]; per tool, how it maps to keys
//   lists: [{provider: {id, name}, core: bool, tools: [tool]}]
function groupsOf(lists) {
  const groups = [],
    byId = {};
  const group = (id, name, kind) => byId[id] || ((byId[id] = { id, name, kind, items: [] }), groups.push(byId[id]), byId[id]);
  CORE_GROUPS.forEach(g => group(g.id, g.name, 'service'));
  const where = {}; // tool name of the core -> group id
  CORE_GROUPS.forEach(g => g.tools.forEach(t => (where[t] = g.id)));
  for (const l of lists) {
    if (l.core) {
      for (const t of l.tools) {
        const g = group(where[t.name] || MORE.id, where[t.name] ? null : MORE.name, 'service');
        g.items.push({
          key: g.id + '.' + t.name,
          name: t.name,
          tool: t.name,
          label: CORE_LABELS[t.name] || firstSentence(t.description),
          confirm: isConfirm(t),
        });
      }
      continue;
    }
    const id = String(l.provider.id || '');
    if (!ITEM.test(id)) continue;
    let name = '';
    for (const t of l.tools) {
      if (!name && typeof t.group === 'string' && t.group) name = t.group.slice(0, 40);
      const acts = actionsOf(t),
        labels = (t.labels && typeof t.labels === 'object' && t.labels) || {};
      const g = group(id, null, 'addon');
      if (!g.tool) g.tool = t.name;
      if (acts)
        acts.forEach(a =>
          g.items.push({
            key: t.name === id ? id + '.' + a : id + '.' + t.name + '.' + a,
            name: a,
            tool: t.name,
            action: a,
            label: typeof labels[a] === 'string' ? labels[a].slice(0, 60) : a.replace(/_/g, ' '),
            confirm: isConfirm(t),
          })
        );
      else g.items.push({ key: id + '.' + t.name, name: t.name, tool: t.name, label: firstSentence(t.description), confirm: isConfirm(t) });
    }
    byId[id].name = name || String(l.provider.name || id).slice(0, 40);
  }
  // the service's groups first, then the add-ons in the order of the manager's screen (the ones it does not name by name)
  const rank = g => (g.kind === 'service' ? -1 : ADDON_ORDER.indexOf(g.id) >= 0 ? ADDON_ORDER.indexOf(g.id) : ADDON_ORDER.length);
  return groups
    .filter(g => g.items.length)
    .map((g, i) => ({ g, i }))
    .sort(
      (x, y) => rank(x.g) - rank(y.g) || (rank(x.g) === ADDON_ORDER.length ? String(x.g.name).localeCompare(String(y.g.name)) : x.i - y.i)
    )
    .map(x => x.g);
}
const isConfirm = t => !!(t && (t.confirm === true || (t.annotations && t.annotations.destructiveHint)));

function create(ctx) {
  const config = ctx.config;
  const cfg = () => (config && config.get().tools) || null;
  const state = () => (cfg() && cfg().state) || {};
  const newTools = () => (cfg() && cfg().newTools === 'off' ? 'off' : 'on');
  const isOn = key => state()[key] !== false; // not seen yet: on (sync gives it its state before anyone sees the list)

  // record what is new: each item not seen before gets newTools' state; the first time ever, every item is on and nothing is new.
  // Items of a group that is there now but no longer has them (an update took them away) are forgotten; a group that is not there
  // (its add-on switched off or removed) keeps its choices.
  function sync(groups) {
    const had = cfg(),
      st = state(),
      add = [],
      gone = [];
    const present = {};
    groups.forEach(g => {
      present[g.id] = {};
      g.items.forEach(it => {
        present[g.id][it.key] = 1;
        if (!(it.key in st)) add.push({ g, it });
      });
    });
    Object.keys(st).forEach(k => {
      const gid = k.split('.')[0];
      if (present[gid] && !present[gid][k]) gone.push(k);
    });
    const seen = (had && had.seen) || {},
      look = {};
    groups.forEach(g => {
      if (g.kind !== 'addon') return;
      const labels = {};
      g.items.forEach(it => (labels[it.key] = [it.name, it.label, it.confirm ? 1 : 0]));
      look[g.id] = { name: g.name, tool: g.tool || '', labels };
    });
    const changed = Object.keys(look).filter(id => JSON.stringify(seen[id]) !== JSON.stringify(look[id]));
    if (had && !add.length && !gone.length && !changed.length) return [];
    const on = !had || newTools() === 'on';
    config.update('tools (new tools seen)', c => {
      const t = c.tools && typeof c.tools === 'object' ? c.tools : { newTools: 'on', state: {}, fresh: [] };
      t.state = Object.assign({}, t.state);
      const fresh = Array.isArray(t.fresh) ? t.fresh.slice() : [];
      add.forEach(x => {
        t.state[x.it.key] = on;
        if (had && fresh.indexOf(x.it.key) < 0) fresh.push(x.it.key);
      });
      gone.forEach(k => {
        delete t.state[k];
        const i = fresh.indexOf(k);
        if (i >= 0) fresh.splice(i, 1);
      });
      t.fresh = fresh.slice(-200);
      t.seen = Object.assign({}, t.seen);
      changed.forEach(id => (t.seen[id] = look[id]));
      if (t.newTools !== 'off') t.newTools = 'on';
      c.tools = t;
    });
    return had ? add : [];
  }

  // what the manager's screen shows: {newTools, groups: [{id, name, kind, tool, off, items: [{key, name, label, on, fresh, confirm}]}], on, all}
  function status(groups, addonNames) {
    const st = state(),
      fresh = (cfg() && cfg().fresh) || [];
    const out = groups.map(g => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      tool: g.tool || '',
      off: false,
      items: g.items.map(it => ({
        key: it.key,
        name: it.name,
        label: it.label,
        on: st[it.key] !== false,
        fresh: fresh.indexOf(it.key) >= 0,
        confirm: it.confirm,
      })),
    }));
    // add-ons that are switched off or removed: their saved choices, shown dimmed
    const there = {};
    out.forEach(g => (there[g.id] = 1));
    const offs = {},
      seen = (cfg() && cfg().seen) || {};
    Object.keys(st).forEach(k => {
      const parts = k.split('.'),
        gid = parts[0],
        look = seen[gid] || {};
      if (there[gid]) return;
      const g =
        offs[gid] ||
        (offs[gid] = {
          id: gid,
          name: look.name || (addonNames && addonNames[gid]) || gid,
          kind: 'addon',
          tool: look.tool || (parts.length === 2 ? gid : ''),
          off: true,
          items: [],
        });
      const nm = parts.slice(1).join('.'),
        lb = (look.labels && look.labels[k]) || [];
      g.items.push({
        key: k,
        name: lb[0] || nm.split('.').pop(),
        label: lb[1] || nm.split('.').pop().replace(/_/g, ' '),
        on: st[k] !== false,
        fresh: false,
        confirm: !!lb[2],
      });
    });
    Object.keys(offs).forEach(id => out.push(offs[id]));
    let on = 0,
      all = 0;
    out.forEach(g => g.items.forEach(it => ((all += 1), (on += it.on ? 1 : 0))));
    return { newTools: newTools(), groups: out, on, all };
  }

  // {newTools: 'on'|'off'} | {key, on} | {group, on, keys} | {seen: group, keys}: keys are the group's items (from status)
  function set(b) {
    const o = b && typeof b === 'object' ? b : {};
    if (o.newTools !== undefined && o.newTools !== 'on' && o.newTools !== 'off') return { error: 'newTools is on or off' };
    if (o.on !== undefined && typeof o.on !== 'boolean') return { error: 'on is true or false' };
    const keys = Array.isArray(o.keys) ? o.keys.filter(k => typeof k === 'string' && k.length < 200).slice(0, 200) : [];
    if (o.key !== undefined && (typeof o.key !== 'string' || typeof o.on !== 'boolean')) return { error: 'key needs on' };
    if (o.group !== undefined && (typeof o.on !== 'boolean' || !keys.length)) return { error: 'group needs on and its keys' };
    config.update('tools (manager)', c => {
      const t = c.tools && typeof c.tools === 'object' ? c.tools : { newTools: 'on', state: {}, fresh: [] };
      t.state = Object.assign({}, t.state);
      let fresh = Array.isArray(t.fresh) ? t.fresh.slice() : [];
      if (o.newTools) t.newTools = o.newTools;
      if (typeof o.key === 'string') {
        t.state[o.key] = o.on;
        fresh = fresh.filter(k => k !== o.key);
      }
      if (o.group !== undefined) keys.forEach(k => (t.state[k] = o.on));
      if (o.group !== undefined || o.seen !== undefined) fresh = fresh.filter(k => keys.indexOf(k) < 0);
      t.fresh = fresh;
      if (t.newTools !== 'off') t.newTools = 'on';
      c.tools = t;
    });
    return { ok: true };
  }

  return { sync, status, set, isOn, newTools };
}

module.exports = { create, groupsOf, CORE_GROUPS, CORE_LABELS };
