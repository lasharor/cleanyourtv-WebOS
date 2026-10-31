#!/usr/bin/env python3
"""Extract the pinned third-party runtime locally, without installing or executing its app."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile

HERE = Path(__file__).resolve().parent


def data_archive(blob):
    if blob[:8] != b'!<arch>\n':
        raise ValueError('Not an IPK/ar archive')
    pos, data = 8, None
    while pos < len(blob):
        header = blob[pos:pos + 60]
        if len(header) != 60 or header[58:] != b'`\n':
            raise ValueError('Invalid IPK header')
        size = int(header[48:58])
        if size < 0 or pos + 60 + size > len(blob):
            raise ValueError('Truncated IPK member')
        if header[:16].decode('ascii').strip().rstrip('/') == 'data.tar.gz':
            if data is not None:
                raise ValueError('Duplicate data archive')
            data = blob[pos + 60:pos + 60 + size]
        pos += 60 + size + size % 2
    if data is None:
        raise ValueError('Missing data archive')
    return data


def prepare(ipk, output, source, manifest):
    if output.exists():
        raise FileExistsError('Runtime output already exists; nothing overwritten')
    blob = ipk.read_bytes()
    if hashlib.sha256(blob).hexdigest() != source['sha256']:
        raise ValueError('Source IPK checksum differs from the pinned release')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data_archive(blob)), mode='r:gz') as archive:
        entries = {entry.name.removeprefix('./'): entry for entry in archive.getmembers()}
        for item in manifest['files']:
            name = item['name']
            if not re.fullmatch(r'node18|lib/[\w.+-]+', name) or name in files:
                raise ValueError('Unsafe/duplicate runtime manifest path')
            entry = entries[source['prefix'] + name]
            if entry.isdir() or entry.size > 64 * 1024 * 1024:
                raise ValueError('Unexpected runtime member')
            # Resolve archive symlinks in memory; never extract package paths onto disk.
            with archive.extractfile(entry) as stream:
                body = stream.read(64 * 1024 * 1024 + 1)
            if len(body) != item['size'] or hashlib.sha256(body).hexdigest() != item['sha256']:
                raise ValueError('Runtime bytes differ: ' + name)
            files[name] = body
    if not files:
        raise ValueError('Empty runtime manifest')
    output.mkdir(mode=0o700)
    (output / 'lib').mkdir(mode=0o700)
    for name, body in files.items():
        file = output / name
        file.write_bytes(body)
        file.chmod(0o700)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipk', type=Path, help='downloaded release named in runtime-source.json')
    parser.add_argument('output', type=Path, help='new private local directory, normally under ignored dist/')
    args = parser.parse_args()
    manifest_file = HERE / 'runtime-manifest.json'
    profile = json.loads((HERE / 'profile.json').read_text())
    if hashlib.sha256(manifest_file.read_bytes()).hexdigest() != profile['runtimeManifestSha256']:
        raise ValueError('Runtime manifest differs from the pinned profile')
    prepare(args.ipk, args.output, json.loads((HERE / 'runtime-source.json').read_text()), json.loads(manifest_file.read_text()))
    print('Verified runtime prepared locally; no third-party app installed or executed')
