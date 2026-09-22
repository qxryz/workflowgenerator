"""Extract supported ASCII cpio HIP containers without executing embedded content.

Usage: python extract_hip.py source.hip new-output-directory
Rejects malformed archives, unsafe paths, links and existing destinations.
"""
import argparse
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile

MAX_BYTES = 256 * 1024 * 1024
MAX_ENTRIES = 100000


def parse_entries(data):
    pos, entries, seen = 0, [], set()
    while pos < len(data):
        header = data[pos:pos + 76]
        if len(header) != 76 or header[:6] != b'070707':
            raise ValueError('Unsupported or truncated HIP container: expected ASCII cpio 070707')
        if not re.fullmatch(b'[0-7]{70}', header[6:]):
            raise ValueError('Malformed cpio header')
        mode = int(header[18:24], 8)
        size, count = int(header[65:76], 8), int(header[59:65], 8)
        end_name = pos + 76 + count
        end = end_name + size
        if count < 2 or count > 4096 or end > len(data):
            raise ValueError('Truncated cpio name or payload')
        raw = data[pos + 76:end_name]
        if raw[-1:] != b'\0' or b'\0' in raw[:-1]:
            raise ValueError('Malformed cpio filename')
        name = raw[:-1].decode('utf-8', errors='strict')
        if name == 'TRAILER!!!':
            if size or data[end:].strip(b'\0'):
                raise ValueError('Unexpected content after cpio trailer')
            return entries
        p = PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name:
            raise ValueError('Unsafe archive path')
        for part in p.parts:
            if part.rstrip(' .') != part or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', part, re.I):
                raise ValueError('Nonportable archive path')
        kind = stat.S_IFMT(mode)
        if kind not in (stat.S_IFDIR, stat.S_IFREG):
            raise ValueError('Links and special files are unsupported')
        if not p.parts:
            if kind != stat.S_IFDIR:
                raise ValueError('Invalid archive root entry')
        else:
            key = str(p).casefold()
            if key in seen:
                raise ValueError('Duplicate archive path')
            seen.add(key)
            entries.append((p, kind, data[end_name:end]))
            if len(entries) > MAX_ENTRIES:
                raise ValueError('Archive entry limit exceeded')
        pos = end
    raise ValueError('Missing cpio trailer')


def extract_cpio_odc(src_path, dst_dir):
    src = Path(src_path)
    with src.open('rb') as f:
        data = f.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('HIP exceeds offline extraction limit; use application inspection')
    entries = parse_entries(data)
    if not any(kind == stat.S_IFREG for _, kind, _ in entries):
        raise ValueError('Archive contains no regular files')
    dst = Path(dst_dir).absolute()
    if os.path.lexists(dst):
        raise ValueError('Output already exists; choose a new directory')
    dst.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.hip-extract-', dir=dst.parent))
    try:
        files = []
        for rel, kind, content in entries:
            out = staging.joinpath(*rel.parts)
            if kind == stat.S_IFDIR:
                out.mkdir(parents=True, exist_ok=True)
            else:
                out.parent.mkdir(parents=True, exist_ok=True)
                with out.open('xb') as f:
                    f.write(content)
                files.append((str(rel), len(content)))
        # Reserve the destination before moving files, avoiding overwrites.
        dst.mkdir()
        try:
            for child in staging.iterdir():
                child.rename(dst / child.name)
        except Exception:
            shutil.rmtree(dst)
            raise
        return files
    finally:
        shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    try:
        files = extract_cpio_odc(args.source, args.output)
    except (OSError, ValueError) as error:
        parser.exit(2, f'Extraction failed: {error}\n')
    print(f'Extracted {len(files)} files to {args.output.absolute()}')


if __name__ == '__main__':
    main()
