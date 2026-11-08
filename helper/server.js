// The service's HTTP server on 127.0.0.1. Each feature answers the paths it lists (feature.paths, exact) or the paths that begin
// with its prefix (feature.prefix); a feature's handle(req, res, path, body) may be async, and an error in it becomes a 500 reply.
// Who may call: our own apps (local files; their requests carry Origin "null", or "file://<app id>-webos" on webOS 6) and programs
// on the TV (curl, scripts: no Origin). A web page opened in the TV's browser has an http(s) origin and is refused, so it cannot
// drive this root service.
const http = require('http');
const web = require('./web');

// Who may call: our own apps (local files; their requests carry Origin "null", "file://<app id>-webos" on webOS 6, or a bare
// "file://" on webOS 4, whose Chromium 53 names no app, so it is no more specific than "null") and programs
const OUR_APPS = /^file:\/\/((com\.webos\.app\.home|com\.cleanyourtv\.(manager|picker|notify|live))-webos)?$/;

// An add-on's page is served by this service (http://127.0.0.1:8765/addon/<id>/...), so its own requests carry that address as their
// origin. They are accepted only for /addon/ and for the page's own API (/api/addons/<id>/..., and only when the Referer is that
// add-on's page), and only when the Host is the loopback address itself, so a web page on the Internet cannot use this way in.
function addonPageCall(req, origin, u, may) {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost):8765$/.test(host) || origin !== 'http://' + host) return false;
  if (u.indexOf('/addon/') === 0) return true;
  const ref = /^\/addon\/([a-z][a-z0-9-]*)\//.exec(String(req.headers.referer || '').slice(origin.length));
  if (!ref || String(req.headers.referer).indexOf(origin) !== 0) return false;
  if (may && may(ref[1], u)) return true; // the old API paths of a bundled add-on, called by its own page (Live TV: /api/live/)
  const m = /^\/api\/addons\/([a-z][a-z0-9-]*)\/./.exec(u);
  return !!m && m[1] === ref[1] && ['catalog', 'install', 'remove'].indexOf(m[1]) < 0;
}

function create(opts) {
  const features = opts.features; // a function returning the loaded features, in order
  const route = u => {
    for (const f of features()) {
      if (f.paths && f.paths.indexOf(u) >= 0) return f;
      if (f.prefix && u.indexOf(f.prefix) === 0) return f;
      if (f.match && f.match(u)) return f; // a part with paths that change while it runs (add-ons, and the old paths of bundled ones)
    }
    return null;
  };
  return http.createServer(async (req, res) => {
    let origin = req.headers.origin;
    const rawOrigin = origin;
    if (OUR_APPS.test(origin || '')) origin = 'null';
    const pageCall =
      origin !== undefined &&
      origin !== 'null' &&
      addonPageCall(req, origin, req.url.split('?')[0], (id, u) => features().some(f => f.pageMay && f.pageMay(id, u)));
    if (origin !== undefined && origin !== 'null' && !pageCall) {
      console.log('refused origin ' + origin + ' ' + req.method + ' ' + req.url.slice(0, 60));
      return web.json(res, { error: 'origin not allowed' }, 403);
    }
    // Chromium 79 (webOS 6) compares the answer with its own serialisation of a file origin, so for those origins echoing fails
    // CORS: answer * there, and to the bare "file://" of Chromium 53 (webOS 4) too. Only origins accepted above get this far.
    if (origin === 'null') {
      res.setHeader('Access-Control-Allow-Origin', rawOrigin === 'null' ? 'null' : '*');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const u = req.url.split('?')[0];
    const f = route(u);
    if (!f) return web.notFound(res);
    try {
      return await f.handle(req, res, u, web.body);
    } catch (e) {
      console.error(f.name + ': ' + u + ': ' + ((e && e.stack) || e));
      if (!res.headersSent) web.json(res, { error: String(e) }, 500);
      else res.end();
    }
  });
}

module.exports = { create, addonPageCall };
