// Live TV (helper/addons-bundled/iptv/service.js, the bundled add-on iptv): pairing from a phone, reading and parsing a playlist, what the viewer did, why a stream does not play, and a
// playlist read on a connection that drops.
const fs = require('fs'),
  path = require('path'),
  http = require('http');
const { root, ok, fake, serve, sleep, req, run } = require('./lib');
const nc = req('netcompat');
const live = require(path.join(root, 'helper', 'addons-bundled', 'iptv', 'service.js'));

// POST a form to a local address
const post = (url, body) =>
  new Promise((resolve, reject) => {
    let b = '';
    const rq = nc.request(
      http,
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) },
        timeout: 4000,
      },
      r => {
        r.on('data', c => (b += c));
        r.on('end', () => resolve({ status: r.statusCode, body: b }));
      }
    );
    rq.on('error', reject);
    rq.end(body);
  });
const ask = async (u, method, body) => {
  const x = fake(u, method);
  await live.handle(x.req, x.res, u.split('?')[0], async () => body || {});
  return { code: x.res.code, j: x.res.out ? JSON.parse(x.res.out) : null };
};

run(async () => {
  // pairing end to end: code, form post, playlist fetch
  const pl = await serve((q, r) => r.end('#EXTM3U\n#EXTINF:-1 group-title="G",Chan A\nhttp://127.0.0.1:1/live/u/p/1.m3u8\n'));
  const pairInfo = (await ask('/api/live/pair', 'POST')).j;
  ok(/^\d{6}$/.test(String(pairInfo.code)) && /^http:\/\//.test(pairInfo.url), 'live pairing gives a 6 digit code and an address');
  const pairPort = new nc.URL(pairInfo.url).port;
  const form = code => 'code=' + code + '&epg=&playlist=' + encodeURIComponent(pl.url + '/pl.m3u');
  ok((await post('http://127.0.0.1:' + pairPort + '/set', form('000000'))).status === 403, 'a wrong code is refused');
  ok(
    (await post('http://127.0.0.1:' + pairPort + '/set', form(pairInfo.code))).status === 200,
    'the right code saves the playlist address'
  );
  let n = 0;
  for (let i = 0; i < 40 && !n; i++) {
    await sleep(150);
    n = ((await ask('/api/live/channels')).j.channels || []).length;
  }
  ok(n === 1, 'the playlist is fetched and parsed');
  pl.server.close();

  // playlist details: quality, country, language, flags, categories, merged streams
  const p = live.parseM3U(
    [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="CNN.us@SD" tvg-country="US" tvg-language="English" group-title="News;World",CNN (480p)',
      'http://h/a1.m3u8',
      '#EXTINF:-1 tvg-id="CNN.us@HD" group-title="News;World",CNN HD',
      'http://h/a2.m3u8',
      '#EXTINF:-1 tvg-id="Foo.nl" group-title="Kids",Foo [Geo-blocked]',
      'http://h/b.m3u8',
      '#EXTGRP:Sport',
      '#EXTINF:-1,Bar 4K [Not 24/7]',
      '#EXTVLCOPT:http-user-agent=X',
      'http://h/c.m3u8|User-Agent=Y',
      '#EXTINF:-1,#### SEPARATOR ####',
      'http://h/x',
      '#EXTINF:-1 tvg-id="" group-title="",Same',
      'http://h/d.m3u8',
      '#EXTINF:-1 tvg-id="" group-title="",Same',
      'http://h/e.m3u8',
    ].join('\n')
  );
  const cnn = p.channels[0],
    foo = p.channels[1],
    bar = p.channels[2];
  ok(
    p.v === 2 && p.channels.length === 5 && p.channels.map(c => c.num).join() === '1,2,3,4,5',
    'playlist: five channels, separators skipped, numbers in order'
  );
  ok(
    cnn.alt.length === 1 && cnn.alt[0].url === 'http://h/a2.m3u8' && cnn.alt[0].q === 'HD' && cnn.q === 'SD',
    'playlist: the same channel id with @SD/@HD is one channel with another stream'
  );
  ok(
    cnn.cc === 'US' && cnn.lang === 'English' && cnn.cats.join() === 'News,World' && p.groups.join() === 'News,World,Kids,Sport',
    'playlist: country, language and several categories'
  );
  ok(
    foo.fl === 1 && foo.cc === 'NL' && bar.fl === 6 && bar.q === '4K' && bar.group === 'Sport',
    'playlist: geo-blocked, part-time and header markers, quality, #EXTGRP'
  );
  ok(new Set(p.channels.map(c => c.key)).size === 5 && /^[0-9a-f]{10}$/.test(cnn.key), 'playlist: every channel has its own key');

  // what the viewer did is kept in the service
  const st = async b => (await ask('/api/live/state', 'POST', b)).code;
  const k1 = 'abcdef0123',
    k2 = 'abcdef0124';
  for (const b of [
    { op: 'fav', key: k1, on: true },
    { op: 'fav', key: k2, on: true },
    { op: 'fav', key: k1, on: false },
    { op: 'recent', key: k1 },
    { op: 'recent', key: k2 },
    { op: 'recent', key: k1 },
    { op: 'failed', key: k2, on: true },
  ])
    await st(b);
  let sv = (await ask('/api/live/state')).j;
  ok(
    sv.fav.join() === k2 && sv.recent.join() === k1 + ',' + k2 && !!sv.failed[k2],
    'state: favourites, recents (newest first) and failed channels'
  );
  ok(
    (await st({ op: 'fav', key: '../x', on: true })) === 400 && (await st({ op: 'nope', key: k1 })) === 400,
    'state: bad keys and operations are refused'
  );
  for (let i = 0; i < 40; i++) await st({ op: 'recent', key: ('0000000000' + i.toString(16)).slice(-10) });
  sv = (await ask('/api/live/state')).j;
  ok(sv.recent.length === 30, 'state: recents are capped');
  await sleep(1300);
  ok(
    JSON.parse(fs.readFileSync(path.join(process.env.CYTV_LIVE_DIR, 'state.json'), 'utf8')).fav.join() === k2,
    'state: written to the live folder'
  );

  // why a stream does not play
  const big = Buffer.alloc(9000, 1);
  const ps = await serve((q, r) => {
    const t = (c, type, body) => {
      r.writeHead(c, type ? { 'content-type': type } : {});
      r.end(body || '');
    };
    if (q.url === '/hls.m3u8') return t(200, 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nseg.ts\n');
    if (q.url === '/drm.m3u8')
      return t(
        200,
        'application/x-mpegurl',
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:10,\nseg.ts\n'
      );
    if (q.url === '/page') return t(200, 'text/html', '<!doctype html><title>login</title>');
    if (q.url === '/go') {
      r.writeHead(302, { location: '/ok.ts' });
      return r.end();
    }
    if (q.url === '/forbidden') return t(403);
    if (q.url === '/missing') return t(404);
    if (q.url === '/boom') return t(502);
    t(200, 'video/mp2t', big);
  });
  const why = async u => (await live.probe(u)).reason;
  const got = [];
  for (const u of ['/ok.ts', '/hls.m3u8', '/drm.m3u8', '/page', '/go', '/forbidden', '/missing', '/boom']) got.push(await why(ps.url + u));
  got.push(await why('http://127.0.0.1:1/x'));
  ok(
    got.join() === 'ok,ok,drm,notvideo,ok,refused,gone,server,unreachable',
    'probe: ok, ok, drm, not a video, redirect followed, refused, gone, server error, unreachable (' + got.join() + ')'
  );
  ok((await ask('/api/live/probe?key=zzzzzzzzzz&i=0')).code === 404, 'probe: only streams of the playlist are asked about');
  ps.server.close();
  await ask('/api/live/reset', 'POST');

  // the guide (issue 13): XMLTV with start/stop before channel, a .gz file, guide channels found by name, and the Xtream fallback
  {
    const stamp = sec => {
      const d = new Date(sec * 1000),
        z = n => String(n).padStart(2, '0');
      return (
        d.getUTCFullYear() +
        z(d.getUTCMonth() + 1) +
        z(d.getUTCDate()) +
        z(d.getUTCHours()) +
        z(d.getUTCMinutes()) +
        z(d.getUTCSeconds()) +
        ' +0000'
      );
    };
    const nowS = Math.floor(Date.now() / 1000);
    const prog = (id, a, b, title) =>
      '  <programme start="' +
      stamp(nowS + a) +
      '" stop="' +
      stamp(nowS + b) +
      '" channel="' +
      id +
      '">\n    <title lang="pl">' +
      title +
      '</title>\n    <desc lang="pl">About ' +
      title +
      '</desc>\n  </programme>\n';
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>\n<tv generator-info-name="made up">\n  <channel id="TVP 1">\n    <display-name lang="pl">TVP 1</display-name>\n    <display-name lang="pl">PL: TVP 1 HD</display-name>\n    <icon src="http://x/logo.png" />\n  </channel>\n  <channel id="Polsat.pl"><display-name>Polsat</display-name></channel>\n  <channel id="tvn.pl">\n    <display-name>TVN HD</display-name>\n  </channel>\n  <channel id="Other">\n    <display-name>Nobody watches this</display-name>\n  </channel>\n' +
      prog('TVP 1', -600, 1800, 'Wiadomosci') +
      prog('TVP 1', 1800, 3600, 'Pogoda') +
      prog('Polsat.pl', -300, 900, 'Fakty') +
      '  <programme channel="tvn.pl" start="' +
      stamp(nowS - 100) +
      '" stop="' +
      stamp(nowS + 900) +
      '"><title>Uwaga</title></programme>\n' +
      prog('Other', -100, 900, 'Unwanted') +
      '</tv>\n';
    const m3u =
      '#EXTM3U\n#EXTINF:-1 tvg-id="TVP1.pl" group-title="PL",PL: TVP 1 FHD\nhttp://127.0.0.1:1/a\n#EXTINF:-1 tvg-id="Polsat.pl" group-title="PL",Polsat\nhttp://127.0.0.1:1/b\n#EXTINF:-1 group-title="PL",TVN\nhttp://127.0.0.1:1/c\n#EXTINF:-1 group-title="PL",No guide for this\nhttp://127.0.0.1:1/d\n';
    const gzs = http.createServer((q, r) => {
      if (q.url === '/pl.m3u') return r.end(m3u);
      if (q.url === '/guide.xml') {
        r.writeHead(200, { 'content-type': 'text/xml' });
        return r.end(xml);
      }
      if (q.url === '/guide-oneline.xml') {
        r.writeHead(200, { 'content-type': 'application/xml' });
        return r.end(xml.replace(/\n\s*/g, '')); // Tunarr's layout: the whole guide on one line
      }
      if (q.url === '/guide.xml.gz') {
        r.writeHead(200, { 'content-type': 'application/gzip' });
        return r.end(require('zlib').gzipSync(Buffer.from(xml)));
      }
      if (q.url.indexOf('/xmltv.php') === 0) {
        r.writeHead(200, { 'content-type': 'text/xml', 'x-query': q.url });
        return r.end(xml);
      }
      if (q.url.indexOf('/get.php') === 0) return r.end(m3u);
      r.writeHead(404);
      r.end();
    });
    await new Promise(r => gzs.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + gzs.address().port,
      lv = live;
    const lcall = async (u, method, b) => {
      const x = fake(u, method);
      await lv.handle(x.req, x.res, u.split('?')[0], async () => b || {});
      return JSON.parse(x.res.out || '{}');
    };
    const settle = async () => {
      let st;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        st = await lcall('/api/live/status');
        if (st.state === 'idle' && st.channels && (st.epg || st.error)) break;
      }
      return st;
    };
    const guideFor = async () => {
      const ch = (await lcall('/api/live/channels')).channels,
        ids = ch.map(c => c[1]);
      return { ids, epg: await lcall('/api/live/epg?ids=' + encodeURIComponent(ids.join(','))) };
    };
    for (const [label, guideUrl] of [
      ['standard attribute order', base + '/guide.xml'],
      ['a .gz file without Content-Encoding', base + '/guide.xml.gz'],
      ['the whole guide on one line (Tunarr)', base + '/guide-oneline.xml'],
    ]) {
      await lcall('/api/live/reset', 'POST');
      await lcall('/api/live/settings', 'POST', { playlistUrl: base + '/pl.m3u', epgUrl: guideUrl });
      const st = await settle(),
        g = await guideFor();
      ok(st.epg === 4, 'guide, ' + label + ': four programmes kept (' + st.epg + ', error "' + st.error + '")');
      ok(
        g.epg['TVP 1'] && g.epg['TVP 1'].now && g.epg['TVP 1'].now[2] === 'Wiadomosci' && g.epg['TVP 1'].next[2] === 'Pogoda',
        'guide, ' + label + ': a channel whose tvg-id differs is found by its name, now and next'
      );
      ok(g.epg['Polsat.pl'] && g.epg['Polsat.pl'].now[2] === 'Fakty', 'guide, ' + label + ': a channel found by its tvg-id');
      ok(
        g.epg['tvn.pl'] && g.epg['tvn.pl'].now[2] === 'Uwaga',
        'guide, ' + label + ': a channel without tvg-id is found by name; a programme on one line works'
      );
      ok(!g.epg.Other && !g.epg['Nobody watches this'], 'guide, ' + label + ': channels nobody lists are left out');
    }
    {
      // text cut between two chunks, entities, a description with a line break, a programme without content, a channel on its own
      const feed = text => {
        const pt = new (require('stream').PassThrough)(),
          b = Buffer.from(text, 'utf8');
        for (let i = 0; i < b.length; i += 7) pt.write(b.slice(i, i + 7));
        pt.end();
        return pt;
      };
      const at = m => stamp(nowS + m);
      const g = await lv.parseEpg(
        feed(
          '<tv><channel id="A.tv"><display-name>A</display-name></channel><channel id="B.tv"/>' +
            '<programme start="' +
            at(-30) +
            '" stop="' +
            at(30) +
            '" channel="A.tv"><title>Caf\u00e9 &amp; Co &#233;</title><desc>It&#39;s\nthe news</desc></programme>' +
            '<programme start="' +
            at(30) +
            '" stop="' +
            at(60) +
            '" channel="B.tv"/>' +
            '<programme start="' +
            at(-9000) +
            '" stop="' +
            at(-8000) +
            '" channel="A.tv"><title>Old</title></programme></tv>'
        ),
        [{ id: 'A.tv', name: 'A', key: 'a' }]
      );
      const a = g.byId['A.tv'] || [];
      ok(
        g.count === 1 && a[0][2] === 'Caf\u00e9 & Co \u00e9' && a[0][3] === "It's\nthe news",
        'guide: text cut between chunks, entities and a line break in a description are kept; empty and old programmes are left out'
      );
    }
    ok(
      lv.nameKey('PL: TVP 1 HD') === lv.nameKey('TVP1') &&
        lv.nameKey('NL|RTL 4 FHD') === lv.nameKey('RTL 4') &&
        lv.nameKey('Café Ünï') === 'cafeuni' &&
        lv.nameKey('ARD') !== lv.nameKey('ZDF'),
      'channel names are compared without country code, quality words, accents and punctuation'
    );
    ok(
      lv.derivedEpgUrl('http://h.example:8080/get.php?username=u&password=p%26q&type=m3u_plus&output=ts') ===
        'http://h.example:8080/xmltv.php?username=u&password=p%26q' &&
        lv.derivedEpgUrl('http://h.example/list.m3u') === '' &&
        lv.derivedEpgUrl('not a url') === '',
      "an Xtream playlist address gives the provider's guide address"
    );
    await lcall('/api/live/reset', 'POST');
    await lcall('/api/live/settings', 'POST', { playlistUrl: base + '/get.php?username=u&password=p&type=m3u_plus' });
    const st2 = await settle();
    ok(
      st2.epg === 4,
      "an empty guide address on an Xtream playlist uses the provider's xmltv.php (" + st2.epg + ', error "' + st2.error + '")'
    );
    await lcall('/api/live/reset', 'POST');
    gzs.close();
  }
  // the launcher plays an Xtream .ts link as a plain src first; the typed HLS tries are fallbacks (issues 9 and 13)
  {
    const src = fs.readFileSync(path.join(root, 'helper', 'addons-bundled', 'iptv', 'src', 'js', 'live.js'), 'utf8');
    const at = src.indexOf('function variantsFor(url) {');
    let i = src.indexOf('{', at),
      depth = 0,
      end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    const vfn = new Function('return ' + src.slice(at, end))();
    const tsv = vfn('http://h/live/u/p/12.ts');
    ok(
      tsv.length === 3 &&
        tsv[0].src === 'http://h/live/u/p/12.ts' &&
        tsv[0].type === '' &&
        /12\.m3u8$/.test(tsv[1].src) &&
        tsv[2].type === 'application/x-mpegURL',
      "launcher: an Xtream .ts link starts as a plain src, then the provider's HLS, then the typed .ts"
    );
    ok(
      vfn('http://h/a.m3u8').length === 1 &&
        vfn('http://h/stream').length === 2 &&
        vfn('http://h/stream')[0].type === '' &&
        vfn('http://h/stream')[1].type === 'application/x-mpegURL',
      'launcher: other addresses (often without an extension) start as a plain src, HLS is the fallback (issue 13)'
    );
    ok(
      /addEventListener\(\s*'error',\s*function \(e\) \{\s*if \(e\.target === v \|\| e\.target\.parentNode === v\) onError\(\);\s*\},\s*true\s*\)/.test(
        src
      ),
      'launcher: a failing <source> is noticed at once (capture phase)'
    );
  }

  // a connection that drops after the headers ends the playlist read with an error, never a hang (issue 5)
  const drop = await serve((q, r) => {
    r.writeHead(200, { 'content-length': '100000' });
    r.write('#EXTM3U\n');
    setTimeout(() => r.socket.destroy(), 150);
  });
  await ask('/api/live/settings', 'POST', { playlistUrl: drop.url + '/pl.m3u' });
  let lerr = '';
  for (let i = 0; i < 40 && !lerr; i++) {
    await sleep(150);
    const js = (await ask('/api/live/status')).j;
    if (js.state === 'idle' && js.error) lerr = js.error;
  }
  ok(
    /lost|closed|reset|socket/i.test(lerr),
    'a playlist read on a connection that drops mid-answer ends with an error' + (lerr ? ' (' + lerr + ')' : ' (it hung)')
  );
  await ask('/api/live/reset', 'POST');
  drop.server.close();
});
