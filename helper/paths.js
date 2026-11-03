// Every place on the TV the service reads or writes. The environment variables point them elsewhere for the tests on a computer
// (tools/test); on the TV none of them is set.
const path = require('path');
const env = process.env;

const D = env.CYTV_DIR || '/media/developer/cleanyourtv';
const SERVICE_DIR = env.CYTV_SERVICE_DIR || '/media/developer/apps/usr/palm/services/com.cleanyourtv.manager.service';

module.exports = {
  D, // the service's own folder: helper files, config.json, the launcher (app/), Live TV data, themes
  SERVICE_DIR, // the installed package (the manager app's service folder)
  CONF: D + '/config.json',
  USAGE: D + '/usage.json',
  TV: D + '/tv.json', // what tvprofile.js found out about this TV
  DISABLE: D + '/DISABLE', // present while LG's Home is chosen
  PICKER_MODE: D + '/picker-mode', // read by scripts/inputkey.sh
  TUNER_GUIDE: D + '/tuner-guide', // 'on' while the Guide key opens the tuner guide (guide/app); read by scripts/guidekey.sh
  CHANNEL: D + '/channel', // the update channel ('dev' for the dev builds)
  SOURCE: D + '/source', // "owner/repo [branch]": another repository, for testing
  LIVE: env.CYTV_LIVE_DIR || D + '/live',
  THEMES: env.CYTV_THEMES || path.join(__dirname, 'themes'),
  VOICE: D + '/voice',
  ADDONS_BUNDLED: env.CYTV_ADDONS_BUNDLED || path.join(__dirname, 'addons-bundled'), // add-ons that ship in the package (helper files sit beside it on the TV too)
  CARDPACKS: env.CYTV_CARDPACKS || D + '/cardpacks', // downloaded cards: one folder each with a card.json (cardcatalog.js)
  ADDONS: env.CYTV_ADDONS || D + '/addons', // add-ons: one folder each with an addon.json (addons.js)
  ADDON_DATA: env.CYTV_ADDON_DATA || D + '/addon-data', // what each add-on stores, apart from its code
  WEATHER: D + '/weather.json', // the weather card's last answers (weather.js)
  HOOK: D + '/inputhook',
  APP: D + '/app',
  COMPAT: [D + '/compat.json', SERVICE_DIR + '/compat.json'],
  INITD: '/var/lib/webosbrew/init.d',
  SETUP_LOG: '/media/developer/cytv-setup.log',
  SERVICE_LOG: '/tmp/cleanyourtv-helper.log',
  RUNFILE: env.CYTV_RUNFILE || '/tmp/cytv-run.json',
  HOOK_CFG: env.CYTV_HOOK_CFG || '/home/root/.config/lginputhook',
  HOOK_LOG: env.CYTV_HOOK_LOG || '/tmp/lginput-hook-lginput2.log',
  SYSLOG: env.CYTV_SYSLOG || '/var/log/messages', // LG's system log: a line per remote button press, with the button's name (keynames.js)
  LASTAPP: '/var/luna/preferences/bootd_last_foreground_app_id.json',
  PROC: env.CYTV_PROC || '/proc',
  ZRAM: env.CYTV_ZRAM || '/sys/block/zram0', // the zram device's settings and counters (zram.js)
  SYSBLOCK: env.CYTV_SYSBLOCK || '/sys/block', // the block devices, for the eMMC's discard support (fstrim.js)
  HOME_APP: '/usr/palm/applications/com.webos.app.home',
  FULLHOME_APP: '/usr/palm/applications/com.webos.app.fullhome',
  STANDIN: env.CYTV_STANDIN || '/tmp/cleanyourtv-home-standin', // LG's Home program while scripts/home-standin.sh is mounted over it
  HOME_PARAMS: env.CYTV_HOME_PARAMS || '/tmp/cleanyourtv-home-params', // what a key script (and remap.js) asks the launcher to open
  // child processes find the system tools first, as in a login shell on the TV
  ENV: Object.assign({}, env, { PATH: '/usr/bin:/usr/sbin:/bin:/sbin:' + (env.PATH || '') }),
};
