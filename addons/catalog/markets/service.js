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
  'Stocks',
  'Crypto',
  'Choose your stocks',
  'Choose your coins',
  'Select to set it on the TV',
  'Open',
  'Closed',
  'Offline · %s',
  '24h',
  '+%s more in the drawer',
  // the drawer
  'Close',
  'today',
  'Delayed up to 15 min',
  'Markets closed',
  'prices at close',
  'Prices in %s',
  'updated %s',
  'Offline, data from %s',
  'Watchlist',
  'Chart',
  'Details',
  'High %s',
  'Low %s',
  'Open price',
  'Previous close',
  'Day range',
  'Volume',
  'Currency',
  'Exchange',
  '52-week range',
  'Rank',
  'Market cap',
  '24h range',
  '24h volume',
  'All-time high',
  'Supply',
  'All-time range',
  'Not found: %s',
  'Market data from Yahoo Finance, may be delayed',
  'Data by CoinGecko',
  'Market data is not available now.',
];

function create(ctx) {
  const i18n = ctx.util.i18n;
  ctx.util.mkdirp(ctx.dataDir);
  const m = mk.create({ path: path.join(ctx.dataDir, 'markets.json'), fetch: ctx.fetch });
  const T = s => i18n.tr(i18n.lang(null, ctx.env.lang()), s);

  async function feed(id, opt) {
    const labels = {};
    LABELS.forEach(l => (labels[l] = T(l)));
    const kind = id === 'crypto' ? 'crypto' : 'stocks',
      symbols = PRESETS[kind][opt.list] || opt.symbols || '';
    const base = { labels, kind, range: opt.range || '1d', show: opt.show === 'abs' ? 'abs' : 'pct' };
    if (!(kind === 'crypto' ? mk.coinList(symbols) : mk.stockList(symbols)).length) return Object.assign(base, { empty: true });
    const r = kind === 'crypto' ? await m.crypto(symbols, opt.vs, opt.range) : await m.stocks(symbols, opt.range);
    if (r.error) return Object.assign(base, { error: T('Market data is not available now.') });
    return Object.assign(base, {
      at: r.at,
      range: r.range,
      vs: kind === 'crypto' ? r.q[0].cur : '',
      open: kind === 'stocks' ? r.open : null,
      q: r.q,
      missing: r.missing,
    });
  }
  // the buttons of the card (open: the drawer, settings: the launcher's panel) are the launcher's own: nothing reaches the add-on
  function action() {
    return { error: 'no such action' };
  }
  return { cards: { feed, action }, handle: (q, r) => r.end('{}') };
}

module.exports = { create, PRESETS, LABELS };
