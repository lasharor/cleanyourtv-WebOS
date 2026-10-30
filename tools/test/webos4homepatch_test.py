"""Synthetic fixtures only; no proprietary firmware required."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('home', ROOT / 'webos4/generate-home-patch.py')
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)


class HomePatchTest(unittest.TestCase):
    def test_unique_replacement(self):
        self.assertEqual(home.transform('before\nrest\n', [('before', 'after')]), 'after\nrest\n')

    def test_ambiguous_or_missing_anchor(self):
        for text in ('unknown', 'before before'):
            with self.assertRaises(ValueError):
                home.transform(text, [('before', 'after')])

    def test_firmware_guard(self):
        with self.assertRaisesRegex(ValueError, 'Unknown firmware'):
            home.generate(b'unknown firmware')


if __name__ == '__main__':
    unittest.main()
