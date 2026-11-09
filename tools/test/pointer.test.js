// The Magic Remote on the launcher (app/src/js/menus.js): hoverDir() says when hovering a menu row scrolls the list, and homeStep() moves
// the focus on the home screen one tile per wheel notch, in reading order. menus.js starts listeners when it loads, so the two functions
// are cut out of it as they are and run with a stand-in for the focus (rows, r, c and setFocus of the launcher).
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

// the source of one top-level function, from "function name(" to its closing brace
function source(js, name) {
  const start = js.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let depth = 0;
  for (let i = js.indexOf('{', start); i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
  }
  return '';
}

run(async () => {
  const js = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'menus.js'), 'utf8');
  const theme = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'theme.js'), 'utf8');
  const homeCss = fs.readFileSync(path.join(root, 'app', 'src', 'css', 'home.css'), 'utf8');

  // ---- hovering a menu row ----
  const hv = {};
  vm.runInNewContext(source(js, 'hoverDir'), hv, { filename: 'hoverDir' });
  ok(typeof hv.hoverDir === 'function', 'menus.js has hoverDir');
  ok(hv.hoverDir(3, 0, 8, 20) === 0, 'hovering a row in the middle does not scroll');
  ok(hv.hoverDir(7, 0, 8, 20) === 1, 'hovering the last visible row scrolls down by one when there are more below');
  ok(hv.hoverDir(15, 8, 8, 20) === 1, 'also when the window is not at the top');
  ok(hv.hoverDir(19, 12, 8, 20) === 0, 'the last visible row of the last window does not scroll');
  ok(hv.hoverDir(5, 5, 8, 20) === -1, 'hovering the first visible row scrolls up by one when there are more above');
  ok(hv.hoverDir(0, 0, 8, 20) === 0, 'the first visible row of the first window does not scroll');
  ok(hv.hoverDir(6, 0, 8, 7) === 0, 'a list shorter than the window never scrolls');
  ok(hv.hoverDir(7, 0, 8, 8) === 0, 'a list as long as the window never scrolls');

  // ---- the wheel on the home screen ----
  const calls = [];
  const sb = {
    rows: [],
    r: 1,
    c: 0,
    setFocus(nr, nc) {
      calls.push([nr, nc]);
      sb.r = nr;
      sb.c = nc;
    },
  };
  vm.createContext(sb);
  vm.runInContext(source(js, 'homeStep'), sb, { filename: 'homeStep' });
  ok(typeof sb.homeStep === 'function', 'menus.js has homeStep');
  const tiles = (n, p) => Array.from({ length: n }, (_, i) => p + i);
  const top = tiles(4, 't'),
    dock = tiles(2, 'd');
  const withDock = () => [top, dock, tiles(10, 'g'), tiles(1, 'h')];
  function step(rows, r, c, dir) {
    sb.rows = rows;
    sb.r = r;
    sb.c = c;
    calls.length = 0;
    sb.homeStep(dir);
    return calls.length ? calls[calls.length - 1] : null;
  }
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  ok(eq(step(withDock(), 1, 0, 1), [1, 1]), 'a notch down goes to the next tile of the dock');
  ok(eq(step(withDock(), 1, 1, 1), [2, 0]), 'at the end of the dock it continues on the first grid row');
  ok(eq(step(withDock(), 2, 4, 1), [2, 5]), 'in the grid it goes to the next tile of the row');
  ok(eq(step(withDock(), 2, 9, 1), [3, 0]), 'at the end of a grid row it continues on the next row');
  ok(step(withDock(), 3, 0, 1) === null, 'at the last tile a notch down does nothing');
  ok(eq(step(withDock(), 3, 0, -1), [2, 9]), 'a notch up from the start of a row goes to the end of the row above');
  ok(eq(step(withDock(), 2, 0, -1), [1, 1]), 'from the first grid tile it goes back to the end of the dock');
  ok(eq(step(withDock(), 1, 1, -1), [1, 0]), 'a notch up goes to the previous tile of the dock');
  ok(step(withDock(), 1, 0, -1) === null, 'at the first tile a notch up does nothing');
  ok(eq(step(withDock(), 0, 2, 1), [1, 0]), 'from the top buttons a notch down goes to the first tile');
  ok(step(withDock(), 0, 2, -1) === null, 'from the top buttons a notch up does nothing');

  // without a dock row 1 is the row of buttons again: the tiles start at row 2
  const noDock = () => [top, top, tiles(10, 'g'), tiles(3, 'h')];
  ok(step(noDock(), 2, 0, -1) === null, 'without a dock the first grid tile is the first tile (not the buttons)');
  ok(eq(step(noDock(), 0, 1, 1), [2, 0]), 'without a dock, from the top buttons a notch down goes to the first grid tile');
  ok(eq(step(noDock(), 2, 9, 1), [3, 0]), 'without a dock a grid row still continues on the next');

  // a whole walk: every tile once, in order, then back, and the ends hold
  sb.rows = withDock();
  sb.r = 1;
  sb.c = 0;
  const seen = ['1,0'];
  for (let i = 0; i < 20; i++) {
    const before = sb.r + ',' + sb.c;
    sb.homeStep(1);
    if (sb.r + ',' + sb.c !== before) seen.push(sb.r + ',' + sb.c);
  }
  ok(seen.length === 13 && seen[12] === '3,0', 'twenty notches down visit all 13 tiles once and stop at the last (' + seen.length + ')');
  const back = [];
  for (let i = 0; i < 20; i++) {
    const before = sb.r + ',' + sb.c;
    sb.homeStep(-1);
    if (sb.r + ',' + sb.c !== before) back.push(sb.r + ',' + sb.c);
  }
  ok(back.length === 12 && sb.r === 1 && sb.c === 0, 'twenty notches up go back through every tile and stop at the first');
  ok(back[0] === seen[11], 'the way back starts at the tile before the last');

  // ---- the pointer on the home screen (input.js pointerMoved): when a move of the cursor may move the focus ----
  const inp = fs.readFileSync(path.join(root, 'app', 'src', 'js', 'input.js'), 'utf8');
  const pm = { lastMX: -1, lastMY: -1, pointerLive: false };
  vm.createContext(pm);
  vm.runInContext(source(inp, 'pointerMoved'), pm, { filename: 'pointerMoved' });
  ok(typeof pm.pointerMoved === 'function', 'input.js has pointerMoved');
  ok(pm.pointerMoved(500, 500) === false && pm.lastMX === 500, 'the first move only notes where the cursor is');
  ok(pm.pointerMoved(510, 505) === false, 'a jitter under 24 px does nothing (the remote picked up)');
  ok(pm.pointerMoved(530, 505) === true, 'a real move of 24 px or more moves the focus');
  ok(pm.pointerMoved(536, 505) === true, 'after that a move of 6 px counts, so a cursor coming to rest over a tile focuses it');
  ok(pm.pointerMoved(538, 506) === false, 'a move under 4 px still does nothing');
  pm.pointerLive = false; // a button was pressed
  ok(pm.pointerMoved(546, 506) === false, 'after a button press a small move does nothing again');

  // ---- the pointer showing again (input.js pointerShow): where it shows comes with the next move, which focuses what is under it ----
  const ps = { lastMX: 120, lastMY: 980, pointerLive: true, cursorEvents: false, pointerShown: true, pointerShownAt: 0 };
  vm.createContext(ps);
  vm.runInContext(source(inp, 'pointerShow') + ';' + source(inp, 'pointerMoved'), ps, { filename: 'pointerShow' });
  ok(typeof ps.pointerShow === 'function', 'input.js has pointerShow');
  ps.pointerLive = false; // the pointer was over the dock (120,980) and a button was pressed
  ps.pointerShow(false);
  ok(ps.pointerShown === false && ps.cursorEvents === true, 'the pointer hides');
  ps.pointerShow(true);
  ok(ps.pointerShown === true && ps.pointerShownAt > 0 && ps.pointerLive === true, 'it shows again');
  ok(
    ps.pointerMoved(960, 540) === true && ps.lastMX === 960 && ps.lastMY === 540,
    'it shows in the middle (LG G5), not where it hid: that first move focuses what is under it there'
  );
  ok(ps.pointerMoved(962, 541) === false && ps.pointerMoved(966, 541) === true, 'after that a move of 4 px or more counts');
  ps.lastMX = 958; // it hid 2 px from the middle
  ps.lastMY = 540;
  ps.pointerLive = false;
  ps.pointerShow(true);
  ok(ps.pointerMoved(960, 540) === true, 'the first move after it shows counts at any distance');

  // ---- the wheel on Home (menus.js wheelHome): the notch that brings the hidden pointer back does not move the focus ----
  const wh = { cursorEvents: true, pointerShown: false, pointerShownAt: 0, steps: [], homeStep: d => wh.steps.push(d) };
  vm.createContext(wh);
  vm.runInContext(source(js, 'wheelHome'), wh, { filename: 'wheelHome' });
  ok(
    wh.wheelHome(1) === true && wh.steps.join() === '1',
    'a notch while the pointer stays hidden moves one tile (a TV whose wheel does not show it)'
  );
  wh.pointerShown = true;
  wh.pointerShownAt = Date.now() - 30; // the pointer showed 30 ms ago: this is the notch that showed it
  ok(
    wh.wheelHome(1) === false && wh.steps.join() === '1' && wh.pointerShownAt === 0,
    'the notch right after the pointer shows does not move'
  );
  ok(wh.wheelHome(1) === true && wh.wheelHome(-1) === true && wh.steps.join() === '1,1,-1', 'while it shows, each notch moves one tile');
  wh.pointerShownAt = Date.now() - 900;
  ok(wh.wheelHome(1) === true, 'a notch long after the pointer showed moves');
  wh.cursorEvents = false;
  wh.pointerShown = false;
  ok(wh.wheelHome(1) === true, 'a TV without pointer events: every notch moves, as before');

  // ---- crossing the empty vertical edge with the Magic Remote ----
  const pcalls = [],
    box = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) }),
    edge = {
      TH: { push: {} },
      rows: [
        [box(0, 50)],
        [box(500, 710), box(500, 710), box(500, 710), box(500, 710)],
        [box(760, 970), box(760, 970)],
        [box(1020, 1230), box(1020, 1230), box(1020, 1230)],
      ],
      r: 1,
      c: 2,
      pointerEdgeFocus: false,
      $(id) {
        return id === 'dock' ? box(500, 710) : null;
      },
      mapCol(from, to, col) {
        return from > 1 ? Math.round((col * (to - 1)) / (from - 1)) : 0;
      },
      setFocus(nr, nc) {
        pcalls.push([nr, nc]);
        edge.r = nr;
        edge.c = nc;
      },
    };
  vm.createContext(edge);
  vm.runInContext(source(inp, 'pointerRowMove'), edge, { filename: 'pointerRowMove' });
  ok(
    edge.pointerRowMove({ clientY: 730 }, 30) === true && JSON.stringify(pcalls[0]) === '[2,1]',
    'pointer down past the dock opens the first app row'
  );
  ok(
    edge.pointerRowMove({ clientY: 990 }, 30) === true && JSON.stringify(pcalls[1]) === '[3,2]',
    'pointer down past an app row advances to the next row'
  );
  ok(
    edge.pointerRowMove({ clientY: 990 }, -30) === true && JSON.stringify(pcalls[2]) === '[2,1]',
    'pointer up above a lower app row returns to the previous app row'
  );
  ok(
    edge.pointerRowMove({ clientY: 730 }, -30) === true && JSON.stringify(pcalls[3]) === '[1,3]',
    'pointer up above the first app row returns to the dock'
  );

  // ---- clicking after an edge crossing: the cursor is still in empty space, but the Magic Remote click opens the focused tile ----
  const opened = [],
    click = {
      pointerEdgeFocus: true,
      stack: [],
      LIVE: { on: false },
      PAGER: { on: false },
      CS: { on: false },
      moving: false,
      rows: [[0], ['dock'], ['app']],
      r: 2,
      c: 0,
      act: el => opened.push(el),
    };
  vm.createContext(click);
  vm.runInContext(source(inp, 'pointerEdgeClick'), click, { filename: 'pointerEdgeClick' });
  let prevented = false;
  ok(
    click.pointerEdgeClick({ target: {}, preventDefault: () => (prevented = true) }) === true &&
      opened.join() === 'app' &&
      prevented &&
      click.pointerEdgeFocus === false,
    'a blank Magic Remote click after crossing an edge opens the focused app once'
  );
  click.pointerEdgeFocus = true;
  ok(
    click.pointerEdgeClick({ target: { closest: () => 'tile' }, preventDefault() {} }) === false && opened.length === 1,
    'a click that lands on a real tile is left to that tile'
  );

  // ---- a real remote key cancels the one blank click that belongs to pointer edge focus ----
  const key = {
    pointerEdgeFocus: true,
    lastKey: 0,
    pointerLive: true,
    Date: { now: () => 1234 },
  };
  vm.createContext(key);
  vm.runInContext(source(inp, 'pointerKeyPress'), key, { filename: 'pointerKeyPress' });
  key.pointerKeyPress(40);
  ok(
    key.pointerEdgeFocus === false && key.lastKey === 1234 && key.pointerLive === false,
    'a remote key clears pointer edge focus and records ordinary key input'
  );
  key.pointerEdgeFocus = true;
  key.pointerKeyPress(1536);
  ok(key.pointerEdgeFocus === true, 'the pointer-show event is not treated as a remote key press');

  const focusRule = homeCss.match(/\[data-theme="moon"\] #tile-focus \{([\s\S]*?)\n\}/);
  ok(
    focusRule &&
      /transition:\s*transform/.test(focusRule[1]) &&
      /opacity calc/.test(focusRule[1]) &&
      !/(width|height|border-radius) calc/.test(focusRule[1]),
    'the Moon focus frame animates only transform and opacity'
  );

  // ---- Moon's shared focus frame follows the selected tile without becoming another target ----
  const made = [],
    scroll = {
      appendChild(el) {
        made.push(el);
      },
      getBoundingClientRect: () => ({ left: 100, top: 50 }),
    },
    dockEl = { offsetLeft: 0, offsetTop: 0 },
    gridEl = { offsetLeft: 0, offsetTop: 0 },
    focused = {
      parentNode: gridEl,
      offsetWidth: 405,
      offsetHeight: 210,
      offsetLeft: 128,
      offsetTop: 259,
      style: { getPropertyValue: name => (name === '--c' ? '18,132,224' : '') },
      getBoundingClientRect: () => ({ left: 218, top: 304, width: 405, height: 210 }),
    },
    moon = {
      document: {
        body: { getAttribute: () => 'moon' },
        createElement: () => ({
          style: {
            setProperty(name, value) {
              this[name] = value;
            },
          },
        }),
      },
      window: {
        getComputedStyle: () => ({
          borderRadius: '34px',
          getPropertyValue: name =>
            name === '--grid-fs' ? '1.05' : name === '--dock-fs' ? '1.06' : name === '--dock-lift' ? '-14px' : '0',
        }),
      },
      $(id) {
        if (id === 'scroll') return scroll;
        if (id === 'dock') return dockEl;
        if (id === 'grid') return gridEl;
        if (id === 'tile-focus') return made[0] || null;
        return null;
      },
    };
  vm.createContext(moon);
  vm.runInContext(source(theme, 'moonTileFocus'), moon, { filename: 'moonTileFocus' });
  moon.moonTileFocus(focused);
  ok(
    made.length === 1 &&
      made[0].id === 'tile-focus' &&
      made[0].style.width === '433px' &&
      made[0].style.height === '229px' &&
      made[0].style.borderRadius === '40px' &&
      made[0].style['--focus-c'] === '18,132,224' &&
      made[0].style.transform === 'translate(104px,245px)' &&
      made[0].style.opacity === '1',
    "Moon fits one glass frame to the app's rendered box and uses the icon's colour"
  );
  focused.parentNode = dockEl;
  moon.moonTileFocus(focused);
  ok(
    made[0].style.width === '437px' &&
      made[0].style.height === '231px' &&
      made[0].style.borderRadius === '40px' &&
      made[0].style.transform === 'translate(102px,230px)',
    'the Moon dock frame uses the final lift and scale even while the tile is still animating'
  );
  moon.document.body.getAttribute = () => 'classic';
  moon.moonTileFocus(focused);
  ok(made.length === 1 && made[0].style.opacity === '0', 'another theme hides the shared frame and keeps its ordinary focus ring');
});
