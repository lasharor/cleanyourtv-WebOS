// DTS audio passthrough: installs, checks and removes the earc_route kernel module (https://github.com/Mokto/earc_route, GPL-2.0-only,
// a separate program: it is downloaded from its own release at install time and never shipped here) for players that open /dev/earc_route
// (tvlauncher, Native Jelly). This add-on plays and decodes nothing. webOS 6 only (kernel 4.4.84); every other kernel is refused.
// The commands it runs as root are the fixed ones of "exec" in addon.json; the download is pinned by SHA-256 below.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');

const VERSION = '0.1.0';
const URL = 'https://github.com/Mokto/earc_route/releases/download/v' + VERSION + '/earc-route-hbr-' + VERSION + '.tar.gz';
const SHA256 = '1c32b01fb30a9d365b51ed0b540c83a6dae045ffae49642176391d9bd03559f5';
const MAX_BYTES = 1 << 20; // the archive is 21 KB
const KERNEL = /^4\.4\.84(\D|$)/; // the one kernel the module is built for
const RECEIVER = ['external_arc', 'external_optical']; // LG's sound outputs that carry a bitstream unconverted
const HOOK = '/var/lib/webosbrew/init.d/30-earc-route-hbr';

// the key=value lines of `earc-route-hbr.sh status`: {root, kernel, installed, loaded, ours, enabled, 'node.host'} (app.<id> lines kept as they are)
function parseStatus(text) {
  const o = {};
  String(text)
    .split('\n')
    .forEach(l => {
      const m = /^([A-Za-z][\w.-]{0,40})=(.{0,80})$/.exec(l.trim());
      if (m) o[m[1]] = m[2];
    });
  return o;
}

// the last "hbr: ..." line a script printed: {state: 'active'|'removed'|'refused'|'', why}
function parseLine(text) {
  const lines = String(text)
    .split('\n')
    .filter(l => /^hbr: /.test(l));
  const l = lines.length ? lines[lines.length - 1] : '';
  if (/^hbr: active/.test(l)) return { state: 'active', why: '' };
  if (/^hbr: removed/.test(l)) return { state: 'removed', why: '' };
  const m = /^hbr: REFUSED: (.{0,200})/.exec(l);
  return m ? { state: 'refused', why: m[1] } : { state: '', why: '' };
}

const supported = kernel => KERNEL.test(String(kernel || '').trim());

// LG's reply of audio/getSoundOutput -> {output, receiver}; receiver only for a bitstream-capable output (ARC, optical)
function soundOutput(r) {
  const out = r && r.returnValue === true && typeof r.soundOutput === 'string' ? r.soundOutput.slice(0, 40) : '';
  return { output: out, receiver: RECEIVER.indexOf(out) >= 0 };
}

function create(ctx) {
  const hbr = path.join(ctx.dataDir, 'hbr');
  const script = path.join(hbr, 'earc-route-hbr-' + VERSION, 'earc-route-hbr.sh');
  const tgz = path.join(ctx.dataDir, 'hbr.tgz');
  const sh = sub => ctx.exec(['sh', script, sub], { timeout: 60000 });
  const kernel = () => {
    try {
      return fs.readFileSync(path.join(ctx.proc, 'sys/kernel/osrelease'), 'utf8').trim();
    } catch (_) {
      return '';
    }
  };
  let busy = false;

  async function status() {
    const k = kernel();
    const s = {
      supported: supported(k),
      kernel: k.slice(0, 40),
      version: VERSION,
      installed: false,
      loaded: false,
      active: false,
      node: false,
      output: '',
      receiver: false,
      busy,
    };
    if (fs.existsSync(script)) {
      const r = await sh('status');
      const p = parseStatus(r.out);
      s.installed = p.installed === '1';
      s.loaded = p.loaded === '1';
      s.active = p.enabled === '1';
      s.node = p['node.host'] === '1';
    } else {
      s.installed = fs.existsSync(HOOK); // put there by hand or by another tool
      s.loaded = fs.existsSync('/sys/module/earc_route');
    }
    if (ctx.luna) Object.assign(s, soundOutput(await ctx.luna('luna://com.webos.service.audio/getSoundOutput', {}, { wait: 4000 })));
    return s;
  }

  async function install() {
    if (!supported(kernel()))
      return { ok: false, error: 'this TV runs kernel ' + (kernel() || '?') + '; the module is built for 4.4.84 (webOS 6) only' };
    ctx.util.mkdirp(hbr);
    await ctx.fetch.toFile(URL, tgz, { maxBytes: MAX_BYTES, totalMs: 60000 });
    const sum = crypto.createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
    if (sum !== SHA256) {
      fs.unlinkSync(tgz);
      return { ok: false, error: 'the download does not match the expected SHA-256 (nothing was installed)' };
    }
    const t = await ctx.exec(['tar', '-xzf', tgz, '-C', hbr], { timeout: 30000 });
    if (!t.ok || !fs.existsSync(script)) return { ok: false, error: 'could not unpack the download' };
    const r = await sh('install');
    const l = parseLine(r.out);
    ctx.log('install: ' + (l.state || 'no answer') + ' ' + l.why);
    return l.state === 'active' ? { ok: true } : { ok: false, error: l.why || 'the installer gave no answer' };
  }

  async function simple(sub) {
    if (!fs.existsSync(script)) return { ok: false, error: 'not installed by this add-on' };
    const l = parseLine((await sh(sub)).out);
    ctx.log(sub + ': ' + (l.state || 'no answer'));
    return l.state === 'active' || l.state === 'removed' ? { ok: true } : { ok: false, error: l.why || 'no answer' };
  }

  async function remove() {
    const r = await simple('remove');
    if (r.ok) {
      try {
        fs.unlinkSync(tgz);
      } catch (_) {}
      rmrf(hbr);
    }
    return r;
  }

  function rmrf(d) {
    let st;
    try {
      st = fs.lstatSync(d);
    } catch (_) {
      return;
    }
    if (st.isDirectory()) {
      fs.readdirSync(d).forEach(f => rmrf(path.join(d, f)));
      fs.rmdirSync(d);
    } else fs.unlinkSync(d);
  }

  async function handle(req, res, p, body) {
    const send = (o, code) => {
      res.writeHead(code || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (p === '/status' && req.method === 'GET') return send(await status());
    const acts = { '/install': install, '/remove': remove, '/refresh': () => simple('refresh') };
    if (acts[p] && req.method === 'POST') {
      const b = await body(req);
      // changing the kernel's audio route is never done by a stray request: the page asks twice and sends confirm
      if (!b || b.confirm !== true) return send({ ok: false, error: 'confirm is required' }, 400);
      if (busy) return send({ ok: false, error: 'busy' }, 409);
      busy = true;
      try {
        const r = await acts[p]();
        return send(Object.assign(r, { status: await status() }));
      } catch (e) {
        return send({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500);
      } finally {
        busy = false;
      }
    }
    send({ error: 'not found' }, 404);
  }
  return { handle };
}

module.exports = { create, parseStatus, parseLine, supported, soundOutput, URL, SHA256 };
