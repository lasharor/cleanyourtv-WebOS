// The markets add-on: the service part of the Stocks and Crypto cards (cards/stocks/, cards/crypto/). The launcher asks for a card's data
// every minute (cards.feed); the prices come from markets.js, which spaces its requests and keeps the last answer. The answer has what
// the card and its drawer show (the same page code draws both kinds: data.kind says which), and the words in the language of the
// screens (labels), so the pages in their closed frames need no translation.
// Stocks need the person's Twelve Data API key: it is this add-on's setting in config.json (addons.markets.settings.key), set on the
// phone page (settings(): a short-lived server on the LAN, port 8801, needs the code shown on the TV), shown as its last four characters
// at most and never logged or put in a card's answer.
const http = require('http'),
  path = require('path');
const mk = require('./markets'),
  phone = require('./phone');
const PAIR_PORT = 8801, // after the add-on repositories page (8800)
  PAIR_MS = 15 * 60 * 1000,
  KEY = /^[A-Za-z0-9]{16,64}$/;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// the lists a person can pick on the TV (Customise > Stocks > Watchlist); "custom" is the list typed on the phone page
const PRESETS = {
  stocks: {
    tech: 'AAPL,MSFT,NVDA,GOOGL,TSLA',
    idx: 'SPY,QQQ,DIA',
    il: 'TEVA,CHKP,NICE,WIX,MNDY',
  },
  crypto: {
    top: 'BTC,ETH,SOL,XRP,DOGE',
    two: 'BTC,ETH',
  },
};
const LABELS = [
  'Offline · %s',
  '24h',
  'Open',
  'Closed',
  '+%s more in the drawer',
  'Select to set it on the TV',
  'Previous close %s',
  'Start %s',
  'High %s',
  'Low %s',
  'At the high',
  '%s below the high',
  'Offline',
  'Live',
  'prices at close',
  'Data by CoinGecko',
  'Market data by Twelve Data',
  'Offline, data from %s',
  'Updated %s',
  'Close',
  'No symbols yet',
  'Choose a list in Customise or type your own symbols on the phone page.',
  'Not found',
  'Rank %s',
  'At close',
  'Near the 52-week high',
  'Near the all-time high',
  '24 hours ago',
  'Opening',
  'Closing',
  'Now',
  'Market cap',
  '24h volume',
  '7-day change',
  'Supply',
  'of %s',
  'Open price',
  'Previous close',
  'Volume',
  'Exchange',
  '24h range',
  'All-time',
  'Day range',
  '52 weeks',
  'past day',
  'past 5 days',
  'past month',
  'past 6 months',
  'past year',
  'past 7 days',
  'past 30 days',
  '5 days ago',
  '1 month ago',
  '6 months ago',
  '1 year ago',
  '7 days ago',
  '30 days ago',
  'Market data is not available now.',
  'Stocks',
  'Crypto',
  'Choose your stocks',
  'Choose your coins',
  'Add your free Twelve Data key: Manager > Add-ons > Stocks and crypto > Set up from your phone.',
  'Twelve Data refused the key. Set it again from your phone.',
  "Twelve Data's limit for today is used up. Prices come again after midnight (UTC).",
  'Getting prices…',
];

function create(ctx) {
  const i18n = ctx.util.i18n,
    util = ctx.util;
  util.mkdirp(ctx.dataDir);
  const m = mk.create({ path: path.join(ctx.dataDir, 'markets.json'), fetch: ctx.fetch });
  const T = s => i18n.tr(i18n.lang(null, ctx.env.lang()), s);
  const key = () => String((ctx.settings.get() || {}).key || '');
  // what the card says when it has no prices to show
  const SAYS = {
    nokey: 'Add your free Twelve Data key: Manager > Add-ons > Stocks and crypto > Set up from your phone.',
    key: 'Twelve Data refused the key. Set it again from your phone.',
    day: "Twelve Data's limit for today is used up. Prices come again after midnight (UTC).",
    loading: 'Getting prices…',
  };

  // The chart the drawer shows: a symbol and a range it asked for with the action "chart" ("AAPL:1y"). Kept in memory for 10 minutes,
  // per card, and answered in the feed as data.chart; the card's own option (its line on Home) is never changed by it.
  const views = {},
    VIEW_MS = 10 * 60 * 1000;
  const listOf = (kind, opt) => PRESETS[kind][opt.list] || opt.symbols || '';
  async function chartOf(kind, opt, v) {
    if (kind === 'stocks') {
      const l = await m.stockLine(v.sym, v.range, key());
      return l && { s: l.s, range: v.range, sp: l.sp, rc: l.rc };
    }
    const r = await m.crypto(v.sym, opt.vs, v.range);
    const q = r.q && r.q[0];
    if (!q) return null;
    return { s: q.s, range: r.range, sp: q.sp, rc: q.rc };
  }

  async function feed(id, opt) {
    const labels = {};
    LABELS.forEach(l => (labels[l] = T(l)));
    const kind = id === 'crypto' ? 'crypto' : 'stocks',
      symbols = listOf(kind, opt);
    const base = { labels, kind, range: opt.range || '1d', show: opt.show === 'abs' ? 'abs' : 'pct' };
    if (!(kind === 'crypto' ? mk.coinList(symbols) : mk.stockList(symbols)).length) return Object.assign(base, { empty: true });
    const r = kind === 'crypto' ? await m.crypto(symbols, opt.vs, opt.range) : await m.stocks(symbols, opt.range, key());
    if (r.error) return Object.assign(base, { error: T(SAYS[r.code] || 'Market data is not available now.') });
    const out = Object.assign(base, {
      at: r.at,
      range: r.range,
      vs: kind === 'crypto' ? r.q[0].cur : '',
      open: kind === 'stocks' ? r.open : null,
      q: r.q.map(q => Object.assign({}, q, { n: mk.shortName(q.n) })),
      missing: r.missing,
    });
    const v = views[id];
    if (v && Date.now() - v.at < VIEW_MS && r.q.some(q => q.s === v.sym.toUpperCase())) {
      const c = await chartOf(kind, opt, v);
      if (c) out.chart = c;
    }
    return out;
  }
  // "chart": the drawer asks for a symbol's line over a range ("AAPL:1y"); it is fetched now (so the next feed has it at once) and
  // remembered for this card. The other buttons of the card (open: the drawer, settings: the panel) are the launcher's own.
  async function action(id, opt, name, arg) {
    if (name !== 'chart') return { error: 'no such action' };
    const kind = id === 'crypto' ? 'crypto' : 'stocks',
      p = /^([^:]{1,20}):([a-z0-9]{2,4})$/i.exec(String(arg || ''));
    const sym = p && (kind === 'crypto' ? mk.coinList(p[1])[0] : mk.stockList(p[1])[0]),
      range = p && p[2].toLowerCase();
    const ok = kind === 'crypto' ? mk.CRYPTO_RANGES[range] !== undefined : !!mk.STOCK_RANGES[range];
    if (!sym || !ok) return { error: 'no such chart' };
    views[id] = { sym, range, at: Date.now() };
    await chartOf(kind, opt || {}, views[id]);
    return {};
  }

  // ---- the phone page: the Twelve Data key (LAN, short-lived, the code shown on the TV in every request, header x-code) ----
  function details() {
    const k = key(),
      c = m.credits();
    return { configured: !!k, keyHint: k ? '…' + k.slice(-4) : '', used: mk.PER_DAY - c.day, perDay: mk.PER_DAY };
  }
  async function saveKey(b) {
    const k = String(b.key || '').trim() || key();
    if (!k) return { error: 'enter the API key' };
    if (!KEY.test(k)) return { error: 'that does not look like a Twelve Data API key' };
    if (k === key()) return { ok: true };
    const r = await m.testKey(k);
    if (r.error) return { error: r.error };
    ctx.settings.set({ key: k });
    return { ok: true };
  }
  let pair = null;
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, pair.until - Date.now());
  }
  function body(req) {
    return new Promise((resolve, reject) => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > 4096) {
          reject(new Error('too large'));
          req.destroy();
        } else b.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(b).toString('utf8') || '{}'));
        } catch (_) {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }
  async function handlePhone(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phone.page(i18n, esc, i18n.lang(req, ctx.env.lang())));
    }
    if (u.indexOf('/api/') !== 0) {
      res.writeHead(404);
      return res.end();
    }
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    try {
      if (u === '/api/state') return json(details());
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = await body(req);
      if (u === '/api/save') {
        const r = await saveKey(b);
        return json(r, r.error ? 400 : 200);
      }
      if (u === '/api/disconnect') {
        ctx.settings.set({ key: '' });
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }
  function settings(o) {
    stopPair();
    if (o && o.stop) return {};
    const code = String(util.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => handlePhone(req, res, code, () => ++bad));
    pair = { code, srv, until: Date.now() + PAIR_MS, timer: setTimeout(stopPair, PAIR_MS) };
    const url = 'http://' + util.lanIp() + ':' + PAIR_PORT;
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve({ url, code, qr: url + '/#' + code, seconds: PAIR_MS / 1000 }));
    });
  }

  return { cards: { feed, action }, settings, handle: (q, r) => r.end('{}'), details, handlePhone, stopPair };
}

module.exports = { create, PRESETS, LABELS, PAIR_PORT };
