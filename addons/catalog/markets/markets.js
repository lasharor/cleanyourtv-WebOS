// Prices for the Stocks and Crypto cards of the markets add-on, from two official APIs:
//   stocks from Twelve Data (https://twelvedata.com/docs), with the person's own free API key: /quote (name, exchange, currency, price,
//   previous close, open, day range, volume, 52-week range, market open) and /time_series (the line of a range), several symbols in one
//   request. The key goes only in the Authorization header to Twelve Data, never follows a redirect and is never logged.
//   crypto from CoinGecko's public API, no key (/coins/markets: the price, the 24-hour change, rank, market cap and a 7-day line for the
//   whole list in one request; /coins/<id>/market_chart for 30 days and a year, asked only while that range is chosen).
// Twelve Data's free plan (Basic) counts credits: one per symbol of a request, 8 a minute and 800 a day (the day of UTC). Every request
// is counted here and none is made past either limit: a list larger than the minute allows is asked in parts, one part a minute (the
// launcher asks for a card's data every minute). Prices are asked every max(5, symbols) minutes while the US market is open, their lines
// half as often, and every 6 hours while it is closed; 50 credits of the day are kept for the drawer's charts.
// Every answer is kept in markets.json, so Home shows prices at once and while the internet is away (older than a day is dropped).
// Only the symbols leave the TV (and the key, to Twelve Data). The same request is never made twice at once.
//   create({path, fetch}) -> { stocks(symbols, range, key) -> {at, q, missing, open} | {error, code},
//                              stockLine(symbol, range, key) -> {s, sp, rc} | null,
//                              credits() -> {day, minute},
//                              crypto(symbols, vs, range) -> {at, q, missing} | {error} }
// Runs on Node 8 (webOS 5 and 6): no ?., no ??, no .finally.
const fs = require('fs');
const TWELVE = process.env.CYTV_TWELVE_URL || 'https://api.twelvedata.com',
  GECKO = process.env.CYTV_GECKO_URL || 'https://api.coingecko.com/api/v3',
  MIN = 60 * 1000,
  HOUR = 60 * MIN,
  OLD = 24 * 3600 * 1000,
  MAX_SYMBOLS = 20,
  MAX_POINTS = 120,
  PER_MIN = 8, // Twelve Data's free plan: credits a minute
  PER_DAY = 800, // and a day
  SPARE = 50; // credits of the day the lists leave for the drawer's charts
// the ranges the cards offer: Twelve Data's interval and how many points of it
const STOCK_RANGES = { '1d': ['5min', 78], '5d': ['30min', 65], '1mo': ['1day', 22], '6mo': ['1day', 126], '1y': ['1day', 252] };
// 24 hours and 7 days come with the prices (CoinGecko's 7-day line); 30 days and a year are one more request per coin, kept for hours
const CRYPTO_RANGES = { '1d': 0, '7d': 0, '30d': 30, '1y': 365 };
const VS = ['usd', 'eur', 'ils', 'btc'];
// prices given in the smaller unit: agorot (Tel Aviv), pence (London), cents (Johannesburg); exchanges a paid Twelve Data plan has
const MINOR = { ILA: 'ILS', GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR' };

const fin = v => typeof v === 'number' && isFinite(v);
// six significant digits are more than any card shows
const sig = v => (fin(v) ? Number(v.toPrecision(7)) : null);
// Twelve Data's numbers are strings
const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : null;
};

// a watchlist as typed on the phone: "aapl, brk.b spy" -> ['AAPL', 'BRK.B', 'SPY'] (at most 20, no repeats); an exchange may follow a
// colon, as Twelve Data writes it (VOD:LSE)
function stockList(s) {
  const out = [];
  String(s || '')
    .toUpperCase()
    .split(/[\s,;]+/)
    .forEach(x => {
      if (/^[A-Z0-9][A-Z0-9.\-]{0,11}(:[A-Z0-9]{2,10})?$/.test(x) && out.indexOf(x) < 0 && out.length < MAX_SYMBOLS) out.push(x);
    });
  return out;
}
// whether the US market is open now: Monday to Friday, 9:30 to 16:00 in New York (summer time from the second Sunday of March to the
// first Sunday of November, at 2:00). Holidays are not known here; the quotes say is_market_open on those days.
function usOpen(t) {
  const d = new Date(t),
    y = d.getUTCFullYear();
  const sunday = (month, nth) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (nth - 1) * 7;
  };
  // 2:00 local is 7:00 UTC in March (EST) and 6:00 UTC in November (EDT)
  const summer = t >= Date.UTC(y, 2, sunday(2, 2), 7) && t < Date.UTC(y, 10, sunday(10, 1), 6);
  const ny = new Date(t - (summer ? 4 : 5) * HOUR),
    day = ny.getUTCDay(),
    m = ny.getUTCHours() * 60 + ny.getUTCMinutes();
  return day >= 1 && day <= 5 && m >= 570 && m < 960;
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
      allowHttp: () => !!process.env.CYTV_GECKO_URL,
    })
    .then(r => JSON.parse(r.body.toString('utf8')));
}
// an error of Twelve Data that stops every request for a while: code 'key' (the key was refused), 'minute' or 'day' (a limit)
function stop(code, msg) {
  const e = /** @type {Error & {code?: string}} */ (new Error(msg));
  e.code = code;
  return e;
}
// one request to Twelve Data: the key only in the Authorization header, no redirect (the key would go along). Resolves the answer
// keyed by symbol ({AAPL: {...}, MSFT: {...}}, also for one symbol); a symbol Twelve Data does not have (or the plan does not cover)
// comes as {missing: message}.
function twelve(fetch, route, list, extra, key) {
  return fetch
    .read(TWELVE + route + '?symbol=' + encodeURIComponent(list.join(',')) + (extra || ''), {
      headers: { Authorization: 'apikey ' + key, 'User-Agent': 'cleanyourtv-markets', Accept: 'application/json' },
      maxBytes: 1024 * 1024,
      totalMs: 8000,
      redirects: 0,
      anyStatus: true,
      allowHttp: () => !!process.env.CYTV_TWELVE_URL,
    })
    .then(r => {
      let j = null;
      try {
        j = JSON.parse(r.body.toString('utf8'));
      } catch (_) {}
      const code = (j && num(j.code)) || r.status,
        msg = String((j && j.message) || '').slice(0, 200);
      if (code === 401) throw stop('key', 'Twelve Data refused the key');
      if (code === 429) throw stop(/day|daily/i.test(msg) ? 'day' : 'minute', "Twelve Data's limit is used up");
      if (!j || typeof j !== 'object' || code >= 500 || (r.status !== 200 && list.length > 1))
        throw new Error('Twelve Data answered ' + r.status);
      // one symbol: the answer itself (or its error); several: one entry per symbol
      const by = list.length === 1 ? { [list[0]]: j } : j,
        out = {};
      list.forEach(s => {
        const x = by[s];
        out[s] =
          !x || typeof x !== 'object' || x.status === 'error' ? { missing: String((x && x.message) || 'not found').slice(0, 200) } : x;
      });
      return out;
    });
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

  // ---- stocks (Twelve Data) ----
  // The credits spent: the times of the last minute's, and the count of the day (UTC, as Twelve Data counts), kept in markets.json.
  let minute = [];
  const today = () => new Date(Date.now()).toISOString().slice(0, 10);
  function credits() {
    const t = Date.now();
    minute = minute.filter(x => t - x < MIN);
    const d = cache._day && cache._day.v && cache._day.v.d === today() ? cache._day.v.n : 0;
    return { minute: PER_MIN - minute.length, day: PER_DAY - d };
  }
  function spend(n) {
    const t = Date.now();
    for (let i = 0; i < n; i++) minute.push(t);
    const d = cache._day && cache._day.v && cache._day.v.d === today() ? cache._day.v.n : 0;
    cache._day = { at: t, v: { d: today(), n: d + n } };
  }
  function unspend(n) {
    minute = minute.slice(0, Math.max(0, minute.length - n));
    if (cache._day && cache._day.v && cache._day.v.d === today()) cache._day.v.n = Math.max(0, cache._day.v.n - n);
  }
  // a stop for every request after Twelve Data refused the key or a limit: {code, until, key}
  let halt = null;
  const halted = key => !!halt && (halt.code === 'key' ? halt.key === key : Date.now() < halt.until);
  // requests one after the other, so two cards (or a card and the drawer) never spend the same credits twice
  let chain = Promise.resolve();
  const inTurn = work => {
    const p = chain.then(work, work);
    chain = p.then(
      () => {},
      () => {}
    );
    return p;
  };
  // ask route for the symbols of list that need it, as many as the credits allow now (spare: credits of the day to leave); each answer
  // is kept under name(symbol) through pick(answer)
  function pull(route, extra, list, name, pick, key, spare) {
    return inTurn(async () => {
      if (!list.length || halted(key)) return;
      const c = credits(),
        n = Math.min(list.length, c.minute, c.day - (spare || 0));
      if (n <= 0) return;
      const part = list.slice(0, n);
      spend(n);
      try {
        const r = await twelve(fetch, route, part, extra, key);
        part.forEach(s => {
          const x = r[s],
            v = x.missing ? { missing: x.missing } : pick(x);
          cache[name(s)] = { at: Date.now(), v: v || { missing: 'no data' } };
        });
      } catch (e) {
        if (e.code === 'key') {
          halt = { code: 'key', key };
          unspend(n); // a refused key costs nothing
        } else if (e.code === 'day') {
          const t = new Date(Date.now());
          halt = { code: 'day', until: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1) };
        } else halt = { code: e.code || 'away', until: Date.now() + (e.code === 'minute' ? MIN : 5 * MIN) };
        halt.error = String(e.message || e);
      }
      keep();
    });
  }
  const quoteOf = x => ({
    name: String(x.name || x.symbol || '').slice(0, 60),
    exchange: String(x.exchange || '').slice(0, 40),
    currency: String(x.currency || '').slice(0, 5),
    p: sig(num(x.close)),
    prev: sig(num(x.previous_close)),
    o: sig(num(x.open)),
    hi: sig(num(x.high)),
    lo: sig(num(x.low)),
    v: num(x.volume) !== null ? Math.round(num(x.volume)) : null,
    yhi: sig(num(x.fifty_two_week && x.fifty_two_week.high)),
    ylo: sig(num(x.fifty_two_week && x.fifty_two_week.low)),
    open: x.is_market_open === true,
  });
  // a line from a time series: oldest first; for a day only the last day's points
  const lineOf = range => x => {
    let v = Array.isArray(x.values) ? x.values.slice() : [];
    if (v.length > 1 && String(v[0].datetime) > String(v[v.length - 1].datetime)) v.reverse();
    if (range === '1d' && v.length) {
      const last = String(v[v.length - 1].datetime).slice(0, 10);
      v = v.filter(p => String(p.datetime).slice(0, 10) === last);
    }
    const line = thin(
      v.map(p => num(p.close)),
      MAX_POINTS
    );
    return line.length ? line : null;
  };
  const tsArgs = range => '&interval=' + STOCK_RANGES[range][0] + '&outputsize=' + STOCK_RANGES[range][1] + '&order=asc';
  const fresh = (k, every) => !!cache[k] && Date.now() - cache[k].at < every;
  // how often a list is asked: prices every max(5, symbols) minutes while the market is open (lines half as often; the longer ranges
  // change once a day), every 6 hours while it is closed
  function pace(list, range, open) {
    const q = open ? Math.max(5, list.length) * MIN : 6 * HOUR;
    return { q, l: range === '1d' || range === '5d' ? (open ? 2 * q : 6 * HOUR) : 6 * HOUR };
  }
  // wait at most ms for work; what comes later is kept for the next answer (the launcher waits 15 seconds)
  const within = (work, ms) => Promise.race([work, new Promise(ok => setTimeout(ok, ms))]);

  async function stocks(symbols, range, key) {
    const list = stockList(symbols);
    if (!list.length) return { error: 'no symbols', code: 'empty' };
    if (!key) return { error: 'no key', code: 'nokey' };
    range = STOCK_RANGES[range] ? range : '1d';
    const kept = s => (cache['tq:' + s] && Date.now() - cache['tq:' + s].at < OLD && cache['tq:' + s].v) || null;
    const open = usOpen(Date.now()) || list.some(s => kept(s) && kept(s).open);
    const p = pace(list, range, open);
    const needQ = list.filter(s => !fresh('tq:' + s, kept(s) && kept(s).missing ? 6 * HOUR : p.q)),
      needL = list.filter(s => !(kept(s) && kept(s).missing) && !fresh('tl:' + range + ':' + s, p.l));
    await within(
      pull('/quote', '', needQ, s => 'tq:' + s, quoteOf, key, SPARE).then(() =>
        pull(
          '/time_series',
          tsArgs(range),
          needL.filter(s => !(kept(s) && kept(s).missing)),
          s => 'tl:' + range + ':' + s,
          lineOf(range),
          key,
          SPARE
        )
      ),
      9000
    );
    const q = [],
      missing = [];
    let at = 0;
    list.forEach(s => {
      const m = kept(s);
      if (m && m.missing) return missing.push(s);
      if (!m || !fin(m.p)) return;
      at = Math.max(at, cache['tq:' + s].at);
      const scale = MINOR[m.currency] ? 0.01 : 1,
        k = v => (fin(v) ? sig(v * scale) : null),
        pr = k(m.p),
        prev = k(m.prev),
        l = cache['tl:' + range + ':' + s],
        line = ((l && l.v && Array.isArray(l.v) && l.v) || []).map(k);
      q.push({
        s,
        n: m.name || s,
        x: m.exchange,
        t: 'stock',
        cur: MINOR[m.currency] || m.currency,
        p: pr,
        c: fin(pr) && fin(prev) ? sig(pr - prev) : null,
        cp: fin(pr) && fin(prev) && prev ? Math.round(((pr - prev) / prev) * 10000) / 100 : null,
        prev,
        o: k(m.o),
        open: m.open,
        hi: k(m.hi),
        lo: k(m.lo),
        v: m.v,
        yhi: k(m.yhi),
        ylo: k(m.ylo),
        sp: line,
        rc: line.length > 1 && line[0] ? Math.round(((line[line.length - 1] - line[0]) / line[0]) * 10000) / 100 : null,
      });
    });
    if (!q.length) {
      if (halt && halted(key)) return { error: halt.error, code: halt.code };
      if (missing.length === list.length) return { error: 'no prices for these symbols', code: 'missing' };
      return { error: 'getting prices', code: 'loading' };
    }
    return { at, range, q, missing, open: q.some(x => x.open) || usOpen(Date.now()), partial: q.length + missing.length < list.length };
  }
  // the drawer's chart of one symbol over a range: one credit, kept like the card's lines; waits at most 6 seconds
  async function stockLine(sym, range, key) {
    const s = stockList(sym)[0];
    if (!s || !key || !STOCK_RANGES[range]) return null;
    const name = 'tl:' + range + ':' + s,
      open = usOpen(Date.now());
    if (!fresh(name, pace([s], range, open).l))
      await within(
        pull('/time_series', tsArgs(range), [s], () => name, lineOf(range), key, 0),
        6000
      );
    const l = cache[name],
      line = (l && Array.isArray(l.v) && l.v) || null;
    if (!line) return null;
    const m = (cache['tq:' + s] && cache['tq:' + s].v) || {},
      k = MINOR[m.currency] ? v => sig(v * 0.01) : v => v,
      sp = line.map(k);
    return { s, sp, rc: sp.length > 1 && sp[0] ? Math.round(((sp[sp.length - 1] - sp[0]) / sp[0]) * 10000) / 100 : null };
  }
  // the phone page's Test key and save: one quote (one credit) with the new key; refused, limited or answered
  async function testKey(key) {
    if (credits().minute < 1 || credits().day < 1) return { error: "Twelve Data's limit is used up", code: 'minute' };
    if (halt && halt.code === 'key' && halt.key === key) halt = null;
    await pull('/quote', '', ['AAPL'], s => 'tq:' + s, quoteOf, key, 0);
    return halt && halted(key) ? { error: halt.error, code: halt.code } : { ok: true };
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

  return { stocks, stockLine, testKey, credits, crypto };
}

// a company's name without its legal form, so it fits a row: "Microsoft Corporation" -> "Microsoft", "Tesla, Inc." -> "Tesla"
function shortName(n) {
  let s = String(n || '').trim();
  for (let i = 0; i < 2; i++)
    s = s.replace(
      /,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.|Ltd\.?|Limited|plc|PLC|Holdings|Group|N\.V\.|S\.A\.|AG|SE)$/i,
      ''
    );
  return s.replace(/[,\s]+$/, '') || String(n || '');
}

module.exports = { create, stockList, coinList, thin, shortName, usOpen, STOCK_RANGES, CRYPTO_RANGES, VS, MINOR, PER_MIN, PER_DAY };
