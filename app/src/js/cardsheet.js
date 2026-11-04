/* ---------- the card sheet: a card's drawer page shown from the right, keys and focus owned by the launcher ---------- */
var CS_PURE = (function () {
  // targets: {name, x, y, w, h, tab} in percent of the sheet; tab is the index in the tab row, or -1
  function csNext(list, from, dir) {
    var cx = from.x + from.w / 2,
      cy = from.y + from.h / 2,
      best = null,
      bestD = 0,
      i;
    for (i = 0; i < list.length; i++) {
      var t = list[i];
      if (t === from) continue;
      var dx = t.x + t.w / 2 - cx,
        dy = t.y + t.h / 2 - cy,
        p = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx,
        c = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (p <= 0.5) continue;
      var d = p + 2 * c;
      if (!best || d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }
  function csTabStep(list, cur, dir, rtl) {
    if (!cur || cur.tab < 0 || (dir !== 'left' && dir !== 'right')) return null;
    var step = (dir === 'right' ? 1 : -1) * (rtl ? -1 : 1);
    if (cur.tab + step < 0) return null;
    for (var i = 0; i < list.length; i++) if (list[i].tab === cur.tab + step) return list[i];
    return null;
  }
  // the first option still without a value: a place, or any option that has no default
  function csUnset(card, pk) {
    var opts = (pk && pk.options) || [];
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      if (o.kind !== 'place' && o['default'] !== '') continue;
      var v = card ? card[o.key] : undefined;
      if (v === undefined || v === null || v === '') return o;
    }
    return null;
  }
  return { csNext: csNext, csTabStep: csTabStep, csUnset: csUnset };
})();
if (typeof window !== 'undefined') window.CS_PURE = CS_PURE;
/* @dom */
