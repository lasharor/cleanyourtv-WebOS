// The Spotify add-on (addons/catalog/spotify): the PKCE sign-in, the tokens that stay in the add-on's settings, what the card gets for
// each answer of Spotify, the pace of the requests, the cover, the controls, and the phone page. Spotify is a local stand-in; no real
// token is used. The sign-in, now-playing and control tests are those of the pull request that first added the card (Edenik, #127).
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { root, ok, serve, req, memoryConfig, run } = require('./lib');

const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CID = '0123456789abcdef0123456789abcdef';
const SECRET1 = 'ACCESS-SECRET-one',
  SECRET2 = 'ACCESS-SECRET-two',
  REFRESH1 = 'REFRESH-SECRET-one',
  REFRESH2 = 'REFRESH-SECRET-two';

// a request to the add-on's phone page on 127.0.0.1:8797
function phone(method, p, body, code) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 8797, path: p, method, headers: { 'x-code': code || '' } }, res => {
      const b = [];
      res.on('data', c => b.push(c));
      res.on('end', () => {
        const t = Buffer.concat(b).toString();
        let j = null;
        try {
          j = JSON.parse(t);
        } catch (_) {}
        resolve({ code: res.statusCode, text: t, j });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

run(async () => {
  // what the add-on says is collected, to prove that no token is ever written to the log
  const said = [];

  // ---- the stand-in for accounts.spotify.com and api.spotify.com (and the cover host) ----
  const seen = { token: [], api: 0, art: 0, auth: [], ctl: [] };
  let ctlAnswer = null; // the answer of the control calls: {status, body}
  let playing = null, // the answer of currently-playing: {status, body, headers}
    tokenAnswer = null; // overrides the answer of the token endpoint
  const sp = await serve((rq, rs) => {
    const chunks = [];
    rq.on('data', c => chunks.push(c));
    rq.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (rq.url === '/api/token') {
        const p = {};
        body.split('&').forEach(kv => {
          const i = kv.indexOf('=');
          p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
        });
        seen.token.push(p);
        if (tokenAnswer) {
          rs.writeHead(tokenAnswer.status, { 'content-type': 'application/json' });
          return rs.end(JSON.stringify(tokenAnswer.body));
        }
        rs.writeHead(200, { 'content-type': 'application/json' });
        return rs.end(
          JSON.stringify(
            p.grant_type === 'authorization_code'
              ? {
                  access_token: SECRET1,
                  refresh_token: REFRESH1,
                  expires_in: 3600,
                  token_type: 'Bearer',
                  scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state streaming',
                }
              : { access_token: SECRET2, refresh_token: REFRESH2, expires_in: 3600, token_type: 'Bearer' }
          )
        );
      }
      if (/^\/v1\/me\/player\/currently-playing/.test(rq.url)) {
        seen.api++;
        seen.auth.push(rq.headers.authorization);
        const a = playing || { status: 204 };
        rs.writeHead(a.status, Object.assign({ 'content-type': 'application/json' }, a.headers || {}));
        return rs.end(a.body === undefined ? undefined : JSON.stringify(a.body));
      }
      if (/^\/v1\/me\/player\/(play|pause|next|previous|seek)([?]|$)/.test(rq.url)) {
        seen.ctl.push({ m: rq.method, p: rq.url, auth: rq.headers.authorization });
        const a = ctlAnswer || { status: 204 };
        rs.writeHead(a.status, { 'content-type': 'application/json' });
        return rs.end(a.body === undefined ? undefined : JSON.stringify(a.body));
      }
      if (rq.url === '/v1/me') {
        rs.writeHead(200, { 'content-type': 'application/json' });
        return rs.end(JSON.stringify({ id: 'user1', display_name: 'Test Listener' }));
      }
      if (/^\/cover\//.test(rq.url)) {
        seen.art++;
        if (rq.url === '/cover/text') {
          rs.writeHead(200, { 'content-type': 'text/html' });
          return rs.end('<b>no</b>');
        }
        rs.writeHead(200, { 'content-type': 'image/jpeg' });
        return rs.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
      }
      rs.writeHead(404);
      rs.end();
    });
  });
  process.env.CYTV_SPOTIFY_ACCOUNTS = sp.url;
  process.env.CYTV_SPOTIFY_API = sp.url + '/v1';
  const track = (over, extra) =>
    Object.assign(
      {
        is_playing: true,
        currently_playing_type: 'track',
        progress_ms: 61000,
        device: { name: 'Living room TV' },
        item: {
          name: 'Example Track',
          duration_ms: 200000,
          artists: [{ name: 'Example Artist' }, { name: 'Second Artist' }],
          external_urls: { spotify: 'https://open.spotify.com/track/abc' },
          album: {
            images: [
              { url: sp.url + '/cover/large', width: 640, height: 640 },
              { url: sp.url + '/cover/medium', width: 300, height: 300 },
              { url: sp.url + '/cover/small', width: 64, height: 64 },
            ],
          },
        },
      },
      over,
      extra
    );

  const addonDir = path.join(root, 'addons', 'catalog', 'spotify');
  const NP = require(path.join(addonDir, 'nowplaying.js'));
  // the add-on's settings, in config.json under addons.spotify.settings (a deleted key is set to undefined, which the file leaves out)
  const cfg = memoryConfig({});
  const settings = {
    get: () => Object.assign({}, ((cfg.get().addons || {}).spotify || {}).settings),
    set: o =>
      cfg.update('addon:spotify', c => {
        c.addons = c.addons || {};
        const old = (c.addons.spotify || {}).settings || {};
        c.addons.spotify = { settings: Object.assign({}, old, o) };
      }),
  };
  // the tests below read and change the settings as the module itself does
  const config = {
    get: () => ({ spotify: settings.get() }),
    update: (_s, fn) => {
      const c = { spotify: settings.get() };
      fn(c);
      settings.set(c.spotify);
    },
  };
  const np = NP.create({ settings, fetch: req('fetch'), log: m => said.push(m) });

  // ---- the sign-in ----
  ok(np.prepare('short', '').error, 'a Client ID that is not 32 hex digits is refused');
  ok(np.prepare(CID, 'http://localhost:8888/callback').error, 'localhost is refused as a redirect address (Spotify does not accept it)');
  ok(np.prepare(CID, 'http://192.168.1.5/cb').error, 'a plain http address on the network is refused');
  ok(
    !np.prepare(CID, 'https://example.org/cb').error && !np.prepare(CID, 'http://[::1]:9/cb').error,
    'https and loopback addresses are accepted'
  );
  ok((await np.finish('http://127.0.0.1:8888/callback?code=x&state=y')).error, 'finishing without a prepared sign-in is refused');
  const prep = np.prepare(CID, '');
  const au = new (require('url').URL)(prep.url);
  const q = k => au.searchParams.get(k);
  ok(
    au.origin === sp.url &&
      au.pathname === '/authorize' &&
      q('response_type') === 'code' &&
      q('client_id') === CID &&
      q('code_challenge_method') === 'S256' &&
      q('redirect_uri') === NP.REDIRECT &&
      /user-read-currently-playing/.test(q('scope')) &&
      q('state').length >= 12 &&
      !/secret/i.test(prep.url),
    'the sign-in address carries the client id, S256, the redirect address, the scope and a state, and no secret'
  );
  ok((await np.finish('not an address')).error, 'an address that is not one is refused');
  ok((await np.finish('http://127.0.0.1:8888/callback?error=access_denied&state=' + q('state'))).error, 'a refusal by Spotify is reported');
  ok((await np.finish('http://127.0.0.1:8888/callback?state=' + q('state'))).error, 'an address without a code is refused');
  ok(
    (await np.finish('http://127.0.0.1:8888/callback?code=abc&state=OTHER')).error && seen.token.length === 0,
    'a wrong state is refused before Spotify is asked'
  );
  ok(
    np.now && (await np.now()).playing === false && (await np.now()).connected === false,
    'before the sign-in nothing plays and nothing is asked'
  );
  const signedBefore = np.status().signedIn;
  const st = await np.finish('http://127.0.0.1:8888/callback?code=THE-CODE&state=' + q('state'));
  ok(signedBefore === 0 && np.status().signedIn > 0, 'the status says when the sign-in was finished, so the TV can tell the phone is done');
  const t0 = seen.token[0] || {};
  ok(
    st.connected === true &&
      t0.grant_type === 'authorization_code' &&
      t0.code === 'THE-CODE' &&
      t0.client_id === CID &&
      b64url(
        crypto
          .createHash('sha256')
          .update(t0.code_verifier || '')
          .digest()
      ) === q('code_challenge') &&
      !('client_secret' in t0),
    'the code is exchanged with the verifier that matches the challenge, with no client secret'
  );
  ok(
    settings.get().accessToken === SECRET1 && settings.get().refreshToken === REFRESH1 && settings.get().clientId === CID,
    'the tokens are kept in the settings'
  );
  ok(
    JSON.stringify(st).indexOf('SECRET') < 0 && !/SECRET|0123456789abcdef0123456789abcdef/.test(JSON.stringify(np.status())),
    'the status holds no token and not the whole Client ID'
  );
  ok(
    (await np.finish('http://127.0.0.1:8888/callback?code=THE-CODE&state=' + q('state'))).error,
    'a code works once: the sign-in is used up'
  );

  // ---- what plays ----
  playing = { status: 204 };
  let n = await np.now();
  ok(
    n.playing === false && seen.api === 1 && seen.auth[0] === 'Bearer ' + SECRET1,
    'nothing plays (204): the card stays away; the token goes in the header'
  );
  const clock = Date.now;
  let skew = 0;
  Date.now = () => clock() + skew;
  playing = { status: 200, body: track() };
  n = await np.now();
  ok(n.playing === false && seen.api === 1, 'an idle answer is kept for 10 seconds: no new request');
  skew = 11000;
  n = await np.now();
  ok(
    n.playing === true &&
      n.title === 'Example Track' &&
      n.artist === 'Example Artist, Second Artist' &&
      n.device === 'Living room TV' &&
      n.duration === 200000 &&
      n.progress >= 61000 &&
      n.link === 'https://open.spotify.com/track/abc' &&
      /^[\w-]{8,32}$/.test(n.art) &&
      seen.api === 2,
    'a playing track gives title, artists, device, progress, length, link and a cover key'
  );
  const key = n.art;
  skew += 1500;
  const n2 = await np.now();
  ok(
    seen.api === 2 && n2.progress >= n.progress + 1000 && n2.progress <= n.progress + 2500,
    'within 4 seconds the answer is reused and its progress moves on with the clock'
  );
  skew += 5000;
  playing = { status: 200, body: track({ is_playing: false }) };
  n = await np.now();
  ok(
    n.playing === false && n.paused === true && n.title === 'Example Track',
    'a paused track stays on the card, as paused (to be resumed)'
  );
  skew += 11000;
  playing = { status: 200, body: track({ currently_playing_type: 'ad' }) };
  n = await np.now();
  ok(n.playing === false, 'an advertisement is not shown');
  skew += 11000;
  playing = {
    status: 200,
    body: {
      is_playing: true,
      currently_playing_type: 'episode',
      progress_ms: 5,
      item: {
        name: 'Episode 1',
        duration_ms: 1000,
        show: { name: 'The Show' },
        images: [{ url: sp.url + '/cover/ep', width: 300, height: 300 }],
      },
    },
  };
  n = await np.now();
  ok(n.playing === true && n.title === 'Episode 1' && n.artist === 'The Show', 'a podcast episode shows its show as the artist');

  // ---- the cover ----
  const calls0 = seen.art;
  let a = await np.art(key);
  ok(a && a.type === 'image/jpeg' && a.body.length === 7 && seen.art === calls0 + 1, 'the cover is fetched through the service');
  a = await np.art(key);
  ok(a && seen.art === calls0 + 1, 'and kept for a while: the second request is not sent');
  ok((await np.art('nope')) === null && (await np.art('../etc/passwd')) === null, 'an unknown cover key gives nothing');
  skew += 11000;
  playing = {
    status: 200,
    body: track({}, { item: Object.assign({}, track().item, { album: { images: [{ url: 'https://evil.example/x.jpg', width: 640 }] } }) }),
  };
  n = await np.now();
  ok(n.playing === true && n.art === '', "a cover address that is not Spotify's is never fetched");

  // ---- the token runs out, and Spotify says no ----
  config.update('test', c => {
    c.spotify.expires = clock() + skew + 1000; // a minute or less left
  });
  skew += 11000;
  playing = { status: 200, body: track() };
  n = await np.now();
  const rf = seen.token[seen.token.length - 1];
  ok(
    rf.grant_type === 'refresh_token' &&
      rf.refresh_token === REFRESH1 &&
      rf.client_id === CID &&
      settings.get().accessToken === SECRET2 &&
      settings.get().refreshToken === REFRESH2 &&
      n.playing === true &&
      seen.auth[seen.auth.length - 1] === 'Bearer ' + SECRET2,
    'a token that is about to run out is refreshed first, and the new tokens are kept'
  );
  const before = seen.api;
  skew += 11000;
  playing = { status: 429, headers: { 'retry-after': '120' } };
  n = await np.now();
  ok(n.playing === false && seen.api === before + 1, 'a 429 reads as nothing playing');
  skew += 30000;
  n = await np.now();
  ok(seen.api === before + 1, 'after a 429 Spotify is left alone for the Retry-After time');
  skew += 100000;
  playing = { status: 200, body: track() };
  n = await np.now();
  ok(n.playing === true && seen.api === before + 2, 'and asked again after it');
  // ---- the controls ----
  ok(np.status().controls === true, 'the status says that the controls are allowed (the scope was granted)');
  ok(
    (await np.control('shuffle')).error && (await np.control('')).error && seen.ctl.length === 0,
    'an unknown control is refused before Spotify is asked'
  );
  let cr = await np.control('pause');
  ok(
    cr.ok === true &&
      seen.ctl.length === 1 &&
      seen.ctl[0].m === 'PUT' &&
      seen.ctl[0].p === '/v1/me/player/pause' &&
      seen.ctl[0].auth === 'Bearer ' + SECRET2,
    'pause is a PUT to the player with the token in the header'
  );
  cr = await np.control('play');
  ok(cr.ok && seen.ctl[1].m === 'PUT' && seen.ctl[1].p === '/v1/me/player/play', 'play is a PUT');
  cr = await np.control('next');
  ok(cr.ok && seen.ctl[2].m === 'POST' && seen.ctl[2].p === '/v1/me/player/next', 'next is a POST');
  cr = await np.control('previous');
  ok(cr.ok && seen.ctl[3].m === 'POST' && seen.ctl[3].p === '/v1/me/player/previous', 'previous is a POST');
  const asked = seen.api;
  playing = { status: 200, body: track() };
  await np.now();
  ok(seen.api === asked + 1, 'after a control the next answer is asked for again (not kept)');
  await np.now(true);
  ok(seen.api === asked + 1, 'a fresh ask within a second of the last answer is kept');
  skew += 800;
  await np.now();
  ok(seen.api === asked + 1, 'an ordinary ask 800 ms after an answer is kept');
  await np.now(true);
  ok(seen.api === asked + 2, 'a fresh ask after 800 ms goes to Spotify (the card asks again after a button until the new track shows)');
  ctlAnswer = {
    status: 403,
    body: { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } },
  };
  ok(/Premium/.test((await np.control('pause')).error || ''), 'a free account is told that the controls need Premium');
  ctlAnswer = { status: 403, body: { error: { status: 403, message: 'Insufficient client scope' } } };
  ok(/again/.test((await np.control('pause')).error || ''), 'a sign-in without the scope is told to sign in again');
  // ---- the add-on: the card's data, its buttons and the phone page ----
  ctlAnswer = null;
  const nc = req('netcompat');
  const M = require(path.join(addonDir, 'service.js'));
  const svc = M.create({
    id: 'spotify',
    dir: addonDir,
    dataDir: path.join(process.env.CYTV_DIR, 'addon-data', 'spotify'),
    log: m => said.push(m),
    fetch: req('fetch'),
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => '', wallpaperSize: () => '4k' },
    settings,
  });
  skew += 20000;
  playing = { status: 200, body: track() };
  let f = await svc.cards.feed('nowplaying', {});
  ok(
    f.connected === true &&
      f.playing === true &&
      f.title === 'Example Track' &&
      f.artist === 'Example Artist, Second Artist' &&
      f.duration === 200000 &&
      f.progress >= 61000 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f.cover) &&
      !f.error,
    'the card gets what plays, with the cover as a data: address (its frame has no network): ' + JSON.stringify(f).slice(0, 160)
  );
  ok(JSON.stringify(f).indexOf('SECRET') < 0, 'and no token');
  const apiBefore = seen.api;
  await svc.cards.feed('nowplaying', {});
  ok(seen.api === apiBefore, 'a second ask within the pace asks Spotify nothing');
  ctlAnswer = null;
  seen.ctl.length = 0;
  ok(
    (await svc.cards.action('nowplaying', {}, 'toggle')).ok === true && seen.ctl[0].p === '/v1/me/player/pause',
    'the play-pause button pauses while it plays'
  );
  skew += 20000;
  playing = { status: 200, body: track({ is_playing: false }) };
  await svc.cards.feed('nowplaying', {});
  await svc.cards.action('nowplaying', {}, 'toggle');
  ok(seen.ctl[1].p === '/v1/me/player/play', 'and plays while it is paused');
  await svc.cards.action('nowplaying', {}, 'prev');
  await svc.cards.action('nowplaying', {}, 'next');
  ok(
    seen.ctl[2].p === '/v1/me/player/previous' && seen.ctl[3].p === '/v1/me/player/next',
    'previous and next are the buttons of the same names'
  );
  ok(
    (await svc.cards.action('nowplaying', {}, 'shuffle')).error === 'no such action' && seen.ctl.length === 4,
    'any other action is refused before Spotify is asked'
  );
  ctlAnswer = { status: 403, body: { error: { status: 403, message: 'Player command failed: Premium required' } } };
  ok(
    /Premium/.test((await svc.cards.action('nowplaying', {}, 'next')).error || ''),
    'a free account is told that the controls need Premium'
  );
  ctlAnswer = null;

  // the phone page
  let pr = await svc.settings({});
  const code = pr.code;
  ok(/^\d{6}$/.test(code) && /:8797\/#\d{6}$/.test(pr.qr), 'the settings page opens with a 6-digit code, which the QR code carries');
  let pp = await phone('GET', '/');
  ok(pp.code === 200 && /Spotify/.test(pp.text) && !/ACCESS-SECRET/.test(pp.text), 'the page loads and holds no token');
  pp = await phone('GET', '/api/state', undefined, '000000');
  ok(pp.code === 403, 'the API needs the code');
  pp = await phone('GET', '/api/state', undefined, code);
  ok(
    pp.j.connected === true && JSON.stringify(pp.j).indexOf('SECRET') < 0 && !/0123456789abcdef0123456789abcdef/.test(JSON.stringify(pp.j)),
    'the state says it is connected, with no token and not the whole Client ID'
  );
  pp = await phone('POST', '/api/prepare', { clientId: 'nope' }, code);
  ok(/32 letters and digits/.test(pp.j.error || ''), 'a Client ID of the wrong shape is refused');
  pp = await phone('POST', '/api/prepare', { clientId: CID }, code);
  ok(
    /accounts\.spotify|127\.0\.0\.1/.test(pp.j.url || '') && /code_challenge_method=S256/.test(pp.j.url),
    'the sign-in address comes from the add-on'
  );
  pp = await phone('POST', '/api/disconnect', {}, code);
  ok(
    pp.j.connected === false && !settings.get().accessToken && !settings.get().refreshToken && !settings.get().clientId,
    'Disconnect removes the tokens and the Client ID from the settings'
  );
  f = await svc.cards.feed('nowplaying', {});
  ok(f.connected === false && f.title === '' && /set it up/.test(f.hint), 'the card then says that Spotify is not set up');
  await svc.settings({ stop: true });
  pp = await phone('GET', '/').catch(() => ({ code: 0 }));
  ok(pp.code === 0, 'the phone page is closed again');

  // ---- the card as the service offers it ----
  const fs = require('fs');
  const man = JSON.parse(fs.readFileSync(path.join(addonDir, 'addon.json'), 'utf8'));
  const chk = req('addons').check(man, '1.6.16');
  ok(
    chk.manifest && chk.manifest.provides.join() === 'cards' && chk.manifest.permissions.join() === 'net.fetch',
    'the manifest is accepted and asks for the network only'
  );
  ok(req('addons').check(man, '1.6.15').error, 'it needs the service that has cards for add-ons');
  ok(
    chk.manifest.cards[0].id === 'nowplaying' && chk.manifest.cards[0].actions.map(x => x.name).join() === 'prev,toggle,next',
    'one card with the three buttons'
  );
  const page = fs.readFileSync(path.join(addonDir, 'cards', 'nowplaying', 'card.js'), 'utf8');
  ok(!/XMLHttpRequest|fetch\(|WebSocket|new Image|=>|\bconst\b|\blet\b/.test(page), 'the page is ES5 and makes no request');
  ok(
    /^\d+\.\d+\.\d+$/.test(man.version) && fs.existsSync(path.join(addonDir, 'cards', 'nowplaying', 'card.html')),
    'the page of the card is in the add-on folder'
  );

  // ---- nothing secret anywhere it should not be ----
  ok(!said.some(m => /SECRET|THE-CODE/.test(m)), 'no token or code was written to the log');
  Date.now = clock;
  sp.server.close();
});
