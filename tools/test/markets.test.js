// The markets add-on (addons/catalog/markets): the Stocks and Crypto cards' data from stand-ins for Yahoo Finance and CoinGecko (prices,
// lines, details, prices in agorot, unknown symbols), the answers kept and spaced, a failing service, the presets, the words, the
// manifest, and the pages: ES5, no requests, the sheet protocol of the drawer, and cards/crypto/ the same as cards/stocks/.
const fs = require('fs'),
  path = require('path');
const { root, ok, serve, req, run, tmp } = require('./lib');

run(async () => {
  const nc = req('netcompat');
  const now = Math.floor(Date.now() / 1000);
  // ---- stand-ins: Yahoo (spark, chart) and CoinGecko (markets, market_chart) ----
  const asked = { spark: 0, chart: 0, markets: 0, mchart: 0 };
  let fail = false,
    lastSpark = '',
    lastMarkets = '';
  const META = {
    AAPL: { currency: 'USD', fullExchangeName: 'NasdaqGS', instrumentType: 'EQUITY', shortName: 'Apple Inc.', open: true },
    '^GSPC': { currency: 'USD', fullExchangeName: 'SNP', instrumentType: 'INDEX', shortName: 'S&P 500', open: true },
    'TEVA.TA': { currency: 'ILA', fullExchangeName: 'Tel Aviv', instrumentType: 'EQUITY', shortName: 'TEVA PHARMA IND', open: false },
  };
  const PRICE = { AAPL: [344.17, 342.37], '^GSPC': [7360, 7376.86], 'TEVA.TA': [13180, 13300] };
  const COINS = [
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', rank: 1, p: 75974, cp: 0.14 },
    { id: 'ethereum', symbol: 'eth', name: 'Ethereum', rank: 2, p: 2239.04, cp: -0.23 },
    { id: 'eth-clone', symbol: 'eth', name: 'Ether Clone', rank: 900, p: 0.01, cp: 3 },
  ];
  const json = (res, j) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(j));
  };
  const srv = await serve((q, res) => {
    if (fail) {
      res.writeHead(500);
      return res.end('{}');
    }
    const u = q.url;
    let m = /^\/y\/v8\/finance\/chart\/([^?]+)\?/.exec(u);
    if (m) {
      asked.chart++;
      const s = decodeURIComponent(m[1]),
        x = META[s];
      if (!x) return json(res, { chart: { result: null, error: { code: 'Not Found' } } });
      const st = now - 3600,
        en = x.open ? now + 3600 : now - 1800;
      return json(res, {
        chart: {
          result: [
            {
              meta: {
                currency: x.currency,
                symbol: s,
                fullExchangeName: x.fullExchangeName,
                instrumentType: x.instrumentType,
                shortName: x.shortName,
                regularMarketDayHigh: PRICE[s][1] + 2,
                regularMarketDayLow: PRICE[s][1] - 3,
                regularMarketVolume: 43750861,
                fiftyTwoWeekHigh: PRICE[s][1] * 1.2,
                fiftyTwoWeekLow: PRICE[s][1] * 0.7,
                currentTradingPeriod: { regular: { start: st, end: en } },
              },
              indicators: { quote: [{ open: [PRICE[s][0] + 1] }] },
            },
          ],
        },
      });
    }
    if (/^\/y\/v8\/finance\/spark\?/.test(u)) {
      asked.spark++;
      lastSpark = u;
      const out = {};
      decodeURIComponent(/symbols=([^&]+)/.exec(u)[1])
        .split(',')
        .forEach(s => {
          if (!PRICE[s]) return;
          const n = /range=1d/.test(u) ? 78 : 200,
            close = [];
          for (let i = 0; i < n; i++) close.push(PRICE[s][0] + ((PRICE[s][1] - PRICE[s][0]) * i) / (n - 1));
          close.splice(5, 0, null); // a gap in the line
          out[s] = { symbol: s, previousClose: PRICE[s][0], chartPreviousClose: PRICE[s][0], close };
        });
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
    m = /^\/g\/coins\/([^/]+)\/market_chart\?/.exec(u);
    if (m) {
      asked.mchart++;
      const days = +/days=(\d+)/.exec(u)[1];
      return json(res, { prices: Array.apply(null, Array(days * 24)).map((_, i) => [i, 1000 + i]) });
    }
    res.writeHead(404);
    res.end('{}');
  });
  process.env.CYTV_YAHOO_URL = srv.url + '/y';
  process.env.CYTV_GECKO_URL = srv.url + '/g';

  const addonDir = path.join(root, 'addons', 'catalog', 'markets');
  const mk = require(path.join(addonDir, 'markets.js'));
  const S = require(path.join(addonDir, 'service.js'));
  let lang = '';
  const ctx = {
    id: 'markets',
    dir: addonDir,
    dataDir: path.join(tmp, 'addon-data', 'markets'),
    log: () => {},
    fetch: req('fetch'),
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => lang, wallpaperSize: () => '4k' },
    settings: { get: () => ({}), set: () => {} },
  };
  const svc = S.create(ctx);

  // ---- the lists as typed ----
  ok(
    mk.stockList(' aapl, ^gspc teva.ta;AAPL bad!sym').join() === 'AAPL,^GSPC,TEVA.TA',
    'a stock list is upper-cased, split on commas and spaces, without repeats or bad symbols'
  );
  ok(mk.coinList('BTC, eth eth').join() === 'btc,eth', 'a coin list is lower-cased and without repeats');
  ok(mk.stockList('A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V').length === 20, 'at most 20 symbols (what Yahoo answers in one request)');
  ok(mk.thin([1, null, 2, 3, 4, 5], 3).join() === '1,3,5', 'a line is thinned evenly, the gaps left out, the last point kept');

  // ---- no symbols ----
  let d = await svc.cards.feed('stocks', { list: 'custom', symbols: ' , ' });
  ok(d.empty === true && d.labels['Choose your stocks'] && asked.spark === 0, 'with no symbols the card is told so, and asks nobody');

  // ---- stocks ----
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL,TEVA.TA,^GSPC,NOPE', range: '1d', show: 'pct' });
  const a = d.q && d.q[0],
    t = d.q && d.q[1],
    g = d.q && d.q[2];
  ok(
    d.kind === 'stocks' && d.q.length === 3 && d.missing.join() === 'NOPE',
    'three symbols have prices, the unknown one is listed as missing: ' + JSON.stringify(d.missing)
  );
  ok(
    a.s === 'AAPL' && a.n === 'Apple' && a.x === 'NasdaqGS' && a.cur === 'USD' && a.t === 'stock' && a.p === 342.37 && a.prev === 344.17,
    'a stock: name, exchange, currency, price and previous close: ' + JSON.stringify(a).slice(0, 200)
  );
  ok(a.cp === -0.52 && Math.abs(a.c + 1.8) < 1e-6, "today's change in percent and in price");
  ok(
    a.o === 345.17 && a.hi === 344.37 && a.lo === 339.37 && a.v === 43750861 && a.open === true,
    'open, day range, volume and the market open'
  );
  ok(a.sp.length === 78 && a.sp.every(v => typeof v === 'number'), 'the line of the day, the gaps left out');
  ok(t.cur === 'ILS' && t.p === 133 && t.prev === 131.8 && t.open === false, 'Tel Aviv prices in agorot are shown in shekels');
  ok(g.t === 'index', 'an index is told apart (no currency sign on the card)');
  ok(d.open === true, 'a market of the list is open');
  ok(/symbols=AAPL%2CTEVA\.TA%2C%5EGSPC%2CNOPE&range=1d&interval=5m/.test(lastSpark), 'one spark request for the whole list: ' + lastSpark);
  const sp0 = asked.spark,
    ch0 = asked.chart;
  await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL,TEVA.TA,^GSPC,NOPE', range: '1d' });
  ok(asked.spark === sp0 && asked.chart === ch0, 'a second answer within 5 minutes asks nobody (and an unknown symbol is not asked again)');
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL', range: '1mo', show: 'abs' });
  ok(
    /range=1mo&interval=1d/.test(lastSpark) && d.q[0].sp.length === 120 && d.range === '1mo' && d.show === 'abs',
    'a longer range asks for its own line, thinned to 120 points'
  );
  ok(typeof d.q[0].rc === 'number' && d.q[0].rc < 0, 'the change over the range, for the chart');

  // ---- presets ----
  d = await svc.cards.feed('stocks', { list: 'idx', symbols: 'XXX' });
  ok(d.q.map(q => q.s).join() === '^GSPC,AAPL' && d.missing.join() === 'MSFT', 'a preset list is used instead of the typed one');
  ok(
    S.PRESETS.stocks.tech === 'AAPL,MSFT,NVDA,GOOGL,TSLA' && S.PRESETS.crypto.top === 'BTC,ETH,SOL,XRP,DOGE',
    'the presets are the ones of the design'
  );

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
  ok((await svc.cards.action('stocks', { list: 'custom', symbols: 'AAPL' }, 'chart', 'aapl:1y')).error === undefined, 'a stock too');
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL', range: '1d' });
  ok(d.chart && d.chart.s === 'AAPL' && d.chart.range === '1y', 'over a year');
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
  fail = true;
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'MSFT2' });
  ok(d.error && !d.q, 'a list that cannot be asked says so');
  d = await svc.cards.feed('stocks', { list: 'custom', symbols: 'AAPL,TEVA.TA,^GSPC,NOPE', range: '1d' });
  ok(d.q && d.q[0].p === 342.37, 'a list that was asked before keeps its last answer');
  fail = false;
  srv.server.close();

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
    /stripItems\(track, d\);[\s\S]*scrollWidth[\s\S]*stripItems\(track, d\)/.test(card) &&
      /@keyframes cytv-tick[\s\S]*translateX\(-50%\)/.test(cardCss) &&
      !/animation[^;]*(left|width|margin)/.test(cardCss),
    'the strip shows every symbol and, when they do not fit, scrolls as a ticker that animates transform only'
  );
  ok(
    /fullButton\('open'/.test(card) && /fullButton\('settings'/.test(card),
    'the whole card is one button: the drawer, or the settings when no symbol is chosen'
  );
});
