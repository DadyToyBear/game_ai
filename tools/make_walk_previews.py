#!/usr/bin/env python3
"""Анимированные GIF-превью спрайт-листов ходьбы.

По статичному листу не видно, как читается цикл. Скрипт режет лист по
ячейкам из .json и собирает GIF (по кругу, с паузой), на нейтральном фоне.

Запуск:  python3 tools/make_walk_previews.py
"""
import glob
import json
import os

from PIL import Image

OUT_DIR = "preview_walk"
BG = (52, 47, 40, 255)
CELL = 200        # высота кадра в превью
FRAME_MS = 110


def build(sheet_path):
    im = Image.open(sheet_path).convert("RGBA")
    meta_path = os.path.splitext(sheet_path)[0] + ".json"
    with open(meta_path) as fh:
        meta = json.load(fh)
    cw, ch = meta["cell_w"], meta["cell_h"]
    n = meta["frames"]

    frames = []
    for i in range(n):
        cell = im.crop((i * cw, 0, (i + 1) * cw, ch))
        scale = CELL / cell.height
        cell = cell.resize((max(1, round(cell.width * scale)), CELL), Image.LANCZOS)
        canvas = Image.new("RGBA", (round(cw * scale), CELL), BG)
        canvas.alpha_composite(cell, ((canvas.width - cell.width) // 2, 0))
        frames.append(canvas.convert("RGB"))

    name = os.path.basename(os.path.dirname(sheet_path))
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{name}.gif")
    frames[0].save(out, save_all=True, append_images=frames[1:],
                   duration=FRAME_MS, loop=0, optimize=True)
    print(f"  {out}: {n} кадров, {frames[0].width}x{frames[0].height}")


if __name__ == "__main__":
    for p in sorted(glob.glob("assets/animations/**/*_walk_row.png", recursive=True)):
        build(p)
