// Paired devices: who may use something on the TV from the network, and how they got in. One implementation for every part that
// lets another device in (the MCP network endpoint today; the phone remote can take it over), so they behave the same:
//   - a pairing window the TV opens while it shows it: a random 6-digit code that works once, at most `windowMs`, closed after
//     8 wrong codes; an address gets 5 tries a minute
//   - one token per device, `<id>.<128-bit secret>`, shown once; only the SHA-256 of the secret is kept, compared in constant time
//   - a list of at most `max` devices (name, when paired, last used, blocked), saved through `store` (an add-on's or a part's settings)
//   - block / allow, remove one, remove all; a device that has not been used for `expireDays` days (1, 3, 7, 14 or 30; 0 never) is
//     removed by `sweep()`, unless it is in use now
// Node 8.12: no optional chaining, no nullish coalescing.
const crypto = require('crypto');

const EXPIRE_DAYS = [1, 3, 7, 14, 30];
const EXPIRE_DEFAULT = 14;
const DAY = 24 * 3600 * 1000;
const SEEN_SAVE_MS = 60 * 1000; // "last used" is saved at most once a minute per device
const ACTIVE_MS = 2 * 60 * 1000; // used in the last two minutes: in use now, never swept
const TRIES = 5, // codes an address may try in a minute
  WRONG_MAX = 8; // wrong codes before the window closes

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const cleanName = s =>
  String(s || '')
    .replace(/[^\w .:@()+\/'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

// store: {get() -> {devices, expireDays}, set({devices, expireDays})}; opts: {max, windowMs, label}
function create(store, opts) {
  opts = opts || {};
  const max = opts.max || 10,
    windowMs = opts.windowMs || 10 * 60 * 1000,
    label = opts.label || 'device';
  let win = null; // {id, code, until, wrong, paired: {id, name, ip, at}}
  const tries = new Map(); // ip -> {n, t}
  const seenAt = {}; // id -> last time "seen" was saved

  const state = () => {
    const s = store.get() || {};
    return { devices: Array.isArray(s.devices) ? s.devices.slice() : [], expireDays: s.expireDays };
  };
  const save = s => store.set({ devices: s.devices, expireDays: s.expireDays });
  const expireDays = () => {
    const v = state().expireDays;
    return v === 0 ? 0 : EXPIRE_DAYS.indexOf(v) >= 0 ? v : EXPIRE_DEFAULT;
  };
  const pub = d => ({ id: d.id, name: d.name, created: d.created, seen: d.seen || d.created, ip: d.ip || '', blocked: !!d.blocked });

  // ---- the pairing window ----
  function openWindow() {
    win = {
      id: crypto.randomBytes(6).toString('hex'),
      code: String(100000 + (crypto.randomBytes(4).readUInt32BE(0) % 900000)),
      until: Date.now() + windowMs,
      wrong: 0,
      paired: null,
    };
    return { id: win.id, code: win.code, until: win.until };
  }
  function closeWindow() {
    win = null;
  }
  // an expired window stays in memory (closed) so whoever paired through it is still known: the manager closes its QR screen on that
  const windowOpen = () => !!win && Date.now() <= win.until;
  // what the page behind the QR code asks: whether a device paired through this window
  function windowState(id) {
    if (!win || win.id !== id) return { open: false, paired: null };
    return { open: windowOpen(), paired: win.paired };
  }

  // the code for a token. {token, name, id}, {already, name, id} when token (the device's current one) still works, or {error, status}
  function pair(code, name, ip, token) {
    const now = Date.now(),
      t = tries.get(ip) || { n: 0, t: now };
    if (now - t.t > 60000) {
      t.n = 0;
      t.t = now;
    }
    if (++t.n > TRIES) {
      tries.set(ip, t);
      return { error: 'too many tries: wait a minute', status: 429 };
    }
    tries.set(ip, t);
    if (!windowOpen() || win.paired)
      return { error: 'no code is open on the TV, or it was used already: show a new code on the TV', status: 403 };
    if (typeof code !== 'string' || code.length !== win.code.length || !same(code, win.code)) {
      if (++win.wrong >= WRONG_MAX) win = null;
      return { error: 'wrong code', status: 403 };
    }
    // a device that pairs again with a token that still works keeps it: no second entry, and the page still learns who it was
    if (token) {
      const v = verify(token, ip);
      if (v.device) {
        win.paired = { id: v.device.id, name: v.device.name, ip: String(ip || ''), at: now };
        return { already: true, name: v.device.name, id: v.device.id };
      }
      if (v.error === 'blocked') return { error: 'blocked: the user blocked this agent on the TV', status: 403, blocked: true };
    }
    const s = state();
    if (s.devices.length >= max) return { error: max + ' ' + label + 's are paired already: remove one on the TV', status: 409 };
    let nm = cleanName(name) || label.charAt(0).toUpperCase() + label.slice(1);
    const taken = n => s.devices.some(d => d.name === n);
    if (taken(nm)) {
      let i = 2;
      while (taken(nm + ' ' + i)) i++;
      nm = nm + ' ' + i;
    }
    const id = crypto.randomBytes(4).toString('hex'),
      secret = crypto.randomBytes(16).toString('hex');
    s.devices.push({ id, name: nm, hash: sha(secret).toString('hex'), created: now, seen: now, ip: String(ip || '').slice(0, 45) });
    save(s);
    win.paired = { id, name: nm, ip: String(ip || ''), at: now }; // works once: the window stays only to tell the page
    return { token: id + '.' + secret, name: nm, id };
  }

  // a token from a request: {device} or {error: 'revoked'|'blocked'}
  function verify(token, ip) {
    const m = /^([0-9a-f]{8})\.([0-9a-f]{32})$/.exec(String(token || ''));
    if (!m) return { error: 'revoked' };
    const s = state(),
      d = s.devices.filter(x => x.id === m[1])[0];
    if (!d || !same(sha(m[2]).toString('hex'), d.hash)) return { error: 'revoked' };
    if (d.blocked) return { error: 'blocked', device: pub(d) };
    const now = Date.now();
    if (!seenAt[d.id] || now - seenAt[d.id] > SEEN_SAVE_MS || (ip && d.ip !== ip)) {
      seenAt[d.id] = now;
      d.seen = now;
      if (ip) d.ip = String(ip).slice(0, 45);
      save(s);
    }
    live[d.id] = now;
    return { device: pub(d) };
  }
  const live = {}; // id -> last request, also between the saves of "seen"
  const lastUse = d => Math.max(d.seen || d.created || 0, live[d.id] || 0);

  function list() {
    return state()
      .devices.map(d => Object.assign(pub(d), { seen: lastUse(d), active: Date.now() - lastUse(d) < ACTIVE_MS }))
      .sort((a, b) => b.seen - a.seen);
  }
  function setBlocked(id, on) {
    const s = state(),
      d = s.devices.filter(x => x.id === id)[0];
    if (!d) return false;
    d.blocked = !!on;
    save(s);
    return true;
  }
  function remove(id) {
    const s = state(),
      n = s.devices.length;
    s.devices = s.devices.filter(x => x.id !== id);
    if (s.devices.length === n) return false;
    save(s);
    return true;
  }
  function removeAll() {
    const s = state(),
      n = s.devices.length;
    s.devices = [];
    save(s);
    return n;
  }
  function setExpire(days) {
    if (days !== 0 && EXPIRE_DAYS.indexOf(days) < 0) return false;
    const s = state();
    s.expireDays = days;
    save(s);
    return true;
  }
  // remove the devices nobody used for the chosen time; a device in use now stays. Returns the names removed
  function sweep() {
    const days = expireDays();
    if (!days) return [];
    const s = state(),
      now = Date.now(),
      gone = s.devices.filter(d => now - lastUse(d) > days * DAY && now - lastUse(d) > ACTIVE_MS);
    if (!gone.length) return [];
    s.devices = s.devices.filter(d => gone.indexOf(d) < 0);
    save(s);
    return gone.map(d => d.name);
  }
  // when a device is removed by the sweep, in ms from now (null: never)
  const removesIn = d => {
    const days = expireDays();
    return days ? Math.max(0, lastUse(d) + days * DAY - Date.now()) : null;
  };

  return {
    openWindow,
    closeWindow,
    windowOpen,
    windowState,
    pair,
    verify,
    list,
    count: () => state().devices.length,
    setBlocked,
    remove,
    removeAll,
    expireDays,
    setExpire,
    sweep,
    removesIn: id => {
      const d = state().devices.filter(x => x.id === id)[0];
      return d ? removesIn(d) : null;
    },
  };
}

module.exports = { create, EXPIRE_DAYS, EXPIRE_DEFAULT };
