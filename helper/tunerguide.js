// The channel guide of LG's own tuner (cable, antenna) for CleanYourTV's guide overlay (guide/app). LG's guide (the app
// com.webos.app.livemenu) gets its data from two services; this module asks the same ones, so the overlay shows what LG's guide shows:
//   channels    luna://com.webos.service.iepg/getChannelList (channelMode ["Tuner"]); the reply is rows (values) and the column of each
//               field (names), so the columns are looked up, never assumed
//   programmes  luna://com.webos.epgdb/find, kinds com.webos.service.legacybroadcast.programPF:4 (now and next, all channels in a
//               call or two) and programSCH:4 (the schedule). epgdb only answers a caller named com.webos.service.iepg, returns at
//               most 500 rows a call (more with the page key, next) and can only select by signalChannelId (an index): no time
//               range, no filter. The whole schedule is some 30000 rows, so it is NOT read at once: the schedule of a channel is
//               asked for (where signalChannelId = ...) when the guide shows that channel, and kept for half an hour.
// Channels and programmes are joined by signalChannelId. Nothing is read until the guide asks for the first time (a budget TV is
// busy enough at boot). Times are kept in seconds since 1970 (UTC).
//   GET /api/tuner/status    {available, channels, cached, at, error}
//   GET /api/tuner/channels  {channels: [{id, cid, n, major, minor, name}], current, error}   in the order of the channel numbers;
//                            current is the id of the channel that is on now ('' when the TV does not say)
//   GET /api/tuner/epg?ids=<id,id>&from=<s>&to=<s>   {epg: {<id>: [[start, end, title, description, genre], ...]}} (at most 40 ids)
const web = require('./web'),
  nc = require('./netcompat');

const IEPG = 'com.webos.service.iepg';
const KIND = 'com.webos.service.legacybroadcast.';
const PAGE = 500, // epgdb refuses a larger limit
  MAX_PAGES = 12, // 6000 programmes of one channel: far more than a TV keeps
  FRESH_MS = 30 * 60 * 1000,
  BEFORE_S = 2 * 3600, // programmes that ended more than 2 hours ago are dropped
  AFTER_S = 72 * 3600,
  MAX_IDS = 40,
  PARALLEL = 3; // calls to epgdb at the same time: the TV has little to spare

// "2026,11,03,08,30,00" (the TV's own format) -> seconds since 1970, or 0
function parseTime(s) {
  const m = /^(\d{4}),(\d{1,2}),(\d{1,2}),(\d{1,2}),(\d{1,2}),(\d{1,2})$/.exec(String(s || ''));
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) : 0;
}

// getChannelList reply -> [{id, cid, n, major, minor, name}] sorted by number
function parseChannels(r) {
  if (!r || !Array.isArray(r.values) || !r.names) return [];
  const c = r.names,
    out = [],
    seen = {};
  const num = v => (typeof v === 'number' ? v : parseInt(v, 10) || 0);
  for (const row of r.values) {
    if (!Array.isArray(row)) continue;
    const id = row[c.signalChannelId],
      name = row[c.channelName];
    if (!id || !name || seen[id]) continue;
    seen[id] = true;
    out.push({
      id: String(id),
      cid: String(row[c.channelId] || ''), // LG's own id of the channel: what tunes it (launch com.webos.app.livetv {id: 'channelChange', channelId})
      n: String(row[c.channelNumber] || ''),
      major: num(row[c.majorNumber]),
      minor: num(row[c.minorNumber]),
      name: String(name),
    });
  }
  // by the number the viewer sees (major, then minor), then by name
  out.sort((a, b) => a.major - b.major || a.minor - b.minor || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

// one epgdb row -> [start, end, title, description, genre], or null (no title, no times, or outside from..to)
function parseProgramme(p, from, to) {
  const s = parseTime(p.startTime),
    e = parseTime(p.endTime);
  if (!s || !e || e <= from || s >= to || !p.programName) return null;
  return [s, e, String(p.programName), String(p.description || '').slice(0, 220), String(p.genre || '')];
}

// rows of several kinds -> one list per start time, sorted
function merge(lists) {
  const seen = {},
    out = [];
  for (const l of lists)
    for (const x of l)
      if (!seen[x[0]]) {
        seen[x[0]] = true;
        out.push(x);
      }
  return out.sort((a, b) => a[0] - b[0]);
}

function create(ctx, opts) {
  const o = opts || {},
    luna = o.luna || ctx.luna,
    now = o.now || (() => Date.now());
  let channels = [],
    channelsAt = 0,
    channelsBusy = null,
    error = '';
  const sched = {}; // signalChannelId -> {at, list, busy}
  let pf = { at: 0, byId: {}, busy: null };
  const ask = (uri, payload) => luna(uri, payload, { appId: IEPG, wait: 15000 });
  const window = () => {
    const t = Math.floor(now() / 1000);
    return { from: t - BEFORE_S, to: t + AFTER_S };
  };

  // every row of a query, page by page (the page key goes back in the query)
  async function rows(query, each) {
    let page = '';
    for (let i = 0; i < MAX_PAGES; i++) {
      const q = Object.assign({ limit: PAGE }, query);
      if (page) q.page = page;
      const r = await ask('luna://com.webos.epgdb/find', { query: q });
      if (!r || r.returnValue === false) throw new Error((r && r.errorText) || 'epgdb gave no answer');
      for (const p of r.results || []) each(p);
      if (!r.next || !(r.results || []).length) return;
      page = r.next;
    }
  }

  async function loadChannels() {
    const fields = ['channelId', 'channelNumber', 'channelName', 'signalChannelId', 'majorNumber', 'minorNumber', 'channelMode'];
    const get = attribute =>
      ask('luna://com.webos.service.iepg/getChannelList', {
        dataType: 0,
        sort: 0,
        attribute,
        channelGroup: ['All'],
        channelMode: ['Tuner'],
        requestField: fields,
        format: 1,
      });
    // the filter LG's guide uses: not skipped, not hidden
    let list = parseChannels(
      await get([
        { filterType: 'skipped', value: false },
        { filterType: 'Invisible', value: false },
      ])
    );
    if (!list.length) list = parseChannels(await get([]));
    if (!list.length) throw new Error('the tuner has no channels (scan them in the TV settings)');
    return list;
  }
  function ensureChannels() {
    if (channels.length && now() - channelsAt < FRESH_MS) return Promise.resolve();
    if (!channelsBusy)
      channelsBusy = loadChannels()
        .then(l => {
          channels = l;
          channelsAt = now();
          error = '';
        })
        .catch(e => {
          error = String((e && e.message) || e);
        })
        .then(() => {
          channelsBusy = null;
        });
    return channelsBusy;
  }

  // what is on now and next for every channel (one or two calls)
  function ensureNowNext() {
    if (pf.at && now() - pf.at < FRESH_MS) return Promise.resolve();
    if (!pf.busy) {
      const w = window(),
        by = {};
      pf.busy = rows({ from: KIND + 'programPF:4' }, p => {
        const x = parseProgramme(p, w.from, w.to);
        if (x) (by[p.signalChannelId] = by[p.signalChannelId] || []).push(x);
      })
        .then(() => {
          pf = { at: now(), byId: by, busy: null };
        })
        .catch(e => {
          error = String((e && e.message) || e);
          pf.busy = null;
        });
    }
    return pf.busy;
  }

  // the schedule of one channel
  function ensureSchedule(id) {
    const s = sched[id];
    if (s && s.list && now() - s.at < FRESH_MS) return Promise.resolve();
    if (s && s.busy) return s.busy;
    const w = window(),
      got = [];
    const e = (sched[id] = Object.assign({ at: 0, list: null }, s, { busy: null }));
    e.busy = rows({ from: KIND + 'programSCH:4', where: [{ prop: 'signalChannelId', op: '=', val: id }] }, p => {
      const x = parseProgramme(p, w.from, w.to);
      if (x) got.push(x);
    })
      .then(() => {
        e.list = got.sort((a, b) => a[0] - b[0]);
        e.at = now();
        e.busy = null;
      })
      .catch(err => {
        error = String((err && err.message) || err);
        e.busy = null;
      });
    return e.busy;
  }

  // at most PARALLEL calls at a time
  async function schedules(ids) {
    const todo = ids.slice();
    const worker = async () => {
      while (todo.length) await ensureSchedule(todo.shift());
    };
    const ws = [];
    for (let i = 0; i < Math.min(PARALLEL, todo.length); i++) ws.push(worker());
    await Promise.all(ws);
  }

  function programmes(id) {
    const s = sched[id];
    return merge([(s && s.list) || [], pf.byId[id] || []]);
  }

  // the channel the TV is on (or was last on): LG's own guide asks utp.channel for it too
  async function currentId() {
    try {
      const r = await luna('luna://com.webos.service.utp.channel/getLastChannelId', { sourceType: 'INPUTSOURCE_NONE' }, { wait: 3000 });
      const c = r && r.channelId ? channels.filter(x => x.cid === r.channelId)[0] : null;
      return c ? c.id : '';
    } catch (_) {
      return '';
    }
  }

  const status = () => ({
    available: channels.length > 0,
    channels: channels.length,
    cached: Object.keys(sched).filter(k => sched[k].list).length,
    at: channelsAt,
    error,
  });

  async function handle(req, res, u) {
    if (u === '/api/tuner/status') return web.json(res, status());
    const p = new nc.URLSearchParams(req.url.split('?')[1] || '');
    await ensureChannels();
    if (u === '/api/tuner/channels') return web.json(res, { channels, current: await currentId(), error });
    if (u === '/api/tuner/epg') {
      const t = Math.floor(now() / 1000);
      const from = parseInt(p.get('from'), 10) || t - 3600,
        to = parseInt(p.get('to'), 10) || t + 6 * 3600;
      const ids = String(p.get('ids') || '')
        .split(',')
        .filter(Boolean)
        .slice(0, MAX_IDS);
      await ensureNowNext();
      await schedules(ids);
      const out = {};
      for (const id of ids) out[id] = programmes(id).filter(x => x[1] > from && x[0] < to);
      return web.json(res, { epg: out, error });
    }
    return web.json(res, { error: 'not found' }, 404);
  }

  return { name: 'tunerguide', paths: ['/api/tuner/status', '/api/tuner/channels', '/api/tuner/epg'], handle, status };
}

module.exports = { create, parseTime, parseChannels, parseProgramme, merge, KIND, PAGE };
