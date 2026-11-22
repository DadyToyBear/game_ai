#!/usr/bin/env python3
"""Patch Redot 26.3 RC2's TinyEXR input size for 32-bit WebAssembly."""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('Usage: python build-patches/fix_tinyexr.py <redot-source-dir>')

path = Path(sys.argv[1]) / 'modules/tinyexr/image_loader_tinyexr.cpp'
source = path.read_text(encoding='utf-8')
old = '''\tERR_FAIL_COND_V(src_image_len == 0, ERR_FILE_CORRUPT);
\tsrc_image.resize(src_image_len);

\tuint8_t *w = src_image.ptrw();
\tconst uint64_t bytes_read = f->get_buffer(&w[0], src_image_len);
\tERR_FAIL_COND_V(bytes_read != src_image_len, ERR_FILE_CANT_READ);
\tconst std::span buffer{ w, src_image_len };'''
new = '''\tERR_FAIL_COND_V(src_image_len == 0, ERR_FILE_CORRUPT);
\tERR_FAIL_COND_V(src_image_len > static_cast<uint64_t>(std::numeric_limits<size_t>::max()) || src_image_len > static_cast<uint64_t>(std::numeric_limits<Vector<uint8_t>::Size>::max()), ERR_OUT_OF_MEMORY);
\tconst Error resize_error = src_image.resize(static_cast<Vector<uint8_t>::Size>(src_image_len));
\tERR_FAIL_COND_V(resize_error != OK, resize_error);

\tuint8_t *w = src_image.ptrw();
\tconst uint64_t bytes_read = f->get_buffer(&w[0], src_image_len);
\tERR_FAIL_COND_V(bytes_read != src_image_len, ERR_FILE_CANT_READ);
\tconst std::span buffer{ w, static_cast<size_t>(src_image_len) };'''
include = '#include <zlib.h>'
if source.count(old) != 1 or source.count(include) != 1:
    raise SystemExit(f'Redot source does not match the expected RC2 version: {path}')
source = source.replace(include, '#include <limits>\n' + include, 1).replace(old, new, 1)
path.write_text(source, encoding='utf-8')
print(f'Applied TinyEXR WebAssembly size fix to {path}')
