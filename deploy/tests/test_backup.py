import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup', Path(__file__).parents[1] / 'backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        (self.app / 'server').mkdir(parents=True)
        (self.app / 'state').mkdir()
        (self.app / 'server/accounts.sqlite').write_bytes(b'test-account-db')
        (self.app / 'server/access.json').write_text('{"test":"server-config"}')
        (self.app / 'state/business.sqlite').write_bytes(b'test-note-model-oauth-attachment-db')
        self.cert = self.root / 'caddy'
        self.cert.mkdir()
        (self.cert / 'cert-test').write_text('test-certificate-state')
        self.archive = self.root / 'backup.tar.gz'
        self.dest = self.root / 'staging'
        self.dest.mkdir()

    def test_roundtrip_includes_all_state_and_empty_directories(self):
        (self.app / 'state/empty').mkdir()
        expected = backup.pack({'app': self.app, 'caddy': self.cert}, self.archive, 'source')
        actual = backup.unpack(self.archive, self.dest)
        self.assertEqual(expected, actual)
        for name, sha in actual['files'].items():
            self.assertEqual(backup.digest(self.dest / name), sha)
        self.assertTrue((self.dest / 'app/state/empty').is_dir())
        self.assertEqual(self.archive.stat().st_mode & 0o777, 0o600)

    def test_backup_does_not_overwrite(self):
        self.archive.write_bytes(b'previous')
        with self.assertRaises(FileExistsError):
            backup.pack({'app': self.app}, self.archive, 'source')
        self.assertEqual(self.archive.read_bytes(), b'previous')

    def test_reject_incomplete_backup(self):
        with self.assertRaisesRegex(ValueError, 'account database'):
            backup.pack({'caddy': self.cert}, self.archive, 'source')

    def test_corrupt_file_fails_verification(self):
        manifest = backup.pack({'app': self.app}, self.archive, 'docker')
        altered = self.root / 'altered.tar.gz'
        with tarfile.open(self.archive) as source, tarfile.open(altered, 'w:gz') as target:
            for member in source.getmembers():
                data = source.extractfile(member).read() if member.isfile() else None
                if member.name == 'manifest.json':
                    manifest['files']['app/server/accounts.sqlite'] = '0' * 64
                    data = json.dumps(manifest).encode()
                    member.size = len(data)
                target.addfile(member, io.BytesIO(data) if data is not None else None)
        with self.assertRaisesRegex(ValueError, 'checksum'):
            backup.unpack(altered, self.dest)

    def test_reject_traversal_links_special_and_duplicate_members(self):
        for name, kind in [('../escaped', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('app/link', tarfile.SYMTYPE), ('app/hard', tarfile.LNKTYPE),
                           ('app/pipe', tarfile.FIFOTYPE), ('app/duplicate', tarfile.REGTYPE)]:
            with self.subTest(name=name):
                with tarfile.open(self.archive, 'w:gz') as target:
                    entry = tarfile.TarInfo(name)
                    entry.type = kind
                    target.addfile(entry)
                    if name.endswith('duplicate'):
                        target.addfile(entry)
                with self.assertRaises(ValueError):
                    backup.unpack(self.archive, self.dest)
        self.assertFalse((self.root / 'escaped').exists())


if __name__ == '__main__':
    unittest.main()