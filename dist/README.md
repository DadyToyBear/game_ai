# Архив с ассетами

`crown_and_banner_assets.zip` — все сгенерированные ассеты, превью и скрипты
обработки одним файлом.

**Размер:** 51 138 650 байт (≈48,8 МБ), 98 файлов.
**Шифрование:** AES-256 (pyzipper). Пароль в репозитории не хранится —
передаётся отдельно от архива.

## Как скачать

Прямая ссылка (ветка `arena/884c3d81-game-ai`):

```
https://raw.githubusercontent.com/DadyToyBear/game_ai/arena/884c3d81-game-ai/dist/crown_and_banner_assets.zip
```

Или через git:

```bash
git clone --branch arena/884c3d81-game-ai https://github.com/DadyToyBear/game_ai.git
cd game_ai/dist
```

## Как распаковать

Архив открывается 7-Zip, WinRAR, Keka, а также из Python:

```python
import pyzipper
with pyzipper.AESZipFile("crown_and_banner_assets.zip") as zf:
    zf.setpassword(b"<пароль>")
    zf.extractall("assets_out")
```

## Что внутри

| Путь | Содержимое |
|---|---|
| `assets/units/cards/` | 10 карточек войск, 512×512, RGBA |
| `assets/ui/battle/` | панель боя, лист кнопок и `buttons/` (6 отдельных), `icons/` (15 штук 128×128), плашка раунда, рамка полосы численности |
| `assets/battle_scenarios/` | 4 фона поля боя, `battle_tiles.png` и `tiles/` (8 тайлов 128×128) |
| `assets/animations/01_celtic_briton/` | спрайт-листы ходьбы 5 классов + `.json` с размерами кадра |
| `assets/events/` | обложка Кодекса, смотр войск, стена после штурма |
| `assets/SHOWCASE.html` | витрина всех ассетов (открывать в браузере) |
| `assets/README_assets.md` | таблица «что где лежит» |
| `tools/` | скрипты обработки: карточки, иконки, тайлы, спрайты, витрина, архив |
| `preview_walk/*.gif` | анимация цикла ходьбы |
| `preview_*.jpg` | контактные листы для быстрого просмотра |

## Как пересобрать архив

```bash
CROWN_ARCHIVE_PASSWORD='<пароль>' python3 tools/make_release_archive.py --out dist
```

Скрипт не сохраняет пароль ни в файл, ни в историю git.
