// Device names for the pairing screen (the phoneremote add-on's devicename.js and the guess in its page.js): the router's name is used only when
// it is a name, a number is added when another phone has the same name, and the page falls back from the app to the router to the browser.
const path = require('path');
const { ok, root, run } = require('./lib');
const dn = require(path.join(root, 'addons', 'catalog', 'phoneremote', 'devicename'));
const { phonePage } = require(path.join(root, 'addons', 'catalog', 'phoneremote', 'page'));
const i18n = require(path.join(root, 'helper', 'i18n'));

run(async () => {
  // ---- what counts as a name ----
  const c = dn.clean;
  ok(
    c('LAPTOP-7K2M9QD') === 'LAPTOP-7K2M9QD' && c('Danas-iPhone') === 'Danas-iPhone',
    'a computer name and a phone name are kept as they are'
  );
  ok(
    c('Danas-MacBook-Pro.lan') === 'Danas-MacBook-Pro' && c('office.home.arpa.') === 'office',
    'the domain after the name is cut off, and so is a trailing dot'
  );
  ok(
    ['', null, undefined, 'wlan0', 'WLAN1', 'localhost', 'a'].every(x => c(x) === ''),
    'nothing, wlan0, localhost and a one-letter name are not names'
  );
  ok(
    c('02:D5:D6:2B:08:32') === '' && c('02-d5-d6-2b-08-32') === '' && c('10.100.102.28') === '',
    'a MAC address and an IP address are not names'
  );
  ok(
    c('android-9f3e21ab') === '' && c('android_9f3e21ab5c') === '' && c('android-phone') === 'android-phone',
    'android followed by random characters is not a name, a real word is'
  );
  ok(c('28.102.100.10.in-addr.arpa') === '' && c('1.0.0.127.in-addr.arpa.') === '', 'the lookup zone is not a name');
  ok(
    c('x<b>"&y') === 'xby' && c('a'.repeat(80)).length === dn.LEN,
    'markup characters are removed and the length is cut like a typed name'
  );

  // ---- a number when the name is taken ----
  ok(dn.unique('Pixel', []) === 'Pixel' && dn.unique('Pixel', ['Galaxy']) === 'Pixel', 'a free name stays as it is');
  ok(dn.unique('Pixel', ['pixel']) === 'Pixel 2', 'a taken name (any case) gets 2');
  ok(dn.unique('Pixel', ['Pixel', 'Pixel 2', 'Pixel 3']) === 'Pixel 4', 'and the next free number after that');
  const long = 'N'.repeat(30);
  const u = dn.unique(long, [long]);
  ok(u.length <= dn.LEN && u.slice(-2) === ' 2', 'a long name is shortened to make room for the number');

  // ---- the lookup ----
  ok(
    dn.privateV4('10.0.0.5') && dn.privateV4('::ffff:192.168.1.7') && dn.privateV4('172.16.0.1') && dn.privateV4('172.31.9.9'),
    'private IPv4 addresses are looked up'
  );
  ok(
    !dn.privateV4('8.8.8.8') && !dn.privateV4('172.32.0.1') && !dn.privateV4('fe80::1') && !dn.privateV4('') && !dn.privateV4('10.0.0.300'),
    'a public, IPv6 or odd address is not'
  );
  const ask = (addr, rev) => new Promise(r => dn.routerName(addr, r, rev));
  let calls = 0;
  const good = (a, cb) => {
    calls++;
    cb(null, ['Danas-iPhone.lan']);
  };
  dn.forget();
  ok((await ask('192.168.1.7', good)) === 'Danas-iPhone', 'the router name comes back cleaned');
  ok((await ask('192.168.1.7', good)) === 'Danas-iPhone' && calls === 1, 'and is remembered, so the next page does not ask again');
  calls = 0;
  ok((await ask('8.8.8.8', good)) === '' && calls === 0, 'a public address is never sent to a resolver');
  ok((await ask('192.168.1.8', (a, cb) => cb(new Error('ENOTFOUND')))) === '', 'a failed lookup gives no name');
  ok((await ask('192.168.1.9', (a, cb) => cb(null, ['wlan0']))) === '', 'a name that is not one gives no name');
  ok(
    (await ask('192.168.1.10', () => {
      throw new Error('x');
    })) === '',
    'a resolver that throws gives no name'
  );
  const t0 = Date.now();
  ok(
    (await ask('192.168.1.11', () => {})) === '' && Date.now() - t0 < 2000,
    'a resolver that never answers does not hold the page back for long'
  );

  // ---- the guess in the page: the app, then the router, then the browser, then Device ----
  const h = phonePage(i18n, 'en', '', 'Router-Name');
  const a = h.indexOf('function has(u,s)');
  const e = h.indexOf('return n||', a);
  const js = h.slice(a, h.indexOf(String.fromCharCode(10), e));
  const guess = (ua, touch, app, hint) =>
    new Function('navigator', 'window', 'HINT', js + '; return guess();')(
      { userAgent: ua, maxTouchPoints: touch },
      { CYTV_APP: app },
      hint
    );
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const CHROME = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0';
  const UA = {
    win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' + CHROME + ' Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' + CHROME + ' Safari/537.36 Edg/130.0.0.0',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' + CHROME + ' Safari/537.36 OPR/115.0.0.0',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) ' + CHROME + ' Safari/537.36',
    iphone:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    phone: 'Mozilla/5.0 (Linux; Android 10; K) ' + CHROME + ' Mobile Safari/537.36',
    tablet: 'Mozilla/5.0 (Linux; Android 10; K) ' + CHROME + ' Safari/537.36',
    chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) ' + CHROME + ' Safari/537.36',
  };
  const by = ua => guess(ua, 0, undefined, '');
  ok(
    by(UA.win) === 'Chrome on Windows' && by(UA.edge) === 'Edge on Windows' && by(UA.opera) === 'Opera on Windows',
    'a Windows computer: the browser and the system'
  );
  ok(
    by(MAC) === 'Safari on Mac' && by(UA.firefox) === 'Firefox on Linux' && by(UA.chromeLinux) === 'Chrome on Linux',
    'a Mac and a Linux computer'
  );
  ok(by(UA.chromebook) === 'Chromebook', 'a Chromebook');
  ok(
    by(UA.iphone) === 'iPhone' && guess(MAC, 5, undefined, '') === 'iPad',
    'an iPhone, and an iPad asking for the desktop site (a Mac with a touch screen)'
  );
  ok(by(UA.phone) === 'Android phone' && by(UA.tablet) === 'Android tablet', 'an Android phone, and a tablet (no Mobile in its browser)');
  ok(by('curl/8.0') === 'Device' && by('') === 'Device', 'anything else is Device');
  ok(guess(UA.win, 0, undefined, 'LAPTOP-7K2M9QD') === 'LAPTOP-7K2M9QD', 'the router name comes before what the browser says');
  ok(
    guess(UA.phone, 5, { deviceName: () => '  Dana Galaxy ' }, 'Router-Name') === 'Dana Galaxy',
    'the Android app comes before the router name'
  );
  ok(guess(UA.phone, 5, { deviceName: () => '' }, 'Router-Name') === 'Router-Name', 'an app with no name leaves it to the router');
  ok(
    guess(
      UA.phone,
      5,
      {
        deviceName: () => {
          throw new Error('x');
        },
      },
      ''
    ) === 'Android phone',
    'an app that fails leaves it to the browser'
  );
  ok(guess(UA.phone, 5, { deviceName: () => 'x<b>y"&z' }, '') === 'xbyz', 'markup in a name is removed');
  ok(guess(UA.phone, 5, { deviceName: () => 'N'.repeat(60) }, '').length === 30, 'and the length is the same as the field');

  // ---- the router name reaches the page only as a quoted, escaped string ----
  ok(
    /var HINT="Router-Name";/.test(h) && /var HINT="";/.test(phonePage(i18n, 'en', '', '')) && /var HINT="";/.test(phonePage(i18n, 'en')),
    'the page carries the hint, or an empty one'
  );
  ok(!/var HINT=[^;]*</.test(phonePage(i18n, 'en', '', 'a<b')), 'a < in the hint is escaped');
});



