// The LG tuner add-on's data (addons/catalog/tuner/tuner.js): the channel columns are looked up by name, programmes are joined by
// signalChannelId, the schedule of a channel is asked for on demand (where signalChannelId), epgdb's 500-row limit is followed with the
// page key, only channels the TV listed are asked for, and a database that refuses is not asked again at once. The TV's replies are
// stand-ins in the layout of a real one (webOS 5.6.2, cable); the data model and the tests are those of Tech-Dex's pull request 144.
const path = require('path');
const { root, ok, run } = require('./lib');
const tg = require(path.join(root, 'addons', 'catalog', 'tuner', 'tuner.js'));
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
  const luna = async (uri, payload, o) => {
    calls.push({ uri, payload, o });
    if (uri.indexOf('/getChannelList') > 0)
      return o.appId === 'com.webos.service.iepg' ? CHANNELS : { returnValue: false, errorText: 'no' };
    if (uri.indexOf('applicationManager/launch') > 0) return { returnValue: true };
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
  const g = tg.create({ luna, now: () => clock });
  ok(g.status().available === false && calls.length === 0, 'nothing is read before the guide asks');
  const list = await g.load();
  ok(list.length === 2 && list[0].name === 'Alpha' && g.has('a_1_28') && !g.has('zzz'), 'the channels are read, and only they are known');
  ok(
    calls.every(c => c.o.appId === 'com.webos.service.iepg'),
    'every guide call is made as com.webos.service.iepg'
  );
  let now = await g.list('b_2_28', false);
  ok(now.length === 1 && now[0][2] === 'B0', 'now and next for every channel come in one go');
  ok(calls.filter(c => c.payload.query && c.payload.query.where).length === 0, 'the schedule is not read for now and next');
  now = await g.list('a_1_28', true);
  ok(now.length > 6 && now.every((x, i) => i === 0 || now[i - 1][0] < x[0]), 'the schedule of Alpha is sorted');
  const pages = calls.filter(c => c.payload.query && c.payload.query.where && c.payload.query.where[0].val === 'a_1_28').length;
  ok(pages === 3, 'the page key was followed for 1200 rows (' + pages + ' calls)');
  ok(
    calls.every(c => !c.payload.query || c.payload.query.limit <= 500),
    'never more than 500 rows a call'
  );
  ok(
    calls.filter(c => c.payload.query && c.payload.query.where).every(c => c.payload.query.where[0].val === 'a_1_28'),
    'only the asked channel was read'
  );
  const before = calls.length;
  await g.list('a_1_28', true);
  await g.list('b_2_28', false);
  ok(calls.length === before, 'a second ask is served from memory');
  ok((await g.list('not-a-channel', true)).length === 0 && calls.length === before, 'a channel the TV did not list is never asked for');
  clock += 31 * 60 * 1000;
  await g.list('b_2_28', false);
  ok(calls.length > before, 'after half an hour the data is read again');
  const s = g.status();
  ok(s.available && s.channels === 2 && s.cached >= 1 && s.error === '', 'status');

  // tuning: LG\'s Live TV on the channel, by LG's own id
  calls.length = 0;
  const tr = await g.tune('b_2_28');
  const launch = calls[0];
  ok(
    tr.returnValue === true &&
      launch.uri === 'luna://com.webos.applicationManager/launch' &&
      launch.payload.id === 'com.webos.app.livetv' &&
      launch.payload.params.id === 'channelChange' &&
      launch.payload.params.channelId === '3_b_2_28',
    "a channel is tuned by launching LG's Live TV with its own channel id"
  );
  ok((await g.tune('nope')).returnValue === false, 'a channel that is not there is not tuned');

  // an epgdb that refuses: the error is reported, the service keeps answering, and the TV is not asked on every key press
  let asked = 0;
  const bad = tg.create({
    luna: async uri => {
      if (uri.indexOf('/getChannelList') > 0) return CHANNELS;
      asked++;
      return { returnValue: false, errorText: 'db: no index' };
    },
    now: () => clock,
  });
  await bad.load();
  const first = await bad.list('a_1_28', true);
  ok(Array.isArray(first) && bad.status().error === 'db: no index', 'a database error is reported, not thrown');
  const n1 = asked;
  await bad.list('a_1_28', true);
  await bad.list('b_2_28', false);
  ok(asked === n1, 'and it is not asked again at once (' + (asked - n1) + ' more calls)');
  clock += 61 * 1000;
  await bad.list('a_1_28', true);
  ok(asked > n1, 'but asked again after a minute');

  // no channels at all: a hint, not a crash
  const none = tg.create({ luna: async () => ({ returnValue: true, names: NAMES, values: [] }), now: () => clock });
  ok((await none.load()).length === 0 && /no channels/.test(none.status().error), 'a TV without channels says so');
});
