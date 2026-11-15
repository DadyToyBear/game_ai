import json
import math
import os
import textwrap
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


FONT_DIR = "assets/fonts"
F_TITLE = f"{FONT_DIR}/Exo2-800.ttf"
F_EXO_BOLD = f"{FONT_DIR}/Exo2-700.ttf"
F_EXO_SEMI = f"{FONT_DIR}/Exo2-600.ttf"
F_BODY_REG = f"{FONT_DIR}/Montserrat-400.ttf"
F_BODY_MED = f"{FONT_DIR}/Montserrat-500.ttf"
F_BODY_SEMI = f"{FONT_DIR}/Montserrat-600.ttf"
F_BODY_BOLD = f"{FONT_DIR}/Montserrat-700.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def draw_star(draw, cx, cy, r_outer, r_inner, fill, outline=None):
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        r = r_outer if i % 2 == 0 else r_inner
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    draw.polygon(pts, fill=fill, outline=outline)


def make_vertical_gradient(w, h, top_rgb, bot_rgb):
    t = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None, None]
    top = np.array(top_rgb, dtype=np.float32)[None, None, :]
    bot = np.array(bot_rgb, dtype=np.float32)[None, None, :]
    grad = (top * (1.0 - t) + bot * t).astype(np.uint8)
    arr = np.broadcast_to(grad, (h, w, 3)).copy()
    return Image.fromarray(arr, mode="RGB").convert("RGBA")


def add_radial_glow(canvas, cx, cy, rx, ry, color_rgb, max_alpha):
    w, h = canvas.size
    y, x = np.ogrid[:h, :w]
    dist = np.sqrt(((x - cx) / float(rx)) ** 2 + ((y - cy) / float(ry)) ** 2)
    alpha = np.clip(1.0 - dist, 0.0, 1.0) ** 2.1 * max_alpha
    overlay = np.zeros((h, w, 4), dtype=np.uint8)
    overlay[:, :, 0] = color_rgb[0]
    overlay[:, :, 1] = color_rgb[1]
    overlay[:, :, 2] = color_rgb[2]
    overlay[:, :, 3] = alpha.astype(np.uint8)
    return Image.alpha_composite(canvas, Image.fromarray(overlay, mode="RGBA"))


def fit_sprite(sprite: Image.Image, max_w: int, max_h: int) -> Image.Image:
    sw, sh = sprite.size
    scale = min(max_w / sw, max_h / sh)
    nw = max(1, int(round(sw * scale)))
    nh = max(1, int(round(sh * scale)))
    return sprite.resize((nw, nh), Image.Resampling.LANCZOS)


def make_drop_shadow(sprite: Image.Image, blur=18, opacity=120) -> tuple[Image.Image, int]:
    alpha = sprite.split()[3]
    shadow = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
    solid = Image.new("RGBA", sprite.size, (4, 10, 20, opacity))
    shadow.paste(solid, (0, 0), alpha)
    pad = blur * 4
    padded = Image.new("RGBA", (sprite.width + pad * 2, sprite.height + pad * 2), (0, 0, 0, 0))
    padded.paste(shadow, (pad, pad))
    return padded.filter(ImageFilter.GaussianBlur(blur)), pad


def wrap_lines(draw, text, fnt, max_width):
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        test = (cur + " " + w).strip()
        bbox = draw.textbbox((0, 0), test, font=fnt)
        if bbox[2] - bbox[0] <= max_width or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_game_card(sp: dict, sprite: Image.Image, out_path: str):
    W, H = 900, 1200
    is_pred = sp["is_predator"]

    if is_pred:
        bg_top = (16, 20, 34)
        bg_bot = (8, 12, 22)
        glow_rgb = (230, 82, 74)
        accent_main = (235, 132, 68)
        accent_bright = (252, 185, 110)
        pill_fill = (82, 24, 34, 235)
        pill_border = (239, 83, 80, 255)
        pill_text = (255, 228, 230)
        arena_top = (18, 28, 46, 230)
        arena_border = (195, 104, 62, 180)
        num_fill = (74, 26, 36, 245)
    else:
        bg_top = (10, 29, 48)
        bg_bot = (6, 17, 31)
        glow_rgb = (56, 189, 248)
        accent_main = (212, 175, 85)
        accent_bright = (245, 214, 130)
        pill_fill = (12, 64, 92, 235)
        pill_border = (56, 189, 248, 255)
        pill_text = (224, 247, 255)
        arena_top = (11, 36, 58, 230)
        arena_border = (86, 178, 214, 170)
        num_fill = (16, 56, 82, 245)

    canvas = make_vertical_gradient(W, H, bg_top, bg_bot)
    canvas = add_radial_glow(canvas, W // 2, 375, 420, 250, glow_rgb, 68)
    canvas = add_radial_glow(canvas, W // 2, 1060, 380, 160, (245, 190, 70), 26)

    draw = ImageDraw.Draw(canvas, "RGBA")

    # Outer ornate metallic frame
    draw.rounded_rectangle((18, 18, W - 18, H - 18), radius=28, outline=(*accent_main, 220), width=4)
    draw.rounded_rectangle((28, 28, W - 28, H - 28), radius=22, outline=(*accent_bright, 90), width=2)

    # Corner accents
    for cx, cy, dx, dy in [
        (36, 36, 1, 1),
        (W - 36, 36, -1, 1),
        (36, H - 36, 1, -1),
        (W - 36, H - 36, -1, -1),
    ]:
        draw.line([(cx, cy), (cx + dx * 24, cy)], fill=(*accent_bright, 210), width=3)
        draw.line([(cx, cy), (cx, cy + dy * 24)], fill=(*accent_bright, 210), width=3)

    # Header section (y = 44 .. 154)
    num_str = f"#{sp['num']:02d}"
    draw.rounded_rectangle((46, 50, 118, 102), radius=14, fill=num_fill, outline=(*accent_bright, 200), width=2)
    f_num = font(F_EXO_BOLD, 24)
    nb = draw.textbbox((0, 0), num_str, font=f_num)
    draw.text((46 + (72 - (nb[2] - nb[0])) / 2, 50 + (52 - (nb[3] - nb[1])) / 2 - 4), num_str, font=f_num, fill=accent_bright)

    # Fish Name (auto-fit if long)
    name_upper = sp["name_ru"].upper()
    title_size = 42
    while title_size > 28:
        f_title = font(F_TITLE, title_size)
        tb = draw.textbbox((0, 0), name_upper, font=f_title)
        if tb[2] - tb[0] <= 465:
            break
        title_size -= 2
    draw.text((136, 44), name_upper, font=f_title, fill=(0, 0, 0, 180))
    draw.text((134, 42), name_upper, font=f_title, fill=(250, 252, 255, 255))

    # Latin + Family subtitle
    sub_str = f"{sp['latin']}  ·  Сем. {sp['family_ru']}"
    f_sub = font(F_BODY_MED, 17)
    sb = draw.textbbox((0, 0), sub_str, font=f_sub)
    if sb[2] - sb[0] > 470:
        f_sub = font(F_BODY_MED, 15)
    draw.text((134, 96), sub_str, font=f_sub, fill=(176, 198, 218, 235))

    # Category pill on top right
    cat_str = sp["category"].upper()
    f_pill = font(F_EXO_BOLD, 17)
    pb = draw.textbbox((0, 0), cat_str, font=f_pill)
    pw = max(195, (pb[2] - pb[0]) + 34)
    px0 = W - 46 - pw
    draw.rounded_rectangle((px0, 48, W - 46, 92), radius=18, fill=pill_fill, outline=pill_border, width=2)
    draw.text((px0 + (pw - (pb[2] - pb[0])) / 2, 48 + (44 - (pb[3] - pb[1])) / 2 - 3), cat_str, font=f_pill, fill=pill_text)

    # Subcategory right-aligned safely inside header margin
    f_subcat = font(F_BODY_SEMI, 14)
    scb = draw.textbbox((0, 0), sp["subcategory"], font=f_subcat)
    if scb[2] - scb[0] > 235:
        f_subcat = font(F_BODY_SEMI, 13)
        scb = draw.textbbox((0, 0), sp["subcategory"], font=f_subcat)
    sub_x = min(W - 46 - (scb[2] - scb[0]), px0 + (pw - (scb[2] - scb[0])) / 2)
    draw.text((sub_x, 100), sp["subcategory"], font=f_subcat, fill=(*accent_bright, 225))

    # Thin divider
    draw.line([(46, 134), (W - 46, 134)], fill=(*accent_main, 90), width=1)

    # Showcase Arena (y = 148 .. 568)
    ax0, ay0, ax1, ay1 = 44, 148, W - 44, 566
    draw.rounded_rectangle((ax0, ay0, ax1, ay1), radius=20, fill=arena_top, outline=arena_border, width=2)

    # Subtle underwater water-depth lines & scale ruler ticks inside arena
    for ry in range(ay0 + 48, ay1 - 36, 48):
        draw.line([(ax0 + 18, ry), (ax1 - 18, ry)], fill=(180, 225, 255, 14), width=1)
    # Subtle depth ruler ticks along bottom edge of arena
    ruler_y = ay1 - 16
    draw.line([(ax0 + 28, ruler_y), (ax1 - 28, ruler_y)], fill=(*accent_bright, 55), width=1)
    for idx, rx in enumerate(range(ax0 + 28, ax1 - 24, 24)):
        tick_h = 8 if idx % 4 == 0 else 4
        draw.line([(rx, ruler_y - tick_h), (rx, ruler_y)], fill=(*accent_bright, 85 if idx % 4 == 0 else 40), width=1)

    # Habitat pill at top-left of arena
    hab_text = f"Обитание: {sp['habitat']}"
    f_hab = font(F_BODY_MED, 14)
    hb = draw.textbbox((0, 0), hab_text, font=f_hab)
    draw.rounded_rectangle((ax0 + 16, ay0 + 14, ax0 + 36 + (hb[2] - hb[0]), ay0 + 44), radius=11, fill=(7, 18, 30, 175), outline=(140, 195, 230, 65), width=1)
    draw.text((ax0 + 26, ay0 + 20), hab_text, font=f_hab, fill=(195, 222, 242, 235))

    # Composite fish sprite + drop shadow
    fitted = fit_sprite(sprite, 740, 325)
    fx = (ax0 + ax1 - fitted.width) // 2
    fy = ay0 + 46 + ((ay1 - ay0 - 66) - fitted.height) // 2
    shadow, spad = make_drop_shadow(fitted, blur=18, opacity=140)
    canvas.alpha_composite(shadow, (fx - spad, fy - spad + 12))
    canvas.alpha_composite(fitted, (fx, fy))

    draw = ImageDraw.Draw(canvas, "RGBA")

    # Distinguishing anatomical traits box (y = 582 .. 660)
    tx0, ty0, tx1, ty1 = 44, 582, W - 44, 658
    draw.rounded_rectangle((tx0, ty0, tx1, ty1), radius=14, fill=(12, 28, 46, 210), outline=(*accent_main, 85), width=1)
    f_trait_lbl = font(F_EXO_BOLD, 14)
    f_trait = font(F_BODY_MED, 16)
    draw.text((tx0 + 18, ty0 + 10), "ВНЕШНИЕ ПРИЗНАКИ:", font=f_trait_lbl, fill=(*accent_bright, 240))
    lines = wrap_lines(draw, sp["traits"], f_trait, (tx1 - tx0) - 36)
    ty_text = ty0 + 30
    for ln in lines[:2]:
        draw.text((tx0 + 18, ty_text), ln, font=f_trait, fill=(224, 236, 248, 245))
        ty_text += 21

    # Section Divider: РАЗМЕРЫ И ВЕС (y = 674 .. 700)
    sec_lbl = "КАТЕГОРИИ РАЗМЕРА И ВЕСА"
    f_sec = font(F_EXO_BOLD, 17)
    sec_b = draw.textbbox((0, 0), sec_lbl, font=f_sec)
    sw_txt = sec_b[2] - sec_b[0]
    sx_txt = (W - sw_txt) / 2
    draw.line([(46, 686), (sx_txt - 18, 686)], fill=(*accent_main, 120), width=2)
    draw.line([(sx_txt + sw_txt + 18, 686), (W - 46, 686)], fill=(*accent_main, 120), width=2)
    draw.text((sx_txt, 674), sec_lbl, font=f_sec, fill=(*accent_bright, 245))

    # 4 Tier Cards (y = 710 .. 1138)
    tier_defs = [
        ("meloch", "МЕЛОЧЬ", "от 70 г", (147, 197, 253), (20, 42, 68, 220), (96, 165, 250, 140), False),
        ("srednyaya", "СРЕДНЯЯ", "250·400·600·800 г", (52, 211, 153), (14, 48, 56, 225), (52, 211, 153, 150), False),
        ("krupnaya", "КРУПНАЯ", "от 1 кг и выше", (251, 146, 60), (48, 34, 30, 225), (251, 146, 60, 165), False),
        ("trofey", "ТРОФЕЙ", "7 – 27 кг (вид)", (250, 204, 21), (56, 44, 18, 238), (250, 204, 21, 235), True),
    ]

    row_y = 712
    row_h = 94
    row_gap = 12
    f_tier_name = font(F_EXO_BOLD, 21)
    f_tier_sub = font(F_BODY_MED, 13)
    f_val_lbl = font(F_BODY_SEMI, 12)
    f_val_big = font(F_EXO_BOLD, 25)
    f_len_big = font(F_EXO_BOLD, 25)

    for key, t_name, t_sub, col_rgb, row_bg, row_border, is_trophy in tier_defs:
        rx0, ry0, rx1, ry1 = 44, row_y, W - 44, row_y + row_h
        draw.rounded_rectangle((rx0, ry0, rx1, ry1), radius=15, fill=row_bg, outline=row_border, width=2 if is_trophy else 1)
        # Left colored bar
        draw.rounded_rectangle((rx0 + 4, ry0 + 8, rx0 + 13, ry1 - 8), radius=4, fill=(*col_rgb, 255))

        # Tier title & subnote
        tx = rx0 + 28
        if is_trophy:
            draw_star(draw, tx + 11, ry0 + 34, 11, 4.5, fill=(250, 204, 21, 255))
            draw.text((tx + 28, ry0 + 20), t_name, font=f_tier_name, fill=(254, 240, 138, 255))
        else:
            draw.text((tx, ry0 + 20), t_name, font=f_tier_name, fill=(*col_rgb, 255))
        draw.text((tx, ry0 + 52), t_sub, font=f_tier_sub, fill=(185, 202, 220, 210))

        # Vertical separators inside row
        draw.line([(322, ry0 + 16), (322, ry1 - 16)], fill=(255, 255, 255, 28), width=1)
        draw.line([(632, ry0 + 16), (632, ry1 - 16)], fill=(255, 255, 255, 28), width=1)

        t_data = sp["tiers"][key]
        # Weight column (x = 342 .. 618)
        draw.text((344, ry0 + 15), "ВЕС ЭКЗЕМПЛЯРА", font=f_val_lbl, fill=(158, 182, 204, 200))
        w_str = t_data["w_label"]
        w_font = f_val_big if len(w_str) <= 16 else font(F_EXO_BOLD, 21)
        draw.text((344, ry0 + 40), w_str, font=w_font, fill=(255, 255, 255, 255) if not is_trophy else (254, 243, 199, 255))

        # Length column (x = 652 .. 838)
        draw.text((654, ry0 + 15), "ДЛИНА (ОТ И ДО)", font=f_val_lbl, fill=(158, 182, 204, 200))
        l_str = f"{t_data['l_min_cm']} – {t_data['l_max_cm']} см"
        draw.text((654, ry0 + 40), l_str, font=f_len_big, fill=(*col_rgb, 255) if is_trophy else (232, 244, 255, 255))

        row_y += row_h + row_gap

    # Footer (y = 1144 .. 1172)
    foot_txt = f"КАРТОЧКА РЫБЫ #{sp['num']:02d}  ·  {sp['name_ru'].upper()}  ·  ИГРОВОЙ СПРАВОЧНИК"
    f_foot = font(F_BODY_SEMI, 12)
    fb = draw.textbbox((0, 0), foot_txt, font=f_foot)
    draw.text(((W - (fb[2] - fb[0])) / 2, 1148), foot_txt, font=f_foot, fill=(138, 162, 188, 175))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.convert("RGB").save(out_path, "PNG", optimize=True)


def render_clean_card(sp: dict, sprite: Image.Image, out_path: str):
    W, H = 900, 1200
    is_pred = sp["is_predator"]

    canvas = Image.new("RGBA", (W, H), (246, 249, 253, 255))
    draw = ImageDraw.Draw(canvas, "RGBA")

    accent = (214, 58, 66) if is_pred else (14, 138, 178)
    pill_bg = (254, 226, 226, 255) if is_pred else (224, 242, 254, 255)
    pill_txt = (153, 27, 27) if is_pred else (7, 89, 133)

    # Top minimal accent stripe
    draw.rectangle((0, 0, W, 10), fill=(*accent, 255))

    # Header
    num_str = f"#{sp['num']:02d}"
    f_num = font(F_EXO_BOLD, 24)
    draw.text((48, 42), num_str, font=f_num, fill=(*accent, 255))

    name_upper = sp["name_ru"].upper()
    title_size = 42
    while title_size > 28:
        f_title = font(F_TITLE, title_size)
        tb = draw.textbbox((0, 0), name_upper, font=f_title)
        if tb[2] - tb[0] <= 470:
            break
        title_size -= 2
    draw.text((112, 32), name_upper, font=f_title, fill=(15, 23, 42, 255))

    sub_str = f"{sp['latin']}  ·  {sp['family_ru']}  ·  {sp['subcategory']}"
    f_sub = font(F_BODY_MED, 16)
    sb = draw.textbbox((0, 0), sub_str, font=f_sub)
    if sb[2] - sb[0] > 560:
        f_sub = font(F_BODY_MED, 14)
    draw.text((48, 88), sub_str, font=f_sub, fill=(71, 85, 105, 255))

    # Category Pill
    cat_str = sp["category"].upper()
    f_pill = font(F_EXO_BOLD, 16)
    pb = draw.textbbox((0, 0), cat_str, font=f_pill)
    pw = max(185, (pb[2] - pb[0]) + 32)
    px0 = W - 48 - pw
    draw.rounded_rectangle((px0, 38, W - 48, 80), radius=21, fill=pill_bg)
    draw.text((px0 + (pw - (pb[2] - pb[0])) / 2, 38 + (42 - (pb[3] - pb[1])) / 2 - 3), cat_str, font=f_pill, fill=(*pill_txt, 255))

    draw.line([(48, 124), (W - 48, 124)], fill=(203, 213, 225, 255), width=2)

    # Borderless Clean Showcase Area (soft subtle shadow on clean light backdrop)
    fitted = fit_sprite(sprite, 760, 355)
    fx = (W - fitted.width) // 2
    fy = 152 + (390 - fitted.height) // 2
    shadow, spad = make_drop_shadow(fitted, blur=16, opacity=45)
    canvas.alpha_composite(shadow, (fx - spad, fy - spad + 14))
    canvas.alpha_composite(fitted, (fx, fy))

    draw = ImageDraw.Draw(canvas, "RGBA")

    # Traits & Habitat (clean minimal typography, no heavy box)
    f_lbl = font(F_EXO_BOLD, 14)
    f_tr = font(F_BODY_MED, 16)
    draw.text((48, 566), f"ОБИТАНИЕ: {sp['habitat']}", font=f_lbl, fill=(*accent, 255))
    lines = wrap_lines(draw, f"Признаки: {sp['traits']}", f_tr, W - 96)
    ly = 594
    for ln in lines[:2]:
        draw.text((48, ly), ln, font=f_tr, fill=(51, 65, 85, 255))
        ly += 22

    draw.line([(48, 654), (W - 48, 654)], fill=(203, 213, 225, 255), width=2)

    # Clean 4-row table
    tier_defs = [
        ("meloch", "МЕЛОЧЬ", "от 70 г", (239, 246, 255, 255), (37, 99, 235)),
        ("srednyaya", "СРЕДНЯЯ", "250–800 г", (236, 253, 245, 255), (5, 150, 105)),
        ("krupnaya", "КРУПНАЯ", "от 1 кг+", (255, 247, 237, 255), (217, 119, 6)),
        ("trofey", "ТРОФЕЙ", "7 – 27 кг", (254, 249, 195, 255), (161, 98, 7)),
    ]

    row_y = 678
    row_h = 102
    row_gap = 12
    f_tn = font(F_EXO_BOLD, 21)
    f_ts = font(F_BODY_MED, 13)
    f_hl = font(F_BODY_SEMI, 12)
    f_val = font(F_EXO_BOLD, 25)

    for key, t_name, t_sub, row_bg, t_col in tier_defs:
        rx0, ry0, rx1, ry1 = 48, row_y, W - 48, row_y + row_h
        draw.rounded_rectangle((rx0, ry0, rx1, ry1), radius=14, fill=row_bg)
        draw.rounded_rectangle((rx0, ry0, rx0 + 8, ry1), radius=4, fill=(*t_col, 255))

        draw.text((rx0 + 26, ry0 + 22), t_name, font=f_tn, fill=(*t_col, 255))
        draw.text((rx0 + 26, ry0 + 54), t_sub, font=f_ts, fill=(100, 116, 139, 255))

        t_data = sp["tiers"][key]
        draw.text((340, ry0 + 18), "ВЕС", font=f_hl, fill=(100, 116, 139, 255))
        w_str = t_data["w_label"]
        wf = f_val if len(w_str) <= 16 else font(F_EXO_BOLD, 21)
        draw.text((340, ry0 + 42), w_str, font=wf, fill=(15, 23, 42, 255))

        draw.text((645, ry0 + 18), "ДЛИНА", font=f_hl, fill=(100, 116, 139, 255))
        draw.text((645, ry0 + 42), f"{t_data['l_min_cm']} – {t_data['l_max_cm']} см", font=f_val, fill=(15, 23, 42, 255))

        row_y += row_h + row_gap

    f_foot = font(F_BODY_MED, 12)
    foot_txt = f"#{sp['num']:02d} {sp['name_ru']} · Упрощённая карточка без рамки"
    fb = draw.textbbox((0, 0), foot_txt, font=f_foot)
    draw.text(((W - (fb[2] - fb[0])) / 2, 1152), foot_txt, font=f_foot, fill=(148, 163, 184, 255))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.convert("RGB").save(out_path, "PNG", optimize=True)


def main():
    with open("data/fish_database.json", "r", encoding="utf-8") as f:
        species_list = json.load(f)

    rendered = 0
    for sp in species_list:
        slug = sp["slug"]
        art_path = f"fish_art/{slug}.png"
        if not os.path.exists(art_path):
            continue
        sprite = Image.open(art_path).convert("RGBA")
        render_game_card(sp, sprite, f"cards_game/{slug}.png")
        render_clean_card(sp, sprite, f"cards_clean/{slug}.png")
        rendered += 1
        print(f"Rendered cards for {slug}")
    print(f"Total fish rendered (x2 styles): {rendered}")


if __name__ == "__main__":
    main()
