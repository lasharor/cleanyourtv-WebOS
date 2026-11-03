// The phone remote as an Android app (mobile/): the start page and the bridge it uses, kept in step with the Java that serves it.
// Nothing here builds or runs the app — the build is mobile/android/build.ps1, which needs the Android SDK. These checks catch the mistakes
// a rename makes: a page that calls a method the bridge does not have, a bridge method that is not exposed to JavaScript, a packet that is
// not the one the TV answers.
const fs = require('fs'),
  path = require('path');
const os = require('os'),
  cp = require('child_process'),
  vm = require('vm');
const { ok, root, run } = require('./lib');

const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const page = read('mobile/web/start.html');
const javaDir = 'mobile/android/java/com/cleanyourtv/phone/';
const java = ['MainActivity.java', 'Store.java', 'Wake.java', 'Discover.java', 'Reach.java', 'Addr.java', 'Backoff.java']
  .map(f => read(javaDir + f))
  .join('\n');
const bridge = read(javaDir + 'MainActivity.java');

run(async () => {
  // ---- the start page ----
  ok(page.length > 1000 && /Turn on the TV/.test(page), 'the start page offers to turn the TV on');
  ok(!/<(link|img|iframe)|@import|src=["']https?:/i.test(page), 'the start page needs nothing from another machine');
  ok(!/=>/.test(page) && !/`/.test(page) && !/\b(let|const)\s/.test(page), 'the start page is ES5, like every other page of this project');

  // ---- the bridge: every method the page calls exists, and every method of the bridge is exposed to JavaScript ----
  const bridgeClass = bridge.slice(bridge.indexOf('private class Bridge'));
  const exposed = [];
  bridgeClass.replace(/@JavascriptInterface\s+public\s+[\w<>\[\]]+\s+(\w+)\s*\(/g, (_, name) => exposed.push(name));
  const called = [];
  page.replace(/\bA\[['"](\w+)['"]\]/g, (_, n) => called.push(n));
  page.replace(/\bA\.(\w+)\s*\(/g, (_, n) => called.push(n));
  const missing = called.filter(n => exposed.indexOf(n) < 0);
  ok(
    exposed.length >= 6 && missing.length === 0,
    'the page calls only methods the bridge has (' + exposed.join(', ') + (missing.length ? '; MISSING ' + missing.join(',') : '') + ')'
  );
  ok(
    /@JavascriptInterface\s+public\s+boolean\s+wake\s*\(/.test(bridgeClass) &&
      /@JavascriptInterface\s+public\s+void\s+setMac\s*\(/.test(bridgeClass),
    'the app exposes waking and taking the TV address'
  );
  // every method of the bridge that JavaScript can see must carry the annotation; the threads inside it (run) are not part of that
  const bad = [];
  const re = /public\s+(?:void|boolean|String)\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(bridgeClass))) {
    if (m[1] === 'run') continue;
    if (bridgeClass.slice(Math.max(0, m.index - 60), m.index).indexOf('@JavascriptInterface') < 0) bad.push(m[1]);
  }
  ok(
    bad.length === 0 && exposed.length >= 6,
    'every public method of the bridge carries @JavascriptInterface' + (bad.length ? ': missing on ' + bad.join(',') : '')
  );

  // ---- the packet: the one the TV answers ----
  ok(
    /6 \+ 16 \* 6/.test(java) && /0xFF/.test(java) && /9, 7/.test(java),
    'the packet is six 0xFF bytes and the address sixteen times, on ports 9 and 7'
  );
  ok(/255\.255\.255\.255/.test(java) && /getBroadcast\(\)/.test(java), 'it goes to the limited broadcast and to the subnet broadcast');
  ok(/239\.255\.255\.250/.test(java) && /webos-second-screen/.test(java), 'the search is an SSDP M-SEARCH for the TV');
  ok(
    /replaceAll\("\[\^0-9a-fA-F\]"/.test(read(javaDir + 'Store.java')) && /parseInt\(hex\.substring/.test(read(javaDir + 'Wake.java')),
    'the address the page hands over is stored in one form and turned into the packet bytes from it'
  );

  // ---- the manifest: what the install asks for ----
  const man = read('mobile/android/AndroidManifest.xml');
  ok(/android.permission.INTERNET/.test(man), 'the app asks for the network');
  ok(
    /android.permission.VIBRATE/.test(man) &&
      /@JavascriptInterface\s+public\s+void\s+buzz\(\)/.test(bridge) &&
      /VIBRATOR_SERVICE/.test(bridge),
    'and for the vibrator, so a key press answers with a short tick (a WebView has no navigator.vibrate)'
  );
  ok(
    !/ACCESS_WIFI_STATE|CHANGE_WIFI|CAMERA|LOCATION/.test(man),
    'it asks for no other permission (no camera, no location, no Wi-Fi state)'
  );
  ok(/usesCleartextTraffic="true"/.test(man), 'plain HTTP to the TV is allowed on purpose');
  ok(/android:exported="true"/.test(man) && /MAIN/.test(man), 'it has a launcher entry');
  ok(/android:label="TV Remote"/.test(man), 'it is called TV Remote, not CleanYourTV');
  ok(/android:icon="@drawable\/icon"/.test(man), 'it has an icon of its own (not the grey default square)');

  // ---- the icon is the project's own icon, as vector paths ----
  const svg = read('assets/icon.svg'),
    vec = read('mobile/android/res/drawable/icon.xml');
  const colours = (svg.match(/#[0-9a-fA-F]{6}/g) || []).map(c => c.toUpperCase());
  ok(
    colours.length >= 5 && colours.every(c => vec.toUpperCase().indexOf(c) >= 0),
    'the app icon uses the same colours as assets/icon.svg (' + colours.join(' ') + ')'
  );
  ok(/<vector/.test(vec) && /viewportWidth="130"/.test(vec), 'it is a vector, so no bitmap has to be shipped per screen size');

  // ---- scanning instead of typing: the TV shows cytv://add?host=..., the app takes the address from it ----
  ok(
    /android:scheme="cytv"/.test(man) && /android:host="add"/.test(man) && /action.VIEW/.test(man),
    'the app answers a cytv:// link, so the phone camera can open it straight'
  );
  ok(/getQueryParameter\("host"\)/.test(read(javaDir + 'MainActivity.java')), 'it reads the address out of that link');
  ok(
    /getQueryParameter\("code"\)/.test(read(javaDir + 'MainActivity.java')) &&
      /onPageFinished/.test(read(javaDir + 'MainActivity.java')) &&
      /cytvPair/.test(read(javaDir + 'MainActivity.java')),
    'a pairing code in that link is kept and given to the TV page as soon as it is there, which fills it in for the person to name the phone and tap Pair'
  );
  ok(
    /'cytv:\/\/add\?host=' \+ appHost\(/.test(read('manager/src/js/remote.js')) && /&code=/.test(read('manager/src/js/remote.js')),
    'the TV builds that link for its QR code: the address, and the one-time pairing code'
  );

  // ---- the camera app does the scanning: the TV's code is a cytv:// link that opens the app with the address and the code ----
  const startPage = read('mobile/web/start.html');
  ok(
    /id=addr/.test(startPage) &&
      /id=go/.test(startPage) &&
      /id=mode/.test(startPage) &&
      /id=again/.test(startPage) &&
      !/id=wake/.test(startPage),
    "the app asks for the address only (finding it is the main button, typing it is one tap away): the code is typed on the TV's own pairing page, and turning the TV on is the off screen's job"
  );
  ok(
    !/id=code/.test(startPage) && !/cytvPair/.test(startPage),
    'the app has no pairing form of its own: that screen is the TV page, the same in the app and in a browser'
  );
  ok(!/id=scan|jsQR\(/.test(startPage), 'and no scanner of its own: the phone camera opens the code');
  ok(
    /cytvPair/.test(startPage) === false && /cytvPair/.test(read('helper/addons-bundled/phoneremote/page.js')),
    'the pairing code from the code is used by the TV page, not by the start screen'
  );
  ok(
    /link\(getIntent\(\)\);[^\n]*\n\s*if \(store\.addr\(\)\.length\(\) > 0\) open\(\);/.test(bridge),
    "a link opens the app on the TV's page (the white screen came from not loading anything after a link)"
  );

  // ---- the splash and the buttons are the icon's dark tile, and the app can tell whether the TV answers ----
  ok(
    /@style\/App/.test(read('mobile/android/AndroidManifest.xml')) &&
      /name="bg">#101218</.test(read('mobile/android/res/values/colors.xml')) &&
      /windowSplashScreenBackground/.test(read('mobile/android/res/values-v31/styles.xml')),
    "the splash and the window use the icon's background colour, also on Android 12 and newer"
  );
  ok(/setBackgroundColor\(0xFF101218\)/.test(bridge), 'and the page does not flash white while it loads');
  ok(
    /@JavascriptInterface\s+public\s+boolean\s+up\(\)/.test(bridge) && /Reach\.up\(store\.addr\(\), 600\)/.test(bridge),
    'the app can ask whether the TV answers, so On means the TV is really there'
  );

  // ---- the TV off: the app shows the remote-like screen, never the pairing flow ----
  const off = read('mobile/web/off.html');
  ok(
    /id=on/.test(off) && /Turn on the TV/.test(off) && /setInterval/.test(off) && /window\.cytvOff/.test(off),
    'the TV-off screen offers to turn the TV on (Wake-on-LAN) and opens the remote as soon as it answers'
  );
  ok(
    /OFF = "file:\/\/\/android_asset\/off\.html"/.test(bridge) &&
      /private void off\(\)/.test(bridge) &&
      /url\.startsWith\(START\) \|\| url\.startsWith\(OFF\)/.test(bridge),
    'the off screen is the last resort, and the pairing screen is kept for a phone with no address'
  );
  ok(
    /private void lost\(\)/.test(bridge) &&
      /shouldInterceptRequest/.test(bridge) &&
      /savedPage/.test(bridge) &&
      /Reach\.up\(addr, 400\)/.test(bridge) &&
      /isForMainFrame\(\)\) \{\s+loadFailed = true;\s+lost\(\);/.test(bridge) &&
      /savePage\(\)/.test(bridge),
    'with the TV off the app shows the last page it served (the remote, with its On/Off button) from the phone itself'
  );
  ok(
    /tv-page\.html/.test(bridge) && /getFilesDir\(\)/.test(bridge),
    'that page survives the app being closed, so the remote is there after hours in standby'
  );
  ok(
    /public String name\(\)/.test(bridge) &&
      /public void setName\(String n\)/.test(bridge) &&
      /String name\(\)/.test(read('mobile/android/java/com/cleanyourtv/phone/Store.java')),
    'the name the TV reported is kept, so that screen can say which TV it is'
  );

  // ---- a cytv:// link is browsable, so any web page can send one: only private IPv4 addresses are ever stored, and a new TV needs a yes ----
  const good = [
    '192.168.1.50',
    '192.168.1.50:8798',
    'http://192.168.1.50:8798/',
    '10.0.0.5:9000',
    '172.16.3.4',
    '172.31.255.254',
    '169.254.1.1',
  ];
  const goodOut = [
    '192.168.1.50:8798',
    '192.168.1.50:8798',
    '192.168.1.50:8798',
    '10.0.0.5:9000',
    '172.16.3.4:8798',
    '172.31.255.254:8798',
    '169.254.1.1:8798',
  ];
  const badAddr = [
    'example.com',
    '8.8.8.8',
    '192.168.1.256',
    'evil.com:8798',
    '192.168.1.50@evil.com',
    '',
    '   ',
    '::1',
    '[fe80::1]:8798',
    'fe80::1',
    '172.32.0.1',
    '172.15.0.1',
    '192.169.1.1',
    '11.0.0.1',
    '192.168.1',
    '192.168.1.50.5',
    '192.168.1.50:0',
    '192.168.1.50:65536',
    '192.168.1.50:80a',
    '192.168.1.50/path',
    'user:pw@192.168.1.50',
    'https://192.168.1.50',
    '192.168.01.50',
    '192.168.1.50:',
    '127.0.0.1',
  ];
  // the page's own copy of the rule (the same answers, before anything is stored or opened)
  const pageClean = (() => {
    const src = page.slice(page.indexOf('function clean('), page.indexOf('/* every message is a toast'));
    const sb = {};
    vm.runInNewContext(src, sb);
    return sb.clean;
  })();
  good.forEach((g, i) => ok(pageClean(g) === goodOut[i], 'start page clean: ' + g + ' -> ' + goodOut[i]));
  badAddr.forEach(b => ok(pageClean(b) === '', 'start page clean refuses: ' + JSON.stringify(b)));

  let hasJavac = false;
  try {
    cp.execFileSync('javac', ['-version'], { stdio: 'ignore' });
    hasJavac = true;
  } catch (e) {
    hasJavac = false;
  }
  if (hasJavac) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-addr-'));
    const t = path.join(dir, 'T.java');
    // every case on its own line, so one JVM start answers them all
    fs.writeFileSync(
      t,
      'package com.cleanyourtv.phone;\n' +
        'public class T { public static void main(String[] a) throws Exception {\n' +
        '  java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, "UTF-8"));\n' +
        '  String l;\n' +
        '  while ((l = r.readLine()) != null) System.out.println("[" + Addr.clean(l) + "]");\n' +
        '  StringBuilder b = new StringBuilder();\n' +
        '  for (int i = 0; i < 9; i++) b.append(Backoff.delay(i)).append(" ");\n' +
        '  System.out.println("B " + b.toString().trim());\n}}\n'
    );
    const cdir = path.join(dir, 'c');
    fs.mkdirSync(cdir);
    cp.execFileSync('javac', ['-d', cdir, path.join(root, javaDir, 'Addr.java'), path.join(root, javaDir, 'Backoff.java'), t]);
    const all = good.concat(badAddr);
    const out = cp
      .execFileSync('java', ['-cp', cdir, 'com.cleanyourtv.phone.T'], { input: all.join('\n') + '\n' })
      .toString()
      .split(/\r?\n/);
    good.forEach((g, i) => ok(out[i] === '[' + goodOut[i] + ']', 'Addr.clean (compiled): ' + g + ' -> ' + goodOut[i]));
    badAddr.forEach((b, i) => ok(out[good.length + i] === '[]', 'Addr.clean (compiled) refuses: ' + JSON.stringify(b)));
    ok(
      out[all.length] === 'B 0 1000 2000 4000 8000 10000 10000 10000 10000',
      'the retry delay: at once, 1 s, 2 s, 4 s, 8 s, then never more than 10 s'
    );
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // a temp folder left behind is harmless
    }
  } else console.log('  (javac not found: Addr and Backoff were checked as text only)');

  const storeSrc = read(javaDir + 'Store.java');
  ok(
    !/import android/.test(read(javaDir + 'Addr.java')) && !/import android/.test(read(javaDir + 'Backoff.java')),
    'the address rules and the backoff use no Android class (they can be tested with javac alone)'
  );
  ok(
    /static String clean\(String v\) \{\s+return Addr\.clean\(v\);/.test(storeSrc),
    'Store.clean is the one rule, and it is the private-address one'
  );
  ok(/if \(v\.length\(\) > 0\) p\.edit\(\)\.putString\("addr"/.test(storeSrc), 'an address that is refused is never stored');
  ok(/Addr\.clean\(v\)/.test(read(javaDir + 'Discover.java')), 'an address found by the search goes through the same rule');
  const link = bridge.slice(bridge.indexOf('private boolean link('), bridge.indexOf('private void start()'));
  ok(
    /new AlertDialog\.Builder\(this\)/.test(link) &&
      /"Connect to " \+ v \+ "\?"/.test(link) &&
      /setPositiveButton\("Connect"/.test(link) &&
      /setNegativeButton\("Cancel"/.test(link) &&
      /saved\.length\(\) == 0 \|\| saved\.equals\(v\)/.test(link),
    'a link to another TV than the saved one asks first (Connect / Cancel); the same TV, or none saved yet, goes straight in'
  );
  ok(
    /pending = ""; \/\/ nothing is paired until/.test(link) &&
      link.indexOf('store.setAddr(v)', link.indexOf('setPositiveButton')) > 0 &&
      link.lastIndexOf('store.setAddr(v)') > link.indexOf('setPositiveButton') &&
      /setNegativeButton\("Cancel"[\s\S]*pending = "";/.test(link),
    'before the user agrees nothing is saved and no pairing code is kept; Cancel clears the code and leaves the saved address alone'
  );
  ok(/Toast\.makeText/.test(link) && /local network/.test(link), 'a link with a bad address says so');
  ok(
    /local network/.test(page) && /like 192\.168\.1\.50/.test(page),
    'the start page says a bad address must be the TV on the local network'
  );

  // ---- a failing load is retried with a pause, never in a tight loop ----
  ok(
    /Backoff\.delay\(failures\)/.test(bridge) &&
      /handler\.postDelayed\(retry, wait\)/.test(bridge) &&
      /if \(retryPending\) return;/.test(bridge) &&
      /new Handler\(Looper\.getMainLooper\(\)\)/.test(bridge),
    'lost() waits (Backoff) on the main thread, and only one reload waits at a time'
  );
  ok(
    /protected void onDestroy\(\)[\s\S]*removeCallbacks\(retry\)/.test(bridge) &&
      /private void cancelRetry\(\)/.test(bridge) &&
      /private void open\(\) \{\s+cancelRetry\(\);/.test(bridge),
    'a pending retry is cancelled when a new load starts and when the screen goes'
  );
  ok(
    /failures = 0;/.test(bridge) && /servedSaved/.test(bridge) && /loadFailed/.test(bridge),
    'the count starts again only when the TV itself served the page (not the saved copy, not an error page)'
  );
  ok(/private void off\(\) \{\s+cancelRetry\(\);/.test(bridge) && /web\.loadUrl\(OFF\)/.test(bridge), 'the off screen fallback is kept');

  // ---- every message on the setup pages is a toast over the page that goes away by itself, never text written into the page ----
  {
    const offPage = read('mobile/web/off.html');
    ok(
      !/id=msg|id=st|id=pmsg/.test(page + offPage) && !/\$\('(msg|st)'\)/.test(page + offPage),
      'neither the start page nor the "TV is off" page has a line of text for errors: no #msg, no #st'
    );
    ok(
      /id=toast class=toast role=status/.test(page) &&
        /id=toast class=toast role=status/.test(offPage) &&
        /toastT=setTimeout/.test(page) &&
        /toastT=setTimeout/.test(offPage) &&
        /void e\.offsetWidth/.test(page),
      'both have the toast, which slides in and goes away by itself'
    );
    ok(
      page.indexOf('id=toast') > 0 && page.indexOf('id=toast') < page.indexOf('<div id=wrap>'),
      'the toast sits outside the wrapper, whose rule (#wrap>* is relative) would otherwise pull it into the page instead of the top of the screen'
    );
    ok(
      !/class=logo|\.logo\{/.test(offPage) &&
        /#wrap\{[^}]*max-width:430px/.test(offPage) &&
        /#wrap \.glow\{/.test(offPage) &&
        /background:#101116/.test(offPage),
      'the TV-off screen looks like the setup screens: the same 430 px column, background and top-left glow, and no icon'
    );
    {
      // the TV's own pairing screen is the third setup screen: its fields and buttons are cut like the start page's
      const pg =
        require('../../helper/addons-bundled/phoneremote/page').PHONE_JS +
        require('fs').readFileSync(path.join(root, 'helper', 'addons-bundled', 'phoneremote', 'page.js'), 'utf8');
      ok(
        /#pairbox #pname\{[^}]*height:56px;[^}]*border-radius:16px;background:#14161c;border:1\.5px solid #646b82;font-weight:400/.test(
          pg
        ) &&
          /#pairbox \.pri\{[^}]*height:58px;border-radius:18px/.test(pg) &&
          /input\{width:100%;height:56px;padding:0 16px;font-size:17px;margin:0 0 8px;background:#14161c;border:1\.5px solid #646b82/.test(
            page
          ) &&
          /\.pri\{height:58px;border:0;border-radius:18px;background:#ff8a5b/.test(page) &&
          /#pairbox\{[^}]*padding:72px 20px 24px/.test(pg) &&
          /#wrap\{[^}]*padding:72px 20px 24px/.test(page) &&
          /#wrap\{[^}]*padding:72px 20px 24px/.test(offPage),
        'the pairing screen on the TV has the start page’s field, button and page padding, and the three screens put the title on the same line'
      );
      // one set of rules: the same card, the same message bar and the same step label on every setup screen
      const same = s => [
        /\.card\{background:#14161c;border:1px solid #23262f;border-radius:20px;padding:16px/.test(s) ||
          /\.steps\{margin:0 0 24px;padding:16px;border-radius:20px;background:#14161c;border:1px solid #23262f/.test(s),
        /rgba\(255,138,91,\.14\)/.test(s),
        /border-left:4px solid #8a8fa0/.test(s),
        /\.eyebrow\{font-size:13px;font-weight:600;letter-spacing:\.02em;color:#7b8092/.test(s),
        /left:-100px;top:-140px;width:320px;height:320px/.test(s),
      ];
      ok(
        same(page).slice(2).every(Boolean) && same(offPage).slice(2).every(Boolean) && same(pg).every(Boolean) && same(page).every(Boolean),
        'the card, the step circles, the message bar, the step label and the glow are the same rules on the start page, the off page and the pairing page'
      );
      ok(
        /id=eb data-app=/.test(pg) && /if\(window\.CYTV_APP\)\{var eb=\$\('eb'\)[^}]*\$\('steps'\)\.className='hide'\}/.test(pg),
        'in the app the pairing screen is step 2 of 2 and does not repeat the steps; in a browser it is the first screen and keeps one short card'
      );
    }
    // the start page's script against a stand-in page: each message becomes the toast, with its tone and its time
    const box = {};
    const el = id =>
      box[id] ||
      (box[id] = {
        id,
        className: '',
        textContent: '',
        value: '',
        style: {},
        focus() {},
        setAttribute(k, v) {
          this[k] = v;
        },
      });
    const timers = [];
    const opened = [];
    const sb = {
      document: { getElementById: el },
      location: { replace: u => opened.push(u) },
      setTimeout: (f, ms) => timers.push({ f, ms }) && timers.length,
      clearTimeout() {},
      setInterval() {},
    };
    sb.window = sb;
    sb.window.CYTV_APP = { discover() {}, wake: () => false, getAddr: () => '', bye: () => '', setAddr() {} };
    vm.runInNewContext(page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>')), sb);
    const shown = () => ({ t: box.toast.textContent, c: box.toast.className, ms: (timers[timers.length - 1] || {}).ms });
    ok(
      box.go.textContent === 'Find my TV' && box.mode.textContent === 'Type the address instead' && box.typed.className === 'hide',
      'the first screen opens with Find my TV as the button and the address field out of the way'
    );
    box.mode.onclick();
    ok(
      box.go.textContent === 'Continue' && box.mode.textContent === 'Find the TV instead' && box.typed.className === '',
      'Type the address instead shows the field, Continue, and the way back to Find the TV'
    );
    el('addr').value = 'banana';
    box.go.onclick();
    ok(
      /does not look like a TV address/.test(shown().t) &&
        shown().c === 'toast warn on' &&
        shown().ms === 10000 &&
        box.toast.role === 'alert',
      'a bad address is a warning toast for 10 seconds, read out as an alert'
    );
    box.mode.onclick();
    box.go.onclick();
    ok(
      shown().t === 'Looking for the TV…' &&
        shown().c === 'toast info on' &&
        shown().ms === 3500 &&
        box.go.disabled === true &&
        box.go.textContent === 'Looking…' &&
        box.toast.role === 'status',
      'searching is a short plain toast, and the button says Looking…'
    );
    sb.cytvNotFound();
    ok(
      /Could not find the TV/.test(shown().t) &&
        shown().c === 'toast warn on' &&
        box.go.disabled === false &&
        box.go.textContent === 'Find my TV',
      'no TV found is a warning toast, and the button works again'
    );
    box.go.onclick();
    sb.cytvFound('8.8.8.8');
    ok(
      /not on your home network/.test(shown().t) && shown().c === 'toast warn on' && box.typed.className === '' && opened.length === 0,
      'an address that is not local is a warning toast, and the field is open to type the address'
    );
    box.mode.onclick();
    box.go.onclick();
    box.mode.onclick();
    ok(
      box.toast.className === 'toast' && box.typed.className === '' && box.go.disabled === false && box.go.textContent === 'Continue',
      'Type the address instead, while it looks, stops the search: the message goes and the field is open'
    );
    sb.cytvFound('192.168.1.50');
    sb.cytvNotFound();
    ok(opened.length === 0 && box.toast.className === 'toast', 'and an answer that comes after that is ignored');
    sb.cytvOff('The TV did not answer.');
    ok(shown().t === 'The TV did not answer.' && shown().c === 'toast warn on', 'a message from the app is a warning toast');
    timers[timers.length - 1].f();
    ok(box.toast.className === 'toast warn', 'and the toast goes away when its time is up');
    el('addr').value = '192.168.1.50';
    box.go.onclick();
    ok(opened.length === 1 && opened[0] === 'http://192.168.1.50:8798/', 'a good address goes straight to the TV page');
    const sb2 = Object.assign({}, sb, { document: { getElementById: el } });
    sb2.window = sb2;
    sb2.window.CYTV_APP = { discover() {}, wake: () => false, getAddr: () => '', bye: () => 'removed' };
    vm.runInNewContext(page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>')), sb2);
    ok(
      /Logged out\. This phone was removed/.test(shown().t) && shown().c === 'toast ok on' && shown().ms === 3000,
      'after logging out it says so for 3 seconds'
    );
    {
      // the "TV is off" page: the wake button, with its messages
      const box3 = {};
      const el3 = id =>
        box3[id] ||
        (box3[id] = {
          id,
          className: '',
          textContent: '',
          style: {},
          setAttribute(k, v) {
            this[k] = v;
          },
        });
      const t3 = [];
      const sb3 = {
        document: { getElementById: el3 },
        setTimeout: (f, ms) => t3.push({ f, ms }) && t3.length,
        clearTimeout() {},
        setInterval() {},
      };
      sb3.window = sb3;
      sb3.window.CYTV_APP = { wake: () => false, name: () => 'Living room TV' };
      vm.runInNewContext(offPage.slice(offPage.indexOf('<script>') + 8, offPage.lastIndexOf('</script>')), sb3);
      ok(box3.tv.textContent === 'Living room TV' && box3.name.className === 'pill', 'the off page names the TV in a pill');
      box3.on.onclick();
      ok(
        /Pair this phone with the TV first/.test(box3.toast.textContent) &&
          box3.toast.className === 'toast warn on' &&
          t3[t3.length - 1].ms === 10000,
        'turning on with nothing paired is a warning toast for 10 seconds that says what to do'
      );
      sb3.window.CYTV_APP.wake = () => true;
      box3.on.onclick();
      ok(box3.on.textContent === 'Waking the TV…' && box3.on.disabled === true, 'the button says Waking the TV… while it waits');
      sb3.cytvOff('The TV did not wake up.');
      ok(
        box3.toast.textContent === 'The TV did not wake up.' && box3.on.textContent === 'Turn on the TV' && box3.on.disabled === false,
        'a failed wake is a warning toast and the button says Turn on the TV again'
      );
    }
    ok(
      /Features > Phone remote > Paired phones/.test(page),
      'and when the TV could not be told, the toast names the screen where the phone can still be removed'
    );
  }

  // ---- the build keeps the page and the app in one piece ----
  const build = read('mobile/android/build.ps1');
  ok(
    /mobile\\web\\start\.html/.test(build) && /mobile\\web\\off\.html/.test(build) && /assets/.test(build),
    'the build copies both pages into the package: pairing, and the "TV is off" screen'
  );
  ok(
    /@JavascriptInterface\s+public\s+void\s+forget\(/.test(bridge) &&
      /@JavascriptInterface\s+public\s+String\s+bye\(/.test(bridge) &&
      /void forget\(/.test(read(javaDir + 'Store.java')),
    'logging out: the page can make the app forget the TV (forget) and read how it went (bye)'
  );
  ok(/call\('bye'/.test(page) && /removed from the TV/.test(page), 'and the start page tells the user how the log out went');
  ok(
    /function openTv\(/.test(page) && !/opening/.test(page) && !/setHost\(v\);\s*location\.replace/.test(page),
    'after "Find the TV" or Continue the start page goes straight to the TV page, changing nothing while it loads, and does not flash the "Turn on the TV" panel'
  );
  ok(/aapt2/.test(build) && /d8/.test(build) && /apksigner/.test(build), 'it uses the SDK tools it names');
});
