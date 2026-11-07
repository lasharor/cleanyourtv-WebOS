/* ---------- naming a device for the pairing screen ---------- */

/*
  The pairing page starts with a name in the "Name of this device" field. A browser knows its kind of device but never its name, so the TV
  asks the router: the address a page is opened from has a name in the router's DHCP list, which a reverse lookup returns (a PC shows its
  Windows name). Many phones give nothing useful there (an empty answer, "wlan0", their MAC address), so a name is only used when it looks
  like one. The answer is a suggestion: the person can type another name before pairing, and it is cut to the same length and cleaned the same way.
*/

const dns = require('dns');

const LEN = 30,
  WAIT_MS = 700, // a slow resolver must not hold the page back
  KEEP_MS = 600000, // a name that was found
  MISS_MS = 20000, // nothing found: a phone that has just joined may have no name yet, so ask again soon
  MAX_KEPT = 64;
const cache = {};

// the address as the socket reports it (an IPv4 client may arrive as ::ffff:10.0.0.5); only a private IPv4 address is looked up
// (127.x too: a phone is never there, but the tests are)
function privateV4(addr) {
  const a = String(addr || '').replace(/^::ffff:/i, '');
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m || m.slice(1).some(x => +x > 255)) return '';
  const p = +m[1],
    q = +m[2];
  return p === 10 || p === 127 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) ? a : '';
}

// A name from the router, or '' when it is not one: nothing, an address, a MAC address, wlan0, android-<random>, a lookup's own zone name.
function clean(host) {
  let s = String(host || '')
    .replace(/[\u0000-\u001f\u007f<>"&]/g, '')
    .trim()
    .replace(/\.$/, '');
  if (/(^|\.)(in-addr|ip6)\.arpa$/i.test(s)) return '';
  if (/^\d+(\.\d+){3}$/.test(s) || /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(s)) return '';
  s = s.split('.')[0]; // office.lan, laptop.home: the part before the domain is the name
  if (s.length < 2 || /^wlan\d*$/i.test(s) || /^localhost$/i.test(s) || /^android[-_][0-9a-f]{8,}$/i.test(s)) return '';
  return s.slice(0, LEN);
}

// The same name with " 2", " 3" ... when another paired phone has it, still at most LEN characters.
function unique(name, taken) {
  const low = (taken || []).map(x => String(x).toLowerCase());
  if (low.indexOf(name.toLowerCase()) < 0) return name;
  for (let i = 2; i < 100; i++) {
    const tail = ' ' + i,
      cand = name.slice(0, LEN - tail.length).trim() + tail;
    if (low.indexOf(cand.toLowerCase()) < 0) return cand;
  }
  return name;
}

// cb(name): '' when there is no usable name. reverse is dns.reverse, replaced in the tests.
function routerName(addr, cb, reverse) {
  const a = privateV4(addr);
  if (!a) return cb('');
  const now = Date.now(),
    hit = cache[a];
  if (hit && now - hit.at < (hit.name ? KEEP_MS : MISS_MS)) return cb(hit.name);
  let done = false;
  const finish = name => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const keys = Object.keys(cache);
    if (keys.length >= MAX_KEPT) delete cache[keys[0]];
    cache[a] = { name, at: Date.now() };
    cb(name);
  };
  const timer = setTimeout(() => finish(''), WAIT_MS);
  try {
    (reverse || dns.reverse)(a, (err, names) => finish(err || !names || !names.length ? '' : clean(names[0])));
  } catch (e) {
    finish('');
  }
}

// the tests start from an empty cache
const forget = () => Object.keys(cache).forEach(k => delete cache[k]);

module.exports = { clean, unique, routerName, privateV4, forget, LEN };
