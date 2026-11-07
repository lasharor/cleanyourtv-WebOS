// The service's own tools of wave 1 (coretools.js): what is on screen, running apps, closing one, Home / Live TV / the Inputs list, the
// volume, the TV, the most used apps, the weather, a new conversation, and the richer card. Every part they use is a stand-in here.
const { ok, req, run, memoryConfig } = require('./lib');

run(async () => {
  const lunaCalls = [];
  let foreground = 'netflix';
  const luna = async (uri, params) => {
    lunaCalls.push({ uri, params });
    if (/getForegroundAppInfo/.test(uri)) return { returnValue: true, appId: foreground };
    if (/getPowerState/.test(uri)) return { returnValue: true, state: 'Active' };
    return { returnValue: true };
  };
  const apps = {
    listApps: async () => [
      { id: 'netflix', title: 'Netflix' },
      { id: 'youtube.leanback.v4', title: 'YouTube' },
      { id: 'spotify-beehive', title: 'Spotify' },
      { id: 'com.webos.app.hdmi1', title: 'PS5', input: true },
    ],
    inputs: async () => ({ devices: [{ id: 'HDMI_1', appId: 'com.webos.app.hdmi1', label: 'PS5', port: 1 }] }),
    usageScores: () => ({ netflix: 3.2, 'youtube.leanback.v4': 7.5, 'spotify-beehive': 0.4, 'gone.app': 9 }),
    launch: async () => ({ returnValue: true }),
  };
  const closed = [],
    stopped = [];
  let runningApps = [
    { id: 'netflix', title: 'Netflix' },
    { id: 'com.example.svc', title: 'Helper', background: true },
  ];
  const running = {
    list: async () => ({ apps: runningApps }),
    close: async id => (closed.push(id), true),
    stop: id => (stopped.push(id), true),
  };
  const went = [];
  const remap = { go: async to => (went.push(to), { returnValue: true }) };
  let vol = { volume: 12, max: 100, mute: false, output: 'external_optical', known: true };
  const searched = [],
    asked = [];
  const weather = {
    search: async q => (searched.push(q), /haifa/i.test(q) ? [{ name: 'Haifa', area: 'Haifa District, Israel', lat: 32.8, lon: 35 }] : []),
    get: async (lat, lon, unit) => (
      asked.push({ lat, lon, unit }), { now: { temp: 21, code: 95 }, days: [{ date: '2026-11-08', code: 61, max: 23, min: 17 }] }
    ),
  };
  let mstatus = { service: { updateTo: null }, frontend: { updateTo: null }, checkedAt: 1 };
  const shown = [];
  const config = memoryConfig({
    cards: { s1: { type: 'clock' }, s2: { type: 'weather', place: 'Tel Aviv', lat: 32.08, lon: 34.78, unit: 'f' } },
  });
  const features = { apps, running, remap, manager: { status: () => mstatus }, cards: { weather } };
  const ctx = {
    config,
    version: '1.6.20',
    luna,
    audio: { volume: () => vol },
    profile: { get: () => ({ model: 'OLED65G26LA', sdk: '10.1.0', firmware: '33.21.65' }) },
    feature: n => features[n] || null,
    notify: { show: async o => shown.push(o) },
  };
  const C = req('coretools').create(ctx).tools;
  const txt = r => r.content[0].text;
  const val = r => JSON.parse(txt(r));

  // get_current_app
  let r = await C.call('get_current_app', {});
  ok(!r.isError && val(r).name === 'Netflix', 'get_current_app names the app in front');
  foreground = 'com.webos.app.hdmi1';
  r = await C.call('get_current_app', {});
  ok(val(r).name === 'PS5' && val(r).input === 'HDMI_1', 'an input in front is named as the input');
  foreground = 'com.webos.app.home';
  ok(val(await C.call('get_current_app', {})).name === 'Home', 'Home is called Home');
  foreground = '';
  ok(/nothing/.test(val(await C.call('get_current_app', {})).name), 'no app in front says so');

  // list_running_apps, close_app
  r = await C.call('list_running_apps', {});
  ok(val(r).length === 2 && val(r)[1].background === true && val(r)[0].name === 'Netflix', 'list_running_apps lists apps and services');
  r = await C.call('close_app', { id: 'netflix' });
  ok(!r.isError && closed.join() === 'netflix', 'close_app closes a running app');
  r = await C.call('close_app', { id: 'com.example.svc' });
  ok(!r.isError && stopped.join() === 'com.example.svc', 'and stops a background service');
  r = await C.call('close_app', { id: 'youtube.leanback.v4' });
  ok(r.isError && /not running/.test(txt(r)) && closed.length === 1, 'an app that is not running is not closed');
  runningApps = runningApps.concat([{ id: 'com.webos.app.home', title: 'Home' }]);
  r = await C.call('close_app', { id: 'com.webos.app.home' });
  ok(r.isError && closed.length === 1, 'Home is never closed');

  // navigate
  for (const to of ['home', 'live_tv', 'input_list']) await C.call('navigate', { to });
  ok(went.join() === 'home,live_tv,input_list', 'navigate goes to Home, Live TV and the Inputs list');
  r = await C.call('navigate', { to: 'settings' });
  ok(r.isError && went.length === 3, 'navigate refuses anywhere else');

  // get_volume
  r = await C.call('get_volume', {});
  ok(val(r).volume === 12 && val(r).muted === false && val(r).output === 'external_optical', 'get_volume reads the volume');
  vol = Object.assign({}, vol, { known: false });
  ok((await C.call('get_volume', {})).isError, 'a volume not heard yet is not made up');

  // tv_info
  r = await C.call('tv_info', {});
  ok(
    val(r).model === 'OLED65G26LA' && val(r).cleanyourtv === '1.6.20' && val(r).power === 'Active' && val(r).update === 'none',
    'tv_info: model, version, power, no update'
  );
  mstatus = { service: { updateTo: '1.7.0' }, frontend: {}, checkedAt: 1 };
  ok(val(await C.call('tv_info', {})).update === 'available: 1.7.0', 'tv_info says when an update is available');

  // most_used_apps
  r = await C.call('most_used_apps', { limit: 2 });
  ok(
    val(r)
      .map(a => a.id)
      .join() === 'youtube.leanback.v4,netflix',
    'most_used_apps: most used first, only apps that are installed'
  );
  ok(val(await C.call('most_used_apps', {})).length === 3, 'five at most by default');

  // get_weather
  r = await C.call('get_weather', { place: 'Haifa' });
  ok(!r.isError && /Haifa/.test(val(r).place) && val(r).now === '21°C, thunderstorm' && asked[0].unit === 'c', 'get_weather for a place');
  ok(val(r).days[0].sky === 'rain' && val(r).days[0].max === '23°C', 'with the next days');
  r = await C.call('get_weather', {});
  ok(
    !r.isError && val(r).place === 'Tel Aviv' && asked[1].lat === 32.08 && asked[1].unit === 'f',
    "no place: the weather card's place and unit"
  );
  r = await C.call('get_weather', { place: 'Nowhereville' });
  ok(r.isError && /no place/.test(txt(r)), 'an unknown place says so');

  // show_notification with the new options
  r = await C.call('show_notification', {
    title: 'Dinner',
    text: 'Ready',
    seconds: 30,
    position: 'bottom-left',
    image: 'https://example.com/a.jpg',
  });
  ok(
    !r.isError && shown[0].seconds === 30 && shown[0].position === 'bottom-left' && shown[0].image === 'https://example.com/a.jpg',
    'a card with a picture, time and place'
  );
  await C.call('show_notification', { title: 'x', seconds: 999 });
  ok(shown[1].seconds === 60 && !shown[1].position && !shown[1].image, 'at most 60 seconds; the defaults stay');
  r = await C.call('show_notification', { title: 'x', image: 'file:///etc/passwd' });
  ok(r.isError && shown.length === 2, 'a picture must be an http or https address');
  r = await C.call('show_notification', { title: 'x', position: 'everywhere' });
  ok(r.isError && shown.length === 2, 'a position must be one of the nine');

  // new_conversation
  r = await C.call('new_conversation', {});
  ok(!r.isError && val(r).forgotten === true, 'new_conversation forgets the conversation');

  // a missing part says so instead of throwing
  const bare = req('coretools').create({ feature: () => null }).tools;
  for (const n of ['get_current_app', 'list_running_apps', 'close_app', 'navigate', 'get_volume', 'most_used_apps', 'get_weather'])
    ok((await bare.call(n, { id: 'x', to: 'home' })).isError, n + ' without its part is an error, not a crash');
});
