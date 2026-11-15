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


def build_html(handbook: dict, standalone: bool) -> str:
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
        entry.pop("anim", None)  # not needed in JS since live GIF is embedded
        entry["media"] = media
        species_data.append(entry)

    base_types = []
    for bt in handbook["base_bite_types"]:
        b = dict(bt)
        b.pop("anim", None)
        if standalone:
            b["gif"] = file_to_data_uri(f"bite_gifs/{b['id']}.gif", "image/gif")
        else:
            b["gif"] = f"bite_gifs/{b['id']}.gif"
        base_types.append(b)

    payload_json = json.dumps({"species": species_data, "base_types": base_types}, ensure_ascii=False)
    # Escape </script> defensively
    payload_json = payload_json.replace("</", "<\\/")

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
<title>WorldOfVikingCraft — Единый справочник рыб и поклёвок (27 видов)</title>
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
    padding: 20px 24px 16px;
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
    font-size: clamp(20px, 2.5vw, 28px);
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
    background: rgba(8, 18, 30, 0.94);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
  }}
  .toolbar {{
    max-width: 1440px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }}
  .toolbar-row {{
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }}
  .search-input {{
    flex: 1 1 280px;
    min-width: 220px;
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
    font-size: 12.5px;
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
    background: linear-gradient(135deg, rgba(245,197,66,0.22), rgba(56,189,248,0.2));
    color: var(--gold);
    border-color: var(--gold);
  }}

  /* Quick Species Jump Chips */
  .jump-strip {{
    max-width: 1440px;
    margin: 14px auto 0;
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
    padding: 18px 24px 60px;
  }}
  .status-bar {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
    font-size: 13px;
    color: var(--muted);
  }}

  /* Base 5 Bite Types Accordion / Grid */
  .base-panel {{
    background: var(--card);
    border: 1px solid var(--border-hi);
    border-radius: 16px;
    padding: 16px 18px;
    margin-bottom: 22px;
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
    scroll-margin-top: 128px;
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
    .info-block, .bite-box, .tier-cell {{ background: #f8fafc; color: #111; border-color: #cbd5e1; }}
    .info-block p, .tz-callout {{ color: #111; }}
  }}
</style>
</head>
<body>

<header class="hero">
  <div class="hero-inner">
    <div>
      <h1>WorldOfVikingCraft — Полный интерактивный справочник рыб и поклёвок</h1>
      <p class="hero-sub">Все 27 видов из проекта · Иллюстрированные игровые карточки · Живые GIF-анимации поплавка · Глубины, биотопы, насадки, повадки и ТЗ для разработки</p>
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
      <input id="searchBox" class="search-input" type="search" placeholder="Поиск: вид, латынь, модель .fbx, наживка, глубина, место обитания..." />
      <div class="btn-group" id="viewModeGroup">
        <button class="fbtn tab active" data-view="full">Полный каталог (Карточки + GIF)</button>
        <button class="fbtn tab" data-view="table">Сводная шпаргалка (Таблица)</button>
        <button class="fbtn tab" data-view="base">5 базовых типов поклёвок</button>
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
      <span id="baseToggleHint" class="fbtn">Свернуть / Развернуть</span>
    </div>
    <div id="baseGrid" class="base-grid"></div>
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

let state = {{
  view: 'full',
  cat: 'all',
  layer: 'all',
  diff: 'all',
  q: '',
  baseExpanded: false
}};

function esc(s) {{
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}}

function diffClass(d) {{
  if (d.includes('лёгк')) return 'diff-easy';
  if (d.includes('слож')) return 'diff-hard';
  return 'diff-med';
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
  if (state.view !== 'full') {{
    state.view = 'full';
    document.querySelectorAll('#viewModeGroup .fbtn').forEach(b => b.classList.toggle('active', b.dataset.view === 'full'));
    renderAll();
    setTimeout(() => {{
      const el = document.getElementById('fish-' + slug);
      if (el) el.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
    }}, 50);
  }}
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

function renderAll() {{
  const list = getFiltered();
  document.getElementById('countText').textContent = `Показано видов: ${{list.length}} из ${{SPECIES.length}}`;

  const fullEl = document.getElementById('fullView');
  const tableEl = document.getElementById('tableView');
  updateBaseVisibility();

  if (state.view === 'base') {{
    fullEl.classList.add('hidden');
    tableEl.classList.add('hidden');
    return;
  }}

  if (state.view === 'table') {{
    fullEl.classList.add('hidden');
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
  tableEl.classList.add('hidden');
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
  state.view = 'full';
  document.querySelectorAll('#viewModeGroup .fbtn').forEach(b => b.classList.toggle('active', b.dataset.view === 'full'));
  renderAll();
  setTimeout(() => {{
    const el = document.getElementById('fish-' + slug);
    if (el) el.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
  }}, 40);
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

    standalone_html = build_html(handbook, standalone=True)
    standalone_name = "spravochnik_ryb_worldofvikingcraft.html"
    with open(standalone_name, "w", encoding="utf-8") as f:
        f.write(standalone_html)
    print(f"Wrote {standalone_name} ({os.path.getsize(standalone_name)/(1024*1024):.2f} MB)")

    linked_html = build_html(handbook, standalone=False)
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(linked_html)
    print(f"Wrote index.html ({os.path.getsize('index.html')/1024:.1f} KB)")

    readme_txt = """ЕДИНЫЙ СПРАВОЧНИК РЫБ И ПОКЛЁВОК — WORLDOFVIKINGCRAFT (27 ВИДОВ)
==================================================================

Главный автономный документ (открывается в любом браузере без интернета):
  spravochnik_ryb_worldofvikingcraft.html
    — Внутрь файла уже вшиты: все 27 иллюстрированных карточек (игровая и без рамки),
      прозрачные спрайты, фото-референсы и все 32 живые GIF-анимации поклёвок!
      Этот один HTML-файл можно скопировать куда угодно (на компьютер или телефон)
      и открыть без интернета и без соседних папок.

Состав полного архива:
1. spravochnik_ryb_worldofvikingcraft.html — полностью автономный единый HTML-справочник.
2. index.html   — версия каталога, открывающая оригинальные PNG 900x1200 из папок архива.
3. bite_gifs/   — 32 живые GIF-анимации поклёвки (27 видовых + 5 базовых схем поплавка).
4. cards_game/  — 27 игровых карточек в тёмно-водной рамке (900x1200 px, PNG).
5. cards_clean/ — 27 светлых карточек без рамки (900x1200 px, PNG).
6. fish_art/    — 27 детальных иллюстраций на прозрачном фоне (RGBA PNG, вправо).
7. references/  — 27 проверенных фото-референсов из интернета.
8. data/        — fish_handbook_27.json (полная база со всеми полями и ТЗ),
                  fish_database.json и fish_database.csv.
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
