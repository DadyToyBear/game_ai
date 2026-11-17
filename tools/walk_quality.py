#!/usr/bin/env python3
"""Оценка «живости» спрайт-листа ходьбы.

Считает, насколько кадры отличаются друг от друга: если разница близка к
нулю, цикл в игре будет выглядеть как стоп-кадр. Метрика — средняя доля
изменившихся пикселей между соседними ячейками (по альфе и по цвету).

Запуск:
  python3 tools/walk_quality.py assets/animations/**/*_walk_row.png
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

MOTION_OK = 0.06      # доля изменившихся пикселей, при которой цикл читается


def score(path):
    im = Image.open(path).convert("RGBA")
    side = os.path.splitext(path)[0] + ".json"
    cell_w, cell_h = im.width // 8, im.height
    if os.path.exists(side):
        with open(side) as fh:
            meta = json.load(fh)
        cell_w, cell_h = meta["cell_w"], meta["cell_h"]
    n = im.width // cell_w
    a = np.asarray(im).astype(np.int16)
    cells = [a[:, i * cell_w:(i + 1) * cell_w] for i in range(n)]

    diffs = []
    for i in range(n):
        p, q = cells[i], cells[(i + 1) % n]
        h = min(p.shape[0], q.shape[0])
        w = min(p.shape[1], q.shape[1])
        p, q = p[:h, :w], q[:h, :w]
        changed = np.abs(p[:, :, :3] - q[:, :, :3]).max(axis=2) > 12
        both_empty = (p[:, :, 3] < 20) & (q[:, :, 3] < 20)
        changed &= ~both_empty
        diffs.append(changed.mean())

    return n, cell_w, cell_h, float(np.mean(diffs)), float(np.min(diffs))


def main(argv):
    paths = []
    for p in argv:
        paths.extend(sorted(glob.glob(p, recursive=True)) if any(c in p for c in "*?[") else [p])
    if not paths:
        print(__doc__)
        return 1
    print(f"{'лист':38s} {'кадров':>6s} {'ячейка':>10s} {'движение':>9s} {'мин':>6s}  вердикт")
    for p in paths:
        n, cw, ch, mean_d, min_d = score(p)
        verdict = "ok" if mean_d >= MOTION_OK else "почти стоп-кадр"
        print(f"{os.path.basename(p):38s} {n:6d} {cw:4d}x{ch:<4d} "
              f"{mean_d * 100:8.1f}% {min_d * 100:5.1f}%  {verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
