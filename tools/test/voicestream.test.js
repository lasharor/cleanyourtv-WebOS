// The remote's microphone stream (voice.js capture): the audio is read where LG's reply says (the 65UR91 answers with
// /var/voiceinput/..., the G2 with /tmp/...), and a refused stream (errorCode 10000 while the mic button is not held) is asked
// again for a while and then explained, instead of "I did not hear anything". luna-send and the socket are stand-ins here.
const path = require('path'),
  { EventEmitter } = require('events');
const { ok, helper, memoryConfig, run } = require('./lib');
const voice = require(path.join(helper, 'voice.js'));

const WINDOW = 3200; // 0.1 s of 16 kHz 16-bit mono
const pcm = level => {
  const b = Buffer.alloc(WINDOW);
  for (let i = 0; i < WINDOW; i += 2) b.writeInt16LE(level, i);
  return b;
};
const speech = Buffer.concat([pcm(2000), pcm(2000), pcm(2000)].concat(Array.from({ length: 13 }, () => pcm(0))));

// replies: one array of lines per luna-send start
function tv(replies) {
  const spawned = [],
    connected = [];
  const spawn = (cmd, args) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.kill = () => {};
    spawned.push(args);
    const lines = replies[Math.min(spawned.length - 1, replies.length - 1)];
    setTimeout(() => p.stdout.emit('data', Buffer.from(lines.join('\n') + '\n')), 5);
    return p;
  };
  const connect = file => {
    const s = new EventEmitter();
    s.destroy = () => {};
    connected.push(file);
    setTimeout(() => {
      s.emit('connect');
      s.emit('data', speech);
    }, 5);
    return s;
  };
  return { spawn, connect, spawned, connected };
}
const make = (t, extra) =>
  voice.create(Object.assign({ config: memoryConfig(), notify: { show: async () => {} }, spawn: t.spawn, connect: t.connect }, extra));

run(async () => {
  let r = voice.streamReply('{"subscribed":true,"returnValue":true,"socketPath":"/var/voiceinput/voiceinput_remote1.soc"}');
  ok(r.socket === '/var/voiceinput/voiceinput_remote1.soc', 'the reply gives the socket path');
  r = voice.streamReply('{"errorCode":"10000","errorText":"unknown error","returnValue":false}');
  ok(r.error === '10000 unknown error', 'a refusal is read as an error');
  ok(voice.streamReply('{') === null && voice.streamReply('') === null, 'a line that is not JSON is skipped');

  // the 65UR91: the audio is under /var, not /tmp
  let t = tv([
    [
      '{"subscribed":true,"returnValue":true,"socketPath":"/var/voiceinput/voiceinput_remote1.soc"}',
      '{"subscribed":true,"returnValue":true,"id":"remote1","state":"voicestart","socketPath":"/var/voiceinput/voiceinput_remote1.soc"}',
    ],
  ]);
  let audio = await make(t).capture();
  ok(t.connected[0] === '/var/voiceinput/voiceinput_remote1.soc', 'the socket of the reply is read: ' + t.connected[0]);
  ok(audio && audio.length >= 3 * WINDOW, 'the speech is returned');
  ok(t.spawned[0].indexOf('-f') < 0, 'one reply per line (no -f)');

  // a reply without a path: the old place
  t = tv([['{"subscribed":true,"returnValue":true}']]);
  audio = await make(t).capture();
  ok(t.connected[0] === '/tmp/voiceinput_remote1.soc' && audio, 'no path in the reply: /tmp/voiceinput_remote1.soc');

  // nothing readable from luna-send (as the old code never read it): the old place after a moment, as before
  t = tv([['not json']]);
  audio = await make(t).capture();
  ok(t.connected[0] === '/tmp/voiceinput_remote1.soc' && audio, 'no readable reply: the old /tmp socket is read, as before');

  // refused until the button is held, then opened
  t = tv([
    ['{"errorCode":"10000","errorText":"unknown error","returnValue":false}'],
    ['{"errorCode":"10000","errorText":"unknown error","returnValue":false}'],
    ['{"subscribed":true,"returnValue":true,"socketPath":"/var/voiceinput/voiceinput_remote1.soc"}'],
  ]);
  audio = await make(t).capture();
  ok(t.spawned.length === 3 && audio, 'a refused stream is asked again until it opens (' + t.spawned.length + ' starts)');

  // refused the whole time: the card says to hold the button
  t = tv([['{"errorCode":"10000","errorText":"unknown error","returnValue":false}']]);
  let err = null;
  try {
    await make(t, { refusedFor: 1000 }).capture();
  } catch (e) {
    err = e;
  }
  ok(err && /Hold the remote's mic button/.test(err.message), 'always refused: ' + (err && err.message));
  ok(t.connected.length === 0, 'nothing is read when the stream never opened');
});
