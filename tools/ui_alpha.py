#!/usr/bin/env python3
"""Вырезает элементы UI с фона генератора (прозрачность + мягкий край).

Кнопки и рамки приходят на почти чёрном фоне, иногда с светлым пятном
подсветки. Чтобы в движке их можно было положить на любую подложку:

  1) фон — тёмные пиксели, связанные с краем кадра;
  2) объект — то, что осталось; мелкое «зерно» отбрасывается;
  3) содержимое обрезается по эллипсу вокруг объекта — это убирает пятна
     подсветки, которые к фону не относятся;
  4) --split N режет лист на N элементов по центрам (по плотности объекта),
     и эллипс считается уже для каждого элемента отдельно.

Запуск:
  python3 tools/ui_alpha.py assets/ui/battle/hp_bar.png
  python3 tools/ui_alpha.py assets/ui/battle/battle_buttons.png \\
      --split 6 --names button,button2,button3,button4,button5,button6
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageFilter

from imgtools import border_component, label_components

DARK_LUM = 34     # граница «тёмного» фона (фон генератора ~20–24 по яркости)
DARK_CHROMA = 46  # фон монохромный
DARK_DIST = 22    # совпадение с цветом угла кадра, при котором это фон
MIN_PART = 2000   # мельче — «зерно», а не элемент интерфейса


def object_mask(a):
    """Маска объектов: всё, что не фон и не мелкое зерно."""
    lum = a.mean(axis=2)
    chroma = a.max(axis=2) - a.min(axis=2)
    ref = np.median(np.concatenate([a[:24, :24].reshape(-1, 3),
                                    a[:24, -24:].reshape(-1, 3),
                                    a[-24:, :24].reshape(-1, 3),
                                    a[-24:, -24:].reshape(-1, 3)]), axis=0)
    dist = np.sqrt(((a - ref) ** 2).sum(axis=2))
    cand = (dist < DARK_DIST) | ((lum < DARK_LUM) & (chroma < DARK_CHROMA))
    bg = border_component(cand)
    obj = ~bg

    labels, n = label_components(obj)
    if n > 0:
        areas = np.bincount(labels.ravel())
        areas[0] = 0
        keep = areas >= max(MIN_PART, 0.01 * areas.max())
        keep[0] = False
        obj = np.isin(labels, np.nonzero(keep)[0])
    return obj


def ellipse_mask(obj, pad=1.02):
    """Оставляем только то, что попало в эллипс вокруг содержимого."""
    ys, xs = np.nonzero(obj)
    if xs.size == 0:
        return obj
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
    ry, rx = max((y1 - y0) / 2 * pad, 1), max((x1 - x0) / 2 * pad, 1)
    yy, xx = np.mgrid[0:obj.shape[0], 0:obj.shape[1]]
    return obj & (((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2 <= 1)


def to_rgba(a, obj):
    alpha = np.where(obj, 255, 0).astype(np.uint8)
    img = Image.fromarray(a.astype(np.uint8), "RGB").convert("RGBA")
    img.putalpha(Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.6)))
    return img.crop(img.getbbox())


def split_bands(obj, count, min_gap=20):
    """Границы элементов по плотности объекта в колонках."""
    prof = obj.sum(axis=0).astype(np.float32)
    win = max(3, len(prof) // 200)
    prof = np.convolve(prof, np.ones(win) / win, mode="same")
    min_dist = max(6, int(len(prof) / count * 0.55))
    centers = []
    p = prof.copy()
    for _ in range(count):
        i = int(np.argmax(p))
        if p[i] <= 0:
            break
        centers.append(i)
        p[max(0, i - min_dist):i + min_dist + 1] = 0
    centers.sort()
    if len(centers) < count:
        xs = np.nonzero(obj.any(axis=0))[0]
        left, right = int(xs.min()), int(xs.max()) + 1
        step = (right - left) / count
        centers = [int(left + (i + 0.5) * step) for i in range(count)]
    edges = [0] + [(centers[i] + centers[i + 1]) // 2 for i in range(len(centers) - 1)] + [obj.shape[1]]
    return list(zip(edges[:-1], edges[1:]))


def crop_mode(a):
    """Режим для рамок: просто обрезаем чёрные поля по содержимому.

    Полоса численности — это рамка с уже нарисованным пустым жёлобом внутри,
    поэтому прозрачность ей не нужна: достаточно убрать чёрные поля, и её
    можно класть на любую подложку.
    """
    lum = a.mean(axis=2)
    chroma = a.max(axis=2) - a.min(axis=2)
    # фон у таких кадров тёмный И ровный; фактура металла ярче и «цветнее»
    content = (lum > 46) | (chroma > 16)
    # берём плотные строки/столбцы: единичные блики не должны раздувать кадр
    rows = content.sum(axis=1) > 0.02 * content.shape[1]
    cols = content.sum(axis=0) > 0.02 * content.shape[0]
    ys = np.nonzero(rows)[0]
    xs = np.nonzero(cols)[0]
    sub = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return Image.fromarray(sub.astype(np.uint8), "RGB")


def ellipse_mode(a, bands, names, out_dir):
    """Режим для кнопок: чистая альфа-маска по эллипсу, вписанному в обод.

    Кнопки — правильные овалы, поэтому фон вокруг можно не «угадывать»:
    достаточно построить эллипс по bbox самого обода (яркие золотые пиксели).
    """
    lum = a.mean(axis=2)
    chroma = a.max(axis=2) - a.min(axis=2)
    gold = (lum > 60) & (chroma > 25)
    saved = 0
    for i, (x0, x1) in enumerate(bands):
        sub = a[:, x0:x1]
        g = gold[:, x0:x1]
        ys, xs = np.nonzero(g)
        if xs.size < 100:
            print(f"  ! элемент {i + 1}: обод не найден")
            continue
        bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
        cy, cx = (by0 + by1) / 2, (bx0 + bx1) / 2
        ry, rx = (by1 - by0) / 2 * 1.04, (bx1 - bx0) / 2 * 1.04
        yy, xx = np.mgrid[0:sub.shape[0], 0:sub.shape[1]]
        inside = ((yy - cy) / max(ry, 1)) ** 2 + ((xx - cx) / max(rx, 1)) ** 2 <= 1
        # мягкий край в 1.5 px, чтобы не было «лестницы»
        dist = np.sqrt(((yy - cy) / max(ry, 1)) ** 2 + ((xx - cx) / max(rx, 1)) ** 2)
        alpha = np.clip((1 - dist) * ry / 1.5, 0, 1) * 255
        alpha = np.where(inside, alpha, 0).astype(np.uint8)
        img = Image.fromarray(sub.astype(np.uint8), "RGB").convert("RGBA")
        img.putalpha(Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.4)))
        img = img.crop(img.getbbox())
        name = names[i] if i < len(names) else f"button_{i + 1}"
        path = os.path.join(out_dir, f"{name}.png")
        img.save(path, optimize=True)
        saved += 1
        print(f"  ok {path}: {img.width}x{img.height}")
    return saved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="alpha", choices=("alpha", "crop", "ellipse"))
    ap.add_argument("source")
    ap.add_argument("--split", type=int, default=0)
    ap.add_argument("--names", default="")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    a = np.asarray(Image.open(args.source).convert("RGB")).astype(np.float32)

    if args.mode == "crop":
        img = crop_mode(a)
        img.save(args.source, optimize=True)
        print(f"{os.path.basename(args.source)}: обрезано по содержимому -> "
              f"{img.width}x{img.height}")
        return

    obj = object_mask(a)
    print(f"{os.path.basename(args.source)}: объект {obj.mean() * 100:.1f}% кадра")

    if args.mode == "ellipse":
        out_dir = args.out or os.path.dirname(args.source)
        os.makedirs(out_dir, exist_ok=True)
        names = [n.strip() for n in args.names.split(",") if n.strip()]
        ellipse_mode(a, split_bands(obj, args.split or 1), names, out_dir)
        return

    if not args.split:
        img = to_rgba(a, ellipse_mask(obj))
        img.save(args.source, optimize=True)
        print(f"  ok {args.source}: {img.width}x{img.height}, прозрачный фон")
        return

    out_dir = args.out or os.path.dirname(args.source)
    os.makedirs(out_dir, exist_ok=True)
    names = [n.strip() for n in args.names.split(",") if n.strip()]

    for i, (x0, x1) in enumerate(split_bands(obj, args.split)):
        band = obj[:, x0:x1]
        band = ellipse_mask(band)
        ys = np.nonzero(band.any(axis=1))[0]
        if ys.size == 0:
            print(f"  ! элемент {i + 1}: пусто")
            continue
        sub = to_rgba(a[:, x0:x1], band)
        name = names[i] if i < len(names) else f"button_{i + 1}"
        path = os.path.join(out_dir, f"{name}.png")
        sub.save(path, optimize=True)
        print(f"  ok {path}: {sub.width}x{sub.height}")


if __name__ == "__main__":
    main()
