/* ---------- the TV's own name ---------- */

/*
  LG's "TV Name" (Settings > General > Devices > TV Name) is not in the settings store on every firmware: on webOS 10 the
  settingsservice has no deviceName/tvName row, and AirPlay/HomeKit is a native daemon (/usr/sbin/airplay) with no luna
  service to ask. What it does leave behind is Apple's HomeKit store: eight bytes of header, then the name, NUL-terminated.

  Reading it is all we do: the store belongs to that daemon (it also holds the pairing material), so this module never
  writes to it, and it reads only its first 64 bytes: the header and the longest name, never what follows them.
  Anything unreadable or odd falls back to the model name, then to "TV" in the page.
*/

const fs = require('fs');

const STORE = '/var/lib/airplay/HomeKitStore/00.00';
const HEADER = 8; // 02 00 00 00 00 00 00 00
const MAX = 40; // longer than any TV name, and a guard against reading the rest of the store as one string
const HEAD = 64; // how much of the store is read at all

// the name out of the store's bytes: the first NUL-terminated, printable run after the header
function parse(buf) {
  if (!buf || buf.length <= HEADER + 1) return '';
  let name = buf.slice(HEADER).toString('utf8').split('\u0000')[0];
  name = name
    .replace(/[\u0000-\u001f\u007f\ufffd]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name && name.length <= MAX ? name : '';
}

// the name as it is right now, or '' when the store cannot be read (not root, no AirPlay, another firmware). file is for the tests: the
// store itself is read from its first 64 bytes only, never whole.
function read(file) {
  const f = file || STORE;
  let fd = -1;
  try {
    fd = fs.openSync(f, 'r');
    const b = Buffer.alloc(HEAD);
    const n = fs.readSync(fd, b, 0, HEAD, 0);
    return parse(b.slice(0, n));
  } catch (_) {
    return '';
  } finally {
    if (fd >= 0) {
      try {
        fs.closeSync(fd);
      } catch (_) {}
    }
  }
}

module.exports = { parse, read, STORE, HEAD };
