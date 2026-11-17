/**
 * html_scripts.mjs — вынимает JS из HTML-страницы.
 *
 * Возвращает:
 *   inline   — весь встроенный код (собранный из <script> без src);
 *   external — список src внешних скриптов;
 *   code     — то, что реально отдаётся конвертеру (inline + подключённые локальные файлы).
 *
 * Важный момент: браузерная игра часто пишет весь код в одном <script> на 300 КБ,
 * и ES-модули подключаются через <script type="module" src="/src/game.mjs">.
 * Порядок сохраняется, чтобы `import`-ы не оказались перед объявлениями.
 */

import { parseHtml, findAll } from "./html_dom.mjs";

export function extractScripts(html, { assetExists, concat = true, readFile } = {}) {
  const root = parseHtml(html);
  const scripts = findAll(root, (el) => el.tag === "script");
  const parts = [];
  const external = [];
  const modules = [];

  for (const script of scripts) {
    const src = script.attrs?.src;
    const type = (script.attrs?.type ?? "").toLowerCase();
    if (src) {
      external.push(src);
      if (type === "module") modules.push(src);
      if (!concat || !readFile) continue;
      const rel = src.replace(/^\//, "");
      if (typeof assetExists === "function" && !assetExists(rel)) continue;
      try {
        parts.push({ src: rel, code: readFile(rel) });
      } catch {
        // файл не читается — останется в списке external для отчёта
      }
      continue;
    }
    const code = script.text ?? "";
    if (code.trim()) parts.push({ src: null, code });
  }

  const code = parts
    .map((p) => (p.src ? `// ── ${p.src} ──\n${p.code}` : p.code))
    .join("\n\n");

  return { inline: parts.filter((p) => !p.src).map((p) => p.code).join("\n\n"), external, modules, code, parts };
}

/**
 * Оценка «похожести»: сколько процентов встроенного JS — это DOM-операции.
 * Нужна в отчёте, чтобы честно показать: такой код переносится не целиком.
 */
export function domHeaviness(code) {
  const total = code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).length || 1;
  const dom = (code.match(/getElementById|querySelector|innerHTML|classList|addEventListener|document\.|window\.|localStorage|canvas\.getContext/g) ?? []).length;
  return Math.round((dom / total) * 1000) / 10;
}
