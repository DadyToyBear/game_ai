#!/usr/bin/env python3
"""Locate the x64 GUI executable in the verified official Redot archive."""
from pathlib import Path
import struct

root = Path('bundle')
candidates = []
for path in (root / 'editor').rglob('*.exe'):
    if 'redot' not in path.name.lower() or 'console' in path.name.lower():
        continue
    with path.open('rb') as f:
        header = f.read(64)
        if len(header) < 64 or header[:2] != b'MZ':
            continue
        f.seek(struct.unpack_from('<I', header, 60)[0])
        pe = f.read(6)
        if pe[:4] == b'PE\0\0' and int.from_bytes(pe[4:], 'little') == 0x8664:
            candidates.append(path)
if len(candidates) != 1:
    raise SystemExit(f'Expected one x64 GUI editor, found {candidates}')
(root / 'editor-path.txt').write_text(candidates[0].relative_to(root).as_posix() + '\n', encoding='utf-8')
print('Selected', candidates[0])
