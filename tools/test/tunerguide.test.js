// The tuner guide's data (helper/tunerguide.js): the channel columns are looked up by name, programmes are joined by signalChannelId,
// the schedule of a channel is asked for on demand (where signalChannelId), epgdb's 500-row limit is followed with the page key.
const { ok, req, run, fake } = require('./lib');
const tg = req('tunerguide');

// the layout of the TV's reply (webOS 5.6.2): columns by name; the numbers are the TV's own
const NAMES = { channelId: 0, signalChannelId: 2, channelMode: 4, channelNumber: 8, majorNumber: 9, minorNumber: 10, channelName: 11 };
const row = (id, n, major, minor, name) => {
  const r = new Array(14).fill('');
  r[0] = '3_' + id;
  r[2] = id;
  r[4] = 'Cable';
  r[8] = n;
  r[9] = major;
  r[10] = minor;
  r[11] = name;
  return r;
};
const CHANNELS = {
  returnValue: true,
  names: NAMES,
  values: [
    row('b_2_28', '2', 2, 2, 'Beta'),
    row('a_1_28', '1', 1, 1, 'Alpha'),
    row('a_1_28', '1', 1, 1, 'Alpha again'),
    row('', '9', 9, 9, 'No id'),
  ],
};
const T0 = Date.UTC(2026, 10, 3, 10, 0, 0) / 1000;
const stamp = s => {
  const d = new Date(s * 1000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(',');
};
const prog = (id, start, mins, name, extra) =>
  Object.assign(
    {
      signalChannelId: id,
      startTime: stamp(start),
      endTime: stamp(start + mins * 60),
      programName: name,
      description: 'about ' + name,
      genre: 'News',
    },
    extra
  );
// 1200 programmes for Alpha (three pages of 500), one for Beta; PF has now and next of both
const SCH = [];
for (let i = 0; i < 1200; i++) SCH.push(prog('a_1_28', T0 - 3600 + i * 1800, 30, 'A' + i));
SCH.push(prog('b_2_28', T0, 60, 'B0'));
const PF = [prog('a_1_28', T0 - 600, 30, 'A-now'), prog('a_1_28', T0 - 3600 + 2 * 1800, 30, 'A2'), prog('b_2_28', T0, 60, 'B0')];

run(async () => {
  ok(tg.parseTime('2026,11,03,10,00,00') === T0, 'the TV time format is read as UTC');
  ok(tg.parseTime('') === 0 && tg.parseTime('2026-11-03') === 0, 'a bad time is 0');
  const ch = tg.parseChannels(CHANNELS);
  ok(
    ch.length === 2 && ch[0].id === 'a_1_28' && ch[1].id === 'b_2_28',
    'channels sorted by number, duplicates and rows without an id left out'
  );
  ok(ch[0].name === 'Alpha' && ch[0].major === 1 && ch[0].n === '1', 'columns are found by name');
  ok(ch[0].cid === '3_a_1_28', "LG's own channel id is kept: it is what tunes the channel");
  ok(tg.parseChannels({ names: {} }).length === 0 && tg.parseChannels(null).length === 0, 'an empty or odd reply gives no channels');
  ok(tg.parseProgramme(prog('x', T0 - 99999, 10, 'old'), T0, T0 + 100) === null, 'a programme outside the window is dropped');
  ok(
    tg.parseProgramme({ signalChannelId: 'x', startTime: stamp(T0), endTime: stamp(T0 + 60) }, 0, T0 + 1e6) === null,
    'a programme without a title is dropped'
  );
  ok(
    tg
      .merge([
        [[5, 6, 'x']],
        [
          [5, 7, 'y'],
          [1, 2, 'z'],
        ],
      ])
      .map(x => x[2])
      .join() === 'z,x',
    'one programme per start time, sorted'
  );

  // a fake luna: iepg for the channels, epgdb for the programmes (limit 500, page key, where on signalChannelId only)
  const calls = [];
  let nowOn = '3_b_2_28'; // the channel the TV is on, by LG's own id
  const luna = async (uri, payload, o) => {
    calls.push({ uri, payload, o });
    if (uri.indexOf('/getChannelList') > 0)
      return o.appId === 'com.webos.service.iepg' ? CHANNELS : { returnValue: false, errorText: 'no' };
    if (uri.indexOf('/utp.channel/getLastChannelId') > 0 || uri.indexOf('utp.channel/getLastChannelId') > 0)
      return nowOn ? { returnValue: true, channelId: nowOn } : { returnValue: false };
    if (o.appId !== 'com.webos.service.iepg') return { returnValue: false, errorText: 'denied' };
    const q = payload.query;
    if (q.limit > 500) return { returnValue: false, errorText: "value out of range for property 'limit'" };
    if (q.filter) return { returnValue: false, errorText: 'db: filter not allowed in find' };
    let all = q.from.indexOf('programPF') > 0 ? PF : SCH;
    if (q.where) all = all.filter(p => p[q.where[0].prop] === q.where[0].val);
    const at = q.page ? parseInt(q.page, 10) : 0;
    const results = all.slice(at, at + q.limit);
    const r = { returnValue: true, results };
    if (at + q.limit < all.length) r.next = String(at + q.limit);
    return r;
  };
  let clock = T0 * 1000;
  const g = tg.create({}, { luna, now: () => clock });
  const get = async url => {
    const x = fake(url);
    await g.handle(x.req, x.res, url.split('?')[0]);
    return JSON.parse(x.res.out);
  };

  ok(g.status().available === false, 'nothing is read before the guide asks');
  ok(calls.length === 0, 'no call to the TV at start');
  let j = await get('/api/tuner/channels');
  ok(j.channels.length === 2 && j.channels[0].name === 'Alpha', 'the channels reply');
  ok(j.current === 'b_2_28', 'the channel that is on now is named by its guide id, found from the id the TV gives');
  nowOn = '';
  ok((await get('/api/tuner/channels')).current === '', 'no current channel when the TV does not say');
  nowOn = '3_x_unknown';
  ok((await get('/api/tuner/channels')).current === '', 'a channel that is not in the list is not current');
  ok(
    calls.filter(c => c.uri.indexOf('getLastChannelId') < 0).every(c => c.o.appId === 'com.webos.service.iepg'),
    'every guide call is made as com.webos.service.iepg (the question which channel is on is asked as the service itself)'
  );
  j = await get('/api/tuner/epg?ids=b_2_28&from=' + (T0 - 3600) + '&to=' + (T0 + 7200));
  ok(j.epg.b_2_28.length === 1 && j.epg.b_2_28[0][2] === 'B0', 'a programme found in both kinds is listed once');
  const afterBeta = calls.filter(c => c.payload.query && c.payload.query.where).length;
  ok(afterBeta === 1, "only the asked channel's schedule was read (" + afterBeta + ')');
  j = await get('/api/tuner/epg?ids=a_1_28,b_2_28&from=' + (T0 - 3600) + '&to=' + (T0 + 5 * 3600));
  const a = j.epg.a_1_28;
  ok(a.length > 6 && a.every((x, i) => i === 0 || a[i - 1][0] < x[0]), 'the schedule of Alpha is sorted');
  ok(
    a.every(x => x[1] > T0 - 3600 && x[0] < T0 + 5 * 3600),
    'only the asked time range is returned'
  );
  const pages = calls.filter(c => c.payload.query && c.payload.query.where && c.payload.query.where[0].val === 'a_1_28').length;
  ok(pages === 3, 'the page key was followed for 1200 rows (' + pages + ' calls)');
  ok(
    calls.every(c => !c.payload.query || c.payload.query.limit <= 500),
    'never more than 500 rows a call'
  );
  const before = calls.length;
  await get('/api/tuner/epg?ids=a_1_28,b_2_28');
  ok(calls.length === before, 'a second ask is served from memory');
  clock += 31 * 60 * 1000;
  await get('/api/tuner/epg?ids=b_2_28');
  ok(calls.length > before, 'after half an hour the data is read again');
  ok(
    Object.keys(
      (
        await get(
          '/api/tuner/epg?ids=' +
            new Array(80)
              .fill('x')
              .map((_, i) => 'c' + i)
              .join(',')
        )
      ).epg
    ).length === 40,
    'at most 40 channels in one ask'
  );
  const s = await get('/api/tuner/status');
  ok(s.available && s.channels === 2 && s.cached >= 2, 'status');

  // an epgdb that refuses: the error is reported, the service keeps answering
  const bad = tg.create(
    {},
    {
      luna: async (uri, p, o) => (uri.indexOf('/getChannelList') > 0 ? CHANNELS : { returnValue: false, errorText: 'db: no index' }),
      now: () => clock,
    }
  );
  const x = fake('/api/tuner/epg?ids=a_1_28');
  await bad.handle(x.req, x.res, '/api/tuner/epg');
  const bj = JSON.parse(x.res.out);
  ok(bj.error === 'db: no index' && Array.isArray(bj.epg.a_1_28), 'a database error is reported, not thrown');
  // no channels at all: a hint, not a crash
  const none = tg.create({}, { luna: async () => ({ returnValue: true, names: NAMES, values: [] }), now: () => clock });
  const y = fake('/api/tuner/channels');
  await none.handle(y.req, y.res, '/api/tuner/channels');
  ok(/no channels/.test(JSON.parse(y.res.out).error), 'a TV without channels says so');
});
