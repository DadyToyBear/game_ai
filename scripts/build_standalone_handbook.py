import base64
import html
import io
import json
import os
import zipfile
from PIL import Image


def img_to_jpeg_data_uri(path: str, max_w: int, quality: int = 88) -> str:
    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.width > max_w:
            nh = int(round(im.height * (max_w / im.width)))
            im = im.resize((max_w, nh), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"


def sprite_to_webp_data_uri(path: str, max_w: int = 600, quality: int = 90) -> str:
    with Image.open(path) as im:
        im = im.convert("RGBA")
        if im.width > max_w:
            nh = int(round(im.height * (max_w / im.width)))
            im = im.resize((max_w, nh), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="WEBP", quality=quality, method=5)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/webp;base64,{b64}"


def file_to_data_uri(path: str, mime: str) -> str:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def find_ref_path(slug: str) -> str:
    for fn in sorted(os.listdir("references")):
        if fn.startswith(slug + "."):
            return os.path.join("references", fn)
    raise FileNotFoundError(f"Reference not found for {slug}")


def build_html(handbook: dict, weather_cal: dict, standalone: bool) -> str:
    species_data = []
    for sp in handbook["species"]:
        slug = sp["slug"]
        ref_path = find_ref_path(slug)
        if standalone:
            media = {
                "card_game": img_to_jpeg_data_uri(f"cards_game/{slug}.png", max_w=720, quality=88),
                "card_clean": img_to_jpeg_data_uri(f"cards_clean/{slug}.png", max_w=720, quality=88),
                "sprite": sprite_to_webp_data_uri(f"fish_art/{slug}.png", max_w=580, quality=90),
                "ref": img_to_jpeg_data_uri(ref_path, max_w=560, quality=82),
                "gif": file_to_data_uri(f"bite_gifs/{slug}.gif", "image/gif"),
            }
        else:
            media = {
                "card_game": f"cards_game/{slug}.png",
                "card_clean": f"cards_clean/{slug}.png",
                "sprite": f"fish_art/{slug}.png",
                "ref": ref_path.replace("\\", "/"),
                "gif": f"bite_gifs/{slug}.gif",
            }

        entry = dict(sp)
        entry.pop("anim", None)
        entry["media"] = media
        entry["meteo"] = weather_cal["species_meteo"][slug]
        species_data.append(entry)

    base_types = []
    for bt in handbook["base_bite_types"]:
        b = dict(bt)
        b.pop("anim", None)
        b["gif"] = (
            file_to_data_uri(f"bite_gifs/{b['id']}.gif", "image/gif")
            if standalone
            else f"bite_gifs/{b['id']}.gif"
        )
        base_types.append(b)

    payload_obj = {
        "species": species_data,
        "base_types": base_types,
        "forecast_meta": {
            "location": weather_cal["location"],
            "period": weather_cal["forecast_period"],
            "current_month_idx": weather_cal["current_month_idx"],
            "month_names": weather_cal["month_names"],
        },
        "forecast_week": weather_cal["forecast_week"],
        "meteo_guide": weather_cal["meteo_guide"],
    }
    payload_json = json.dumps(payload_obj, ensure_ascii=False).replace("</", "<\\/")

    mode_badge = (
        "Автономная версия (всё вшито в файл · работает без интернета)"
        if standalone
        else "Версия для папки архива (оригинальные PNG 900×1200 + GIF)"
    )

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>WorldOfVikingCraft — Справочник рыб, поклёвки, календарь и прогноз на неделю</title>
<style>
  :root {{
    --bg: #07111d;
    --bg2: #0d1c2f;
    --card: #102238;
    --card2: #142a44;
    --border: #214062;
    --border-hi: #346090;
    --text: #eaf3fc;
    --muted: #9ab3cc;
    --gold: #f5c542;
    --amber: #f59e0b;
    --aqua: #38bdf8;
    --mint: #34d399;
    --pred: #f43f5e;
    --orange: #fb923c;
  }}
  * {{ box-sizing: border-box; }}
  html {{ scroll-behavior: smooth; }}
  body {{
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: radial-gradient(circle at 18% 0%, #133152 0%, var(--bg) 55%);
    color: var(--text);
    line-height: 1.5;
  }}

  /* Top Hero Header */
  .hero {{
    background: linear-gradient(135deg, rgba(14,34,58,0.96), rgba(7,17,29,0.98));
    border-bottom: 1px solid var(--border);
    padding: 18px 24px 14px;
  }}
  .hero-inner {{
    max-width: 1440px;
    margin: 0 auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
  }}
  .hero h1 {{
    margin: 0;
    font-size: clamp(19px, 2.4vw, 27px);
    color: var(--gold);
    letter-spacing: 0.2px;
  }}
  .hero-sub {{
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 13.5px;
  }}
  .hero-badges {{
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }}
  .pill {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    background: #132942;
    border: 1px solid var(--border-hi);
    color: var(--text);
  }}
  .pill.gold {{ color: var(--gold); border-color: rgba(245,197,66,0.45); }}
  .pill.mint {{ color: var(--mint); border-color: rgba(52,211,153,0.4); }}
  .btn-print {{
    cursor: pointer;
    background: linear-gradient(135deg, #1d4ed8, #0284c7);
    color: #fff;
    border: none;
    padding: 7px 14px;
    border-radius: 9px;
    font-weight: 600;
    font-size: 12.5px;
  }}
  .btn-print:hover {{ filter: brightness(1.1); }}

  /* Sticky Toolbar */
  .toolbar-wrap {{
    position: sticky;
    top: 0;
    z-index: 40;
    background: rgba(8, 18, 30, 0.95);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
    padding: 11px 24px;
  }}
  .toolbar {{
    max-width: 1440px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }}
  .toolbar-row {{
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }}
  .search-input {{
    flex: 1 1 260px;
    min-width: 210px;
    background: var(--bg2);
    border: 1px solid var(--border-hi);
    color: var(--text);
    padding: 8px 13px;
    border-radius: 9px;
    font-size: 13.5px;
    outline: none;
  }}
  .search-input:focus {{ border-color: var(--aqua); box-shadow: 0 0 0 2px rgba(56,189,248,0.2); }}

  .btn-group {{
    display: inline-flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
  }}
  .fbtn {{
    cursor: pointer;
    background: var(--bg2);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 6px 11px;
    border-radius: 8px;
    font-size: 12.3px;
    font-weight: 600;
    transition: 0.15s;
  }}
  .fbtn:hover {{ color: var(--text); border-color: var(--border-hi); }}
  .fbtn.active {{
    background: #173a5e;
    color: #fff;
    border-color: var(--aqua);
  }}
  .fbtn.tab.active {{
    background: linear-gradient(135deg, rgba(245,197,66,0.24), rgba(56,189,248,0.22));
    color: var(--gold);
    border-color: var(--gold);
  }}

  /* Quick Species Jump Chips */
  .jump-strip {{
    max-width: 1440px;
    margin: 12px auto 0;
    padding: 0 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }}
  .jchip {{
    text-decoration: none;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 9px;
    border-radius: 7px;
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: 0.15s;
  }}
  .jchip:hover {{ border-color: var(--aqua); transform: translateY(-1px); }}
  .dot {{ width: 7px; height: 7px; border-radius: 50%; display: inline-block; }}
  .dot.peace {{ background: var(--aqua); }}
  .dot.pred {{ background: var(--pred); }}

  /* Main container */
  .container {{
    max-width: 1440px;
    margin: 0 auto;
    padding: 16px 24px 60px;
  }}
  .status-bar {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 14px;
    font-size: 13px;
    color: var(--muted);
  }}

  /* Base 5 Bite Types Accordion / Grid */
  .base-panel {{
    background: var(--card);
    border: 1px solid var(--border-hi);
    border-radius: 16px;
    padding: 16px 18px;
    margin-bottom: 20px;
  }}
  .base-head {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }}
  .base-head h2 {{
    margin: 0;
    font-size: 17px;
    color: var(--gold);
  }}
  .base-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
    margin-top: 14px;
  }}
  .base-card {{
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }}
  .base-card img {{
    width: 100%;
    height: auto;
    display: block;
    background: #e8f4fc;
  }}
  .base-card-body {{
    padding: 10px 12px;
    font-size: 12.5px;
  }}
  .base-card-title {{
    font-weight: 700;
    color: var(--aqua);
    margin-bottom: 4px;
  }}
  .base-card-ex {{
    margin-top: 6px;
    color: var(--gold);
    font-size: 11.5px;
  }}

  /* Full Species Encyclopedia Card */
  .fish-list {{
    display: flex;
    flex-direction: column;
    gap: 22px;
  }}
  .fish-entry {{
    background: linear-gradient(180deg, var(--card) 0%, #0b1929 100%);
    border: 1px solid var(--border);
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    scroll-margin-top: 132px;
  }}
  .fish-entry.predator {{ border-color: rgba(244, 63, 94, 0.42); }}
  .fish-entry.peace {{ border-color: rgba(56, 189, 248, 0.35); }}

  .fish-header {{
    padding: 14px 18px;
    background: rgba(16, 36, 58, 0.85);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }}
  .fish-title-group {{
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
  }}
  .fish-num {{
    font-weight: 800;
    font-size: 14px;
    color: var(--gold);
    background: rgba(245,197,66,0.14);
    border: 1px solid rgba(245,197,66,0.35);
    padding: 2px 9px;
    border-radius: 7px;
  }}
  .fish-name {{
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    color: #fff;
  }}
  .fish-latin {{
    font-style: italic;
    color: var(--muted);
    font-size: 14px;
  }}
  .fish-family {{
    color: #82a3c4;
    font-size: 13px;
  }}
  .fish-badges {{
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }}
  .tag {{
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 700;
    border: 1px solid transparent;
  }}
  .tag.peace {{ background: rgba(56,189,248,0.14); color: var(--aqua); border-color: rgba(56,189,248,0.38); }}
  .tag.pred {{ background: rgba(244,63,94,0.16); color: #fb7185; border-color: rgba(244,63,94,0.42); }}
  .tag.layer {{ background: rgba(52,211,153,0.12); color: var(--mint); border-color: rgba(52,211,153,0.35); }}
  .tag.diff-easy {{ background: rgba(34,197,94,0.14); color: #86efac; border-color: rgba(34,197,94,0.35); }}
  .tag.diff-med {{ background: rgba(245,158,11,0.15); color: #fcd34d; border-color: rgba(245,158,11,0.4); }}
  .tag.diff-hard {{ background: rgba(244,63,94,0.16); color: #fda4af; border-color: rgba(244,63,94,0.42); }}
  .tag.fbx {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: #0c1826; color: #b7d2eb; border-color: var(--border); }}

  /* 3-Column Body inside each species card */
  .fish-body {{
    display: grid;
    grid-template-columns: 310px minmax(320px, 430px) 1fr;
    gap: 18px;
    padding: 18px;
    align-items: start;
  }}
  @media (max-width: 1200px) {{
    .fish-body {{ grid-template-columns: 280px 1fr; }}
    .col-info {{ grid-column: 1 / -1; }}
  }}
  @media (max-width: 740px) {{
    .fish-body {{ grid-template-columns: 1fr; padding: 12px; }}
  }}

  /* Column 1: Illustrated Fish Card Switcher */
  .col-visual {{
    display: flex;
    flex-direction: column;
    gap: 8px;
  }}
  .vis-tabs {{
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }}
  .vtab {{
    cursor: pointer;
    background: var(--bg2);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 5px 4px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
  }}
  .vtab.active {{
    background: #183d63;
    color: #fff;
    border-color: var(--aqua);
  }}
  .vis-frame {{
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border-hi);
    background: radial-gradient(circle, #173654 0%, #0a1726 100%);
    cursor: zoom-in;
    aspect-ratio: 3 / 4;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .vis-frame.sprite-bg {{
    background: repeating-conic-gradient(#12263c 0% 25%, #0c1b2c 0% 50%) 50% / 20px 20px;
    aspect-ratio: auto;
    min-height: 240px;
    padding: 14px;
  }}
  .vis-frame.ref-bg {{
    aspect-ratio: auto;
    min-height: 220px;
    background: #08121e;
  }}
  .vis-frame img {{
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }}
  .vis-hint {{
    font-size: 11px;
    color: var(--muted);
    text-align: center;
  }}

  /* Column 2: Live Bite GIF + Bite Mechanics & TZ */
  .col-bite {{
    display: flex;
    flex-direction: column;
    gap: 10px;
  }}
  .gif-box {{
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border-hi);
    background: #e8f4fc;
  }}
  .gif-head {{
    background: #0d2238;
    padding: 7px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }}
  .gif-head strong {{ color: var(--gold); }}
  .gif-head span {{ color: var(--aqua); font-weight: 700; }}
  .gif-box img {{
    width: 100%;
    height: auto;
    display: block;
  }}

  .bite-box {{
    background: rgba(13, 28, 47, 0.9);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 13px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    font-size: 13px;
  }}
  .bite-box p {{ margin: 0; }}
  .bite-box .lbl {{
    color: var(--aqua);
    font-weight: 700;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    display: block;
    margin-bottom: 2px;
  }}
  .hook-callout {{
    background: rgba(245, 158, 11, 0.12);
    border-left: 3px solid var(--amber);
    padding: 8px 10px;
    border-radius: 0 8px 8px 0;
    font-size: 12.8px;
  }}
  .hook-callout strong {{ color: var(--gold); }}
  .tz-callout {{
    background: rgba(52, 211, 153, 0.1);
    border-left: 3px solid var(--mint);
    padding: 8px 10px;
    border-radius: 0 8px 8px 0;
    font-size: 12.3px;
    color: #d6faea;
  }}
  .tz-metrics {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 2px;
  }}
  .tz-metric {{
    background: #0a1726;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 9px;
    font-size: 12px;
  }}
  .tz-metric span {{ display: block; color: var(--muted); font-size: 10.5px; }}
  .tz-metric strong {{ color: #fff; font-size: 13px; }}

  /* Column 3: Full Biological & Angling Encyclopedia */
  .col-info {{
    display: flex;
    flex-direction: column;
    gap: 10px;
  }}
  .info-grid {{
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }}
  @media (max-width: 900px) {{
    .info-grid {{ grid-template-columns: 1fr; }}
  }}
  .info-block {{
    background: rgba(15, 32, 52, 0.72);
    border: 1px solid var(--border);
    border-radius: 11px;
    padding: 10px 12px;
    font-size: 13px;
  }}
  .info-block.wide {{ grid-column: 1 / -1; }}
  .info-block h4 {{
    margin: 0 0 5px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.45px;
    color: var(--gold);
  }}
  .info-block p {{ margin: 0 0 5px; color: #dceaf7; }}
  .info-block p:last-child {{ margin-bottom: 0; }}
  .sub-k {{ color: var(--aqua); font-weight: 700; }}

  /* 4 Tiers table */
  .tiers-grid {{
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
  }}
  @media (max-width: 600px) {{
    .tiers-grid {{ grid-template-columns: repeat(2, 1fr); }}
  }}
  .tier-cell {{
    background: #0b1827;
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 7px 9px;
    text-align: center;
  }}
  .tier-cell.trof {{
    border-color: rgba(245,197,66,0.55);
    background: linear-gradient(180deg, rgba(245,197,66,0.14), rgba(11,24,39,0.95));
  }}
  .tier-name {{ font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; }}
  .tier-cell.trof .tier-name {{ color: var(--gold); }}
  .tier-w {{ font-size: 12.8px; font-weight: 800; color: #fff; margin-top: 2px; }}
  .tier-l {{ font-size: 11.5px; color: var(--aqua); margin-top: 1px; }}

  /* Summary Cheat-Sheet Table View */
  .table-wrap {{
    overflow-x: auto;
    background: var(--card);
    border: 1px solid var(--border-hi);
    border-radius: 14px;
  }}
  table.cheat {{
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    min-width: 1040px;
  }}
  table.cheat th {{
    background: #0d2138;
    color: var(--gold);
    text-align: left;
    padding: 10px 10px;
    border-bottom: 1px solid var(--border-hi);
    position: sticky;
    top: 0;
  }}
  table.cheat td {{
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }}
  table.cheat tr:hover {{ background: rgba(56,189,248,0.08); cursor: pointer; }}
  .thumb-card {{ width: 52px; border-radius: 5px; border: 1px solid var(--border); display: block; }}
  .thumb-gif {{ width: 132px; border-radius: 6px; border: 1px solid var(--border-hi); display: block; }}

  /* ================= WEEKLY FORECAST VIEW ================= */
  .wx-hero-panel {{
    background: linear-gradient(135deg, #10263e 0%, #0b1a2c 100%);
    border: 1px solid var(--border-hi);
    border-radius: 16px;
    padding: 18px;
    margin-bottom: 18px;
  }}
  .wx-top-row {{
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }}
  .wx-top-row h2 {{ margin: 0; color: var(--gold); font-size: 20px; }}
  .wx-days-grid {{
    display: grid;
    grid-template-columns: repeat(7, minmax(135px, 1fr));
    gap: 10px;
    overflow-x: auto;
  }}
  .wx-day-card {{
    cursor: pointer;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 11px 11px;
    transition: 0.15s;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }}
  .wx-day-card:hover {{ border-color: var(--aqua); transform: translateY(-2px); }}
  .wx-day-card.active {{
    background: linear-gradient(180deg, #163759 0%, #0e243b 100%);
    border-color: var(--gold);
    box-shadow: 0 0 0 2px rgba(245,197,66,0.22);
  }}
  .wx-day-title {{ font-weight: 800; font-size: 13.5px; color: #fff; display: flex; justify-content: space-between; align-items: center; }}
  .wx-temps {{ font-size: 16px; font-weight: 800; color: var(--aqua); }}
  .wx-temps span {{ font-size: 12px; font-weight: 500; color: var(--muted); }}
  .wx-line {{ font-size: 11.5px; color: #cfe2f5; }}
  .wx-score-pill {{
    margin-top: auto;
    padding: 4px 8px;
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 800;
    text-align: center;
  }}
  .sc-high {{ background: rgba(52,211,153,0.18); color: #6ee7b7; border: 1px solid rgba(52,211,153,0.45); }}
  .sc-med {{ background: rgba(56,189,248,0.16); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.4); }}
  .sc-low {{ background: rgba(245,158,11,0.16); color: #fcd34d; border: 1px solid rgba(245,158,11,0.4); }}
  .sc-bad {{ background: rgba(244,63,94,0.16); color: #fda4af; border: 1px solid rgba(244,63,94,0.4); }}

  /* Selected day detail + Barometric SVG Chart + Live Simulator */
  .wx-detail-grid {{
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 16px;
    margin-bottom: 18px;
  }}
  @media (max-width: 980px) {{
    .wx-detail-grid {{ grid-template-columns: 1fr; }}
  }}
  .wx-box {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 15px 17px;
  }}
  .wx-box h3 {{ margin: 0 0 10px; color: var(--gold); font-size: 16px; }}
  .wx-metrics-4 {{
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }}
  @media (max-width: 640px) {{ .wx-metrics-4 {{ grid-template-columns: repeat(2, 1fr); }} }}
  .wx-m {{
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 8px 10px;
  }}
  .wx-m span {{ display: block; font-size: 11px; color: var(--muted); }}
  .wx-m strong {{ font-size: 14px; color: #fff; }}
  .sim-controls {{
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }}
  @media (max-width: 560px) {{ .sim-controls {{ grid-template-columns: 1fr; }} }}
  .sim-ctrl {{
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 8px 10px;
    font-size: 12px;
  }}
  .sim-ctrl label {{ display: flex; justify-content: space-between; font-weight: 700; color: var(--aqua); margin-bottom: 4px; }}
  .sim-ctrl input[type="range"], .sim-ctrl select {{ width: 100%; accent-color: var(--gold); }}
  .sim-ctrl select {{
    background: #0a1726; color: #fff; border: 1px solid var(--border-hi); border-radius: 6px; padding: 4px 6px;
  }}

  /* Forecast 27 Species Visual Cards */
  .wx-fish-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 14px;
  }}
  .wx-fish-card {{
    background: linear-gradient(180deg, var(--card) 0%, #0b1827 100%);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 13px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }}
  .wx-fish-card.top {{ border-color: rgba(52,211,153,0.55); box-shadow: 0 6px 20px rgba(52,211,153,0.12); }}
  .wx-fish-card.dormant {{ opacity: 0.78; }}
  .wx-fc-top {{
    display: flex;
    gap: 12px;
    align-items: center;
  }}
  .wx-fc-img {{
    width: 118px;
    height: 76px;
    border-radius: 10px;
    background: radial-gradient(circle, #183d61 0%, #0a1828 100%);
    border: 1px solid var(--border-hi);
    padding: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
  }}
  .wx-fc-img img {{ max-width: 100%; max-height: 100%; object-fit: contain; }}
  .wx-fc-meta {{ flex: 1; min-width: 0; }}
  .wx-fc-name {{ font-size: 16px; font-weight: 800; color: #fff; display: flex; justify-content: space-between; align-items: center; gap: 6px; }}
  .wx-fc-bar-bg {{
    height: 7px; border-radius: 999px; background: #091422; border: 1px solid var(--border); overflow: hidden; margin: 5px 0;
  }}
  .wx-fc-bar {{ height: 100%; border-radius: 999px; }}
  .wx-fc-why {{ font-size: 12.2px; color: #d5e6f7; margin: 0; }}
  .wx-fc-foot {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
    color: var(--muted);
  }}

  /* ================= CALENDAR & METEO GUIDE VIEW ================= */
  .cal-matrix-wrap {{
    overflow-x: auto;
    background: var(--card);
    border: 1px solid var(--border-hi);
    border-radius: 14px;
    margin-bottom: 22px;
  }}
  table.cal {{
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    min-width: 980px;
  }}
  table.cal th {{
    background: #0d2138;
    color: var(--gold);
    padding: 10px 6px;
    text-align: center;
    border-bottom: 1px solid var(--border-hi);
  }}
  table.cal th.now-m {{
    background: linear-gradient(180deg, #1b446e, #123152);
    color: #fff;
    border-bottom: 2px solid var(--gold);
  }}
  table.cal td {{
    padding: 6px 6px;
    border-bottom: 1px solid var(--border);
    text-align: center;
    vertical-align: middle;
  }}
  table.cal td.sp-col {{
    text-align: left;
    padding-left: 10px;
    min-width: 230px;
  }}
  .cal-sp-flex {{
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
  }}
  .cal-sp-flex img {{
    width: 56px;
    height: 34px;
    object-fit: contain;
    background: #0a1828;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
  }}
  .mcell {{
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 26px;
    border-radius: 6px;
    font-weight: 800;
    font-size: 12px;
  }}
  .m0 {{ background: rgba(148,163,184,0.1); color: #64748b; }}
  .m1 {{ background: rgba(244,63,94,0.15); color: #fda4af; }}
  .m2 {{ background: rgba(245,158,11,0.18); color: #fcd34d; }}
  .m3 {{ background: rgba(56,189,248,0.20); color: #7dd3fc; }}
  .m4 {{ background: rgba(34,197,94,0.22); color: #86efac; }}
  .m5 {{ background: rgba(16,185,129,0.34); color: #ecfdf5; border: 1px solid rgba(52,211,153,0.65); }}
  td.now-m {{ background: rgba(245,197,66,0.08); }}

  .guide-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 14px;
  }}
  .guide-card {{
    background: var(--card);
    border: 1px solid var(--border-hi);
    border-radius: 14px;
    padding: 15px 17px;
  }}
  .guide-card h3 {{ margin: 0 0 6px; color: var(--gold); font-size: 16px; }}
  .guide-badge {{
    display: inline-block;
    background: rgba(56,189,248,0.14);
    border: 1px solid rgba(56,189,248,0.35);
    color: var(--aqua);
    font-size: 11.5px;
    font-weight: 700;
    padding: 3px 9px;
    border-radius: 999px;
    margin-bottom: 9px;
  }}
  .guide-card ul {{ margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: #dbeafa; }}
  .guide-card li {{ margin-bottom: 5px; }}

  /* Lightbox */
  .modal {{
    display: none;
    position: fixed;
    inset: 0;
    z-index: 999;
    background: rgba(4, 10, 18, 0.92);
    align-items: center;
    justify-content: center;
    padding: 20px;
  }}
  .modal.open {{ display: flex; }}
  .modal-inner {{
    max-width: 92vw;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }}
  .modal-inner img {{
    max-width: 90vw;
    max-height: 82vh;
    border-radius: 12px;
    border: 1px solid var(--border-hi);
    background: #08121e;
  }}
  .modal-cap {{
    color: var(--gold);
    font-weight: 700;
    font-size: 15px;
    text-align: center;
  }}
  .modal-close {{
    position: fixed;
    top: 16px;
    right: 22px;
    background: #173452;
    color: #fff;
    border: 1px solid var(--border-hi);
    border-radius: 999px;
    width: 38px;
    height: 38px;
    font-size: 22px;
    cursor: pointer;
  }}

  .hidden {{ display: none !important; }}

  @media print {{
    body {{ background: #fff; color: #111; }}
    .toolbar-wrap, .jump-strip, .vis-tabs, .vis-hint, .btn-print {{ display: none !important; }}
    .fish-entry {{ break-inside: avoid; border: 1px solid #bbb; background: #fff; color: #111; box-shadow: none; }}
    .fish-header {{ background: #f1f5f9; }}
    .fish-name, .tier-w {{ color: #111; }}
    .info-block, .bite-box, .tier-cell, .wx-box, .wx-fish-card, .guide-card {{ background: #f8fafc; color: #111; border-color: #cbd5e1; }}
    .info-block p, .tz-callout, .wx-fc-why {{ color: #111; }}
  }}
</style>
</head>
<body>

<header class="hero">
  <div class="hero-inner">
    <div>
      <h1>WorldOfVikingCraft — Единый атлас рыб, поклёвки, календарь и прогноз</h1>
      <p class="hero-sub">27 видов · Иллюстрированные карточки · 32 живые GIF поплавка · Реальный метеопрогноз на неделю (Вильнюс, 15–21 ноя 2026) · Годовой календарь</p>
    </div>
    <div class="hero-badges">
      <span class="pill gold">27 видов рыб</span>
      <span class="pill mint">{html.escape(mode_badge)}</span>
      <button class="btn-print" onclick="window.print()">Печать / PDF</button>
    </div>
  </div>
</header>

<div class="toolbar-wrap">
  <div class="toolbar">
    <div class="toolbar-row">
      <input id="searchBox" class="search-input" type="search" placeholder="Поиск: вид, латынь, модель .fbx, наживка, глубина, место..." />
      <div class="btn-group" id="viewModeGroup">
        <button class="fbtn tab active" data-view="full">Справочник (Карточки + GIF)</button>
        <button class="fbtn tab" data-view="forecast">Прогноз на неделю (15–21 ноя)</button>
        <button class="fbtn tab" data-view="calendar">Календарь (12 мес.) и погода</button>
        <button class="fbtn tab" data-view="table">Шпаргалка (Таблица)</button>
        <button class="fbtn tab" data-view="base">5 типов поклёвок</button>
      </div>
    </div>
    <div class="toolbar-row">
      <div class="btn-group" id="catFilter">
        <button class="fbtn active" data-cat="all">Все (27)</button>
        <button class="fbtn" data-cat="peace">Мирная / белая (18)</button>
        <button class="fbtn" data-cat="pred">Хищная (9)</button>
      </div>
      <div class="btn-group" id="layerFilter">
        <button class="fbtn active" data-layer="all">Все глубины</button>
        <button class="fbtn" data-layer="surface">Поверхность / верх</button>
        <button class="fbtn" data-layer="mid">Толща воды</button>
        <button class="fbtn" data-layer="bottom">Придонный / дно</button>
      </div>
      <div class="btn-group" id="diffFilter">
        <button class="fbtn active" data-diff="all">Любая сложность</button>
        <button class="fbtn" data-diff="лёгкая">Лёгкая</button>
        <button class="fbtn" data-diff="средняя">Средняя</button>
        <button class="fbtn" data-diff="сложная">Сложная</button>
      </div>
    </div>
  </div>
</div>

<nav id="jumpStrip" class="jump-strip"></nav>

<main class="container">
  <div class="status-bar">
    <div id="countText">Показано видов: 27 из 27</div>
    <div>Клик по картинке или GIF открывает просмотр в полном размере</div>
  </div>

  <!-- Base 5 Bite Types Reference Panel -->
  <section id="baseSection" class="base-panel">
    <div class="base-head" onclick="toggleBaseGrid()">
      <h2>Пять базовых типов поклёвок на поплавок (схемы поведения и живые GIF)</h2>
      <span id="baseToggleHint" class="fbtn">Развернуть (5 GIF)</span>
    </div>
    <div id="baseGrid" class="base-grid hidden"></div>
  </section>

  <!-- Main Full Cards View -->
  <section id="fullView" class="fish-list"></section>

  <!-- Summary Cheat-Sheet Table View -->
  <section id="tableView" class="table-wrap hidden">
    <table class="cheat">
      <thead>
        <tr>
          <th>№</th>
          <th>Карточка</th>
          <th>Вид и модель .fbx</th>
          <th>Категория</th>
          <th>Глубина (держится / клюёт)</th>
          <th>На что клюёт</th>
          <th>Живая анимация поклёвки</th>
          <th>Окно / сложность</th>
        </tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>
  </section>

  <!-- Weekly Real Weather Fishing Forecast View -->
  <section id="forecastView" class="hidden"></section>

  <!-- 12-Month Calendar & Weather Influence View -->
  <section id="calendarView" class="hidden"></section>
</main>

<div id="modal" class="modal" onclick="closeModal()">
  <button class="modal-close" aria-label="Закрыть">&times;</button>
  <div class="modal-inner" onclick="event.stopPropagation()">
    <img id="modalImg" src="" alt="" />
    <div id="modalCap" class="modal-cap"></div>
  </div>
</div>

<script>
const HANDBOOK = {payload_json};
const SPECIES = HANDBOOK.species;
const BASE_TYPES = HANDBOOK.base_types;
const WEEK = HANDBOOK.forecast_week;
const META = HANDBOOK.forecast_meta;
const METEO_GUIDE = HANDBOOK.meteo_guide;

let state = {{
  view: 'full',
  cat: 'all',
  layer: 'all',
  diff: 'all',
  q: '',
  baseExpanded: false,
  selectedDayIdx: 0,
  simCustom: false,
  simWx: null,
  liveFetchMsg: ''
}};

function esc(s) {{
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}}

function diffClass(d) {{
  if (d.includes('лёгк')) return 'diff-easy';
  if (d.includes('слож')) return 'diff-hard';
  return 'diff-med';
}}

function clamp(v, lo, hi) {{ return Math.max(lo, Math.min(hi, v)); }}

// Honest, ichthyology-based forecast scoring engine (0..10)
function evaluateSpeciesForWeather(sp, wx, monthIdx) {{
  const m = sp.meteo;
  const tw = wx.water_temp_c;
  const p = wx.pressure_mm;
  const dp = wx.pressure_delta;
  const ws = wx.wind_speed;
  const sector = wx.wind_sector; // 'warm', 'cold', 'calm'
  const clouds = wx.clouds_pct;
  const rain = wx.rain_mm;
  const kp = wx.kp_index || 2;
  const moonScore = wx.moon_score || 0.72;

  const calScore = m.months[monthIdx]; // 0..5

  // 1. Water temperature suitability (cold-blooded metabolism constraint!)
  let tempFactor = 1.0;
  const [wLo, wHi] = m.water_range;
  const [oLo, oHi] = m.water_opt;
  if (tw < wLo) {{
    const diff = wLo - tw;
    tempFactor = Math.max(0.03, 0.28 - diff * 0.08);
  }} else if (tw > wHi) {{
    const diff = tw - wHi;
    tempFactor = Math.max(0.10, 0.45 - diff * 0.10);
  }} else if (tw >= oLo && tw <= oHi) {{
    tempFactor = 1.0;
  }} else if (tw < oLo) {{
    tempFactor = 0.45 + 0.55 * ((tw - wLo) / Math.max(0.5, (oLo - wLo)));
  }} else {{
    tempFactor = 0.55 + 0.45 * ((wHi - tw) / Math.max(0.5, (wHi - oHi)));
  }}

  // Combine calendar seasonality & water temp
  const seasonBase = calScore === 0
    ? Math.min(1.5, tempFactor * 2.5)
    : (1.2 + calScore * 1.45) * (0.35 + 0.65 * tempFactor);

  // 2. Atmospheric pressure & 24h deltaP
  let pressMult = 1.0;
  const absDp = Math.abs(dp);
  if (m.press_pref === 'high_stable') {{
    if (absDp <= 2.5) pressMult *= 1.10;
    else if (absDp <= m.delta_tol) pressMult *= 0.98;
    else pressMult *= Math.max(0.46, 1.0 - (absDp - m.delta_tol) * 0.11);
    if (dp <= -5) pressMult *= 0.85;
    if (p >= m.press_opt[0] && p <= m.press_opt[1]) pressMult *= 1.06;
    else if (p < 743) pressMult *= 0.86;
  }} else if (m.press_pref === 'low_drop') {{
    if (dp <= -1 && dp >= -6.5) pressMult *= 1.08;
    else if (absDp > m.delta_tol) pressMult *= 0.84;
    if (p >= m.press_opt[0] && p <= m.press_opt[1]) pressMult *= 1.04;
  }} else {{ // stable_any
    if (absDp <= m.delta_tol) pressMult *= 1.04;
    else pressMult *= 0.88;
  }}

  // 3. Wind speed & direction
  let windMult = 1.0;
  if (ws >= 8.5) {{
    windMult *= 0.72;
  }} else if (ws >= 2.0 && ws <= 6.0) {{
    if (m.wind_pref === 'breeze' || m.wind_pref === 'warm_breeze') windMult *= 1.07;
    if (m.wind_pref === 'calm' && ws > 4.5) windMult *= 0.88;
  }} else if (ws < 1.5) {{
    if (m.wind_pref === 'calm' || m.wind_pref === 'calm_mod') windMult *= 1.06;
    if (m.wind_pref === 'breeze') windMult *= 0.90;
  }}
  if (sector === 'warm') windMult *= 1.04;
  if (sector === 'cold') windMult *= (sp.slug === '20_nalim' ? 1.02 : 0.84);

  // 4. Clouds, rain, moon, geomagnetic Kp
  let skyMult = 1.0;
  if (m.cloud_pref === 'overcast') {{
    if (clouds >= 70) skyMult *= 1.06;
    if (rain > 0 && rain <= 4.5) skyMult *= 1.04;
    if (clouds < 30) skyMult *= 0.92;
  }} else if (m.cloud_pref === 'bright') {{
    if (clouds <= 50 && rain < 0.5) skyMult *= 1.07;
    if (rain >= 3.0) skyMult *= 0.84;
  }} else {{
    if (rain >= 4.0) skyMult *= 0.88;
  }}
  if (kp >= 4 && m.delta_tol <= 4.5) skyMult *= 0.94;
  skyMult *= (0.94 + moonScore * 0.12);

  let raw = seasonBase * pressMult * windMult * skyMult;
  if (tw < wLo) raw = Math.min(raw, 1.4);
  if (calScore === 0 && tw < 7.0) raw = Math.min(raw, 1.3);
  const score = Math.round(clamp(raw, 0.0, 9.8) * 10) / 10;

  let tierLabel, tierCls;
  if (score >= 7.6) {{ tierLabel = 'Жор / Отлично'; tierCls = 'sc-high'; }}
  else if (score >= 5.6) {{ tierLabel = 'Хороший клёв'; tierCls = 'sc-med'; }}
  else if (score >= 3.4) {{ tierLabel = 'Умеренный'; tierCls = 'sc-low'; }}
  else if (score >= 1.6) {{ tierLabel = 'Слабый / ямы'; tierCls = 'sc-low'; }}
  else {{ tierLabel = 'Зимует / пассив'; tierCls = 'sc-bad'; }}

  // Dynamic explanation tailored to current day weather
  const reasons = [];
  if (tw < wLo) {{
    reasons.push(`Вода +${{tw.toFixed(1)}} °C ниже порога активности (+${{wLo}} °C) — рыба стоит в зимовальной яме и почти не питается.`);
  }} else {{
    if (tw >= oLo && tw <= oHi) reasons.push(`Температура воды (+${{tw.toFixed(1)}} °C) оптимальна для вида.`);
    else if (tw < oLo) reasons.push(`Холодная вода (+${{tw.toFixed(1)}} °C) смещает стоянку в более глубокие ямы и бровки.`);
    if (dp <= -6) {{
      if (m.press_pref === 'low_drop' || m.press_pref === 'stable_any') reasons.push(`Падение давления (${{dp}} мм) этот вид переносит уверенно.`);
      else reasons.push(`Сильный спад давления (${{dp}} мм) прижимает рыбу ко дну и снижает аппетит.`);
    }} else if (dp >= 5) {{
      reasons.push(m.press_pref === 'high_stable' ? `Рост давления (+${{dp}} мм) выводит рыбу из оцепенения, но поклёвки осторожные.` : `Резкий рост (+${{dp}} мм) слегка тормозит утренний выход.`);
    }} else {{
      reasons.push(`Спокойный барический фон (${{p}} мм, ${{dp >= 0 ? '+' : ''}}${{dp}} мм) держит стабильный клёв.`);
    }}
    if (sector === 'warm') reasons.push(`${{wx.wind_dir}} ветер (${{ws}} м/с) нагоняет тёплую воду и кислород.`);
    else if (sector === 'cold') reasons.push(`Холодный ветер (${{wx.wind_dir}}, ${{ws}} м/с) снижает активность на мелководье.`);
    if (rain >= 2.0 && m.cloud_pref === 'overcast') reasons.push(`Пасмурность и дождь маскируют снасть.`);
  }}

  return {{ score, tierLabel, tierCls, why: reasons.join(' ') }};
}}

function renderJumpStrip() {{
  const el = document.getElementById('jumpStrip');
  el.innerHTML = SPECIES.map(sp => `
    <a class="jchip" href="#fish-${{sp.slug}}" onclick="ensureFullView('${{sp.slug}}')">
      <span class="dot ${{sp.is_predator ? 'pred' : 'peace'}}"></span>
      <span>${{String(sp.num).padStart(2,'0')}} ${{esc(sp.name_ru)}}</span>
    </a>
  `).join('');
}}

function ensureFullView(slug) {{
  state.view = 'full';
  document.querySelectorAll('#viewModeGroup .fbtn').forEach(b => b.classList.toggle('active', b.dataset.view === 'full'));
  renderAll();
  setTimeout(() => {{
    const el = document.getElementById('fish-' + slug);
    if (el) el.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
  }}, 40);
}}

function renderBaseTypes() {{
  const grid = document.getElementById('baseGrid');
  grid.innerHTML = BASE_TYPES.map(bt => `
    <div class="base-card">
      <img src="${{bt.gif}}" alt="${{esc(bt.title)}}" loading="lazy" onclick="openModal(this.src, '${{esc(bt.num + '. ' + bt.title)}}')" style="cursor:zoom-in" />
      <div class="base-card-body">
        <div class="base-card-title">${{bt.num}}. ${{esc(bt.title)}}</div>
        <div>${{esc(bt.subtitle)}}</div>
        <div class="base-card-ex"><b>Примеры:</b> ${{esc(bt.examples)}}</div>
      </div>
    </div>
  `).join('');
}}

function toggleBaseGrid() {{
  state.baseExpanded = !state.baseExpanded;
  updateBaseVisibility();
}}

function updateBaseVisibility() {{
  const sec = document.getElementById('baseSection');
  const grid = document.getElementById('baseGrid');
  const hint = document.getElementById('baseToggleHint');
  if (state.view === 'base') {{
    sec.classList.remove('hidden');
    grid.classList.remove('hidden');
    hint.textContent = 'Показаны все 5 типов';
  }} else if (state.view === 'full') {{
    sec.classList.remove('hidden');
    grid.classList.toggle('hidden', !state.baseExpanded);
    hint.textContent = state.baseExpanded ? 'Свернуть' : 'Развернуть (5 GIF)';
  }} else {{
    sec.classList.add('hidden');
  }}
}}

function getFiltered() {{
  const q = state.q.trim().toLowerCase();
  return SPECIES.filter(sp => {{
    if (state.cat === 'peace' && sp.is_predator) return false;
    if (state.cat === 'pred' && !sp.is_predator) return false;
    if (state.layer !== 'all' && sp.layer_tag !== state.layer) return false;
    if (state.diff !== 'all' && !sp.difficulty.toLowerCase().includes(state.diff)) return false;
    if (q) {{
      const hay = [
        sp.name_ru, sp.latin, sp.family_ru, sp.category, sp.subcategory,
        sp.where_lives, sp.places_and_habits, sp.depth_holds, sp.depth_bites,
        sp.baits_best, sp.baits_extra, sp.description, sp.bite_type, sp.bite_character,
        (sp.fbx_models || []).join(' ')
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }}
    return true;
  }});
}}

function switchFishMedia(slug, key, btn) {{
  const sp = SPECIES.find(x => x.slug === slug);
  if (!sp) return;
  const card = document.getElementById('fish-' + slug);
  const frame = card.querySelector('.vis-frame');
  const img = frame.querySelector('img');
  img.src = sp.media[key];
  frame.classList.toggle('sprite-bg', key === 'sprite');
  frame.classList.toggle('ref-bg', key === 'ref');
  card.querySelectorAll('.vtab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}}

function openModal(src, caption) {{
  document.getElementById('modalImg').src = src;
  document.getElementById('modalCap').textContent = caption;
  document.getElementById('modal').classList.add('open');
}}
function closeModal() {{
  document.getElementById('modal').classList.remove('open');
}}
document.addEventListener('keydown', e => {{ if (e.key === 'Escape') closeModal(); }});

function buildWeekSvg(days, activeIdx) {{
  const w = 520, h = 148, padL = 38, padR = 20, padT = 20, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const pMin = 732, pMax = 768;
  const ptsP = days.map((d, i) => {{
    const x = padL + (i / Math.max(1, days.length - 1)) * innerW;
    const y = padT + (1 - clamp((d.pressure_mm - pMin) / (pMax - pMin), 0, 1)) * innerH;
    return [x, y, d];
  }});
  const polyP = ptsP.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const y760 = padT + (1 - (760 - pMin) / (pMax - pMin)) * innerH;
  return `
    <svg viewBox="0 0 ${{w}} ${{h}}" style="width:100%;height:auto;display:block;background:#0a1726;border-radius:10px;border:1px solid var(--border)">
      <line x1="${{padL}}" y1="${{y760.toFixed(1)}}" x2="${{w - padR}}" y2="${{y760.toFixed(1)}}" stroke="#334e6e" stroke-dasharray="4 4" stroke-width="1"/>
      <text x="6" y="${{(y760 + 3).toFixed(1)}}" fill="#7ea1c4" font-size="9.5">760</text>
      <text x="6" y="${{padT + 6}}" fill="#7ea1c4" font-size="9.5">768</text>
      <text x="6" y="${{h - padB}}" fill="#7ea1c4" font-size="9.5">732 мм</text>
      <polyline fill="none" stroke="#38bdf8" stroke-width="2.6" points="${{polyP}}"/>
      ${{ptsP.map((p, i) => `
        <g style="cursor:pointer" onclick="selectForecastDay(${{i}})">
          <circle cx="${{p[0].toFixed(1)}}" cy="${{p[1].toFixed(1)}}" r="${{i === activeIdx ? 6.5 : 4.2}}" fill="${{i === activeIdx ? '#f5c542' : '#38bdf8'}}" stroke="#07111d" stroke-width="2"/>
          <text x="${{p[0].toFixed(1)}}" y="${{(p[1] - 9).toFixed(1)}}" text-anchor="middle" fill="${{i === activeIdx ? '#f5c542' : '#cbe2f8'}}" font-size="9.5" font-weight="700">${{p[2].pressure_mm}}</text>
          <text x="${{p[0].toFixed(1)}}" y="${{h - 8}}" text-anchor="middle" fill="${{i === activeIdx ? '#f5c542' : '#9ab3cc'}}" font-size="10">${{p[2].day_label.split(' · ')[0]}}</text>
        </g>
      `).join('')}}
    </svg>
  `;
}}

function selectForecastDay(idx) {{
  state.selectedDayIdx = idx;
  state.simCustom = false;
  state.simWx = null;
  renderForecast();
}}

function initSimFromDay() {{
  const d = WEEK[state.selectedDayIdx];
  state.simWx = {{
    water_temp_c: d.water_temp_c,
    pressure_mm: d.pressure_mm,
    pressure_delta: d.pressure_delta,
    wind_speed: d.wind_speed,
    wind_sector: d.wind_sector,
    clouds_pct: d.clouds_pct,
    rain_mm: d.rain_mm,
    kp_index: d.kp_index,
    moon_score: d.moon_score,
    wind_dir: d.wind_dir,
    monthIdx: META.current_month_idx
  }};
}}

function updateSimField(key, val) {{
  if (!state.simWx) initSimFromDay();
  state.simCustom = true;
  if (key === 'wind_sector' || key === 'wind_dir') {{
    state.simWx.wind_sector = val;
    state.simWx.wind_dir = val === 'warm' ? 'ЮЗ / Ю' : (val === 'cold' ? 'С / СВ' : 'Штиль');
  }} else {{
    state.simWx[key] = parseFloat(val);
  }}
  renderForecast();
}}

async function fetchLiveOpenMeteo() {{
  state.liveFetchMsg = 'Загрузка актуальной погоды из Open-Meteo (Вильнюс)...';
  renderForecast();
  try {{
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=54.6872&longitude=25.2797&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,winddirection_10m_dominant,surface_pressure_mean,cloudcover_mean&timezone=auto&forecast_days=7';
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const d = data.daily;
    if (!d || !d.time || !d.time.length) throw new Error('Пустой ответ');
    const daysRus = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    const monsRus = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    let prevP = null;
    const newWeek = d.time.map((dtStr, i) => {{
      const dt = new Date(dtStr + 'T12:00:00');
      const pHpa = Math.round(d.surface_pressure_mean[i]);
      const pMm = Math.round(pHpa * 0.750062);
      const dp = prevP === null ? 0 : (pMm - prevP);
      prevP = pMm;
      const tMax = Math.round(d.temperature_2m_max[i]);
      const tMin = Math.round(d.temperature_2m_min[i]);
      const tWater = Math.max(0.5, Math.round(((tMax + tMin) * 0.5) * 10) / 10);
      const wKmh = d.windspeed_10m_max[i];
      const wMs = Math.round((wKmh / 3.6) * 10) / 10;
      const deg = d.winddirection_10m_dominant[i];
      const warm = (deg >= 135 && deg <= 300);
      const dirs = ['С','СВ','В','ЮВ','Ю','ЮЗ','З','СЗ'];
      const dirTxt = dirs[Math.round(deg / 45) % 8];
      return {{
        date: dtStr,
        day_label: `${{dt.getDate()}} ${{monsRus[dt.getMonth()]}} · ${{daysRus[dt.getDay()]}}`,
        temp_day_c: tMax,
        temp_night_c: tMin,
        water_temp_c: tWater,
        pressure_mm: pMm,
        pressure_hpa: pHpa,
        pressure_delta: dp,
        pressure_trend: (dp > 1 ? `рост (+${{dp}} мм)` : (dp < -1 ? `падение (${{dp}} мм)` : 'стабильное')),
        wind_speed: wMs,
        wind_dir: dirTxt,
        wind_sector: wMs < 1.5 ? 'calm' : (warm ? 'warm' : 'cold'),
        precip: d.precipitation_sum[i] > 1 ? `Осадки ${{d.precipitation_sum[i].toFixed(1)}} мм` : 'Без существенных осадков',
        clouds_pct: Math.round(d.cloudcover_mean[i]),
        rain_mm: d.precipitation_sum[i],
        humidity: 80,
        daylight: 'По координатам Вильнюса',
        moon_phase: 'Авто-обновление Open-Meteo',
        moon_score: 0.75,
        kp_index: 2,
        summary: `Обновлённый онлайн-прогноз Open-Meteo на ${{dtStr}}: воздух ${{tMax}}/${{tMin}} °C, вода ~${{tWater}} °C, давление ${{pMm}} мм рт. ст., ветер ${{dirTxt}} ${{wMs}} м/с.`
      }};
    }});
    WEEK.splice(0, WEEK.length, ...newWeek);
    META.current_month_idx = new Date().getMonth();
    state.selectedDayIdx = 0;
    state.simCustom = false;
    state.simWx = null;
    state.liveFetchMsg = 'Обновлено из Open-Meteo (свежие 7 дней)!';
    renderForecast();
  }} catch (err) {{
    state.liveFetchMsg = 'Нет интернета или доступ ограничен — показан встроенный реальный прогноз на 15–21 ноя 2026.';
    renderForecast();
  }}
}}

function renderForecast() {{
  const el = document.getElementById('forecastView');
  const filteredList = getFiltered();
  const baseDay = WEEK[state.selectedDayIdx];
  const activeWx = state.simCustom && state.simWx ? state.simWx : {{
    water_temp_c: baseDay.water_temp_c,
    pressure_mm: baseDay.pressure_mm,
    pressure_delta: baseDay.pressure_delta,
    wind_speed: baseDay.wind_speed,
    wind_sector: baseDay.wind_sector,
    clouds_pct: baseDay.clouds_pct,
    rain_mm: baseDay.rain_mm,
    kp_index: baseDay.kp_index,
    moon_score: baseDay.moon_score,
    wind_dir: baseDay.wind_dir,
    monthIdx: META.current_month_idx
  }};
  const mIdx = activeWx.monthIdx !== undefined ? activeWx.monthIdx : META.current_month_idx;

  // Evaluate each day's overall indices for the 7-day cards
  const dayCardsHtml = WEEK.map((d, i) => {{
    const activeSpecies = SPECIES.filter(s => ['20_nalim','17_shchuka','18_sudak','02_okun','01_plotva','04_ersh','05_leshch','12_elets'].includes(s.slug));
    const avg = activeSpecies.reduce((acc, s) => acc + evaluateSpeciesForWeather(s, d, META.current_month_idx).score, 0) / activeSpecies.length;
    const pct = Math.round(avg * 10);
    const cls = pct >= 66 ? 'sc-high' : (pct >= 52 ? 'sc-med' : (pct >= 40 ? 'sc-low' : 'sc-bad'));
    const dpTxt = d.pressure_delta > 0 ? `+${{d.pressure_delta}}` : `${{d.pressure_delta}}`;
    return `
      <div class="wx-day-card ${{i === state.selectedDayIdx && !state.simCustom ? 'active' : ''}}" onclick="selectForecastDay(${{i}})">
        <div class="wx-day-title"><span>${{esc(d.day_label)}}</span></div>
        <div class="wx-temps">+${{d.temp_day_c}}° <span>/ ${{d.temp_night_c > 0 ? '+' : ''}}${{d.temp_night_c}}° · вода +${{d.water_temp_c}}°</span></div>
        <div class="wx-line">Давл.: <b>${{d.pressure_mm}}</b> мм (${{dpTxt}})</div>
        <div class="wx-line">Ветер: ${{esc(d.wind_dir)}} ${{d.wind_speed}} м/с</div>
        <div class="wx-line" style="color:var(--muted)">${{esc(d.precip.split(',')[0])}}</div>
        <div class="wx-score-pill ${{cls}}">Клёв сезона: ${{pct}}%</div>
      </div>
    `;
  }}).join('');

  // Evaluate all filtered species for the active weather
  const evaluated = filteredList.map(sp => ({{
    sp,
    res: evaluateSpeciesForWeather(sp, activeWx, mIdx)
  }})).sort((a, b) => b.res.score - a.res.score);

  // Group indices
  const avgBy = (slugs) => {{
    const sub = SPECIES.filter(s => slugs.includes(s.slug));
    return Math.round((sub.reduce((a, s) => a + evaluateSpeciesForWeather(s, activeWx, mIdx).score, 0) / sub.length) * 10);
  }};
  const idxPred = avgBy(['20_nalim','17_shchuka','18_sudak','02_okun','04_ersh','15_rotan']);
  const idxColdPeace = avgBy(['01_plotva','05_leshch','11_yaz','12_elets','14_peskar']);
  const idxWarm = avgBy(['07_karp','08_sazan','09_lin','24_som','25_karas_zolotoy','22_bely_amur']);

  el.innerHTML = `
    <div class="wx-hero-panel">
      <div class="wx-top-row">
        <div>
          <h2>Реальный рыболовный прогноз на неделю · ${{esc(META.location)}} · ${{esc(META.period)}}</h2>
          <div style="font-size:12.5px;color:var(--muted);margin-top:3px">
            Честный расчёт по температуре воды, перепадам барометра (ΔP), направлению/силе ветра, облачности, осадкам и фазе Луны
          </div>
        </div>
        <div class="btn-group">
          <button class="fbtn active" onclick="fetchLiveOpenMeteo()">Обновить погоду онлайн (Open-Meteo)</button>
          ${{state.simCustom ? '<button class="fbtn" onclick="selectForecastDay(state.selectedDayIdx)">Сбросить на реальный прогноз</button>' : ''}}
        </div>
      </div>
      ${{state.liveFetchMsg ? `<div style="margin-bottom:10px;font-size:12.5px;color:var(--gold)">${{esc(state.liveFetchMsg)}}</div>` : ''}}
      <div class="wx-days-grid">${{dayCardsHtml}}</div>
    </div>

    <div class="wx-detail-grid">
      <div class="wx-box">
        <h3>${{state.simCustom ? 'Пользовательский метео-режим (Симулятор)' : `Разбор погоды: ${{esc(baseDay.day_label)}}`}}</h3>
        <div class="wx-metrics-4">
          <div class="wx-m"><span>Давление (перепад)</span><strong>${{activeWx.pressure_mm}} мм (${{activeWx.pressure_delta >= 0 ? '+' : ''}}${{activeWx.pressure_delta}})</strong></div>
          <div class="wx-m"><span>Вода / Воздух</span><strong>+${{activeWx.water_temp_c.toFixed(1)}} °C / ${{state.simCustom ? '—' : '+' + baseDay.temp_day_c + ' °C'}}</strong></div>
          <div class="wx-m"><span>Ветер</span><strong>${{esc(activeWx.wind_dir)}} ${{activeWx.wind_speed}} м/с</strong></div>
          <div class="wx-m"><span>Индексы групп</span><strong>Х:${{idxPred}}% · Б:${{idxColdPeace}}% · Т:${{idxWarm}}%</strong></div>
        </div>
        <p style="margin:0 0 10px;font-size:13px;color:#dbeafa">
          ${{state.simCustom
            ? `Моделирование условий: месяц <b>${{META.month_names[mIdx]}}</b>, вода <b>+${{activeWx.water_temp_c.toFixed(1)}} °C</b>, давление <b>${{activeWx.pressure_mm}} мм</b> (суточный ход ${{activeWx.pressure_delta >= 0 ? '+' : ''}}${{activeWx.pressure_delta}} мм), ветер <b>${{esc(activeWx.wind_dir)}} ${{activeWx.wind_speed}} м/с</b>. Расшифровка индексов: <b>Х</b> — холодостойкий хищник, <b>Б</b> — речная белая рыба, <b>Т</b> — теплолюбивые виды.`
            : `${{esc(baseDay.summary)}}<br/><span style="color:var(--muted);font-size:12px">Световой день: ${{esc(baseDay.daylight)}} · Луна: ${{esc(baseDay.moon_phase)}} · Тренд: ${{esc(baseDay.pressure_trend)}}</span>`
          }}
        </p>
        ${{buildWeekSvg(WEEK, state.selectedDayIdx)}}
      </div>

      <div class="wx-box">
        <h3>Калькулятор-симулятор погоды (проверьте любой сезон и давление)</h3>
        <div class="sim-controls">
          <div class="sim-ctrl">
            <label><span>Месяц года</span><span>${{META.month_names[mIdx]}}</span></label>
            <select onchange="updateSimField('monthIdx', this.value)">
              ${{META.month_names.map((mn, i) => `<option value="${{i}}" ${{i === mIdx ? 'selected' : ''}}>${{mn}}</option>`).join('')}}
            </select>
          </div>
          <div class="sim-ctrl">
            <label><span>Температура воды</span><span>+${{activeWx.water_temp_c.toFixed(1)}} °C</span></label>
            <input type="range" min="0.5" max="26" step="0.5" value="${{activeWx.water_temp_c}}" oninput="updateSimField('water_temp_c', this.value)" />
          </div>
          <div class="sim-ctrl">
            <label><span>Давление</span><span>${{activeWx.pressure_mm}} мм</span></label>
            <input type="range" min="732" max="775" step="1" value="${{activeWx.pressure_mm}}" oninput="updateSimField('pressure_mm', this.value)" />
          </div>
          <div class="sim-ctrl">
            <label><span>Перепад ΔP за 24 ч</span><span>${{activeWx.pressure_delta >= 0 ? '+' : ''}}${{activeWx.pressure_delta}} мм</span></label>
            <input type="range" min="-12" max="12" step="1" value="${{activeWx.pressure_delta}}" oninput="updateSimField('pressure_delta', this.value)" />
          </div>
          <div class="sim-ctrl">
            <label><span>Скорость ветра</span><span>${{activeWx.wind_speed}} м/с</span></label>
            <input type="range" min="0" max="12" step="0.5" value="${{activeWx.wind_speed}}" oninput="updateSimField('wind_speed', this.value)" />
          </div>
          <div class="sim-ctrl">
            <label><span>Направление ветра</span><span>${{esc(activeWx.wind_dir)}}</span></label>
            <select onchange="updateSimField('wind_sector', this.value)">
              <option value="warm" ${{activeWx.wind_sector === 'warm' ? 'selected' : ''}}>Ю / ЮЗ / З (тёплый)</option>
              <option value="cold" ${{activeWx.wind_sector === 'cold' ? 'selected' : ''}}>С / СВ / В (холодный)</option>
              <option value="calm" ${{activeWx.wind_sector === 'calm' ? 'selected' : ''}}>Штиль</option>
            </select>
          </div>
        </div>
        <div style="margin-top:10px;font-size:11.8px;color:var(--muted)">
          Попробуйте переключить месяц на <b>Май</b> или <b>Июль</b> и воду на <b>+18..+22 °C</b> — теплолюбивые (карп, сазан, карась, линь, сом, амур) сразу поднимутся в топ прогноза!
        </div>
      </div>
    </div>

    <div class="wx-fish-grid">
      ${{evaluated.map(({{sp, res}}) => {{
        const barCol = res.score >= 7.6 ? '#34d399' : (res.score >= 5.6 ? '#38bdf8' : (res.score >= 3.4 ? '#f59e0b' : '#f43f5e'));
        const cardCls = res.score >= 7.0 ? 'top' : (res.score < 1.8 ? 'dormant' : '');
        return `
          <div class="wx-fish-card ${{cardCls}}">
            <div class="wx-fc-top">
              <div class="wx-fc-img" title="Открыть карточку" onclick="openModal('${{sp.media.card_game}}', '${{esc(sp.name_ru)}}')">
                <img src="${{sp.media.sprite}}" loading="lazy" alt="${{esc(sp.name_ru)}}" />
              </div>
              <div class="wx-fc-meta">
                <div class="wx-fc-name">
                  <span>#${{String(sp.num).padStart(2,'0')}} ${{esc(sp.name_ru)}}</span>
                  <span class="wx-score-pill ${{res.tierCls}}" style="margin:0;padding:2px 8px">${{res.score.toFixed(1)}} / 10</span>
                </div>
                <div style="font-size:11.5px;color:var(--muted)">${{esc(sp.category)}} · ${{esc(res.tierLabel)}}</div>
                <div class="wx-fc-bar-bg"><div class="wx-fc-bar" style="width:${{res.score * 10}}%;background:${{barCol}}"></div></div>
              </div>
            </div>
            <p class="wx-fc-why">${{esc(res.why)}}</p>
            <p class="wx-fc-why" style="color:var(--aqua);font-size:11.8px"><b>На что и где:</b> ${{esc(sp.baits_best)}} · ${{esc(sp.meteo.best_hours_nov)}}</p>
            <div class="wx-fc-foot">
              <span>${{esc(sp.bite_type)}}</span>
              <div class="btn-group">
                <button class="fbtn" style="padding:3px 8px;font-size:11px" onclick="openModal('${{sp.media.gif}}', 'Поклёвка · ${{esc(sp.name_ru)}}')">GIF поклёвки</button>
                <button class="fbtn" style="padding:3px 8px;font-size:11px" onclick="ensureFullView('${{sp.slug}}')">К карточке</button>
              </div>
            </div>
          </div>
        `;
      }}).join('')}}
    </div>
  `;
}}

function renderCalendar() {{
  const el = document.getElementById('calendarView');
  const list = getFiltered();
  const mNames = META.month_names;
  const nowM = META.current_month_idx;
  const scoreLegend = ['0 — покой/сон','1 — случайно','2 — слабо','3 — средне','4 — хорошо','5 — жор'];

  el.innerHTML = `
    <div class="wx-hero-panel" style="margin-bottom:16px">
      <div class="wx-top-row" style="margin-bottom:6px">
        <h2>Годовой рыболовный календарь клёва (27 видов × 12 месяцев)</h2>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${{[0,1,2,3,4,5].map(v => `<span class="mcell m${{v}}" style="width:auto;padding:0 8px;font-size:11px">${{scoreLegend[v]}}</span>`).join('')}}
        </div>
      </div>
      <div style="font-size:12.5px;color:var(--muted)">
        Подсвеченный столбец <b>${{mNames[nowM]}}</b> — текущий месяц (поздняя осень / предзимье). Нажмите на любую рыбу, чтобы открыть её подробную карточку и живую анимацию поклёвки.
      </div>
    </div>

    <div class="cal-matrix-wrap">
      <table class="cal">
        <thead>
          <tr>
            <th style="text-align:left;padding-left:12px">Вид рыбы (картинка + категория)</th>
            ${{mNames.map((mn, i) => `<th class="${{i === nowM ? 'now-m' : ''}}">${{mn}}</th>`).join('')}}
            <th style="text-align:left">Погодный характер и примечание</th>
          </tr>
        </thead>
        <tbody>
          ${{list.map(sp => `
            <tr>
              <td class="sp-col">
                <div class="cal-sp-flex" onclick="ensureFullView('${{sp.slug}}')">
                  <img src="${{sp.media.sprite}}" loading="lazy" alt="${{esc(sp.name_ru)}}" />
                  <div>
                    <b style="color:#fff">${{String(sp.num).padStart(2,'0')}}. ${{esc(sp.name_ru)}}</b><br/>
                    <span style="font-size:11px;color:${{sp.is_predator ? '#fb7185' : 'var(--aqua)'}}">${{esc(sp.category)}}</span>
                  </div>
                </div>
              </td>
              ${{sp.meteo.months.map((val, mi) => `
                <td class="${{mi === nowM ? 'now-m' : ''}}"><span class="mcell m${{val}}" title="${{mNames[mi]}}: ${{scoreLegend[val]}}">${{val}}</span></td>
              `).join('')}}
              <td style="text-align:left;font-size:11.8px;color:#cfe2f5;min-width:250px">${{esc(sp.meteo.weather_note)}}</td>
            </tr>
          `).join('')}}
        </tbody>
      </table>
    </div>

    <h2 style="color:var(--gold);margin:18px 0 12px;font-size:19px">Как давление, температура воды, ветер и Луна влияют на клёв</h2>
    <div class="guide-grid">
      ${{METEO_GUIDE.map(g => `
        <div class="guide-card">
          <h3>${{esc(g.title)}}</h3>
          <div class="guide-badge">${{esc(g.badge)}}</div>
          <p style="margin:0;font-size:13px;color:#e0eefc">${{g.body}}</p>
          <ul>${{g.bullets.map(b => `<li>${{b}}</li>`).join('')}}</ul>
        </div>
      `).join('')}}
    </div>
  `;
}}

function renderAll() {{
  const list = getFiltered();
  document.getElementById('countText').textContent = `Показано видов: ${{list.length}} из ${{SPECIES.length}}`;

  const fullEl = document.getElementById('fullView');
  const tableEl = document.getElementById('tableView');
  const forecastEl = document.getElementById('forecastView');
  const calEl = document.getElementById('calendarView');
  updateBaseVisibility();

  fullEl.classList.add('hidden');
  tableEl.classList.add('hidden');
  forecastEl.classList.add('hidden');
  calEl.classList.add('hidden');

  if (state.view === 'base') return;

  if (state.view === 'forecast') {{
    forecastEl.classList.remove('hidden');
    renderForecast();
    return;
  }}

  if (state.view === 'calendar') {{
    calEl.classList.remove('hidden');
    renderCalendar();
    return;
  }}

  if (state.view === 'table') {{
    tableEl.classList.remove('hidden');
    document.getElementById('tableBody').innerHTML = list.map(sp => `
      <tr onclick="jumpFromTable('${{sp.slug}}')">
        <td><b>${{String(sp.num).padStart(2,'0')}}</b></td>
        <td><img class="thumb-card" src="${{sp.media.card_game}}" loading="lazy" alt="${{esc(sp.name_ru)}}" /></td>
        <td>
          <b>${{esc(sp.name_ru)}}</b><br/>
          <i style="color:var(--muted);font-size:11.5px">${{esc(sp.latin)}}</i><br/>
          <code style="font-size:10.5px;color:#93c5fd">${{esc((sp.fbx_models || []).join(', '))}}</code>
        </td>
        <td>
          <span class="tag ${{sp.is_predator ? 'pred' : 'peace'}}">${{esc(sp.category)}}</span><br/>
          <span style="font-size:11px;color:var(--mint)">${{esc(sp.layer_label)}}</span>
        </td>
        <td style="max-width:210px">
          <b>Держится:</b> ${{esc(sp.depth_holds)}}<br/>
          <span style="color:var(--muted);font-size:11.5px"><b>Клюёт:</b> ${{esc(sp.depth_bites)}}</span>
        </td>
        <td style="max-width:190px">
          <b>${{esc(sp.baits_best)}}</b><br/>
          <span style="color:var(--muted);font-size:11px">${{esc(sp.baits_extra)}}</span>
        </td>
        <td>
          <img class="thumb-gif" src="${{sp.media.gif}}" loading="lazy" alt="Поклёвка ${{esc(sp.name_ru)}}" />
          <div style="font-size:11px;margin-top:3px;color:var(--aqua)">${{esc(sp.bite_type)}}</div>
        </td>
        <td>
          <b>${{esc(sp.bite_window_s)}}</b><br/>
          <span class="tag ${{diffClass(sp.difficulty)}}">${{esc(sp.difficulty)}}</span>
        </td>
      </tr>
    `).join('');
    return;
  }}

  // Full View
  fullEl.classList.remove('hidden');
  fullEl.innerHTML = list.map(sp => {{
    const t = sp.tiers;
    return `
      <article id="fish-${{sp.slug}}" class="fish-entry ${{sp.is_predator ? 'predator' : 'peace'}}">
        <div class="fish-header">
          <div class="fish-title-group">
            <span class="fish-num">#${{String(sp.num).padStart(2,'0')}}</span>
            <h3 class="fish-name">${{esc(sp.name_ru)}}</h3>
            <span class="fish-latin">${{esc(sp.latin)}}</span>
            <span class="fish-family">· ${{esc(sp.family_ru)}} · ${{esc(sp.subcategory)}}</span>
          </div>
          <div class="fish-badges">
            <span class="tag ${{sp.is_predator ? 'pred' : 'peace'}}">${{esc(sp.category)}}</span>
            <span class="tag layer">${{esc(sp.layer_label)}}</span>
            <span class="tag ${{diffClass(sp.difficulty)}}">Подсечка: ${{esc(sp.difficulty)}}</span>
            <span class="tag fbx">${{esc((sp.fbx_models || []).join(' · '))}}</span>
          </div>
        </div>

        <div class="fish-body">
          <!-- Column 1: Illustrated Cards & Sprites -->
          <div class="col-visual">
            <div class="vis-tabs">
              <button class="vtab active" onclick="switchFishMedia('${{sp.slug}}','card_game',this)">Игровая</button>
              <button class="vtab" onclick="switchFishMedia('${{sp.slug}}','card_clean',this)">Без рамки</button>
              <button class="vtab" onclick="switchFishMedia('${{sp.slug}}','sprite',this)">Спрайт</button>
              <button class="vtab" onclick="switchFishMedia('${{sp.slug}}','ref',this)">Референс</button>
            </div>
            <div class="vis-frame" onclick="openModal(this.querySelector('img').src, '${{esc(sp.name_ru)}} (${{esc(sp.latin)}})')">
              <img src="${{sp.media.card_game}}" loading="lazy" alt="Карточка ${{esc(sp.name_ru)}}" />
            </div>
            <div class="vis-hint">Переключайте виды карточки · Нажмите для увеличения</div>
          </div>

          <!-- Column 2: Live Bite GIF + Mechanics -->
          <div class="col-bite">
            <div class="gif-box">
              <div class="gif-head">
                <strong>Живая поклёвка на поплавок</strong>
                <span>${{esc(sp.bite_type)}}</span>
              </div>
              <img src="${{sp.media.gif}}" loading="lazy" alt="Анимация поклёвки: ${{esc(sp.name_ru)}}"
                   style="cursor:zoom-in" onclick="openModal(this.src, 'Анимация поклёвки · ${{esc(sp.name_ru)}} (${{esc(sp.bite_type)}})')" />
            </div>

            <div class="bite-box">
              <div>
                <span class="lbl">Характер поклёвки</span>
                <p>${{esc(sp.bite_character)}}</p>
              </div>
              <div class="hook-callout">
                <strong>Момент подсечки:</strong> ${{esc(sp.hook_moment)}}
              </div>
              <div class="tz-metrics">
                <div class="tz-metric"><span>Оптимальное окно</span><strong>${{esc(sp.bite_window_s)}}</strong></div>
                <div class="tz-metric"><span>Фаза пробы (ТЗ)</span><strong>${{esc(sp.probe_duration_s)}}</strong></div>
              </div>
              <div class="tz-callout">
                <strong>Для игры / ТЗ:</strong> ${{esc(sp.game_spec)}}
              </div>
            </div>
          </div>

          <!-- Column 3: Encyclopedia -->
          <div class="col-info">
            <div class="info-grid">
              <div class="info-block">
                <h4>Где обитает</h4>
                <p>${{esc(sp.where_lives)}}</p>
              </div>
              <div class="info-block">
                <h4>Глубина (стоянка и клёв)</h4>
                <p><span class="sub-k">Держится:</span> ${{esc(sp.depth_holds)}}</p>
                <p><span class="sub-k">Клюёт:</span> ${{esc(sp.depth_bites)}}</p>
              </div>
              <div class="info-block">
                <h4>На что клюёт и снасть</h4>
                <p><span class="sub-k">Лучшее:</span> ${{esc(sp.baits_best)}}</p>
                <p><span class="sub-k">Дополнительно:</span> ${{esc(sp.baits_extra)}}</p>
                <p><span class="sub-k">Прикормка:</span> ${{esc(sp.groundbait)}}</p>
                <p><span class="sub-k">Снасть:</span> ${{esc(sp.tackle_tips)}}</p>
              </div>
              <div class="info-block">
                <h4>Места стоянки и повадки</h4>
                <p>${{esc(sp.places_and_habits)}}</p>
              </div>
              <div class="info-block wide">
                <h4>Погода и сезонность</h4>
                <p><span class="sub-k">Влияние метео:</span> ${{esc(sp.meteo.weather_note)}}</p>
                <p><span class="sub-k">Ноябрьские часы:</span> ${{esc(sp.meteo.best_hours_nov)}}</p>
              </div>
              <div class="info-block wide">
                <h4>Описание вида и внешние признаки</h4>
                <p>${{esc(sp.description)}}</p>
                <p style="margin-top:4px;color:var(--muted)"><span class="sub-k">Ключевые детали карточки:</span> ${{esc(sp.traits)}}</p>
              </div>
              <div class="info-block wide">
                <h4>Размерно-весовые категории (аркадная шкала игры 70 г – 27 кг)</h4>
                <div class="tiers-grid">
                  <div class="tier-cell">
                    <div class="tier-name">Мелочь</div>
                    <div class="tier-w">${{esc(t.meloch.w_label)}}</div>
                    <div class="tier-l">${{t.meloch.l_min_cm}}–${{t.meloch.l_max_cm}} см</div>
                  </div>
                  <div class="tier-cell">
                    <div class="tier-name">Средняя</div>
                    <div class="tier-w">${{esc(t.srednyaya.w_label)}}</div>
                    <div class="tier-l">${{t.srednyaya.l_min_cm}}–${{t.srednyaya.l_max_cm}} см</div>
                  </div>
                  <div class="tier-cell">
                    <div class="tier-name">Крупная</div>
                    <div class="tier-w">${{esc(t.krupnaya.w_label)}}</div>
                    <div class="tier-l">${{t.krupnaya.l_min_cm}}–${{t.krupnaya.l_max_cm}} см</div>
                  </div>
                  <div class="tier-cell trof">
                    <div class="tier-name">Трофей</div>
                    <div class="tier-w">${{esc(t.trofey.w_label)}}</div>
                    <div class="tier-l">${{t.trofey.l_min_cm}}–${{t.trofey.l_max_cm}} см</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    `;
  }}).join('');
}}

function jumpFromTable(slug) {{
  ensureFullView(slug);
}}

// Event listeners
document.getElementById('searchBox').addEventListener('input', e => {{
  state.q = e.target.value;
  renderAll();
}});
document.querySelectorAll('#viewModeGroup .fbtn').forEach(btn => btn.addEventListener('click', () => {{
  document.querySelectorAll('#viewModeGroup .fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.view = btn.dataset.view;
  renderAll();
}}));
document.querySelectorAll('#catFilter .fbtn').forEach(btn => btn.addEventListener('click', () => {{
  document.querySelectorAll('#catFilter .fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.cat = btn.dataset.cat;
  renderAll();
}}));
document.querySelectorAll('#layerFilter .fbtn').forEach(btn => btn.addEventListener('click', () => {{
  document.querySelectorAll('#layerFilter .fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.layer = btn.dataset.layer;
  renderAll();
}}));
document.querySelectorAll('#diffFilter .fbtn').forEach(btn => btn.addEventListener('click', () => {{
  document.querySelectorAll('#diffFilter .fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.diff = btn.dataset.diff;
  renderAll();
}}));

renderJumpStrip();
renderBaseTypes();
renderAll();
</script>
</body>
</html>
"""


def main():
    with open("data/fish_handbook_27.json", "r", encoding="utf-8") as f:
        handbook = json.load(f)
    with open("data/weather_calendar_27.json", "r", encoding="utf-8") as f:
        weather_cal = json.load(f)

    standalone_html = build_html(handbook, weather_cal, standalone=True)
    standalone_name = "spravochnik_ryb_worldofvikingcraft.html"
    with open(standalone_name, "w", encoding="utf-8") as f:
        f.write(standalone_html)
    print(f"Wrote {standalone_name} ({os.path.getsize(standalone_name)/(1024*1024):.2f} MB)")

    linked_html = build_html(handbook, weather_cal, standalone=False)
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(linked_html)
    print(f"Wrote index.html ({os.path.getsize('index.html')/1024:.1f} KB)")

    readme_txt = """ЕДИНЫЙ СПРАВОЧНИК РЫБ, ПОКЛЁВОК, КАЛЕНДАРЯ И ПРОГНОЗА — WORLDOFVIKINGCRAFT (27 ВИДОВ)
========================================================================================

Главный автономный документ (открывается в любом браузере без интернета):
  spravochnik_ryb_worldofvikingcraft.html
    — Внутрь файла уже вшиты: все 27 иллюстрированных карточек (игровая и без рамки),
      прозрачные спрайты, фото-референсы, все 32 живые GIF-анимации поклёвок,
      реальный метеопрогноз клёва на неделю (Вильнюс, 15–21 ноя 2026), интерактивный
      калькулятор погоды и годовой рыболовный календарь на 12 месяцев.

Состав полного архива:
1. spravochnik_ryb_worldofvikingcraft.html — полностью автономный единый HTML-справочник.
2. index.html   — версия каталога, открывающая оригинальные PNG 900x1200 из папок архива.
3. bite_gifs/   — 32 живые GIF-анимации поклёвки (27 видовых + 5 базовых схем поплавка).
4. cards_game/  — 27 игровых карточек в тёмно-водной рамке (900x1200 px, PNG).
5. cards_clean/ — 27 светлых карточек без рамки (900x1200 px, PNG).
6. fish_art/    — 27 детальных иллюстраций на прозрачном фоне (RGBA PNG, вправо).
7. references/  — 27 проверенных фото-референсов из интернета.
8. data/        — fish_handbook_27.json, weather_calendar_27.json, fish_database.json, fish_database.csv.
"""
    with open("README_PACK.txt", "w", encoding="utf-8") as f:
        f.write(readme_txt)

    zip_path = "fish_cards_pack_27.zip"
    if os.path.exists(zip_path):
        os.remove(zip_path)

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.write(standalone_name, standalone_name)
        zf.write("index.html", "index.html")
        zf.write("README_PACK.txt", "README.txt")
        for folder in ["bite_gifs", "cards_game", "cards_clean", "fish_art", "references", "data"]:
            for fn in sorted(os.listdir(folder)):
                full = os.path.join(folder, fn)
                if os.path.isfile(full):
                    zf.write(full, f"{folder}/{fn}")

    os.remove("README_PACK.txt")
    print(f"Created {zip_path} ({os.path.getsize(zip_path)/(1024*1024):.2f} MB)")


if __name__ == "__main__":
    main()
