#!/usr/bin/env python3
"""Read-only application/configuration backup over SSH. No firmware image or TV changes."""
import argparse
import datetime
import hashlib
import gzip
import json
import os
from pathlib import Path
import shlex
import tarfile

PATHS = (
    'media/developer/cleanyourtv',
    'media/developer/node-test/runtime',
    'media/developer/apps/usr/palm/applications/com.cleanyourtv.webos4',
    'media/developer/apps/usr/palm/packages/com.cleanyourtv.webos4',
    'var/lib/webosbrew/init.d',
    'var/lib/webosbrew/cleanyourtv-home',
    'var/lib/webosbrew/netflix-source-exit',
    'var/lib/webosbrew/cleanyourtv-bluetooth.json',
    'var/lib/webosbrew/netflix-preload-20261029',
    'home/root/.config/lginputhook',
)
SNAPSHOTS = {
    'keyfilters': ('com.webos.service.config/getConfigs', {'configNames': ['com.webos.surfacemanager.keyFilters']}),
    'startup-settings': ('com.webos.settingsservice/getSystemSettings', {'category': 'general', 'keys': ['homeAutoLaunch', 'checkHomeAutoLaunchValue']}),
    'appinfo': ('com.webos.applicationManager/getAppInfo', {'id': 'com.cleanyourtv.webos4'}),
}


def command(client, text):
    _, out, err = client.exec_command(text, timeout=60)
    value, error = out.read(), err.read()
    if out.channel.recv_exit_status():
        raise RuntimeError('SSH read failed: ' + error.decode('utf-8', 'replace')[:180])
    return value


def verify_archive(file):
    # Read through the gzip footer too: tar end markers alone do not prove a complete transfer.
    with gzip.open(file, 'rb') as stream:
        while stream.read(1024 * 1024):
            pass
    count = 0
    with tarfile.open(file, 'r:gz') as archive:
        for entry in archive:
            if entry.name.startswith('/') or '..' in Path(entry.name).parts:
                raise ValueError('Unexpected archive path')
            if entry.isfile():
                body = archive.extractfile(entry)
                while body.read(1024 * 1024):
                    pass
            count += 1
    if not count:
        raise ValueError('Empty backup')
    digest = hashlib.sha256()
    with file.open('rb') as body:
        for block in iter(lambda: body.read(1024 * 1024), b''):
            digest.update(block)
    return count, digest.hexdigest()


def backup(client, out):
    os.umask(0o077)
    out.mkdir(parents=True, exist_ok=False)
    present = []
    for name in PATHS:
        if command(client, 'if [ -e %s ] || [ -L %s ]; then echo yes; fi' % (shlex.quote('/' + name), shlex.quote('/' + name))).strip() == b'yes':
            present.append(name)
    if 'media/developer/cleanyourtv' not in present:
        raise RuntimeError('Known stable deployment not found; no backup reported as successful')
    for name, (uri, body) in SNAPSHOTS.items():
        raw = command(client, 'luna-send -n 1 -w 5000 luna://%s %s </dev/null' % (uri, shlex.quote(json.dumps(body))))
        parsed = json.loads(raw)
        if parsed.get('returnValue') is not True:
            raise RuntimeError('State snapshot failed: ' + name)
        (out / (name + '.json')).write_bytes(raw)
    for name, text in {
        'mounts.txt': 'cat /proc/mounts',
        'systemUi-live.js': 'cat /usr/lib/qt5/qml/KeyFilters/systemUi.js',
        'shutdown-live.conf': 'cat /etc/init/shutdown.conf',
        'hosts-live': 'cat /etc/hosts',
    }.items():
        (out / name).write_bytes(command(client, text))
    target = out / 'stable-installation.tgz'
    partial = out / 'stable-installation.tgz.partial'
    _, stdout, stderr = client.exec_command('tar -czpf - -C / ' + ' '.join(shlex.quote(p) for p in present), timeout=180)
    with partial.open('xb') as file:
        while True:
            block = stdout.read(1024 * 1024)
            if not block:
                break
            file.write(block)
    error = stderr.read()
    if stdout.channel.recv_exit_status():
        raise RuntimeError('Archive incomplete: ' + error.decode('utf-8', 'replace')[:180])
    members, digest = verify_archive(partial)
    partial.rename(target)
    (out / (target.name + '.sha256')).write_text(digest + '  ' + target.name + '\n', encoding='ascii')
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir() if p.is_file() and p != target}
    manifest = {'created': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'paths': present,
                'members': members, 'archive_sha256': digest, 'snapshots_sha256': hashes,
                'scope': 'Stable application and configuration backup; not a firmware image; no changes made on TV'}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('Backup verificado: %s (%d entradas)' % (out, members))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default=os.environ.get('CYTV_TV_HOST'))
    parser.add_argument('--key', type=Path, default=Path.home() / '.ssh/id_tv_webos')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    import paramiko
    host = args.host or input('Dirección de la TV: ').strip()
    output = args.out or Path(__file__).resolve().parents[1] / 'dist/webos4/backups' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    try:
        client.connect(host, username='root', key_filename=str(args.key), timeout=8, banner_timeout=8,
                       auth_timeout=8, allow_agent=False, look_for_keys=False)
        backup(client, output)
    finally:
        client.close()


if __name__ == '__main__':
    main()
