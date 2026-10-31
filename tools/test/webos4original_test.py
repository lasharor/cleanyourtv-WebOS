"""Offline backup integrity checks; never connects to the TV."""
import importlib.util
import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('backup', ROOT / 'webos4/backup-tv.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
spec = importlib.util.spec_from_file_location('runtime_source', ROOT / 'webos4/prepare-runtime.py')
runtime_source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime_source)


class BackupTest(unittest.TestCase):
    def test_valid_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'backup.tgz'
            with tarfile.open(file, 'w:gz') as archive:
                entry = tarfile.TarInfo('media/developer/cleanyourtv/config.json')
                entry.size = 2
                archive.addfile(entry, io.BytesIO(b'{}'))
            count, digest = backup.verify_archive(file)
            self.assertEqual(count, 1)
            self.assertEqual(len(digest), 64)
            file.write_bytes(file.read_bytes()[:-4])
            with self.assertRaises(EOFError):
                backup.verify_archive(file)

    def test_empty_corrupt_and_unsafe_archives(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'backup.tgz'
            with tarfile.open(file, 'w:gz'):
                pass
            with self.assertRaises(ValueError):
                backup.verify_archive(file)
            file.write_bytes(b'not a complete archive')
            with self.assertRaises((tarfile.TarError, OSError, EOFError)):
                backup.verify_archive(file)
            with tarfile.open(file, 'w:gz') as archive:
                archive.addfile(tarfile.TarInfo('../unsafe'))
            with self.assertRaises(ValueError):
                backup.verify_archive(file)

    def test_backup_refuses_an_existing_destination(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(FileExistsError):
                backup.backup(None, Path(folder))


class RuntimeSourceTest(unittest.TestCase):
    def fixture(self, folder, link=False):
        body = b'fixture runtime'
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            entry = tarfile.TarInfo('runtime/node18')
            entry.size = len(body)
            archive.addfile(entry, io.BytesIO(body))
            if link:
                entry = tarfile.TarInfo('runtime/lib/libuv.so.1')
                entry.type, entry.linkname = tarfile.SYMTYPE, '../node18'
                archive.addfile(entry)
        data = stream.getvalue()
        header = ('%-16s%-12d%-6d%-6d%-8s%-10d`\n' % ('data.tar.gz/', 0, 0, 0, '100644', len(data))).encode()
        blob = b'!<arch>\n' + header + data + (b'\n' if len(data) % 2 else b'')
        ipk = folder / 'source.ipk'
        ipk.write_bytes(blob)
        manifest = {'files': [{'name': name, 'size': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
                              for name in (['node18', 'lib/libuv.so.1'] if link else ['node18'])]}
        return ipk, {'sha256': hashlib.sha256(blob).hexdigest(), 'prefix': 'runtime/'}, manifest

    def test_exact_files_and_archive_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            ipk, source, manifest = self.fixture(folder, link=True)
            out = folder / 'out'
            runtime_source.prepare(ipk, out, source, manifest)
            self.assertEqual((out / 'node18').read_bytes(), (out / 'lib/libuv.so.1').read_bytes())
            self.assertFalse((out / 'lib/libuv.so.1').is_symlink())
            with self.assertRaises(FileExistsError):
                runtime_source.prepare(ipk, out, source, manifest)

    def test_checksum_content_and_path_refusals_before_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            ipk, source, manifest = self.fixture(folder)
            out = folder / 'out'
            for change in ['archive', 'content', 'path']:
                with self.subTest(change=change):
                    bad_source, bad_manifest = dict(source), {'files': [dict(manifest['files'][0])]}
                    if change == 'archive':
                        bad_source['sha256'] = '0' * 64
                    elif change == 'content':
                        bad_manifest['files'][0]['sha256'] = '0' * 64
                    else:
                        bad_manifest['files'][0]['name'] = '../escape'
                    with self.assertRaises(ValueError):
                        runtime_source.prepare(ipk, out, bad_source, bad_manifest)
                    self.assertFalse(out.exists())

    def test_invalid_and_truncated_ipk(self):
        with tempfile.TemporaryDirectory() as folder:
            ipk, _, _ = self.fixture(Path(folder))
            for data in [b'not an IPK', ipk.read_bytes()[:-20]]:
                with self.assertRaises(ValueError):
                    runtime_source.data_archive(data)


if __name__ == '__main__':
    unittest.main()
