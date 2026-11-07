// The remote's Input key (and the learned Voice and Guide keys): keeps the hook in LG's input processes and the key binds up to date
// (inputhook.js), keeps the Inputs picker ready where that works (picker.js), closes the picker when it asks, and writes the mode
// that scripts/inputkey.sh follows. GET /api/log?m=... is the picker's and the overlay apps' small diagnostics channel. POST /api/refocus
// gives the remote back to Home after a wake where the TV needs it (tvprofile wakeRefocus, picker.makeRefocus).
const fs = require('fs');
const P = require('./paths'),
  web = require('./web'),
  picker = require('./picker');

const PICKER = 'com.cleanyourtv.picker';

function create(ctx) {
  const { config, luna, profile } = ctx;
  const inputhook = ctx.inputhook || require('./inputhook');
  let pickerShownAt = 0;

  const keyCode = () => String(config.keys().input || '241');
  // the voice key belongs to us only while voice is installed and on; the Guide key only while Live TV or the TV guide (LG tuner) is on and a key was learned
  const voiceKey = () => {
    const v = config.get().voice || {};
    const voice = ctx.feature('voice');
    return v.enabled && voice && voice.installed() ? String(config.keys().voice || '') : '';
  };
  // an add-on with the permission key.guide (the TV guide for LG's tuner) is a guide of its own: it takes the key whether Live TV is on or not
  const guideAddon = () => {
    const ad = ctx.feature && ctx.feature('addons');
    return !!ad && ad.list().some(a => a.enabled && a.status === 'running' && (a.permissions || []).indexOf('key.guide') >= 0);
  };
  const guideKey = () => (config.options().liveTv !== false || guideAddon() ? String(config.keys().guide || '') : '');
  // overlay, ondemand or launcher: the manager's choice, else this TV's default (tvprofile.js)
  const mode = () => picker.modeOf(config.get().picker || {}, profile.get().pickerMode);
  // with the launcher's list as the target, CleanYourTV has to be the Home: while LG's Home is chosen the key stays with LG
  const on = () => config.options().inputKey && !(mode() === 'launcher' && fs.existsSync(P.DISABLE));
  const syncMode = () => {
    try {
      fs.writeFileSync(P.PICKER_MODE, mode() + '\n');
    } catch (_) {}
  };
  const ensure = () => inputhook.ensure(on(), keyCode());

  // the on-demand picker asks to be closed when it is dismissed. Closing from the page does nothing on some builds, so the app
  // manager does it: closeByAppId works on webOS 6, plain close is the fallback
  async function closePicker() {
    const a = await luna('luna://com.webos.applicationManager/closeByAppId', { id: PICKER });
    if (a.returnValue === true) return;
    const b = await luna('luna://com.webos.applicationManager/close', { id: PICKER });
    if (b.returnValue !== true)
      console.error('picker: could not close it (' + (a.errorText || 'closeByAppId failed') + '; ' + (b.errorText || 'close failed') + ')');
  }

  // POST /api/refocus: the launcher was shown after a wake without the keyboard (webOS 26, see picker.makeRefocus)
  const refocus = ctx.refocus || picker.makeRefocus(luna);

  async function handle(req, res, u) {
    if (u === '/api/refocus') {
      if (req.method !== 'POST') return web.json(res, { error: 'POST only' }, 405);
      if (!profile.get().wakeRefocus) return web.json(res, { done: false, reason: 'not needed on this TV' });
      return web.json(res, await refocus());
    }
    const m = decodeURIComponent(req.url.split('m=')[1] || '');
    if (/picker focusonly focus/.test(m)) refocus.noteFocus();
    if (/picker show/.test(m)) pickerShownAt = Date.now();
    if (/picker close/.test(m)) setTimeout(closePicker, 400);
    let up = '';
    try {
      up = fs.readFileSync(P.PROC + '/uptime', 'utf8').split(' ')[0];
    } catch (_) {}
    console.log(up + ' ' + m.slice(0, 300));
    web.json(res, {});
  }

  function start() {
    if (inputhook.setVoiceKey) inputhook.setVoiceKey(voiceKey);
    if (inputhook.setGuideKey) inputhook.setGuideKey(guideKey);
    syncMode();
    // bind the key and keep the hook in LG's input processes (they restart now and then)
    setTimeout(ensure, 500);
    setInterval(ensure, 30000);
    // a hidden picker is only kept while the hook attached: without it the key cannot open the picker, which would only hold the remote
    const hookAttached = () => {
      try {
        // attached but blind (no button reaches it on this TV, issue 185) cannot open the picker either
        const h = inputhook.hookInfo ? inputhook.hookInfo() : {};
        return !!(h.attached && !h.blind);
      } catch (_) {
        return false;
      }
    };
    picker.start(luna, () => config.options().inputKey && mode() === 'overlay' && hookAttached(), {
      get: () => config.get().picker || {},
      set: v => {
        config.update('picker', c => {
          c.picker = v;
        });
        syncMode();
      },
    });
  }

  return {
    name: 'inputkey',
    paths: ['/api/log', '/api/refocus'],
    handle,
    start,
    // for the manager
    mode,
    on,
    syncMode,
    ensure,
    pickerShownAt: () => pickerShownAt,
    keyCode,
  };
}

module.exports = { create };
