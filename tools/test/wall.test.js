// Home's wallpapers (app/src/js/wall.js): opening Home changes the photo only when the interval has passed since the last change
// (every time with "Each time Home opens"), the interval timer keeps running, and a photo that fails to load is skipped
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

function layerEl() {
  const el = { style: {}, id: '', className: '', parentNode: null };
  el.classList = { add() {}, remove() {} };
  return el;
}

function make(cfg, photos) {
  let now = 1000000;
  const shown = [],
    intervals = [];
  const holder = { insertBefore() {} };
  const els = {};
  const context = {
    cfg,
    API: 'http://tv',
    Date: { now: () => now },
    Math,
    String,
    Number,
    $: id => (id === 'gA' ? { parentNode: holder } : id === 'homepage' ? { appendChild() {} } : els[id] || null),
    api: () => ({ then: f => f({ photos }) }),
    setInterval: fn => intervals.push(fn) && intervals.length,
    clearInterval() {},
    Image: function () {
      const im = this;
      Object.defineProperty(im, 'src', {
        set(v) {
          shown.push(v);
          if (im.onload) im.onload();
        },
      });
    },
    document: {
      createElement: () => layerEl(),
      body: { classList: { add() {}, remove() {} } },
    },
  };
  context.cfg.wallpapers = { stamp: '1:1' };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'wall.js'), 'utf8'), context);
  return { WALL: vm.runInContext('WALL', context), shown, intervals, tick: ms => (now += ms) };
}

run(async () => {
  const photos = ['a', 'b', 'c'];

  // an interval of 15 minutes: Home opening again within that time keeps the photo on screen
  let w = make({ wall: { on: true, secs: 900 } }, photos);
  w.WALL.sync();
  ok(w.shown.length === 1, 'the first photo is shown when the wallpapers load');
  w.tick(60000);
  w.WALL.shown();
  ok(w.shown.length === 1, 'opening Home after 1 minute with a 15 minute interval keeps the photo');
  w.tick(900000);
  w.WALL.shown();
  ok(w.shown.length === 2, 'opening Home after the interval has passed shows a new photo');
  ok(w.intervals.length >= 2, 'the interval timer is armed again each time Home opens');

  // "Each time Home opens" (0 seconds): a new photo every time
  w = make({ wall: { on: true, secs: 0 } }, photos);
  w.WALL.sync();
  w.tick(1000);
  w.WALL.shown();
  w.tick(1000);
  w.WALL.shown();
  ok(w.shown.length === 3, 'with "Each time Home opens" every opening shows a new photo');

  // the clock set back: do not wait for a time that will not come
  w = make({ wall: { on: true, secs: 900 } }, photos);
  w.WALL.sync();
  w.tick(-3600000);
  w.WALL.shown();
  ok(w.shown.length === 2, 'a clock set back does not hold the photo for good');

  // off: nothing is shown
  w = make({ wall: { on: false, secs: 900 } }, photos);
  w.WALL.sync();
  w.WALL.shown();
  ok(w.shown.length === 0, 'with Wallpapers off no photo is asked for');
});
