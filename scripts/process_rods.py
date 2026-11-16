import math
import os
from collections import deque
import numpy as np
from PIL import Image


def extract_clean_rgba(path: str) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im, dtype=np.uint8)
    h, w, _ = arr.shape
    rgb = arr[:, :, :3].astype(np.int32)

    # Distance from pure white
    dw = np.sqrt(
        (255 - rgb[:, :, 0]) ** 2
        + (255 - rgb[:, :, 1]) ** 2
        + (255 - rgb[:, :, 2]) ** 2
    )
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    is_bg_cand = (dw < 48.0) & (chroma < 24)

    # Flood-fill from borders
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

    # Also remove enclosed pure-white holes (e.g. inside tiny tip loop)
    pure_white_hole = (rgb.min(axis=2) >= 242) & (chroma <= 12)
    bg = visited | pure_white_hole

    # Edge anti-aliasing de-fringing: smooth neutral white outer halo without creating stippling on light wood
    alpha = np.where(bg, 0, 255).astype(np.float32)

    bg_d1 = bg.copy()
    bg_d1[1:, :] |= bg[:-1, :]
    bg_d1[:-1, :] |= bg[1:, :]
    bg_d1[:, 1:] |= bg[:, :-1]
    bg_d1[:, :-1] |= bg[:, 1:]

    edge = bg_d1 & (~bg)
    edge_soft = edge & (chroma < 24) & (dw < 95.0)
    soft_a = np.clip((dw - 44.0) / 51.0, 0.0, 1.0) * 255.0
    alpha = np.where(edge_soft, soft_a, alpha)

    # Color bleed RGB into transparent pixels so subsequent rotation/resize has ZERO white halo
    out_rgb = arr[:, :, :3].copy()
    fg_mask = alpha > 80
    cur_mask = fg_mask.copy()
    for _ in range(5):
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

    # Darken remaining bright neutral fringe toward dark outline
    fringe_darken = edge & (dw < 130.0) & (chroma < 26)
    for c in range(3):
        out_rgb[:, :, c] = np.where(
            fringe_darken,
            np.clip(out_rgb[:, :, c].astype(np.int32) - 55, 0, 255).astype(np.uint8),
            out_rgb[:, :, c],
        )

    res = np.dstack([out_rgb, np.clip(alpha, 0, 255).astype(np.uint8)])
    return Image.fromarray(res, mode="RGBA")


def rotate_upright(im: Image.Image) -> Image.Image:
    """Align rod strictly upright (butt at bottom, delicate tip pointing up)."""
    arr = np.array(im)
    ys, xs = np.where(arr[:, :, 3] > 32)
    pts = np.stack([xs, ys], axis=1).astype(np.float64)

    # Bottom-left -> top-right main axis via PCA
    mean = pts.mean(axis=0)
    cov = np.cov((pts - mean).T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    axis = eigvecs[:, np.argmax(eigvals)]
    # Orient axis from butt (lower-left: smaller x, larger y) toward tip (upper-right: larger x, smaller y)
    if axis[0] < 0:
        axis = -axis

    # Refine straightness using only lower-to-mid 65% of the rod (ignores natural slight curve of whip tip)
    proj = (pts - mean) @ axis
    p_min, p_max = proj.min(), proj.max()
    # Check thickness at bottom 15% vs top 15% to verify butt vs tip
    bot_pts = pts[proj < p_min + 0.15 * (p_max - p_min)]
    top_pts = pts[proj > p_min + 0.85 * (p_max - p_min)]
    if len(bot_pts) > 0 and len(top_pts) > 0:
        # Perpendicular spread indicates thickness
        perp = np.array([-axis[1], axis[0]])
        w_bot = np.std((bot_pts - mean) @ perp)
        w_top = np.std((top_pts - mean) @ perp)
        if w_top > w_bot:
            axis = -axis
            proj = (pts - mean) @ axis
            p_min, p_max = proj.min(), proj.max()

    # Fit line through 5%..60% segment (straight lower/mid shaft)
    mid_mask = (proj >= p_min + 0.04 * (p_max - p_min)) & (proj <= p_min + 0.58 * (p_max - p_min))
    pts_sub = pts[mid_mask]
    m_sub = pts_sub.mean(axis=0)
    _, ev_sub = np.linalg.eigh(np.cov((pts_sub - m_sub).T))
    axis_sub = ev_sub[:, 1]
    if np.dot(axis_sub, axis) < 0:
        axis_sub = -axis_sub

    # Target vector is straight UP in image coords: (0, -1)
    # Angle of axis_sub in standard math coords (y up -> invert dy):
    cur_angle_deg = math.degrees(math.atan2(-axis_sub[1], axis_sub[0]))
    rot_ccw = 90.0 - cur_angle_deg

    # Rotate using Pillow BICUBIC on RGBA (RGB already color-bled!)
    rotated = im.rotate(rot_ccw, resample=Image.Resampling.BICUBIC, expand=True)
    bbox = rotated.getbbox()
    if bbox:
        rotated = rotated.crop(bbox)
    return rotated


def resize_to_height(im: Image.Image, target_h: int) -> Image.Image:
    w, h = im.size
    scale = target_h / float(h)
    target_w = max(8, int(round(w * scale)))
    return im.resize((target_w, target_h), Image.Resampling.LANCZOS)


def compose_sheet(rod_paths_heights: list[tuple[str, int]], out_path: str, canvas_w: int = 1600, canvas_h: int = 2400):
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    n = len(rod_paths_heights)
    margin_x = 180
    step_x = (canvas_w - 2 * margin_x) / max(1, n - 1)
    base_y = canvas_h - 110

    for idx, (path, target_h) in enumerate(rod_paths_heights):
        rod = Image.open(path).convert("RGBA")
        rod_scaled = resize_to_height(rod, target_h)
        cx = int(round(margin_x + idx * step_x))
        # Center bottom butt around cx by checking lower 8% center of mass
        arr = np.array(rod_scaled)
        rh, rw = arr.shape[:2]
        bot_ys, bot_xs = np.where(arr[int(rh * 0.90) :, :, 3] > 40)
        butt_cx = float(bot_xs.mean()) if len(bot_xs) else rw / 2.0
        paste_x = int(round(cx - butt_cx))
        paste_y = base_y - rh
        canvas.alpha_composite(rod_scaled, (paste_x, paste_y))

    canvas.save(out_path, "PNG")
    print(f"Saved sheet: {out_path} ({canvas_w}x{canvas_h})")


def main():
    os.makedirs("rods_individual", exist_ok=True)
    os.makedirs("rods_sheets", exist_ok=True)

    for fn in sorted(os.listdir("rods_raw")):
        if not fn.endswith(".png"):
            continue
        raw_p = os.path.join("rods_raw", fn)
        rgba = extract_clean_rgba(raw_p)
        upright = rotate_upright(rgba)
        out_p = os.path.join("rods_individual", fn)
        upright.save(out_p, "PNG")
        print(f"Processed individual: {out_p} -> {upright.size}")

    # Compose Bamboo 4-rod sheet (2.5m, 4m, 6m, 8m) if all 4 exist
    bamboo_set = [
        ("rods_individual/bamboo_2_5m.png", 675),   # 2.5m
        ("rods_individual/bamboo_4m.png", 1080),    # 4.0m
        ("rods_individual/bamboo_6m.png", 1620),    # 6.0m
        ("rods_individual/bamboo_8m.png", 2160),    # 8.0m
    ]
    if all(os.path.exists(p) for p, _ in bamboo_set):
        compose_sheet(bamboo_set, "rods_sheets/bamboo_4_rods_transparent.png")

    hazel_set = [
        ("rods_individual/hazel_2_5m.png", 675),
        ("rods_individual/hazel_4m.png", 1080),
        ("rods_individual/hazel_6m.png", 1620),
        ("rods_individual/hazel_8m.png", 2160),
    ]
    if all(os.path.exists(p) for p, _ in hazel_set):
        compose_sheet(hazel_set, "rods_sheets/hazel_4_rods_transparent.png")


if __name__ == "__main__":
    main()
