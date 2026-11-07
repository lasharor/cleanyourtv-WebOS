// The markets add-on (addons/catalog/markets): the Stocks and Crypto cards' data from stand-ins for Twelve Data and CoinGecko (prices,
// lines, details, prices in agorot, unknown symbols), the key (only in the Authorization header, refused, never in an answer), the
// credits of the free plan (8 a minute, 800 a day: a long list asked in parts), the answers kept and spaced, a failing service, the
// presets, the phone page for the key, the words, the manifest, and the pages: ES5, no requests, the sheet protocol of the drawer, and
// cards/crypto/ the same as cards/stocks/.
const fs = require('fs'),
  path = require('path');
const { root, ok, serve, req, run, tmp } = require('./lib');

run(async () => {
  const nc = req('netcompat');
  // the clock the add-on reads, moved forward to start a new minute of credits
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  const nextMinute = () => (shift += 61 * 1000);
  // ---- stand-ins: Twelve Data (quote, time_series) and CoinGecko (markets, market_chart) ----
  const asked = { quote: 0, series: 0, credits: 0, markets: 0, mchart: 0 };
  const GOOD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  let fail = false,
    limit = '',
    lastTwelve = '',
    lastAuth = '',
    lastMarkets = '';
  const STOCK = {
    AAPL: { name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', prev: 344.17, p: 342.37, open: true },
    SPY: { name: 'SPDR S&P 500 ETF Trust', exchange: 'NYSE', currency: 'USD', prev: 736, p: 737.68, open: true },
    'TEVA:TASE': { name: 'Teva Pharmaceutical Industries Ltd', exchange: 'TASE', currency: 'ILA', prev: 13180, p: 13300, open: false },
  };
  for (const s of 'ABCDEFGHIJ'.split('')) STOCK[s] = { name: s + ' Corp', exchange: 'NYSE', currency: 'USD', prev: 10, p: 11, open: true };
  const COINS = [
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', rank: 1, p: 75974, cp: 0.14 },
    { id: 'ethereum', symbol: 'eth', name: 'Ethereum', rank: 2, p: 2239.04, cp: -0.23 },
    { id: 'eth-clone', symbol: 'eth', name: 'Ether Clone', rank: 900, p: 0.01, cp: 3 },
  ];
  const json = (res, j, st) => {
    res.writeHead(st || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(j));
  };
  // a day of 5-minute points from yesterday's and today's sessions, or n daily points
  const series = (s, interval, n) => {
    const x = STOCK[s],
      out = [];
    if (interval === '5min') {
      for (let i = 0; i < 10; i++) out.push({ datetime: '2026-11-05 15:' + (10 + i), close: String(x.prev - 1) });
      for (let i = 0; i < 70; i++)
        out.push({
          datetime: '2026-11-06 ' + (9 + Math.floor(i / 12)) + ':' + (i % 12) * 5,
          close: String(x.prev + ((x.p - x.prev) * i) / 69),
        });
      return out.slice(-n);
    }
    for (let i = 0; i < n; i++)
      out.push({ datetime: '2026-' + (1 + (i % 12)) + '-' + (1 + (i % 28)), close: String(x.p * 1.2 - (x.p * 0.2 * i) / (n - 1)) });
    return out;
  };
  const srv = await serve((q, res) => {
    if (fail) {
      res.writeHead(500);
      return res.end('{}');
    }
    const u = q.url;
    const t = /^\/t\/(quote|time_series)\?symbol=([^&]+)(.*)$/.exec(u);
    if (t) {
      lastTwelve = u;
      lastAuth = q.headers.authorization || '';
      if (lastAuth !== 'apikey ' + GOOD) return json(res, { code: 401, message: 'Invalid API key', status: 'error' }, 401);
      if (limit) return json(res, { code: 429, message: limit, status: 'error' }, 429);
      const list = decodeURIComponent(t[2]).split(',');
      asked[t[1] === 'quote' ? 'quote' : 'series']++;
      asked.credits += list.length;
      const one = s => {
        const x = STOCK[s];
        if (!x) return { code: 404, message: 'symbol not found: ' + s, status: 'error' };
        if (t[1] === 'quote')
          return {
            symbol: s.split(':')[0],
            name: x.name,
            exchange: x.exchange,
            currency: x.currency,
            open: String(x.prev + 1),
            high: String(x.p + 2),
            low: String(x.p - 3),
            close: String(x.p),
            volume: '43750861',
            previous_close: String(x.prev),
            is_market_open: x.open,
            fifty_two_week: { low: String(x.p * 0.7), high: String(x.p * 1.2) },
          };
        const iv = /interval=([^&]+)/.exec(t[3])[1],
          n = +/outputsize=(\d+)/.exec(t[3])[1];
        return { meta: { symbol: s, interval: iv, currency: x.currency }, values: series(s, iv, n), status: 'ok' };
      };
      if (list.length === 1) {
        const r = one(list[0]);
        return json(res, r, r.code || 200);
      }
      const out = {};
      list.forEach(s => (out[s] = one(s)));
      return json(res, out);
    }
    if (/^\/g\/coins\/markets\?/.test(u)) {
      asked.markets++;
      lastMarkets = u;
      const syms = decodeURIComponent(/symbols=([^&]+)/.exec(u)[1]).split(',');
      return json(
        res,
        COINS.filter(c => syms.indexOf(c.symbol) >= 0).map(c => ({
          id: c.id,
          symbol: c.symbol,
          name: c.name,
          market_cap_rank: c.rank,
          current_price: c.p,
          price_change_24h: (c.p * c.cp) / 100,
          price_change_percentage_24h: c.cp,
          price_change_percentage_7d_in_currency: 4.2,
          high_24h: c.p * 1.01,
          low_24h: c.p * 0.98,
          total_volume: 31141120409,
          market_cap: 1527605717022,
          ath: c.p * 1.6,
          atl: c.p * 0.001,
          circulating_supply: 20107040,
          max_supply: c.id === 'bitcoin' ? 21000000 : null,
          sparkline_in_7d: { price: Array.apply(null, Array(168)).map((_, i) => c.p * (0.95 + i / 3000)) },
        }))
      );
    }
    const m = /^\/g\/coins\/([^/]+)\/market_chart\?/.exec(u);
    if (m) {
      asked.mchart++;
      const days = +/days=(\d+)/.exec(u)[1];
      return json(res, { prices: Array.apply(null, Array(days * 24)).map((_, i) => [i, 1000 + i]) });
    }
    res.writeHead(404);
    res.end('{}');
  });
  process.env.CYTV_TWELVE_URL = srv.url + '/t';
  process.env.CYTV_GECKO_URL = srv.url + '/g';

  const addonDir = path.join(root, 'addons', 'catalog', 'markets');
  const mk = require(path.join(addonDir, 'markets.js'));
  const S = require(path.join(addonDir, 'service.js'));
  let lang = '',
    settings = {};
  const logged = [];
  const ctx = {
    id: 'markets',
    dir: addonDir,
    dataDir: path.join(tmp, 'addon-data', 'markets'),
    log: m => logged.push(m),
    fetch: req('fetch'),
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => lang, wallpaperSize: () => '4k' },
    settings: { get: () => Object.assign({}, settings), set: o => (settings = Object.assign({}, settings, o)) },
  };
  const svc = S.create(ctx);

  // ---- the lists as typed ----
  ok(
    mk.stockList(' aapl, brk.b vod:lse;AAPL bad!sym ^gspc').join() === 'AAPL,BRK.B,VOD:LSE',
    'a stock list is upper-cased, split on commas and spaces, without repeats or bad symbols; an exchange may follow a colon'
  );
  ok(mk.coinList('BTC, eth eth').join() === 'btc,eth', 'a coin list is lower-cased and without repeats');
  ok(mk.stockList('A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V').length === 20, 'at most 20 symbols');
  ok(mk.thin([1, null, 2, 3, 4, 5], 3).join() === '1,3,5', 'a line is thinned evenly, the gaps left out, the last point kept');
  ok(
    mk.usOpen(Date.UTC(2026, 10, 9, 15, 0)) && // Monday 10:00 in New York (winter time)
      !mk.usOpen(Date.UTC(2026, 10, 9, 14, 0)) && // 9:00
      !mk.usOpen(Date.UTC(2026, 10, 9, 21, 0)) && // 16:00
      mk.usOpen(Date.UTC(2026, 6, 6, 13, 45)) && // Monday 9:45 (summer time)
      !mk.usOpen(Date.UTC(2026, 6, 6, 13, 15)) &&
      !mk.usOpen(Date.UTC(2026, 10, 7, 16, 0)), // Saturday
    'the US market hours, in winter and in summer time, Monday to Friday'
  );

  // ---- no symbols, no key ----
  let d = await svc.cards.feed('stocks', { list: 'custom', symbols: ' , ' });
  ok(d.empty === true && d.labels['Choose your stocks'] && asked.quote === 0, 'with no symbols the card is told so, and asks nobody');
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL' });
  ok(
    /Twelve Data key/.test(d.error) && /Set up from your phone/.test(d.error) && !d.q && asked.quote === 0,
    'without a key the card says where to set it, and asks nobody'
  );

  // ---- the key on the phone page ----
  const phone = async (method, p, body, code) => {
    let out = null;
    const qq = {
      method,
      url: p,
      headers: { 'x-code': code || '' },
      on: (ev, f) => {
        if (ev === 'data' && body) f(Buffer.from(JSON.stringify(body)));
        if (ev === 'end') f();
      },
    };
    await new Promise(done => {
      const rs = {
        writeHead: (st, h) => (out = { st, h }),
        end: b => {
          out.body = String(b || '');
          done();
        },
      };
      svc.handlePhone(qq, rs, '123456', () => 1);
    });
    let j = null;
    try {
      j = JSON.parse(out.body);
    } catch (_) {}
    return { st: out.st, j, body: out.body };
  };
  ok(S.PAIR_PORT === 8801, 'the phone page has its own port (8801, after the repositories page)');
  let r = await phone('GET', '/', null, '');
  ok(
    r.st === 200 && /type=password/.test(r.body) && /twelvedata\.com/.test(r.body),
    'the phone page asks for the key, as a password field'
  );
  r = await phone('GET', '/api/state', null, '000000');
  ok(r.st === 403, 'the phone page needs the code shown on the TV');
  r = await phone('POST', '/api/save', { key: 'short' }, '123456');
  ok(r.st === 400 && /does not look like/.test(r.j.error) && asked.quote === 0, 'a key that is not one is refused before any request');
  r = await phone('POST', '/api/save', { key: 'f'.repeat(32) }, '123456');
  ok(r.st === 400 && /refused the key/.test(r.j.error) && !settings.key, 'a key Twelve Data refuses is not saved: ' + r.body);
  r = await phone('POST', '/api/save', { key: GOOD }, '123456');
  ok(
    r.st === 200 && settings.key === GOOD && lastAuth === 'apikey ' + GOOD && !/apikey=/.test(lastTwelve),
    'Test key and save: one quote, the key in the Authorization header only'
  );
  r = await phone('GET', '/api/state', null, '123456');
  ok(
    r.j.configured === true && r.j.keyHint === '…' + GOOD.slice(-4) && r.body.indexOf(GOOD) < 0 && r.j.used === 1 && r.j.perDay === 800,
    'the state shows the last four characters of the key and the credits of the day: ' + r.body
  );
  r = await phone('POST', '/api/save', { key: '' }, '123456');
  ok(r.st === 200 && settings.key === GOOD, 'saving with the field empty keeps the key');
  nextMinute();

  // ---- stocks ----
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL,TEVA:TASE,SPY,NOPE', range: '1d', show: 'pct' });
  const a = d.q && d.q[0],
    t = d.q && d.q[1],
    g = d.q && d.q[2];
  ok(
    d.kind === 'stocks' && d.q.length === 3 && d.missing.join() === 'NOPE',
    'three symbols have prices, the unknown one is listed as missing: ' + JSON.stringify(d.missing)
  );
  ok(
    a.s === 'AAPL' && a.n === 'Apple' && a.x === 'NASDAQ' && a.cur === 'USD' && a.t === 'stock' && a.p === 342.37 && a.prev === 344.17,
    'a stock: name, exchange, currency, price and previous close: ' + JSON.stringify(a).slice(0, 200)
  );
  ok(a.cp === -0.52 && Math.abs(a.c + 1.8) < 1e-6, "today's change in percent and in price");
  ok(
    a.o === 345.17 && a.hi === 344.37 && a.lo === 339.37 && a.v === 43750861 && a.open === true && a.yhi === 410.844,
    'open, day range, volume, 52-week high and the market open'
  );
  ok(a.sp.length === 70 && a.sp.every(v => typeof v === 'number') && a.sp[0] === 344.17, "the line of today's session only, oldest first");
  ok(t.cur === 'ILS' && t.p === 133 && t.prev === 131.8 && t.open === false, 'prices in agorot are shown in shekels');
  ok(g.n === 'SPDR S&P 500 ETF Trust' && d.open === true, 'an ETF, and a market of the list is open');
  ok(asked.quote === 2 && asked.series === 1, 'one quote request and one line request for the whole list');
  ok(JSON.stringify(d).indexOf(GOOD) < 0, 'the key is never in a card answer');
  const c0 = asked.credits;
  await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL,TEVA:TASE,SPY,NOPE', range: '1d' });
  ok(asked.credits === c0, 'a second answer within 5 minutes asks nobody (and an unknown symbol is not asked again)');
  nextMinute();
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL', range: '1mo', show: 'abs' });
  ok(
    /interval=1day&outputsize=22/.test(lastTwelve) && d.q[0].sp.length === 22 && d.range === '1mo' && d.show === 'abs',
    'a longer range asks for its own line'
  );
  ok(typeof d.q[0].rc === 'number' && d.q[0].rc < 0, 'the change over the range, for the chart');

  // ---- the credits: 8 a minute; a longer list is asked in parts, one a minute ----
  nextMinute();
  const ten = 'A,B,C,D,E,F,G,H,I,J',
    c1 = asked.credits;
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: ten, range: '1d' });
  ok(
    asked.credits - c1 === 8 && d.q.length === 8 && d.q.every(x => !x.sp.length),
    'ten symbols: the prices of eight in the first minute, no line yet'
  );
  nextMinute();
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: ten, range: '1d' });
  ok(asked.credits - c1 === 16 && d.q.length === 10, 'the next minute the last two prices and six lines');
  nextMinute();
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: ten, range: '1d' });
  ok(asked.credits - c1 === 20 && d.q.every(x => x.sp.length === 70), 'and the last lines a minute later: never more than 8 a minute');
  ok(mk.PER_MIN === 8 && mk.PER_DAY === 800, 'the limits of the free plan');

  // ---- a limit or a refused key stops the requests ----
  nextMinute();
  limit = 'You have run out of API credits for the day.';
  const c2 = asked.credits;
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'K1', range: '1d' });
  ok(/limit for today/.test(d.error), 'the daily limit is said on the card');
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'K2', range: '1d' });
  ok(asked.credits === c2 && /limit for today/.test(d.error), 'and nothing is asked until the next day (UTC)');
  limit = '';
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL,TEVA:TASE,SPY,NOPE', range: '1d' });
  ok(d.q && d.q.length === 3, 'a list asked before still shows its last prices');
  shift += 24 * 3600 * 1000;
  settings.key = 'e'.repeat(32);
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'MSFT', range: '1d' });
  ok(/refused the key/.test(d.error), 'a refused key is said on the card');
  const c3 = asked.credits;
  await svc.cards.feed('stocks', { list: 'custom', symbols: 'MSFT', range: '1d' });
  ok(asked.credits === c3, 'and not tried again until the key changes');
  settings.key = GOOD;
  ok(!logged.some(l => l.indexOf(GOOD) >= 0 || l.indexOf('e'.repeat(32)) >= 0), 'no key is logged');
  nextMinute();

  // ---- presets ----
  d = await svc.cards.feed('stocks', { list: 'idx', symbols: 'XXX' });
  ok(d.q.map(q => q.s).join() === 'SPY' && d.missing.join() === 'QQQ,DIA', 'a preset list is used instead of the typed one');
  ok(
    S.PRESETS.stocks.tech === 'AAPL,MSFT,NVDA,GOOGL,TSLA' &&
      S.PRESETS.stocks.idx === 'SPY,QQQ,DIA' &&
      S.PRESETS.crypto.top === 'BTC,ETH,SOL,XRP,DOGE' &&
      Object.keys(S.PRESETS.stocks).every(k => mk.stockList(S.PRESETS.stocks[k]).every(s => s.indexOf(':') < 0)),
    "the presets are US symbols (the free plan's market)"
  );
  nextMinute();

  // ---- crypto ----
  d = await svc.cards.feed('crypto', { list: 'custom', symbols: 'btc,eth,nope', vs: 'eur', range: '1d' });
  ok(d.kind === 'crypto' && d.q.length === 2 && d.missing.join() === 'NOPE' && d.vs === 'EUR', 'two coins and one missing, in euros');
  const b = d.q[0],
    e = d.q[1];
  ok(
    b.s === 'BTC' && b.n === 'Bitcoin' && b.rank === 1 && b.x === '#1' && b.t === 'coin' && b.p === 75974 && b.cp === 0.14,
    'a coin: symbol, name, rank, price and change: ' + JSON.stringify(b).slice(0, 200)
  );
  ok(e.n === 'Ethereum', 'of two coins with one symbol, the larger one is shown');
  ok(
    Math.abs(b.mc - 1527605717022) < 1e7 && b.max === 21000000 && typeof b.ath === 'number' && typeof b.atl === 'number',
    'market cap, supply and the all-time range'
  );
  ok(b.sp.length === 25, '24 hours is the end of the 7-day line');
  ok(/vs_currency=eur&symbols=btc%2Ceth%2Cnope&include_tokens=top&sparkline=true/.test(lastMarkets), 'one request for the whole list');
  const mk0 = asked.markets;
  await svc.cards.feed('crypto', { list: 'custom', symbols: 'btc,eth,nope', vs: 'eur', range: '7d' });
  ok(asked.markets === mk0 && asked.mchart === 0, '7 days comes with the same answer');
  d = await svc.cards.feed('crypto', { list: 'custom', symbols: 'btc,eth', vs: 'eur', range: '30d' });
  const cryptoD = d;
  ok(asked.mchart === 2 && d.q[0].sp.length === 120 && d.q[0].sp[0] === 1000, '30 days asks once per coin');
  await svc.cards.feed('crypto', { list: 'custom', symbols: 'btc,eth', vs: 'eur', range: '30d' });
  ok(asked.mchart === 2, 'and keeps those lines');
  d = await svc.cards.feed('crypto', { list: 'two', vs: 'xxx' });
  ok(d.vs === 'USD', 'a currency that is not offered is dollars');

  // ---- the drawer's own chart (action "chart"): fetched now, answered in the feed, never a setting of the card ----
  const optC = { list: 'custom', symbols: 'btc,eth', vs: 'eur', range: '1d' };
  ok((await svc.cards.action('crypto', optC, 'chart', 'ETH:30d')).error === undefined, 'the drawer asks for a coin over 30 days');
  d = await svc.cards.feed('crypto', optC);
  ok(
    d.chart && d.chart.s === 'ETH' && d.chart.range === '30d' && d.chart.sp.length === 120 && d.range === '1d',
    'the feed answers it as chart, the card keeps its 1D line'
  );
  ok(
    (await svc.cards.action('crypto', optC, 'chart', 'ETH:9y')).error && (await svc.cards.action('crypto', optC, 'open', '')).error,
    'a range or action it does not know is refused'
  );
  const c4 = asked.credits;
  ok((await svc.cards.action('stocks', { list: 'custom', symbols: 'AAPL' }, 'chart', 'aapl:1y')).error === undefined, 'a stock too');
  const c5 = asked.credits - c4;
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL', range: '1d' });
  ok(
    d.chart && d.chart.s === 'AAPL' && d.chart.range === '1y' && d.chart.sp.length === 120 && c5 === 1,
    'over a year: one credit, the daily line thinned to 120 points'
  );
  ok(
    mk.shortName('Microsoft Corporation') === 'Microsoft' &&
      mk.shortName('Tesla, Inc.') === 'Tesla' &&
      mk.shortName('Bitcoin') === 'Bitcoin' &&
      d.q[0].n === 'Apple',
    'names lose their legal form so they fit a row'
  );

  // ---- the words ----
  lang = 'nl';
  d = await svc.cards.feed('crypto', { list: 'two' });
  ok(d.labels.Close === req('i18n').tr('nl', 'Close'), 'the words are in the language of the screens');
  lang = '';
  const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'en.json'), 'utf8'));
  ok(
    S.LABELS.every(k => k in en),
    'every word of the cards is in i18n/en.json'
  );
  const cardDir = path.join(addonDir, 'cards', 'stocks');
  const pageJs = fs.readFileSync(path.join(cardDir, 'card.js'), 'utf8') + fs.readFileSync(path.join(cardDir, 'drawer.js'), 'utf8');
  const asked2 = {};
  pageJs.replace(/\bL\('([^']*)'\)|L\['([^']*)'\]|L\.([A-Za-z]+)\b/g, (_, x, y, z) => (asked2[x || y || z] = 1));
  const missingWords = Object.keys(asked2).filter(k => S.LABELS.indexOf(k) < 0);
  ok(!missingWords.length, 'every word the pages ask for is in the labels' + (missingWords.length ? ': ' + missingWords.join(' | ') : ''));

  // ---- when the services are away ----
  nextMinute();
  await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL,TEVA:TASE,SPY,NOPE', range: '1d' });
  shift += 6 * 3600 * 1000 + 61 * 1000;
  fail = true;
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'MSFT2' });
  ok(d.error && !d.q, 'a list that cannot be asked says so');
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL,TEVA:TASE,SPY,NOPE', range: '1d' });
  ok(d.q && d.q[0].p === 342.37, 'a list that was asked before keeps its last answer');
  fail = false;
  srv.server.close();
  Date.now = realNow;

  // ---- the manifest ----
  const addons = req('addons');
  const man = JSON.parse(fs.readFileSync(path.join(addonDir, 'addon.json'), 'utf8'));
  const chk = addons.check(man, '1.6.18');
  ok(
    chk.manifest && chk.manifest.permissions.join() === 'net.fetch' && chk.manifest.provides.join() === 'cards',
    'the manifest is accepted, network only'
  );
  const cards = chk.manifest.cards;
  ok(cards.map(c => c.id).join() === 'stocks,crypto', 'two cards: Stocks and Crypto');
  cards.forEach(c => {
    ok(
      c.page === 'card.html' &&
        c.poll === 60 &&
        c.drawer &&
        c.drawer.page === 'drawer.html' &&
        c.drawer.action === 'open' &&
        c.settings.action === 'settings',
      c.id + ': a page, a poll of a minute, a drawer on OK and the settings'
    );
    const o = {};
    c.options.forEach(x => (o[x.key] = x));
    ok(
      o.list.default === 'custom' && o.look.default === 'minimal' && o.symbols.kind === 'text',
      c.id + ': the list, the look and the symbols'
    );
  });
  const so = {},
    co = {};
  cards[0].options.forEach(x => (so[x.key] = x));
  cards[1].options.forEach(x => (co[x.key] = x));
  ok(
    so.range.choices.map(x => x[0]).join() === Object.keys(mk.STOCK_RANGES).join(),
    'the stock ranges of the options are the ones the service knows'
  );
  ok(co.range.choices.map(x => x[0]).join() === Object.keys(mk.CRYPTO_RANGES).join(), 'the crypto ranges too');
  ok(co.vs.choices.map(x => x[0]).join() === mk.VS.join(), 'and the currencies');
  ok(
    so.list.choices.slice(1).every(x => S.PRESETS.stocks[x[0]]) && co.list.choices.slice(1).every(x => S.PRESETS.crypto[x[0]]),
    'every list on the TV is a preset of the service'
  );

  // ---- the pages ----
  const B = require(path.join(root, 'tools', 'build-pages.js'));
  ok(
    B.COPIES.some(c => c[1] === 'addons/catalog/markets/cards/crypto') &&
      ['card.html', 'card.js', 'card.css', 'drawer.html', 'drawer.js', 'drawer.css'].every(
        f => fs.readFileSync(path.join(cardDir, f), 'utf8') === fs.readFileSync(path.join(addonDir, 'cards', 'crypto', f), 'utf8')
      ),
    'cards/crypto/ is the same as cards/stocks/ (node tools/build-pages.js)'
  );
  const acorn = require(path.join(root, 'tools', 'vendor', 'acorn.js'));
  for (const f of ['card.js', 'drawer.js']) {
    const src = fs.readFileSync(path.join(cardDir, f), 'utf8');
    try {
      acorn.parse(src, { ecmaVersion: 5 });
      ok(true, f + ' parses as ES5');
    } catch (err) {
      ok(false, f + ' parses as ES5: ' + err.message);
    }
    ok(
      !/XMLHttpRequest|fetch\(|WebSocket|new Image|window\.(top|parent)|\btop\./.test(src) &&
        (src.match(/\bparent\.[A-Za-z]+/g) || []).every(x => x === 'parent.postMessage'),
      f + ' makes no request and only posts messages to the launcher'
    );
  }
  for (const f of ['card.css', 'drawer.css', 'card.html', 'drawer.html'])
    ok(
      !/https?:\/\/|@import|url\(|\bgap\s*:/.test(fs.readFileSync(path.join(cardDir, f), 'utf8')),
      f + ' loads nothing and has no flex gap'
    );
  const dr = fs.readFileSync(path.join(cardDir, 'drawer.js'), 'utf8');
  ok(
    /MAX_TARGETS = 24/.test(dr) && !/tab0|cytvSheet: 'option'/.test(dr),
    'the drawer has no tabs and never sets an option of the card (the card keeps its own line)'
  );
  ok(
    /\['list', 'prev', 'next'\]\.forEach/.test(dr) && /id="list"/.test(dr) && /id="prev"/.test(dr) && /id="next"/.test(dr),
    'back to the list and the previous and next symbol are buttons too (a click, the pointer)'
  );
  ok(
    /var key = JSON\.stringify\(\[msg\.targets, msg\.back, msg\.edges\]\)/.test(dr) &&
      /focus = s\.focus;\s*reveal\(\);\s*post\(false\)/.test(dr),
    'a focus move does not send the same buttons again (that rebuilt the click layer and lost clicks)'
  );

  // the drawer run with a minimal stand-in for the page: the list, a symbol, a range from the service, the next symbol, back, paging
  {
    const posts = [],
      listeners = {},
      els = {};
    const rect = () => ({ left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 });
    const el = id =>
      els[id] ||
      (els[id] = {
        id,
        scrollTop: 0,
        clientHeight: 800,
        style: {},
        className: '',
        _h: '',
        set innerHTML(v) {
          this._h = v;
        },
        get innerHTML() {
          return this._h;
        },
        getBoundingClientRect: rect,
        getAttribute: () => '',
        querySelectorAll: () => [],
      });
    const sandbox = {
      parent: { postMessage: m => posts.push(m) },
      window: { innerWidth: 760, innerHeight: 1080, addEventListener: (n, f) => (listeners[n] = f) },
      document: {
        documentElement: {},
        body: { style: {}, className: '' },
        getElementById: id => (/^(app|mood|lst|close)$/.test(id) ? el(id) : null),
        querySelectorAll: () => [],
      },
    };
    require('vm').runInNewContext(dr, sandbox);
    const send = m => listeners.message({ data: m });
    const last = () => posts.filter(m => m.cytvSheet === 'targets').pop();
    ok(posts[0] && posts[0].cytvCard === 'ready', 'the drawer says ready');
    const feed = JSON.parse(JSON.stringify(cryptoD));
    feed.at = Date.now();
    const ctx = data => ({
      cytvCard: { opt: { range: '30d', vs: 'eur' }, data, lang: 'en', clock: { hour: 'numeric', minute: '2-digit' }, dir: 'ltr' },
    });
    send(ctx(feed));
    let tg = last();
    ok(
      tg &&
        tg.focus === 'c0' &&
        tg.back === '' &&
        !Object.keys(tg.edges).length &&
        (els.app.innerHTML.match(/class="row/g) || []).length === 2,
      'it opens on the list (a row per coin; Back closes the drawer)'
    );
    ok(!/class="pb"/.test(els.app.innerHTML) && /Bitcoin/.test(els.app.innerHTML), 'the list has no big price of a symbol nobody chose');
    send({ cytvSheet: { act: 'c1' } });
    tg = last();
    ok(
      /<h1>ETH<\/h1>/.test(els.app.innerHTML) && /class="ch"/.test(els.app.innerHTML) && /Market cap/.test(els.app.innerHTML),
      'OK on a row opens that coin: the chart and the numbers on one page'
    );
    ok(
      tg.back === 'list' && tg.edges.left === 'prev' && tg.edges.right === 'next' && tg.focus === 'r2',
      'in a coin, Back goes to the list, the arrows past the edge step coins, and the focus is on the range shown (30D)'
    );
    send({ cytvSheet: { act: 'r0' } });
    const askChart = posts.filter(m => m.cytvSheet === 'action').pop();
    ok(
      askChart && askChart.name === 'chart' && askChart.arg === 'ETH:1d' && /class="ch loading"/.test(els.app.innerHTML),
      'another range is asked from the service (action chart) and the old line shows dimmed meanwhile'
    );
    const withChart = JSON.parse(JSON.stringify(feed));
    withChart.chart = { s: 'ETH', range: '1d', sp: [1, 2, 3, 2.5], rc: 1.5 };
    send(ctx(withChart));
    ok(/class="ch"/.test(els.app.innerHTML) && /past day/.test(els.app.innerHTML), 'the answer is drawn when it arrives');
    send({ cytvSheet: { act: 'prev' } });
    ok(/<h1>BTC<\/h1>/.test(els.app.innerHTML) && /1 \/ 2/.test(els.app.innerHTML), 'the previous coin, with where you are');
    send({ cytvSheet: { act: 'list' } });
    tg = last();
    ok(tg.focus === 'c0' && tg.back === '' && /class="row/.test(els.app.innerHTML), 'Back returns to the list on the row of that coin');
    send({ cytvSheet: { key: 'chdown' } });
    ok(last().focus === 'c1', 'CH- pages down the list (as far as it goes)');
  }
  const card = fs.readFileSync(path.join(cardDir, 'card.js'), 'utf8'),
    cardCss = fs.readFileSync(path.join(cardDir, 'card.css'), 'utf8');
  ok(
    /fill = fill \|\| stripItems;[\s\S]*fill\(track, d\);[\s\S]*scrollWidth[\s\S]*fill\(track, d\)/.test(card) &&
      /@keyframes cytv-tick[\s\S]*translateX\(-50%\)/.test(cardCss) &&
      !/animation[^;]*(left|width|margin)/.test(cardCss),
    'the strip shows every symbol and, when they do not fit, scrolls as a ticker that animates transform only'
  );
  ok(
    /main\.className = 'strip msg1';\s*stripView\(main, d, function/.test(card),
    'a message in the strip (no key, the daily limit) scrolls sideways like the symbols when it is too long for one line'
  );
  ok(
    /fullButton\('open'/.test(card) && /fullButton\('settings'/.test(card),
    'the whole card is one button: the drawer, or the settings when no symbol is chosen'
  );
});
