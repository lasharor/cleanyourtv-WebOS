// The Guide key belongs to CleanYourTV while Live TV (the playlist) or the guide for LG's own tuner is on, and a key was learned;
// the service tells scripts/guidekey.sh which guide to open in the file tuner-guide.
const fs = require('fs');
const { ok, req, run } = require('./lib');
const conf = req('config').memory({ options: { liveTv: false }, keys: { guide: '362' } });
const P = req('paths');

run(async () => {
  let keyFn = null;
  const inputhook = { setVoiceKey() {}, setGuideKey: f => (keyFn = f), ensure() {} };
  const ik = req('inputkey').create({
    config: conf,
    luna: async () => ({}),
    profile: { get: () => ({ pickerMode: 'overlay' }) },
    feature: () => null,
    inputhook,
  });
  ik.start();
  ok(typeof keyFn === 'function', 'the Guide key function is handed to the hook');
  ok(keyFn() === '', 'Live TV and the tuner guide off: the Guide key stays with LG');
  conf.update('test', c => (c.options.tunerGuide = true));
  ok(keyFn() === '362', 'the tuner guide on: the learned Guide key is ours');
  ik.syncMode();
  ok(fs.readFileSync(P.TUNER_GUIDE, 'utf8').trim() === 'on', 'the file tuner-guide says on');
  conf.update('test', c => ((c.options.tunerGuide = false), (c.options.liveTv = true)));
  ok(keyFn() === '362', 'Live TV on: the learned Guide key is ours');
  ik.syncMode();
  ok(fs.readFileSync(P.TUNER_GUIDE, 'utf8').trim() === 'off', 'the file tuner-guide says off');
  conf.update('test', c => (c.keys.guide = ''));
  ok(keyFn() === '', 'no learned key: nothing is bound');
  // the script itself
  const sh = fs.readFileSync(require('path').join(__dirname, '..', '..', 'scripts', 'guidekey.sh'), 'utf8');
  ok(
    /tuner-guide/.test(sh) && /com\.cleanyourtv\.guide/.test(sh) && /"live":true,"guide":true/.test(sh),
    'guidekey.sh opens the tuner guide or the playlist guide'
  );
});
