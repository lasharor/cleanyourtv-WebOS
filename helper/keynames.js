// Names of the remote's buttons, for the Key remapping screen ("Prime Video button" instead of "Button 1038").
// The TV's input service (lginput2) writes a line to the system log for every press, with LG's own key name:
//   lginput2 NL_BUTTON_CLICK {"remote_type":"LGE MR23","button_type":"KEY_AMAZON"}
// The key hook (inputhook.js) only reports a number. A learned number is named from that log line, or from a code seen on a real TV
// (CODES). The names LG knows are the KEY_ strings inside /usr/sbin/lginput2 (234 on webOS 10.3: `grep -a -o 'KEY_[A-Z0-9_]*' /usr/sbin/lginput2`);
// LABELS turns the useful ones into text, any other name is spelled out from the name itself. A name is only ever a label: the code is what the
// hook binds, so a wrong or missing name never changes what a button does.
const fs = require('fs');
const P = require('./paths');

const LABELS = {
  // streaming and app keys
  KEY_NETFLIX: 'Netflix',
  KEY_AMAZON: 'Prime Video',
  KEY_DISNEY: 'Disney+',
  KEY_HULU: 'Hulu',
  KEY_HOTSTAR: 'Hotstar',
  KEY_RAKUTEN: 'Rakuten TV',
  KEY_SHAHID: 'Shahid',
  KEY_WAVVE: 'Wavve',
  KEY_SONYLIV: 'Sony LIV',
  KEY_STAN: 'Stan',
  KEY_IPLAYER: 'iPlayer',
  KEY_FREEVIEWPLAY: 'Freeview Play',
  KEY_COUPANGPLAY: 'Coupang Play',
  KEY_GLOBOPLAY: 'Globoplay',
  KEY_PREMIER: 'Premier',
  KEY_OKKO: 'Okko',
  KEY_KINOPOISK: 'Kinopoisk',
  KEY_IVI: 'ivi',
  KEY_YANDEX: 'Yandex',
  KEY_WINK: 'Wink',
  KEY_STARTRU: 'Start',
  KEY_VTVGO: 'VTV Go',
  KEY_TV360: 'TV360',
  KEY_FPTPLAY: 'FPT Play',
  KEY_NHKPLUS: 'NHK Plus',
  KEY_TVER: 'TVer',
  KEY_UNEXT: 'U-NEXT',
  KEY_SLINGTV: 'Sling TV',
  KEY_TOD: 'TOD',
  KEY_WATCHAPLAY: 'Watcha',
  KEY_VKVIDEO: 'VK Video',
  KEY_LGCHANNELS: 'LG Channels',
  KEY_MOVIES: 'Movies',
  KEY_SOCCER: 'Soccer',
  KEY_SHOP: 'Shop',
  KEY_APPS: 'Apps',
  KEY_LAUNCHER: 'Launcher',
  // voice
  KEY_ALEXAVOICE: 'Alexa',
  KEY_VOICE: 'Voice',
  KEY_GOOGLEVOICE: 'Google voice',
  // colours, numbers
  KEY_RED: 'Red',
  KEY_GREEN: 'Green',
  KEY_YELLOW: 'Yellow',
  KEY_BLUE: 'Blue',
  KEY_DASH: 'Dash',
  KEY_3DIGIT_INPUT: '3-digit input',
  // navigation and menus
  KEY_HOME: 'Home',
  KEY_HOMEDASHBOARD: 'Home dashboard',
  KEY_INPUT: 'Input',
  KEY_INPUTHUB: 'Input hub',
  KEY_BACK: 'Back',
  KEY_OK: 'OK',
  KEY_OK_IR: 'OK',
  KEY_UP: 'Up',
  KEY_DOWN: 'Down',
  KEY_LEFT: 'Left',
  KEY_RIGHT: 'Right',
  KEY_MENU: 'Menu',
  KEY_SETTINGS: 'Settings',
  KEY_ADVANCE_SETTING: 'Advanced settings',
  KEY_SEARCH: 'Search',
  KEY_INFO: 'Info',
  KEY_GUIDE: 'Guide',
  KEY_LIST: 'List',
  KEY_FAVORITE: 'Favorites',
  KEY_RECENT: 'Recent',
  KEY_EMANUAL: 'E-manual',
  KEY_USER_GUIDE: 'User guide',
  // TV
  KEY_LIVETV: 'Live TV',
  KEY_LIVE_MENU: 'Live menu',
  KEY_TV: 'TV',
  KEY_TV_RADIO: 'TV/Radio',
  KEY_CHANNELUP: 'Channel up',
  KEY_CHANNELDOWN: 'Channel down',
  KEY_VOLUMEUP: 'Volume up',
  KEY_VOLUMEDOWN: 'Volume down',
  KEY_MUTE: 'Mute',
  KEY_POWER: 'Power',
  KEY_SLEEP: 'Sleep timer',
  KEY_PICTURE: 'Picture',
  KEY_SOUND: 'Sound',
  KEY_ASPECT_RATIO: 'Aspect ratio',
  KEY_SUBTITLE: 'Subtitles',
  KEY_AUDIO_DESCRIPTION: 'Audio description',
  KEY_SAP: 'SAP',
  KEY_TEXT: 'Text',
  KEY_TEXT_OPTION: 'Text option',
  KEY_MAGNIFIER_ZOOM: 'Magnifier',
  KEY_LIVEZOOM: 'Live zoom',
  KEY_LIGHTING: 'Lighting',
  KEY_3D_MODE: '3D',
  // playback
  KEY_PLAY: 'Play',
  KEY_PAUSE: 'Pause',
  KEY_STOP: 'Stop',
  KEY_FF: 'Fast forward',
  KEY_REW: 'Rewind',
  KEY_RECORD: 'Record',
  KEY_RECLIST: 'Recordings',
  KEY_GOTONEXT: 'Next',
  KEY_GOTOPREV: 'Previous',
  KEY_PREVIOUS: 'Previous channel',
  KEY_STB_POWER: 'Set-top box power',
  KEY_STB_MENU: 'Set-top box menu',
};

// codes the hook reported for a button on a real TV, next to LG's name in the system log (remote LGE MR23, webOS 10.3)
const CODES = {
  398: 'KEY_RED',
  399: 'KEY_GREEN',
  400: 'KEY_YELLOW',
  401: 'KEY_BLUE',
  428: 'KEY_VOICE',
  773: 'KEY_HOME',
  1037: 'KEY_NETFLIX',
  1038: 'KEY_AMAZON',
  1086: 'KEY_ALEXAVOICE',
};

// a name as LG writes it: KEY_ and capitals/digits/underscore only
const NAME = /^KEY_[A-Z0-9_]{1,40}$/;
// the buttons that only move around or confirm: a press of one of them is not the button that was learned
const MOVES = ['KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT', 'KEY_OK', 'KEY_OK_IR', 'KEY_BACK'];

// KEY_NETFLIX -> "Netflix"; a name that has no entry is spelled out: KEY_FOO_BAR -> "Foo bar"; digits stay: KEY_5 -> "5"
function label(name) {
  if (typeof name !== 'string' || !NAME.test(name)) return '';
  if (LABELS[name]) return LABELS[name];
  const s = name.slice(4).toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// the newest NL_BUTTON_CLICK in the system log (text), if it is not older than maxAge ms before `now`; '' otherwise
function fromLog(text, now, maxAge) {
  const re = /^(\S+) .*NL_BUTTON_CLICK .*"button_type":"([A-Z0-9_]+)"/gm;
  let m,
    found = '';
  while ((m = re.exec(String(text || '')))) {
    // the log writes microseconds: Date.parse takes milliseconds in a fixed format
    const at = Date.parse(m[1].replace(/(\.\d{3})\d*Z$/, '$1Z'));
    if (!isNaN(at) && now - at <= maxAge && at - now < 60000 && NAME.test(m[2]) && MOVES.indexOf(m[2]) < 0) found = m[2];
    else found = '';
  }
  return found;
}

// the last 16 kB of the system log
function readLog() {
  let fd;
  try {
    fd = fs.openSync(P.SYSLOG, 'r');
    const size = fs.fstatSync(fd).size,
      n = Math.min(size, 16384),
      b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, size - n);
    return b.toString('utf8');
  } catch (_) {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {}
    }
  }
}

// LG's name for a button just learned: the code seen on a real TV, else the newest click in the system log; '' when neither knows it
function nameFor(code, now) {
  return CODES[code] || fromLog(readLog(), now === undefined ? Date.now() : now, 6000);
}

module.exports = { label, fromLog, nameFor, CODES, LABELS, NAME };
