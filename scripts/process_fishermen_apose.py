import os
import shutil
import zipfile
from PIL import Image, ImageDraw
import numpy as np
from process_fishermen import extract_character_rgba, split_horizontal_figures


def process_folder(raw_dir: str, out_dir: str, height_map: dict[str, int] | None = None):
    if not os.path.isdir(raw_dir):
        return []
    os.makedirs(out_dir, exist_ok=True)
    res = []
    for fn in sorted(os.listdir(raw_dir)):
        if not fn.endswith(".png"):
            continue
        im = Image.open(os.path.join(raw_dir, fn)).convert("RGB")
        rgba = extract_character_rgba(np.array(im))
        figs = split_horizontal_figures(rgba)
        primary = figs[0] if figs else rgba.crop(rgba.getbbox())
        target_h = height_map.get(fn, 960) if height_map else 960
        nw = int(round(primary.width * (target_h / primary.height)))
        scaled = primary.resize((nw, target_h), Image.Resampling.LANCZOS)
        out_p = os.path.join(out_dir, fn)
        scaled.save(out_p, "PNG")
        res.append((fn, scaled))
        print(f"A-pose saved: {out_p} -> {scaled.size}")
    return res


def main():
    os.makedirs("fishermen_a_art", exist_ok=True)
    # Keep 01_novice_peasant from set 1 (already reference A-pose)
    if os.path.exists("fishermen_art/01_novice_peasant.png"):
        shutil.copy2("fishermen_art/01_novice_peasant.png", "fishermen_a_art/01_novice_peasant.png")

    process_folder("fishermen_a_raw", "fishermen_a_art")

    v2_heights = {
        "01_lean_man_35.png": 950,
        "02_plump_elder_68.png": 910,
        "03_young_husky_guy_20.png": 990,
        "04_longlegged_blonde.png": 975,
        "05_thin_elder_woman.png": 865,
        "06_stout_redhead_woman.png": 900,
        "07_young_brunette_22.png": 910,
        "08_stocky_middle_fisherman.png": 905,
    }
    v2_items = process_folder("fishermen_v2_a_raw", "fishermen_v2_a_art", height_map=v2_heights)

    # Preview strip of all ready A-pose characters for visual QA
    all_ready = []
    for folder in ["fishermen_a_art", "fishermen_v2_a_art"]:
        if os.path.isdir(folder):
            for fn in sorted(os.listdir(folder)):
                if fn.endswith(".png"):
                    all_ready.append((folder + "/" + fn, Image.open(folder + "/" + fn).convert("RGBA")))

    if all_ready:
        cols = 5
        rows = (len(all_ready) + cols - 1) // cols
        cw, ch = 720, 1060
        prev = Image.new("RGBA", (cols * cw, rows * ch), (38, 46, 56, 255))
        d = ImageDraw.Draw(prev)
        sq = 32
        for y in range(0, rows * ch, sq):
            for x in range(0, cols * cw, sq):
                if ((x // sq) + (y // sq)) % 2 == 0:
                    d.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(54, 66, 80, 255))
        for i, (_, fig) in enumerate(all_ready):
            r, c = divmod(i, cols)
            px = c * cw + (cw - fig.width) // 2
            py = r * ch + (ch - 35) - fig.height
            prev.alpha_composite(fig, (px, py))
        prev.convert("RGB").save("/tmp/apose_preview.png", "PNG")

    # Package ready 3D A-pose pack
    with zipfile.ZipFile("fishermen_apose_3d_ready_pack.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for folder in ["fishermen_a_art", "fishermen_v2_a_art"]:
            if os.path.isdir(folder):
                for fn in sorted(os.listdir(folder)):
                    if fn.endswith(".png"):
                        zf.write(os.path.join(folder, fn), f"{folder}/{fn}")
    print("Packed fishermen_apose_3d_ready_pack.zip with", len(all_ready), "characters.")


if __name__ == "__main__":
    main()
