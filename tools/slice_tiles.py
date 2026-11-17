#!/usr/bin/env python3
"""Нарезка листа тайлов поля боя на отдельные PNG (топдаун 2D).

Лист приходит нарисованным на пергаменте: восемь квадратов с зазорами.
Скрипт находит каждый квадрат как отдельную связную область, обрезает по
собственному bbox (без пергаментных полей), приводит к квадрату TILE x TILE
и складывает тайлы по именам из --names.

Запуск:
  python3 tools/slice_tiles.py assets/battle_scenarios/battle_tiles.png \\
      --names grass,road,river,ford,forest,wall,gate,bridge \\
      --out assets/battle_scenarios/tiles --sheet
"""
import argparse
import os

import numpy as np
from PIL import Image


TILE = 128
BG_TOL = 30.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--names", required=True)
    ap.add_argument("--out", default="assets/battle_scenarios/tiles")
    ap.add_argument("--tile", type=int, default=TILE)
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()

    a = np.asarray(Image.open(args.source).convert("RGB")).astype(np.float32)
    h, w, _ = a.shape

    # тайлы нарисованы на пергаменте: ищем «бумажные» зазоры между ними —
    # это надёжнее, чем связные области (рамки тайлов касаются друг друга)
    lum = a.mean(axis=2)
    chroma = a.max(axis=2) - a.min(axis=2)
    paper = (lum > 150) & (chroma > 18) & (chroma < 110)

    def gaps(profile, thr=0.9, min_len=10, min_gap=5):
        idx = np.nonzero(profile >= thr)[0]
        out = []
        if idx.size == 0:
            return out
        start = prev = idx[0]
        for x in idx[1:]:
            if x - prev > min_gap:
                out.append((int(start), int(prev) + 1))
                start = x
            prev = x
        out.append((int(start), int(prev) + 1))
        return [g for g in out if g[1] - g[0] >= min_len]

    col_gaps = gaps(paper[: h // 2].mean(axis=0))
    row_gaps = gaps(paper[:, : w // 2].mean(axis=1))
    print(f"{os.path.basename(args.source)}: зазоры по X {col_gaps}, по Y {row_gaps}")

    def spans(gap_list, total):
        """Участки между зазорами — сами тайлы."""
        out, prev_end = [], 0
        for g0, g1 in gap_list:
            if g0 - prev_end > 20:
                out.append((prev_end, g0))
            prev_end = g1
        if total - prev_end > 20:
            out.append((prev_end, total))
        return out

    xs = spans(col_gaps, w)
    ys = spans(row_gaps, h)
    boxes = [(x0, y0, x1, y1) for y0, y1 in ys for x0, x1 in xs]
    print(f"  сетка {len(xs)}x{len(ys)} = {len(boxes)} тайлов")

    names = [s.strip() for s in args.names.split(",") if s.strip()]
    if len(names) != len(boxes):
        print(f"  ! имён {len(names)}, тайлов {len(boxes)}")

    os.makedirs(args.out, exist_ok=True)
    saved = []
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        # срезаем нарисованную рамку тайла, чтобы швы не двоились в сетке
        pad = max(3, round(min(x1 - x0, y1 - y0) * 0.045))
        crop = a[y0 + pad:y1 - pad, x0 + pad:x1 - pad]
        tile = Image.fromarray(crop.astype(np.uint8), "RGB").resize(
            (args.tile, args.tile), Image.LANCZOS)
        name = names[i] if i < len(names) else f"tile_{i + 1}"
        tile.save(os.path.join(args.out, f"{name}.png"), optimize=True)
        saved.append((name, tile))
        print(f"  ok {name}.png  <- x{x0}-{x1} y{y0}-{y1}")

    if args.sheet and saved:
        cols = len(xs) or 4
        rows = (len(saved) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * args.tile, rows * args.tile))
        for i, (_, tile) in enumerate(saved):
            sheet.paste(tile, ((i % cols) * args.tile, (i // cols) * args.tile))
        path = os.path.join(args.out, "_sheet.png")
        sheet.save(path, optimize=True)
        print(f"  лист {path}: {sheet.width}x{sheet.height}")


if __name__ == "__main__":
    main()
