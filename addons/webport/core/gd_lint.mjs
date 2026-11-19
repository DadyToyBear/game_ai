/**
 * gd_lint.mjs — проверка синтаксиса сгенерированного GDScript.
 *
 * Использует gdtoolkit (pip install gdtoolkit), если он есть в PATH.
 * Если линтера нет — сборка не падает: в отчёте честно пишется
 * «синтаксис не проверялся», а не «всё хорошо».
 *
 * Проверка нужна именно потому, что GDScript не прощает: смешение табов и
 * пробелов, `const` с неконстантным выражением, висячий `else` — всё это
 * ошибки парсинга, которые видно только при открытии проекта в движке.
 */

import { execFileSync } from "node:child_process";

let cached = null;

export function hasLinter() {
  if (cached != null) return cached;
  try {
    execFileSync("gdparse", ["--version"], { stdio: "pipe" });
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

export function lintGdscript(filePath) {
  if (!hasLinter()) return { ok: true, errors: [], skipped: true };
  try {
    execFileSync("gdparse", [filePath], { stdio: "pipe" });
    return { ok: true, errors: [] };
  } catch (err) {
    const message = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    return { ok: false, errors: [message || `парсер вернул код ${err.status}`] };
  }
}

export function lintSource(source, { tmpFile } = {}) {
  if (!hasLinter() || !tmpFile) return { ok: true, errors: [], skipped: true };
  return lintGdscript(tmpFile);
}
