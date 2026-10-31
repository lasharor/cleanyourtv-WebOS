#!/usr/bin/env python3
"""Build only the experimental standalone webOS 4 IPK and manual helper bundle."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get('CYTV_DIST') or ROOT / 'dist' / 'webos4')
INFO = json.loads((ROOT / 'webos4/app/appinfo.json').read_text())
VERSION = INFO['version']

subprocess.run(['node', str(ROOT / 'tools/build-pages.js')], check=True)
OUT.mkdir(parents=True, exist_ok=True)
ipk = OUT / (INFO['id'] + '_' + VERSION + '_all.ipk')
subprocess.run([sys.executable, str(ROOT / 'ipk/build-ipk.py'), str(ROOT / 'webos4/app'), str(ipk)], check=True)

# An allowlist keeps bootstrap, hooks and the manager out of the manual prototype.
files = ['helper/' + name + '.js' for name in
         ('webos4', 'apps', 'config', 'paths', 'web', 'server', 'luna', 'exec', 'diag', 'netcompat')]
files += ['webos4/service.sh', 'webos4/home.sh', 'webos4/home-bind.js',
          'webos4/home-lab.js', 'webos4/home-lab.sh', 'webos4/test-home.py', 'webos4/Probar-HOME.cmd',
          'webos4/home-input.c', 'webos4/build-home-input.sh', 'webos4/home-input-trial.sh', 'LICENSE', 'docs/webos4.md']
files += ['docs/webos4-history.md', 'docs/webos4-research.md', 'docs/webos4-pr.md', 'docs/webos4-validation.md', 'docs/webos4-bluetooth.md']
bundle = OUT / ('cleanyourtv-webos4-' + VERSION + '.tgz')
with tarfile.open(bundle, 'w:gz', format=tarfile.GNU_FORMAT) as archive:
    for name in files:
        body = (ROOT / name).read_bytes().replace(b'\r\n', b'\n')
        entry = tarfile.TarInfo(name)
        entry.size = len(body)
        entry.mode = 0o755 if name.endswith('.sh') else 0o644
        entry.mtime = 1761000000
        archive.addfile(entry, io.BytesIO(body))

# Optional controllers are shipped separately and never installed by the IPK/helper.
addons = OUT / ('cleanyourtv-webos4-addons-' + VERSION + '.tgz')
with tarfile.open(addons, 'w:gz', format=tarfile.GNU_FORMAT) as archive:
    for name in (
        'debloat-stop.sh', 'debloat-undo.sh', 'shutdownfix.sh',
        'bluetooth-accept.js', 'bluetooth.sh', '25-cleanyourtv-bluetooth',
        'netflix-source-exit.js', 'netflix.sh', '30-cleanyourtv-netflix',
        'home-startup.sh', '10-cleanyourtv-home', 'generate-home-patch.py', 'home-changes.json',
        'keyfilters-original.json', 'keyfilters-cleanyourtv.json',
        'research-debloat/README.md', 'research-debloat/debloat-stop.sh', 'research-debloat/debloat-undo.sh',
    ):
        file = ROOT / 'webos4' / name
        body = file.read_bytes().replace(b'\r\n', b'\n')
        entry = tarfile.TarInfo('webos4/' + name)
        entry.size = len(body)
        entry.mode = 0o755 if file.suffix == '.sh' or file.name[:2].isdigit() else 0o644
        entry.mtime = 1761000000
        archive.addfile(entry, io.BytesIO(body))

for artifact in (ipk, bundle, addons):
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_name(artifact.name + '.sha256').write_bytes((digest + '  ' + artifact.name + '\n').encode('ascii'))
    print(str(artifact))
