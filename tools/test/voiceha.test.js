// Speech recognition by Home Assistant (voice.stt = 'ha'; haaudio.js, answers.recogniseHa, voice.js): the audio of one utterance goes to a stand-in
// of Home Assistant's WebSocket API (auth, assist_pipeline/run, binary frames with the handler id, an empty frame at the end).
const http = require('http'),
  path = require('path'),
  { EventEmitter } = require('events');
const { ok, helper, memoryConfig, run, sleep } = require('./lib');
const wsServer = require('../../addons/catalog/phoneremote/ws');
const haaudio = require(path.join(helper, 'haaudio.js'));
const voice = require(path.join(helper, 'voice.js'));

const TOKEN = 'secret-ha-token-456';
const HANDLER = 7;
const log = { runs: [], audio: [], frames: [], auths: 0 };
let mode = 'ok'; // what the stand-in does: ok, nopipe, badauth, error, silent, hang, nospeech

function standIn() {
  const srv = http.createServer((q, r) => r.end('not found'));
  srv.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/websocket') return socket.destroy();
    const c = wsServer.upgrade(req, socket, head, { maxBytes: 1 << 20 });
    if (!c) return;
    const ev = (type, data) => c.send(JSON.stringify({ id: 1, type: 'event', event: { type, data: data || {} } }));
    c.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.10.0' }));
    c.on('message', t => {
      const m = JSON.parse(t);
      if (m.type === 'auth') {
        log.auths++;
        if (m.access_token !== TOKEN || mode === 'badauth')
          return c.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token' }));
        return c.send(JSON.stringify({ type: 'auth_ok' }));
      }
      if (m.type !== 'assist_pipeline/run') return;
      log.runs.push(m);
      if (mode === 'nopipe')
        return c.send(
          JSON.stringify({ id: 1, type: 'result', success: false, error: { code: 'not_found', message: 'Pipeline not found' } })
        );
      c.send(JSON.stringify({ id: 1, type: 'result', success: true, result: null }));
      ev('run-start', { pipeline: 'p1', language: 'pl', runner_data: { stt_binary_handler_id: HANDLER, timeout: 300 } });
      ev('stt-start');
      if (mode === 'error') return ev('error', { code: 'stt-provider-missing', message: 'No speech-to-text provider for pl' });
      if (mode === 'silent') return;
    });
    let got = [];
    c.on('binary', b => {
      log.frames.push(b.length);
      if (b[0] !== HANDLER) return;
      if (b.length === 1) {
        // the end of the audio
        log.audio.push(Buffer.concat(got));
        const last = log.runs[log.runs.length - 1];
        if (mode === 'hang') return;
        ev('stt-end', { stt_output: { text: mode === 'nospeech' ? '' : 'zapal światło w salonie' } });
        if (last.end_stage === 'intent') {
          ev('intent-start');
          ev('intent-end', {
            intent_output: {
              conversation_id: 'conv-pl',
              response: { response_type: 'action_done', data: {}, speech: { plain: { speech: 'Włączono światło' } } },
            },
          });
        }
        ev('run-end');
      } else got.push(b.slice(1));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port })));
}

const WINDOW = 3200;
const pcm = level => {
  const b = Buffer.alloc(WINDOW);
  for (let i = 0; i < WINDOW; i += 2) b.writeInt16LE(level, i);
  return b;
};
const speech = Buffer.concat([pcm(2000), pcm(2000), pcm(2000)].concat(Array.from({ length: 13 }, () => pcm(0))));
const tv = () => ({
  spawn: () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.kill = () => {};
    setTimeout(() => p.stdout.emit('data', Buffer.from('{"subscribed":true,"returnValue":true,"socketPath":"/tmp/x.soc"}\n')), 5);
    return p;
  },
  connect: () => {
    const s = new EventEmitter();
    s.destroy = () => {};
    setTimeout(() => {
      s.emit('connect');
      s.emit('data', speech);
    }, 5);
    return s;
  },
});

run(async () => {
  const ha = await standIn();
  const h = { url: ha.url, token: TOKEN, selfSigned: false };
  ok(haaudio.socketUrl('http://a:8123') === 'ws://a:8123/api/websocket', 'http becomes ws');
  ok(haaudio.socketUrl('https://a/ha/') === 'wss://a/ha/api/websocket', 'https becomes wss, a path prefix is kept');
  ok(haaudio.socketUrl('ftp://a') === '', 'another scheme is refused');

  // the audio, the handler id byte, the empty frame, the pipeline
  const audio = Buffer.alloc(16000 * 2, 1); // one second
  let r = await haaudio.recognise(h, audio, { pipeline: 'p1', conversation: 'c0', end: 'intent' });
  ok(r.recognised === 'zapal światło w salonie', 'the recognised text comes back: ' + r.recognised);
  ok(
    r.assist && r.assist.text === 'Włączono światło' && r.assist.understood === true && r.conversation === 'conv-pl',
    "Assist's reply and conversation come back"
  );
  const run1 = log.runs[0];
  ok(
    run1.start_stage === 'stt' &&
      run1.end_stage === 'intent' &&
      run1.input.sample_rate === 16000 &&
      run1.pipeline === 'p1' &&
      run1.conversation_id === 'c0',
    'assist_pipeline/run starts at stt with the sample rate, pipeline and conversation'
  );
  ok(log.audio[0].equals(audio), 'every byte of the audio arrived, in order');
  ok(log.frames[log.frames.length - 1] === 1, 'an empty frame (the handler id only) ends the audio');
  ok(Math.max.apply(null, log.frames) <= 3201, 'the audio goes in small frames');

  r = await haaudio.recognise(h, audio, { end: 'stt' });
  ok(r.recognised === 'zapal światło w salonie' && r.assist === null, 'end_stage stt: only the text');
  ok(
    log.runs[1].end_stage === 'stt' && log.runs[1].pipeline === undefined && log.runs[1].conversation_id === undefined,
    'no pipeline or conversation unless given'
  );

  mode = 'nospeech';
  r = await haaudio.recognise(h, audio, { end: 'stt' });
  ok(r.recognised === '', 'no words: an empty text, not an error');

  mode = 'ok';
  let e = await haaudio.recognise(Object.assign({}, h, { token: 'wrong-token-zzz' }), audio).then(
    () => null,
    x => x
  );
  ok(
    e && /refused the access token/.test(e.message) && e.message.indexOf('wrong-token-zzz') < 0,
    'a bad token is reported, and never printed'
  );
  mode = 'nopipe';
  e = await haaudio.recognise(h, audio, { pipeline: 'nope' }).then(
    () => null,
    x => x
  );
  ok(e && /Pipeline not found/.test(e.message), 'a pipeline that does not exist is reported');
  mode = 'error';
  e = await haaudio.recognise(h, audio).then(
    () => null,
    x => x
  );
  ok(e && /No speech-to-text provider for pl/.test(e.message), 'an error event of the pipeline is reported');
  mode = 'hang';
  const t0 = Date.now();
  e = await haaudio.recognise(h, audio, { totalMs: 400 }).then(
    () => null,
    x => x
  );
  ok(e && /in time/.test(e.message) && Date.now() - t0 < 3000, 'no answer in time: it ends');
  mode = 'ok';
  e = await haaudio.recognise(h, Buffer.alloc(haaudio.MAX_BYTES + 2)).then(
    () => null,
    x => x
  );
  ok(e && /too long/.test(e.message), 'audio over thirty seconds is refused before anything is sent');
  e = await haaudio.recognise(h, Buffer.alloc(0)).then(
    () => null,
    x => x
  );
  ok(e && /no audio/.test(e.message), 'no audio is refused');
  e = await haaudio.recognise({ url: 'http://127.0.0.1:1', token: TOKEN }, audio).then(
    () => null,
    x => x
  );
  ok(e && /could not connect/.test(e.message), 'Home Assistant off: could not connect');

  // the setting
  const cards = [];
  const t = tv();
  const v = voice.create({ config: memoryConfig(), notify: { show: async o => cards.push(o) }, spawn: t.spawn, connect: t.connect });
  const set = async b => {
    let out;
    await v.handle(
      { method: 'POST', url: '/api/voice/set' },
      { writeHead: () => {}, end: s => (out = JSON.parse(s)) },
      '/api/voice/set',
      async () => b
    );
    return out;
  };
  const stat = () => v.status();
  ok(stat().stt === 'tv' && stat().installed === false, 'off by default');
  let o = await set({ stt: 'ha' });
  ok(/set up Home Assistant/.test(o.error) && stat().stt === 'tv', 'Home Assistant first: without its address and token it is refused');
  o = await set({ stt: 'robot' });
  ok(/tv or ha/.test(o.error), 'an unknown value is refused');
  o = await set({ stt: 'ha', ha: { url: ha.url, token: TOKEN, pipeline: 'p 1' } });
  ok(/pipeline name/.test(o.error), 'a pipeline name with a space is refused');
  o = await set({ stt: 'ha', ha: { url: ha.url, token: TOKEN, pipeline: 'p1' }, enabled: true });
  ok(
    o.stt === 'ha' && o.enabled === true && o.ha.configured && JSON.stringify(o).indexOf(TOKEN) < 0,
    'saved; voice may be on without the TV recogniser; the status has no token'
  );
  ok(/Home Assistant/.test(o.engine), 'the status names the engine');

  // a whole utterance: capture, Home Assistant recognises and answers, the card shows it
  const wait = async f => {
    for (let i = 0; i < 100 && !f(); i++) await sleep(50);
  };
  mode = 'ok';
  const before = log.runs.length;
  let s = await v.listen();
  ok(s.started === true, 'listening starts although nothing is installed on the TV');
  await wait(() => stat().last && stat().last.state === 'heard' && stat().last.via);
  ok(
    stat().last.text === 'zapal światło w salonie' && stat().last.answer === 'Włączono światło' && stat().last.via === 'ha',
    'text and answer: ' + JSON.stringify(stat().last)
  );
  ok(log.runs[before].pipeline === 'p1' && log.runs[before].end_stage === 'intent', 'the saved pipeline is used; Assist answers too');
  ok(
    cards.some(c => c.kind === 'answer' && c.title === 'Home Assistant' && c.text === 'Włączono światło'),
    'the answer is shown on a card'
  );
  ok(log.audio[log.audio.length - 1].length >= WINDOW * 3, 'the audio of the utterance was sent');

  // ai-only: only the text is asked for
  await set({ ha: { route: 'ai-only' } });
  s = await v.listen();
  await wait(() => !stat().listening);
  ok(log.runs[log.runs.length - 1].end_stage === 'stt', 'the AI only: Home Assistant just recognises');

  // Home Assistant fails and nothing is installed: a plain error, not silence
  await set({ ha: { route: 'ha-first' } });
  mode = 'error';
  await v.listen();
  await wait(() => stat().last && stat().last.state === 'error');
  ok(/No speech-to-text provider/.test(stat().last.error), 'no recogniser on the TV: the reason is shown');
  ok(
    cards.some(c => c.title === 'Voice' && /No speech-to-text provider/.test(c.text)),
    'and on a card'
  );

  o = await set({ stt: 'tv' });
  ok(o.stt === 'tv' && o.engine === 'Moonshine tiny (English)', 'back to the TV');
  ha.srv.close();
});
