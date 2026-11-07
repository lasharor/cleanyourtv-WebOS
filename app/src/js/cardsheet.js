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
      // left and right stay in the row: a target that does not overlap it vertically is not beside it (Close above the last button is
      // not "right" of it, so the page's right edge can step to its next item)
      if ((dir === 'left' || dir === 'right') && (t.y >= from.y + from.h || t.y + t.h <= from.y)) continue;
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
      if (o.kind !== 'place' && o.def !== '') continue;
      var v = card ? card[o.key] : undefined;
      if (v === undefined || v === null || v === '') return o;
    }
    return null;
  }
  // the target of a name, or null
  function csNamed(list, name) {
    for (var i = 0; name && i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }
  // a move from the page into the tab row lands on the tab the page shows (when it said which), not the nearest one
  function csLand(list, cur, next, tab) {
    if (!next || next.tab < 0 || !cur || cur.tab >= 0 || !(tab >= 0)) return next;
    for (var i = 0; i < list.length; i++) if (list[i].tab === tab) return list[i];
    return next;
  }
  // the edges a page names: the action a direction sends when no target lies that way ({left, right, up, down}, names up to 40)
  function csEdges(e) {
    var out = {};
    if (e && typeof e === 'object')
      ['left', 'right', 'up', 'down'].forEach(function (d) {
        if (typeof e[d] === 'string' && e[d] && e[d].length <= 40) out[d] = e[d];
      });
    return out;
  }
  return { csNext: csNext, csTabStep: csTabStep, csUnset: csUnset, csNamed: csNamed, csLand: csLand, csEdges: csEdges };
})();
if (typeof window !== 'undefined') window.CS_PURE = CS_PURE;
/* @dom */
/* ---------- the sheet itself ----------
   A card of an add-on can bring a second page (card.json "drawer"). OK on the card's drawer button opens it from the right edge in a sandboxed
   frame like the card's own. The page draws; the launcher owns the keys and the focus: the page tells where its targets are (percent of
   its frame), the launcher moves the focus between them with the arrows, draws the ring over them and tells the page what happened
   (select, act, focus). Messages: launcher -> page {cytvCard: ctx} and {cytvSheet: {select: i | act: name | focus: name | key: 'chup' | 'chdown'}}; page -> launcher
   {cytvCard: 'ready'}, {cytvSheet: 'targets', targets, focus, back, tab, edges}, 'option' (set), 'action' (name, arg), 'close'. */
var CS = {
  on: false,
  el: null,
  frame: null,
  targets: [],
  cur: null,
  back: '',
  tab: -1,
  edges: {},
  idleT: 0,
  slot: '',
  ctxK: '',
  tick: 0,
  ov: null,
};
/* the live card element of the place the sheet was opened from (Home redraws its cards, which makes new elements) */
function csCardEl() {
  var els = $('cards').children;
  for (var i = 0; i < els.length; i++) if (els[i]._slot === CS.slot && els[i]._pk) return els[i];
  return null;
}
function csCtx() {
  var el = csCardEl();
  if (!el || !el._pk) return null;
  var ctx = cardFrameCtx(el, el._pk, el._card || {});
  ctx.data = el._data || null;
  ctx.sheet = true;
  return ctx;
}
function csPost(m) {
  try {
    CS.frame.contentWindow.postMessage(m, '*');
  } catch (e) {}
}
function csSendCtx(force) {
  var ctx = csCtx();
  if (!ctx) return;
  var k = JSON.stringify(ctx);
  if (!force && k === CS.ctxK) return;
  CS.ctxK = k;
  csPost({ cytvCard: ctx });
}
function csOpen(cardEl) {
  var pk = cardEl && cardEl._pk;
  if (!pk || !pk.drawer || !pk.drawer.page || !cardEl._card) return;
  if (CS.on) csClose();
  CS.on = true;
  CS.el = $('cs');
  CS.slot = cardEl._slot;
  CS.targets = [];
  CS.cur = null;
  CS.back = '';
  CS.tab = -1;
  CS.edges = {};
  CS.ctxK = '';
  var box = CS.el;
  box.className = 'on';
  box.innerHTML = '<div class="sc" data-a="close"></div><div class="pn"><div class="tg"></div></div>';
  var pn = box.lastChild,
    f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('tabindex', '-1');
  f.setAttribute('scrolling', 'no');
  f.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none';
  f.onload = function () {
    csSendCtx(true);
  };
  f.src = API + '/card/' + String(cardEl._card.type).replace(/^x-/, '') + '/' + pk.drawer.page;
  pn.insertBefore(f, pn.firstChild);
  CS.frame = f;
  CS.ov = pn.lastChild;
  /* the sheet slides in (transform only) once it is on screen */
  setTimeout(function () {
    if (CS.on) box.className = 'on in';
  }, 30);
  /* what the card's add-on last said reaches the page too, while it is open */
  clearInterval(CS.tick);
  CS.tick = setInterval(function () {
    if (CS.on) csSendCtx(false);
  }, 2000);
  csIdle();
}
function csClose() {
  if (!CS.on) return;
  CS.on = false;
  clearTimeout(CS.idleT);
  clearInterval(CS.tick);
  var box = $('cs');
  box.className = '';
  box.textContent = '';
  CS.frame = null;
  CS.ov = null;
  CS.targets = [];
  CS.cur = null;
  CS.back = '';
  CS.tab = -1;
  CS.edges = {};
}
/* OLED care, as for the cards: a sheet nobody uses closes after five minutes */
function csIdle() {
  clearTimeout(CS.idleT);
  CS.idleT = setTimeout(csClose, 300000);
}
function csPct(v) {
  v = Number(v);
  return isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}
/* the targets the page told: kept only as far as they are well formed; the focus stays where it was if that target is still there.
   back: what Back presses instead of closing the sheet: a target, or an action of the page that is not a target (a list view goes back
   to its list); tab: the tab the page shows, where Up from the page lands in the tab row; edges: the action an arrow sends when no
   target lies that way (the next item past the last button) */
function csTargets(list, focus, back, tab, edges) {
  var ok = [],
    keep = CS.cur ? CS.cur.name : '';
  (Array.isArray(list) ? list : []).slice(0, 24).forEach(function (b) {
    var n = b && typeof b === 'object' ? b : {};
    if (typeof n.name !== 'string' || !n.name || n.name.length > 40) return;
    var tab = Number(n.tab);
    ok.push({
      name: n.name,
      x: csPct(n.x),
      y: csPct(n.y),
      w: csPct(n.w),
      h: csPct(n.h),
      r: Math.max(0, Math.min(60, Number(n.r) || 0)),
      tab: isFinite(tab) && tab >= 0 && tab === Math.floor(tab) ? tab : -1,
    });
  });
  CS.targets = ok;
  CS.back = typeof back === 'string' && back.length <= 40 ? back : '';
  CS.tab = typeof tab === 'number' && tab >= 0 && tab === Math.floor(tab) ? tab : -1;
  CS.edges = CS_PURE.csEdges(edges);
  var want = typeof focus === 'string' && focus ? focus : keep;
  CS.cur = null;
  ok.forEach(function (b) {
    if (b.name === want) CS.cur = b;
  });
  if (!CS.cur && ok.length) CS.cur = ok[0];
  csDraw();
}
function csDraw() {
  if (!CS.ov) return;
  CS.ov.textContent = '';
  CS.targets.forEach(function (b) {
    var d = document.createElement('div');
    d.className = 'cs-t' + (b === CS.cur ? ' on' : '');
    d.style.cssText =
      'left:' + b.x + '%;top:' + b.y + '%;width:' + b.w + '%;height:' + b.h + '%' + (b.r ? ';border-radius:' + b.r + 'px' : '');
    d.addEventListener('click', function () {
      csIdle();
      csFocus(b, false);
      csActivate(b);
    });
    d.addEventListener('mousemove', function () {
      if (CS.cur !== b) {
        csIdle();
        csFocus(b, false);
      }
    });
    CS.ov.appendChild(d);
  });
}
function csFocus(b, select) {
  if (!b) return;
  var moved = CS.cur !== b;
  CS.cur = b;
  /* the ring moves without drawing everything again */
  if (CS.ov) for (var i = 0; i < CS.ov.children.length; i++) CS.ov.children[i].className = 'cs-t' + (CS.targets[i] === b ? ' on' : '');
  if (!moved) return;
  if (select && b.tab >= 0) csPost({ cytvSheet: { select: b.tab } });
  csPost({ cytvSheet: { focus: b.name } });
}
function csActivate(b) {
  if (!b) return;
  if (b.name === 'close') return csClose();
  if (b.tab >= 0) csPost({ cytvSheet: { select: b.tab } });
  csPost({ cytvSheet: { act: b.name } });
}
function csKey(k, e) {
  csIdle();
  /* the key was swapped for a right-to-left layout (input.js): the targets are where they are on screen, so back to the physical key */
  var rl = typeof rtl === 'function' && rtl();
  if (rl && (k === 37 || k === 39)) k = 76 - k;
  e.preventDefault();
  if (k === 461 || k === 27 || k === 8) {
    var bk = CS_PURE.csNamed(CS.targets, CS.back);
    if (bk) {
      csFocus(bk, true);
      return csActivate(bk);
    }
    if (CS.back) return csPost({ cytvSheet: { act: CS.back } });
    return csClose();
  }
  /* CH+ and CH- go to the page (it may page a list or step to the next item) */
  if (k === 33 || k === 34) return csPost({ cytvSheet: { key: k === 33 ? 'chup' : 'chdown' } });
  if (k === 13) return csActivate(CS.cur);
  var dir = k === 37 ? 'left' : k === 38 ? 'up' : k === 39 ? 'right' : k === 40 ? 'down' : '';
  if (!dir || !CS.targets.length) return;
  if (!CS.cur) return csFocus(CS.targets[0], false);
  var n = CS_PURE.csTabStep(CS.targets, CS.cur, dir, rl);
  if (n) return csFocus(n, true);
  n = CS_PURE.csNext(CS.targets, CS.cur, dir);
  /* from the page into the tab row: the tab the page shows */
  n = CS_PURE.csLand(CS.targets, CS.cur, n, CS.tab);
  if (n) csFocus(n, false);
  else if (CS.edges[dir]) csPost({ cytvSheet: { act: CS.edges[dir] } });
}
/* a click on the dimmed Home closes the sheet */
document.addEventListener('click', function (ev) {
  if (!CS.on) return;
  var el = ev.target.closest ? ev.target.closest('[data-a]') : null;
  if (el && el.getAttribute('data-a') === 'close') csClose();
});
window.addEventListener('message', function (e) {
  if (!CS.on || !CS.frame || e.source !== CS.frame.contentWindow) return;
  var d = e.data || {};
  csIdle();
  if (d.cytvCard === 'ready') return csSendCtx(true);
  var m = d.cytvSheet;
  if (m === 'targets') csTargets(d.targets, d.focus, d.back, d.tab, d.edges);
  else if (m === 'close') csClose();
  else if (m === 'option' && d.set && typeof d.set === 'object') {
    var el = csCardEl();
    if (!el || !el._card) return;
    api('/api/cards/options', { type: el._card.type, set: d.set }).then(
      function (r) {
        if (r && r.error) return toast(t(r.error), true);
        cfg.cards = r.cards || cfg.cards;
        var live = csCardEl();
        if (live && cfg.cards && cfg.cards[live._slot]) live._card = cfg.cards[live._slot];
        cardFeedAll();
        if (CS.on) csSendCtx(true);
      },
      function () {
        toast(t('The service did not answer.'), true);
      }
    );
  } else if (m === 'action' && typeof d.name === 'string') {
    var c = csCardEl(),
      pk = c && c._pk,
      named = false;
    if (!pk || (pk.drawer && pk.drawer.action === d.name) || (pk.settings && pk.settings.action === d.name)) return;
    (pk.actions || []).forEach(function (a) {
      if (a.name === d.name) named = true;
    });
    if (named) cardAction(c, d.name, typeof d.arg === 'string' ? d.arg.slice(0, 100) : '');
  }
});
