// Now playing for the Now playing card of the Spotify add-on (cards/nowplaying/): what plays on any device of the user's Spotify account, asked through Spotify's Web
// API (GET /v1/me/player/currently-playing). The TV itself offers no such information: the LG Spotify app does not share its track.
// The user brings their own Spotify developer app (the Client ID only: authorization code with PKCE needs no client secret). The sign-in
// happens on a phone page (cards.js): the TV makes the sign-in address, the phone signs in, Spotify sends the browser to the redirect
// address (a loopback address that does not open), and the address that is pasted back holds the code, which only the TV can use.
// The tokens are kept in config.json (root only) under "spotify" and are never logged, returned or shown.
//   create({config}) -> { status(), prepare(clientId, redirect) -> {url}, finish(address) -> status, disconnect() -> status,
//                         now() -> {playing, title, artist, art, link, progress, duration, device} | {playing: false, ...},
//                         art(key) -> {type, body} | null, control(action) -> {ok: true} | {error} (play, pause, next, previous) }
// Gentle on the TV and on Spotify's rate limit: a reply is kept 4 s while something plays and 10 s while nothing does, only one
// request is out at a time, a 429 is waited out (Retry-After), and every failure reads as "nothing playing".
const crypto = require('crypto');
const { URL } = require('url');
const ACCOUNTS = () => process.env.CYTV_SPOTIFY_ACCOUNTS || 'https://accounts.spotify.com',
  API = () => process.env.CYTV_SPOTIFY_API || 'https://api.spotify.com/v1';
const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state streaming',
  NOT_FOUND = 'No device is playing on Spotify.',
  REDIRECT = 'http://127.0.0.1:8888/callback',
  PENDING_MS = 10 * 60 * 1000,
  KEEP_PLAYING = 4000,
  FRESH_GAP = 700,
  KEEP_IDLE = 10000,
  CONTROL = {
    play: ['PUT', '/me/player/play'],
    pause: ['PUT', '/me/player/pause'],
    next: ['POST', '/me/player/next'],
    previous: ['POST', '/me/player/previous'],
  },
  ART_KEEP = 3600 * 1000,
  ART_MAX = 4;
const CLIENT_ID = /^[0-9a-f]{32}$/i,
  // the redirect addresses Spotify accepts: https, or http only on a loopback address written as an IP (not localhost)
  REDIRECT_OK = /^(https:\/\/[^\s/?#]+(\/[^\s?#]*)?|http:\/\/(127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^\s?#]*)?)$/;

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const form = o =>
  Object.keys(o)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k]))
    .join('&');
// a picture address is ours to fetch only when it is Spotify's (or a test stand-in)
const artOk = u =>
  /^https:\/\/([a-z0-9-]+\.)*scdn\.co\//i.test(u) || (!!process.env.CYTV_SPOTIFY_API && u.indexOf(API().replace(/\/v1$/, '') + '/') === 0);

function create(opts) {
  const fetch = opts.fetch;
  // the settings of the add-on (config.json, addons.spotify.settings) as the module below always had them: config.get().spotify and
  // config.update(source, fn); a deleted key is set to undefined, which the file leaves out
  const config = {
    get: () => ({ spotify: opts.settings.get() }),
    update: (_source, fn) => {
      const cur = opts.settings.get(),
        c = { spotify: Object.keys(cur).length ? Object.assign({}, cur) : undefined };
      fn(c);
      const next = {};
      Object.keys(cur).forEach(k => (next[k] = undefined));
      Object.assign(next, c.spotify || {});
      opts.settings.set(next);
    },
  };
  // what happens is written to the service log, never a token, a code or a device's name
  const say = m => (opts.log || console.log)('spotify: ' + m);
  const sp = () => (config.get().spotify && typeof config.get().spotify === 'object' ? config.get().spotify : {});
  let pending = null, // {v, cid, redirect, state, at}
    last = null, // {at, out}
    busy = null,
    blocked = 0, // no request before this time (a 429)
    refreshing = null,
    problem = '', // why the last request did not work, for the phone page
    rejected = '', // 'signin': Spotify no longer accepts the saved sign-in; 'account': it refuses the account for the app; '' otherwise
    told = false, // the launcher has shown the toast about it (once for each time the service runs, that is each time the TV is on)
    signedIn = 0, // when the last sign-in was finished (the TV's screens wait for it)
    who = '', // the name of the account that is signed in (asked from Spotify, kept in memory only)
    asking = false,
    arts = {};

  // who is signed in: the display name Spotify gives for the account (no scope needed), asked once in the background
  function whoAmI() {
    if (who || asking) return;
    asking = true;
    player('GET', '/me')
      .then(r => {
        if (r.error) return;
        const j = JSON.parse(r.body.toString('utf8'));
        who = String(j.display_name || j.id || '').slice(0, 60);
      })
      .catch(() => {})
      .then(() => {
        asking = false;
      });
  }
  function status() {
    const s = sp();
    const connected = !!(s.refreshToken || s.accessToken);
    if (connected && !rejection()) whoAmI();
    return {
      connected,
      account: connected && who ? who : undefined,
      clientId: s.clientId ? String(s.clientId).slice(0, 4) + '…' + String(s.clientId).slice(-4) : '',
      redirect: s.redirect || REDIRECT,
      controls: /user-modify-playback-state/.test(s.scope || ''),
      wake: /streaming/.test(s.scope || ''),
      rejected: rejection() || undefined,
      signedIn,
      error: problem || undefined,
    };
  }
  // the sign-in address for the phone: PKCE (S256), a state to check on return
  function prepare(clientId, redirect) {
    const cid = String(clientId || '').trim();
    if (!CLIENT_ID.test(cid)) return { error: 'The Client ID is 32 letters and digits, from your app on developer.spotify.com.' };
    const red = String(redirect || '').trim() || REDIRECT;
    if (!REDIRECT_OK.test(red)) return { error: 'Spotify accepts only https addresses, or http://127.0.0.1 (not localhost).' };
    const v = b64url(crypto.randomBytes(48)),
      state = b64url(crypto.randomBytes(12));
    pending = { v, cid, redirect: red, state, at: Date.now() };
    const challenge = b64url(crypto.createHash('sha256').update(v).digest());
    return {
      url:
        ACCOUNTS() +
        '/authorize?' +
        form({
          response_type: 'code',
          client_id: cid,
          redirect_uri: red,
          scope: SCOPES,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          state,
        }),
    };
  }
  function post(body) {
    return fetch
      .read(ACCOUNTS() + '/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form(body),
        totalMs: 20000,
        redirects: 0,
        anyStatus: true,
        maxBytes: 64 * 1024,
        allowHttp: () => !!process.env.CYTV_SPOTIFY_ACCOUNTS,
      })
      .then(r => {
        let j = {};
        try {
          j = JSON.parse(r.body.toString('utf8'));
        } catch (_) {}
        return { status: r.status, j: j && typeof j === 'object' ? j : {} };
      });
  }
  function keep(j, clientId, redirect) {
    config.update('spotify', c => {
      const old = c.spotify && typeof c.spotify === 'object' ? c.spotify : {};
      c.spotify = {
        clientId: clientId || old.clientId,
        redirect: redirect || old.redirect,
        accessToken: String(j.access_token),
        // Spotify does not always send a new refresh token: the old one stays valid then
        refreshToken: j.refresh_token ? String(j.refresh_token) : old.refreshToken,
        expires: Date.now() + Math.max(60, +j.expires_in || 3600) * 1000,
        scope: j.scope ? String(j.scope).slice(0, 300) : old.scope,
      };
    });
  }
  // the address the phone was sent back to holds ?code=...&state=...
  async function finish(address) {
    if (!pending || Date.now() - pending.at > PENDING_MS) return { error: 'The sign-in link has expired: start again.' };
    let u;
    try {
      u = new URL(String(address || '').trim());
    } catch (_) {
      return { error: 'That is not an address. Copy the whole address from the browser.' };
    }
    if (u.searchParams.get('error')) return { error: 'Spotify did not allow it. Check that your account is added under Users Management.' };
    const code = u.searchParams.get('code');
    if (!code) return { error: 'There is no code in that address.' };
    if (u.searchParams.get('state') !== pending.state) return { error: 'This address belongs to another sign-in: start again.' };
    const p = pending;
    let r;
    try {
      r = await post({
        grant_type: 'authorization_code',
        code,
        redirect_uri: p.redirect,
        client_id: p.cid,
        code_verifier: p.v,
      });
    } catch (_) {
      return { error: 'Spotify did not answer. Is the TV online?' };
    }
    pending = null; // a code works once
    if (r.status !== 200 || !r.j.access_token) return { error: 'Spotify refused the code: start again.' };
    keep(r.j, p.cid, p.redirect);
    problem = '';
    rejected = '';
    last = null;
    blocked = 0;
    signedIn = Date.now();
    who = '';
    return status();
  }
  function disconnect() {
    config.update('spotify', c => {
      delete c.spotify;
    });
    pending = last = null;
    who = '';
    problem = '';
    rejected = '';
    blocked = 0;
    arts = {};
    return status();
  }

  // Is Spotify turned down for the saved settings? Only where it was set up (a Client ID is saved, which happens only with a finished
  // sign-in). A Client ID without tokens is a sign-in that Spotify refused and that was deleted: that stays known after a restart.
  function rejection() {
    const s = sp();
    if (!s.clientId) return '';
    return !s.refreshToken && !s.accessToken ? rejected || 'signin' : rejected;
  }
  // Spotify turned down the app's settings: the card says so once (a toast), the settings pages always
  function reject(kind, why) {
    if (rejected !== kind) {
      told = false;
      say('Spotify turned the saved settings down (' + kind + '): ' + why);
    }
    rejected = kind;
  }
  // a token that is good for the next minute, or '' (refreshed once at a time)
  async function token() {
    const s = sp();
    if (s.accessToken && s.expires > Date.now() + 60000) return s.accessToken;
    if (!s.refreshToken || !s.clientId) return '';
    if (!refreshing)
      refreshing = post({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId }).then(
        r => {
          refreshing = null;
          if (r.status === 200 && r.j.access_token) {
            keep(r.j);
            say('the token was renewed');
            return sp().accessToken;
          }
          // the refresh token was refused (revoked, or older than six months): sign in again
          if (r.status === 400 || r.status === 401) {
            problem = 'Sign in to Spotify again.';
            reject('signin', 'the refresh was refused (HTTP ' + r.status + ')');
            config.update('spotify', c => {
              if (c.spotify) {
                delete c.spotify.refreshToken;
                delete c.spotify.accessToken;
              }
            });
          }
          return '';
        },
        () => {
          refreshing = null;
          return '';
        }
      );
    return refreshing;
  }

  const idle = extra => Object.assign({ playing: false }, extra || {});
  function pickArt(images) {
    let best = null;
    for (const im of Array.isArray(images) ? images : [])
      if (im && typeof im.url === 'string' && im.width >= 300 && (!best || im.width < best.width)) best = im;
    return best || (Array.isArray(images) && images[0] && typeof images[0].url === 'string' ? images[0] : null);
  }
  function shape(j) {
    const it = j && j.item;
    if (!it) return idle();
    // an advertisement carries no metadata to show
    if (j.currently_playing_type === 'ad') return idle();
    const al = it.album || it.show || {},
      img = pickArt(it.album ? it.album.images : it.images);
    let art = '';
    if (img && artOk(img.url)) {
      art = b64url(crypto.createHash('sha256').update(img.url).digest()).slice(0, 16);
      if (Object.keys(arts).length > 20) arts = {};
      arts[art] = Object.assign(arts[art] || {}, { url: img.url });
    }
    const artists = Array.isArray(it.artists) ? it.artists.map(a => String((a && a.name) || '')).filter(Boolean) : [];
    return {
      playing: j.is_playing === true,
      paused: j.is_playing !== true,
      title: String(it.name || '').slice(0, 200),
      artist: (artists.length ? artists.join(', ') : String((it.show && it.show.name) || al.name || '')).slice(0, 200),
      art,
      link: it.external_urls && typeof it.external_urls.spotify === 'string' ? it.external_urls.spotify.slice(0, 200) : '',
      progress: Math.max(0, +j.progress_ms || 0),
      duration: Math.max(0, +it.duration_ms || 0),
      device: String((j.device && j.device.name) || '').slice(0, 60),
    };
  }
  async function ask(retried) {
    const tok = await token();
    if (!tok) return idle({ error: sp().clientId ? 'Sign in to Spotify again.' : '' });
    let r;
    try {
      r = await fetch.read(API() + '/me/player/currently-playing?additional_types=track,episode', {
        headers: { authorization: 'Bearer ' + tok },
        totalMs: 15000,
        redirects: 0,
        anyStatus: true,
        maxBytes: 256 * 1024,
        allowHttp: () => !!process.env.CYTV_SPOTIFY_API,
      });
    } catch (_) {
      return idle(); // offline: nothing to show, nothing to complain about
    }
    if (r.status === 429) {
      blocked = Date.now() + Math.min(3600, Math.max(5, parseInt(r.headers['retry-after'], 10) || 30)) * 1000;
      return idle();
    }
    if (r.status === 401 && !retried) {
      config.update('spotify', c => {
        if (c.spotify) c.spotify.expires = 0; // the next token() refreshes
      });
      return ask(true);
    }
    if (r.status === 401 || r.status === 403) {
      problem = r.status === 403 ? 'Spotify refused this account for your app: check Users Management.' : 'Sign in to Spotify again.';
      reject(r.status === 403 ? 'account' : 'signin', 'the player answered HTTP ' + r.status);
      return idle({ error: problem });
    }
    problem = '';
    if (rejected) say('Spotify accepts the settings again');
    rejected = '';
    if (r.status !== 200) return idle(); // 204: nothing plays
    try {
      return shape(JSON.parse(r.body.toString('utf8')));
    } catch (_) {
      return idle();
    }
  }
  // what the card shows; the same answer for every caller within a few seconds. fresh: the card asks right after one of its buttons, so
  // an answer older than a second is not good enough (Spotify takes a moment to show a new track, and the card asks again until it does)
  async function now(fresh) {
    const out = await nowAsked(fresh);
    const bad = rejection();
    return bad && !told ? Object.assign({}, out, { rejected: bad }) : out;
  }
  // the launcher showed the toast about a rejection: not again until the service runs anew (or Spotify rejects in another way)
  function tell() {
    if (!told) say('the launcher showed the toast about it');
    told = true;
    return { ok: true };
  }
  async function nowAsked(fresh) {
    const s = sp();
    if (!s.clientId || !(s.refreshToken || s.accessToken)) return idle({ connected: false });
    const keepFor = last && last.out.playing ? KEEP_PLAYING : KEEP_IDLE;
    if (last && Date.now() - last.at < (fresh ? FRESH_GAP : keepFor)) return withAge(last);
    if (Date.now() < blocked) return last ? withAge({ at: last.at, out: idle() }) : idle({ connected: true });
    if (!busy)
      busy = ask(false).then(
        out => {
          busy = null;
          last = { at: Date.now(), out };
          return out;
        },
        () => {
          busy = null;
          return idle();
        }
      );
    const out = await busy;
    return withAge({ at: last ? last.at : Date.now(), out });
  }
  // the progress was read some time ago: the card adds that time to it
  function withAge(x) {
    const out = Object.assign({ connected: true }, x.out);
    if (out.playing && out.progress !== undefined) out.progress = Math.min(out.duration || Infinity, out.progress + (Date.now() - x.at));
    return out;
  }
  // the cover, fetched once and kept for an hour (Spotify allows only temporary caching)
  async function art(key) {
    const k = String(key || '');
    const e = arts[k];
    if (!e || !e.url) return null;
    if (e.body && Date.now() - e.at < ART_KEEP) return { type: e.type, body: e.body };
    try {
      const r = await fetch.read(e.url, {
        totalMs: 15000,
        maxBytes: 2 << 20,
        redirects: 0,
        allowHttp: () => !!process.env.CYTV_SPOTIFY_API,
      });
      const type = String(r.headers['content-type'] || 'image/jpeg');
      if (!/^image\//.test(type)) return null;
      e.body = r.body;
      e.type = type;
      e.at = Date.now();
      const have = Object.keys(arts).filter(x => arts[x].body);
      if (have.length > ART_MAX)
        have
          .sort((a, b) => arts[a].at - arts[b].at)
          .slice(0, have.length - ART_MAX)
          .forEach(x => delete arts[x]);
      return { type, body: r.body };
    } catch (_) {
      return null;
    }
  }
  // play, pause, next or previous on the device that plays (Spotify allows it for Premium accounts, with the scope user-modify-playback-state)
  function control(action) {
    const c = Object.prototype.hasOwnProperty.call(CONTROL, action) ? CONTROL[action] : null;
    return c ? player(c[0], c[1]).then(r => (r.error ? r : { ok: true })) : Promise.resolve({ error: 'That is not a control.' });
  }
  async function player(method, path, body, retried) {
    const s = sp();
    if (!s.clientId || !(s.refreshToken || s.accessToken)) return { error: 'Spotify is not connected.' };
    const tok = await token();
    if (!tok) return { error: 'Sign in to Spotify again.' };
    let r;
    try {
      r = await fetch.read(API() + path, {
        method,
        body,
        headers: { authorization: 'Bearer ' + tok },
        totalMs: 15000,
        redirects: 0,
        anyStatus: true,
        maxBytes: 64 * 1024,
        allowHttp: () => !!process.env.CYTV_SPOTIFY_API,
      });
    } catch (_) {
      return { error: 'Spotify did not answer. Is the TV online?' };
    }
    if (r.status === 401 && !retried) {
      config.update('spotify', x => {
        if (x.spotify) x.spotify.expires = 0;
      });
      return player(method, path, body, true);
    }
    if (r.status === 401) {
      reject('signin', 'a command was answered with HTTP 401');
      return { error: 'Sign in to Spotify again.' };
    }
    if (r.status === 429) return { error: 'Spotify is busy: try again in a moment.' };
    if (r.status === 404) return { error: NOT_FOUND };
    let restricted = false;
    if (r.status === 403) {
      const body = r.body.toString('utf8');
      if (/premium/i.test(body)) return { error: 'Spotify allows the controls only with Premium.' };
      if (/scope/i.test(body)) return { error: 'Sign in to Spotify again to allow the controls.' };
      // "Restriction violated": the player already is as asked (pause while paused, play while playing)
      restricted = /restriction/i.test(body);
      if (!restricted) return { error: 'Spotify did not allow that.' };
    }
    if ((r.status < 200 || r.status >= 300) && !restricted) return { error: 'Spotify did not allow that.' };
    last = null; // the next answer is asked for again
    return { ok: true, body: r.body };
  }
  return { status, prepare, finish, disconnect, now, art, control, tell, REDIRECT };
}

module.exports = { create, REDIRECT, REDIRECT_OK, CLIENT_ID };
