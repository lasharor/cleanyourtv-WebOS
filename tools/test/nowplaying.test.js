// Now playing (nowplaying.js and the card's parts in cards.js): the PKCE sign-in, the tokens that never leave config.json, what the
// card gets for each answer of Spotify, the pace of the requests, and the cover. Spotify is a local stand-in; no real token is used.
const http = require('http');
const crypto = require('crypto');
const { ok, call, sleep, serve, req, memoryConfig, run } = require('./lib');

const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CID = '0123456789abcdef0123456789abcdef';
const SECRET1 = 'ACCESS-SECRET-one',
  SECRET2 = 'ACCESS-SECRET-two',
  REFRESH1 = 'REFRESH-SECRET-one',
  REFRESH2 = 'REFRESH-SECRET-two';

function phone(method, p, body, code, port) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: port || 8795, path: p, method, headers: { 'x-code': code || '' } }, res => {
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

const phoneCards = (method, p, code) => phone(method, p, undefined, code, 8792);

run(async () => {
  // what the service says is collected, to prove that no token is ever written to the log
  const said = [];
  for (const m of ['log', 'error', 'warn']) {
    const orig = console[m];
    console[m] = (...a) => {
      said.push(a.join(' '));
      orig.apply(console, a);
    };
  }

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
                  scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state',
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

  const NP = req('nowplaying');
  const config = memoryConfig({ lang: 'nl', cards: { side: { type: 'nowplaying' } } });
  const np = NP.create({ config, tick: 25 });

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
    config.get().spotify.accessToken === SECRET1 && config.get().spotify.refreshToken === REFRESH1 && config.get().spotify.clientId === CID,
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
      config.get().spotify.accessToken === SECRET2 &&
      config.get().spotify.refreshToken === REFRESH2 &&
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
  // ---- the cover: the app of the TV on the song that plays, and back to the place it was ----
  ctlAnswer = null;
  skew += 11000;
  playing = { status: 200, body: track({ progress_ms: 100000 }) };
  seen.ctl.length = 0;
  let launched = null;
  const opened = await np.open(async p => {
    launched = p;
    return { returnValue: true };
  });
  ok(
    opened.returnValue === true && launched && launched.contentTarget === 'spotify:track:abc',
    'the app is started with the track that plays as its target'
  );
  await new Promise(r => setTimeout(r, 120));
  ok(!seen.ctl.some(c => /seek/.test(c.p)), 'no seek while the track has not restarted');
  playing = { status: 200, body: track({ progress_ms: 2000 }) }; // the app started the track again from the beginning
  await new Promise(r => setTimeout(r, 200));
  const sk = seen.ctl.filter(c => /seek/.test(c.p));
  ok(
    sk.length === 1 &&
      sk[0].m === 'PUT' &&
      /^\/v1\/me\/player\/seek[?]position_ms=[0-9]+$/.test(sk[0].p) &&
      +sk[0].p.split('=')[1] >= 100000,
    'after the restart it seeks back to where it was (and a little more: the time since)'
  );
  await new Promise(r => setTimeout(r, 120));
  ok(seen.ctl.filter(c => /seek/.test(c.p)).length === 1, 'and only once');
  playing = { status: 200, body: track({ is_playing: false }) };
  skew += 11000;
  await np.now();
  launched = null;
  await np.open(async p => {
    launched = p;
    return { returnValue: true };
  });
  ok(launched && launched.contentTarget === undefined, 'a paused track is not started again: the app opens without a target');
  playing = { status: 200, body: track() };
  ctlAnswer = { status: 404, body: { error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } } };
  ok(/device/.test((await np.control('next')).error || ''), 'no active device is said');
  ctlAnswer = { status: 403, body: { error: { status: 403, message: 'Player command failed: Restriction violated', reason: 'UNKNOWN' } } };
  ok((await np.control('pause')).ok === true, 'a command the player already is in (pause while paused) is not an error');
  ctlAnswer = { status: 429 };
  ok(/busy/.test((await np.control('next')).error || ''), 'a 429 is said, not retried');
  ctlAnswer = null;
  config.update('test', c => {
    c.spotify.scope = 'user-read-currently-playing user-read-playback-state';
  });
  ok(np.status().controls === false, 'a sign-in without the scope shows in the status, so the page can ask to sign in again');
  config.update('test', c => {
    c.spotify.scope = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
  });
  skew += 11000;
  playing = { status: 403 };
  n = await np.now();
  ok(n.playing === false && /Users Management/.test(n.error || ''), 'a 403 says the account is not allowed for the app');
  skew += 11000;
  tokenAnswer = { status: 400, body: { error: 'invalid_grant' } };
  config.update('test', c => {
    c.spotify.expires = 0;
  });
  n = await np.now();
  ok(
    n.playing === false &&
      /again/.test(np.status().error || '') &&
      config.get().spotify.accessToken === undefined &&
      config.get().spotify.refreshToken === undefined &&
      config.get().spotify.clientId === CID,
    'a refused refresh token ends the connection (sign in again) but keeps the Client ID'
  );
  tokenAnswer = null;

  // ---- offline ----
  if (sp.server.closeAllConnections) sp.server.closeAllConnections();
  await new Promise(r => sp.server.close(r));
  config.update('test', c => {
    c.spotify.accessToken = 'x';
    c.spotify.refreshToken = 'y';
    c.spotify.expires = clock() + skew + 3600000;
  });
  skew += 11000;
  n = await np.now();
  ok(n.playing === false, 'with Spotify unreachable the card quietly has nothing to show');
  Date.now = clock;

  // ---- disconnect ----
  ok(np.disconnect().connected === false && config.get().spotify === undefined, 'disconnecting forgets everything');

  // ---- through the cards feature: the card endpoint, the settings page and its phone page ----
  const C = req('cards');
  const cards = C.create({ config, feature: () => ({ resolved: () => ({ slots: [{ id: 'side', card: '' }] }) }) });
  let r = await call(cards, '/api/cards/nowplaying', 'POST', {});
  ok(
    r.code === 200 && r.j.playing === false && r.j.connected === false,
    'the card endpoint answers {playing: false} when Spotify is not set up'
  );
  r = await call(cards, '/api/cards/nowplaying/art/' + key, 'GET');
  ok(r.code === 404, 'a cover that is not known is a 404');
  r = await call(cards, '/api/cards/nowplaying/status', 'POST', {});
  ok(
    r.code === 200 && r.j.connected === false && r.j.redirect === NP.REDIRECT,
    'the settings page reads the state and the redirect address to register'
  );
  r = await call(cards, '/api/cards/nowplaying/pair', 'POST', {});
  if (r.j.error) console.log('     skip  the checks through the phone pages (a port is busy on this machine): ' + r.j.error);
  else {
    const code = r.j.code;
    ok(
      /:8795/.test(r.j.url || '') && /^[0-9]{6}$/.test(code || '') && /#/.test(r.j.qr || ''),
      'the settings page opens a phone page with a code and a QR address'
    );
    await sleep(100);
    let p = await phone('GET', '/api/state', undefined, '000000');
    ok(p.code === 403, 'the Spotify connection needs the phone page code');
    p = await phone('GET', '/api/state', undefined, code);
    ok(
      p.j.connected === false && p.j.redirect === NP.REDIRECT,
      'the phone page shows the connection state and the redirect address to register'
    );
    p = await phone('POST', '/api/prepare', { clientId: 'bad' }, code);
    ok(/32/.test(p.j.error || ''), 'the phone page gets a clear message for a bad Client ID');
    p = await phone('POST', '/api/prepare', { clientId: CID }, code);
    ok(/[/]authorize[?]/.test(p.j.url || ''), 'the phone page gets the sign-in address');
    p = await phone('GET', '/', undefined, '');
    ok(
      p.code === 200 && /<title>Spotify nu aan het spelen/.test(p.text) && /finish/.test(p.text),
      'the phone page has the Spotify connection steps'
    );
    r = await call(cards, '/api/cards/nowplaying/pair', 'POST', { stop: true });
    await sleep(100);
    p = await phone('GET', '/api/state', undefined, code).then(
      x => x,
      () => ({ code: 0 })
    );
    ok(p.code === 0, 'the phone page is closed again when the settings page leaves');
    r = await call(cards, '/api/cards/pair', 'POST', {});
    const ccode = r.j.code;
    await sleep(100);
    const ty = (await phoneCards('GET', '/api/state', ccode)).j.types.filter(t => t.type === 'nowplaying')[0];
    ok(
      ty && ty.name === 'Spotify nu aan het spelen' && !ty.fields.some(f => f.kind === 'spotify') && ty.fields.some(f => f.key === 'bar'),
      "Spotify now playing is a card type with a progress bar choice and no connection part, named in the phone's language"
    );
    await call(cards, '/api/cards/pair', 'POST', { stop: true });
  }
  r = await call(cards, '/api/cards/nowplaying/disconnect', 'POST', {});
  ok(r.code === 200 && r.j.connected === false, 'the settings page can disconnect');

  // ---- nothing secret anywhere it should not be ----
  config.update('test', c => {
    c.spotify = { clientId: CID, accessToken: SECRET1, refreshToken: REFRESH1, expires: 1 };
  });
  const apps = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'helper', 'apps.js'), 'utf8');
  ok(/delete c\.spotify;/.test(apps), 'the launcher does not get the Spotify settings');
  ok(!said.some(l => /SECRET|THE-CODE/.test(l)), 'no token or code was written to the log');
  // the card sends the name of its button to the service as the action: every button name must be one the service knows (a button named prev was refused)
  const cardJs = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app', 'src', 'js', 'cards.js'), 'utf8');
  const names = (/\[('previous'.*?)\]\.forEach/.exec(cardJs) || ['', ''])[1].match(/[a-z]+/g) || [];
  let known = true;
  for (const n of names) if (n !== 'toggle') known = known && (await np.control(n)).error !== 'That is not a control.';
  ok(names.length === 3 && known, 'every button of the card is a control the service knows');
  // every np... function the card calls is defined (a patch once removed one: the first draw threw and the card stayed blank)
  const called = new Set((cardJs.match(/\bnp[A-Z][A-Za-z]*(?=\()/g) || []).filter(n => !/^function /.test(n)));
  const missing = [...called].filter(n => !new RegExp('function ' + n + '\\(').test(cardJs));
  ok(
    called.size > 8 && missing.length === 0,
    'every np function the card calls is defined' + (missing.length ? ': ' + missing.join(', ') : '')
  );
  const cardsSrc = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'helper', 'cards.js'), 'utf8');
  ok(
    /api\/cards\/nowplaying\/open/.test(cardJs) && /nowplaying\/open[^]*?np\.open\([^]*?spotify-beehive/.test(cardsSrc),
    'the cover asks the service to open the Spotify app (it starts it with the track and seeks back)'
  );
  const diag = require('fs').readFileSync(require('path').join(__dirname, '..', 'diagnose.sh'), 'utf8');
  ok(/token\|key\|secret\|password\|url\|webhook\|playlist\|client\/i/.test(diag), 'the report script hides the Client ID and the tokens');
});
