/* ---------- Live TV ----------
   Live TV is a page of the book (addons.js): the page of the bundled iptv add-on (helper/addons-bundled/iptv). This object keeps
   the calls the rest of the launcher makes (enter, exit, key, resume, toggleGuide) and passes them on. */
var LIVE_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 130"><rect width="130" height="130" fill="#ef4f5f"/><rect x="25" y="36" width="80" height="54" rx="13" fill="none" stroke="#fff" stroke-width="8"/><path d="M58 52 L58 74 L77 63 Z" fill="#fff"/><path d="M48 104 H82" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>'
  );
var LIVE = {
  get on() {
    return PAGER.on && PAGER.id === 'iptv';
  },
  enter: function (guide) {
    PAGER.go('iptv', guide ? { guide: 1 } : null);
  },
  exit: function () {
    if (LIVE.on) PAGER.home();
  },
  resume: function () {
    if (LIVE.on) PAGER.send({ cytv: 'resume' });
  },
  toggleGuide: function () {
    if (LIVE.on) PAGER.send({ cytv: 'guide' });
  },
  key: function (e) {
    PAGER.key(e);
  },
};
