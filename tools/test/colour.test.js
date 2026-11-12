// The tile colour of a launcher icon (app/src/js/colour.js): cornerColour() gives the colour of a picture's own flat background, taken
// from its four corners, and nothing when the corners are not alike (a gradient, a transparent corner). colour.js has only function
// declarations, so it is loaded as it is, without a browser.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

run(async () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'colour.js'), 'utf8'), sandbox, { filename: 'colour.js' });
  const N = 32;
  // an N x N picture in RGBA: the colour of each corner (3 x 3 pixels, as cornerColour reads them) or a transparent one; the rest is art
  function picture(corners) {
    const d = new Uint8ClampedArray(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      d[i * 4] = 200;
      d[i * 4 + 1] = 30;
      d[i * 4 + 2] = 90;
      d[i * 4 + 3] = 255;
    }
    const at = [
      [0, 0],
      [N - 3, 0],
      [0, N - 3],
      [N - 3, N - 3],
    ];
    corners.forEach((c, k) => {
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) {
          const j = ((at[k][1] + b) * N + at[k][0] + a) * 4;
          d[j] = c[0];
          d[j + 1] = c[1];
          d[j + 2] = c[2];
          d[j + 3] = c.length > 3 ? c[3] : 255;
        }
    });
    return d;
  }
  const four = v => [v, v, v, v];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  ok(typeof sandbox.cornerColour === 'function', 'colour.js has cornerColour');
  ok(eq(sandbox.cornerColour(picture(four([0, 0, 0])), N), [0, 0, 0]), 'flat black corners give black (a logo on black)');
  ok(eq(sandbox.cornerColour(picture(four([255, 255, 255])), N), [255, 255, 255]), 'flat white corners give white');
  ok(eq(sandbox.cornerColour(picture(four([20, 40, 60])), N), [20, 40, 60]), 'flat corners of another colour give that colour');
  ok(
    eq(
      sandbox.cornerColour(
        picture([
          [10, 10, 10],
          [10, 10, 10],
          [10, 10, 10],
          [14, 14, 14],
        ]),
        N
      ),
      [11, 11, 11]
    ),
    'nearly equal corners give their average, rounded'
  );
  ok(
    sandbox.cornerColour(
      picture([
        [0, 0, 0],
        [0, 0, 0],
        [255, 255, 255],
        [255, 255, 255],
      ]),
      N
    ) === null,
    'a gradient (dark above, light below) gives nothing'
  );
  ok(
    sandbox.cornerColour(
      picture([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [60, 60, 60],
      ]),
      N
    ) === null,
    'corners that differ too much give nothing'
  );
  ok(
    sandbox.cornerColour(
      picture([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0, 0],
      ]),
      N
    ) === null,
    'a transparent corner gives nothing'
  );
  ok(
    sandbox.cornerColour(
      picture([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0, 200],
      ]),
      N
    ) === null,
    'a corner that is only partly opaque gives nothing'
  );

  // analyse() and fit(): a picture is read through a 64 x 64 canvas; a stand-in canvas hands it the pixels of a test picture
  const M = 64;
  let pixels = null;
  sandbox.document = {
    createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }),
  };
  // a test picture: transparent, a rounded-free square from m to M-m in colour c, painted over by the rectangles in more
  function art(m, c, more) {
    const d = new Uint8ClampedArray(M * M * 4);
    const put = (x0, y0, x1, y1, col) => {
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const j = (y * M + x) * 4;
          d[j] = col[0];
          d[j + 1] = col[1];
          d[j + 2] = col[2];
          d[j + 3] = 255;
        }
    };
    put(m, m, M - m, M - m, c);
    (more || []).forEach(r => put(r[0], r[1], r[2], r[3], r[4]));
    return d;
  }
  // a card in a frame (the Smart STB icon): grey border 3 px around a white inside with a blue badge
  pixels = art(
    4,
    [205, 211, 219],
    [
      [7, 7, 57, 57, [250, 250, 250]],
      [18, 26, 46, 38, [30, 90, 200]],
    ]
  );
  let an = sandbox.analyse({});
  ok(
    an.k === 'pad' && Math.abs(an.fr - 3 / M) < 1e-9 && eq(an.edge, [250, 250, 250]) && eq(an.top, an.edge),
    "a picture with a frame of its own: the frame's depth is found and the tile takes the colour inside it"
  );
  // a white card with a wide wordmark close to its sides (the Alexa icon): no frame
  pixels = art(4, [255, 255, 255], [[6, 28, 58, 36, [35, 47, 62]]]);
  an = sandbox.analyse({});
  ok(an.k === 'pad' && !an.fr && eq(an.edge, [255, 255, 255]), 'a wordmark that comes close to two sides is not taken for a frame');
  // a picture in four colours, one per side: not a card in a frame either
  pixels = art(
    4,
    [250, 250, 250],
    [
      [4, 4, 60, 8, [200, 0, 0]],
      [4, 56, 60, 60, [0, 200, 0]],
      [4, 8, 8, 56, [0, 0, 200]],
      [56, 8, 60, 56, [200, 200, 0]],
    ]
  );
  an = sandbox.analyse({});
  ok(an.k === 'pad' && an.fr && eq(an.edge, [250, 250, 250]), 'a border of four colours around one inside colour is a frame too');

  // fit(): in a grid tile the picture keeps its own proportions (a square icon is not stretched to the wider tile)
  const tileOf = col => {
    const st = {},
      cls = {};
    return {
      _i: { style: st, removeAttribute: () => Object.keys(st).forEach(k => delete st[k]) },
      _col: col,
      style: {},
      classList: { add: c => (cls[c] = 1), remove: c => delete cls[c] },
      st,
      cls,
    };
  };
  let t = tileOf({ k: 'pad', box: [0.0625, 0.0625, 0.9375, 0.9375] });
  sandbox.fit(t, false);
  ok(
    t.cls.fill &&
      t.st.width === 'auto' &&
      /^114\.28/.test(t.st.height) &&
      t.st.left === '50%' &&
      t.st.transform === 'translateX(-50%)' &&
      !t.st.clipPath,
    'a padded square icon fills the grid tile from top to bottom at its own proportions, centred'
  );
  t = tileOf({ k: 'pad', box: [0.0625, 0.0625, 0.9375, 0.9375], fr: 3 / M, fround: 0.05 });
  sandbox.fit(t, false);
  ok(
    /^inset\(10\.9375% 10\.9375% 10\.9375% 10\.9375% round 6%\)$/.test(t.st.clipPath),
    "the picture's own frame is cut off, along the inside's round corner"
  );
  t = tileOf({ k: 'logo' });
  sandbox.fit(t, true);
  ok(t.cls.logo && !t.cls.fill, 'a transparent glyph icon is marked as logo so glass themes keep it translucent');
  sandbox.document.body = { getAttribute: a => (a === 'data-theme' ? 'liquid-glass' : '') };
  t = tileOf({ k: 'pad', box: [0.0625, 0.0625, 0.9375, 0.9375] });
  sandbox.fit(t, true);
  ok(t.cls.fill && /^114\.28/.test(t.st.height), 'a padded icon in the liquid-glass dock fills top to bottom like the grid');
});
