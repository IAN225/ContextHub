"""Archive verification tests. Uses temporary files, never a deployed instance."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import backup


class BackupArchiveTests(unittest.TestCase):
    def archive(self, root, entries, *, checksum=None):
        path = root / 'test.tar.gz'
        data = b'database fixture'
        manifest = {'format': backup.FORMAT, 'mode': 'source', 'roots': ['app'],
                    'files': {'app/server/accounts.sqlite': checksum or hashlib.sha256(data).hexdigest()}}
        with tarfile.open(path, 'w:gz') as archive:
            for name, value, kind in [('manifest.json', json.dumps(manifest).encode(), tarfile.REGTYPE),
                                      ('app/server/accounts.sqlite', data, tarfile.REGTYPE), *entries]:
                info = tarfile.TarInfo(name)
                info.type = kind
                info.size = len(value) if kind == tarfile.REGTYPE else 0
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    info.linkname = '../../outside'
                archive.addfile(info, io.BytesIO(value) if info.size else None)
        return path

    def test_valid_and_checksum(self):
        for corrupt in [False, True]:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.archive(root, [], checksum='bad' if corrupt else None)
                if corrupt:
                    with self.assertRaisesRegex(ValueError, 'checksum'):
                        backup.unpack(path, root / 'staging')
                else:
                    backup.unpack(path, root / 'staging')
                    self.assertEqual((root / 'staging/app/server/accounts.sqlite').read_bytes(), b'database fixture')

    def test_unsafe_entries(self):
        for name, kind in [('../outside', tarfile.REGTYPE), ('/outside', tarfile.REGTYPE),
                           ('app//double', tarfile.REGTYPE), ('app/./dot', tarfile.REGTYPE),
                           ('app/back\\slash', tarfile.REGTYPE), ('app/link', tarfile.SYMTYPE),
                           ('app/hard', tarfile.LNKTYPE), ('app/device', tarfile.CHRTYPE),
                           ('app/server/accounts.sqlite', tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.archive(root, [(name, b'bad', kind)])
                with self.assertRaises(ValueError):
                    backup.unpack(path, root / 'staging')
                self.assertFalse((root / 'staging').exists())

    def test_limits_before_extraction(self):
        for setting, limit in [('MAX_FILES', 1), ('MAX_EXPANDED_BYTES', 1)]:
            with tempfile.TemporaryDirectory() as directory, patch.object(backup, setting, limit):
                root = Path(directory)
                path = self.archive(root, [])
                with self.assertRaisesRegex(ValueError, 'limits'):
                    backup.unpack(path, root / 'staging')
                self.assertFalse((root / 'staging').exists())


if __name__ == '__main__':
    unittest.main()
