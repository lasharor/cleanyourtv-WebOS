// Wallpapers (wallpapers.js): uploads from the phone page (the code, picture types, limits, deleting), the photo sources that add-ons
// provide, and what an earlier version kept of Immich (handed to the Immich add-on once, or removed). The Immich add-on has its own tests
// (immich.test.js).
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const { ok, call, serve, req, memoryConfig, run, sleep } = require('./lib');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]);

// a request to the phone page on 127.0.0.1:8791
function phone(method, p, body, code, type) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port: 8791,
        path: p,
        method,
        headers: Object.assign({ 'x-code': code || '' }, type ? { 'content-type': type } : {}),
      },
      res => {
        const b = [];
        res.on('data', c => b.push(c));
        res.on('end', () => {
          const t = Buffer.concat(b).toString();
          let j = null;
          try {
            j = JSON.parse(t);
          } catch (_) {}
          resolve({ code: res.statusCode, j, text: t });
        });
      }
    );
    r.on('error', reject);
    r.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
}

run(async () => {
  const W = req('wallpapers');
  ok(
    W.imageType(JPEG) === 'jpg' && W.imageType(PNG) === 'png' && W.imageType(Buffer.from('<svg>')) === '',
    'pictures are told apart by their first bytes'
  );

  const config = memoryConfig({});
  const wp = W.create({ config });
  let r = await call(wp, '/api/wallpapers/status');
  ok(
    r.j.total === 0 && r.j.size === '4k' && r.j.immich === undefined && r.j.legacyImmich === undefined,
    'no photos at first; the picture size is 4K'
  );

  // ---- the phone page ----
  r = await call(wp, '/api/wallpapers/pair', 'POST', {});
  const code = r.j.code;
  ok(/^\d{6}$/.test(code) && /:8791\/#\d{6}$/.test(r.j.qr), 'the phone page opens with a 6-digit code, which the QR code carries');
  await sleep(100);
  let p = await phone('GET', '/');
  ok(
    p.code === 200 && /Upload photos|Choose photos/.test(p.text) && !/Immich/.test(p.text),
    'the page offers Upload photos and nothing about Immich'
  );
  p = await phone('GET', '/api/state', undefined, '000000');
  ok(p.code === 403, 'the API needs the code');
  p = await phone('POST', '/api/upload', JPEG, code, 'image/jpeg');
  ok(p.code === 200 && p.j.uploads === 1, 'a JPEG is uploaded');
  p = await phone('POST', '/api/upload', Buffer.from('<html>not a picture</html>'), code, 'image/jpeg');
  ok(p.code === 400 && /JPEG, PNG or WebP/.test(p.j.error), 'a file that is not a picture is refused');
  p = await phone('POST', '/api/upload', PNG, code, 'image/png');
  const st = (await phone('GET', '/api/state', undefined, code)).j;
  const files = fs.readdirSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'upload'));
  ok(
    st.uploads === 2 && files.length === 2 && files.every(f => /^[a-f0-9]{16}\.(jpg|png)$/.test(f)),
    'uploads get names of their own, in the upload folder: ' + files.join(' ')
  );
  p = await phone('GET', '/api/photo/u/' + st.uploadsList[0], undefined, code);
  ok(p.code === 200, 'the phone page shows an upload');
  r = await call(wp, '/api/wallpapers/photo/u/..%2F..%2Fconfig.json');
  ok(r.code === 404, 'a path that is not an upload id is not served');
  p = await phone('POST', '/api/upload/delete', { id: st.uploadsList[0] }, code);
  ok(
    p.j.ok === true && fs.readdirSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'upload')).length === 1,
    'an upload is deleted from the phone'
  );
  r = await call(wp, '/api/wallpapers/list');
  ok(r.j.photos.length === 1 && /^u\/[a-f0-9]{16}$/.test(r.j.photos[0]), 'the list for the launcher holds the upload');

  r = await call(wp, '/api/wallpapers/remove-uploads', 'POST', {});
  ok(r.j.uploads === 0 && r.j.total === 0, 'all uploads can be removed');
  await call(wp, '/api/wallpapers/pair', 'POST', { stop: true });

  // ---- photo sources: add-ons that provide "wallpapers" ----
  {
    const dirS = path.join(process.env.CYTV_DIR, 'srcphotos');
    fs.mkdirSync(dirS);
    fs.writeFileSync(path.join(dirS, 'a1.jpg'), JPEG);
    fs.writeFileSync(path.join(dirS, 'b2.png'), PNG);
    fs.writeFileSync(path.join(dirS, 'notes.txt'), 'not a picture');
    let photos = ['a1', 'b2', 'bad id', '../x', 'a1', 7, 'notes'],
      nextReply = { url: 'https://images.example.com/p.jpg?w=3840&q=80', credit: 'Photo by Ann\n on Example' },
      settingsReply = { url: 'http://192.168.1.2:8794', code: '123456', qr: 'http://192.168.1.2:8794/#123456', seconds: 900 };
    const settingsCalls = [];
    const good = {
      label: 'Demo',
      list: () => photos,
      file: id =>
        id === 'notes'
          ? path.join(dirS, 'notes.txt')
          : id === 'rel'
            ? 'a1.jpg'
            : id === 'gone'
              ? path.join(dirS, 'gone.jpg')
              : path.join(dirS, id + (id === 'b2' ? '.png' : '.jpg')),
      live: true,
      next: async () => nextReply,
      status: () => ({ summary: '2 photos \u00B7 synced now', error: '' }),
      settings: async o => (settingsCalls.push(o), settingsReply),
    };
    const err0 = console.error;
    let logged = 0;
    console.error = () => logged++;
    const bad = {
      label: 'Bad',
      list: () => {
        throw new Error('boom');
      },
      file: () => {
        throw new Error('boom');
      },
    };
    const mods = [
      { id: 'demo', name: 'Demo', mod: { wallpapers: good } },
      { id: 'broken', name: 'Broken', mod: { wallpapers: bad } },
      { id: 'plain', name: 'Plain', mod: {} },
    ];
    const ws = W.create({
      config: memoryConfig({}),
      feature: n => (n === 'addons' ? { providers: w => (w === 'wallpapers' ? mods : []) } : null),
    });
    const lst = (await call(ws, '/api/wallpapers/list')).j;
    ok(
      lst.photos.filter(x => x.indexOf('s/demo/') === 0).join() === 's/demo/a1,s/demo/b2,s/demo/notes' && lst.photos.indexOf('l/demo') >= 0,
      "a source's photos are listed as s/<add-on>/<id> (valid, once each) and a live source as l/<add-on>: " + lst.photos.join()
    );
    ok(!lst.photos.some(x => /broken|plain/.test(x)), 'a source that throws, and an add-on without a source, offer nothing');
    ok(logged === 1, 'a source that throws is logged once, not at every list');
    const st0 = lst.stamp;
    photos = ['a1'];
    ok(
      (await call(ws, '/api/wallpapers/list')).j.stamp !== st0,
      'the stamp changes when a source has other photos, so Home reads the list again'
    );
    photos = ['a1', 'b2', 'notes'];
    const srv0 = await serve((q, rs) => ws.handle(q, rs, q.url.split('?')[0], async () => ({})));
    const get = p2 =>
      new Promise(resolve =>
        http.get(srv0.url + p2, res => {
          const b = [];
          res.on('data', c => b.push(c));
          res.on('end', () => resolve({ code: res.statusCode, type: res.headers['content-type'], len: Buffer.concat(b).length }));
        })
      );
    let g = await get('/api/wallpapers/photo/s/demo/a1');
    ok(g.code === 200 && g.type === 'image/jpeg' && g.len === JPEG.length, 'it comes with the type of its file: ' + JSON.stringify(g));
    g = await get('/api/wallpapers/photo/s/demo/b2');
    ok(g.code === 200 && g.type === 'image/png', 'a PNG too');
    ok((await get('/api/wallpapers/photo/s/demo/notes')).code === 404, 'a file that is not a picture type is not served');
    ok((await get('/api/wallpapers/photo/s/demo/rel')).code === 404, 'a path that is not absolute is not served');
    ok((await get('/api/wallpapers/photo/s/demo/gone')).code === 404, 'a missing file is a 404');
    ok((await get('/api/wallpapers/photo/s/demo/..%2Fa1')).code === 404, 'an id with a slash is refused');
    ok(
      (await get('/api/wallpapers/photo/s/nobody/a1')).code === 404 && (await get('/api/wallpapers/photo/s/plain/a1')).code === 404,
      'an unknown source, or one without photos, is a 404'
    );
    srv0.server.close();

    let lv = (await call(ws, '/api/wallpapers/live/demo')).j;
    ok(
      lv.url === nextReply.url && lv.credit === 'Photo by Ann  on Example',
      'a live photo gives its address and a credit line without control characters'
    );
    for (const bad2 of [
      'http://images.example.com/p.jpg',
      'https://x.example.com/p"onerror',
      'https://x.example.com/p(1).jpg',
      'javascript:alert(1)',
      'https://x',
      '',
    ]) {
      nextReply = { url: bad2, credit: 'x' };
      lv = (await call(ws, '/api/wallpapers/live/demo')).j;
      ok(lv.error && !lv.url, 'an address Home must not put into a url() is refused: ' + bad2);
    }
    nextReply = { error: 'the hourly limit is used up' };
    lv = (await call(ws, '/api/wallpapers/live/demo')).j;
    ok(lv.error === 'the hourly limit is used up', "a source's own error is passed on");
    ok(
      (await call(ws, '/api/wallpapers/live/plain')).j.error && (await call(ws, '/api/wallpapers/live/nobody')).j.error,
      'a source that is not live, or unknown, has no live photo'
    );

    const sj = (await call(ws, '/api/wallpapers/status')).j;
    ok(
      sj.sources &&
        sj.sources.length === 2 &&
        sj.sources[0].id === 'demo' &&
        sj.sources[0].label === 'Demo' &&
        sj.sources[0].photos === 3 &&
        sj.sources[0].live === true &&
        sj.sources[0].settings === true &&
        sj.sources[0].summary === '2 photos \u00B7 synced now',
      'the status lists the sources with their label, photos and one line: ' + JSON.stringify(sj.sources)
    );
    ok(
      (await call(W.create({ config: memoryConfig({}) }), '/api/wallpapers/status')).j.sources === undefined,
      'without sources the status has no sources key (the reply is the same as before)'
    );
    ok(sj.total === (await call(ws, '/api/wallpapers/list')).j.photos.length, 'the total counts the sources too');

    let sr = await call(ws, '/api/wallpapers/source/demo/settings', 'POST', {});
    ok(
      sr.code === 200 && sr.j.code === '123456' && sr.j.seconds === 900 && settingsCalls[0].stop === false,
      'a source starts its settings page on the phone and gives the address and code'
    );
    sr = await call(ws, '/api/wallpapers/source/demo/settings', 'POST', { stop: true });
    ok(sr.code === 200 && settingsCalls[1].stop === true && Object.keys(sr.j).length === 0, 'and the manager can close it again');
    settingsReply = { error: 'port in use' };
    sr = await call(ws, '/api/wallpapers/source/demo/settings', 'POST', {});
    ok(sr.code === 400 && sr.j.error === 'port in use', "a source's error is passed on");
    sr = await call(ws, '/api/wallpapers/source/broken/settings', 'POST', {});
    ok(sr.code === 400, 'a source without a settings page says so');
    console.error = err0;
  }
});
