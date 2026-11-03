#!/usr/bin/env python3
"""Build the release files into dist/:
  com.cleanyourtv.manager_<version>_all.ipk (+ .sha256)   the package: manager app, picker app, notify app, service
  frontend-<version>.tgz (+ .sha256)                      the launcher alone, installed by the manager app
  apps.json, com.cleanyourtv.manager.manifest.json         the Homebrew Channel repository: the package of this release
                                                           (CYTV_REPO owner/repo, CYTV_TAG the release tag, default v<version>)
Run from anywhere: python3 ipk/build.py"""
import hashlib, io, json, os, re, shutil, sys, tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.environ.get('CYTV_DIST') or os.path.join(ROOT, 'dist')   # CYTV_DIST: the tests build elsewhere
P = lambda *a: os.path.join(ROOT, *a)
PKG = 'com.cleanyourtv.manager'
SERVICE = PKG + '.service'

version = re.search(r"const VERSION = '([^']+)'", open(P('helper', 'helper.js')).read()).group(1)
fe = json.load(open(P('app', 'version.json')))['version']
if not re.search(r"VERSION\s*=\s*'%s'" % re.escape(fe), open(P('app', 'index.html')).read()):
    sys.exit('app/version.json (%s) and VERSION in app/index.html do not match' % fe)

# A test build (made by .github/workflows/test-build.yml from a branch) carries the commit it was made from in a BUILD file, in the
# package and in the launcher, so the manager can tell two builds with the same version number apart.
BUILD = os.environ.get('CYTV_BUILD', '').strip()
if BUILD and not re.fullmatch(r'[0-9a-f]{7,40}', BUILD):
    sys.exit('CYTV_BUILD must be a commit hash')

def add(files, arc, data, mode=0o644):
    files.append((arc, data, mode))

def add_dir(files, arc_root, src, mode_for=None, skip=(), skip_dirs=()):
    for root, dirs, names in os.walk(src):
        dirs[:] = [d for d in dirs if d not in skip_dirs]   # e.g. app/src: the launcher's sources, built into app/index.html
        for n in sorted(names):
            if n in skip or n.startswith('.'):
                continue
            p = os.path.join(root, n)
            rel = os.path.relpath(p, src)
            mode = 0o755 if (n.endswith('.sh') or n in ('ezinject', '10-cleanyourtv-home', '15-cleanyourtv-debloat')) else 0o644
            body = open(p, 'rb').read()
            add(files, arc_root + '/' + rel, body, mode)

def tgz(files, prefix=''):
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode='w:gz', format=tarfile.GNU_FORMAT) as t:
        for arc, data, mode in sorted(files):
            ti = tarfile.TarInfo(prefix + arc); ti.size = len(data); ti.mode = mode; ti.uid = ti.gid = 0; ti.mtime = 1761000000   # a zero timestamp makes some TVs refuse the package
            t.addfile(ti, io.BytesIO(data))
    return b.getvalue()

def ar(parts):
    blob = b'!<arch>\n'
    for n, d in parts:
        blob += ('%-16s%-12d%-6d%-6d%-8s%-10d`\n' % (n + '/', 0, 0, 0, '100644', len(d))).encode() + d + (b'\n' if len(d) % 2 else b'')
    return blob

def write(name, data):
    path = os.path.join(DIST, name)
    open(path, 'wb').write(data)
    open(path + '.sha256', 'w').write('%s  %s\n' % (hashlib.sha256(data).hexdigest(), name))
    print('%-52s %8d bytes' % (name, len(data)))

shutil.rmtree(DIST, ignore_errors=True); os.makedirs(DIST)

# ---- the launcher alone ----
fl = []
add_dir(fl, 'app', P('app'), skip_dirs=('src',))
if BUILD: add(fl, 'app/BUILD', (BUILD + '\n').encode())
write('frontend-%s.tgz' % fe, tgz(fl))

# ---- the package ----
data = []
for app_id, src in (('com.cleanyourtv.manager', 'manager/app'), ('com.cleanyourtv.picker', 'picker/app'), ('com.cleanyourtv.notify', 'notify/app')):
    d = '/usr/palm/applications/' + app_id
    for root, _, names in os.walk(P(src)):
        for n in sorted(names):
            p = os.path.join(root, n); rel = os.path.relpath(p, P(src)); body = open(p, 'rb').read()
            if n == 'appinfo.json' and app_id == PKG:   # the package version is the service version
                o = json.loads(body); o['version'] = version; body = json.dumps(o).encode()
            add(data, '.' + d + '/' + rel, body)
add(data, './usr/palm/applications/com.cleanyourtv.manager/qrcode.js', open(P('third-party', 'qrcode-generator', 'qrcode.js'), 'rb').read())   # QR code for sharing the log
s = '.' + '/usr/palm/services/' + SERVICE
add(data, s + '/bootstrap.sh', open(P('scripts', 'bootstrap.sh'), 'rb').read(), 0o755)
add_dir(data, s + '/helper', P('helper'), skip_dirs=('src',))   # helper/addons-bundled/<id>/src: the sources of an add-on's page
add_dir(data, s + '/i18n', P('i18n'), skip=('README.md',))   # the translations, for the phone pages the service serves (helper/i18n.js)
add_dir(data, s + '/scripts', P('scripts'), skip=('bootstrap.sh',))
add(data, s + '/scripts/uninstall.sh', open(P('uninstall.sh'), 'rb').read(), 0o755)
add(data, s + '/voice/cytv-asr', open(P('voice', 'cytv-asr'), 'rb').read(), 0o755)   # optional voice feature: downloads its engine on request
add(data, s + '/inputhook/ezinject', open(P('third-party', 'inputhook', 'ezinject'), 'rb').read(), 0o755)
add(data, s + '/inputhook/libinputhookpp.so', open(P('third-party', 'inputhook', 'libinputhookpp.so'), 'rb').read())
for n in sorted(os.listdir(P('third-party', 'inputhook'))):
    if n.startswith('LICENSE') or n == 'SHA256SUMS':
        add(data, s + '/licenses/' + n, open(P('third-party', 'inputhook', n), 'rb').read())
add(data, s + '/licenses/THIRD-PARTY.md', open(P('THIRD-PARTY.md'), 'rb').read())
add(data, s + '/licenses/LICENSE', open(P('LICENSE'), 'rb').read())
add(data, s + '/compat.json', open(P('compat.json'), 'rb').read())
add(data, s + '/config.example.json', open(P('config.example.json'), 'rb').read())
add_dir(data, s + '/payload/app', P('app'), skip_dirs=('src',))
if BUILD:
    add(data, s + '/BUILD', (BUILD + '\n').encode())
    add(data, s + '/payload/app/BUILD', (BUILD + '\n').encode())
add(data, './usr/palm/packages/%s/packageinfo.json' % PKG, json.dumps({'id': PKG, 'version': version, 'app': PKG}).encode())

size = sum(len(d) for _, d, _ in data) // 1024 + 1
ctl = ('Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %d\n'
       'Maintainer: N/A <nobody@example.com>\nDescription: CleanYourTV for LG webOS\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: x.y.x\n' % (PKG, version, size)).encode()
ipk_name = '%s_%s_all.ipk' % (PKG, version)
ipk = ar([('debian-binary', b'2.0\n'), ('control.tar.gz', tgz([('control', ctl, 0o644)], './')), ('data.tar.gz', tgz(data))])
write(ipk_name, ipk)

# ---- the Homebrew Channel repository (Settings > Add repository: https://github.com/<repo>/releases/latest/download/apps.json) ----
REPO = os.environ.get('CYTV_REPO') or 'lasharor/cleanyourtv-WebOS'
TAG = os.environ.get('CYTV_TAG') or 'v' + version
if not re.fullmatch(r'[\w.-]+/[\w.-]+', REPO) or not re.fullmatch(r'[\w.-]+', TAG):
    sys.exit('CYTV_REPO must be owner/repo and CYTV_TAG a release tag')
raw = 'https://raw.githubusercontent.com/%s/main/' % REPO
dl = 'https://github.com/%s/releases/download/%s/' % (REPO, TAG)
summary = 'A clean Home screen for rooted LG TVs, without LG\'s ads and tracking'
manifest = {
    'id': PKG, 'version': version, 'type': 'web', 'title': 'CleanYourTV', 'appDescription': summary,
    'iconUri': raw + 'manager/app/largeIcon.png', 'sourceUrl': 'https://github.com/' + REPO, 'rootRequired': True,
    'ipkUrl': dl + ipk_name, 'ipkHash': {'sha256': hashlib.sha256(ipk).hexdigest()}, 'ipkSize': len(ipk),
}
repo = {'paging': {'page': 1, 'count': 1, 'maxPage': 1, 'itemsTotal': 1}, 'packages': [{
    'id': PKG, 'title': 'CleanYourTV', 'iconUri': manifest['iconUri'], 'shortDescription': summary,
    'manifestUrl': dl + PKG + '.manifest.json', 'manifest': manifest, 'pool': 'main',
    'fullDescriptionUrl': raw + 'docs/homebrew-channel.html'}]}
for name, obj in ((PKG + '.manifest.json', manifest), ('apps.json', repo)):
    open(os.path.join(DIST, name), 'w').write(json.dumps(obj, indent=2) + '\n')
    print('%-52s (Homebrew Channel, %s)' % (name, TAG))
print('service %s, launcher %s' % (version, fe))
