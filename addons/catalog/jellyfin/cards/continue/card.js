/* The Continue watching card (ES5: it runs on Chromium 68 too). Everything comes in the message of the launcher: m.data is what the
   Jellyfin add-on's service said, the pictures as data: addresses (the frame has no network). Each title is a button for the remote:
   the launcher puts a target over it, and OK sends the add-on open1, open2 ... which opens the Jellyfin app. The card shows as many
   titles as fit at a readable size (or the number chosen), the title and episode over the picture. */
var M = null,
  D = null,
  last = '';

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/* the tiles: as high as the card, side by side; with "as many as fit" a still is never narrower than about 1.25 times the card's
   height (a poster 0.5 times), so the text stays readable; a chosen number is kept and the tiles get narrower */
function layout(have, poster, chosen) {
  var W = window.innerWidth,
    H = window.innerHeight,
    ratio = poster ? 2 / 3 : 16 / 9,
    gap = Math.max(8, Math.round(H * 0.07)),
    minW = H * (poster ? 0.55 : 1.4),
    n = chosen ? Math.min(have, chosen) : Math.max(1, Math.min(have, Math.floor((W + gap) / (minW + gap)))),
    h = H,
    w = h * ratio;
  if (n * w + (n - 1) * gap > W) {
    w = (W - (n - 1) * gap) / n;
    h = Math.min(H, w / ratio);
  }
  var rem = Math.max(12, Math.min(34, Math.min(h * 0.17, w * (poster ? 0.15 : 0.095))));
  return { n: n, w: Math.floor(w), h: Math.floor(h), gap: gap, rem: rem, top: Math.floor((H - h) / 2) };
}
function draw() {
  var row = document.getElementById('row'),
    msg = document.getElementById('msg');
  document.documentElement.dir = M.dir || 'ltr';
  document.body.style.color = M.ink || '#fff';
  if (M.font) document.body.style.fontFamily = M.font;
  row.textContent = '';
  msg.textContent = '';
  var items = (D && D.items) || [];
  if (!D) return buttons([]);
  if (!items.length) {
    document.documentElement.style.fontSize = Math.max(12, Math.min(26, window.innerHeight * 0.11)).toFixed(1) + 'px';
    msg.textContent = D.connected === false ? D.hint || '' : D.error || D.empty || '';
    return buttons([]);
  }
  var poster = D.style === 'poster',
    z = layout(items.length, poster, +D.count || 0),
    W = window.innerWidth,
    H = window.innerHeight,
    out = [];
  document.documentElement.style.fontSize = z.rem.toFixed(1) + 'px';
  row.style.top = z.top + 'px';
  items.slice(0, z.n).forEach(function (it, i) {
    var tile = el('div', 'tile' + (poster ? ' poster' : '')),
      txt = el('div', 'txt');
    tile.style.width = z.w + 'px';
    tile.style.height = z.h + 'px';
    if (i) tile.style[M.dir === 'rtl' ? 'marginRight' : 'marginLeft'] = z.gap + 'px';
    if (it.pic) {
      var im = el('img');
      im.src = it.pic;
      tile.appendChild(im);
    }
    tile.appendChild(el('div', 'fade'));
    txt.appendChild(el('div', 't', it.title));
    if (it.sub) txt.appendChild(el('div', 's', it.sub));
    /* how long is left (or "Next episode"): a small glass label in the top corner */
    if (it.left) tile.appendChild(el('div', 'left', it.left));
    tile.appendChild(txt);
    if (it.pct > 0) {
      var bar = el('div', 'bar'),
        fill = el('i');
      fill.style.width = Math.max(2, Math.min(100, it.pct)) + '%';
      bar.appendChild(fill);
      tile.appendChild(bar);
    }
    row.appendChild(tile);
    /* the target of the remote: this tile, in percent of the card */
    var x = M.dir === 'rtl' ? W - (i + 1) * z.w - i * z.gap : i * (z.w + z.gap);
    out.push({ name: 'open' + (i + 1), x: (x / W) * 100, y: (z.top / H) * 100, w: (z.w / W) * 100, h: (z.h / H) * 100 });
  });
  buttons(out);
}
function buttons(list) {
  var k = JSON.stringify(list);
  if (k === last) return;
  last = k;
  parent.postMessage({ cytvCard: 'buttons', buttons: list }, '*');
}
window.addEventListener('message', function (e) {
  var m = e.data && e.data.cytvCard;
  if (!m || typeof m !== 'object') return;
  M = m;
  D = m.data || null;
  draw();
});
window.addEventListener('resize', function () {
  if (M) draw();
});
parent.postMessage({ cytvCard: 'ready' }, '*');
