// The TV guide add-on for LG's own tuner: the service part of its page (page/index.html, built from the guide code of Live TV: see
// src/index.html). It answers the page the way Live TV's service does, with the channels and the guide of the tuner instead of a playlist:
//   GET /api/addons/tuner/status    {configured, channels, state, error}   (always configured: there is nothing to set up)
//   GET /api/addons/tuner/channels  {groups, channels: [[number, id, name, group, logo, url, key, country, language, quality, flags,
//                                   categories, other streams]]}   (the url is empty: a channel is opened by the add-on, below)
//   GET /api/addons/tuner/epg?ids=<id,id>[&full=1]   {<id>: {now, next} | {list}}   programmes as [start, end, title, description, genre]
//   POST /api/addons/tuner/open {id}   LG's Live TV on that channel
//   GET|POST /api/addons/tuner/state   favourites (op fav, key, on) and the rest of what the page keeps
// The data is read by tuner.js from LG's own services (the idea and the way of asking are from Tech-Dex, pull request 144). The add-on may
// call only the three LG services its manifest lists (the loader enforces it).
const fs = require('fs'),
  path = require('path'),
  url = require('url');
const tuner = require('./tuner');

const KEY = /^[\w.-]{1,64}$/;

function create(ctx) {
  const t = tuner.create({ luna: ctx.luna });
  const i18n = ctx.util.i18n;
  const group = () => i18n.tr(i18n.lang(null, ctx.env.lang()), 'LG tuner');
  const STATE = path.join(ctx.dataDir, 'state.json');

  // favourites (and what else the page keeps), as Live TV keeps them
  let state = { fav: [], recent: [], failed: {} };
  try {
    const j = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    state = { fav: Array.isArray(j.fav) ? j.fav.filter(k => KEY.test(k)).slice(0, 500) : [], recent: [], failed: {} };
  } catch (_) {}
  const saveState = () => {
    try {
      ctx.util.mkdirp(ctx.dataDir);
      fs.writeFileSync(STATE + '.tmp', JSON.stringify({ fav: state.fav }));
      fs.renameSync(STATE + '.tmp', STATE);
    } catch (_) {}
  };
  function changeState(b) {
    if (!b || typeof b !== 'object') return false;
    if (b.op === 'clear') {
      state.recent = [];
      state.failed = {};
      return true;
    }
    if (!KEY.test(String(b.key))) return false;
    if (b.op === 'fav') {
      state.fav = state.fav.filter(k => k !== b.key);
      if (b.on) state.fav.unshift(b.key);
      saveState();
    } else if (b.op === 'recent') state.recent = [b.key].concat(state.recent.filter(k => k !== b.key)).slice(0, 30);
    else if (b.op === 'failed') {
      if (b.on) state.failed[b.key] = Date.now();
      else delete state.failed[b.key];
    } else return false;
    return true;
  }

  async function handle(req, res, p, body) {
    const json = (o, c) => {
      res.writeHead(c || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    const q = url.parse(req.url, true).query;
    if (p === '/status') {
      await t.load();
      const s = t.status();
      return json({ configured: true, channels: s.channels, state: 'idle', error: s.error });
    }
    if (p === '/channels') {
      const g = group(),
        list = await t.load();
      return json({
        groups: list.length ? [g] : [],
        channels: list.map((c, i) => [i + 1, c.id, c.name, g, '', '', c.id, '', '', '', 0, [g], []]),
      });
    }
    if (p === '/epg') {
      const out = {},
        now = Math.floor(Date.now() / 1000),
        full = !!q.full;
      for (const id of String(q.ids || '')
        .split(',')
        .filter(Boolean)
        .slice(0, 60)) {
        const list = await t.list(id, full),
          i = list.findIndex(x => x[1] > now);
        if (i < 0) continue;
        out[id] = full
          ? { list: list.slice(i, i + 8) }
          : { now: list[i][0] <= now ? list[i] : null, next: list[list[i][0] <= now ? i + 1 : i] || null };
      }
      return json(out);
    }
    if (p === '/open' && req.method === 'POST') {
      const b = await body(req),
        r = await t.tune(String(b.id || ''));
      return r && r.returnValue !== false && !r.error
        ? json({ returnValue: true })
        : json({ error: String((r && (r.error || r.errorText)) || 'could not open the channel').slice(0, 120) });
    }
    if (p === '/state' && req.method === 'GET') return json(state);
    if (p === '/state' && req.method === 'POST')
      return changeState(await body(req)) ? json({ returnValue: true }) : json({ error: 'bad request' }, 400);
    res.writeHead(404);
    res.end();
  }

  return { handle, tuner: t };
}

module.exports = { create };
