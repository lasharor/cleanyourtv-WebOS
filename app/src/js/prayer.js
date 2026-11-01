/* ---------- Prayer times and adhkar for the prayer card, the adhkar card and the screen saver (cards.js, saver.js).
   The times are worked out on the TV from the place (latitude and longitude of a card's place) and the date, so they need no network
   and no account. The method is the usual one for a region (the angles of the sun for Fajr and Isha); the times can differ by a minute
   or two from a mosque's timetable, which is why a card can be checked against it. ES5, nothing newer than Chromium 68. ---------- */
var PRAYER = (function () {
  var RAD = Math.PI / 180;
  /* method: the sun's angle below the horizon at Fajr, and at Isha either an angle or minutes after Maghrib */
  var METHODS = {
    ummalqura: { fajr: 18.5, ishaMin: 90, ishaRamadan: 120 } /* Umm al-Qura (Makkah): the Gulf */,
    mwl: { fajr: 18, isha: 17 } /* Muslim World League: Europe, the Far East */,
    isna: { fajr: 15, isha: 15 } /* North America */,
    egypt: { fajr: 19.5, isha: 17.5 } /* Egyptian General Authority of Survey */,
    karachi: { fajr: 18, isha: 18 } /* University of Islamic Sciences, Karachi */,
  };
  function sin(d) {
    return Math.sin(d * RAD);
  }
  function cos(d) {
    return Math.cos(d * RAD);
  }
  function tan(d) {
    return Math.tan(d * RAD);
  }
  function fixHour(h) {
    h = h - 24 * Math.floor(h / 24);
    return h < 0 ? h + 24 : h;
  }
  function fixAngle(a) {
    a = a - 360 * Math.floor(a / 360);
    return a < 0 ? a + 360 : a;
  }
  /* the sun on a day: its declination and the equation of time (hours), after the Astronomical Almanac's low-precision formulas */
  function sun(y, m, d) {
    var jd = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5,
      n = jd - 2451545.0,
      g = fixAngle(357.529 + 0.98560028 * n),
      q = fixAngle(280.459 + 0.98564736 * n),
      L = fixAngle(q + 1.915 * sin(g) + 0.02 * sin(2 * g)),
      e = 23.439 - 0.00000036 * n,
      ra = Math.atan2(cos(e) * sin(L), cos(L)) / RAD / 15;
    return { decl: Math.asin(sin(e) * sin(L)) / RAD, eqt: q / 15 - fixHour(ra) };
  }
  /* hours between the sun at noon and the sun at an angle below (negative: above) the horizon; NaN when it never gets there */
  function hourAngle(angle, lat, decl) {
    var x = (-sin(angle) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
    return x > 1 || x < -1 ? NaN : Math.acos(x) / RAD / 15;
  }
  function asrAngle(factor, lat, decl) {
    var a = Math.atan(1 / (factor + tan(Math.abs(lat - decl)))) / RAD;
    return hourAngle(-a, lat, decl) /* the sun is at a degrees above the horizon */;
  }
  /* is it Ramadan (Umm al-Qura's Isha is 120 minutes after Maghrib then)? asked of the calendar the browser has; false when it has none */
  function ramadan(date) {
    try {
      return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric' }).format(date) === '9';
    } catch (e) {
      return false;
    }
  }
  /* the five prayers and the sunrise of a day at a place, as Dates: {fajr, sunrise, dhuhr, asr, maghrib, isha}, or null when the place has
     no usable day (the polar summer) or its numbers are wrong. o: {lat, lon, method, asr: 'hanafi'}. The day is the TV's date. The times are
     worked out as hours from noon in UTC of that date and become exact moments, so a change of the clock (summer time) that day cannot
     shift them. */
  function times(date, o) {
    var lat = +o.lat,
      lon = +o.lon;
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 66 || Math.abs(lon) > 180) return null;
    var M = METHODS[o.method] || METHODS.ummalqura,
      y = date.getFullYear(),
      m = date.getMonth() + 1,
      d = date.getDate(),
      s = sun(y, m, d),
      base = Date.UTC(y, m - 1, d, 12),
      noon = -lon / 15 - s.eqt /* the sun is highest this many hours after (before) 12:00 UTC */,
      fajr = noon - hourAngle(M.fajr, lat, s.decl),
      rise = noon - hourAngle(0.833, lat, s.decl),
      asr = noon + asrAngle(o.asr === 'hanafi' ? 2 : 1, lat, s.decl),
      set = noon + hourAngle(0.833, lat, s.decl),
      isha = M.ishaMin ? set + (ramadan(date) ? M.ishaRamadan : M.ishaMin) / 60 : noon + hourAngle(M.isha, lat, s.decl),
      at = function (h) {
        return new Date(base + Math.round(h * 60) * 60000);
      },
      list = [fajr, rise, noon, asr, set, isha];
    for (var i = 0; i < list.length; i++) if (!isFinite(list[i])) return null;
    return { fajr: at(fajr), sunrise: at(rise), dhuhr: at(noon), asr: at(asr), maghrib: at(set), isha: at(isha) };
  }
  var ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  /* the prayer that comes next after `now`: {id, at: Date, prev: Date or null (the one before it)}; after Isha it is tomorrow's Fajr */
  function next(now, o) {
    var today = times(now, o);
    if (!today) return null;
    for (var i = 0; i < ORDER.length; i++)
      if (today[ORDER[i]] > now) return { id: ORDER[i], at: today[ORDER[i]], prev: i ? today[ORDER[i - 1]] : null, times: today };
    var tomorrow = times(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12), o);
    return tomorrow ? { id: 'fajr', at: tomorrow.fajr, prev: today.isha, times: today } : null;
  }
  /* "1:25" for an hour and 25 minutes, "25" for 25 minutes: what is left until a time, rounded up to the minute */
  function left(ms) {
    var m = Math.max(0, Math.ceil(ms / 60000)),
      h = Math.floor(m / 60);
    m = m % 60;
    return h ? h + ':' + (m < 10 ? '0' : '') + m : String(m);
  }
  return { METHODS: METHODS, ORDER: ORDER, times: times, next: next, left: left, ramadan: ramadan };
})();

/* ---------- adhkar: short remembrances from the Qur'an and the Sunnah, shown one at a time. Kept as plain text so they can be checked and
   changed in one place: the morning ones until noon, the evening ones from the afternoon, the rest all day. ---------- */
var ADHKAR = {
  any: [
    'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ',
    'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',
    'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ',
    'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ',
    'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ',
    'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ',
  ],
  morning: [
    'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ',
    'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ',
  ],
  evening: [
    'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ',
    'اللَّهُمَّ بِكَ أَمْسَيْنَا، وَبِكَ أَصْبَحْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ الْمَصِيرُ',
    'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',
  ],
  both: [
    'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
    'رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ نَبِيًّا',
    'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ',
  ],
};
/* the list for an hour of the day: the morning ones until noon, the evening ones from three o'clock, with the all-day ones among them */
function adhkarFor(hour) {
  var part = hour < 12 ? ADHKAR.morning : hour >= 15 ? ADHKAR.evening : [];
  return part.concat(ADHKAR.both, ADHKAR.any);
}
/* one remembrance for a moment: it changes every `secs` seconds (at least 10), the same one on every card and the saver at once */
function adhkarAt(now, secs) {
  var list = adhkarFor(now.getHours()),
    n = Math.floor(now.getTime() / (Math.max(10, +secs || 30) * 1000));
  return list[n % list.length];
}

/* ---------- what the cards and the saver show of it ---------- */
/* a card with a place (latitude and longitude from the phone page) can work out times */
function prayerReady(o) {
  return !!o && o.lat !== undefined && o.lon !== undefined && o.lat !== '' && o.lon !== '' && isFinite(+o.lat) && isFinite(+o.lon);
}
function prayerName(id) {
  var N = {
    fajr: t('Fajr'),
    sunrise: t('Sunrise'),
    dhuhr: t('Dhuhr'),
    asr: t('Asr'),
    maghrib: t('Maghrib'),
    isha: t('Isha'),
  };
  return N[id] || id;
}
/* a time as the clock shows it (12 or 24 hours, the launcher's language) */
function prayerClock(d) {
  try {
    return d.toLocaleTimeString(LOC, clockOpts());
  } catch (e) {
    return '';
  }
}
/* "in 1:25 h" or "in 25 min": the time left until the next prayer */
function prayerLeft(ms) {
  var s = PRAYER.left(ms);
  return (s.indexOf(':') > 0 ? t('in %s h') : t('in %s min')).replace('%s', s);
}
/* today in the Islamic calendar (Umm al-Qura), in the launcher's language; '' where the browser has no such calendar */
function hijriText() {
  try {
    return new Date().toLocaleDateString(String(LOC).split('-u-')[0] + '-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch (e) {
    return '';
  }
}
/* the place for the screen saver's prayer line: the first prayer card that has one */
function prayerOpts() {
  var cs = cfg.cards || {},
    k;
  for (k in cs) if (cs[k] && cs[k].type === 'prayer' && prayerReady(cs[k])) return cs[k];
  return null;
}
