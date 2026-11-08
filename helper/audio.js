// Real-time audio volume status: subscribes to com.webos.service.audio/master/getVolume and serves
// instant updates to the launcher via long-polling (GET /api/audio/volume?since=N) and triggers
// system-wide volume OSD via notify overlay.
// A theme other than 'system' replaces LG's own volume bar: that is LG's setting com.webos.surfacemanager.volumeOSD, switched off.
// The value the TV had is saved first (backup/volume-osd.orig) and put back when 'system' is chosen again, and by
// scripts/volume-osd-restore.sh (undo-home.sh, uninstall.sh). Nothing is changed on a TV that does not report the setting.
const fs = require('fs');
const web = require('./web');
const P = require('./paths');

const THEMES = ['pill', 'capsule', 'dial', 'system'];
const DEFAULT_THEME = 'system'; // LG's own bar: a custom one is the user's choice
const OSD_KEY = 'com.webos.surfacemanager.volumeOSD';
const SAVED = () => P.D + '/backup/volume-osd.orig';

function create(ctx) {
  const luna = ctx.luna || require('./luna');
  const spawn = ctx.spawn || require('child_process').spawn;
  let seq = 1;
  let status = { volume: 10, mute: false, output: 'tv_speaker', max: 100, seq: 1 };
  let initialized = false;
  let running = false;
  const waiters = [];
  let lastNotifyAt = 0;
  let lastLaunchAt = 0;
  let currentTheme = '';
  let proc = null;
  let stock = ''; // LG's own bar: 'on', 'off' (we switched it off) or 'unsupported' (the TV does not report the setting)
  let stockBusy = Promise.resolve();
  const option = () => {
    const o = (ctx.config && ctx.config.options()) || {};
    return THEMES.indexOf(o.volumeTheme) >= 0 ? o.volumeTheme : DEFAULT_THEME;
  };

  function getPayload() {
    if (!currentTheme) currentTheme = option();
    return {
      volume: status.volume,
      mute: status.mute,
      output: status.output,
      max: status.max,
      seq: status.seq,
      theme: currentTheme,
    };
  }

  function notifyWaiters() {
    if (!waiters.length) return;
    lastNotifyAt = Date.now();
    const payload = getPayload();
    const list = waiters.splice(0, waiters.length);
    for (const w of list) {
      clearTimeout(w.timer);
      try {
        if (!w.res.finished) web.json(w.res, payload);
      } catch (_) {}
    }
  }

  const read = () => {
    try {
      return fs.readFileSync(SAVED(), 'utf8').trim();
    } catch (_) {
      return '';
    }
  };
  const forget = () => {
    try {
      fs.unlinkSync(SAVED());
    } catch (_) {}
  };
  // LG's own bar off for a custom theme (after saving what it was), back as it was for 'system'; one change at a time
  async function applyStock(theme) {
    try {
      const was = read();
      if (theme === 'system') {
        if (was) {
          const r = await luna('luna://com.webos.service.config/setConfigs', { configs: { [OSD_KEY]: was === 'true' } });
          if (!r.returnValue) return console.log('audio: LG’s volume bar could not be put back: ' + (r.errorText || 'refused'));
          forget();
        }
        stock = 'on';
        return;
      }
      if (was) {
        stock = 'off'; // switched off earlier (the service was restarted)
        return;
      }
      const r = await luna('luna://com.webos.service.config/getConfigs', { configNames: [OSD_KEY] });
      const cur = r && r.configs && r.configs[OSD_KEY];
      if (typeof cur !== 'boolean') {
        stock = 'unsupported';
        return console.log('audio: this TV does not report ' + OSD_KEY + ', so LG’s volume bar stays and the custom one is not shown');
      }
      try {
        fs.mkdirSync(P.D + '/backup');
      } catch (_) {}
      fs.writeFileSync(SAVED(), String(cur));
      const w = await luna('luna://com.webos.service.config/setConfigs', { configs: { [OSD_KEY]: false } });
      if (!w.returnValue) {
        forget();
        stock = 'unsupported';
        return console.log('audio: LG’s volume bar could not be switched off: ' + (w.errorText || 'refused'));
      }
      stock = 'off';
    } catch (e) {
      console.log('audio: ' + e.message);
    }
  }

  function syncStockVolumeOSD(theme) {
    currentTheme = THEMES.indexOf(theme) >= 0 ? theme : option();
    const t = currentTheme;
    stockBusy = stockBusy.then(() => applyStock(t));
    status.seq++;
    notifyWaiters();
    return stockBusy;
  }

  function showVolumeOSD(st) {
    if (!currentTheme) currentTheme = option();
    if (currentTheme === 'system' || stock !== 'off') return; // LG's own bar shows unless it is switched off

    const now = Date.now();
    // If notify app has a pending waiter or polled very recently, stream over socket without SAM launch
    if (waiters.length > 0 || now - lastNotifyAt < 1200) return;
    if (now - lastLaunchAt < 1500) return;
    lastLaunchAt = now;

    const notify = ctx.feature('notify');
    const params = {
      kind: 'volume',
      volume: st.volume,
      mute: st.mute,
      output: st.output,
      max: st.max,
      theme: currentTheme,
      seq: st.seq,
      seconds: 2,
    };
    if (notify && notify.show) {
      notify.show(params, true);
    } else {
      luna('luna://com.webos.applicationManager/launch', {
        id: 'com.cleanyourtv.notify',
        params: params,
      }).catch(() => {});
    }
  }

  function start() {
    currentTheme = option();
    syncStockVolumeOSD(currentTheme);
    if (running) return;
    running = true;
    let delay = 3000; // between restarts of the subscription: grows to a minute while it keeps failing
    function run() {
      try {
        proc = spawn('luna-send', ['-i', 'luna://com.webos.service.audio/master/getVolume', '{"subscribe":true}']);
      } catch (e) {
        return;
      }
      let buf = '';
      let next = false;
      proc.stdout.on('data', data => {
        delay = 3000;
        buf += data.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const l = line.trim();
          if (!l || l.indexOf('{') < 0) continue;
          try {
            const j = JSON.parse(l);
            const v = j.volumeStatus || j;
            if (v && (typeof v.volume === 'number' || typeof v.muteStatus === 'boolean')) {
              const newVol = typeof v.volume === 'number' ? v.volume : status.volume;
              const newMute = typeof v.muteStatus === 'boolean' ? v.muteStatus : status.mute;
              const newOutput = String(v.soundOutput || status.output || 'tv_speaker');
              const newMax = typeof v.maxVolume === 'number' ? v.maxVolume : 100;
              const changed = !initialized || newVol !== status.volume || newMute !== status.mute || newOutput !== status.output;

              status = {
                volume: newVol,
                mute: newMute,
                output: newOutput,
                max: newMax,
                seq: ++seq,
              };
              notifyWaiters();
              if (initialized && changed) {
                showVolumeOSD(status);
              }
              initialized = true;
            }
          } catch (_) {}
        }
      });
      const again = () => {
        if (!running || next) return;
        next = true;
        const t = setTimeout(run, delay);
        delay = Math.min(delay * 2, 60000);
        if (t && t.unref) t.unref();
      };
      proc.on('error', again);
      proc.on('close', again);
    }
    run();
  }

  function stop() {
    running = false;
    if (proc) {
      try {
        proc.kill();
      } catch (_) {}
      proc = null;
    }
  }

  return {
    name: 'audio',
    paths: ['/api/audio/volume'],
    start,
    stop,
    syncStockVolumeOSD,
    handle(req, res, u) {
      const q = req.url.split('?')[1] || '';
      if (/[?&]client=notify\b/.test(q)) lastNotifyAt = Date.now();
      const m = /[?&]since=(\d+)/.exec('?' + q);
      const since = m ? parseInt(m[1], 10) : 0;
      const payload = getPayload();
      if (status.seq > since) {
        return web.json(res, payload);
      }
      const item = { res, timer: null };
      item.timer = setTimeout(() => {
        const idx = waiters.indexOf(item);
        if (idx >= 0) waiters.splice(idx, 1);
        try {
          if (!res.finished) web.json(res, getPayload());
        } catch (_) {}
      }, 25000);
      res.on('close', () => {
        clearTimeout(item.timer);
        const idx = waiters.indexOf(item);
        if (idx >= 0) waiters.splice(idx, 1);
      });
      waiters.push(item);
    },
  };
}

module.exports = { create, THEMES, DEFAULT_THEME };
