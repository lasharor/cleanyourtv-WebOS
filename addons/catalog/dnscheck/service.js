// DNS check: asks the TV's own resolver (the same one LG's apps use, so /etc/hosts, your router and Pi-hole or AdGuard count) for a
// list of ad and tracking hosts. A host that does not resolve, or resolves to 0.0.0.0, 127.x or ::, is BLOCKED; one that resolves to
// a real address is REACHABLE (the address is not contacted). A control host (example.com) shows whether DNS works at all.
// Add your own hosts: curl -X POST localhost:8765/api/addons/dnscheck/hosts -d '{"hosts":["ads.example.net"]}' (on the TV).
const dns = require('dns');

// the three hosts the debloat blocks (scripts/debloat-stop.sh); more are added by you
const DEFAULT_HOSTS = ['eic.ads.lgtvcommon.com', 'nl.ad.lgsmartad.com', 'nl.info.lgsmartad.com'];
const CONTROL = 'example.com';
const HOST = /^(?=.{1,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

// err: the resolver's error (or null); addrs: [{address}]
function classify(err, addrs) {
  if (err) {
    // a name that does not exist, a refused or failed lookup: nothing to connect to
    return { state: 'blocked', how: String(err.code || 'error') };
  }
  const list = (addrs || []).map(a => a.address);
  if (!list.length) return { state: 'blocked', how: 'no address' };
  const dead = a => /^(0\.0\.0\.0|127\.|::1?$|0:0:0:0:0:0:0:[01]$)/.test(a);
  if (list.every(dead)) return { state: 'blocked', how: list[0] };
  return { state: 'reachable', how: list[0] };
}

// the hosts you added: valid names only, at most 30
const cleanHosts = v =>
  (Array.isArray(v) ? v : [])
    .map(h => String(h).trim().toLowerCase())
    .filter((h, i, all) => HOST.test(h) && DEFAULT_HOSTS.indexOf(h) < 0 && all.indexOf(h) === i)
    .slice(0, 30);

function lookup(host) {
  return new Promise(resolve => {
    let done = false;
    const finish = r => {
      if (!done) {
        done = true;
        resolve(Object.assign({ host }, r));
      }
    };
    const t = setTimeout(() => finish({ state: 'unknown', how: 'timeout' }), 5000);
    dns.lookup(host, { all: true }, (err, addrs) => {
      clearTimeout(t);
      finish(classify(err, addrs));
    });
  });
}

function create(ctx) {
  const hosts = () => DEFAULT_HOSTS.concat(cleanHosts(ctx.settings.get().hosts));
  async function handle(req, res, p, body) {
    const send = (o, code) => {
      res.writeHead(code || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (p === '/check' && req.method === 'GET') {
      const control = await lookup(CONTROL);
      const works = control.state === 'reachable';
      // when even the control host fails, the answers say nothing about blocking: no host is called blocked then
      const results = (await Promise.all(hosts().map(lookup))).map(r => (works ? r : { host: r.host, state: 'unknown', how: 'no DNS' }));
      return send({
        dnsWorks: works,
        results,
        blocked: results.filter(r => r.state === 'blocked').length,
        reachable: results.filter(r => r.state === 'reachable').length,
      });
    }
    if (p === '/hosts' && req.method === 'POST') {
      const b = await body(req);
      ctx.settings.set({ hosts: cleanHosts(b.hosts) });
      return send({ hosts: hosts() });
    }
    send({ error: 'not found' }, 404);
  }
  return { handle };
}

module.exports = { create, classify, cleanHosts, DEFAULT_HOSTS };
