import json
import os
from collections import deque
import numpy as np
from PIL import Image, ImageOps


def keep_largest_component(mask: np.ndarray) -> np.ndarray:
    """Keep only the largest 4-connected foreground component (the fish itself)."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    best_label = 0
    best_count = 0
    cur_label = 0

    ys, xs = np.where(mask)
    for sy, sx in zip(ys, xs):
        if labels[sy, sx] != 0:
            continue
        cur_label += 1
        q = deque([(int(sy), int(sx))])
        labels[sy, sx] = cur_label
        cnt = 0
        while q:
            cy, cx = q.popleft()
            cnt += 1
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and labels[ny, nx] == 0:
                    labels[ny, nx] = cur_label
                    q.append((ny, nx))
        if cnt > best_count:
            best_count = cnt
            best_label = cur_label

    if best_label == 0:
        return mask
    return labels == best_label


def remove_white_bg_floodfill(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    arr = np.array(rgba, dtype=np.uint8)
    h, w, _ = arr.shape

    # Strip outermost 4px margin to eliminate any faint generation edge lines
    arr[:4, :, :3] = 255
    arr[-4:, :, :3] = 255
    arr[:, :4, :3] = 255
    arr[:, -4:, :3] = 255

    rgb = arr[:, :, :3].astype(np.int16)

    # Identify near-white neutral background pixels
    is_bright = (rgb[:, :, 0] >= 236) & (rgb[:, :, 1] >= 236) & (rgb[:, :, 2] >= 236)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    bg_candidate = is_bright & (chroma <= 20)

    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    for x in range(w):
        if bg_candidate[0, x] and not visited[0, x]:
            visited[0, x] = True
            q.append((0, x))
        if bg_candidate[h - 1, x] and not visited[h - 1, x]:
            visited[h - 1, x] = True
            q.append((h - 1, x))
    for y in range(h):
        if bg_candidate[y, 0] and not visited[y, 0]:
            visited[y, 0] = True
            q.append((y, 0))
        if bg_candidate[y, w - 1] and not visited[y, w - 1]:
            visited[y, w - 1] = True
            q.append((y, w - 1))

    while q:
        cy, cx = q.popleft()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and bg_candidate[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    fg = ~visited
    fg = keep_largest_component(fg)
    visited = ~fg

    alpha = np.where(visited, 0, 255).astype(np.uint8)

    # Soft anti-aliased edge ramp on outer contour
    bg_dilated = visited.copy()
    bg_dilated[1:, :] |= visited[:-1, :]
    bg_dilated[:-1, :] |= visited[1:, :]
    bg_dilated[:, 1:] |= visited[:, :-1]
    bg_dilated[:, :-1] |= visited[:, 1:]
    edge_ring = bg_dilated & (~visited)

    lum = (rgb[:, :, 0] * 0.299 + rgb[:, :, 1] * 0.587 + rgb[:, :, 2] * 0.114)
    soft_edge = edge_ring & (lum >= 205) & (chroma <= 22)
    ramp = np.clip((255.0 - lum) / 50.0, 0.12, 1.0)
    alpha[soft_edge] = (ramp[soft_edge] * 255).astype(np.uint8)

    arr[:, :, 3] = alpha
    out = Image.fromarray(arr, mode="RGBA")
    bbox = out.getbbox()
    if bbox:
        pad = 16
        x0 = max(0, bbox[0] - pad)
        y0 = max(0, bbox[1] - pad)
        x1 = min(w, bbox[2] + pad)
        y1 = min(h, bbox[3] + pad)
        out = out.crop((x0, y0, x1, y1))
    return out


def main():
    with open("data/fish_database.json", "r", encoding="utf-8") as f:
        species_list = json.load(f)

    os.makedirs("fish_art", exist_ok=True)
    processed = 0
    for sp in species_list:
        slug = sp["slug"]
        raw_path = f"raw_art/{slug}.png"
        if not os.path.exists(raw_path):
            continue
        img = Image.open(raw_path)
        if sp.get("flip_raw"):
            img = ImageOps.mirror(img)
        sprite = remove_white_bg_floodfill(img)
        out_path = f"fish_art/{slug}.png"
        sprite.save(out_path, "PNG")
        processed += 1
        print(f"Extracted {out_path} ({sprite.size[0]}x{sprite.size[1]})")
    print(f"Total sprites extracted: {processed}")


if __name__ == "__main__":
    main()
