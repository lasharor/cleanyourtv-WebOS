// Notifications with pictures: the TV's own toasts are text-only, so this shows a card in a small transparent window (the notify
// app) on top of whatever is running. POST /api/notify {title, text, image, seconds, position}
const luna = require('./luna'),
  fetch = require('./fetch'),
  web = require('./web');
const { URL } = require('./netcompat');

const images = new Map(); // id -> {type, buf}; kept in memory, newest few only
let seq = 0;

async function fetchImage(url) {
  const r = await fetch.read(url, {
    refuseLocal: true, // not a way to read the service's own pages
    insecure: true,
    idleMs: 8000,
    redirects: 4,
    maxBytes: 6 << 20,
    bigText: 'image too large',
    statusText: s => 'image server answered ' + s,
  });
  return { type: r.headers['content-type'] || 'image/jpeg', buf: r.body };
}

// "topui" windows sit above every app and, unlike "overlay" ones, leave the remote with the app underneath (see tvprofile.js)
const launch = params => luna('luna://com.webos.applicationManager/launch', { id: 'com.cleanyourtv.notify', params });

async function show(b, internal) {
  // internal looks: voice (listening|thinking|answer) and volume; not available to network senders
  const kind = internal && /^(listening|thinking|answer|volume)$/.test(b.kind) ? b.kind : '';
  if (kind === 'volume') {
    return launch({
      kind: 'volume',
      volume: typeof b.volume === 'number' ? b.volume : 0,
      max: typeof b.max === 'number' && b.max > 0 ? b.max : 100,
      mute: !!b.mute,
      output: String(b.output || 'tv_speaker'),
      theme: String(b.theme || 'pill'),
      seq: typeof b.seq === 'number' ? b.seq : 0,
      seconds: Math.max(1, Math.min(10, +b.seconds || 2)),
    });
  }
  const p = {
    title: String(b.title || '').slice(0, 120),
    text: String(b.text || '').slice(0, kind ? 1500 : 400),
    seconds: Math.max(2, Math.min(120, +b.seconds || 8)),
    position: /^(top|middle|bottom)-(left|center|right)$/.test(b.position) ? b.position : kind ? 'bottom-center' : 'top-right',
  };
  if (kind) {
    p.kind = kind;
    p.question = String(b.question || '').slice(0, 300);
  }
  if (b.image) {
    try {
      const id = String(++seq);
      images.set(id, await fetchImage(String(b.image)));
      if (images.size > 5) images.delete(images.keys().next().value);
      p.image = 'http://127.0.0.1:8765/api/notify/img?id=' + id;
    } catch (e) {
      p.text = (p.text ? p.text + '\n' : '') + '(image: ' + e.message + ')';
    }
  }
  if (!p.title && !p.text && !p.image && !kind) return { error: 'nothing to show' };
  return launch(p);
}

async function handle(req, res, u, body) {
  if (u === '/api/notify/img') {
    const e = images.get(new URL(req.url, 'http://x').searchParams.get('id'));
    if (!e) return web.notFound(res);
    res.writeHead(200, { 'content-type': e.type, 'cache-control': 'no-store' });
    return res.end(e.buf);
  }
  if (u === '/api/notify' && req.method === 'POST') {
    const r = await show(await body(req));
    return web.json(res, r.error ? { error: r.error } : r, r.error ? 400 : 200);
  }
  web.notFound(res);
}

// ctx is not needed: this part keeps its own state
const create = (/** @type {any} */ _ctx) => ({ name: 'notify', prefix: '/api/notify', handle, show });

module.exports = { create, handle, show };
