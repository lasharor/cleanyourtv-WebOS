// What the Continue watching card asks of a Jellyfin server (https://api.jellyfin.org): the sign-in, what you were watching (Resume)
// and the next episode of a series you follow (Next up), their pictures, and the TMDB id an app can open a title by. The settings
// (address, access token, user) are the add-on's own settings; the password is only sent to Jellyfin once, at the sign-in, and is
// never kept. The token goes only in the Authorization header to that server and is not logged.
const crypto = require('crypto');

const CLIENT = 'CleanYourTV',
  VERSION = '1.0.0';
// address as typed: "jellyfin.local:8096/web/#/home" -> "http://jellyfin.local:8096"
function base(u) {
  let s = String(u || '')
    .trim()
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
    .replace(/\/web(\/index\.html)?$/i, '')
    .replace(/\/+$/, '');
  if (s && !/^[a-z]+:\/\//i.test(s)) s = 'http://' + s;
  return s;
}
const header = (device, token) =>
  'MediaBrowser Client="' +
  CLIENT +
  '", Device="LG TV", DeviceId="' +
  device +
  '", Version="' +
  VERSION +
  '"' +
  (token ? ', Token="' + token + '"' : '');
const clip = (s, n) => String(s || '').slice(0, n);
const MIN = 600000000; // ticks in a minute

// the picture of an item for a row of wide stills and for a row of posters: {id, type, index, tag} of the image to ask for
function picOf(x, style) {
  const T = x.ImageTags || {},
    B = x.BackdropImageTags || [],
    PB = x.ParentBackdropImageTags || [];
  const ep = x.Type === 'Episode';
  const tries =
    style === 'poster'
      ? [
          ep && x.SeriesId && x.SeriesPrimaryImageTag && { id: x.SeriesId, type: 'Primary', tag: x.SeriesPrimaryImageTag },
          T.Primary && { id: x.Id, type: 'Primary', tag: T.Primary },
        ]
      : ep
        ? [
            T.Primary && { id: x.Id, type: 'Primary', tag: T.Primary },
            x.ParentThumbItemId && x.ParentThumbImageTag && { id: x.ParentThumbItemId, type: 'Thumb', tag: x.ParentThumbImageTag },
            x.ParentBackdropItemId && PB[0] && { id: x.ParentBackdropItemId, type: 'Backdrop', index: 0, tag: PB[0] },
          ]
        : [
            T.Thumb && { id: x.Id, type: 'Thumb', tag: T.Thumb },
            B[0] && { id: x.Id, type: 'Backdrop', index: 0, tag: B[0] },
            x.ParentBackdropItemId && PB[0] && { id: x.ParentBackdropItemId, type: 'Backdrop', index: 0, tag: PB[0] },
            T.Primary && { id: x.Id, type: 'Primary', tag: T.Primary },
          ];
  return tries.filter(Boolean)[0] || null;
}
const two = n => (n < 10 ? '0' : '') + n;
// one item as the card shows it
function itemOf(x) {
  const ep = x.Type === 'Episode',
    u = x.UserData || {};
  const run = +x.RunTimeTicks || 0,
    pos = +u.PlaybackPositionTicks || 0;
  const pct = run && pos ? Math.max(0, Math.min(100, (pos / run) * 100)) : +u.PlayedPercentage || 0;
  const se =
    ep && x.ParentIndexNumber !== undefined && x.IndexNumber !== undefined ? 'S' + two(x.ParentIndexNumber) + 'E' + two(x.IndexNumber) : '';
  return {
    id: String(x.Id || ''),
    kind: ep ? 'episode' : x.Type === 'Movie' ? 'movie' : 'video',
    title: clip(ep ? x.SeriesName || x.Name : x.Name, 120),
    sub: clip(ep ? (se ? se + ' · ' : '') + (x.Name || '') : x.ProductionYear ? String(x.ProductionYear) : '', 160),
    pct: Math.round(pct * 10) / 10,
    left: run && pos ? Math.max(1, Math.round((run - pos) / MIN)) : 0,
    next: !pos,
    seriesId: ep ? String(x.SeriesId || '') : '',
    tmdb: String((x.ProviderIds && (x.ProviderIds.Tmdb || x.ProviderIds.tmdb)) || ''),
    wide: picOf(x, 'wide'),
    poster: picOf(x, 'poster'),
  };
}

function create(o) {
  const fetch = o.fetch,
    settings = o.settings;
  const cfg = () => Object.assign({ url: '', token: '', userId: '', user: '', serverId: '', server: '', device: '' }, settings.get());
  function device() {
    const c = cfg();
    if (/^[0-9a-f]{16,40}$/.test(c.device)) return c.device;
    const d = crypto.randomBytes(12).toString('hex');
    settings.set({ device: d });
    return d;
  }
  // a request to the server; the answer as JSON. A refused token says so (the sign-in has to be done again)
  async function call(p, opts, c) {
    const s = c || cfg(),
      q = opts || {};
    const r = await fetch.read(base(s.url) + p, {
      method: q.method || 'GET',
      body: q.body === undefined ? undefined : JSON.stringify(q.body),
      headers: Object.assign(
        { Authorization: header(device(), s.token), Accept: q.accept || 'application/json' },
        q.body === undefined ? {} : { 'content-type': 'application/json' }
      ),
      idleMs: 15000,
      maxBytes: q.maxBytes || 4 << 20,
      anyStatus: true,
    });
    if (r.status === 401 || r.status === 403)
      throw Object.assign(new Error('Jellyfin refused the sign-in: sign in again from your phone'), { code: 401 });
    if (r.status === 404) throw Object.assign(new Error('Jellyfin answered 404'), { code: 404 });
    if (r.status < 200 || r.status > 299) throw new Error('Jellyfin answered ' + r.status);
    if (q.raw) return r;
    const t = r.body.toString('utf8');
    return t ? JSON.parse(t) : {};
  }

  async function signIn(url, user, pw) {
    const u = base(url);
    if (!/^https?:\/\/[^/\s]+/i.test(u)) return { error: 'the address must be like http://192.168.1.10:8096' };
    if (!String(user || '').trim()) return { error: 'enter your Jellyfin user name' };
    try {
      const r = await call(
        '/Users/AuthenticateByName',
        { method: 'POST', body: { Username: String(user).trim(), Pw: String(pw || '') } },
        { url: u }
      );
      if (!r || !r.AccessToken || !r.User || !r.User.Id) return { error: 'Jellyfin did not sign you in' };
      let server = '';
      try {
        server = clip((await call('/System/Info/Public', {}, { url: u })).ServerName, 80);
      } catch (_) {}
      settings.set({
        url: u,
        token: r.AccessToken,
        userId: r.User.Id,
        user: clip(r.User.Name, 80),
        serverId: String(r.ServerId || ''),
        server,
      });
      tmdbCache = {};
      return status();
    } catch (e) {
      return {
        error: e.code === 401 ? 'Jellyfin refused the user name or password' : 'could not reach Jellyfin: ' + String(e.message || e),
      };
    }
  }
  async function signOut() {
    if (cfg().token) await call('/Sessions/Logout', { method: 'POST', raw: true }).catch(() => {});
    settings.set({ token: '', userId: '', user: '', serverId: '', server: '' });
    return status();
  }
  function status() {
    const c = cfg();
    return { connected: !!(c.url && c.token && c.userId), url: c.url, user: c.user, server: c.server };
  }

  // Resume moved to /UserItems/Resume in Jellyfin 10.9; older servers only know /Users/<id>/Items/Resume
  let oldResume = false;
  const LIST = '&fields=ProviderIds&imageTypeLimit=1&enableUserData=true&enableTotalRecordCount=false';
  async function resume(n) {
    const c = cfg(),
      q = 'limit=' + n + '&mediaTypes=Video' + LIST;
    if (!oldResume)
      try {
        return (await call('/UserItems/Resume?userId=' + encodeURIComponent(c.userId) + '&' + q)).Items || [];
      } catch (e) {
        if (e.code !== 404) throw e;
        oldResume = true;
      }
    return (await call('/Users/' + encodeURIComponent(c.userId) + '/Items/Resume?' + q)).Items || [];
  }
  async function nextUp(n) {
    const c = cfg();
    return (
      (
        await call(
          '/Shows/NextUp?userId=' +
            encodeURIComponent(c.userId) +
            '&limit=' +
            n +
            '&enableResumable=false&disableFirstEpisode=true&enableRewatching=false' +
            LIST
        )
      ).Items || []
    );
  }
  // what the row shows: where you were (newest first), then the next episodes of series that are not in it already
  async function list(n, withNext) {
    const r = (await resume(n)).map(itemOf);
    if (withNext && r.length < n) {
      const seen = {};
      r.forEach(i => i.seriesId && (seen[i.seriesId] = 1));
      for (const i of (await nextUp(n).catch(() => [])).map(itemOf))
        if (r.length < n && !(i.seriesId && seen[i.seriesId])) {
          if (i.seriesId) seen[i.seriesId] = 1;
          r.push(i);
        }
    }
    return r.filter(i => i.id).slice(0, n);
  }

  // the TMDB id of a series (an episode has none of its own that an app can open): asked once per series
  let tmdbCache = {};
  async function seriesTmdb(ids) {
    const want = ids.filter(id => id && tmdbCache[id] === undefined);
    if (want.length) {
      const c = cfg();
      try {
        const r = await call(
          '/Items?userId=' +
            encodeURIComponent(c.userId) +
            '&ids=' +
            want.map(encodeURIComponent).join(',') +
            '&fields=ProviderIds&enableImages=false'
        );
        (r.Items || []).forEach(x => (tmdbCache[x.Id] = String((x.ProviderIds && (x.ProviderIds.Tmdb || x.ProviderIds.tmdb)) || '')));
      } catch (_) {}
      want.forEach(id => tmdbCache[id] === undefined && (tmdbCache[id] = ''));
    }
    const out = {};
    ids.forEach(id => (out[id] = tmdbCache[id] || ''));
    return out;
  }

  // a picture, made small by the server (JPEG): wide stills 384 x 216, posters 200 x 300
  async function picture(ref, style) {
    if (!ref || !/^[0-9a-f-]{32,36}$/i.test(ref.id) || !/^(Primary|Thumb|Backdrop)$/.test(ref.type)) return null;
    const w = style === 'poster' ? 200 : 384,
      h = style === 'poster' ? 300 : 216;
    const p =
      '/Items/' +
      ref.id +
      '/Images/' +
      ref.type +
      (ref.index !== undefined ? '/' + (+ref.index || 0) : '') +
      '?fillWidth=' +
      w +
      '&fillHeight=' +
      h +
      '&quality=72&format=Jpg' +
      (ref.tag ? '&tag=' + encodeURIComponent(ref.tag) : '');
    const r = await call(p, { raw: true, maxBytes: 200 * 1024, accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8' });
    const type = String((r.headers && r.headers['content-type']) || 'image/jpeg').split(';')[0];
    return /^image\/(jpeg|png|webp)$/.test(type) ? { type, body: r.body } : null;
  }

  return { signIn, signOut, status, list, seriesTmdb, picture, base };
}

module.exports = { create, base, itemOf, picOf };
