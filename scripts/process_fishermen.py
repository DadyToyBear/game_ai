import os
from collections import deque
import numpy as np
from PIL import Image


def extract_character_rgba(arr_rgb: np.ndarray) -> Image.Image:
    h, w, _ = arr_rgb.shape
    rgb = arr_rgb.astype(np.int32)
    dw = np.sqrt(
        (255 - rgb[:, :, 0]) ** 2
        + (255 - rgb[:, :, 1]) ** 2
        + (255 - rgb[:, :, 2]) ** 2
    )
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    is_bg_cand = (dw < 42.0) & (chroma < 20)

    # Flood-fill strictly from outer borders
    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        if is_bg_cand[0, x]:
            visited[0, x] = True
            q.append((0, x))
        if is_bg_cand[h - 1, x] and not visited[h - 1, x]:
            visited[h - 1, x] = True
            q.append((h - 1, x))
    for y in range(1, h - 1):
        if is_bg_cand[y, 0] and not visited[y, 0]:
            visited[y, 0] = True
            q.append((y, 0))
        if is_bg_cand[y, w - 1] and not visited[y, w - 1]:
            visited[y, w - 1] = True
            q.append((y, w - 1))

    while q:
        cy, cx = q.popleft()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_bg_cand[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    # Only punch out enclosed holes that are truly pure #FFFFFF white (keeps cream shirts/fur 100% solid!)
    pure_white_hole = (rgb.min(axis=2) >= 250) & (chroma <= 6)
    bg = visited | pure_white_hole

    alpha = np.where(bg, 0, 255).astype(np.float32)

    bg_d1 = bg.copy()
    bg_d1[1:, :] |= bg[:-1, :]
    bg_d1[:-1, :] |= bg[1:, :]
    bg_d1[:, 1:] |= bg[:, :-1]
    bg_d1[:, :-1] |= bg[:, 1:]

    edge = bg_d1 & (~bg)
    edge_soft = edge & (chroma < 22) & (dw < 90.0)
    soft_a = np.clip((dw - 40.0) / 50.0, 0.0, 1.0) * 255.0
    alpha = np.where(edge_soft, soft_a, alpha)

    out_rgb = arr_rgb.copy()
    fg_mask = alpha > 80
    cur_mask = fg_mask.copy()
    for _ in range(4):
        filled = out_rgb.copy()
        new_mask = cur_mask.copy()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ys = slice(max(0, dy), h + min(0, dy))
            xs = slice(max(0, dx), w + min(0, dx))
            y0 = slice(max(0, -dy), h - max(0, dy))
            x0 = slice(max(0, -dx), w - max(0, dx))
            upd = (~new_mask[ys, xs]) & cur_mask[y0, x0]
            filled[ys, xs][upd] = out_rgb[y0, x0][upd]
            new_mask[ys, xs] |= cur_mask[y0, x0]
        out_rgb = filled
        cur_mask = new_mask

    fringe_darken = edge & (dw < 120.0) & (chroma < 24)
    for c in range(3):
        out_rgb[:, :, c] = np.where(
            fringe_darken,
            np.clip(out_rgb[:, :, c].astype(np.int32) - 50, 0, 255).astype(np.uint8),
            out_rgb[:, :, c],
        )

    return Image.fromarray(np.dstack([out_rgb, np.clip(alpha, 0, 255).astype(np.uint8)]), mode="RGBA")


def split_horizontal_figures(rgba: Image.Image) -> list[Image.Image]:
    """Split turnaround sheets horizontally by empty transparent columns."""
    arr = np.array(rgba)
    col_has_fg = (arr[:, :, 3] > 32).any(axis=0)
    w = len(col_has_fg)
    segments = []
    in_seg = False
    start = 0
    for x in range(w):
        if col_has_fg[x] and not in_seg:
            in_seg = True
            start = x
        elif not col_has_fg[x] and in_seg:
            if x - start > 60:
                segments.append((start, x))
            in_seg = False
    if in_seg and w - start > 60:
        segments.append((start, w))

    figs = []
    for x0, x1 in segments:
        sub = rgba.crop((x0, 0, x1, rgba.height))
        bb = sub.getbbox()
        if bb:
            figs.append(sub.crop(bb))
    return figs


def main():
    os.makedirs("fishermen_art", exist_ok=True)
    os.makedirs("fishermen_sheets", exist_ok=True)
    os.makedirs("fishermen_turnarounds", exist_ok=True)

    processed = []
    for fn in sorted(os.listdir("fishermen_raw")):
        if not fn.endswith(".png"):
            continue
        im = Image.open(os.path.join("fishermen_raw", fn)).convert("RGB")
        rgba = extract_character_rgba(np.array(im))
        figs = split_horizontal_figures(rgba)
        if len(figs) > 1:
            # Save full turnaround sheet cleanly too, and pick leftmost 3/4 front pose as primary sprite
            bb_full = rgba.getbbox()
            if bb_full:
                rgba.crop(bb_full).save(os.path.join("fishermen_turnarounds", fn), "PNG")
            primary = figs[0]
            print(f"{fn}: found {len(figs)} turnaround poses -> saved primary leftmost pose {primary.size} + turnaround")
        else:
            primary = figs[0] if figs else rgba.crop(rgba.getbbox())
            print(f"{fn}: single character -> {primary.size}")

        # Scale neatly so all characters have consistent ~960px height (or keep crisp high-res padded)
        target_h = 960
        nw = int(round(primary.width * (target_h / primary.height)))
        primary_scaled = primary.resize((nw, target_h), Image.Resampling.LANCZOS)
        out_p = os.path.join("fishermen_art", fn)
        primary_scaled.save(out_p, "PNG")
        processed.append((fn, primary_scaled))

    # Build a clean 2x4 transparent guild sheet (RGBA) of all 8 fishermen
    cols, rows = 4, 2
    cell_w, cell_h = 620, 1080
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (0, 0, 0, 0))
    for i, (fn, fig) in enumerate(processed[:8]):
        r, c = divmod(i, cols)
        # Fit inside cell aligned to bottom baseline
        px = c * cell_w + (cell_w - fig.width) // 2
        py = r * cell_h + (cell_h - 50) - fig.height
        sheet.alpha_composite(fig, (px, py))

    sheet_path = "fishermen_sheets/fishermen_8_guild_transparent.png"
    sheet.save(sheet_path, "PNG")
    print(f"Saved guild sheet: {sheet_path} ({sheet.size})")


if __name__ == "__main__":
    main()
