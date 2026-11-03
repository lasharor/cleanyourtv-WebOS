/* The Now playing card (ES5: it runs on Chromium 68 too). Everything comes in the message of the launcher: m.data is what the Spotify
   add-on's service said (the cover as a data: address, because the frame has no network). The progress bar moves with the clock between
   two answers. The three buttons (previous, play or pause, next) are told to the launcher, which makes them targets of the remote. */
var ICON = {
  prev: '<path d="M6 6h2v12H6zM9.5 12L18 18V6z"/>',
  next: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
};
/* percent of the card, as the launcher wants them; the page draws its buttons at the same places */
var BUTTONS = [
  { name: 'prev', x: 20, y: 76, w: 18, h: 24 },
  { name: 'toggle', x: 41, y: 76, w: 18, h: 24 },
  { name: 'next', x: 62, y: 76, w: 18, h: 24 },
];
var M = null,
  D = null,
  rcv = 0,
  stamp = 0,
  sent = false;

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/* 125000 -> 2:05 (and 1:02:05 for a long episode) */
function clock(ms) {
  var s = Math.floor(Math.max(0, ms) / 1000),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  s = s % 60;
  return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function at() {
  return D.playing ? Math.min(D.duration || Infinity, D.progress + (Date.now() - rcv)) : D.progress;
}
function tick() {
  if (!D || !D.title || !D.duration) return;
  var f = D.duration ? at() / D.duration : 0,
    b = document.querySelector('#bar i'),
    t = document.querySelector('#main .tm');
  if (b) b.style.transform = 'scaleX(' + Math.max(0, Math.min(1, f)).toFixed(3) + ')';
  if (t) t.textContent = clock(at()) + ' / ' + clock(D.duration);
}
function draw() {
  var main = document.getElementById('main'),
    tabs = document.getElementById('tabs'),
    bar = document.getElementById('bar');
  document.documentElement.dir = M.dir || 'ltr';
  document.body.style.color = M.ink || '#fff';
  if (M.font) document.body.style.fontFamily = M.font;
  main.textContent = '';
  tabs.textContent = '';
  bar.style.display = 'none';
  if (!D) return;
  /* nothing plays: nothing is drawn, unless Spotify is not set up or refused (then the card says why) */
  if (!D.title) {
    var why = D.connected === false ? D.hint : D.error;
    if (why) main.appendChild(el('div', 'msg', why));
    return;
  }
  if (D.cover) {
    var im = el('img');
    im.src = D.cover;
    main.appendChild(im);
  } else main.appendChild(el('div', 'nocover'));
  var tx = el('div', 'txt');
  tx.appendChild(el('div', 't', D.title));
  tx.appendChild(el('div', 'a', D.artist));
  if (M.size !== 'small') tx.appendChild(el('div', 'tm', ''));
  main.appendChild(tx);
  bar.style.display = 'block';
  BUTTONS.forEach(function (b) {
    var k = b.name === 'toggle' ? (D.playing ? 'pause' : 'play') : b.name,
      d = el('div', 'btn');
    d.style.left = b.x + '%';
    d.innerHTML = '<svg viewBox="0 0 24 24">' + ICON[k] + '</svg>';
    tabs.appendChild(d);
  });
  tick();
}
window.addEventListener('message', function (e) {
  var m = e.data && e.data.cytvCard;
  if (!m || typeof m !== 'object') return;
  M = m;
  if (m.data && m.data.at !== stamp) {
    stamp = m.data.at;
    rcv = Date.now();
  }
  D = m.data || null;
  draw();
  if (!sent) {
    sent = true;
    parent.postMessage({ cytvCard: 'buttons', buttons: BUTTONS }, '*');
  }
});
setInterval(tick, 1000);
parent.postMessage({ cytvCard: 'ready' }, '*');
