"""No SSH or TV access: exercise the PC-side safety boundaries with stand-ins."""
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('home_test', ROOT / 'webos4/test-home.py')
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)


class DriverTest(unittest.TestCase):
    def test_baseline_refuses_previous_home_changes(self):
        class Sftp:
            binds = b'{}'
            mounts = b''
            boot = ['inputhook']
            def open(self, name):
                return io.BytesIO(self.mounts if name == '/proc/mounts' else self.binds)
            def listdir(self, _):
                return self.boot
        sftp = Sftp()
        home.baseline(sftp)
        sftp.binds = b'{"773":{"action":"exec","command":"other"}}'
        with self.assertRaisesRegex(RuntimeError, 'asignacion'):
            home.baseline(sftp)
        sftp.binds = b'{}'
        sftp.mounts = b'/dev/root /usr/lib/qt5/qml/KeyFilters/systemUi.js ext4 ro 0 0'
        with self.assertRaisesRegex(RuntimeError, 'QML'):
            home.baseline(sftp)
        sftp.mounts = b''
        sftp.boot = ['inputhook', '10-cleanyourtv-home']
        with self.assertRaisesRegex(RuntimeError, 'arranque'):
            home.baseline(sftp)

    def test_plan_is_offline(self):
        result = subprocess.run([sys.executable, str(ROOT / 'webos4/test-home.py'), '--list'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('probe', ' '.join(key for key, _ in home.VARIANTS))
        self.assertIn('dos minutos', result.stdout)

    def test_observer_plan_does_not_run_binding_variants(self):
        result = subprocess.run([sys.executable, str(ROOT / 'webos4/test-home.py'), '--observe', '--list'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('sin cambiar la asignacion', result.stdout)
        self.assertNotIn('orden recent', result.stdout)

    def test_readonly_helper_is_refused(self):
        with patch.object(home, 'run', return_value='{"readOnly":true}'):
            with self.assertRaisesRegex(RuntimeError, 'no permite'):
                home.helper(None, None)

    def test_live_helper_is_kept_running(self):
        with patch.object(home, 'run', return_value='{"readOnly":false}') as remote:
            home.helper(None, None)
            self.assertEqual(remote.call_count, 1)
            self.assertIn('/api/service', remote.call_args.args[1])

    def test_old_or_unknown_helper_is_not_started(self):
        class Sftp:
            def open(self, *_):
                return io.BytesIO(b'not the validated helper')
        with patch.object(home, 'run', side_effect=RuntimeError('unavailable')) as remote:
            with self.assertRaisesRegex(RuntimeError, 'difiere'):
                home.helper(None, Sftp())
            self.assertEqual(remote.call_count, 1)


if __name__ == '__main__':
    unittest.main()
