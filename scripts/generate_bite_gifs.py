import json
import math
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 440, 268
WATER_Y = 74
SCENE_H = 158
GRAPH_TOP = 160

FONT_TITLE = ImageFont.truetype("assets/fonts/Exo2-700.ttf", 13)
FONT_BADGE = ImageFont.truetype("assets/fonts/Exo2-700.ttf", 12)
FONT_SMALL = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 10)
FONT_TINY = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 9)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def eval_profile(anim: dict, t: float):
    keys = anim["keys"]
    if t <= keys[0][0]:
        y, x, tilt, label = keys[0][1], keys[0][2], keys[0][3], keys[0][4]
    elif t >= keys[-1][0]:
        y, x, tilt, label = keys[-1][1], keys[-1][2], keys[-1][3], keys[-1][4]
    else:
        y, x, tilt, label = keys[-1][1], keys[-1][2], keys[-1][3], keys[-1][4]
        for i in range(len(keys) - 1):
            t0, y0, x0, a0, l0 = keys[i]
            t1, y1, x1, a1, l1 = keys[i + 1]
            if t0 <= t <= t1:
                u = (t - t0) / max(1e-6, (t1 - t0))
                # Smoothstep for natural water motion
                s = u * u * (3.0 - 2.0 * u)
                y = lerp(y0, y1, s)
                x = lerp(x0, x1, s)
                tilt = lerp(a0, a1, s)
                label = l0 if u < 0.5 else l1
                break

    # Apply tremble micro-oscillations
    for t_s, t_e, amp in anim.get("tremble", []):
        if t_s <= t <= t_e:
            fade = min(1.0, (t - t_s) / 0.12) * min(1.0, (t_e - t) / 0.12)
            vib = math.sin(t * 28.0) * 0.65 + math.sin(t * 47.0) * 0.35
            y += vib * amp * fade
            tilt += vib * amp * 16.0 * fade
    return y, x, tilt, label


def precompute_curve(anim: dict, samples: int = 120):
    dur = anim["duration"]
    pts = []
    for i in range(samples + 1):
        t = dur * i / samples
        y, x, tilt, _ = eval_profile(anim, t)
        pts.append((t, y, x, tilt))
    return pts


def draw_dashed_line(draw: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, fill, dash=5, gap=4, width=1):
    dx, dy = x1 - x0, y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 1:
        return
    ux, uy = dx / dist, dy / dist
    pos = 0.0
    while pos < dist:
        end = min(dist, pos + dash)
        draw.line(
            [(x0 + ux * pos, y0 + uy * pos), (x0 + ux * end, y0 + uy * end)],
            fill=fill,
            width=width,
        )
        pos += dash + gap


def rot_pt(cx: float, cy: float, px: float, py: float, deg: float):
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    dx, dy = px - cx, py - cy
    return cx + dx * c - dy * s, cy + dx * s + dy * c


def build_static_bg(night: bool, bottom_type: str) -> Image.Image:
    img = Image.new("RGB", (W, H), (245, 249, 253))
    draw = ImageDraw.Draw(img)

    # Sky gradient
    for y in range(WATER_Y):
        u = y / max(1, WATER_Y - 1)
        if night:
            r = int(lerp(18, 32, u))
            g = int(lerp(28, 48, u))
            b = int(lerp(52, 82, u))
        else:
            r = int(lerp(200, 232, u))
            g = int(lerp(228, 245, u))
            b = int(lerp(248, 254, u))
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Moon / stars if night
    if night:
        draw.ellipse([322, 14, 342, 34], fill=(245, 238, 195))
        draw.ellipse([328, 12, 346, 30], fill=(20, 32, 58))
        for sx, sy in [(215, 14), (252, 27), (288, 13), (368, 22)]:
            draw.rectangle([sx, sy, sx + 1, sy + 1], fill=(220, 235, 255))

    # Underwater gradient
    for y in range(WATER_Y, SCENE_H):
        u = (y - WATER_Y) / max(1, SCENE_H - WATER_Y - 1)
        if night:
            r = int(lerp(24, 10, u))
            g = int(lerp(62, 26, u))
            b = int(lerp(98, 46, u))
        else:
            r = int(lerp(108, 32, u))
            g = int(lerp(188, 92, u))
            b = int(lerp(222, 134, u))
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Soft caustic vertical rays
    ray_color = (128, 204, 234) if not night else (30, 74, 112)
    for rx in [60, 145, 265, 355]:
        draw.polygon([(rx, WATER_Y), (rx + 18, WATER_Y), (rx + 42, SCENE_H - 12), (rx + 12, SCENE_H - 12)], fill=ray_color)

    # Re-apply subtle vertical fade over rays near bottom
    for y in range(SCENE_H - 28, SCENE_H):
        u = (y - (SCENE_H - 28)) / 27.0
        col = (24, 72, 105) if not night else (11, 28, 48)
        if u > 0.45:
            draw.line([(0, y), (W, y)], fill=col)

    # Bottom bed
    bed_y = SCENE_H - 14
    if bottom_type == "silt":
        bed_col = (52, 58, 46) if not night else (28, 32, 28)
        draw.polygon([(0, bed_y + 2), (110, bed_y - 2), (250, bed_y + 3), (380, bed_y - 1), (W, bed_y + 2), (W, SCENE_H), (0, SCENE_H)], fill=bed_col)
    elif bottom_type == "sand":
        bed_col = (145, 134, 96) if not night else (68, 66, 52)
        draw.polygon([(0, bed_y + 2), (90, bed_y), (220, bed_y + 3), (340, bed_y - 1), (W, bed_y + 2), (W, SCENE_H), (0, SCENE_H)], fill=bed_col)
    elif bottom_type == "stones":
        bed_col = (84, 90, 86) if not night else (42, 46, 48)
        draw.rectangle([0, bed_y + 2, W, SCENE_H], fill=bed_col)
        stone_c = (112, 118, 114) if not night else (58, 62, 66)
        for sx, sw, sh in [(28, 26, 12), (82, 18, 9), (156, 30, 13), (264, 22, 10), (346, 32, 14), (402, 20, 10)]:
            draw.ellipse([sx, SCENE_H - sh - 2, sx + sw, SCENE_H + 2], fill=stone_c)
    elif bottom_type == "snags":
        bed_col = (64, 58, 46) if not night else (30, 28, 26)
        draw.rectangle([0, bed_y + 2, W, SCENE_H], fill=bed_col)
        snag_c = (74, 52, 34) if not night else (38, 28, 22)
        draw.line([(335, SCENE_H - 4), (378, SCENE_H - 22), (420, SCENE_H - 28)], fill=snag_c, width=6)
        draw.line([(378, SCENE_H - 22), (398, SCENE_H - 42)], fill=snag_c, width=4)
        draw.line([(360, SCENE_H - 14), (344, SCENE_H - 34)], fill=snag_c, width=3)
    elif bottom_type == "weeds":
        bed_col = (56, 72, 48) if not night else (28, 38, 28)
        draw.rectangle([0, bed_y + 2, W, SCENE_H], fill=bed_col)
        weed_c = (44, 126, 72) if not night else (24, 68, 44)
        for wx, wh in [(32, 52), (46, 42), (72, 48), (348, 56), (366, 68), (388, 44), (410, 62)]:
            draw.line([(wx, SCENE_H - 4), (wx + 5, SCENE_H - wh // 2), (wx - 4, SCENE_H - wh)], fill=weed_c, width=3)

    # Bottom panel separator & graph container
    draw.rectangle([0, SCENE_H, W, GRAPH_TOP], fill=(208, 222, 236))
    draw.rectangle([0, GRAPH_TOP, W, H], fill=(248, 251, 255))

    return img


def render_bite_gif(item: dict, out_path: str, is_base: bool = False):
    anim = item["anim"]
    dur = anim["duration"]
    night = (not is_base) and (item["slug"] in {"20_nalim", "24_som"})
    bottom_type = anim.get("bottom", "sand")
    base_bg = build_static_bg(night, bottom_type)
    curve = precompute_curve(anim, samples=120)

    fps = 18
    n_frames = max(36, int(round(dur * fps)))
    frame_ms = int(round(1000 / fps))

    # Graph box coordinates
    gx0, gy0, gx1, gy1 = 56, GRAPH_TOP + 18, W - 16, H - 22
    g_zero_y = gy0 + int((gy1 - gy0) * 0.36)
    y_scale = 18.5  # pixels per 1.0 y_norm

    hook_s, hook_e = anim["hook_window"]
    hx0 = gx0 + int((hook_s / dur) * (gx1 - gx0))
    hx1 = gx0 + int((hook_e / dur) * (gx1 - gx0))

    # Pre-build bubble seeds
    bubbles_seed = [
        (178, 0.15), (192, 0.42), (168, 0.72), (186, 0.88), (202, 0.28)
    ] if anim.get("bubbles") else []

    frames = []
    for fi in range(n_frames):
        t = dur * fi / n_frames
        y_val, x_val, tilt_deg, phase_label = eval_profile(anim, t)
        in_hook = (hook_s <= t <= hook_e)

        frame = base_bg.copy()
        draw = ImageDraw.Draw(frame)

        # Animated water surface ripples
        wave_pts = []
        for wx in range(0, W + 8, 8):
            wy = WATER_Y + math.sin(wx * 0.06 + fi * 0.35) * 1.4
            wave_pts.append((wx, wy))
        draw.line(wave_pts, fill=(212, 240, 254) if not night else (94, 152, 206), width=2)

        # Float center on water
        base_fx = 185
        fx = base_fx + x_val * 72.0
        # Positive y_val means LIFT up (smaller pixel y); negative means SINK down (larger pixel y)
        fy = WATER_Y - y_val * 21.0

        # Concentric surface ripples around float
        if abs(y_val) > 0.06 or abs(x_val) > 0.04 or abs(tilt_deg) > 3.0:
            rip_r = 10 + (fi % 9) * 3.2
            rip_col = (232, 248, 255) if not night else (110, 168, 222)
            draw.arc([fx - rip_r, WATER_Y - 3, fx + rip_r, WATER_Y + 3], 0, 360, fill=rip_col, width=1)
            if rip_r > 18:
                r2 = rip_r - 12
                draw.arc([fx - r2, WATER_Y - 2, fx + r2, WATER_Y + 2], 0, 360, fill=rip_col, width=1)

        # Rising bubbles if bottom feeder
        for bx_base, ph in bubbles_seed:
            b_prog = ((t / dur) + ph) % 1.0
            by = (SCENE_H - 18) - b_prog * (SCENE_H - WATER_Y - 24)
            bx = bx_base + math.sin(b_prog * 14.0 + ph * 6.0) * 4.0
            b_col = (205, 242, 255) if not night else (120, 175, 220)
            draw.ellipse([bx - 2, by - 2, bx + 2, by + 2], outline=b_col, width=1)

        # Fishing line from left rod tip (below status badge) to float keel & down to sinker
        rod_x, rod_y = 8, 46
        ant_tip = rot_pt(fx, fy, fx, fy - 28, tilt_deg)
        ant_mid = rot_pt(fx, fy, fx, fy - 12, tilt_deg)
        body_top = rot_pt(fx, fy, fx, fy - 7, tilt_deg)
        body_bot = rot_pt(fx, fy, fx, fy + 9, tilt_deg)
        keel_bot = rot_pt(fx, fy, fx, fy + 22, tilt_deg)

        # Line in air to float keel eye (natural catenary above water or entry point)
        line_col = (95, 118, 138) if not night else (140, 168, 198)
        mid_x = (rod_x + keel_bot[0]) * 0.55
        mid_y = min(max(WATER_Y + 2, keel_bot[1] + 2), WATER_Y + 4) if keel_bot[1] > WATER_Y else (rod_y + keel_bot[1]) * 0.55 + 8
        draw.line([(rod_x, rod_y), (mid_x, mid_y), keel_bot], fill=line_col, width=1)

        # Underwater sinker + dropper + hook
        drop_lift = max(0.0, y_val) * 14.0
        sink_x = keel_bot[0] + x_val * 14.0
        sink_y = min(SCENE_H - 22, keel_bot[1] + 24 - drop_lift * 0.4)
        sub_shot_x = sink_x + x_val * 10.0
        sub_shot_y = min(SCENE_H - 16, sink_y + 15 - drop_lift * 0.6)
        hook_x = sub_shot_x + 12 + x_val * 8.0
        hook_y = min(SCENE_H - 11, sub_shot_y + 4)

        sub_line_col = (180, 220, 238) if not night else (110, 148, 182)
        draw.line([keel_bot, (sink_x, sink_y), (sub_shot_x, sub_shot_y), (hook_x, hook_y)], fill=sub_line_col, width=1)
        draw.ellipse([sink_x - 3, sink_y - 3, sink_x + 3, sink_y + 3], fill=(70, 78, 86))
        draw.ellipse([sub_shot_x - 2, sub_shot_y - 2, sub_shot_x + 2, sub_shot_y + 2], fill=(82, 90, 98))
        # Tiny bait on hook
        draw.ellipse([hook_x - 2, hook_y - 2, hook_x + 3, hook_y + 2], fill=(232, 132, 96))

        # Float keel & body
        draw.line([body_bot, keel_bot], fill=(38, 44, 54), width=2)
        # Body (polygon capsule around body_top..body_bot)
        b_pts = [
            rot_pt(fx, fy, fx - 4.5, fy - 2, tilt_deg),
            rot_pt(fx, fy, fx, fy - 9, tilt_deg),
            rot_pt(fx, fy, fx + 4.5, fy - 2, tilt_deg),
            rot_pt(fx, fy, fx + 3.5, fy + 6, tilt_deg),
            rot_pt(fx, fy, fx, fy + 10, tilt_deg),
            rot_pt(fx, fy, fx - 3.5, fy + 6, tilt_deg),
        ]
        draw.polygon(b_pts, fill=(248, 250, 252), outline=(45, 58, 74))
        # Red collar band on float body
        band_pts = [
            rot_pt(fx, fy, fx - 4.0, fy - 3, tilt_deg),
            rot_pt(fx, fy, fx + 4.0, fy - 3, tilt_deg),
            rot_pt(fx, fy, fx + 4.2, fy + 1, tilt_deg),
            rot_pt(fx, fy, fx - 4.2, fy + 1, tilt_deg),
        ]
        draw.polygon(band_pts, fill=(224, 52, 42))

        # Antenna (red + bright tip; glowing green tip at night)
        draw.line([body_top, ant_mid], fill=(228, 48, 38), width=3)
        tip_col = (120, 255, 110) if night else (255, 232, 66)
        draw.line([ant_mid, ant_tip], fill=tip_col, width=3)
        if in_hook:
            # Highlight ring around float / underwater spot during hook window
            ring_col = (249, 115, 22) if fi % 2 == 0 else (250, 204, 21)
            draw.ellipse([ant_tip[0] - 8, ant_tip[1] - 8, ant_tip[0] + 8, ant_tip[1] + 8], outline=ring_col, width=2)

        # Top-left phase badge
        badge_fill = (220, 58, 32) if in_hook else ((24, 48, 76) if not night else (30, 56, 92))
        badge_outline = (255, 212, 92) if in_hook else (88, 134, 176)
        badge_text = phase_label if len(phase_label) <= 24 else phase_label[:24]
        tw = draw.textlength(badge_text, font=FONT_BADGE)
        draw.rounded_rectangle([10, 10, 26 + tw, 32], radius=6, fill=badge_fill, outline=badge_outline, width=1)
        draw.text((18, 14), badge_text, fill=(255, 255, 255), font=FONT_BADGE)

        # Top-right timer pill
        t_str = f"t = {t:.1f} с"
        ttw = draw.textlength(t_str, font=FONT_SMALL)
        draw.rounded_rectangle([W - 22 - ttw, 10, W - 10, 30], radius=5, fill=(18, 36, 58), outline=(72, 114, 152), width=1)
        draw.text((W - 16 - ttw, 14), t_str, fill=(218, 238, 255), font=FONT_SMALL)

        # ---- Bottom graph: signature timeline ----
        # Hook window zone rectangle
        zone_fill = (254, 218, 192) if in_hook else (254, 236, 224)
        draw.rectangle([hx0, gy0, hx1, gy1], fill=zone_fill)
        draw.line([(hx0, gy0), (hx0, gy1)], fill=(249, 115, 22), width=1)
        draw.line([(hx1, gy0), (hx1, gy1)], fill=(249, 115, 22), width=1)

        # Axes
        draw.line([(gx0, gy0), (gx0, gy1), (gx1, gy1)], fill=(90, 108, 128), width=1)
        draw_dashed_line(draw, gx0, g_zero_y, gx1, g_zero_y, fill=(154, 172, 190), dash=4, gap=4)

        # Labels
        draw.text((6, gy0 - 2), "↑ подъём", fill=(86, 106, 128), font=FONT_TINY)
        draw.text((6, g_zero_y - 5), "  норма", fill=(116, 134, 152), font=FONT_TINY)
        draw.text((6, gy1 - 9), "↓ утоп", fill=(86, 106, 128), font=FONT_TINY)

        # Hook label inside zone (auto top or bottom so it doesn't collide with curve)
        hw_label = "ПОДСЕЧКА"
        hlw = draw.textlength(hw_label, font=FONT_TINY)
        hx_mid = (hx0 + hx1) // 2
        hook_ys = [cy for ct, cy, _, _ in curve if hook_s <= ct <= hook_e]
        avg_hy = sum(hook_ys) / max(1, len(hook_ys))
        label_y = (gy0 + 3) if avg_hy < 0.0 else (gy1 - 12)
        draw.text((max(gx0 + 2, hx_mid - hlw // 2), label_y), hw_label, fill=(212, 68, 18), font=FONT_TINY)

        # Time ticks on X axis
        step = 1.0 if dur <= 5.5 else 2.0
        tk = 0.0
        while tk <= dur + 1e-6:
            tx = gx0 + int((tk / dur) * (gx1 - gx0))
            draw.line([(tx, gy1), (tx, gy1 + 3)], fill=(90, 108, 128), width=1)
            lbl = f"{tk:.0f}с" if abs(tk - round(tk)) < 0.05 else f"{tk:.1f}с"
            lw = draw.textlength(lbl, font=FONT_TINY)
            draw.text((tx - lw / 2, gy1 + 5), lbl, fill=(92, 110, 128), font=FONT_TINY)
            tk += step

        # Full muted guideline curve
        guide_pts = []
        active_pts = []
        for ct, cy_val, _, _ in curve:
            px = gx0 + (ct / dur) * (gx1 - gx0)
            py = max(gy0 + 3, min(gy1 - 3, g_zero_y - cy_val * y_scale))
            guide_pts.append((px, py))
            if ct <= t + 1e-6:
                active_pts.append((px, py))

        if len(guide_pts) >= 2:
            draw.line(guide_pts, fill=(186, 208, 228), width=2)

        # Active progress curve + cursor dot
        cur_px = gx0 + (t / dur) * (gx1 - gx0)
        cur_py = max(gy0 + 3, min(gy1 - 3, g_zero_y - y_val * y_scale))
        active_pts.append((cur_px, cur_py))
        if len(active_pts) >= 2:
            draw.line(active_pts, fill=(14, 116, 186), width=3)

        dot_fill = (234, 64, 24) if in_hook else (245, 158, 11)
        draw.ellipse([cur_px - 5, cur_py - 5, cur_px + 5, cur_py + 5], fill=dot_fill, outline=(255, 255, 255), width=2)

        # Graph header text
        hdr = item["title"] if is_base else f"{item['name_ru']} · {item['bite_type']}"
        draw.text((gx0, GRAPH_TOP + 4), hdr, fill=(30, 52, 76), font=FONT_SMALL)

        # Quantize cleanly with no dither for razor-sharp UI & small GIF size
        q_frame = frame.quantize(colors=96, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        frames.append(q_frame)

    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=frame_ms,
        loop=0,
        optimize=True,
    )


def main():
    with open("data/fish_handbook_27.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    os.makedirs("bite_gifs", exist_ok=True)
    for b in data["base_bite_types"]:
        out = os.path.join("bite_gifs", f"{b['id']}.gif")
        render_bite_gif(b, out, is_base=True)
        print(f"Generated {out} ({os.path.getsize(out)/1024:.1f} KB)")

    for sp in data["species"]:
        out = os.path.join("bite_gifs", f"{sp['slug']}.gif")
        render_bite_gif(sp, out, is_base=False)
        print(f"Generated {out} ({os.path.getsize(out)/1024:.1f} KB)")

    total_kb = sum(os.path.getsize(os.path.join("bite_gifs", fn)) for fn in os.listdir("bite_gifs")) / 1024
    print(f"Total 32 GIFs size: {total_kb/1024:.2f} MB")


if __name__ == "__main__":
    main()
