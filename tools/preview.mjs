// Interactive launcher preview — opens the home screen in Chrome at 1920x1080.
// Usage: node tools/preview.mjs [theme-id]
// theme-id defaults to "classic". Run from the repo root.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const id = args.find(a => /^[a-z0-9-]{1,30}$/.test(a)) || 'classic';

if (id !== 'classic' && !fs.existsSync(path.join(ROOT, 'themes', id, 'theme.json'))) {
  console.error('Tema non trovato: themes/' + id + '/theme.json');
  process.exit(2);
}

// Tema
const store = fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-themes-'));
if (id !== 'classic') fs.cpSync(path.join(ROOT, 'themes', id), path.join(store, id), { recursive: true });
const baseId = id !== 'classic' ? JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', id, 'theme.json'), 'utf8')).extends || '' : '';
if (baseId && baseId !== 'classic' && fs.existsSync(path.join(ROOT, 'themes', baseId)))
  fs.cpSync(path.join(ROOT, 'themes', baseId), path.join(store, baseId), { recursive: true });
process.env.CYTV_THEMES = store;
const theme = require(path.join(ROOT, 'helper', 'theme.js')).create({
  config: require(path.join(ROOT, 'helper', 'config.js')).memory({ theme: { id } }),
  noStartup: true,
});

// App di prova con icone colorate
const NAMES = [
  'Netflix',
  'YouTube',
  'Prime Video',
  'Disney+',
  'Spotify',
  'Twitch',
  'Apple TV',
  'DAZN',
  'RaiPlay',
  'Mediaset',
  'La7',
  'Sky Go',
  'Plex',
  'Jellyfin',
  'VLC',
  'Browser',
  'Settings',
  'Store',
];
const apps = NAMES.map((n, i) => ({ id: 'app.' + i, title: n, hue: (i * 47) % 360 }));
const svg = a =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="hsl(${a.hue},62%,46%)"/><circle cx="128" cy="116" r="54" fill="rgba(255,255,255,.88)"/><text x="128" y="205" font-family="Helvetica,Arial,sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="#fff">${a.title.slice(0, 7)}</text></svg>`;

const page = fs
  .readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8')
  .replace('<script>', '<script>window.webOSSystem={launchParams:"{}"};', 1);

const body = req =>
  new Promise(res => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => {
      try {
        res(JSON.parse(b || '{}'));
      } catch (_) {
        res({});
      }
    });
  });

const srv = http.createServer(async (q, r) => {
  const u = q.url.split('?')[0];
  r.setHeader('Access-Control-Allow-Origin', '*');
  r.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (q.method === 'OPTIONS') {
    r.writeHead(204);
    return r.end();
  }
  const j = o => {
    r.writeHead(200, { 'content-type': 'application/json' });
    r.end(JSON.stringify(o));
  };

  if (u === '/home.html') {
    r.writeHead(200, { 'content-type': 'text/html' });
    return r.end(page);
  }
  if (u.startsWith('/api/theme/')) return theme.handle(q, r, u, body);
  if (u === '/api/apps') {
    const r = theme.resolved();
    return j({
      apps: apps.map(a => ({ id: a.id, title: a.title })),
      config: { dock: apps.slice(0, r.dockN || 6).map(a => a.id), theme: r, lang: 'it' },
      usage: Object.fromEntries(apps.map((a, i) => [a.id, 1000 - i])),
      version: '9.9.9',
    });
  }
  if (u === '/api/inputs')
    return j({
      devices: [
        { hdmiPlugIn: true, label: 'PlayStation 5', port: 1, appId: 'hdmi1', activate: false },
        { hdmiPlugIn: true, label: 'Apple TV 4K', port: 2, appId: 'hdmi2', activate: false },
        { hdmiPlugIn: false, label: 'HDMI 3', port: 3, appId: 'hdmi3', activate: false },
      ],
    });

  // Asset statici (immagini scene, font)
  const sf = /^\/([\w-]{1,60}\.(?:jpg|webp|woff2))$/.exec(u);
  if (sf && fs.existsSync(path.join(ROOT, 'app', sf[1]))) {
    r.writeHead(200, { 'content-type': { jpg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2' }[sf[1].split('.').pop()] });
    return r.end(fs.readFileSync(path.join(ROOT, 'app', sf[1])));
  }

  // Icone app
  const m = /^\/icon\/(app\.\d+)$/.exec(u),
    a = m && apps.find(x => x.id === m[1]);
  if (a) {
    r.writeHead(200, { 'content-type': 'image/svg+xml' });
    return r.end(svg(a));
  }

  j({ returnValue: true });
});

srv.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error('Porta 8765 occupata: chiudi qualsiasi altra istanza e riprova.');
  else console.error(e.message);
  process.exit(2);
});

srv.listen(8765, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:8765/home.html';
  console.log('\n  CleanYourTV preview — tema: ' + id);
  console.log('  ' + url);
  console.log('\n  Usa le frecce per navigare, OK con Invio.');
  console.log('  Ctrl+C per uscire.\n');

  // Apri Chrome con viewport 1920x1080
  const chromePath =
    process.env.CHROME ||
    [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ].find(p => fs.existsSync(p));

  if (chromePath) {
    spawn(chromePath, ['--new-window', '--window-size=1920,1080', '--app=' + url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Fallback: apri con il browser di sistema
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
});

process.on('SIGINT', () => {
  srv.close();
  fs.rmSync(store, { recursive: true, force: true });
  process.exit(0);
});
