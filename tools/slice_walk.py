#!/usr/bin/env python3
"""Сборка спрайт-листа ходьбы из кадра генератора.

Генератор рисует 4–8 фигур в ряд (иногда в два ряда), с разным масштабом и
разной «землёй». Просто порезать на равные куски нельзя — фигура будет
дёргаться. Скрипт:

  1) находит ряды фигур (по проекции «чернил» на Y) и кадры внутри ряда
     (по пустым вертикальным полосам);
  2) для каждого кадра берёт альфу по белому фону и bbox фигуры;
  3) считает опорный масштаб как медиану по всем кадрам (кто случайно вышел
     крупнее — подтянется), и приводит кадры к общему масштабу;
  4) ставит фигуры на общую «линию земли» и собирает ровный лист
     N кадров в один ряд, каждая ячейка CELL_W x CELL_H;
  5) рядом кладёт .json с размерами ячейки и порядком кадров.

Запуск:
  python3 tools/slice_walk.py assets/animations/.../archer_walk.png \\
      --out assets/animations/01_celtic_briton/03_sword_and_shield/walk.png
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageFilter

from imgtools import label_components

CELL_H = 256        # высота кадра на карте
BG_TOL = 26.0       # отклонение от белого, при котором начинается фигура
MIN_INK = 2


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def bg_color(a):
    h, w, _ = a.shape
    pts = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]
    return np.median(np.array([a[y, x] for x, y in pts]), axis=0)


def runs(profile, thr, min_gap, min_len):
    idx = np.nonzero(profile >= thr)[0]
    if idx.size == 0:
        return []
    out, start, prev = [], idx[0], idx[0]
    for x in idx[1:]:
        if x - prev > min_gap:
            out.append((int(start), int(prev) + 1))
            start = x
        prev = x
    out.append((int(start), int(prev) + 1))
    return [r for r in out if r[1] - r[0] >= min_len]


def smooth(v, k=5):
    return np.convolve(v.astype(np.float32), np.ones(k) / k, mode="same")


def peaks(profile, count, min_dist):
    """Центры фигур: локальные максимумы профиля чернил, не ближе min_dist.

    Так кадры режутся по телам, а не по пустым полосам — даже если оружие
    соседа заходит в кадр и «зашивает» зазор.
    """
    p = profile.astype(np.float32).copy()
    centers = []
    for _ in range(count):
        i = int(np.argmax(p))
        if p[i] <= 0:
            break
        centers.append(i)
        lo, hi = max(0, i - min_dist), min(len(p), i + min_dist + 1)
        p[lo:hi] = 0
    return sorted(centers)


def frame_cells(a, err, expect=8, rows_expect=0, cols_expect=0):
    """Ячейки кадров: ряды по горизонтальным полосам, кадры — по центрам фигур."""
    mask = err > BG_TOL
    rows = runs(smooth(mask.sum(axis=1)), MIN_INK, min_gap=8, min_len=40)
    if rows_expect and len(rows) != rows_expect and rows:
        # равномерно делим общий диапазон содержимого
        ys = np.nonzero(mask.any(axis=1))[0]
        top, bot = int(ys.min()), int(ys.max()) + 1
        step = (bot - top) / rows_expect
        rows = [(int(top + i * step), int(top + (i + 1) * step)) for i in range(rows_expect)]

    per_row = cols_expect or max(1, round(expect / max(1, len(rows))))
    cells = []
    for y0, y1 in rows:
        band = mask[y0:y1]
        prof = smooth(band.sum(axis=0), 9)
        if not prof.any():
            continue
        width = band.shape[1]
        centers = peaks(prof, per_row, min_dist=max(6, int(width / per_row * 0.55)))
        if len(centers) < per_row:
            # страховка: равномерная нарезка по содержимому ряда
            xs = np.nonzero(band.any(axis=0))[0]
            left, right = int(xs.min()), int(xs.max()) + 1
            step = (right - left) / per_row
            centers = [int(left + (i + 0.5) * step) for i in range(per_row)]

        edges = [0] + [(centers[i] + centers[i + 1]) // 2 for i in range(len(centers) - 1)] + [width]
        for i in range(len(centers)):
            cells.append((edges[i], y0, edges[i + 1], y1))
    return cells, rows


def cut_frame(a, err, cell, filter_parts=True):
    x0, y0, x1, y1 = cell
    m = err[y0:y1, x0:x1] > BG_TOL
    if not m.any():
        return None

    # оставляем только свою фигуру: куски оружия соседа по краям кадра —
    # отдельные компоненты, их центр лежит вне bbox главной фигуры
    labels, n = label_components(m) if filter_parts else (None, 1)
    if n > 1:
        areas = np.bincount(labels.ravel())
        areas[0] = 0
        main = int(np.argmax(areas))
        mx0 = np.nonzero((labels == main).any(axis=0))[0]
        keep = np.zeros(n + 1, bool)
        for lab in range(1, n + 1):
            if areas[lab] < 0.02 * areas[main]:
                continue
            cx = np.nonzero((labels == lab).any(axis=0))[0].mean()
            if mx0.min() - 2 <= cx <= mx0.max() + 2:
                keep[lab] = True
        m = m & keep[labels]
        err_cell = np.where(m, err[y0:y1, x0:x1], 0.0)
    else:
        err_cell = err[y0:y1, x0:x1]

    ys, xs = np.nonzero(m)
    if xs.size == 0:
        return None
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1

    alpha = np.clip((err_cell - BG_TOL) / BG_TOL, 0, 1)
    alpha = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    alpha = alpha.crop((bx0, by0, bx1, by1)).filter(ImageFilter.GaussianBlur(0.5))

    rgb = Image.fromarray(a[y0:y1, x0:x1][by0:by1, bx0:bx1].astype(np.uint8), "RGB")
    fig = rgb.convert("RGBA")
    fig.putalpha(alpha)
    box = fig.getbbox()
    if box is None:
        return None
    return fig.crop(box)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cell-h", type=int, default=CELL_H)
    ap.add_argument("--expect", type=int, default=8, help="сколько кадров нарисовал генератор")
    ap.add_argument("--order", default="", help="порядок кадров, например 1,2,3,4,5,6 (по умолчанию как нарезано)")
    ap.add_argument("--keep", default="", help="оставить только кадры с этими номерами (с 1)")
    ap.add_argument("--rows", type=int, default=0, help="сколько рядов фигур в кадре (если автопоиск путается)")
    ap.add_argument("--cols", type=int, default=0, help="сколько фигур в каждом ряду")
    ap.add_argument("--no-filter", dest="no_filter", action="store_true",
                    help="не отбрасывать куски оружия соседей (когда фигуры слипаются)")
    args = ap.parse_args()

    a = load(args.source)
    bg = bg_color(a)
    err = np.sqrt(((a - bg) ** 2).sum(axis=2))
    cells, rows = frame_cells(a, err, args.expect, args.rows, args.cols)
    print(f"{os.path.basename(args.source)}: фон {bg.astype(int)}, "
          f"рядов {len(rows)}, кадров {len(cells)}")

    frames = []
    for cell in cells:
        fig = cut_frame(a, err, cell, not args.no_filter)
        if fig is not None:
            frames.append(fig)
    if not frames:
        raise SystemExit("кадры не найдены")

    if args.keep:
        idx = [int(p) - 1 for p in args.keep.split(",") if p.strip()]
        frames = [frames[i] for i in idx if 0 <= i < len(frames)]

    if args.order:
        idx = [int(p) - 1 for p in args.order.split(",") if p.strip()]
        frames = [frames[i] for i in idx if 0 <= i < len(frames)]

    # опорный масштаб — медиана высот: случайно крупный/мелкий кадр не ломает цикл
    heights = sorted(f.height for f in frames)
    ref_h = heights[len(heights) // 2]
    scale = (args.cell_h * 0.94) / ref_h

    scaled = []
    for f in frames:
        w = max(1, round(f.width * scale))
        h = max(1, round(f.height * scale))
        scaled.append(f.resize((w, h), Image.LANCZOS))

    cell_w = max(f.width for f in scaled) + 8
    strip = Image.new("RGBA", (cell_w * len(scaled), args.cell_h), (0, 0, 0, 0))
    for i, f in enumerate(scaled):
        x = i * cell_w + (cell_w - f.width) // 2
        y = args.cell_h - f.height          # общая линия земли
        strip.alpha_composite(f, (x, y))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    strip.save(args.out, optimize=True)

    meta = {
        "image": os.path.basename(args.out),
        "frames": len(scaled),
        "cell_w": cell_w,
        "cell_h": args.cell_h,
        "source": os.path.basename(args.source),
        "ref_height_px": ref_h,
        "scale": round(scale, 4),
    }
    with open(os.path.splitext(args.out)[0] + ".json", "w") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)

    print(f"  ok {args.out}: {strip.width}x{strip.height}, "
          f"{len(scaled)} кадров по {cell_w}x{args.cell_h}")


if __name__ == "__main__":
    main()
