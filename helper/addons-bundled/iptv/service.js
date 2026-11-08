// Live TV backend for the launcher: reads an M3U playlist (and its XMLTV guide), serves them to the Live TV app,
// and runs a short-lived pairing page on the LAN so the playlist address can be entered from a phone or computer.
const http = require('http'),
  https = require('https'),
  fs = require('fs'),
  crypto = require('crypto');
const nc = require('../../netcompat'),
  { URL, URLSearchParams } = nc;
const P = require('../../paths'),
  fetch = require('../../fetch'),
  web = require('../../web'),
  i18n = require('../../i18n');
const DIR = P.LIVE;
const SETTINGS = DIR + '/settings.json',
  PLAYLIST = DIR + '/playlist.json',
  EPG = DIR + '/epg.json',
  STATE = DIR + '/state.json';
const PAIR_PORT = 8766,
  PAIR_MS = 10 * 60 * 1000,
  REFRESH_MS = 12 * 3600 * 1000;
try {
  nc.mkdirp(DIR);
} catch (_) {}

const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return d;
  }
};
const writeJson = (f, o) => {
  fs.writeFileSync(f + '.tmp', JSON.stringify(o), { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
}; // the playlist address holds an access key: owner only
let settings = readJson(SETTINGS, {}),
  playlist = readJson(PLAYLIST, null),
  epg = readJson(EPG, null);
// What the viewer did, kept here so it survives launcher updates: favourites, the last channels watched and the channels that failed
// (by channel key, see parseM3U). Capped, and written at most once a second.
const FAIL_MS = 7 * 24 * 3600 * 1000;
let state = (o => ({
  fav: Array.isArray(o.fav) ? o.fav : [],
  recent: Array.isArray(o.recent) ? o.recent : [],
  failed: o.failed && typeof o.failed === 'object' ? o.failed : {},
}))(readJson(STATE, {}));
/** @type {any} */
let stateT = 0;
const saveState = () => {
  clearTimeout(stateT);
  stateT = setTimeout(() => {
    try {
      writeJson(STATE, state);
    } catch (_) {}
  }, 1000);
};
const validKey = k => typeof k === 'string' && /^[0-9a-f]{10}(-\d+)?$/.test(k);
function pruneState() {
  const now = Date.now();
  for (const k of Object.keys(state.failed)) if (!(now - state.failed[k] < FAIL_MS)) delete state.failed[k];
  state.fav = state.fav.filter(validKey).slice(0, 500);
  state.recent = state.recent.filter(validKey).slice(0, 30);
}
function changeState(b) {
  if (!b || typeof b !== 'object') return false;
  if (b.op === 'clear') {
    state.recent = [];
    state.failed = {};
    saveState();
    return true;
  }
  if (!validKey(b.key)) return false;
  if (b.op === 'fav') {
    state.fav = state.fav.filter(k => k !== b.key);
    if (b.on) state.fav.unshift(b.key);
  } else if (b.op === 'recent') {
    state.recent = [b.key].concat(state.recent.filter(k => k !== b.key)).slice(0, 30);
  } else if (b.op === 'failed') {
    if (b.on) state.failed[b.key] = Date.now();
    else delete state.failed[b.key];
  } else return false;
  pruneState();
  saveState();
  return true;
}
let status = { state: 'idle', error: '' };

// ---- fetching: a stream of the playlist or the guide (fetch.js handles redirects, gzip and dropped connections) ----
// sniff: also unpack a body that starts like gzip (a guide published as .xml.gz)
const get = (url, sniff) =>
  fetch.open(url, {
    headers: { 'user-agent': 'cleanyourtv-live', 'accept-encoding': 'gzip' },
    idleMs: 20000,
    statusText: s => 'server answered ' + s,
    unzip: sniff ? 'sniff' : 'header',
  });
const readAll = s =>
  new Promise((res, rej) => {
    const b = [];
    let ended = false;
    s.on('data', c => b.push(c));
    s.on('end', () => {
      ended = true;
      res(Buffer.concat(b).toString('utf8'));
    });
    s.on('error', rej);
    s.on('aborted', () => rej(new Error('the connection was lost')));
    s.on('close', () => {
      if (!ended) rej(new Error('the connection was closed'));
    });
  });

// ---- M3U ----
/** @type {Array<[RegExp, string]>} */
const QUALITY = [
  [/\b(?:4k|uhd|2160p)\b/i, '4K'],
  [/\b(?:fhd|1080[pi])\b/i, 'FHD'],
  [/\b(?:hd|720p)\b/i, 'HD'],
  [/\b(?:sd|480p|576p)\b/i, 'SD'],
];
const qualityOf = s => {
  for (const [re, q] of QUALITY) if (re.test(s)) return q;
  return '';
};
const firstOf = s =>
  String(s || '')
    .split(/[;,]/)[0]
    .trim();
// A short stable key per channel (favourites and recents refer to it): the guide id, else the name and group.
const keyOf = (id, name, group) =>
  crypto
    .createHash('md5')
    .update(id || name + '|' + group)
    .digest('hex')
    .slice(0, 10);
const FL_GEO = 1,
  FL_PART = 2,
  FL_HEADERS = 4;

function parseM3U(text) {
  const lines = text.split(/\r?\n/),
    out = [],
    groups = [],
    byBase = {},
    keys = {};
  let epgUrl = '',
    cur = null,
    grp = '',
    headers = false;
  const addGroup = g => {
    if (g && !groups.includes(g)) groups.push(g);
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#EXTM3U')) {
      const m = l.match(/(?:x-tvg-url|url-tvg)="([^"]*)"/i);
      if (m) epgUrl = m[1].split(',')[0].trim();
      continue;
    }
    if (l.startsWith('#EXTINF')) {
      const attrs = {};
      l.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => {
        attrs[k.toLowerCase()] = v;
        return '';
      });
      cur = {
        id: attrs['tvg-id'] || '',
        name: (attrs['tvg-name'] || l.slice(l.lastIndexOf(',') + 1)).trim(),
        group: (attrs['group-title'] || grp || '').trim(),
        logo: attrs['tvg-logo'] || '',
        country: firstOf(attrs['tvg-country']),
        lang: firstOf(attrs['tvg-language']),
      };
      const nm = l.slice(l.lastIndexOf(',') + 1).trim();
      if (nm) cur.name = nm;
      continue;
    }
    if (/^#EXTGRP:/i.test(l)) {
      grp = l.slice(8).trim();
      continue;
    }
    if (/^#EXTVLCOPT:\s*http-(?:user-agent|referrer)/i.test(l)) {
      headers = true;
      continue;
    }
    if (l[0] === '#') continue;
    if (cur) {
      if (!/^#+/.test(cur.name)) {
        // "#### NL ALGEMEEN ####" lines are separators, not channels
        const idq = (cur.id.match(/@([A-Za-z0-9]+)$/) || [])[1] || '',
          base = cur.id.replace(/@[A-Za-z0-9]+$/, '');
        const q = qualityOf(idq) || qualityOf(cur.name);
        if (cur.id.includes('@') && byBase[base]) {
          // the same channel again (Name.cc@SD, Name.cc@HD): another stream of it
          byBase[base].alt.push({ url: l, q });
        } else {
          const ch = {
            id: cur.id,
            name: cur.name,
            group: cur.group,
            logo: cur.logo,
            url: l,
            num: out.length + 1,
            q,
            cats: cur.group
              ? cur.group
                  .split(';')
                  .map(x => x.trim())
                  .filter(Boolean)
              : [],
            alt: [],
            fl:
              (/geo-?\s?blocked/i.test(cur.name) ? FL_GEO : 0) |
              (/not\s*24\s*\/\s*7/i.test(cur.name) ? FL_PART : 0) |
              (headers || /\|[\w-]+=/.test(l) ? FL_HEADERS : 0),
            cc: cur.country.toUpperCase() || ((base.match(/\.([a-z]{2})$/i) || [])[1] || '').toUpperCase(),
            lang: cur.lang,
          };
          let k = keyOf(base || '', cur.name, cur.group);
          if (keys[k]) k += '-' + ++keys[k];
          else keys[k] = 1;
          ch.key = k;
          if (cur.id.includes('@')) byBase[base] = ch;
          out.push(ch);
          ch.cats.forEach(addGroup);
        }
      }
      cur = null;
      headers = false;
    }
  }
  return { v: 2, epgUrl, groups, channels: out, fetchedAt: Date.now() };
}

// ---- why a stream does not play: ask the stream address the way the player does and sort the answer ----
// Only addresses of channels in the stored playlist are ever asked, never one given by the page.
const probeCache = {};
function probe(url) {
  return new Promise(resolve => {
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return resolve({ reason: 'unknown' });
    }
    const t0 = Date.now();
    let done = false;
    const fin = o => {
      if (!done) {
        done = true;
        o.ms = Date.now() - t0;
        resolve(o);
      }
    };
    const lib = u.protocol === 'https:' ? https : http;
    const go = (target, depth) => {
      const req = nc.get(
        lib,
        target,
        { headers: { 'user-agent': 'cleanyourtv-live', range: 'bytes=0-8191', accept: '*/*' }, timeout: 8000, rejectUnauthorized: false },
        res => {
          const st = res.statusCode;
          if (st >= 300 && st < 400 && res.headers.location && depth < 5) {
            res.resume();
            return go(new URL(res.headers.location, target), depth + 1);
          }
          const type = String(res.headers['content-type'] || '')
            .toLowerCase()
            .split(';')[0]
            .trim();
          const first = Date.now() - t0;
          if (st >= 400 || st < 200) {
            res.resume();
            return fin({ reason: st === 404 || st === 410 ? 'gone' : st >= 500 ? 'server' : 'refused', status: st, type });
          }
          const b = [];
          let n = 0;
          res.on('data', c => {
            b.push(c);
            n += c.length;
            if (n > 8192) {
              res.destroy();
            }
          });
          const end = () => {
            const head = Buffer.concat(b).toString('utf8', 0, 8192);
            if (/^\s*#EXTM3U/.test(head)) {
              if (
                /#EXT-X-(?:SESSION-)?KEY:[^\n]*(?:METHOD=SAMPLE-AES|KEYFORMAT="(?:com\.apple\.streamingkeydelivery|urn:uuid:[^"]*)")/i.test(
                  head
                )
              )
                return fin({ reason: 'drm', status: st, type });
              return fin({ reason: first > 5000 ? 'slow' : 'ok', status: st, type, hls: true });
            }
            if (/^(?:text\/|application\/(?:json|xml|xhtml))/.test(type) || /^\s*<(?:!doctype|html)/i.test(head))
              return fin({ reason: 'notvideo', status: st, type });
            fin({ reason: first > 5000 ? 'slow' : 'ok', status: st, type });
          };
          res.on('end', end);
          res.on('close', end);
          res.on('error', () => fin({ reason: 'unreachable' }));
        }
      );
      req.on('timeout', () => {
        req.destroy();
        fin({ reason: 'slow' });
      });
      req.on('error', () => fin({ reason: 'unreachable' }));
    };
    go(u, 0);
  });
}
async function probeCached(url) {
  const c = probeCache[url];
  if (c && Date.now() - c.at < 60000) return c.r;
  const r = await probe(url);
  probeCache[url] = { at: Date.now(), r };
  const keys = Object.keys(probeCache);
  if (keys.length > 50) delete probeCache[keys[0]];
  return r;
}

// ---- XMLTV (streamed: the guide can be tens of MB) ----
const decode = s =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
function xmltvTime(s) {
  const m = s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-]\d{4})?/);
  if (!m) return 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    t -= sign * (+m[7].slice(1, 3) * 60 + +m[7].slice(3, 5)) * 60000;
  }
  return Math.floor(t / 1000);
}
// Names are compared without case, accents, a leading country code ("PL: ", "NL|"), quality words and punctuation:
// "PL: TVP 1 HD", "TVP 1" and "tvp1" are the same channel.
const QWORDS = /\b(?:uhd|fhd|hd|sd|4k|hevc|h265|raw)\b/g;
const nameKey = s => {
  let t = String(s || '').toLowerCase();
  try {
    t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (_) {}
  t = t
    .replace(/^\s*[a-z]{2}\s*[:|]\s*/, '')
    .replace(/&/g, 'and')
    .replace(QWORDS, ' ');
  return t.replace(/[^a-z0-9]+/g, '');
};
const attr = (tag, name) => {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')'));
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
};
const textOf = (block, name) => {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>'));
  return m ? decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : '';
};
// The guide is cut into <channel> and <programme> blocks wherever they sit in the stream: generators differ in their line breaks
// (Tunarr sends the whole file on a few lines, with newlines inside the descriptions) and in the order of the attributes.
async function parseEpg(stream, channels) {
  const byId = {},
    map = {};
  const want = new Set(channels.map(c => c.id).filter(Boolean)),
    byName = {};
  for (const c of channels) {
    const k = nameKey(c.name);
    if (k) (byName[k] = byName[k] || []).push(c);
  }
  const keep = new Set(want),
    now = Math.floor(Date.now() / 1000),
    from = now - 3600,
    to = now + 36 * 3600;
  let buf = '',
    count = 0;
  const handle = (tag, block) => {
    const open = block.slice(0, block.indexOf('>') + 1),
      id = attr(open, tag === 'programme' ? 'channel' : 'id');
    if (id === null) return;
    if (tag === 'channel') {
      // a guide channel that is none of the playlist's ids may still have the name of one
      if (want.has(id)) return;
      const names = [];
      block.replace(/<display-name[^>]*>([^<]*)<\/display-name>/g, (_, n) => {
        names.push(decode(n));
        return '';
      });
      for (const n of names)
        for (const c of byName[nameKey(n)] || []) {
          map[c.key] = id;
          keep.add(id);
        }
      return;
    }
    const st = attr(open, 'start'),
      sp = attr(open, 'stop');
    if (!st || !sp || !keep.has(id)) return;
    const s = xmltvTime(st),
      e = xmltvTime(sp),
      t = textOf(block, 'title');
    if (!(e > from && s < to) || /^no data$/i.test(t)) return;
    const d = textOf(block, 'desc').slice(0, 220);
    (byId[id] = byId[id] || []).push(d ? [s, e, t, d] : [s, e, t]);
    count++;
  };
  const drain = () => {
    for (;;) {
      const m = /<(channel|programme)\b/.exec(buf);
      if (!m) {
        buf = buf.slice(-10); // the header is not kept; a tag cut in two stays in the last characters
        return;
      }
      const a = m.index,
        tag = m[1],
        te = buf.indexOf('>', a);
      if (te < 0) {
        buf = buf.slice(a);
        return;
      }
      if (buf.charAt(te - 1) === '/') {
        // <channel id="x"/> and <programme .../> have no content
        handle(tag, buf.slice(a, te + 1));
        buf = buf.slice(te + 1);
        continue;
      }
      const b = buf.indexOf('</' + tag + '>', te);
      if (b < 0) {
        buf = buf.slice(a);
        return;
      }
      handle(tag, buf.slice(a, b));
      buf = buf.slice(b + tag.length + 3);
    }
  };
  await new Promise((resolve, reject) => {
    let n = 0;
    stream.setEncoding('utf8'); // a character cut between two chunks is kept whole
    stream.on('data', chunk => {
      buf += chunk;
      drain();
      if (++n % 40 === 0) {
        stream.pause();
        setImmediate(() => stream.resume());
      } // leave CPU for the UI
    });
    let ended = false;
    stream.on('end', () => {
      ended = true;
      resolve();
    });
    stream.on('error', reject);
    stream.on('aborted', () => reject(new Error('the connection was lost')));
    stream.on('close', () => {
      if (!ended) reject(new Error('the connection was closed'));
    });
    stream.resume();
  });
  for (const id in byId) byId[id].sort((a, b) => a[0] - b[0]);
  for (const k in map) if (!byId[map[k]]) delete map[k];
  return { v: 5, fetchedAt: Date.now(), count, byId, map };
}
async function loadEpg(url, channels) {
  return parseEpg(await get(url, true), channels);
}
// An Xtream playlist (…/get.php?username=…&password=…) has its guide at xmltv.php on the same server.
function derivedEpgUrl(playlistUrl) {
  try {
    const u = new URL(playlistUrl);
    const us = u.searchParams.get('username'),
      pw = u.searchParams.get('password');
    if (/\/get\.php$/i.test(u.pathname) && us && pw)
      return (
        u.protocol +
        '//' +
        u.host +
        u.pathname.replace(/get\.php$/i, 'xmltv.php') +
        '?username=' +
        encodeURIComponent(us) +
        '&password=' +
        encodeURIComponent(pw)
      );
  } catch (_) {}
  return '';
}

let refreshing = false;
async function refresh(force) {
  if (refreshing || !settings.playlistUrl) return;
  refreshing = true;
  status = { state: 'loading playlist', error: '' };
  try {
    if (force || !playlist || playlist.v !== 2 || Date.now() - playlist.fetchedAt > REFRESH_MS) {
      playlist = parseM3U(await readAll(await get(settings.playlistUrl)));
      if (!playlist.channels.length) throw new Error('no channels found in that playlist');
      writeJson(PLAYLIST, playlist);
    }
    status = { state: 'idle', error: '' };
    const epgUrl = settings.epgUrl || playlist.epgUrl || derivedEpgUrl(settings.playlistUrl);
    if (epgUrl && (force || !epg || epg.v !== 5 || Date.now() - epg.fetchedAt > REFRESH_MS)) {
      status = { state: 'loading guide', error: '' };
      try {
        epg = await loadEpg(epgUrl, playlist.channels);
        writeJson(EPG, epg);
      } catch (e) {
        status = { state: 'idle', error: 'guide: ' + e.message };
      }
    }
    if (status.state !== 'idle') status = { state: 'idle', error: status.error };
  } catch (e) {
    status = { state: 'idle', error: e.message };
  }
  refreshing = false;
}

// ---- pairing page (LAN, short-lived, needs the code shown on the TV) ----
let pair = null;
const lanIp = web.lanIp,
  esc = web.esc;
// in the phone's language (i18n.js); msg is English and translated here too
const page = (msg, ok, lang) => {
  const T = x => esc(i18n.tr(lang, x));
  return `<!doctype html><html lang=${lang}><meta name=viewport content="width=device-width,initial-scale=1"><title>${T('Live TV setup')}</title>
<style>body{font:18px system-ui,sans-serif;background:#111;color:#eee;max-width:560px;margin:40px auto;padding:0 18px}input,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;margin:6px 0 14px;border-radius:10px;border:1px solid #444;background:#1b1b1b;color:#eee}button{background:#f5f6f8;color:#111;font-weight:600;border:0}.m{padding:12px;border-radius:10px;background:${ok ? '#14361f' : '#3a1717'}}</style>
<h2>${T('Live TV setup')}</h2>${msg ? `<p class=m>${T(msg)}</p>` : ''}${
    ok
      ? ''
      : `<form method=post action=/set>
<label>${T('Code shown on the TV')}</label><input name=code inputmode=numeric autocomplete=off required>
<label>${T('Playlist address (M3U)')}</label><input name=playlist type=url placeholder="http://..." required>
<label>${T('Guide address (XMLTV, optional)')}</label><input name=epg type=url placeholder="${T("leave empty to use the playlist's")}">
<button>${T('Save')}</button></form>`
  }`;
};
function startPairing() {
  stopPairing();
  const code = String(nc.randomInt(100000, 1000000));
  let bad = 0;
  const srv = http.createServer((req, res) => {
    const send = (c, html) => {
      res.writeHead(c, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    };
    const lg = i18n.lang(req, '');
    if (req.method === 'GET') return send(200, page('', false, lg));
    if (req.method === 'POST' && req.url === '/set') {
      let b = '';
      req.on('data', c => {
        b += c;
        if (b.length > 8192) req.destroy();
      });
      req.on('end', () => {
        const f = new URLSearchParams(b);
        if (f.get('code') !== code) {
          if (++bad >= 5) stopPairing();
          return send(403, page('Wrong code.', false, lg));
        }
        const url = (f.get('playlist') || '').trim(),
          epgUrl = (f.get('epg') || '').trim();
        if (!/^https?:\/\//i.test(url)) return send(400, page('The playlist address must start with http:// or https://', false, lg));
        settings = { playlistUrl: url, epgUrl: /^https?:\/\//i.test(epgUrl) ? epgUrl : '' };
        writeJson(SETTINGS, settings);
        playlist = null;
        epg = null;
        refresh(true);
        send(200, page('Saved. The TV is loading your channels now; you can close this page.', true, lg));
        setTimeout(stopPairing, 2000);
      });
      return;
    }
    send(404, page('Not found', false, lg));
  });
  srv.on('error', () => {
    pair = null;
  });
  srv.listen(PAIR_PORT, '0.0.0.0');
  pair = { code, srv, url: 'http://' + lanIp() + ':' + PAIR_PORT, until: Date.now() + PAIR_MS, timer: setTimeout(stopPairing, PAIR_MS) };
  return { url: pair.url, code, seconds: PAIR_MS / 1000 };
}
function stopPairing() {
  if (pair) {
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
}

// ---- HTTP API (mounted under /api/live by the helper) ----
async function handle(req, res, u, body) {
  const json = (o, c) => {
    res.writeHead(c || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  const q = new URL(req.url, 'http://x').searchParams;
  if (u === '/api/live/status')
    return json({
      configured: !!settings.playlistUrl,
      channels: playlist ? playlist.channels.length : 0,
      epg: epg ? epg.count : 0,
      state: status.state,
      error: status.error,
      pairing: pair ? { url: pair.url, code: pair.code } : null,
    });
  if (u === '/api/live/channels') {
    if (settings.playlistUrl && (!playlist || playlist.v !== 2)) refresh(false);
    // [number, id, name, group, logo, url, key, country, language, quality, flags, categories, other streams as [url, quality]]
    return json(
      playlist
        ? {
            groups: playlist.groups,
            channels: playlist.channels.map(c => [
              c.num,
              guideId(c),
              c.name,
              c.group,
              c.logo,
              c.url,
              c.key || '',
              c.cc || '',
              c.lang || '',
              c.q || '',
              c.fl || 0,
              c.cats || [],
              (c.alt || []).map(a => [a.url, a.q || '']),
            ]),
          }
        : { groups: [], channels: [] }
    );
  }
  if (u === '/api/live/epg') {
    const out = {},
      now = Math.floor(Date.now() / 1000);
    for (const id of (q.get('ids') || '').split(',').filter(Boolean).slice(0, 60)) {
      const list = epg && epg.byId[id];
      if (!list) continue;
      const i = list.findIndex(p => p[1] > now);
      if (i < 0) continue;
      if (q.get('full')) out[id] = { list: list.slice(i, i + 8) };
      else out[id] = { now: list[i][0] <= now ? list[i] : null, next: list[list[i][0] <= now ? i + 1 : i] || null };
    }
    return json(out);
  }
  if (u === '/api/live/state' && req.method === 'GET') {
    pruneState();
    return json(state);
  }
  if (u === '/api/live/state' && req.method === 'POST') {
    const b = await body(req);
    return changeState(b) ? json({ returnValue: true }) : json({ error: 'bad request' }, 400);
  }
  if (u === '/api/live/probe') {
    // ?key=<channel key>&i=<stream number, 0 is the main one>
    const ch = playlist && playlist.channels.find(c => c.key === q.get('key')),
      i = parseInt(q.get('i') || '0', 10) || 0;
    const url = ch && (i === 0 ? ch.url : (ch.alt[i - 1] || {}).url);
    if (!url) return json({ error: 'no such stream' }, 404);
    return json(await probeCached(url));
  }
  if (u === '/api/live/pair' && req.method === 'POST') return json(startPairing());
  if (u === '/api/live/refresh' && req.method === 'POST') {
    refresh(true);
    return json({ returnValue: true });
  }
  if (u === '/api/live/settings' && req.method === 'POST') {
    const b = await body(req);
    if (typeof b.playlistUrl !== 'string' || !/^https?:\/\//i.test(b.playlistUrl)) return json({ error: 'bad playlist address' }, 400);
    settings = { playlistUrl: b.playlistUrl, epgUrl: /^https?:\/\//i.test(b.epgUrl || '') ? b.epgUrl : '' };
    writeJson(SETTINGS, settings);
    playlist = null;
    epg = null;
    refresh(true);
    return json({ returnValue: true });
  }
  if (u === '/api/live/reset' && req.method === 'POST') {
    settings = {};
    playlist = null;
    epg = null;
    for (const f of [SETTINGS, PLAYLIST, EPG, STATE])
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    state = { fav: [], recent: [], failed: {} };
    return json({ returnValue: true });
  }
  res.writeHead(404);
  res.end();
}

// the id the page asks the guide with: the playlist's own, or the guide channel found by name
const guideId = c => (epg && epg.byId && epg.byId[c.id] ? c.id : (epg && epg.map && epg.map[c.key]) || c.id);

// refresh once shortly after start (low priority), then twice a day
function start() {
  if (settings.playlistUrl) setTimeout(() => refresh(false), 20000);
  setInterval(() => refresh(false), 6 * 3600 * 1000).unref();
}

// the add-on's ctx is not needed: this part keeps its own state (it was a part of the service before add-ons, and still answers /api/live/)
const create = (/** @type {any} */ _ctx) => ({ handle, start });

module.exports = { create, handle, parseM3U, parseEpg, probe, derivedEpgUrl, nameKey };
