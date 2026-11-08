const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

function element() {
  return {
    children: [],
    parentNode: null,
    appendChild(child) {
      child.remove();
      this.children.push(child);
      child.parentNode = this;
    },
    remove() {
      if (this.parentNode) {
        const siblings = this.parentNode.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentNode = null;
      }
    },
  };
}
function image() {
  const i = element();
  i.requests = [];
  Object.defineProperty(i, 'src', {
    set(value) {
      this.requests.push(value);
    },
    get() {
      return this.requests[this.requests.length - 1];
    },
  });
  return i;
}

run(async () => {
  const context = {
    tiles: {},
    colors: { demo: {}, missing: {}, __live: {} },
    API: 'http://127.0.0.1:8765',
    LIVE_ICON: 'data:image/svg+xml;base64,PHN2Zy8+',
    Image: image,
    document: { createElement: element },
    hit() {},
    paint() {},
    fit() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app/src/js/tiles.js'), 'utf8'), context);
  const tile = context.tile({ id: 'demo', title: 'Demo' }),
    icon = tile._i;
  icon.onerror();
  ok(tile._iconFailed && tile._iconFallback && !icon.parentNode, 'an early helper failure keeps a text fallback');
  context.retryTileIcons();
  ok(icon.requests.length === 2 && /retry=1$/.test(icon.src) && tile._iconFallback, 'helper recovery retries without hiding the fallback');
  context.retryTileIcons();
  ok(icon.requests.length === 2, 'another app-list response does not duplicate an in-flight retry');
  icon.onload();
  ok(!tile._iconFailed && !tile._iconFallback && icon.parentNode === tile, 'a recovered icon replaces fallback text in the existing tile');
  context.retryTileIcons();
  ok(icon.requests.length === 2, 'a successful icon needs no further requests');
  ok(
    context.tile({ id: 'demo', title: 'Updated' }) === tile && tile._a.title === 'Updated',
    'cached tiles still receive updated app metadata'
  );
  const missing = context.tile({ id: 'missing', title: 'Missing' });
  for (let n = 0; n < 10; n++) {
    missing._i.onerror();
    context.retryTileIcons();
  }
  ok(
    missing._i.requests.length === 3 && missing.children.length === 1,
    'a permanently missing icon has bounded retries and only one fallback'
  );
  const live = context.tile({ id: '__live', title: 'Live' });
  live._i.onerror();
  context.retryTileIcons();
  ok(
    live._i.requests.length === 1 && live._i.src === context.LIVE_ICON,
    'the embedded Live TV image is never sent to the helper icon endpoint'
  );
  const layout = fs.readFileSync(path.join(root, 'app/src/js/layout.js'), 'utf8');
  ok(
    layout.indexOf('retryTileIcons();') >= 0 && layout.indexOf('retryTileIcons();') < layout.indexOf('if (sig === lastSig)'),
    'helper recovery retries icons before the unchanged-layout early return'
  );
});
