// The Guide key (inputkey.js): the learned key is ours while Live TV (IPTV) or the TV guide add-on (LG tuner) is on; the two do not depend on
// each other, and a learned key is kept (never cleared) while both are off.
const { ok, memoryConfig, req, run } = require('./lib');

run(async () => {
  const mod = req('inputkey');
  let setter = null,
    addons = [];
  const make = options => {
    const conf = memoryConfig({ options, keys: { input: '', home: '', voice: '', guide: '362' } });
    const f = mod.create({
      config: conf,
      luna: async () => ({ returnValue: true }),
      profile: { get: () => ({}) },
      inputhook: { setVoiceKey() {}, setGuideKey: fn => (setter = fn), ensure() {}, hookInfo: () => ({ attached: true }) },
      feature: n => (n === 'addons' ? { list: () => addons } : null),
    });
    f.start();
    return conf;
  };
  const tuner = (enabled, status) => [{ id: 'tuner', enabled, status }];

  const conf = make({ liveTv: true });
  ok(setter() === '362', 'Live TV on: the learned Guide key is ours');
  conf.update('test', c => void (c.options.liveTv = false));
  ok(setter() === '', 'Live TV off and no tuner guide: the key stays with LG');
  addons = tuner(true, 'running');
  ok(setter() === '362', 'the TV guide add-on on: the key is ours even with Live TV off');
  addons = tuner(false, 'off');
  ok(setter() === '', 'the TV guide add-on switched off: the key goes back to LG');
  addons = tuner(true, 'failed');
  ok(setter() === '', 'a TV guide add-on that is not running does not take the key');
  conf.update('test', c => void (c.keys.guide = ''));
  addons = tuner(true, 'running');
  ok(setter() === '', 'no learned key: nothing is bound');
  ok(conf.get().keys.guide === '' && conf.get().options.liveTv === false, 'nothing was changed in the settings');
});
