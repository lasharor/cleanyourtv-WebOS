/* ---------- Day or night, for the scenes behind Home (scenes.js) ----------
   The scenes dimmed from 10 pm by the clock alone, so in December the sun was long down while the photo still stood in full daylight,
   and in June the dimming came on while it was still light outside. The same photo should simply look like the hour it is.
   What is asked, in this order, and why: the weather of the place the user picked for a weather card already says whether the sun is up
   there (Open-Meteo's is_day); it costs nothing and is already on the TV. Without it, the sun is worked out from that place's
   coordinates, which needs no network. Without a place, the clock decides, as it did before. A TV that knows nothing new therefore keeps
   exactly its old behaviour.
   Only function declarations here, so the file can be read in a test without a browser (as colour.js is). */

/* The hours the sun rises and sets, in hours of local time on that date, for a place; null above the polar circles on a day without a
   sunrise or a sunset, and for coordinates that are not a place. The hours are of that date and can fall outside 0 to 24 when the place
   is far from the TV's own time zone (a weather card for another part of the world), so read them around the clock. The usual
   astronomy: the day of the year gives the sun's declination
   and the equation of time, the latitude gives the hour angle of the horizon. It is a few minutes out at most, which is enough to dim a
   photograph by. */
function sunHours(date, lat, lon) {
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  var rad = Math.PI / 180;
  var start = Date.UTC(date.getFullYear(), 0, 0);
  var day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
  var g = (357.5291 + 0.98560028 * (day - 1)) * rad; /* the sun's mean anomaly */
  var l = 280.459 * rad + g + 1.915 * rad * Math.sin(g) + 0.02 * rad * Math.sin(2 * g); /* its place along the ecliptic */
  var dec = Math.asin(Math.sin(23.44 * rad) * Math.sin(l)); /* declination */
  /* the equation of time, in hours: the difference between the clock's sun and the real one */
  var eot = (-7.655 * Math.sin(g) + 9.873 * Math.sin(2 * l + 3.588 * rad)) / 60;
  var cos = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (cos > 1 || cos < -1) return null; /* the sun does not cross the horizon on this date */
  var half = Math.acos(cos) / rad / 15; /* half the day, in hours */
  var noon = 12 - lon / 15 - eot + -date.getTimezoneOffset() / 60; /* the sun at its highest, in the TV's own time */
  return { rise: noon - half, set: noon + half };
}

/* Where the sun stands now: {alt: how high it is in degrees, below zero when it is down; morning: true before its highest point}, or
   null for coordinates that are not a place. The scenes use it to pick the one that belongs to the hour. */
function sunPos(date, lat, lon) {
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  var rad = Math.PI / 180;
  var start = Date.UTC(date.getFullYear(), 0, 0);
  var day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
  var g = (357.5291 + 0.98560028 * (day - 1)) * rad;
  var l = 280.459 * rad + g + 1.915 * rad * Math.sin(g) + 0.02 * rad * Math.sin(2 * g);
  var dec = Math.asin(Math.sin(23.44 * rad) * Math.sin(l));
  var eot = (-7.655 * Math.sin(g) + 9.873 * Math.sin(2 * l + 3.588 * rad)) / 60;
  var utc = (date.getHours() + date.getMinutes() / 60 + date.getTimezoneOffset() / 60 + 24) % 24;
  var solar = (utc + lon / 15 + eot + 24) % 24; /* the sun's own time at that place */
  var hourAngle = (solar - 12) * 15 * rad;
  var alt = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(hourAngle)) / rad;
  return { alt: alt, morning: hourAngle < 0 };
}

/* Which part of the day it is, for the scene that belongs to it: 'day' while the sun is well up, 'dawn' and 'evening' around sunrise
   and sunset, 'dark' once it is down. o is as nightNow's. Without a place the clock gives the four parts, with the same hours the
   launcher has always used for its dark hours. */
function dayPart(o) {
  var date = (o && o.date) || new Date();
  var pos = o && sunPos(date, +o.lat, +o.lon);
  if (pos) {
    if (pos.alt >= 8) return 'day';
    if (pos.alt >= -10) return pos.morning ? 'dawn' : 'evening'; /* from the blue hour on: the twilight scenes belong here */
    return 'dark';
  }
  var h = date.getHours() + date.getMinutes() / 60;
  if (o && o.weatherDay === false) return 'dark';
  if (h >= 22 || h < 6) return 'dark';
  if (h < 8) return 'dawn';
  if (h < 19) return 'day';
  return 'evening';
}

/* Is it night now? o: {date, weatherDay (true, false or null: what the weather says), lat, lon (the place of the weather card, or
   nothing)}. The clock's own rule (dark from 10 pm to 6 am) is the last word, so this never answers nothing. */
function nightNow(o) {
  var date = (o && o.date) || new Date();
  if (o && (o.weatherDay === true || o.weatherDay === false)) return !o.weatherDay;
  var sun = o && sunHours(date, +o.lat, +o.lon);
  if (sun) {
    var hour = date.getHours() + date.getMinutes() / 60;
    var rise = ((sun.rise % 24) + 24) % 24,
      set = ((sun.set % 24) + 24) % 24; /* read around the clock: a place far from this time zone can rise or set past midnight */
    return rise <= set ? hour < rise || hour >= set : hour >= set && hour < rise;
  }
  var h = date.getHours();
  return h >= 22 || h < 6;
}
