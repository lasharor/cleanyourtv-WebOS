// The settings in config.json, for every part of the service. Read and change them only through this module:
//   config.get()                 a copy of everything
//   config.options()             {debloat, inputKey, liveTv, tuner} with their defaults (and debloatOff, the debloat groups switched off)
//   config.keys()                the learned remote buttons with their defaults
//   config.cleanName(text)       the name for the Home greeting (config.name), made safe: see below
//   config.update(source, fn)    fn changes a copy, which is then written at once (atomically). The read, the change and the write
//                                happen in one go, so two parts of the service can never overwrite each other's settings.
// Every change of an option, a learned key or the Input-key mode is logged with its source ("manager", "launcher", "setup", ...),
// so a setting that changes by itself shows up in the service log and in Share log.
const fs = require('fs');
const P = require('./paths');

const OPTIONS = { debloat: true, inputKey: true, liveTv: true, tuner: true, volumeTheme: 'system' };
const KEYS = { input: '', home: '', voice: '', guide: '', learned: false };
// what the launcher saves with POST /api/config; everything else belongs to the service and the manager
const LAUNCHER_KEYS = ['dock', 'hidden', 'sort', 'order', 'clock', 'topbar', 'runDots', 'wall', 'cards', 'shelfShow'];

// "Your name" for the Home greeting (config.name): one line of plain text. Control characters, zero-width and direction marks (which could
// turn the greeting around) and < > are dropped, white space is collapsed, and 30 characters are kept (whole characters, not half an emoji).
const NAME_MAX = 30;
function cleanName(v) {
  const s = String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

// file: config.json; opts.log(line) for the change log; opts.memory: keep the settings in memory instead (tests)
function create(file, opts) {
  const o = opts || {};
  const log = o.log || (m => console.log(m));
  let mem = o.memory ? JSON.stringify(o.memory) : null;
  const read = () => {
    if (mem !== null) return JSON.parse(mem);
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
    } catch (_) {
      return {};
    }
  };
  const write = c => {
    if (mem !== null) return void (mem = JSON.stringify(c));
    fs.writeFileSync(file + '.tmp', JSON.stringify(c, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  };
  // compared with their defaults filled in, so writing a default down is not a change
  const watched = c => ({
    options: Object.assign({}, OPTIONS, c.options),
    keys: Object.assign({}, KEYS, c.keys),
    picker: { mode: (c.picker || {}).mode },
  });
  function report(source, before, after) {
    const a = watched(before),
      b = watched(after);
    for (const sec of Object.keys(b))
      for (const k of Object.keys(Object.assign({}, a[sec], b[sec]))) {
        if (JSON.stringify(a[sec][k]) !== JSON.stringify(b[sec][k]))
          log('config: ' + sec + '.' + k + ' ' + JSON.stringify(a[sec][k]) + ' -> ' + JSON.stringify(b[sec][k]) + ' (' + source + ')');
      }
  }
  function update(source, fn) {
    const before = read();
    const draft = JSON.parse(JSON.stringify(before));
    const r = fn(draft);
    const next = r && typeof r === 'object' ? r : draft;
    write(next);
    report(source, before, next);
    return next;
  }
  return {
    file,
    get: read,
    options: () => Object.assign({}, OPTIONS, read().options || {}),
    keys: () => Object.assign({}, KEYS, read().keys || {}),
    update,
    // for code that still thinks in whole files (tests, older modules): replaces everything, still logged
    replace: (source, c) => update(source, () => c),
  };
}

let shared = null;
// the service's config.json
const main = () => shared || (shared = create(P.CONF));
// settings kept in memory, for the tests
const memory = (initial, log) => create('', { memory: initial || {}, log: log || (() => {}) });

module.exports = { create, main, memory, cleanName, NAME_MAX, OPTIONS, KEYS, LAUNCHER_KEYS };
