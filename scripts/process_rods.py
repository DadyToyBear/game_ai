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

    dw = np.sqrt(
        (255 - rgb[:, :, 0]) ** 2
        + (255 - rgb[:, :, 1]) ** 2
        + (255 - rgb[:, :, 2]) ** 2
    )
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    is_bg_cand = (dw < 48.0) & (chroma < 24)

    # Flood-fill from outer borders
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

    # Enclosed white background windows (inside line guides, reel cage/cranks, tip loop, between line and shaft)
    pure_white_hole = (rgb.min(axis=2) >= 244) & (chroma <= 12)
    bg = visited | pure_white_hole

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

    # Color-bleed RGB outward into transparent background so rotation/scaling produces ZERO white fringe
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
    """Align rod strictly upright (butt at bottom-left -> bottom, tip at top-right -> top)."""
    arr = np.array(im)
    h, w = arr.shape[:2]
    ys, xs = np.where(arr[:, :, 3] > 32)
    pts = np.stack([xs, ys], axis=1).astype(np.float64)

    # All generated rods run from bottom-left (butt) to top-right (tip).
    # Rough direction vector from bottom-left to top-right is (1, -1)/sqrt(2).
    mean = pts.mean(axis=0)
    cov = np.cov((pts - mean).T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    axis = eigvecs[:, np.argmax(eigvals)]
    # Enforce orientation strictly toward upper-right (+x, -y)
    if (axis[0] - axis[1]) < 0:
        axis = -axis

    proj = (pts - mean) @ axis
    p_min, p_max = proj.min(), proj.max()
    perp = np.array([-axis[1], axis[0]])
    span = p_max - p_min

    # Sample clean shaft points skipping the reel zone (12%..36%) and upper curved tip (>70%)
    slice_centers = []
    for t in np.linspace(0.02, 0.68, 32):
        if 0.11 <= t <= 0.36:
            continue
        lo = p_min + (t - 0.015) * span
        hi = p_min + (t + 0.015) * span
        sub = pts[(proj >= lo) & (proj <= hi)]
        if len(sub) >= 4:
            p_med = np.median(sub @ axis)
            q_med = np.median(sub @ perp)
            slice_centers.append(mean + p_med * axis + q_med * perp)

    if len(slice_centers) >= 4:
        sc = np.array(slice_centers)
        sc_mean = sc.mean(axis=0)
        _, ev_sc = np.linalg.eigh(np.cov((sc - sc_mean).T))
        axis_sub = ev_sc[:, 1]
        if (axis_sub[0] - axis_sub[1]) < 0:
            axis_sub = -axis_sub
    else:
        axis_sub = axis

    cur_angle_deg = math.degrees(math.atan2(-axis_sub[1], axis_sub[0]))
    rot_ccw = 90.0 - cur_angle_deg

    rotated = im.rotate(rot_ccw, resample=Image.Resampling.BICUBIC, expand=True)
    bbox = rotated.getbbox()
    if bbox:
        rotated = rotated.crop(bbox)

    # Final sanity safeguard: ensure butt (bottom 15%) is strictly wider/heavier than tip (top 15%)
    r_arr = np.array(rotated)
    rh = r_arr.shape[0]
    top_mass = (r_arr[: max(1, int(rh * 0.15)), :, 3] > 32).sum()
    bot_mass = (r_arr[min(rh - 1, int(rh * 0.85)) :, :, 3] > 32).sum()
    if top_mass > bot_mass * 1.5:
        rotated = rotated.rotate(180, expand=True)
        bb2 = rotated.getbbox()
        if bb2:
            rotated = rotated.crop(bb2)
    return rotated


def resize_to_height(im: Image.Image, target_h: int) -> Image.Image:
    w, h = im.size
    scale = target_h / float(h)
    target_w = max(8, int(round(w * scale)))
    return im.resize((target_w, target_h), Image.Resampling.LANCZOS)


def compose_sheet(rod_paths_heights: list[tuple[str, int]], out_path: str, canvas_w: int = 1600, canvas_h: int = 2400):
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    # Give extra right margin on the 4th column so large 8m reels never clip the right edge
    col_xs = [190, 545, 905, 1280]
    base_y = canvas_h - 110

    for idx, (path, target_h) in enumerate(rod_paths_heights):
        rod = Image.open(path).convert("RGBA")
        rod_scaled = resize_to_height(rod, target_h)
        cx = col_xs[idx]
        arr = np.array(rod_scaled)
        rh, rw = arr.shape[:2]
        bot_ys, bot_xs = np.where(arr[int(rh * 0.94) :, :, 3] > 40)
        butt_cx = float(bot_xs.mean()) if len(bot_xs) else rw / 2.0
        paste_x = max(16, min(canvas_w - rw - 16, int(round(cx - butt_cx))))
        paste_y = base_y - rh
        canvas.alpha_composite(rod_scaled, (paste_x, paste_y))

    canvas.save(out_path, "PNG")
    print(f"Saved sheet: {out_path} ({canvas_w}x{canvas_h})")


def process_batch(raw_dir: str, indiv_dir: str, sheet_dir: str, suffix: str):
    if not os.path.isdir(raw_dir):
        return
    os.makedirs(indiv_dir, exist_ok=True)
    os.makedirs(sheet_dir, exist_ok=True)

    for fn in sorted(os.listdir(raw_dir)):
        if not fn.endswith(".png"):
            continue
        raw_p = os.path.join(raw_dir, fn)
        rgba = extract_clean_rgba(raw_p)
        upright = rotate_upright(rgba)
        out_p = os.path.join(indiv_dir, fn)
        upright.save(out_p, "PNG")
        print(f"Processed individual: {out_p} -> {upright.size}")

    bamboo_set = [
        (f"{indiv_dir}/bamboo_2_5m.png", 675),
        (f"{indiv_dir}/bamboo_4m.png", 1080),
        (f"{indiv_dir}/bamboo_6m.png", 1620),
        (f"{indiv_dir}/bamboo_8m.png", 2160),
    ]
    if all(os.path.exists(p) for p, _ in bamboo_set):
        compose_sheet(bamboo_set, f"{sheet_dir}/bamboo_4_rods{suffix}_transparent.png")

    hazel_set = [
        (f"{indiv_dir}/hazel_2_5m.png", 675),
        (f"{indiv_dir}/hazel_4m.png", 1080),
        (f"{indiv_dir}/hazel_6m.png", 1620),
        (f"{indiv_dir}/hazel_8m.png", 2160),
    ]
    if all(os.path.exists(p) for p, _ in hazel_set):
        compose_sheet(hazel_set, f"{sheet_dir}/hazel_4_rods{suffix}_transparent.png")


def main():
    process_batch("rods_raw", "rods_individual", "rods_sheets", "")
    process_batch("rods_reel_raw", "rods_reel_individual", "rods_reel_sheets", "_reel")


if __name__ == "__main__":
    main()
