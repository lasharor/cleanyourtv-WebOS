// Updates from GitHub releases: which release is on offer (the latest stable one, or the dev build), downloading with a
// SHA-256 check, installing the launcher with a rollback when it does not start, and installing the service package. Used by the
// manager (manager.js) and, without the service, by selfupdate.js.
const fs = require('fs');
const P = require('./paths'),
  fetch = require('./fetch'),
  exec = require('./exec'),
  { cmp } = require('./version');

const DEFAULT_REPO = 'lasharor/cleanyourtv-WebOS';
// the dev builds: one pre-release named dev, rebuilt on every push to the dev branch. Before 1.6.9 every branch had its own
// pre-release test-<branch>; a TV still following one of those follows dev.
const DEV_TAG = 'dev';
const OLD_TEST_TAG = /^test-[a-z0-9-]{1,60}$/;
const apiBase = () => process.env.CYTV_API || 'https://api.github.com';

const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return d;
  }
};
const readText = f => {
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch (_) {
    return '';
  }
};
// the update channel: '' for the stable releases, or 'dev'. The file can be set by install.sh too.
const channel = () => {
  const t = readText(P.CHANNEL);
  return t === DEV_TAG || OLD_TEST_TAG.test(t) ? DEV_TAG : '';
};
// the repository: D/source can name another one ("owner/repo [branch]"), for testing
const repo = () => {
  const src = readText(P.SOURCE).split(/\s+/)[0];
  return /^[\w.-]+\/[\w.-]+$/.test(src) ? src : DEFAULT_REPO;
};
// the branch the catalogs (themes, add-ons, cards) are read from: the one D/source names, else dev on the dev channel, else main
const catalogRef = () => {
  const x = readText(P.SOURCE).split(/\s+/)[1];
  if (/^[\w.\/-]{1,60}$/.test(x || '')) return x;
  return channel() ? 'dev' : 'main';
};
const baseRepo = () => apiBase() + '/repos/' + repo();
const releaseUrl = conf => {
  if (conf && conf.releasesUrl) return conf.releasesUrl;
  return baseRepo() + (channel() ? '/releases/tags/' + channel() : '/releases/latest');
};
// plain http only for a test server (CYTV_API) or a custom release source in config.json
const allowHttp = () => !!process.env.CYTV_API || !!readJson(P.CONF, {}).releasesUrl;
const GITHUB = {
  headers: { 'User-Agent': 'cleanyourtv-manager', Accept: 'application/vnd.github+json, application/json, */*' },
  allowHttp,
  redirects: 6,
};
const FILE = { headers: { 'User-Agent': 'cleanyourtv-manager', Accept: 'application/octet-stream, */*' }, allowHttp, redirects: 6 };

// the commit a build was made from (dev builds only; a stable install has no BUILD file)
const buildOf = f => {
  const b = readText(f);
  return /^[0-9a-f]{7,40}$/.test(b) ? b : '';
};
const buildInBody = body => {
  const m = /^build:\s*([0-9a-f]{7,40})\s*$/m.exec(String(body || ''));
  return m ? m[1] : '';
};
// the files of a release: the launcher and the service package are versioned separately, each needs its .sha256
function parseRelease(j) {
  const assets = {};
  for (const a of j.assets || []) assets[a.name] = a.browser_download_url;
  let frontend = null,
    service = null;
  for (const n of Object.keys(assets)) {
    let m = /^frontend-(\d+\.\d+\.\d+)\.tgz$/.exec(n);
    if (m && assets[n + '.sha256']) frontend = m[1];
    m = /^com\.cleanyourtv\.manager_(\d+\.\d+\.\d+)_all\.ipk$/.exec(n);
    if (m && assets[n + '.sha256']) service = m[1];
  }
  return {
    version: j.tag_name === DEV_TAG ? service || '' : String(j.tag_name || '').replace(/^(v|test-)/, ''),
    frontend,
    service,
    assets,
    build: buildInBody(j.body),
    test: !!channel(),
    notes: String(j.body || '').slice(0, 600),
  };
}
async function latest(conf) {
  const r = await fetch.read(releaseUrl(conf), Object.assign({ totalMs: 45000, totalText: 'no answer from GitHub in time' }, GITHUB));
  return parseRelease(JSON.parse(r.body.toString()));
}
// download a release file and check it against its .sha256
async function download(release, name, dest) {
  const url = release.assets[name],
    shaUrl = release.assets[name + '.sha256'];
  if (!url) throw new Error('release has no ' + name);
  if (!shaUrl) throw new Error('release has no ' + name + '.sha256, refusing to install an unchecked file');
  const want = (await fetch.read(shaUrl, GITHUB)).body.toString().trim().split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) throw new Error('bad checksum file');
  const got = (await fetch.toFile(url, dest, FILE)).sha256;
  if (got !== want) {
    try {
      fs.unlinkSync(dest);
    } catch (_) {}
    throw new Error('checksum mismatch');
  }
}
// is the offered file different from what is installed? A newer version always is; a dev build also when it is another commit of the
// same version; and a dev build installed with the channel back on stable offers the stable release, even an older one or one of the same
// version (a dev build carries the version of the release it leads to, but not its files).
function differs(offered, installed, offeredBuild, installedBuild) {
  if (!offered) return false;
  if (cmp(offered, installed) > 0) return true;
  if (offeredBuild) return offeredBuild !== installedBuild;
  return !!installedBuild;
}

function create(ctx) {
  const { luna, config, version } = ctx;
  const D = P.D;
  let job = { state: 'idle', message: '', at: 0 },
    release = null,
    releaseAt = 0,
    releaseErr = '',
    frontendOk = null,
    checking = false;
  const setJob = (state, message) => {
    job = { state, message, at: Date.now() };
  };
  const busy = () => job.state === 'working';
  const serviceBuild = () => buildOf(D + '/BUILD'),
    frontendBuild = () => buildOf(D + '/app/BUILD');
  const frontendInfo = () => readJson(D + '/app/version.json', {});
  const prevInfo = () => readJson(D + '/app.prev/version.json', null);

  async function check() {
    checking = true;
    try {
      release = await latest(config.get());
      releaseErr = '';
    } catch (e) {
      release = null;
      releaseErr = e.message === 'HTTP 404' ? 'no release published yet' : String(e.message || e);
    }
    releaseAt = Date.now();
    checking = false;
    return release;
  }
  // the update part of the manager's status
  function status() {
    const fe = frontendInfo(),
      lat = release;
    return {
      service: {
        version,
        build: serviceBuild(),
        updateTo: lat && differs(lat.service, version, lat.build, serviceBuild()) ? lat.service : null,
      },
      frontend: {
        version: fe.version || '?',
        build: frontendBuild(),
        previous: (prevInfo() && prevInfo().version) || null,
        updateTo: lat && differs(lat.frontend, fe.version, lat.build, frontendBuild()) ? lat.frontend : null,
      },
      channel: channel(),
      release: lat
        ? { version: lat.version, frontend: lat.frontend, service: lat.service, build: lat.build, test: lat.test, notes: lat.notes }
        : null,
      checkedAt: releaseAt,
      checking,
      checkError: releaseErr,
    };
  }
  const stale = () => !checking && Date.now() - releaseAt > 300000;

  // ---- a package installed by someone else (the Homebrew Channel, ares-install): the running service is the copy in D, so it is
  // brought to the package's version with bootstrap.sh update, as after an update from the manager. Only once the package has stayed
  // the same for two checks in a row and no update of our own is running (that one runs bootstrap.sh update itself). ----
  const packaged = () => {
    try {
      const v = (/const VERSION = '([^']+)'/.exec(fs.readFileSync(P.SERVICE_DIR + '/helper/helper.js', 'utf8')) || [])[1];
      return v && fs.existsSync(P.SERVICE_DIR + '/bootstrap.sh') ? v + ' ' + (buildOf(P.SERVICE_DIR + '/BUILD') || '') : '';
    } catch (_) {
      return '';
    }
  };
  let seenPackage = '',
    applied = false;
  function watchPackage() {
    const now = packaged();
    if (!now || applied || busy() || now === version + ' ' + (serviceBuild() || '')) return void (seenPackage = '');
    if (now !== seenPackage) return void (seenPackage = now);
    applied = true;
    const ver = now.split(' ')[0];
    // bootstrap.sh writes this when the new version did not start and it went back: do not try the same package again and again
    if (readText(D + '/last-error.txt').indexOf('update to ' + ver + ' failed') >= 0) return;
    console.log('updates: the installed package is service ' + now.trim() + ', this is ' + version + '; applying it');
    exec.detached('sleep 1; sh ' + P.SERVICE_DIR + '/bootstrap.sh update ' + ver);
  }

  // ---- the launcher: D/app is replaced, the old one kept as D/app.prev; a launcher that does not report back is rolled back ----
  // reload-home.sh closes the Home page and launches it again; on webOS 6, where WebAppMgr keeps the old page and there is no
  // renderer process to stop, it restarts webapp-mgr (issue 9: the new launcher never started there and the update rolled back)
  async function reloadHome() {
    await exec.sh('sh ' + D + '/reload-home.sh', 90000);
  }
  const swapIn = src =>
    exec.sh(
      [
        'rm -rf ' + D + '/app.prev',
        'mv ' + D + '/app ' + D + '/app.prev',
        'mv ' + src + ' ' + D + '/app',
        'sh ' + D + '/stage-home.sh',
      ].join(' && ')
    );
  async function swapBack() {
    await exec.sh(
      [
        'rm -rf ' + D + '/app.next',
        'mv ' + D + '/app ' + D + '/app.next',
        'mv ' + D + '/app.prev ' + D + '/app',
        'mv ' + D + '/app.next ' + D + '/app.prev',
        'sh ' + D + '/stage-home.sh',
      ].join(' && ')
    );
    await reloadHome();
  }
  async function waitFrontend(ver, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (frontendOk === ver) return true;
      await new Promise(r => setTimeout(r, 1000));
    }
    return false;
  }
  async function updateFrontend(ver) {
    setJob('working', 'Downloading launcher ' + ver);
    const T = D + '/tmp-frontend';
    try {
      if (!release || release.frontend !== ver) await check();
      if (!release || release.frontend !== ver) throw new Error('launcher ' + ver + ' is not in the latest release');
      await exec.sh('rm -rf ' + T + ' && mkdir -p ' + T);
      await download(release, 'frontend-' + ver + '.tgz', T + '/f.tgz');
      setJob('working', 'Checking the download');
      const lst = await exec.sh('tar tzf ' + T + '/f.tgz');
      const names = lst.out.split('\n').filter(Boolean);
      const bad = n => n.startsWith('/') || n.split('/').includes('..') || !(n === 'app' || n.startsWith('app/'));
      if (!lst.ok || !names.length || names.some(bad)) throw new Error('unexpected files in the download');
      if (!(await exec.sh('cd ' + T + ' && tar xzf f.tgz')).ok) throw new Error('could not unpack');
      const nv = readJson(T + '/app/version.json', {});
      if (nv.version !== ver || !fs.existsSync(T + '/app/index.html')) throw new Error('the download is not launcher ' + ver);
      if (nv.minService && cmp(version, nv.minService) < 0)
        throw new Error('needs service ' + nv.minService + ' or newer; update the service first');
      setJob('working', 'Installing launcher ' + ver);
      frontendOk = null;
      await swapIn(T + '/app');
      await reloadHome();
      setJob('working', 'Checking that the new launcher starts');
      if (!(await waitFrontend(ver, 40000))) {
        setJob('working', 'The new launcher did not start; rolling back');
        await swapBack();
        throw new Error('the new launcher did not start; the previous version is back');
      }
      setJob('done', 'Launcher ' + ver + ' installed');
    } catch (e) {
      setJob('error', String(e.message || e));
    }
    await exec.sh('rm -rf ' + T);
  }
  async function rollbackFrontend() {
    if (!prevInfo()) return setJob('error', 'there is no previous version');
    setJob('working', 'Going back to launcher ' + prevInfo().version);
    try {
      await swapBack();
      setJob('done', 'Launcher ' + frontendInfo().version + ' restored');
    } catch (e) {
      setJob('error', String(e.message || e));
    }
  }

  // ---- the service: the system installs the package, then bootstrap.sh update restarts the service (and undoes a failed start) ----
  async function updateService(ver) {
    setJob('working', 'Downloading service ' + ver);
    const f = D + '/tmp-service.ipk',
      name = 'com.cleanyourtv.manager_' + ver + '_all.ipk';
    try {
      if (!release || release.service !== ver) await check();
      if (!release || release.service !== ver) throw new Error('service ' + ver + ' is not in the latest release');
      await download(release, name, f);
      setJob('working', 'Installing service ' + ver);
      const r = await luna('luna://com.webos.appInstallService/dev/install', {
        id: 'com.cleanyourtv.manager',
        ipkUrl: f,
        subscribe: false,
      });
      if (!r.returnValue) throw new Error('the system refused the install: ' + (r.errorText || ''));
      const until = Date.now() + 90000,
        before = buildOf(P.SERVICE_DIR + '/BUILD');
      let ok = false,
        seen = 0;
      while (Date.now() < until && !ok) {
        await new Promise(r2 => setTimeout(r2, 3000));
        const ai = await luna('luna://com.webos.applicationManager/getAppInfo', { id: 'com.cleanyourtv.manager' });
        if (!(ai.appInfo && ai.appInfo.version === ver)) continue;
        // the same version number can be a different build: wait until the package's BUILD file is the offered one (or gone, for
        // stable after a dev build); a package that does not touch it is accepted after 30 s
        if (!seen) seen = Date.now();
        const now = buildOf(P.SERVICE_DIR + '/BUILD');
        if (release.build ? now === release.build : !before || !now) ok = true;
        if (Date.now() - seen > 30000) ok = true;
      }
      if (!ok) throw new Error('the install did not finish');
      setJob('working', 'Restarting the service');
      exec.detached('sleep 1; sh ' + P.SERVICE_DIR + '/bootstrap.sh update ' + ver);
    } catch (e) {
      setJob('error', String(e.message || e));
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    }
  }

  // the dev build on offer (the manager's Update channel list): the pre-release named dev, or none while it is being rebuilt
  async function tests() {
    try {
      const r = JSON.parse((await fetch.read(baseRepo() + '/releases/tags/' + DEV_TAG, GITHUB)).body.toString());
      const p = parseRelease(r);
      const builds = r.prerelease
        ? [{ tag: DEV_TAG, branch: DEV_TAG, build: p.build, published: r.published_at, service: p.service, frontend: p.frontend }]
        : [];
      return { channel: channel(), builds };
    } catch (e) {
      return { channel: channel(), builds: [], error: e.message === 'HTTP 404' ? '' : String(e.message || e) };
    }
  }
  // { tag: "dev" } or { tag: "" } for the stable releases (an old test-<branch> tag means dev); returns an error text or ''
  async function setChannel(tag) {
    let t = String(tag || '');
    if (OLD_TEST_TAG.test(t)) t = DEV_TAG;
    if (t && t !== DEV_TAG) return 'unknown channel';
    if (busy()) return 'an update is running';
    try {
      if (t) fs.writeFileSync(P.CHANNEL, t + '\n');
      else fs.unlinkSync(P.CHANNEL);
    } catch (_) {}
    release = null;
    releaseAt = 0;
    await check();
    return '';
  }

  return {
    check,
    status,
    stale,
    watchPackage,
    job: () => job,
    busy,
    tests,
    setChannel,
    updateFrontend,
    rollbackFrontend,
    updateService,
    frontendLoaded: v => {
      frontendOk = v;
    },
    repo: () =>
      releaseUrl(config.get())
        .replace(/^https?:\/\/[^/]+\/repos\//, '')
        .replace(/\/releases.*$/, ''),
  };
}

module.exports = { create, latest, download, parseRelease, differs, channel, repo, catalogRef, releaseUrl, DEV_TAG };
