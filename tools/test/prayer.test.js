// Prayer times and adhkar (app/src/js/prayer.js): the five times of a day worked out from a place, the method and the Asr rule, the next
// prayer (and tomorrow's Fajr after Isha), the time left, the adhkar of the hour. prayer.js has no browser calls apart from Intl and the
// launcher's t(), LOC and clockOpts(), so it is loaded as it is. Times are compared as instants (UTC hours), so the TV's own time zone
// of the machine that runs the test does not matter.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

run(async () => {
  const sandbox = {
    Intl,
    Date,
    Math,
    String,
    isFinite,
    t: s => s,
    LOC: 'en-GB',
    clockOpts: () => ({ hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }),
    cfg: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'app', 'src', 'js', 'prayer.js'), 'utf8') + '\nthis.P = PRAYER; this.A = ADHKAR;',
    sandbox,
    { filename: 'prayer.js' }
  );
  const P = sandbox.P;
  const hours = d => d.getUTCHours() + d.getUTCMinutes() / 60;
  const near = (d, h, name) =>
    ok(Math.abs(hours(d) - h) <= 8 / 60, name + ' within 8 minutes of ' + h.toFixed(2) + ' UTC (got ' + hours(d).toFixed(2) + ')');

  // Riyadh on 1 November 2026 (UTC+3 there): Fajr 04:41, sunrise 06:00, Dhuhr 11:37, Asr 14:49, Maghrib 17:13, Isha 18:43 local
  const day = new Date(Date.UTC(2026, 10, 1, 12));
  const riyadh = { lat: 24.7136, lon: 46.6753, method: 'ummalqura' };
  const t = P.times(day, riyadh);
  ok(t && ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].every(k => t[k] instanceof Date), 'times gives the six times as Dates');
  near(t.fajr, 1.683, 'Riyadh Fajr');
  near(t.sunrise, 3.0, 'Riyadh sunrise');
  near(t.dhuhr, 8.617, 'Riyadh Dhuhr');
  near(t.asr, 11.817, 'Riyadh Asr');
  near(t.maghrib, 14.217, 'Riyadh Maghrib');
  near(t.isha, 15.717, 'Riyadh Isha');
  ok(
    t.fajr < t.sunrise && t.sunrise < t.dhuhr && t.dhuhr < t.asr && t.asr < t.maghrib && t.maghrib < t.isha,
    'the times of a day are in order'
  );
  ok(t.isha - t.maghrib === 90 * 60000, 'Umm al-Qura: Isha is 90 minutes after Maghrib outside Ramadan');

  // Ramadan: 120 minutes, when the browser has the Umm al-Qura calendar (a Node without full ICU has not)
  const ram = new Date(Date.UTC(2026, 2, 1, 12));
  let cal = false;
  try {
    cal = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric' }).format(ram) === '9';
  } catch (_) {}
  if (cal) {
    const r = P.times(ram, riyadh);
    ok(r.isha - r.maghrib === 120 * 60000, 'Umm al-Qura: Isha is 120 minutes after Maghrib in Ramadan');
    ok(P.ramadan(ram) === true && P.ramadan(day) === false, 'ramadan() knows Ramadan from other months');
  } else ok(P.ramadan(ram) === false, 'without the Umm al-Qura calendar ramadan() is false and does not throw');

  // another method and the Hanafi Asr
  const mwl = P.times(day, { lat: 24.7136, lon: 46.6753, method: 'mwl' });
  ok(mwl.fajr > t.fajr, 'the Muslim World League (18 degrees) starts Fajr later than Umm al-Qura (18.5)');
  const han = P.times(day, { lat: 24.7136, lon: 46.6753, asr: 'hanafi' });
  ok(han.asr > t.asr && han.asr - t.asr < 90 * 60000, 'the Hanafi Asr is later than the standard Asr');
  ok(P.times(day, { lat: '24.7136', lon: '46.6753' }).dhuhr.getTime() === t.dhuhr.getTime(), 'a place written as text works the same');

  // a place with no usable day, or no place
  ok(P.times(day, { lat: 78, lon: 15 }) === null, 'the polar north gives null instead of wrong times');
  ok(P.times(day, {}) === null && P.times(day, { lat: 'x', lon: 1 }) === null, 'no place gives null');

  // next(): the prayer after a moment, tomorrow's Fajr after Isha
  const before = new Date(t.dhuhr.getTime() - 60000);
  const n1 = P.next(before, riyadh);
  ok(n1.id === 'dhuhr' && n1.at.getTime() === t.dhuhr.getTime(), 'a minute before Dhuhr the next prayer is Dhuhr');
  ok(n1.prev.getTime() === t.fajr.getTime(), 'and the one before it is Fajr');
  const after = new Date(t.isha.getTime() + 60000);
  const n2 = P.next(after, riyadh);
  ok(n2.id === 'fajr' && n2.at > after && n2.at - after < 14 * 3600000, "after Isha the next prayer is tomorrow's Fajr");
  ok(P.next(day, { lat: 80, lon: 0 }) === null, 'next() is null where there are no times');

  // left(): minutes, or hours and minutes
  ok(P.left(25 * 60000) === '25' && P.left(85 * 60000) === '1:25' && P.left(60 * 60000) === '1:00', 'left() writes 25, 1:25 and 1:00');
  ok(P.left(-5000) === '0' && P.left(1) === '1', 'left() rounds up to the minute and never goes below 0');

  // adhkar: by hour of the day, a new one every few seconds, the same one for the same moment
  const names = { morning: sandbox.A.morning, evening: sandbox.A.evening };
  const inList = (list, s) => list.indexOf(s) >= 0;
  vm.runInContext('this.F = adhkarFor; this.G = adhkarAt;', sandbox);
  const F = sandbox.F,
    G = sandbox.G;
  ok(
    F(8).length === names.morning.length + sandbox.A.both.length + sandbox.A.any.length && inList(F(8), names.morning[0]),
    'before noon: the morning adhkar'
  );
  ok(inList(F(17), names.evening[0]) && !inList(F(17), names.morning[0]), 'from the afternoon: the evening adhkar, not the morning ones');
  ok(!inList(F(13), names.morning[0]) && !inList(F(13), names.evening[0]), 'at midday neither set, only the all-day adhkar');
  const m = new Date(2026, 10, 1, 9, 0, 0);
  ok(G(m, 30) === G(m, 30), 'the same moment gives the same dhikr');
  const seen = {};
  for (let i = 0; i < 40; i++) seen[G(new Date(m.getTime() + i * 30000), 30)] = true;
  ok(Object.keys(seen).length > 5, 'over twenty minutes at 30 s the dhikr changes through the list');
  ok(G(m, 1) === G(m, 10), 'a rotation faster than 10 seconds is held at 10');
  ok(
    Object.keys(sandbox.A).every(k => sandbox.A[k].every(s => typeof s === 'string' && s.length > 5 && /[؀-ۿ]/.test(s))),
    'every dhikr is Arabic text'
  );
});
