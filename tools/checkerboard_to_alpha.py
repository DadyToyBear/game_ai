#!/usr/bin/env python3
"""Превращает «шахматку прозрачности» генератора в настоящую альфу.

Некоторые генерации отдают PNG с нарисованной шахматкой (два оттенка серого,
255 и 219). Скрипт:

  1) находит пиксели-«шахматку»: почти ахроматичные и близкие к двум серым;
  2) оставляет только ту часть, что связана с краем картинки, — чтобы серые
     блики внутри самой иллюстрации не стали дырками;
  3) вырезает её (альфа 0), срезает кайму по краю иллюстрации;
  4) обрезает по bbox и сохраняет.

Запуск:  python3 tools/checkerboard_to_alpha.py assets/ui/battle/round_banner.png
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

from imgtools import border_component

MAX_CHROMA = 12   # насколько серым должен быть пиксель
MIN_LUM = 135     # ниже — уже дерево/тень, а не шахматка


def convert(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    chroma = a.max(axis=2) - a.min(axis=2)
    grey_ok = chroma <= MAX_CHROMA

    cand = grey_ok & (a.mean(axis=2) >= MIN_LUM)

    # оставляем только шахматку, связанную с краем картинки: внутри
    # самой иллюстрации серые блики не должны стать дырками
    checker = border_component(cand)

    print(f"{path}: шахматка {checker.mean() * 100:.1f}% кадра")
    if checker.mean() < 0.02:
        print("  каймы нет — файл не тронут")
        return

    alpha = np.where(checker, 0, 255).astype(np.uint8)
    alpha = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.6))

    out = Image.fromarray(a.astype(np.uint8), "RGB").convert("RGBA")
    out.putalpha(alpha)
    box = out.getbbox()
    out = out.crop(box)
    out.save(path, optimize=True)
    print(f"  ok {path}: {out.width}x{out.height} с прозрачным фоном")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    for p in sys.argv[1:]:
        convert(p)
