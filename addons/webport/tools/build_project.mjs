#!/usr/bin/env node
/**
 * build_project.mjs — собирает Godot/Redot-проект из браузерной игры.
 *
 * Что делает (по шагам, все шаги видны в отчёте):
 *   1. читает исходники: HTML-страницы viewer/, ES-модули src/, JSON из data/, ассеты;
 *   2. HTML + CSS → сцена .tscn + карта id → путь к узлу;
 *   3. JS-модули → GDScript (скрипты-«модели», вызываются из узлов);
 *   4. data/*.json и ассеты копируются в проект с переименованием расширений;
 *   5. пишутся project.godot, главная сцена и WebportLinks-автозагрузка;
 *   6. отчёт: что перенесено 1:1, что упрощено, что требует ручной работы.
 *
 * Запуск:
 *   node addons/webport/tools/build_project.mjs --source ../game_ai_web --out ../koh_redot
 *   node addons/webport/tools/build_project.mjs --source . --out /tmp/port --serve
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, dirname, resolve, relative, extname, basename, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { extractScripts } from "../core/html_scripts.mjs";
import { convertHtml } from "../core/html_to_scene.mjs";
import { convertJs } from "../core/js_to_gd.mjs";
import { buildBindings } from "../core/dom_bindings.mjs";
import { lintGdscript, hasLinter } from "../core/gd_lint.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDON_DIR = resolve(__dirname, "..");

const TEXTURE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".bmp", ".gif"]);
const DATA_EXT = new Set([".json"]);
const COPY_EXT = new Set([".ttf", ".otf", ".wav", ".ogg", ".mp3"]);

export function parseArgs(argv) {
  const args = {
    source: ".",
    out: "webport_project",
    name: "WebPort Game",
    mainScene: "",
    serve: false,
    noCopyAssets: false,
    only: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = () => argv[++i];
    if (key === "--source") args.source = next();
    else if (key === "--out") args.out = next();
    else if (key === "--name") args.name = next();
    else if (key === "--main-scene") args.mainScene = next();
    else if (key === "--serve") args.serve = true;
    else if (key === "--no-copy-assets") args.noCopyAssets = true;
    else if (key === "--only") args.only = next();
    else if (key === "--help" || key === "-h") args.help = true;
  }
  return args;
}

// ── утилиты файловой системы ────────────────────────────────────────────────

function walk(dir, onFile, { skip = new Set([".git", "node_modules", ".venv", "__pycache__", "dist", "build"]) } = {}) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile, { skip });
    else onFile(full);
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function writeOut(outRoot, relPath, content) {
  const target = join(outRoot, relPath);
  ensureDir(dirname(target));
  writeFileSync(target, content);
  return target;
}

function copyOut(outRoot, relPath, sourcePath) {
  const target = join(outRoot, relPath);
  ensureDir(dirname(target));
  copyFileSync(sourcePath, target);
  return target;
}

function safeName(path) {
  return String(path).replace(/[^A-Za-z0-9_.-]/g, "_");
}

/** Имя узла из URL страницы: viewer/game.html → Game. */
function screenName(pagePath) {
  const base = basename(pagePath, extname(pagePath));
  const clean = base.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const pascal = clean.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return pascal || "Screen";
}

// ── основная сборка ─────────────────────────────────────────────────────────

export function buildProject(options = {}) {
  const opts = { ...parseArgs([]), ...options };
  const sourceRoot = resolve(opts.source);
  const outRoot = resolve(opts.out);
  if (!existsSync(sourceRoot)) throw new Error(`нет каталога исходников: ${sourceRoot}`);
  const outFromSource = relative(sourceRoot, outRoot);
  if (outFromSource === "" || !(outFromSource === ".." || outFromSource.startsWith(`..${sep}`)) || isAbsolute(outFromSource)) {
    throw new Error("каталог вывода должен находиться вне каталога исходников — выберите соседний каталог");
  }
  const log = opts.log ?? (() => {});
  const DEFAULT_EXCLUDE = [/\.test\./, /^examples\//, /(^|\/)server\.m?js$/, /(^|\/)serve\.m?js$/, /(^|\/)vite\.config/, /(^|\/)webpack/];
  const exclude = opts.exclude ?? DEFAULT_EXCLUDE;
  opts.exclude = exclude;
  const report = {
    source: sourceRoot,
    out: outRoot,
    screens: [],
    modules: [],
    data: [],
    assets: { copied: 0, skipped: 0, missing: 0, bytes: 0 },
    todo: [],
    warnings: [],
    excluded: [],
    lint: { available: false, errors: 0, checked: 0 },
    startedAt: new Date().toISOString(),
  };

  ensureDir(outRoot);
  ensureDir(join(outRoot, "addons/webport"));

  // 0. копируем сам плагин в проект — перенос должен быть самодостаточным
  copyDir(join(ADDON_DIR, "runtime"), join(outRoot, "addons/webport/runtime"));
  writeFileSync(join(outRoot, "addons/webport/README.md"), ADDON_README);

  // 1. собираем список файлов
  const files = [];
  walk(sourceRoot, (f) => files.push(f));
  const rel = (f) => relative(sourceRoot, f).split("\\").join("/");
  const relSet = new Set(files.map((f) => rel(f)));
  const assetExists = (p) => relSet.has(p) || existsSync(join(sourceRoot, p));

  const htmlPages = files.filter((f) => extname(f) === ".html" && !/[\\/]addons[\\/]/.test(f));
  const jsModules = files.filter((f) => [".js", ".mjs"].includes(extname(f)) && !/[\\/]addons[\\/]/.test(f));
  const jsonData = files.filter((f) => DATA_EXT.has(extname(f)) && !/[\\/]addons[\\/]/.test(f) &&
    !/[\\/]package/.test(f) && !/[\\/]assets[\\/]/.test(rel(f)));
  const mediaFiles = files.filter((f) => TEXTURE_EXT.has(extname(f)) || COPY_EXT.has(extname(f)));

  // 2. страницы → сцены
  const pageByScene = new Map();
  for (const page of htmlPages) {
    const pageRel = rel(page);
    if (opts.only && !pageRel.includes(opts.only)) continue;
    const html = readFileSync(page, "utf8");
    const sceneName = screenName(pageRel);
    const scripts = extractScripts(html, {
      assetExists,
      concat: true,
      readFile: (relPath) => readFileSync(join(sourceRoot, relPath), "utf8"),
    });
    const screenScriptRel = scripts.code.trim() ? `scripts/${sceneName}.gd` : "";

    // Scope discovered IDs to this page; sharing one global set across several
    // HTML screens creates hundreds of false "missing node" warnings.
    const dynamicIds = collectDynamicIds(`${html}\n${scripts.code}`);
    const scene = convertHtml(html, {
      assetExists,
      rootName: sceneName,
      dynamicIds,
      rootScript: screenScriptRel,
    });
    const sceneRel = `scenes/${sceneName}.tscn`;
    writeOut(outRoot, sceneRel, scene.scene);

    // 3. JS страницы → GDScript-модель экрана, подключённая к корневому узлу
    if (scripts.code.trim()) {
      if (scripts.code.length > 120000) {
        report.warnings.push({
          message: `${pageRel}: встроенный JS ${Math.round(scripts.code.length / 1024)} КБ — ` +
            `в сцене он становится скриптом-моделью; интерактив (innerHTML/обработчики) переносится вручную`,
        });
      }
      const gd = convertJs(scripts.code, {
        filename: `${pageRel}:inline`,
        classMode: true,
        baseClass: "Node",
      });
      writeOut(outRoot, screenScriptRel, gd.code + "\n" + BINDINGS_SEPARATOR + "\n" + buildBindings(scene.nodePaths));
      report.modules.push({
        source: `${pageRel}:inline`,
        target: screenScriptRel,
        lines: gd.code.split("\n").length,
        todo: gd.todo,
        warnings: gd.warnings,
        helpers: gd.helpers,
      });
      report.todo.push(...gd.todo);
      report.warnings.push(...gd.warnings);
    }

    if (scene.elementCount < 12 && scripts.code.length > 3000) {
      report.warnings.push({
        message: `${pageRel}: в HTML всего ${scene.elementCount} статических узлов, а JS — ` +
          `${Math.round(scripts.code.length / 1024)} КБ: интерфейс строится из кода (innerHTML), ` +
          `переносите его узлы вручную или через WebportLinks`,
      });
    }
    report.screens.push({
      page: pageRel,
      scene: sceneRel,
      script: screenScriptRel,
      nodes: scene.elementCount,
      cssRules: scene.cssRules,
      todo: scene.todo,
      warnings: scene.warnings,
    });
    report.todo.push(...scene.todo);
    report.warnings.push(...scene.warnings);
    pageByScene.set(sceneRel, { name: sceneName, script: screenScriptRel, page: pageRel });

    // внешние <script src>: каждый модуль тоже конвертируем (для полноты отчёта)
    for (const src of scripts.external) {
      const moduleRel = src.replace(/^\//, "");
      if (!assetExists(moduleRel)) {
        report.warnings.push({ message: `${pageRel}: внешний скрипт ${src} не найден` });
      }
    }
  }

  // 4. отдельные ES-модули src/ → scripts/<name>.gd
  const convertedModules = new Map();
  for (const module of jsModules) {
    const moduleRel = rel(module);
    if (!/[\\/]src[\\/]/.test(moduleRel) && !/\.mjs$/.test(moduleRel)) continue;
    // серверные файлы и тесты не переносятся: они вне игрового клиента
    if (opts.exclude && opts.exclude.some((re) => re.test(moduleRel))) {
      report.excluded.push(moduleRel);
      continue;
    }
    if (convertedModules.has(moduleRel)) continue;
    const gd = convertJs(readFileSync(module, "utf8"), {
      filename: moduleRel,
      classMode: true,
      baseClass: "RefCounted",
    });
    const target = `webport/src/${basename(moduleRel, extname(moduleRel))}.gd`;
    writeOut(outRoot, target, gd.code);
    convertedModules.set(moduleRel, target);
    report.modules.push({
      source: moduleRel,
      target,
      lines: gd.code.split("\n").length,
      todo: gd.todo,
      warnings: gd.warnings,
      helpers: gd.helpers,
    });
    report.todo.push(...gd.todo);
    report.warnings.push(...gd.warnings);
  }

  // 5. данные
  for (const file of jsonData) {
    const moduleRel = rel(file);
    if (/package(-lock)?\.json$/.test(moduleRel)) continue;
    const bytes = statSync(file).size;
    copyOut(outRoot, moduleRel, file);
    report.data.push({ source: moduleRel, target: moduleRel, bytes });
  }

  // 6. ассеты
  if (!opts.noCopyAssets) {
    for (const file of mediaFiles) {
      const moduleRel = rel(file);
      const bytes = statSync(file).size;
      copyOut(outRoot, moduleRel, file);
      report.assets.copied += 1;
      report.assets.bytes += bytes;
    }
  }

  // 7. project.godot и главная сцена
  const mainScene = pickMainScene(report.screens, opts.mainScene);
  const existingProject = join(outRoot, "project.godot");
  const autoloads = collectAutoloads(outRoot);
  const projectText = renderProjectGodot({
    name: opts.name,
    mainScene: mainScene?.scene,
    autoloads: ["WebportLinks", ...autoloads],
  });
  writeFileSync(existingProject, projectText);

  // связка «id из HTML → путь к узлу Godot» для скриптов и ручной отладки
  const links = {};
  for (const screen of report.screens) {
    // повторный разбор нужен, чтобы получить nodePaths (в сцену они не пишутся)
    const html = readFileSync(join(sourceRoot, screen.page), "utf8");
    const scene = convertHtml(html, { assetExists, rootName: screenName(screen.page) });
    links[screen.scene] = Object.fromEntries(scene.nodePaths);
  }
  writeOut(outRoot, "webport/dom_links.json", JSON.stringify(links, null, 2) + "\n");

  // 8. линт GDScript (если установлен gdtoolkit)
  if (hasLinter()) {
    report.lint.available = true;
    for (const module of report.modules) {
      const result = lintGdscript(join(outRoot, module.target));
      report.lint.checked += 1;
      if (!result.ok) {
        report.lint.errors += 1;
        module.lintErrors = result.errors;
        for (const err of result.errors) {
          report.todo.push({ message: `GDScript не компилируется: ${module.target}:${err.split("\n")[0]}`, file: module.target });
        }
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  report.summary = summarise(report);
  writeOut(outRoot, "webport/REPORT.md", renderReport(report));
  writeOut(outRoot, "webport/report.json", JSON.stringify(report, null, 2) + "\n");
  log(`готово: ${outRoot}`);
  return { report, outRoot };
}

const ADDON_README = `# WebPort (addon в составе проекта)

Этот каталог — часть перенесённого проекта. Он нужен, чтобы проект оставался
самодостаточным и открывался в Redot без исходного веб-каталога.

- \`runtime/webport_runtime.gd\` — аналоги JS-функций (map/filter/typeof/compare…).
- \`runtime/webport_links.gd\` — автозагрузка «id из HTML → путь к узлу».
- \`webport/dom_links.json\` — таблица соответствия id и узлов.

Пересобрать проект можно из репозитория плагина:
\`node addons/webport/tools/build_project.mjs --source <веб-игра> --out <этот проект>\`.
`;

const BINDINGS_SEPARATOR = "# ── связка DOM → узлы Godot (генерируется WebPort) ──";

function collectDynamicIds(source) {
  const ids = new Set();
  // Dynamic HTML templates often introduce IDs which do not exist in the
  // original DOM tree. Discover literal id attributes throughout the page
  // source so convertHtml can report each generated node that needs a manual
  // scene counterpart, rather than silently omitting it from the binding map.
  const idAttribute = /(?:^|[\s<])id\s*=\s*([\"\'])([A-Za-z0-9_-]+)\1/g;
  let match;
  while ((match = idAttribute.exec(source))) ids.add(match[2]);
  const innerHtmlTarget = /\$\(\s*([\"\'])([A-Za-z0-9_-]+)\1\s*\)\s*\.innerHTML|getElementById\(\s*([\"\'])([A-Za-z0-9_-]+)\3\s*\)\s*\.innerHTML/g;
  while ((match = innerHtmlTarget.exec(source))) ids.add(match[2] ?? match[4]);
  return ids;
}
function collectAutoloads(outRoot) {
  const hooks = join(outRoot, "webport", "autoloads.txt");
  if (!existsSync(hooks)) return [];
  return readFileSync(hooks, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function pickMainScene(screens, preferred) {
  if (preferred) {
    const match = screens.find((s) => s.scene === preferred || s.page === preferred);
    if (match) return match;
  }
  const game = screens.find((s) => /(^|\/)game\.html$/.test(s.page));
  return game ?? screens[0];
}

function renderProjectGodot({ name, mainScene, autoloads }) {
  const lines = [
    "; Проект собран WebPort из браузерной игры.",
    "; Ориентир: Redot 26.x LTS (совместим с Godot 4.5, config_version=5).",
    "config_version=5",
    "",
    "[application]",
    "",
    `config/name="${name.replace(/"/g, "'")}"`,
    mainScene ? `run/main_scene="res://${mainScene}"` : "run/main_scene=\"\"",
    "config/features=PackedStringArray(\"4.5\", \"GL Compatibility\")",
    "",
    "[autoload]",
    "",
    ...autoloads.map((a) => {
      const [alias, path] = a.includes("=") ? a.split("=") : [a, `res://webport/${a}.gd`];
      return `${alias}="*${path}"`;
    }),
    "",
    "[display]",
    "",
    "window/size/viewport_width=1280",
    "window/size/viewport_height=720",
    "window/stretch/mode=\"canvas_items\"",
    "window/stretch/aspect=\"expand\"",
    "",
    "[rendering]",
    "",
    "renderer/rendering_method=\"gl_compatibility\"",
    "renderer/rendering_method.mobile=\"gl_compatibility\"",
    "textures/canvas_textures/default_texture_filter=1",
    "",
    "[input_devices]",
    "",
    "pointing/emulate_touch_from_mouse=false",
    "",
  ];
  return lines.join("\n");
}

function summarise(report) {
  const manual = report.todo.filter((t) => /вручную|TODO|не поддерж|перепишите|замените/.test(t.message)).length;
  return {
    screens: report.screens.length,
    modules: report.modules.length,
    gdLines: report.modules.reduce((sum, m) => sum + (m.lines ?? 0), 0),
    dataFiles: report.data.length,
    assetsCopied: report.assets.copied,
    assetsMB: Math.round((report.assets.bytes / 1048576) * 10) / 10,
    todo: report.todo.length,
    manual,
    warnings: report.warnings.length,
    lintErrors: report.lint.errors,
  };
}

export function renderReport(report) {
  const s = report.summary;
  const lines = [];
  lines.push("# Отчёт переноса в Redot", "");
  lines.push(`Источник: \`${report.source}\``);
  lines.push(`Проект: \`${report.out}\``);
  lines.push(`Собрано: ${report.startedAt}`, "");
  lines.push("## Итог", "");
  lines.push("| Показатель | Значение |", "|---|---|");
  lines.push(`| Экранов (HTML → сцена) | ${s.screens} |`);
  lines.push(`| JS-модулей → GDScript | ${s.modules} |`);
  lines.push(`| Строк GDScript | ${s.gdLines} |`);
  lines.push(`| JSON-данных скопировано | ${s.dataFiles} |`);
  lines.push(`| Ассетов скопировано | ${s.assetsCopied} (${s.assetsMB} МБ) |`);
  lines.push(`| Замечаний всего | ${s.todo} |`);
  lines.push(`| Из них требуют ручной работы | ${s.manual} |`);
  lines.push(`| Ошибок линтера GDScript | ${s.lintErrors} |`);
  lines.push("");

  lines.push("## Экраны", "");
  lines.push("| Страница | Сцена | Узлов | CSS-правил | Замечаний |", "|---|---|---|---|---|");
  for (const sc of report.screens) {
    lines.push(`| ${sc.page} | \`${sc.scene}\` | ${sc.nodes} | ${sc.cssRules} | ${sc.todo.length + sc.warnings.length} |`);
  }
  lines.push("");

  lines.push("## JS → GDScript", "");
  lines.push("| Модуль | Файл | Строк | TODO | Предупреждений |", "|---|---|---|---|---|");
  for (const m of report.modules) {
    lines.push(`| ${m.source} | \`${m.target}\` | ${m.lines} | ${m.todo.length} | ${m.warnings.length} |`);
  }
  lines.push("");

  if (report.todo.length) {
    lines.push("## Что требует внимания", "");
    const byFile = new Map();
    for (const t of report.todo) {
      const key = t.file ?? "(сцена)";
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key).push(t);
    }
    for (const [file, items] of byFile) {
      lines.push(`### ${file}`, "");
      for (const item of items.slice(0, 40)) {
        lines.push(`- ${item.line ? `строка ${item.line}: ` : ""}${item.message}`);
      }
      if (items.length > 40) lines.push(`- …ещё ${items.length - 40}`);
      lines.push("");
    }
  }

  if (report.warnings.length) {
    lines.push("## Предупреждения (перенесено, но проверьте)", "");
    for (const w of report.warnings.slice(0, 60)) {
      lines.push(`- ${w.line ? `строка ${w.line}: ` : ""}${w.message}`);
    }
    if (report.warnings.length > 60) lines.push(`- …ещё ${report.warnings.length - 60}`);
    lines.push("");
  }

  lines.push("## Как проверить", "");
  lines.push("```bash", `# из каталога проекта`, `redot --headless --quit --path ${report.out}`, "```");
  lines.push("");
  lines.push("Если движок пишет об ошибке сцены — начните с файла `webport/report.json`:");
  lines.push("там те же замечания в машиночитаемом виде.");
  return lines.join("\n") + "\n";
}

function copyDir(from, to) {
  if (!existsSync(from)) return;
  ensureDir(to);
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`WebPort — перенос браузерной игры в Redot/Godot

  node addons/webport/tools/build_project.mjs --source <веб-игра> --out <проект Redot> [--name "Имя"]

Опции:
  --source <dir>      каталог веб-игры (viewer/, src/, data/, assets/)
  --out <dir>         каталог будущего проекта Redot (создаётся)
  --name "..."        имя проекта в окне движка
  --main-scene <file> главная сцена (по умолчанию viewer/game.html)
  --only <подстрока>  выбрать HTML-экраны; модули/данные/ассеты остаются общими
  --no-copy-assets    не копировать картинки/звук
  --serve             после сборки поднять сервер проверки (tools/serve.mjs)
`);
    process.exit(0);
  }
  const { report } = buildProject(args);
  const s = report.summary;
  console.log(`Экранов: ${s.screens}, модулей: ${s.modules}, GDScript: ${s.gdLines} строк`);
  console.log(`Ассетов: ${s.assetsCopied} (${s.assetsMB} МБ), данных: ${s.dataFiles}`);
  console.log(`Замечаний: ${s.todo} (ручных: ${s.manual}), предупреждений: ${s.warnings}`);
  if (report.lint.available) console.log(`Линтер GDScript: проверено ${report.lint.checked}, ошибок ${report.lint.errors}`);
  console.log(`Отчёт: ${join(report.out, "webport", "REPORT.md")}`);
  if (args.serve) {
    import("./serve.mjs").then((m) => m.startServer({ project: report.out, port: 8123 }));
  }
}
