// Speech recognition by Home Assistant (voice.stt = 'ha'): the audio of one utterance (16 kHz, 16-bit mono PCM) goes to the Assist pipeline over
// Home Assistant's WebSocket API (assist_pipeline/run, start_stage 'stt'), so Home Assistant's own speech-to-text engine (a Whisper in the
// language you speak, for example) recognises it instead of the model on the TV. Resolves the recognised text and, when the pipeline was
// run up to its intent stage, Assist's reply. Nothing is written to disk; the token is sent only in the sign-in message of that connection
// and never appears in an error. Runs on Node 8 (wsclient.js is the WebSocket).
const ws = require('./wsclient');

const MAX_BYTES = 16000 * 2 * 30, // thirty seconds of audio at most (the capture stops at 25)
  CHUNK = 3200, // 0.1 s per frame
  TOTAL_MS = 30000, // the whole exchange
  CONNECT_MS = 5000;

// http(s)://host[:port][/prefix] -> ws(s)://host[:port][/prefix]/api/websocket ('' when it is not an http(s) address)
function socketUrl(base) {
  const m = /^(https?):\/\/(.+)$/.exec(String(base || ''));
  return m ? (m[1] === 'https' ? 'wss://' : 'ws://') + m[2].replace(/\/+$/, '') + '/api/websocket' : '';
}
// what Assist's intent stage said, as askHa (answers.js) reads a conversation reply
function intentOf(out) {
  const res = (out && out.response) || {},
    type = String(res.response_type || ''),
    code = String((res.data && res.data.code) || ''),
    speech = String((res.speech && res.speech.plain && res.speech.plain.speech) || '').trim();
  return {
    text: speech || (type === 'action_done' ? 'Done' : ''),
    understood: !(type === 'error' && code === 'no_intent_match'),
    type,
    code,
  };
}

// h: {url (http/https address), token, selfSigned}; pcm: Buffer; o: {pipeline, conversation, end ('stt' or 'intent'), totalMs}
// resolves {recognised, assist (intentOf, or null), conversation}; fails with a short message
function recognise(h, pcm, o) {
  const opts = o || {};
  return new Promise((resolve, reject) => {
    const url = socketUrl(h.url);
    if (!url) return reject(new Error('the Home Assistant address is not valid'));
    if (!pcm || !pcm.length) return reject(new Error('no audio'));
    if (pcm.length > MAX_BYTES) return reject(new Error('the audio is too long'));
    const end = opts.end === 'stt' ? 'stt' : 'intent';
    let conn = null,
      done = false,
      stage = 'connecting',
      handler = -1,
      recognised = null,
      assist = null,
      conversation = '';
    const fin = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (conn) conn.terminate();
      err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(val);
    };
    const timer = setTimeout(
      () => fin(new Error('Home Assistant did not recognise the speech in time (' + stage + ')')),
      opts.totalMs || TOTAL_MS
    );
    const send = x => conn.send(JSON.stringify(x));
    const frame = chunk => conn.sendBinary(Buffer.concat([Buffer.from([handler]), chunk])); // the first byte says which handler gets the audio
    const sendAudio = () => {
      stage = 'sending the audio';
      for (let i = 0; i < pcm.length; i += CHUNK) frame(pcm.slice(i, i + CHUNK));
      frame(Buffer.alloc(0)); // an empty frame: the audio is over
      stage = 'recognising';
    };
    const onEvent = ev => {
      const d = ev.data || {};
      if (ev.type === 'run-start') {
        handler = d.runner_data && d.runner_data.stt_binary_handler_id;
        if (typeof handler !== 'number' || handler < 0 || handler > 255)
          return fin(new Error('Home Assistant gave no place for the audio'));
        sendAudio();
      } else if (ev.type === 'stt-end') {
        recognised = String((d.stt_output && d.stt_output.text) || '').trim();
        if (end === 'stt') fin(null, { recognised, assist: null, conversation });
      } else if (ev.type === 'intent-end') {
        const out = d.intent_output || {};
        conversation = String(out.conversation_id || '');
        assist = intentOf(out);
      } else if (ev.type === 'error') {
        fin(new Error('Home Assistant: ' + String(d.message || d.code || 'error').slice(0, 160)));
      } else if (ev.type === 'run-end') {
        if (recognised === null) fin(new Error('Home Assistant did not recognise any speech'));
        else fin(null, { recognised, assist, conversation });
      }
    };
    ws.connect(url, { timeout: CONNECT_MS, maxBytes: 1 << 20, rejectUnauthorized: !(h.selfSigned && /^https:/.test(h.url)) }).then(
      c => {
        if (done) return c.terminate();
        conn = c;
        c.on('error', () => {});
        c.on('close', () => fin(new Error('Home Assistant closed the connection (' + stage + ')')));
        c.on('message', t => {
          let m;
          try {
            m = JSON.parse(t);
          } catch (_) {
            return;
          }
          if (!m || typeof m !== 'object') return;
          if (m.type === 'auth_required') {
            stage = 'signing in';
            return send({ type: 'auth', access_token: h.token });
          }
          if (m.type === 'auth_invalid') return fin(new Error('Home Assistant refused the access token'));
          if (m.type === 'auth_ok') {
            stage = 'starting the pipeline';
            const run = { id: 1, type: 'assist_pipeline/run', start_stage: 'stt', end_stage: end, input: { sample_rate: 16000 } };
            if (opts.pipeline) run.pipeline = opts.pipeline;
            if (opts.conversation) run.conversation_id = opts.conversation;
            return send(run);
          }
          if (m.type === 'result' && m.id === 1 && m.success === false)
            return fin(
              new Error(
                'Home Assistant: ' + String((m.error && (m.error.message || m.error.code)) || 'the pipeline did not start').slice(0, 160)
              )
            );
          if (m.type === 'event' && m.id === 1 && m.event) onEvent(m.event);
        });
      },
      e =>
        fin(
          new Error(
            e && e.message === 'timeout'
              ? 'Home Assistant did not answer'
              : 'could not connect to Home Assistant' + (e && /^refused with 4/.test(e.message) ? ' (' + e.message + ')' : '')
          )
        )
    );
  });
}

module.exports = { recognise, socketUrl, intentOf, MAX_BYTES };
