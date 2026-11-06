// Prices for the Stocks and Crypto cards of the markets add-on. Nothing needs a key or an account:
//   stocks from Yahoo Finance's chart routes (v8 spark: the price and a line for many symbols in one request; v8 chart: one symbol's
//   name, exchange, currency, open, day range, volume and 52-week range), crypto from CoinGecko's public API (/coins/markets: the price,
//   the 24-hour change, rank, market cap and a 7-day line for the whole list in one request; /coins/<id>/market_chart for 30 days and a
//   year, asked only while that range is chosen).
// Every answer is kept in markets.json, so Home shows prices at once and while the internet is away (older than a day is dropped).
// Only the symbols leave the TV. Requests are spaced: stock prices every 5 minutes while a market of the list is open (30 when all are
// closed), a stock's details every 30 minutes, crypto every 2 minutes; the same request is never made twice at once.
//   create({path, fetch}) -> { stocks(symbols, range) -> {at, q, missing} | {error},
//                              crypto(symbols, vs, range) -> {at, q, missing} | {error} }
// Runs on Node 8 (webOS 5 and 6): no ?., no ??, no .finally.
const fs = require('fs');
const YAHOO = process.env.CYTV_YAHOO_URL || 'https://query1.finance.yahoo.com',
  GECKO = process.env.CYTV_GECKO_URL || 'https://api.coingecko.com/api/v3',
  MIN = 60 * 1000,
  OLD = 24 * 3600 * 1000,
  MAX_SYMBOLS = 20, // Yahoo's spark answers at most 20 symbols in one request
  MAX_POINTS = 120;
// the ranges the cards offer, and the step of the line for each (Yahoo's interval names)
const STOCK_RANGES = { '1d': '5m', '5d': '15m', '1mo': '1d', '6mo': '1d', '1y': '1wk' };
// 24 hours and 7 days come with the prices (CoinGecko's 7-day line); 30 days and a year are one more request per coin, kept for hours
const CRYPTO_RANGES = { '1d': 0, '7d': 0, '30d': 30, '1y': 365 };
const VS = ['usd', 'eur', 'ils', 'btc'];
// prices Yahoo gives in the smaller unit: agorot (Tel Aviv), pence (London), cents (Johannesburg)
const MINOR = { ILA: 'ILS', GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR' };

const fin = v => typeof v === 'number' && isFinite(v);
// six significant digits are more than any card shows
const sig = v => (fin(v) ? Number(v.toPrecision(7)) : null);

// a watchlist as typed on the phone: "aapl, ^gspc teva.ta" -> ['AAPL', '^GSPC', 'TEVA.TA'] (at most 20, no repeats)
function stockList(s) {
  const out = [];
  String(s || '')
    .toUpperCase()
    .split(/[\s,;]+/)
    .forEach(x => {
      if (/^[A-Z0-9^][A-Z0-9.^=\-]{0,15}$/.test(x) && out.indexOf(x) < 0 && out.length < MAX_SYMBOLS) out.push(x);
    });
  return out;
}
function coinList(s) {
  const out = [];
  String(s || '')
    .toLowerCase()
    .split(/[\s,;]+/)
    .forEach(x => {
      if (/^[a-z0-9][a-z0-9\-]{0,19}$/.test(x) && out.indexOf(x) < 0 && out.length < MAX_SYMBOLS) out.push(x);
    });
  return out;
}
// at most n points, evenly picked, the last one always kept; gaps (null) left out
function thin(a, n) {
  const v = (Array.isArray(a) ? a : []).filter(fin);
  if (v.length <= n) return v.map(sig);
  const out = [];
  for (let i = 0; i < n - 1; i++) out.push(sig(v[Math.floor((i * (v.length - 1)) / (n - 1))]));
  out.push(sig(v[v.length - 1]));
  return out;
}
function lastOf(a) {
  const v = (Array.isArray(a) ? a : []).filter(fin);
  return v.length ? v[v.length - 1] : null;
}

function read(fetch, url) {
  return fetch
    .read(url, {
      headers: { 'User-Agent': 'cleanyourtv-markets', Accept: 'application/json' },
      maxBytes: 512 * 1024,
      totalMs: 8000, // the launcher waits 15 seconds for a card's answer
      allowHttp: () => !!(process.env.CYTV_YAHOO_URL || process.env.CYTV_GECKO_URL),
    })
    .then(r => JSON.parse(r.body.toString('utf8')));
}

function create(opts) {
  const file = opts.path,
    fetch = opts.fetch;
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (_) {}
  const busy = {};
  const keep = () => {
    try {
      for (const k of Object.keys(cache)) if (!cache[k] || Date.now() - cache[k].at > OLD) delete cache[k];
      fs.writeFileSync(file + '.tmp', JSON.stringify(cache));
      fs.renameSync(file + '.tmp', file);
    } catch (_) {}
  };
  // the kept answer under key when it is younger than every ms, else a new one from load(); the kept one (up to a day old) when that
  // fails. {at, v} | {error}
  // A request that failed is not made again for 5 minutes (an unknown symbol, a service that is away), so a card that asks every
  // minute does not ask the provider every minute.
  const failed = {};
  function cached(key, every, load) {
    const had = cache[key],
      fallback = msg => (had && Date.now() - had.at < OLD ? had : { error: msg });
    if (had && Date.now() - had.at < every) return Promise.resolve(had);
    if (failed[key] && Date.now() - failed[key].at < 5 * MIN) return Promise.resolve(fallback(failed[key].error));
    if (!busy[key])
      busy[key] = load().then(
        v => {
          delete busy[key];
          delete failed[key];
          cache[key] = { at: Date.now(), v };
          keep();
          return cache[key];
        },
        e => {
          delete busy[key];
          failed[key] = { at: Date.now(), error: String((e && e.message) || e) };
          throw e;
        }
      );
    return busy[key].catch(e => fallback(String((e && e.message) || e)));
  }

  // ---- stocks ----
  // name, exchange, currency and the ranges of one symbol (v8 chart), every 30 minutes
  function meta(sym) {
    return cached('sm:' + sym, 30 * MIN, () =>
      read(fetch, YAHOO + '/v8/finance/chart/' + encodeURIComponent(sym) + '?range=1d&interval=1d').then(j => {
        const r = j && j.chart && j.chart.result && j.chart.result[0];
        const m = (r && r.meta) || null;
        if (!m) throw new Error('no such symbol');
        const per = (m.currentTradingPeriod && m.currentTradingPeriod.regular) || {},
          qt = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
        return {
          dayOpen: sig(lastOf(qt.open)),
          name: String(m.shortName || m.longName || sym).slice(0, 60),
          exchange: String(m.fullExchangeName || m.exchangeName || '').slice(0, 40),
          currency: String(m.currency || '').slice(0, 5),
          type: String(m.instrumentType || '').slice(0, 20),
          dayHigh: sig(m.regularMarketDayHigh),
          dayLow: sig(m.regularMarketDayLow),
          volume: fin(m.regularMarketVolume) ? Math.round(m.regularMarketVolume) : null,
          yearHigh: sig(m.fiftyTwoWeekHigh),
          yearLow: sig(m.fiftyTwoWeekLow),
          open: fin(per.start) && fin(per.end) ? [per.start * 1000, per.end * 1000] : null,
        };
      })
    );
  }
  // prices and lines of a list for a range (v8 spark, one request for the whole list)
  function spark(list, range, every) {
    return cached('ss:' + range + ':' + list.join(','), every, () =>
      read(
        fetch,
        YAHOO + '/v8/finance/spark?symbols=' + encodeURIComponent(list.join(',')) + '&range=' + range + '&interval=' + STOCK_RANGES[range]
      ).then(j => {
        const out = {};
        list.forEach(s => {
          const x = j && j[s];
          if (!x || !Array.isArray(x.close)) return;
          out[s] = {
            // the last price of the regular session (fulldayPrice also counts the trades after the close)
            last: sig(lastOf(x.close)),
            prev: sig(fin(x.previousClose) ? x.previousClose : x.chartPreviousClose),
            first: sig(x.chartPreviousClose),
            line: thin(x.close, MAX_POINTS),
          };
        });
        if (!Object.keys(out).length) throw new Error('no prices for these symbols');
        return out;
      })
    );
  }
  async function stocks(symbols, range) {
    const list = stockList(symbols);
    if (!list.length) return { error: 'no symbols' };
    range = STOCK_RANGES[range] ? range : '1d';
    const metas = {};
    // the details first (kept 30 minutes): they tell whether a market of the list is open, which sets how often prices are asked.
    // At most 5 seconds are waited for them (the launcher waits 15 for the whole answer); late ones are kept for the next answer.
    const ms = await Promise.all(list.map(s => Promise.race([meta(s), new Promise(ok => setTimeout(() => ok({ error: 'late' }), 5000))])));
    list.forEach((s, i) => (metas[s] = ms[i].v || null));
    const now = Date.now(),
      openNow = s => !!(metas[s] && metas[s].open && now >= metas[s].open[0] && now < metas[s].open[1]),
      anyOpen = list.some(openNow),
      every = anyOpen ? 5 * MIN : 30 * MIN;
    const day = await spark(list, '1d', every);
    if (day.error) return { error: day.error };
    const ln = range === '1d' ? day : await spark(list, range, anyOpen && range === '5d' ? 15 * MIN : 60 * MIN);
    const q = [],
      missing = [];
    list.forEach(s => {
      const d = day.v[s],
        m = metas[s] || {};
      if (!d || !fin(d.last)) return missing.push(s);
      const scale = MINOR[m.currency] ? 0.01 : 1,
        k = v => (fin(v) ? sig(v * scale) : null),
        p = k(d.last),
        prev = k(d.prev),
        line = ((ln.v && ln.v[s] && ln.v[s].line) || d.line).map(k);
      q.push({
        s,
        n: m.name || s,
        x: m.exchange || '',
        t: m.type === 'INDEX' ? 'index' : m.type === 'CURRENCY' ? 'fx' : 'stock',
        cur: MINOR[m.currency] || m.currency || '',
        p,
        c: fin(p) && fin(prev) ? sig(p - prev) : null,
        cp: fin(p) && fin(prev) && prev ? Math.round(((p - prev) / prev) * 10000) / 100 : null,
        prev,
        o: k(m.dayOpen),
        open: m.open ? openNow(s) : null,
        hi: k(m.dayHigh),
        lo: k(m.dayLow),
        v: fin(m.volume) ? m.volume : null,
        yhi: k(m.yearHigh),
        ylo: k(m.yearLow),
        sp: line,
        // the change over the range of the line, for the chart
        rc: line.length > 1 && line[0] ? Math.round(((line[line.length - 1] - line[0]) / line[0]) * 10000) / 100 : null,
      });
    });
    if (!q.length) return { error: 'no prices for these symbols' };
    return { at: day.at, range, q, missing, open: list.some(openNow) };
  }

  // ---- crypto ----
  async function crypto(symbols, vs, range) {
    const list = coinList(symbols);
    if (!list.length) return { error: 'no symbols' };
    vs = VS.indexOf(vs) >= 0 ? vs : 'usd';
    range = CRYPTO_RANGES[range] !== undefined ? range : '1d';
    const r = await cached('cg:' + vs + ':' + list.join(','), 2 * MIN, () =>
      read(
        fetch,
        GECKO +
          '/coins/markets?vs_currency=' +
          vs +
          '&symbols=' +
          encodeURIComponent(list.join(',')) +
          '&include_tokens=top&sparkline=true&price_change_percentage=24h,7d&per_page=50'
      ).then(j => {
        if (!Array.isArray(j)) throw new Error('no prices for these coins');
        return j.map(c => ({
          id: String(c.id || '').slice(0, 80),
          sym: String(c.symbol || '').toLowerCase(),
          n: String(c.name || c.symbol || '').slice(0, 60),
          rank: fin(c.market_cap_rank) ? c.market_cap_rank : null,
          p: sig(c.current_price),
          c: sig(c.price_change_24h),
          cp: fin(c.price_change_percentage_24h) ? Math.round(c.price_change_percentage_24h * 100) / 100 : null,
          cp7: fin(c.price_change_percentage_7d_in_currency) ? Math.round(c.price_change_percentage_7d_in_currency * 100) / 100 : null,
          hi: sig(c.high_24h),
          lo: sig(c.low_24h),
          v: sig(c.total_volume),
          mc: sig(c.market_cap),
          ath: sig(c.ath),
          atl: sig(c.atl),
          sup: sig(c.circulating_supply),
          max: sig(c.max_supply),
          // CoinGecko's 7-day line has a point an hour
          week: thin((c.sparkline_in_7d && c.sparkline_in_7d.price) || [], 168),
        }));
      })
    );
    if (r.error) return { error: r.error };
    const q = [],
      missing = [],
      // the first match is the coin with the larger market cap (CoinGecko sorts by it)
      coins = list.map(s => r.v.filter(x => x.sym === s)[0]);
    // the longer lines, one coin after the other (not all at once: the public API counts requests per minute); a coin whose line
    // cannot be had shows its 7-day line
    // (within 6 seconds: the launcher waits 15 for an answer; the lines not had yet come with the next answers, a minute later)
    const long = {},
      t0 = Date.now();
    if (CRYPTO_RANGES[range])
      for (const c of coins) {
        if (!c || !c.id) continue;
        if (Date.now() - t0 > 6000 && !cache['cc:' + c.id + ':' + vs + ':' + range]) continue;
        const h = await cached('cc:' + c.id + ':' + vs + ':' + range, range === '1y' ? 360 * MIN : 60 * MIN, () =>
          read(
            fetch,
            GECKO + '/coins/' + encodeURIComponent(c.id) + '/market_chart?vs_currency=' + vs + '&days=' + CRYPTO_RANGES[range]
          ).then(j => {
            const p = ((j && j.prices) || []).map(x => (Array.isArray(x) ? x[1] : null));
            if (p.filter(fin).length < 2) throw new Error('no line');
            return thin(p, MAX_POINTS);
          })
        );
        if (h.v) long[c.id] = h.v;
      }
    list.forEach((s, i) => {
      const c = coins[i];
      if (!c) return missing.push(s.toUpperCase());
      const line = range === '1d' ? c.week.slice(-25) : long[c.id] || thin(c.week, MAX_POINTS);
      q.push({
        s: s.toUpperCase(),
        n: c.n,
        x: c.rank ? '#' + c.rank : '',
        t: 'coin',
        cur: vs.toUpperCase(),
        p: c.p,
        c: c.c,
        cp: c.cp,
        cp7: c.cp7,
        hi: c.hi,
        lo: c.lo,
        v: c.v,
        mc: c.mc,
        ath: c.ath,
        atl: c.atl,
        sup: c.sup,
        max: c.max,
        rank: c.rank,
        sp: line,
        rc: line.length > 1 && line[0] ? Math.round(((line[line.length - 1] - line[0]) / line[0]) * 10000) / 100 : null,
      });
    });
    if (!q.length) return { error: 'no prices for these coins' };
    return { at: r.at, range, q, missing };
  }

  return { stocks, crypto };
}

module.exports = { create, stockList, coinList, thin, STOCK_RANGES, CRYPTO_RANGES, VS, MINOR };
