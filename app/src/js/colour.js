/* ---------- colour (extracted once per app, then remembered) ---------- */
function hsl2rgb(h, s, l) {
  var a = s * Math.min(l, 1 - l);
  function f(n) {
    var k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  }
  return [f(0), f(8), f(4)];
}
function rgb2hsl(R, G, B) {
  R /= 255;
  G /= 255;
  B /= 255;
  var mx = Math.max(R, G, B),
    mn = Math.min(R, G, B),
    l = (mx + mn) / 2,
    h = 0,
    s = 0,
    d = mx - mn;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hashHue(id) {
  var h = 0;
  for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
/* the colour of the four corners when all are opaque and alike (a picture on its own flat background), else null */
function cornerColour(d, N) {
  var c = [
    [0, 0],
    [N - 3, 0],
    [0, N - 3],
    [N - 3, N - 3],
  ].map(function (p) {
    var R = 0,
      G = 0,
      B = 0,
      n = 0,
      a,
      b,
      j;
    for (a = 0; a < 3; a++)
      for (b = 0; b < 3; b++) {
        j = ((p[1] + b) * N + p[0] + a) * 4;
        if (d[j + 3] >= 230) {
          R += d[j];
          G += d[j + 1];
          B += d[j + 2];
          n++;
        }
      }
    return n === 9 ? [R / 9, G / 9, B / 9] : null;
  });
  if (!c.every(Boolean)) return null;
  var m = [0, 1, 2].map(function (i) {
      return (c[0][i] + c[1][i] + c[2][i] + c[3][i]) / 4;
    }),
    sp = 0;
  c.forEach(function (v) {
    sp += Math.abs(v[0] - m[0]) + Math.abs(v[1] - m[1]) + Math.abs(v[2] - m[2]);
  });
  return sp < 45 ? [Math.round(m[0]), Math.round(m[1]), Math.round(m[2])] : null;
}
/* What the icon looks like, from its alpha: 'full' (art reaches the edges), 'pad' (an opaque, roughly square picture with a transparent
   margin around it, as many LG icons are) or 'logo' (transparent gaps inside). box is the visible picture, as fractions of the image. */
function analyse(img) {
  try {
    var N = 64,
      cv = document.createElement('canvas');
    cv.width = cv.height = N;
    var x = cv.getContext('2d');
    x.drawImage(img, 0, 0, N, N);
    var d = x.getImageData(0, 0, N, N).data,
      x0 = N,
      y0 = N,
      x1 = -1,
      y1 = -1,
      xx,
      yy;
    for (yy = 0; yy < N; yy++)
      for (xx = 0; xx < N; xx++)
        if (d[(yy * N + xx) * 4 + 3] > 128) {
          if (xx < x0) x0 = xx;
          if (xx > x1) x1 = xx;
          if (yy < y0) y0 = yy;
          if (yy > y1) y1 = yy;
        }
    if (x1 < 0) return { k: 'logo' };
    var bw = x1 - x0 + 1,
      bh = y1 - y0 + 1,
      solid = 0;
    for (yy = y0; yy <= y1; yy++) for (xx = x0; xx <= x1; xx++) if (d[(yy * N + xx) * 4 + 3] >= 230) solid++;
    function strip(ya, yb) {
      var R = 0,
        G = 0,
        B = 0,
        n = 0,
        i;
      for (var y = ya; y <= yb; y++)
        for (var x = x0; x <= x1; x++) {
          i = (y * N + x) * 4;
          if (d[i + 3] >= 230) {
            R += d[i];
            G += d[i + 1];
            B += d[i + 2];
            n++;
          }
        }
      return n ? [Math.round(R / n), Math.round(G / n), Math.round(B / n)] : null;
    }
    var vis = 0,
      sum = 0,
      li; // mean brightness of the visible pixels, 0-255
    for (li = 0; li < d.length; li += 4)
      if (d[li + 3] >= 128) {
        vis++;
        sum += 0.2126 * d[li] + 0.7152 * d[li + 1] + 0.0722 * d[li + 2];
      }
    var lm = vis ? sum / vis : 255;
    var margin = Math.max(x0, y0, N - 1 - x1, N - 1 - y1) / N,
      ratio = bw / bh;
    var k = solid / (bw * bh) < 0.85 || ratio < 0.8 || ratio > 1.25 ? 'logo' : margin < 0.03 ? 'full' : 'pad',
      edge = null;
    if (k === 'full') {
      // art to the edges, but not one flat colour there (a gradient): the tile cannot match it, so the picture fills the tile
      var sr = 0,
        sg = 0,
        sb = 0,
        n0 = 0,
        q = 0,
        ring = [];
      for (yy = 0; yy < N; yy++)
        for (xx = 0; xx < N; xx++) {
          if (yy && yy < N - 1 && xx && xx < N - 1) continue;
          var j = (yy * N + xx) * 4;
          if (d[j + 3] >= 230) {
            ring.push(d[j], d[j + 1], d[j + 2]);
            sr += d[j];
            sg += d[j + 1];
            sb += d[j + 2];
            n0++;
          }
        }
      if (n0 > 0) {
        var mr = sr / n0,
          mg = sg / n0,
          mb = sb / n0;
        for (var t0 = 0; t0 < ring.length; t0 += 3)
          q += Math.abs(ring[t0] - mr) + Math.abs(ring[t0 + 1] - mg) + Math.abs(ring[t0 + 2] - mb);
        var st = strip(0, 1),
          sbot = strip(N - 2, N - 1),
          vert = st && sbot ? Math.abs(st[0] - sbot[0]) + Math.abs(st[1] - sbot[1]) + Math.abs(st[2] - sbot[2]) : 0;
        if (q / n0 / 3 > 14 || vert > 40) {
          x0 = 0;
          x1 = N - 1;
          var cm = cornerColour(d, N); // art that touches the edges on a flat background: the tile takes the background's colour
          return {
            k: 'pad',
            box: [0, 0, 1, 1],
            edge: cm || [Math.round(mr), Math.round(mg), Math.round(mb)],
            top: cm || strip(0, 1),
            bot: cm || strip(N - 2, N - 1),
          };
        }
      }
    }
    if (k === 'pad') {
      // the picture's own border colour, from the outer two pixels of the visible box
      var R = 0,
        G = 0,
        B = 0,
        n = 0;
      for (yy = y0; yy <= y1; yy++)
        for (xx = x0; xx <= x1; xx++) {
          if (yy - y0 > 1 && y1 - yy > 1 && xx - x0 > 1 && x1 - xx > 1) continue;
          var i = (yy * N + xx) * 4;
          if (d[i + 3] >= 230) {
            R += d[i];
            G += d[i + 1];
            B += d[i + 2];
            n++;
          }
        }
      if (n) edge = [Math.round(R / n), Math.round(G / n), Math.round(B / n)];
      else k = 'logo';
    }
    return { k: k, lm: lm, box: [x0 / N, y0 / N, (x1 + 1) / N, (y1 + 1) / N], edge: edge, top: strip(y0, y0 + 1), bot: strip(y1 - 1, y1) };
  } catch (e) {
    return null;
  }
} // null: the canvas could not be read
/* returns {c: vibrant colour for the glow, b: tile background (the icon's own edge colour), k and box from analyse}; t is set when the image could not be read */
function iconColor(img, id) {
  var glow = null,
    edge = null,
    N = 16,
    tainted = false;
  try {
    var cv = document.createElement('canvas');
    cv.width = cv.height = N;
    var x = cv.getContext('2d');
    x.drawImage(img, 0, 0, N, N);
    var d = x.getImageData(0, 0, N, N).data,
      R = 0,
      G = 0,
      B = 0,
      W = 0,
      eR = 0,
      eG = 0,
      eB = 0,
      eN = 0,
      ring = 0;
    for (var y = 0; y < N; y++)
      for (var xx = 0; xx < N; xx++) {
        var i = (y * N + xx) * 4,
          a = d[i + 3] / 255;
        if (y === 0 || y === N - 1 || xx === 0 || xx === N - 1) {
          ring++;
          if (a > 0.8) {
            eR += d[i];
            eG += d[i + 1];
            eB += d[i + 2];
            eN++;
          }
        }
        if (a < 0.4) continue;
        var hs = rgb2hsl(d[i], d[i + 1], d[i + 2]);
        var w = a * (0.15 + hs[1] * hs[1]);
        R += d[i] * w;
        G += d[i + 1] * w;
        B += d[i + 2] * w;
        W += w;
      }
    if (eN > ring * 0.5) edge = [Math.round(eR / eN), Math.round(eG / eN), Math.round(eB / eN)];
    if (W > 0.5) {
      var h = rgb2hsl(R / W, G / W, B / W);
      if (h[1] > 0.22) glow = hsl2rgb(h[0], Math.max(0.5, Math.min(h[1], 0.8)), Math.max(0.36, Math.min(h[2], 0.52)));
    }
  } catch (e) {
    tainted = true;
  }
  var an = tainted ? null : analyse(img);
  if (an && an.k === 'pad' && an.edge) edge = an.edge;
  var fb = hsl2rgb(hashHue(id), 0.42, 0.42);
  glow = glow || (edge && rgb2hsl(edge[0], edge[1], edge[2])[1] > 0.3 ? edge : fb);
  var col = { c: glow, b: edge || hsl2rgb(rgb2hsl(glow[0], glow[1], glow[2])[0], 0.4, 0.2) };
  // near-black strokes (made for a white background) vanish on a dark tile: use a light one
  if (an && an.k === 'logo' && an.lm < 80) col.b = [236, 238, 242];
  if (an) {
    col.k = an.k;
    if (an.box) col.box = an.box;
    if (an.top && an.bot) {
      col.gt = an.top;
      col.gb = an.bot;
    }
  }
  if (tainted) col.t = 1;
  return col;
}
/* a picture with a transparent margin fills a grid tile (cropped to its visible part); in the wide dock tiles it keeps its size on a tile of its own colour */
function fit(d, dock) {
  var i = d._i,
    c = d._col;
  if (!i) return;
  i.removeAttribute('style');
  d.classList.remove('fill');
  d.style.background = '';
  /* a picture of your own shown as Full tile (helper/icons.js): it covers the tile, its middle kept, in the dock and the grid alike */
  if (d._it) {
    d.classList.add('fill');
    var st = i.style;
    st.position = 'absolute';
    st.left = '0';
    st.top = '0';
    st.width = '100%';
    st.height = '100%';
    st.maxWidth = 'none';
    st.objectFit = 'cover';
    return;
  }
  if (!c || c.k !== 'pad' || !c.box) return;
  var bx = c.box,
    bw = bx[2] - bx[0],
    bh = bx[3] - bx[1],
    s = i.style;
  if (dock) {
    s.height = 'calc(' + 56 / bh + '% * var(--icon-s, 1))';
    s.maxWidth = 'none';
    s.width = 'auto';
    // a gradient picture: the tile takes the same gradient between the picture's top and bottom edges, so no square shows
    if (c.gt && c.gb && Math.abs(c.gt[0] - c.gb[0]) + Math.abs(c.gt[1] - c.gb[1]) + Math.abs(c.gt[2] - c.gb[2]) > 40)
      d.style.background = 'linear-gradient(rgb(' + c.gt.join(',') + ') 22%,rgb(' + c.gb.join(',') + ') 78%)';
    return;
  }
  d.classList.add('fill');
  s.position = 'absolute';
  s.maxWidth = 'none';
  s.width = 100 / bw + '%';
  s.height = 100 / bh + '%';
  s.left = (-bx[0] / bw) * 100 + '%';
  s.top = (-bx[1] / bh) * 100 + '%';
}
function paint(d, col) {
  d.style.setProperty('--c', col.c.join(','));
  d.style.setProperty('--b', col.b.join(','));
}
