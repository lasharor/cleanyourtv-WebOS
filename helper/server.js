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

function create(opts) {
  const features = opts.features; // a function returning the loaded features, in order
  const appOrigins = opts.appOrigins || OUR_APPS;
  const route = u => {
    for (const f of features()) {
      if (f.paths && f.paths.indexOf(u) >= 0) return f;
      if (f.prefix && u.indexOf(f.prefix) === 0) return f;
    }
    return null;
  };
  return http.createServer(async (req, res) => {
    let origin = req.headers.origin;
    const rawOrigin = origin;
    if (appOrigins.test(origin || '')) origin = 'null';
    if (origin !== undefined && origin !== 'null') {
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

module.exports = { create };
