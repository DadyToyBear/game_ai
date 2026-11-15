import json
import os
import zipfile


def find_ref_file(slug: str) -> str:
    for fn in sorted(os.listdir("references")):
        if fn.startswith(slug + "."):
            return f"references/{fn}"
    raise FileNotFoundError(f"Missing reference for {slug}")


def generate_html(species_list: list) -> str:
    data_js = json.dumps(species_list, ensure_ascii=False)
    ref_map = {sp["slug"]: find_ref_file(sp["slug"]) for sp in species_list}
    ref_js = json.dumps(ref_map, ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Игровой атлас рыб — 27 видов</title>
<style>
  :root {{
    --bg: #08121e;
    --panel: #0f1e30;
    --border: #203954;
    --text: #e8f1fa;
    --muted: #93acc4;
    --gold: #f5c542;
    --aqua: #38bdf8;
    --pred: #ef4444;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(circle at top, #10263d 0%, var(--bg) 65%);
    color: var(--text);
    min-height: 100vh;
  }}
  header {{
    max-width: 1400px;
    margin: 0 auto;
    padding: 28px 20px 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }}
  h1 {{
    margin: 0;
    font-size: 1.65rem;
    letter-spacing: 0.02em;
  }}
  .subtitle {{
    color: var(--muted);
    font-size: 0.92rem;
    margin-top: 4px;
  }}
  .controls {{
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }}
  input[type="search"] {{
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 9px 14px;
    font-size: 0.92rem;
    min-width: 220px;
  }}
  .btn-group {{
    display: inline-flex;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }}
  button {{
    background: transparent;
    color: var(--muted);
    border: none;
    padding: 9px 13px;
    cursor: pointer;
    font-size: 0.86rem;
    font-weight: 600;
  }}
  button.active {{
    background: #1c3a57;
    color: #fff;
  }}
  main {{
    max-width: 1400px;
    margin: 0 auto;
    padding: 22px 20px 48px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
  }}
  .card {{
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: transform 0.16s ease, border-color 0.16s ease;
  }}
  .card:hover {{
    transform: translateY(-3px);
    border-color: var(--aqua);
  }}
  .card.pred:hover {{ border-color: var(--pred); }}
  .thumb-wrap {{
    background: #07101b;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 260px;
    padding: 10px;
  }}
  .thumb-wrap.sprite-bg {{
    background: repeating-conic-gradient(#132234 0% 25%, #0e1a28 0% 50%) 50% / 20px 20px;
  }}
  .thumb-wrap img {{
    max-width: 100%;
    max-height: 390px;
    object-fit: contain;
    border-radius: 8px;
    display: block;
  }}
  .meta {{
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }}
  .row-top {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }}
  .title {{
    font-weight: 800;
    font-size: 1.08rem;
  }}
  .badge {{
    font-size: 0.72rem;
    font-weight: 700;
    padding: 4px 9px;
    border-radius: 999px;
    text-transform: uppercase;
  }}
  .badge.peace {{ background: rgba(56,189,248,0.16); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.45); }}
  .badge.pred {{ background: rgba(239,68,68,0.16); color: #fca5a5; border: 1px solid rgba(239,68,68,0.45); }}
  .latin {{
    color: var(--muted);
    font-size: 0.82rem;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    margin-top: 4px;
  }}
  td {{
    padding: 4px 0;
    border-top: 1px solid rgba(255,255,255,0.06);
  }}
  td:last-child {{ text-align: right; color: var(--gold); font-weight: 600; }}
</style>
</head>
<body>
<header>
  <div>
    <h1>Игровой атлас рыб — 27 видов</h1>
    <div class="subtitle">Карточки (игровая рамка / без рамки), прозрачные спрайты и проверенные референсы</div>
  </div>
  <div class="controls">
    <input type="search" id="search" placeholder="Поиск по названию..." />
    <div class="btn-group" id="typeFilter">
      <button class="active" data-val="all">Все (27)</button>
      <button data-val="peace">Мирная (белая)</button>
      <button data-val="pred">Хищная</button>
    </div>
    <div class="btn-group" id="viewMode">
      <button class="active" data-mode="game">Игровая</button>
      <button data-mode="clean">Без рамки</button>
      <button data-mode="art">Спрайт PNG</button>
      <button data-mode="ref">Референс</button>
    </div>
  </div>
</header>
<main id="grid"></main>
<script>
const FISH = {data_js};
const REFS = {ref_js};
let filterType = 'all';
let viewMode = 'game';
let query = '';

function imgSrc(sp) {{
  if (viewMode === 'game') return 'cards_game/' + sp.slug + '.png';
  if (viewMode === 'clean') return 'cards_clean/' + sp.slug + '.png';
  if (viewMode === 'art') return 'fish_art/' + sp.slug + '.png';
  return REFS[sp.slug];
}}

function render() {{
  const grid = document.getElementById('grid');
  const q = query.trim().toLowerCase();
  const list = FISH.filter(sp => {{
    if (filterType === 'peace' && sp.is_predator) return false;
    if (filterType === 'pred' && !sp.is_predator) return false;
    if (q && !(sp.name_ru.toLowerCase().includes(q) || sp.latin.toLowerCase().includes(q))) return false;
    return true;
  }});
  grid.innerHTML = list.map(sp => {{
    const t = sp.tiers;
    const isPred = sp.is_predator;
    return `
      <article class="card ${{isPred ? 'pred' : ''}}">
        <div class="thumb-wrap ${{viewMode === 'art' ? 'sprite-bg' : ''}}">
          <a href="${{imgSrc(sp)}}" target="_blank" rel="noopener">
            <img loading="lazy" src="${{imgSrc(sp)}}" alt="${{sp.name_ru}}" />
          </a>
        </div>
        <div class="meta">
          <div class="row-top">
            <span class="title">#${{String(sp.num).padStart(2,'0')}} ${{sp.name_ru}}</span>
            <span class="badge ${{isPred ? 'pred' : 'peace'}}">${{sp.category}}</span>
          </div>
          <div class="latin">${{sp.latin}} · ${{sp.subcategory}}</div>
          <table>
            <tr><td>Мелочь</td><td>${{t.meloch.w_label}}</td><td>${{t.meloch.l_min_cm}}–${{t.meloch.l_max_cm}} см</td></tr>
            <tr><td>Средняя</td><td>${{t.srednyaya.w_label}}</td><td>${{t.srednyaya.l_min_cm}}–${{t.srednyaya.l_max_cm}} см</td></tr>
            <tr><td>Крупная</td><td>${{t.krupnaya.w_label}}</td><td>${{t.krupnaya.l_min_cm}}–${{t.krupnaya.l_max_cm}} см</td></tr>
            <tr><td>Трофей</td><td>${{t.trofey.w_label}}</td><td>${{t.trofey.l_min_cm}}–${{t.trofey.l_max_cm}} см</td></tr>
          </table>
        </div>
      </article>
    `;
  }}).join('');
}}

document.getElementById('search').addEventListener('input', e => {{ query = e.target.value; render(); }});
document.querySelectorAll('#typeFilter button').forEach(b => b.addEventListener('click', () => {{
  document.querySelectorAll('#typeFilter button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  filterType = b.dataset.val;
  render();
}}));
document.querySelectorAll('#viewMode button').forEach(b => b.addEventListener('click', () => {{
  document.querySelectorAll('#viewMode button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  viewMode = b.dataset.mode;
  render();
}}));
render();
</script>
</body>
</html>
"""


def main():
    with open("data/fish_database.json", "r", encoding="utf-8") as f:
        species_list = json.load(f)

    html = generate_html(species_list)
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

    readme_txt = """АТЛАС ИГРОВЫХ КАРТОЧЕК РЫБ (27 ВИДОВ)
========================================

Состав архива:
1. cards_game/  — 27 готовых игровых карточек (900x1200 px, PNG) в тёмно-водном стиле
                  с золотистой/аква рамкой для мирной рыбы и медно-алой для хищной.
2. cards_clean/ — 27 упрощённых светлых карточек без рамки (900x1200 px, PNG).
3. fish_art/    — 27 детальных иллюстраций в стиле полуреалистичного мультяшного 2D-арта
                  на прозрачном фоне (RGBA PNG, все рыбы ориентированы вправо).
4. references/  — 27 проверенных биологических фото-референсов из интернета.
5. data/        — fish_database.json и fish_database.csv со всеми параметрами:
                  - Классификация: Мирная (белая) / Хищная + специализация
                  - Мелочь: от 70 г (с длиной в см от и до)
                  - Средняя: 250 – 800 г (до 800–990 г по виду)
                  - Крупная: от 1.0 кг и выше
                  - Трофей: 7.0 – 9.0..27.0 кг в зависимости от вида рыбы
                  - Внешние признаки и среда обитания
6. index.html   — интерактивный каталог для быстрого просмотра в браузере.
"""
    with open("README_PACK.txt", "w", encoding="utf-8") as f:
        f.write(readme_txt)

    zip_path = "fish_cards_pack_27.zip"
    if os.path.exists(zip_path):
        os.remove(zip_path)

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.write("index.html", "index.html")
        zf.write("README_PACK.txt", "README.txt")
        for folder in ["cards_game", "cards_clean", "fish_art", "references", "data"]:
            for fn in sorted(os.listdir(folder)):
                full = os.path.join(folder, fn)
                if os.path.isfile(full):
                    zf.write(full, f"{folder}/{fn}")

    size_mb = os.path.getsize(zip_path) / (1024 * 1024)
    print(f"Created {zip_path} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
