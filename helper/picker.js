// Keeps the Inputs picker overlay app (com.cleanyourtv.picker) running hidden. A cold start takes ~8 s before the app
// gets the remote; once running, every press only wakes it. Starts it after boot and again if the system closes it.
// Some firmware (webOS 6.5 reports) closes a hidden app soon after it hides, which made every start show the loading circle and
// grab the remote. So the starts are counted: when the picker had to be started three times in ten minutes, prewarming is switched off for
// good (saved in config.json as picker.prewarm: false, with the reason) and the Input key starts the picker only when pressed.
const PICKER = 'com.cleanyourtv.picker';
// How the Input key shows the Inputs:
//   'overlay'  = the picker app over the running app, started hidden after boot so the key opens it at once (tested on webOS 25);
//   'ondemand' = the same app, started when the key is pressed and closed after use: nothing hidden is left running that could keep the
//                remote (what other overlay apps for rooted TVs do);
//   'launcher' = the launcher's own Inputs list (needs CleanYourTV as Home).
const MODES = ['overlay', 'ondemand', 'launcher'];
// The default for this TV comes from tvprofile.js; a saved choice (manager) wins.
// fallback: the profile's pickerMode, or (older callers, tests) the webOS SDK major version
function modeOf(conf, fallback) {
  const m = conf && conf.mode;
  if (MODES.indexOf(m) >= 0) return m;
  if (MODES.indexOf(fallback) >= 0) return fallback;
  return require('./tvprofile').decide({ sdk: String(fallback || 0) }).pickerMode;
}
const CHECK_MS = 20000,
  WINDOW_MS = 10 * 60 * 1000,
  MAX_LAUNCHES = 3;
// store: { get() -> the saved {prewarm, reason, at}, set(obj) }
function make(luna, enabled, store, now) {
  now = now || Date.now;
  let launchedAt = -Infinity;
  const launches = []; // when it was started in the last WINDOW_MS
  const st = () => {
    try {
      return (store && store.get()) || {};
    } catch (_) {
      return {};
    }
  };
  async function tick() {
    try {
      if (!enabled()) return true;
      if (st().prewarm === false) return true; // switched off, by the user or after the system kept closing it
      const pw = await luna('luna://com.webos.service.tvpower/power/getPowerState', {});
      if (pw.state && !['Active', 'Screen Saver'].includes(pw.state)) return true; // not while in standby
      const run = await luna('luna://com.webos.applicationManager/running', {});
      if (!Array.isArray(run.running)) return false;
      if (run.running.some(a => (a.id || a.appId) === PICKER)) return true;
      if (now() - launchedAt < CHECK_MS) return false; // still starting
      // A picker that stays up is started once. When it has to be started again and again, the system keeps closing it (it may even be
      // listed as running for a moment after each start), and every start shows the loading circle: stop for good.
      while (launches.length && launches[0] < now() - WINDOW_MS) launches.shift();
      if (launches.length >= MAX_LAUNCHES) {
        if (store) store.set({ prewarm: false, mode: 'ondemand', reason: 'the TV keeps closing the hidden picker', at: now() });
        console.error(
          'picker: the system closed the hidden picker ' +
            launches.length +
            ' times in ' +
            Math.round(WINDOW_MS / 60000) +
            ' minutes; the Input key now starts it when pressed instead'
        );
        return true;
      }
      if (!(await luna('luna://com.webos.applicationManager/getAppInfo', { id: PICKER })).returnValue) return false; // not installed (yet)
      launchedAt = now();
      launches.push(launchedAt);
      await luna('luna://com.webos.applicationManager/launch', { id: PICKER, params: { prewarm: true } });
      return false;
    } catch (e) {
      console.error('picker keepalive:', e.message);
      return false;
    }
  }
  return tick;
}
// Gives the remote back to Home after a wake (webOS 26, SDK 11). When the TV wakes from standby, LG's boot manager relaunches Home
// with {boot:true}; the compositor still counts Home as the window with the keyboard (it never lost it while hidden), so it sends no
// keyboard enter, and the web engine, which marked the page unfocused when Home was hidden, drops every key: the remote does nothing
// until Back is held. Only a real change of focus cures it: another window takes the keyboard and gives it back. The launcher sees
// it (shown, but document.hasFocus() is false) and asks for this. The picker is started with {focusonly:true}: it draws one word
// at 1% opacity (a window that draws nothing is never put on screen and never gets the keyboard), reports when it has the focus
// (GET /api/log "picker focusonly focus"), and is closed; Home then gets the keyboard back. Seen on an OLED65C54LA (43.21.77):
// the picker had the focus 0.24 s after the start and Home had it back 0.6 s after the start, nothing visible.
// opts: { now, sleep, waitMs (how long to wait for the picker's focus), gapMs (the shortest time between two tries) }
function makeRefocus(luna, opts) {
  const o = opts || {};
  const now = o.now || Date.now;
  const sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const waitMs = o.waitMs || 3000,
    gapMs = o.gapMs || 4000;
  let last = -Infinity,
    busy = false,
    focused = null;
  const close = async () => {
    const a = await luna('luna://com.webos.applicationManager/closeByAppId', { id: PICKER });
    if (a.returnValue !== true) await luna('luna://com.webos.applicationManager/close', { id: PICKER });
  };
  async function refocus() {
    if (busy) return { done: false, reason: 'busy' };
    if (now() - last < gapMs) return { done: false, reason: 'too soon' };
    busy = true;
    last = now();
    try {
      // a picker kept ready in the background (overlay mode) would only fire its relaunch: close it, it is started again later
      const run = await luna('luna://com.webos.applicationManager/running', {});
      if (Array.isArray(run.running) && run.running.some(a => (a.id || a.appId) === PICKER)) {
        await close();
        await sleep(300);
      }
      let got = false;
      const wait = new Promise(r => {
        focused = () => {
          got = true;
          r();
        };
      });
      const r = await luna('luna://com.webos.applicationManager/launch', { id: PICKER, params: { focusonly: true } });
      if (r.returnValue === false) return { done: false, reason: r.errorText || 'the picker did not start' };
      let timer;
      await Promise.race([wait, new Promise(res => (timer = setTimeout(res, waitMs)))]);
      clearTimeout(timer);
      focused = null;
      await close();
      console.log(
        'refocus: ' +
          (got ? 'the picker took the remote and gave it back to Home' : 'the picker did not get the remote in ' + waitMs + ' ms')
      );
      return { done: true, focused: got };
    } finally {
      focused = null;
      busy = false;
    }
  }
  // the picker reported that its window has the keyboard
  refocus.noteFocus = () => {
    if (focused) focused();
  };
  return refocus;
}
function start(luna, enabled, store) {
  const tick = make(luna, enabled, store);
  // quickly after boot until it is up, then now and then
  let fast = 0;
  const loop = async () => {
    const up = await tick();
    if (up) fast = 0;
    setTimeout(loop, up || fast++ > 40 ? 30000 : 4000);
  };
  setTimeout(loop, 2000);
}
module.exports = { start, make, makeRefocus, modeOf, MODES };
