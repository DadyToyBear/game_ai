#!/usr/bin/env python3
"""Собирает assets/SHOWCASE.html — витрину всех сгенерированных ассетов.

Страница статическая, картинки подключаются относительными путями,
поэтому открывается прямо из репозитория (или из превью в браузере).
Размеры файлов подставляются при сборке.

Запуск:  python3 tools/make_showcase.py
"""
import os
from datetime import date

from PIL import Image

ROOT = "assets"
OUT = os.path.join(ROOT, "SHOWCASE.html")


def size_kb(path):
    return f"{os.path.getsize(path) / 1024:.0f} KB"


def dims(path):
    try:
        with Image.open(path) as im:
            return f"{im.width}×{im.height}"
    except Exception:
        return ""


def collect(*patterns, base=ROOT):
    """Файлы по маскам каталогов, в заданном порядке."""
    out = []
    for pat in patterns:
        d = os.path.join(base, pat)
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.lower().endswith((".png", ".jpg", ".gif")) and not f.startswith("_"):
                    out.append(os.path.join(d, f))
    return out


def card(path, label=None, cls="", note=""):
    rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
    name = label or os.path.splitext(os.path.basename(path))[0]
    meta = f"{dims(path)} · {size_kb(path)}"
    note_html = f'<div class="note">{note}</div>' if note else ""
    return (f'<figure class="card {cls}">'
            f'<img src="{rel}" alt="{name}" loading="lazy">'
            f'<figcaption><b>{name}</b><span>{meta}</span>{note_html}</figcaption>'
            f"</figure>")


def section(title, subtitle, body, anchor):
    return (f'<section id="{anchor}"><h2>{title}</h2>'
            f'<p class="sub">{subtitle}</p><div class="grid">{body}</div></section>')


def main():
    units = collect("units/cards")
    ui_top = [os.path.join(ROOT, "ui/battle", f) for f in
              ("battle_panel.png", "battle_buttons.png", "round_banner.png", "hp_bar.png")]
    icon_rows = [os.path.join(ROOT, "ui/battle", f) for f in
                 ("command_icons_row.png", "formation_icons_row.png", "status_icons_row.png")]
    icon_files = collect("ui/battle/icons")
    buttons = collect("ui/battle/buttons")
    bgs = collect("battle_scenarios")
    tiles = collect("battle_scenarios/tiles")
    walk_gifs = sorted(os.path.join("preview_walk", f)
                       for f in os.listdir("preview_walk") if f.endswith(".gif")) \
        if os.path.isdir("preview_walk") else []
    event_files = collect("events")

    unit_html = "".join(card(p) for p in units)
    buttons_html = "".join(card(p, cls="icon") for p in buttons)

    ui_html = "".join(card(p, cls="wide") for p in ui_top)
    icons_html = "".join(
        f'<figure class="card row"><img src="{os.path.relpath(p, ROOT).replace(os.sep, "/")}" loading="lazy">'
        f'<figcaption><b>{os.path.basename(p)}</b><span>{dims(p)} · {size_kb(p)}</span></figcaption></figure>'
        for p in icon_rows)
    icons_html += "".join(card(p, cls="icon") for p in icon_files)
    ui_html += buttons_html

    bg_html = "".join(card(p, cls="wide") for p in bgs)
    tile_html = "".join(card(p, cls="tile") for p in tiles)

    if walk_gifs:
        walk_html = "".join(
            f'<figure class="card anim"><img src="../{p.replace(os.sep, "/")}" alt="ходьба" loading="lazy">'
            f'<figcaption><b>{os.path.splitext(os.path.basename(p))[0]}</b>'
            f'<span>{dims(p)} · {size_kb(p)}</span></figcaption></figure>'
            for p in walk_gifs)
        walk_html += "".join(card(p, cls="wide", note="лист кадров + .json с размерами")
                             for p in collect("animations/**", base=".") if False)
    else:
        walk_html = "<p>GIF-превью не собраны: запусти tools/make_walk_previews.py</p>"

    event_html = "".join(card(p, cls="wide") for p in event_files)

    total = sum(os.path.getsize(p) for p in units + ui_top + icon_rows + icon_files
                + bgs + tiles + event_files)

    html = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Корона и знамя — сгенерированные ассеты</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {{ --bg:#191612; --panel:#221e18; --line:#3a332a; --ink:#e9e0cf;
           --dim:#a89881; --gold:#c8a35c; --ochre:#b07a3f; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.5 Georgia, "Times New Roman", serif; }}
  header {{ padding:38px 24px 22px; border-bottom:1px solid var(--line);
           background:radial-gradient(ellipse at 50% -40%, #3a3126 0%, var(--bg) 70%); }}
  h1 {{ margin:0 0 6px; font-size:28px; letter-spacing:.4px; }}
  h2 {{ margin:0 0 4px; font-size:20px; color:var(--gold); }}
  .sub, .dim {{ color:var(--dim); font-size:13.5px; margin:0 0 14px; }}
  nav {{ padding:12px 24px; border-bottom:1px solid var(--line); display:flex;
        flex-wrap:wrap; gap:6px 16px; font-size:13.5px; }}
  nav a {{ color:var(--dim); text-decoration:none; border-bottom:1px dotted transparent; }}
  nav a:hover {{ color:var(--gold); border-bottom-color:var(--gold); }}
  section {{ padding:26px 24px 8px; }}
  .grid {{ display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; }}
  .card {{ margin:0; background:var(--panel); border:1px solid var(--line);
           border-radius:6px; padding:10px; width:190px; }}
  .card img {{ display:block; width:100%; height:auto; border-radius:3px;
               background:#2b2620; }}
  .card figcaption {{ margin-top:7px; font-size:12px; color:var(--dim); }}
  .card figcaption b {{ display:block; color:var(--ink); font-size:12.5px;
                        font-family:ui-monospace, "SF Mono", Consolas, monospace; }}
  .card .note {{ margin-top:4px; font-size:11.5px; color:var(--ochre); }}
  .card.wide {{ width:420px; }}
  .card.row {{ width:100%; max-width:720px; }}
  .card.icon {{ width:96px; padding:7px; }}
  .card.icon figcaption b {{ font-size:11px; }}
  .card.tile {{ width:150px; }}
  .card.anim {{ width:190px; }}
  .card.anim img {{ background:#332e26; }}
  footer {{ padding:26px 24px 46px; color:var(--dim); font-size:12.5px;
            border-top:1px solid var(--line); margin-top:20px; }}
  code {{ font-family:ui-monospace, Consolas, monospace; color:var(--gold); }}
</style>
</head>
<body>
<header>
  <h1>Корона и знамя — сгенерированные ассеты</h1>
  <p class="sub">Сгенерировано вместо nano banana 2 по файлу промтов · {date.today().strftime('%d.%m.%Y')}
     · всего {total / 1024 / 1024:.1f} МБ в {len(units + ui_top + icon_rows + icon_files + bgs + tiles + event_files)} файлах</p>
  <p class="sub">Стиль-якорь: painterly medieval fantasy, приглушённая земляная палитра
     (железо-коричневый, охра, мох, шифер), тёплый пергамент, чистый силуэт, без надписей.</p>
</header>
<nav>
  <a href="#units">Войска</a>
  <a href="#ui">Интерфейс боя</a>
  <a href="#icons">Иконки</a>
  <a href="#bgs">Фоны поля боя</a>
  <a href="#tiles">Тайлы</a>
  <a href="#walk">Спрайты ходьбы</a>
  <a href="#events">Иллюстрации</a>
</nav>

{section("Войска — карточки-портреты", "512×512, прозрачный фон, постановка на общую «землю».", unit_html, "units")}

{section("Интерфейс боя", "Пергамент, тёмное дерево, золото. Панель, кнопки, плашка раунда, полоса численности.", ui_html, "ui")}

{section("Иконки приказов, построений и состояний", "Сверху — исходные листы от генератора, ниже — нарезанные PNG 128×128 с прозрачным фоном, готовые для движка.", icons_html, "icons")}

{section("Фоны поля боя", "Живописные фоны без войск; на них движок кладёт отряды.", bg_html, "bgs")}

{section("Тайлы поля боя", "8 тайлов 128×128: трава, дорога, река, брод, лес, стена, ворота, мост.", tile_html, "tiles")}

{section("Спрайты ходьбы", "GIF — предпросмотр цикла; в игре используются листы <code>*_walk_row.png</code> с паспортом <code>.json</code>.", walk_html, "walk")}

{section("Иллюстрации для новостей и Кодекса", "Смотр войск, стена после штурма, обложка Кодекса.", event_html, "events")}

<footer>
  Табличка «что где лежит» и описания скриптов — в <code>assets/README_assets.md</code>.
  Всё собрано скриптами из <code>tools/</code>; исходные широкие генерации лежат рядом
  в <code>_raw/</code> и в git не попадают.
</footer>
</body>
</html>
"""
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"ok {OUT}: {total / 1024 / 1024:.1f} МБ, "
          f"{len(units)} карточек, {len(icon_files)} иконок, {len(bgs)} фонов, "
          f"{len(tiles)} тайлов, {len(event_files)} иллюстраций")


if __name__ == "__main__":
    main()
