#!/usr/bin/env python3
"""Нормализация сгенерированных карточек-портретов войск.

Генератор отдаёт широкий кадр (1408x768) и иногда рисует 2-3 варианта
в ряд или «тень-силуэт» первым. Скрипт:

  1) находит вертикальные «пустые» полосы и режет картинку на панели;
  2) в каждой панели считает, сколько пикселей отличается от цвета фона
     (тени и разводы почти не считаются), берёт самую содержательную;
  3) строит мягкую альфа-маску фигуры, обрезает по ней;
  4) вписывает фигуру в квадрат SIZE x SIZE с полями и «ставит на землю»;
  5) исходник сохраняет в _raw/ рядом с результатом.

Запуск:  python3 tools/normalize_cards.py assets/units/cards/*_card.png
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

SIZE = 512          # сторона итоговой карточки
MARGIN_X = 0.08     # поля по бокам, доля стороны
MARGIN_TOP = 0.05
MARGIN_BOTTOM = 0.03
BG_TOLERANCE = 34   # отличие от фона, при котором пиксель считается «чернилами»


def load_rgb(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.int16)


def bg_color(a):
    h, w, _ = a.shape
    pts = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2), (w // 2, 1),
           (1, h // 2), (w - 2, h // 2), (w // 2, h - 2)]
    return np.median(np.array([a[y, x] for x, y in pts]), axis=0)


def ink_mask(a, bg, tol=BG_TOLERANCE):
    """Пиксели, заметно отличающиеся от фона (тени/разводы отсекаются)."""
    d = np.sqrt(((a - bg) ** 2).sum(axis=2))
    return d > tol


def split_panels(mask, min_gap=24, min_width=40):
    """Вертикальные панели: дорожки, где чернил почти нет, — разделители."""
    col_ink = mask.sum(axis=0).astype(np.float32)
    # сглаживаем профиль: шум бумаги и разводы тени иначе «зашивают» зазоры
    k = 9
    col_ink = np.convolve(col_ink, np.ones(k) / k, mode="same")
    # «почти нет» — относительно самой плотной колонки
    min_ink = max(2.0, 0.03 * float(col_ink.max()))
    w = mask.shape[1]
    panels, start = [], None
    for x in range(w):
        if col_ink[x] >= min_ink:
            if start is None:
                start = x
        elif start is not None:
            panels.append((start, x))
            start = None
    if start is not None:
        panels.append((start, w))

    merged = []
    for p in panels:
        if merged and p[0] - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], p[1])
        else:
            merged.append(p)
    return [p for p in merged if p[1] - p[0] >= min_width]


def pick_panel(err, panels):
    """Самая содержательная панель. err — «сила отклонения от фона».

    Сравниваем не по площади, а по сумме отклонений: бледная тень-силуэт
    набирает мало, полноценный персонаж — много.
    """
    # плотность отклонения на колонку: полноценный персонаж «плотнее», чем
    # бледный теневой силуэт, и не зависит от ширины панели
    scores = [(float(err[:, x0:x1].mean()), (x0, x1)) for x0, x1 in panels]
    top = max(s for s, _ in scores)
    # среди «полноценных» вариантов берём самый левый: на широких кадрах
    # слева обычно вид спереди, справа — вид со спины
    for score, box in scores:
        if score >= 0.85 * top:
            return box
    return max(scores)[1]


def figure_bbox(mask):
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def alpha_from(err):
    """Мягкая альфа по силе отклонения от фона: 0 — фон, 255 — фигура."""
    a = np.clip((err - BG_TOLERANCE) / BG_TOLERANCE, 0.0, 1.0)
    return Image.fromarray((a * 255).astype(np.uint8), "L")


def normalize(path):
    raw_dir = os.path.join(os.path.dirname(path), "_raw")
    raw_path = os.path.join(raw_dir, os.path.basename(path))
    os.makedirs(raw_dir, exist_ok=True)
    source = raw_path if os.path.exists(raw_path) else path

    a = load_rgb(source)
    bg = bg_color(a)
    err = np.sqrt(((a.astype(np.float32) - bg) ** 2).sum(axis=2))
    mask = err > BG_TOLERANCE

    panels = split_panels(mask)
    panel = pick_panel(err, panels) if panels else (0, a.shape[1])
    x0, x1 = panel
    a, err = a[:, x0:x1], err[:, x0:x1]

    bbox = figure_bbox(err > BG_TOLERANCE)
    if bbox is None:
        print(f"  ! {os.path.basename(path)}: фигура не найдена, пропуск")
        return
    bx0, by0, bx1, by1 = bbox

    alpha = alpha_from(err).crop(bbox).filter(ImageFilter.GaussianBlur(0.5))
    fig = Image.fromarray(a[by0:by1, bx0:bx1].astype(np.uint8), "RGB")
    fig = fig.convert("RGBA")
    fig.putalpha(alpha)
    fig = fig.crop(fig.getbbox())

    inner_w = int(SIZE * (1 - 2 * MARGIN_X))
    inner_h = int(SIZE * (1 - MARGIN_TOP - MARGIN_BOTTOM))
    scale = min(inner_w / fig.width, inner_h / fig.height)
    fig = fig.resize((max(1, round(fig.width * scale)),
                      max(1, round(fig.height * scale))), Image.LANCZOS)

    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(fig, ((SIZE - fig.width) // 2,
                                 SIZE - int(SIZE * MARGIN_BOTTOM) - fig.height))

    if source == path:
        Image.open(path).convert("RGB").save(raw_path)
    canvas.save(path, optimize=True)
    print(f"  ok {os.path.basename(path)}: панель {x0}-{x1}, "
          f"bbox {bx1 - bx0}x{by1 - by0} -> {SIZE}x{SIZE}, фон {bg.astype(int)}")


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    for p in argv:
        normalize(p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
