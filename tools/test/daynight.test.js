// Day or night for the scenes and the wallpaper (app/src/js/daynight.js): sunHours() works out when the sun rises and sets at a place,
// nightNow() answers whether it is dark now from what the TV knows (the weather, else the place's coordinates, else the clock).
// daynight.js has only function declarations, so it is loaded as it is, without a browser (as colour.js is).
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

run(async () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'daynight.js'), 'utf8'), sandbox, {
    filename: 'daynight.js',
  });
  const { sunHours, sunPos, dayPart, nightNow } = sandbox;

  // the dates are in the TV's own time zone, and so are the hours sunHours gives back, so every hour here is compared in that zone:
  // off() is how far it is from UTC on that date, which keeps these checks true wherever the tests are run
  const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min || 0);
  const off = date => -date.getTimezoneOffset() / 60;
  const hm = x => Math.round(x * 60);

  // Greenwich, where the sun's own time is the clock's: the almanac gives 08:04 and 15:53 UTC on 15 December 2026, and 03:43 and
  // 20:21 on 21 June. A few minutes out is close enough to dim a photograph by.
  const near = (got, want, slack) => got !== null && Math.abs(hm(got) - hm(want)) <= (slack || 8);
  let d = at(2026, 12, 15, 12),
    s = sunHours(d, 51.48, 0);
  ok(near(s.rise - off(d), 8 + 4 / 60) && near(s.set - off(d), 15 + 53 / 60), 'the sun over Greenwich in December: ' + JSON.stringify(s));
  d = at(2026, 6, 21, 12);
  s = sunHours(d, 51.48, 0);
  ok(near(s.rise - off(d), 3 + 43 / 60) && near(s.set - off(d), 20 + 21 / 60), 'and in June: ' + JSON.stringify(s));
  // the longitude moves the whole day along: Moscow lies 37 degrees east, so its sun is about two and a half hours earlier
  const gr = sunHours(at(2026, 3, 20, 12), 55.75, 0),
    ms = sunHours(at(2026, 3, 20, 12), 55.75, 37.6);
  ok(near(gr.rise - ms.rise, 37.6 / 15, 10), 'the longitude moves sunrise along: ' + JSON.stringify([gr.rise, ms.rise]));
  // at the equinox the day is about twelve hours wherever you are
  ok(
    Math.abs(sunHours(at(2026, 3, 20, 12), 0, 0).set - sunHours(at(2026, 3, 20, 12), 0, 0).rise - 12) < 0.2 &&
      Math.abs(sunHours(at(2026, 3, 20, 12), 60, 0).set - sunHours(at(2026, 3, 20, 12), 60, 0).rise - 12) < 0.4,
    'the day lasts about twelve hours at the equinox, at the equator and far north'
  );
  // above the polar circle the sun does not cross the horizon, and coordinates that are not a place give nothing
  ok(sunHours(at(2026, 6, 21, 12), 78.2, 15.6) === null, 'no sunset in the polar summer');
  ok(sunHours(at(2026, 12, 21, 12), 78.2, 15.6) === null, 'and no sunrise in the polar winter');
  ok(
    sunHours(at(2026, 6, 21, 12), 91, 0) === null && sunHours(at(2026, 6, 21, 12), NaN, 5) === null,
    'coordinates that are not a place give nothing'
  );

  // what the weather says is the first word, whatever the clock says
  ok(
    nightNow({ date: at(2026, 12, 15, 23), weatherDay: true }) === false &&
      nightNow({ date: at(2026, 6, 21, 13), weatherDay: false }) === true,
    'the weather of the place decides: its is_day is followed even at an hour that looks otherwise'
  );
  // without the weather the sun is worked out from the place: in December it is dark at five in the afternoon, in June it is not
  // a place at the latitude of the Netherlands, on the meridian of whatever time zone the tests run in, so its hours are this
  // machine's hours (a weather card for the other side of the world is read around the clock, which the polar checks above cover)
  const dec = at(2026, 12, 15, 12),
    jun = at(2026, 6, 21, 12);
  const wrap = x => ((((x + 180) % 360) + 360) % 360) - 180; /* a time zone far east would land past the 180th meridian */
  const nl = { lat: 51.8, lon: wrap(off(jun) * 15) };
  const atHour = (date, h) =>
    Object.assign({ date: at(date.getFullYear(), date.getMonth() + 1, date.getDate(), 0, Math.round(h * 60)), weatherDay: null }, nl);
  const inDay = x => ((x % 24) + 24) % 24; /* a synthetic place past the date line gives hours beyond the day: read them around */
  const decSun = sunHours(dec, nl.lat, nl.lon),
    junSun = sunHours(jun, nl.lat, nl.lon);
  ok(
    nightNow(atHour(dec, decSun.set + 0.5)) === true && inDay(decSun.set) < 17,
    'without the weather, a December evening is dark well before ten (the clock alone kept it in daylight): sunset ' + decSun.set
  );
  ok(
    nightNow(atHour(jun, junSun.set - 0.5)) === false && inDay(junSun.set) > 19.8,
    'and a June evening is not dark yet while the sun is up: sunset ' + junSun.set
  );
  ok(
    nightNow(atHour(jun, junSun.rise - 1)) === true && nightNow(atHour(jun, 12)) === false,
    'the middle of the night is dark and the middle of the day is not'
  );
  // without a place at all, the clock decides, exactly as the launcher did before
  const clock = h => nightNow({ date: at(2026, 12, 15, h), weatherDay: null, lat: NaN, lon: NaN });
  ok(
    clock(23) === true && clock(3) === true && clock(6) === false && clock(21) === false,
    'without a place the clock decides: dark from 10 pm to 6 am, as before'
  );
  ok(nightNow({}) === (new Date().getHours() >= 22 || new Date().getHours() < 6), 'and nothing at all still answers');
  // where the sun stands, for the landscape that belongs to the hour
  const high = sunPos(at(2026, 6, 21, 12), nl.lat, nl.lon);
  ok(high && Math.round(high.alt) > 55, 'the midsummer sun stands high at noon: ' + Math.round(high.alt));
  const low = sunPos(at(2026, 12, 15, 12), nl.lat, wrap(off(dec) * 15));
  ok(low && Math.round(low.alt) > 10 && Math.round(low.alt) < 20, 'and low in December: ' + Math.round(low.alt));
  ok(sunPos(at(2026, 6, 21, 1), nl.lat, nl.lon).alt < 0, 'at one in the morning it is under the horizon');
  ok(
    sunPos(at(2026, 6, 21, 8), nl.lat, nl.lon).morning === true && sunPos(at(2026, 6, 21, 17), nl.lat, nl.lon).morning === false,
    'and the morning is told from the evening'
  );
  ok(sunPos(at(2026, 6, 21, 12), 95, 0) === null, 'coordinates that are not a place give nothing here either');

  // the parts of the day the five landscapes belong to
  const part = (date, h) =>
    dayPart(Object.assign({ date: at(date.getFullYear(), date.getMonth() + 1, date.getDate(), 0, Math.round(h * 60)) }, nl));
  ok(part(jun, 12) === 'day' && part(dec, 12) === 'day', 'the middle of the day is day, in summer and in winter');
  ok(part(jun, 1) === 'dark' && part(dec, 23) === 'dark', 'the middle of the night is dark');
  ok(
    part(dec, decSun.set + 0.3) === 'evening' && part(dec, decSun.rise - 0.3) === 'dawn',
    'around sunset it is evening and around sunrise it is dawn, which are not the same scene: ' +
      [part(dec, decSun.set + 0.3), part(dec, decSun.rise - 0.3)].join(' ')
  );
  ok(
    part(jun, junSun.set + 0.3) === 'evening' && part(jun, junSun.set + 3) === 'dark',
    'in June the evening lasts until the sun is well down'
  );
  // without a place the clock gives the four parts
  const byClock = h => dayPart({ date: at(2026, 12, 15, h), lat: NaN, lon: NaN });
  ok(
    byClock(23) === 'dark' && byClock(7) === 'dawn' && byClock(12) === 'day' && byClock(20) === 'evening',
    'without a place the clock gives the four parts: ' + [byClock(23), byClock(7), byClock(12), byClock(20)].join(' ')
  );
  ok(dayPart({ date: at(2026, 6, 21, 13), weatherDay: false, lat: NaN, lon: NaN }) === 'dark', 'and the weather still wins over it');
});
