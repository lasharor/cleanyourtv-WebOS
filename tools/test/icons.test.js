// Custom app icons (icons.js): a picture kept per app (picture types, the size limit, app ids, a new picture replacing the old one),
// the phone page (the code, the apps without the inputs, upload, reset, the app chosen on Home in the QR code), the launcher's Reset
// icon, and apps.js: GET /icon/<app id> sends the custom picture first and /api/apps marks the app with iv.
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const { ok, call, serve, req, memoryConfig, run, sleep, tmp } = require('./lib');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]);

// a request to the phone page on 127.0.0.1:8794
function phone(method, p, body, code, type) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port: 8794,
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
// a GET with the raw reply
function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, res => {
        const b = [];
        res.on('data', c => b.push(c));
        res.on('end', () => resolve({ code: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(b) }));
      })
      .on('error', reject);
  });
}

run(async () => {
  const I = req('icons');
  const dir = path.join(process.env.CYTV_DIR, 'icons');
  ok(I.set('com.example.app', PNG) === '' && /\.png$/.test(I.find('com.example.app')), 'a PNG is kept for an app');
  ok(/JPEG, PNG or WebP/.test(I.set('com.example.app', Buffer.from('<svg/>'))), 'a file that is not a picture is refused');
  ok(I.set('../config', PNG) === 'not an app' && I.set('.hidden', PNG) === 'not an app', 'a name that is not an app id is refused');
  ok(/1 MB/.test(I.set('com.example.app', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))), 'a picture over 1 MB is refused');
  ok(
    I.set('com.example.app', JPEG) === '' && /\.jpg$/.test(I.find('com.example.app')) && fs.readdirSync(dir).length === 1,
    'a new picture replaces the old one, also of another type: ' + fs.readdirSync(dir).join(' ')
  );
  const v = I.versions();
  ok(
    typeof v['com.example.app'].v === 'number' && v['com.example.app'].tile === false && Object.keys(v).length === 1,
    'the versions list every custom picture, with how it is shown'
  );
  ok(
    I.set('com.example.app', PNG, true) === '' &&
      /[\\/]tile[\\/]com\.example\.app\.png$/.test(I.find('com.example.app')) &&
      I.versions()['com.example.app'].tile === true &&
      !fs.existsSync(path.join(dir, 'com.example.app.jpg')),
    'a Full tile picture is kept apart and replaces the Icon picture'
  );
  ok(
    I.set('com.example.app', JPEG) === '' &&
      I.find('com.example.app') === path.join(dir, 'com.example.app.jpg').split(path.sep).join('/') &&
      !fs.existsSync(path.join(dir, 'tile', 'com.example.app.png')),
    'back to Icon replaces the Full tile picture'
  );
  ok(
    I.remove('com.example.app') === true && I.find('com.example.app') === '' && I.remove('com.example.app') === false,
    'reset removes the picture, once'
  );

  // ---- the phone page, with a stand-in for apps.js ----
  const own = path.join(tmp, 'app-own');
  fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, 'i.png'), JPEG);
  const list = [
    { id: 'com.example.app', title: 'Example', folder: own, icon: 'i.png' },
    { id: 'com.webos.app.hdmi1', title: 'HDMI 1', input: 1 },
  ];
  // the tiles of a theme: dock 236 x 150, grid 165 x 150 (CSS pixels)
  const theme = { resolved: () => ({ vars: { '--dock-w': '236px', '--dock-h': '150px', '--tile-w': '165px', '--tile-h': '150px' } }) };
  const ic = I.create({
    config: memoryConfig({}),
    feature: n => (n === 'apps' ? { apps: async () => list } : n === 'theme' ? theme : null),
  });
  let r = await call(ic, '/api/icons/pair', 'POST', { app: 'com.example.app', scale: 2 });
  const code = r.j.code;
  ok(
    /^\d{6}$/.test(code) && /:8794\/#\d{6}\/com\.example\.app$/.test(r.j.qr),
    'the phone page opens with a 6-digit code; the QR code carries the app chosen on Home'
  );
  ok(
    JSON.stringify(r.j.sizes) === JSON.stringify({ tile: { w: 472, h: 300 }, grid: { w: 330, h: 300 }, icon: 512 }),
    "the sizes that fit the theme's tiles, in the screen's pixels (scale 2 on a 4K TV): " + JSON.stringify(r.j.sizes)
  );
  await sleep(100);
  let p = await phone('GET', '/');
  ok(p.code === 200 && /App icons/.test(p.text), 'the page is served');
  p = await phone('GET', '/api/state', undefined, '000000');
  ok(p.code === 403, 'the API needs the code');
  p = await phone('GET', '/api/state', undefined, code);
  ok(
    p.j.apps.length === 1 && p.j.apps[0].id === 'com.example.app' && p.j.apps[0].custom === false,
    'the page lists the apps, not the inputs'
  );
  ok(p.j.sizes && p.j.sizes.tile.w === 472, 'the page gets the sizes too');
  p = await phone('GET', '/api/icon/com.example.app', undefined, code);
  ok(p.code === 200, "without a picture the page shows the app's own icon");
  p = await phone('POST', '/api/upload/com.other.app', PNG, code, 'image/png');
  ok(p.code === 400, 'a picture for an app that is not installed is refused');
  p = await phone('POST', '/api/upload/com.example.app', PNG, code, 'image/png');
  ok(p.code === 200 && /\.png$/.test(I.find('com.example.app')), 'a picture is uploaded for an app');
  p = await phone('GET', '/api/state', undefined, code);
  ok(p.j.apps[0].custom === true && p.j.apps[0].tile === false, 'the page marks the app as having its own picture');
  p = await phone('POST', '/api/upload/com.example.app?tile=1', JPEG, code, 'image/jpeg');
  ok(p.code === 200 && /[\\/]tile[\\/]com\.example\.app\.jpg$/.test(I.find('com.example.app')), 'a picture is uploaded as Full tile');
  p = await phone('GET', '/api/state', undefined, code);
  ok(p.j.apps[0].tile === true, 'the page marks it as Full tile');
  p = await phone('POST', '/api/reset', { id: 'com.example.app' }, code);
  ok(p.j.ok === true && I.find('com.example.app') === '', 'Reset on the phone gives the app its own icon again');

  // ---- the launcher's Reset icon, and the status ----
  I.set('com.example.app', PNG);
  r = await call(ic, '/api/icons/reset', 'POST', { id: 'com.example.app' });
  ok(r.j.ok === true && r.j.removed === true && I.find('com.example.app') === '', "the launcher's Reset icon removes the picture");
  r = await call(ic, '/api/icons/reset', 'POST', { id: 'com.example.app' });
  ok(
    r.j.ok === true && r.j.removed === false,
    'Reset for an app that already shows its own icon (reset on the phone first) is fine, so the launcher shows it again'
  );
  r = await call(ic, '/api/icons/reset', 'POST', { id: '../x' });
  ok(r.code === 400, 'a reset for a name that is not an app id is refused');
  r = await call(ic, '/api/icons/status');
  ok(r.j.icons === 0 && r.j.pair && r.j.pair.code === code, 'the status says how many pictures there are and whether the page is open');
  await call(ic, '/api/icons/pair', 'POST', { stop: true });
  r = await call(ic, '/api/icons/status');
  ok(r.j.pair === null, 'the phone page closes');

  // ---- apps.js: the custom picture first, and iv in the app list ----
  const luna = async uri =>
    /listApps/.test(uri)
      ? { returnValue: true, apps: [{ id: 'com.example.app', title: 'Example', folderPath: own, icon: 'i.png' }] }
      : { returnValue: true };
  const apps = req('apps').create({ config: memoryConfig({}), luna, version: '1.6.0', feature: () => null });
  r = await call(apps, '/api/apps');
  ok(r.j.apps.length === 1 && r.j.apps[0].iv === undefined, 'an app without a picture of its own has no iv');
  const s = await serve((q, res) => apps.handle(q, res, q.url.split('?')[0], async () => ({})));
  let g = await get(s.url + '/icon/com.example.app');
  ok(g.code === 200 && g.body.equals(JPEG), "the app's own icon is sent while it has no picture");
  I.set('com.example.app', PNG);
  r = await call(apps, '/api/apps');
  ok(
    typeof r.j.apps[0].iv === 'number' && r.j.apps[0].iv > 0 && r.j.apps[0].it === undefined,
    'an app with a picture of its own is marked with iv'
  );
  g = await get(s.url + '/icon/com.example.app?v=' + r.j.apps[0].iv);
  ok(g.code === 200 && g.type === 'image/png' && g.body.equals(PNG), 'the custom picture is sent first, as a PNG');
  I.set('com.example.app', JPEG, true);
  r = await call(apps, '/api/apps');
  ok(r.j.apps[0].it === 1, 'a Full tile picture is marked with it: 1');
  g = await get(s.url + '/icon/com.example.app');
  ok(g.code === 200 && g.type === 'image/jpeg' && g.body.equals(JPEG), 'the Full tile picture is sent as well');
  I.remove('com.example.app');
  g = await get(s.url + '/icon/com.example.app');
  ok(g.code === 200 && g.body.equals(JPEG), "after a reset the app's own icon is sent again");
  s.server.close();
});
