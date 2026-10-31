#!/usr/bin/env python3
"""Build the original UI, isolated helper and version-specific original installer kit; no TV access."""
from pathlib import Path
import argparse
import gzip
import hashlib
import io
import json
import os
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('CYTV_DIST') or ROOT / 'dist/webos4-original-trial')
HELPERS = ('webos4-original', 'webos4', 'apps', 'config', 'paths', 'web', 'server', 'luna', 'exec', 'diag', 'netcompat',
           'theme', 'themeschema', 'fetch', 'i18n', 'wallpapers', 'cards', 'hacards', 'weather', 'answers', 'live', 'running')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, help='local copy of the exact previously validated Node/library tree')
    args = parser.parse_args()
    subprocess.run(['node', str(ROOT / 'tools/build-webos4-original.js')], check=True)
    files = [(ROOT / ('helper/' + name + '.js'), 'helper/' + name + '.js') for name in HELPERS]
    files += [(p, str(p.relative_to(ROOT)).replace('\\', '/')) for folder in ('i18n', 'themes')
              for p in sorted((ROOT / folder).rglob('*')) if p.is_file()]
    files += [(ROOT / 'webos4/original-service.sh', 'original-service.sh'), (ROOT / 'LICENSE', 'LICENSE'),
              (ROOT / 'webos4/profile.json', 'webos4/profile.json')]
    manifest = {'schema': 1, 'appId': 'com.cleanyourtv.webos4.original', 'files': []}
    bundle = OUT / 'cleanyourtv-original-helper.tgz'
    with tarfile.open(bundle, 'w:gz', format=tarfile.GNU_FORMAT) as archive:
        for file, name in files:
            body = file.read_bytes()
            if file.suffix in ('.js', '.json', '.sh', '.md'):
                body = body.replace(b'\r\n', b'\n')
            entry = tarfile.TarInfo(name)
            entry.size = len(body)
            entry.mode = 0o700 if name.endswith('.sh') else 0o600
            entry.mtime = 1761000000
            archive.addfile(entry, io.BytesIO(body))
            manifest['files'].append({'name': name, 'sha256': hashlib.sha256(body).hexdigest()})
    manifest_file = OUT / 'payload-manifest.json'
    manifest_file.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    for file in [bundle, manifest_file] + list(OUT.glob('*.ipk')):
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        file.with_name(file.name + '.sha256').write_bytes((digest + '  ' + file.name + '\n').encode('ascii'))
    kit = OUT / 'cleanyourtv-webos4-install-kit.tgz'
    runtime_files = []
    if args.runtime:
        runtime_manifest = json.loads((ROOT / 'webos4/runtime-manifest.json').read_text())
        profile = json.loads((ROOT / 'webos4/profile.json').read_text())
        assert hashlib.sha256((ROOT / 'webos4/runtime-manifest.json').read_bytes()).hexdigest() == profile['runtimeManifestSha256']
        runtime_archive = OUT / 'node-v18.17.1-webos4-armv7.tgz'
        with runtime_archive.open('wb') as raw:
            with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode='w', format=tarfile.GNU_FORMAT) as archive:
                    for item in runtime_manifest['files']:
                        body = (args.runtime / item['name']).read_bytes()
                        if len(body) != item['size'] or hashlib.sha256(body).hexdigest() != item['sha256']:
                            raise ValueError('Runtime differs from the validated tree: ' + item['name'])
                        entry = tarfile.TarInfo(item['name'])
                        entry.size, entry.mode, entry.mtime = len(body), 0o700, 1761000000
                        archive.addfile(entry, io.BytesIO(body))
        runtime_archive.with_name(runtime_archive.name + '.sha256').write_text(hashlib.sha256(runtime_archive.read_bytes()).hexdigest() + '  ' + runtime_archive.name + '\n', encoding='ascii')
        runtime_files = [runtime_archive]
    kit_files = ['install.sh', 'scripts/bootstrap.sh', 'scripts/check-tv.sh', 'webos4/setup.sh', 'webos4/setup.js', 'webos4/profile.json',
                 'webos4/runtime-install.js', 'webos4/runtime-manifest.json']
    with tarfile.open(kit, 'w:gz', format=tarfile.GNU_FORMAT) as archive:
        for name in kit_files:
            body = (ROOT / name).read_bytes().replace(b'\r\n', b'\n')
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode, entry.mtime = len(body), 0o600, 1761000000
            archive.addfile(entry, io.BytesIO(body))
        for file in [bundle, manifest_file] + list(OUT.glob('*.ipk')) + runtime_files:
            for source in (file, file.with_name(file.name + '.sha256')):
                body = source.read_bytes()
                entry = tarfile.TarInfo('artifacts/' + source.name)
                entry.size, entry.mode, entry.mtime = len(body), 0o600, 1761000000
                archive.addfile(entry, io.BytesIO(body))
    kit.with_name(kit.name + '.sha256').write_text(hashlib.sha256(kit.read_bytes()).hexdigest() + '  ' + kit.name + '\n', encoding='ascii')
    print('Trial artifacts ready; nothing installed on the TV.')
