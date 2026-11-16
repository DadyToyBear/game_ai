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


def build_sheet(art_dir: str, out_path: str, cell_w: int = 920, cell_h: int = 1100):
    files = [fn for fn in sorted(os.listdir(art_dir)) if fn.endswith(".png")]
    cols, rows = 4, 2
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (0, 0, 0, 0))
    for i, fn in enumerate(files[:8]):
        fig = Image.open(os.path.join(art_dir, fn)).convert("RGBA")
        r, c = divmod(i, cols)
        x = c * cell_w + (cell_w - fig.width) // 2
        y = r * cell_h + (cell_h - 40) - fig.height
        sheet.alpha_composite(fig, (x, y))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sheet.save(out_path, "PNG")
    print(f"Sheet saved: {out_path} -> {sheet.size}")
    return sheet


def make_checker_preview(rgba_img: Image.Image, out_path: str, sq: int = 40):
    bg = Image.new("RGBA", rgba_img.size, (38, 46, 56, 255))
    d = ImageDraw.Draw(bg)
    w, h = rgba_img.size
    for y in range(0, h, sq):
        for x in range(0, w, sq):
            if ((x // sq) + (y // sq)) % 2 == 0:
                d.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(54, 66, 80, 255))
    bg.alpha_composite(rgba_img)
    bg.convert("RGB").save(out_path, "PNG")


def main():
    os.makedirs("fishermen_a_art", exist_ok=True)
    os.makedirs("fishermen_v2_a_art", exist_ok=True)

    # Extract all newly generated A-pose PNGs into fishermen_a_art and fishermen_v2_a_art
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
    process_folder("fishermen_v2_a_raw", "fishermen_v2_a_art", height_map=v2_heights)

    # Sync updated A-pose PNGs to primary art directories as well so all packs stay consistent
    for fn in sorted(os.listdir("fishermen_a_art")):
        if fn.endswith(".png"):
            shutil.copy2(os.path.join("fishermen_a_art", fn), os.path.join("fishermen_art", fn))
    for fn in sorted(os.listdir("fishermen_v2_a_art")):
        if fn.endswith(".png"):
            shutil.copy2(os.path.join("fishermen_v2_a_art", fn), os.path.join("fishermen_v2_art", fn))

    # Build spacious 4x2 transparent sheets (wide enough for open A-pose arms)
    s1 = build_sheet("fishermen_a_art", "fishermen_sheets/fishermen_8_guild_transparent.png", cell_w=920, cell_h=1100)
    s2 = build_sheet("fishermen_v2_a_art", "fishermen_v2_sheets/fishermen_8_archetypes_transparent.png", cell_w=920, cell_h=1100)

    make_checker_preview(s1, "/tmp/apose_sheet1_preview.png")
    make_checker_preview(s2, "/tmp/apose_sheet2_preview.png")

    # Package updated fishermen_medieval_pack.zip
    with zipfile.ZipFile("fishermen_medieval_pack.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.write("fishermen_sheets/fishermen_8_guild_transparent.png", "sheets/fishermen_8_guild_transparent.png")
        for fn in sorted(os.listdir("fishermen_art")):
            if fn.endswith(".png"):
                zf.write(os.path.join("fishermen_art", fn), f"characters/{fn}")
        if os.path.isdir("fishermen_turnarounds"):
            for fn in sorted(os.listdir("fishermen_turnarounds")):
                if fn.endswith(".png"):
                    zf.write(os.path.join("fishermen_turnarounds", fn), f"turnarounds/{fn}")

    # Package updated fishermen_8_archetypes_pack.zip
    with zipfile.ZipFile("fishermen_8_archetypes_pack.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.write("fishermen_v2_sheets/fishermen_8_archetypes_transparent.png", "sheets/fishermen_8_archetypes_transparent.png")
        for fn in sorted(os.listdir("fishermen_v2_art")):
            if fn.endswith(".png"):
                zf.write(os.path.join("fishermen_v2_art", fn), f"characters/{fn}")
        if os.path.isdir("fishermen_v2_turnarounds"):
            for fn in sorted(os.listdir("fishermen_v2_turnarounds")):
                if fn.endswith(".png"):
                    zf.write(os.path.join("fishermen_v2_turnarounds", fn), f"turnarounds/{fn}")

    # Package combined 16-character 3D-ready A-pose ZIP
    with zipfile.ZipFile("fishermen_apose_3d_ready_pack.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.write("fishermen_sheets/fishermen_8_guild_transparent.png", "sheets/fishermen_8_guild_transparent.png")
        zf.write("fishermen_v2_sheets/fishermen_8_archetypes_transparent.png", "sheets/fishermen_8_archetypes_transparent.png")
        for fn in sorted(os.listdir("fishermen_a_art")):
            if fn.endswith(".png"):
                zf.write(os.path.join("fishermen_a_art", fn), f"set1_guild_8/{fn}")
        for fn in sorted(os.listdir("fishermen_v2_a_art")):
            if fn.endswith(".png"):
                zf.write(os.path.join("fishermen_v2_a_art", fn), f"set2_archetypes_8/{fn}")

    print("All 3 ZIP archives rebuilt cleanly.")


if __name__ == "__main__":
    main()
