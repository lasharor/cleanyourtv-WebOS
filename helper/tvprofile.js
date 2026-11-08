#!/usr/bin/env node
// What differs between TVs, in one place. The facts about a TV (model, firmware, webOS SDK version, LG's Home app, Node.js version)
// go in, the decisions every other part follows come out:
//   pickerMode     how the Input key shows the Inputs by default: 'overlay' (the picker over the running app, kept ready) on webOS 25
//                  (SDK 10), the only version where that was tried; 'ondemand' (started on the key, closed after use) everywhere else: on
//                  webOS 6.5 a hidden overlay app kept the remote and showed a loading circle (issues 5 and 6), and SDK 11 (webOS 26) has
//                  not been tried. A choice in the manager wins.
//   notifyWindow   the window type of the notification app: 'topui' (above every app, the remote stays with the app) from SDK 10 on;
//                  older TVs refuse to start an app of that type and get 'overlay', also when the SDK version is unknown.
//   homeSupported  LG's Home is the flutter or web app the launcher was written for; other kinds need "Set up anyway" (--force).
//   tested, testedNote  the firmware or SDK is in compat.json (a trailing * matches a prefix).
//   legacyNode     Node.js before 10 (webOS 5 and 6): the service avoids what Node 8 lacks (see AGENTS.md).
//   afterSam       the system services restarted after the app manager (SAM) is restarted to take over Home, on TVs where LG's Home
//                  is the native app (webOS 5 to 23 reports) and on webOS before 7. There they kept talking to the old app manager: web
//                  and video apps no longer opened, an HDMI input had no picture, HDMI-CEC control stopped and no apps were preloaded
//                  (issues 14, 23 and 24). TVs with the flutter or web Home (webOS 24 and newer) restart what depends on SAM themselves.
//                  On webOS 26 (SDK 11) with the flutter or web Home, HDMI ARC to a soundbar stayed silent after the restart until
//                  arccontroller was restarted (issue 21, OLED65C35LA), and on a 50NU850BPSA video apps stayed black because umediaserver
//                  lost its subscription to SAM (pull request 73): both are restarted there. webOS 25 (SDK 10) keeps eARC, but on an
//                  OLED65B2RLA (SDK 10.3.2, flutter Home, CRIU) video apps now and then played with a black picture: the media services had
//                  no foreground app after the restart, and restarting videooutputd and then umediaserver brought picture and sound back
//                  (issue 122). That is restarted there too, ARC left alone; other webOS 25 TVs (a C3 on 10.3.0 among them) were fine without
//                  it, so a file after-sam-services in the service folder replaces the list on one TV (an empty file: none).
//                  scripts/after-sam.sh restarts only services that exist and are active.
//   homeTakeover   how the launcher becomes Home. 'mount': its folder is mounted over LG's Home app and the app manager is restarted
//                  to read it (flutter and web Home). 'standin' where LG's Home is the native program: a small script is mounted over
//                  that program and asks webapp-mgr to open the launcher as com.webos.app.home, so LG's Home manifest stays and the
//                  app manager is not restarted (issues 14, 23 and 24). scripts/home-standin.sh is the script.
//   criu           the kernel runs with CRIU (criu_enabled on its command line): webOS restores some apps from a checkpoint instead of
//                  starting their program. LG's native Home is then never started from the program the stand-in replaces, so the stand-in
//                  does not run (55UR78006LK, issue 72; OLED55BX3LB, issue 84). Not used to choose the way: other TVs with CRIU may run the
//                  stand-in fine. The setup tries the stand-in first and, when the launcher does not come up, the mount way (bootstrap.sh).
//   wakeRefocus    the launcher may ask the service to give it the remote back after a wake (POST /api/refocus, picker.makeRefocus):
//                  on webOS 26 (SDK 11) the compositor sends Home no keyboard after its relaunch by the boot manager and the remote does
//                  nothing until Back is held (OLED65C54LA, 43.21.77). Seen only on SDK 11; newer ones are assumed to work the same way.
//                  The launcher asks only when it is shown without the focus, so a TV without the problem never sees the picker.
// To support a new kind of TV, change the rules here and add a case to tools/test/tvprofile.test.js.
//
// In the service: tvprofile.create({luna}) -> { get(), refresh() }, saved in tv.json.
// From the setup script (shell), with the facts it read itself:
//   node tvprofile.js get <decision> [--sdk 10.2.2] [--firmware 33.23.05] [--home "com.webos.app.home flutter"] [--compat f.json ...]
//   node tvprofile.js show [same options]      prints the whole profile as JSON
const fs = require('fs');

function sdkMajor(sdk) {
  const n = parseInt(String(sdk || '').split('.')[0], 10);
  return isNaN(n) ? 0 : n;
}
function compatMatch(entries, firmware, sdk) {
  // an entry's "firmware" is a firmware version, an SDK version or a firmware prefix ending in *
  for (const e of entries || []) {
    const w = (e && e.firmware) || '';
    if (!w) continue;
    if (firmware === w || sdk === w || (w.charAt(w.length - 1) === '*' && String(firmware || '').indexOf(w.slice(0, -1)) === 0))
      return e.note || 'listed';
  }
  return '';
}
// facts: {model, firmware, sdk, home ("com.webos.app.home flutter"), node ("v8.12.0"), cmdline (the kernel command line)}; compat: the entries of compat.json files
function decide(facts, compat) {
  const f = facts || {};
  const major = sdkMajor(f.sdk);
  const homeKind = String(f.home || '');
  const nodeMajor = parseInt(String(f.node || process.version).replace(/^v/, ''), 10) || 0;
  const testedNote = compatMatch(compat, f.firmware, f.sdk);
  return {
    model: f.model || '',
    firmware: f.firmware || '',
    sdk: f.sdk || '',
    sdkMajor: major,
    home: homeKind,
    node: f.node || process.version,
    pickerMode: major === 10 ? 'overlay' : 'ondemand',
    notifyWindow: major >= 10 ? 'topui' : 'overlay',
    homeSupported: homeKind === 'com.webos.app.home flutter' || homeKind === 'com.webos.app.home web',
    tested: !!testedNote,
    testedNote,
    legacyNode: nodeMajor > 0 && nodeMajor < 10,
    // where LG's Home is the native app (webOS 5, 6, 22, 23 reports) or the webOS version is before 7; on webOS 26 the ARC controller
    afterSam:
      (major > 0 && major < 7) || /\snative$/.test(homeKind)
        ? 'eim webapp-mgr preload-manager memorymanager'
        : major === 11 && /\s(?:flutter|web)$/.test(homeKind)
          ? 'arccontroller umediaserver'
          : major === 10 && /\s(?:flutter|web)$/.test(homeKind)
            ? 'videooutputd umediaserver'
            : '',
    criu: /(^|\s)criu_enabled(\s|=|$)/.test(String(f.cmdline || '')),
    homeTakeover: /^com\.webos\.app\.home native$/.test(homeKind) ? 'standin' : 'mount',
    wakeRefocus: major >= 11,
  };
}
const readJson = (file, d) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return d;
  }
};
const readText = file => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return '';
  }
};
const compatEntries = files =>
  [].concat.apply(
    [],
    (files || []).map(f => readJson(f, {}).entries || [])
  );
// the kind of LG's Home from its stock appinfo.json: "<id> <type>"
const homeKindOf = file => {
  const a = readJson(file, null);
  return a ? (a.id || '') + ' ' + (a.type || '') : '';
};

// the service's view: facts from luna once after start, kept in tv.json
function create(ctx) {
  const P = require('./paths');
  let profile = readJson(P.TV, null) || decide({}, []);
  async function refresh() {
    const r = await ctx.luna('luna://com.webos.service.tv.systemproperty/getSystemInfo', {
      keys: ['modelName', 'firmwareVersion', 'sdkVersion'],
    });
    if (r.returnValue === false) return profile;
    const backup = P.D + '/backup/home-appinfo.orig.json';
    const home = homeKindOf(fs.existsSync(backup) ? backup : P.HOME_APP + '/appinfo.json');
    profile = decide(
      {
        model: r.modelName,
        firmware: r.firmwareVersion,
        sdk: r.sdkVersion,
        home,
        node: process.version,
        cmdline: readText(P.PROC + '/cmdline'),
      },
      compatEntries(P.COMPAT)
    );
    try {
      fs.writeFileSync(P.TV + '.tmp', JSON.stringify(profile, null, 1));
      fs.renameSync(P.TV + '.tmp', P.TV);
    } catch (_) {}
    return profile;
  }
  return { get: () => profile, refresh };
}

module.exports = { decide, create, sdkMajor, compatMatch, compatEntries, homeKindOf };

if (require.main === module) {
  const a = process.argv.slice(2);
  const val = k => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] || '' : '';
  };
  const compat = [];
  for (let i = a.indexOf('--compat') + 1; i > 0 && i < a.length && a[i].indexOf('--') !== 0; i++) compat.push(a[i]);
  const p = decide(
    { model: val('--model'), firmware: val('--firmware'), sdk: val('--sdk'), home: val('--home'), cmdline: val('--cmdline') },
    compatEntries(compat)
  );
  if (a[0] === 'show') console.log(JSON.stringify(p, null, 1));
  else if (a[0] === 'get' && a[1] in p) console.log(typeof p[a[1]] === 'boolean' ? (p[a[1]] ? 1 : 0) : p[a[1]]);
  else {
    console.error(
      'usage: node tvprofile.js get <' +
        Object.keys(p).join('|') +
        '> | show  [--sdk v] [--firmware v] [--home kind] [--cmdline text] [--compat files]'
    );
    process.exit(2);
  }
}
