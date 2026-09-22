import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('dependencies', Path(__file__).parents[1] / 'scripts/windows-dependencies.py')
dependencies = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dependencies)


def wheel(extra=None):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        for name, value in {'win32/lib/pywintypes.py': b'fixture',
                            'pywin32_system32/pywintypes312.dll': b'fixture', **(extra or {})}.items():
            z.writestr(name, value)
    return stream.getvalue()


class WindowsDependenciesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dependency 中文 ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'blender-mcp'
        (self.root / 'blender_mcp').mkdir(parents=True)
        for name in ['__init__.py', 'server.py']:
            (self.root / 'blender_mcp' / name).write_text('fixture')
        self.missing = {'ok': False, 'code': 'missing_module', 'module': 'pywintypes'}

    def test_status_and_unrelated_errors_never_download(self):
        for repair, outcome in [(False, self.missing), (True, {'ok': True, 'code': 'dependencies_ready'}),
                                (True, {**self.missing, 'module': 'something_else'})]:
            result = dependencies.repair(self.root, repair, probe_impl=lambda r: outcome,
                                         download_impl=lambda: self.fail('unexpected download'))
            self.assertEqual(result, outcome)

    def test_missing_dependency_is_completed_and_rechecked(self):
        probes = iter([self.missing, self.missing, {'ok': True, 'code': 'dependencies_ready'}])
        result = dependencies.repair(self.root, True, probe_impl=lambda r: next(probes), download_impl=wheel)
        self.assertTrue(result['repaired'])
        self.assertEqual((self.root / 'win32/lib/pywintypes.py').read_bytes(), b'fixture')
        self.assertFalse((self.root / '.skill-windows-repair.lock').exists())

    def test_existing_files_cannot_be_overwritten(self):
        target = self.root / 'win32/lib/pywintypes.py'
        target.parent.mkdir(parents=True); target.write_bytes(b'user content')
        result = dependencies.repair(self.root, True, probe_impl=lambda r: self.missing, download_impl=wheel)
        self.assertEqual(result['code'], 'dependency_conflict')
        self.assertEqual(target.read_bytes(), b'user content')
        self.assertFalse((self.root / 'pywin32_system32').exists())

    def test_busy_repair_never_removes_another_owners_lock(self):
        lock = self.root / '.skill-windows-repair.lock'; lock.mkdir()
        result = dependencies.repair(self.root, True, probe_impl=lambda r: self.missing,
                                     download_impl=lambda: self.fail('download while busy'))
        self.assertEqual(result['code'], 'dependency_repair_busy')
        self.assertTrue(lock.is_dir())

    def test_unsafe_archive_paths_are_rejected_before_writes(self):
        for name in ['../escape.py', '/absolute', 'win32/../../escape', 'C:/escape']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                dependencies.wheel_files(wheel({name: b'bad'}))
        with self.assertRaises(ValueError):
            dependencies.wheel_files(wheel({'win32/escape': b'bad'}).replace(b'win32/escape', b'win32\\escape'))

    def test_partial_identical_install_can_finish_without_overwriting(self):
        files = dependencies.wheel_files(wheel())
        dependencies.install_missing(self.root, {'win32/lib/pywintypes.py': b'fixture'})
        dependencies.install_missing(self.root, files)
        self.assertTrue((self.root / 'pywin32_system32/pywintypes312.dll').is_file())

    def test_symlink_cannot_redirect_dependency_files(self):
        outside = Path(self.temp.name) / 'outside'; outside.mkdir()
        (self.root / 'win32').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            dependencies.install_missing(self.root, dependencies.wheel_files(wheel()))
        self.assertEqual(list(outside.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
