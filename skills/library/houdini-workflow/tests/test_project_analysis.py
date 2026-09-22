"""Synthetic archive tests; no Houdini installation or user scenes touched."""
import io
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import extract_hip
import parse_hip
import extract_vex


def entry(name, content=b'', mode=stat.S_IFREG | 0o644):
    raw = name.encode() + b'\0'
    values = [0, 0, mode, 0, 0, 1, 0, 0, len(raw), len(content)]
    sizes = [6, 6, 6, 6, 6, 6, 6, 11, 6, 11]
    return b'070707' + ''.join(f'{v:0{n}o}' for v, n in zip(values, sizes)).encode() + raw + content


def archive(*entries):
    return b''.join(entries) + entry('TRAILER!!!')


class AnalysisTests(unittest.TestCase):
    def extract(self, content, tmp):
        src = Path(tmp) / 'source.hip'
        src.write_bytes(content)
        dst = Path(tmp) / 'extracted'
        return extract_hip.extract_cpio_odc(src, dst), dst

    def test_supported_archive_preserves_all_networks_and_vex(self):
        with tempfile.TemporaryDirectory() as tmp:
            entries = []
            for node in ['obj/a/wrangle', 'obj/b/wrangle', 'stage/third/wrangle']:
                entries.extend([entry(node + '.init', b'type = attribwrangle\n'), entry(node + '.parm', b'snippet [ 0 ] ( "@P.y = 2;" )\n')])
            files, dst = self.extract(archive(*entries), tmp)
            self.assertEqual(len(files), 6)
            text = io.StringIO()
            parse_hip.dump_tree(parse_hip.find_default_subnet(dst), file=text)
            self.assertEqual(text.getvalue().count('attribwrangle'), 3)
            self.assertEqual(sum(t == 'attribwrangle' for _, t, _ in extract_vex.walk(extract_vex.find_default_subnet(dst))), 3)
            out = Path(tmp) / 'report'
            subprocess.run([sys.executable, str(Path(extract_vex.__file__)), str(dst), str(out)], check=True, capture_output=True)
            self.assertEqual((out / '01_all_wrangles.md').read_text().count('@P.y = 2;'), 3)

    def test_unsafe_paths_links_and_case_collisions_rejected(self):
        cases = [archive(entry(n)) for n in ['../escape', '/absolute', 'C:/escape', 'a\\b', 'NUL', 'foo.']]
        cases += [archive(entry('link', b'other', stat.S_IFLNK | 0o777)), archive(entry('A'), entry('a'))]
        for data in cases:
            with self.subTest(data=data[:120]), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ValueError): self.extract(data, tmp)
                self.assertFalse((Path(tmp) / 'extracted').exists())

    def test_malformed_or_unsupported_input_leaves_no_partial_result(self):
        for data in [b'not hip', entry('valid', b'x'), archive(entry('ok'))[:-5], archive(entry('ok')) + b'garbage']:
            with self.subTest(data=data[:20]), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ValueError): self.extract(data, tmp)
                self.assertFalse((Path(tmp) / 'extracted').exists())

    def test_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / 'extracted'
            dst.mkdir()
            (dst / 'keep').write_text('untouched')
            with self.assertRaises(ValueError): self.extract(archive(entry('keep', b'replace')), tmp)
            self.assertEqual((dst / 'keep').read_text(), 'untouched')

    def test_symlink_destination_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'elsewhere'
            target.mkdir()
            (Path(tmp) / 'extracted').symlink_to(target, target_is_directory=True)
            with self.assertRaises(ValueError): self.extract(archive(entry('write')), tmp)
            self.assertEqual(list(target.iterdir()), [])


if __name__ == '__main__': unittest.main()
