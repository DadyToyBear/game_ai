#!/usr/bin/env python3
"""Нарезка сгенерированных листов иконок на отдельные PNG с прозрачным фоном.

Генератор отдаёт один широкий кадр с иконками в ряд (иногда в два ряда и с
дублями). Скрипт:

  1) ищет колонки/строки иконок по «насыщенности» (золото и охра обода
     контрастны к серо-коричневому фону листа) — так сетка находится даже на
     шумном подсвеченном фоне;
  2) в каждой ячейке строит маску иконки по отклонению от цвета фона и
     заливает внутренние «дыры» (тёмная гравировка внутри круга);
  3) обрезает по маске, вписывает в квадрат ICON x ICON с прозрачным фоном;
  4) при --sheet собирает ровный лист «N иконок в один ряд».

Примеры:
  python3 tools/slice_icons.py assets/ui/battle/status_icons.png \\
      --names morale,fatigue,sickness,march --sheet

  python3 tools/slice_icons.py assets/ui/battle/command_icons.png \\
      --names attack,defend,volley,charge,charge2,hold,hold2,retreat \\
      --pick 1,2,3,4,6,8 --sheet
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageFilter

from imgtools import border_component

ICON = 128          # сторона отдельной иконки
PAD = 0.06          # поля внутри иконки, доля стороны
BG_TOL = 16.0       # отличие от фона листа, при котором начинается иконка
SAT_TOL = 34        # насыщенность, по которой ищутся золотые обода


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def bg_color(a):
    h, w, _ = a.shape
    pts = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3),
           (w // 2, 2), (2, h // 2), (w - 3, h // 2), (w // 2, h - 3)]
    return np.median(np.array([a[y, x] for x, y in pts]), axis=0)


def smooth(v, k=7):
    return np.convolve(v.astype(np.float32), np.ones(k) / k, mode="same")


def bands(profile, frac, min_gap=12, min_len=30):
    """Непрерывные участки профиля выше доли от максимума."""
    thr = frac * float(profile.max())
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
    return [b for b in out if b[1] - b[0] >= min_len]


def fill_holes(mask):
    """Заливка внутренних дыр маски (тёмная гравировка внутри иконки)."""
    outside = border_component(~mask)
    return mask | ~outside


def cut_icon(mask, rgb, cell):
    x0, y0, x1, y1 = cell
    m = mask[y0:y1, x0:x1]
    ys, xs = np.nonzero(m)
    if xs.size == 0:
        return None

    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = max(bx1 - bx0, by1 - by0)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    sx0, sy0 = int(round(cx - side / 2)), int(round(cy - side / 2))
    sx0, sy0 = max(sx0, 0), max(sy0, 0)
    sx1, sy1 = sx0 + side, sy0 + side

    # иконки круглые: альфа — круг по bbox с мягким краем. Так гарантированно
    # срезаются углы листа (фон вокруг иконки) и остаётся ровный круг.
    m_crop = m[sy0:sy1, sx0:sx1]
    h, w = m_crop.shape
    cy_, cx_ = (h - 1) / 2, (w - 1) / 2
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt((yy - cy_) ** 2 + (xx - cx_) ** 2)
    radius = min(h, w) / 2 * 0.985
    alpha = np.clip((radius - r) / 1.5, 0, 1) * 255.0
    alpha = np.where(m_crop, alpha, 0.0).astype(np.uint8)
    alpha = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.4))

    icon = Image.fromarray(rgb[y0:y1, x0:x1][sy0:sy1, sx0:sx1].astype(np.uint8), "RGB")
    icon = icon.convert("RGBA")
    icon.putalpha(alpha.crop((0, 0, icon.width, icon.height)))

    box = icon.getbbox()
    if box is None:
        return None
    icon = icon.crop(box)

    inner = int(ICON * (1 - 2 * PAD))
    scale = min(inner / icon.width, inner / icon.height)
    icon = icon.resize((max(1, round(icon.width * scale)),
                        max(1, round(icon.height * scale))), Image.LANCZOS)

    canvas = Image.new("RGBA", (ICON, ICON), (0, 0, 0, 0))
    canvas.alpha_composite(icon, ((ICON - icon.width) // 2, (ICON - icon.height) // 2))
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="лист иконок от генератора")
    ap.add_argument("--names", required=True, help="имена через запятую, по порядку ячеек")
    ap.add_argument("--pick", default="", help="номера ячеек (с 1) для --sheet, через запятую")
    ap.add_argument("--out", default="assets/ui/battle/icons")
    ap.add_argument("--sheet", action="store_true", help="собрать ровный лист в один ряд")
    ap.add_argument("--sheet-path", dest="sheet_path", default="")
    args = ap.parse_args()

    a = load(args.source)
    bg = bg_color(a)
    err = np.sqrt(((a - bg) ** 2).sum(axis=2))
    sat = a.max(axis=2) - a.min(axis=2)

    # сетка — по насыщенным золотым ободам, это устойчиво к подсветке фона
    cols = bands(smooth((sat > SAT_TOL).sum(axis=0)), 0.25)
    rows = bands(smooth((sat > SAT_TOL).sum(axis=1)), 0.25, min_len=40)

    mask = fill_holes(err > BG_TOL)

    names = [n.strip() for n in args.names.split(",") if n.strip()]
    print(f"{os.path.basename(args.source)}: фон {bg.astype(int)}, "
          f"сетка {len(cols)}x{len(rows)}")
    if len(cols) * len(rows) != len(names):
        print(f"  ! имён {len(names)}, ячеек {len(cols) * len(rows)}")

    os.makedirs(args.out, exist_ok=True)
    icons, i = [], 0
    for y0, y1 in rows:
        for x0, x1 in cols:
            icon = cut_icon(mask, a, (x0, y0, x1, y1))
            name = names[i] if i < len(names) else f"icon_{i + 1}"
            i += 1
            if icon is None:
                print(f"  ! {name}: пустая ячейка")
                continue
            icon.save(os.path.join(args.out, f"{name}.png"), optimize=True)
            icons.append((name, icon))
            print(f"  ok {name}.png  <- ячейка x{x0}-{x1} y{y0}-{y1}")

    if args.sheet:
        pick = [int(p) - 1 for p in args.pick.split(",") if p.strip()] or list(range(len(icons)))
        chosen = [icons[j][1] for j in pick if j < len(icons)]
        if chosen:
            out = args.sheet_path or os.path.splitext(args.source)[0] + "_row.png"
            row = Image.new("RGBA", (ICON * len(chosen), ICON), (0, 0, 0, 0))
            for j, icon in enumerate(chosen):
                row.alpha_composite(icon, (j * ICON, 0))
            row.save(out, optimize=True)
            print(f"  лист {out}: {len(chosen)} иконок в ряд, {row.width}x{row.height}")


if __name__ == "__main__":
    main()
