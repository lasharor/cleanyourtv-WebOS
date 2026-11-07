// The markets add-on: the service part of the Stocks and Crypto cards (cards/stocks/, cards/crypto/). The launcher asks for a card's data
// every minute (cards.feed); the prices come from markets.js, which spaces its requests and keeps the last answer. The answer has what
// the card and its drawer show (the same page code draws both kinds: data.kind says which), and the words in the language of the
// screens (labels), so the pages in their closed frames need no translation.
const path = require('path');
const mk = require('./markets');

// the lists a person can pick on the TV (Customise > Stocks > Watchlist); "custom" is the list typed on the phone page
const PRESETS = {
  stocks: {
    tech: 'AAPL,MSFT,NVDA,GOOGL,TSLA',
    idx: '^GSPC,AAPL,MSFT',
    il: 'TEVA.TA,^GSPC,NVDA',
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
  'Market data from Yahoo Finance, may be delayed',
  'Offline, data from %s',
  'Updated %s',
  'Close',
  'No symbols yet',
  'Choose a list in Customise or type your own symbols on the phone page.',
  'Not found',
  'Rank %s',
  'Delayed up to 15 min',
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
];

function create(ctx) {
  const i18n = ctx.util.i18n;
  ctx.util.mkdirp(ctx.dataDir);
  const m = mk.create({ path: path.join(ctx.dataDir, 'markets.json'), fetch: ctx.fetch });
  const T = s => i18n.tr(i18n.lang(null, ctx.env.lang()), s);

  // The chart the drawer shows: a symbol and a range it asked for with the action "chart" ("AAPL:1y"). Kept in memory for 10 minutes,
  // per card, and answered in the feed as data.chart; the card's own option (its line on Home) is never changed by it.
  const views = {},
    VIEW_MS = 10 * 60 * 1000;
  const listOf = (kind, opt) => PRESETS[kind][opt.list] || opt.symbols || '';
  async function chartOf(kind, opt, v) {
    const r = kind === 'crypto' ? await m.crypto(v.sym, opt.vs, v.range) : await m.stocks(v.sym, v.range);
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
    const r = kind === 'crypto' ? await m.crypto(symbols, opt.vs, opt.range) : await m.stocks(symbols, opt.range);
    if (r.error) return Object.assign(base, { error: T('Market data is not available now.') });
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
  return { cards: { feed, action }, handle: (q, r) => r.end('{}') };
}

module.exports = { create, PRESETS, LABELS };
