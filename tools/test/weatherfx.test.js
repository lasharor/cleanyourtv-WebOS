// The weather over the scene (app/src/js/weatherfx.js): which effect a weather code gets, and how the drops move. The file builds
// nothing until it is asked to draw, so it is loaded without a browser (as daynight.js is) and only its own maths is checked here.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

run(async () => {
  const sandbox = { window: {}, document: undefined, Math: Math, setTimeout: setTimeout, clearTimeout: clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'weatherfx.js'), 'utf8'), sandbox, {
    filename: 'weatherfx.js',
  });
  const FX = sandbox.WEATHERFX;

  // the codes are Open-Meteo's (WMO), the same ones a Home Assistant condition is mapped to in cards.js
  const want = {
    0: '',
    1: '',
    3: '',
    45: 'fog',
    48: 'fog',
    51: 'drizzle',
    55: 'drizzle',
    61: 'rain',
    65: 'rain',
    80: 'rain',
    82: 'rain',
    71: 'snow',
    75: 'snow',
    85: 'snow',
    86: 'snow',
    95: 'storm',
    99: 'storm',
  };
  const wrong = Object.keys(want).filter(c => FX.fxFor(+c) !== want[c]);
  ok(!wrong.length, 'every weather code gets its own effect, and a dry sky none: ' + (wrong.join(' ') || 'all as expected'));
  ok(
    FX.fxFor(undefined) === '' && FX.fxFor(null) === '' && FX.fxFor('') === '' && FX.fxFor(-1) === '' && FX.fxFor('rain') === '',
    'no weather, or something that is not a code, draws nothing'
  );

  // the drops start spread over the screen, so an effect does not begin with an empty sky
  const size = FX.size;
  let ps = FX.make('rain');
  ok(
    ps.length === FX.kinds.rain.n &&
      ps.every(p => p.x >= 0 && p.x <= size.w && p.y >= 0 && p.y <= size.h) &&
      ps.some(p => p.y < size.h / 2) &&
      ps.some(p => p.y > size.h / 2),
    'the drops of rain start spread over the whole screen: ' + ps.length
  );
  ok(FX.make('clear').length === 0 && FX.make('').length === 0, 'an effect that does not exist has no drops');

  // a frame of rain carries every drop down by its own speed, and the wind carries it along
  ps = [{ x: 100, y: 100, s: 1, ph: 0 }];
  FX.step(ps, 'rain', 0.1);
  ok(
    Math.abs(ps[0].y - (100 + FX.kinds.rain.vy * 0.1)) < 0.001 && Math.abs(ps[0].x - (100 + FX.kinds.rain.wind * 0.1)) < 0.001,
    'a frame carries the drop down its own speed and along with the wind: ' + JSON.stringify(ps[0])
  );
  // the nearer a drop is (s), the faster it falls, which is what gives the rain its depth
  const near = [{ x: 0, y: 0, s: 1.2, ph: 0 }],
    far = [{ x: 0, y: 0, s: 0.6, ph: 0 }];
  FX.step(near, 'rain', 0.5);
  FX.step(far, 'rain', 0.5);
  ok(near[0].y > far[0].y * 1.5, 'a drop that is nearer falls faster: ' + near[0].y + ' against ' + far[0].y);

  // a drop that reaches the bottom comes back in at the top, and one blown off the side comes back on the other
  ps = [{ x: 10, y: size.h - 1, s: 1, ph: 0 }];
  FX.step(ps, 'rain', 0.1);
  ok(ps[0].y < 0, 'a drop that leaves the bottom comes back in above the screen: ' + ps[0].y);
  ps = [{ x: size.w + 40, y: 10, s: 1, ph: 0 }];
  FX.step(ps, 'rain', 0.01);
  ok(ps[0].x < 0, 'and one carried off the right comes back on the left: ' + ps[0].x);

  // snow falls far slower than rain and drifts sideways as it falls
  const snow = [{ x: 200, y: 0, s: 1, ph: 0 }],
    rain = [{ x: 200, y: 0, s: 1, ph: 0 }];
  FX.step(snow, 'snow', 0.5);
  FX.step(rain, 'rain', 0.5);
  ok(snow[0].y < rain[0].y / 5, 'snow comes down far more slowly than rain: ' + snow[0].y + ' against ' + rain[0].y);
  const a = { x: 0, y: 0, s: 1, ph: 0 },
    b = { x: 0, y: 0, s: 1, ph: 1.57 };
  for (let i = 0; i < 4; i++) {
    FX.step([a], 'snow', 0.1);
    FX.step([b], 'snow', 0.1);
  }
  ok(Math.abs(a.x - b.x) > 0.5, 'two flakes drift apart instead of falling in step: ' + a.x + ' against ' + b.x);

  // a gap (Home was away, or the TV was busy) must not teleport the drops across the screen
  ps = [{ x: 0, y: 0, s: 1, ph: 0 }];
  FX.step(ps, 'rain', 30);
  ok(ps[0].y <= size.h, 'a long gap between frames does not throw a drop across the screen: ' + ps[0].y);

  // nothing is drawn and nothing is built while no effect is set, so a theme without it costs the TV nothing
  ok(FX.now() === '', 'no effect is on until one is set');
  FX.set('');
  ok(FX.now() === '', 'and setting none keeps it that way, without a canvas being made');
});
