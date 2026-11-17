#!/usr/bin/env node
/**
 * run_tests.mjs — проверки плагина без движка Redot.
 *
 * Запуск: node addons/webport/tests/run_tests.mjs
 * Требуется: node + (опционально) gdparse из gdtoolkit — тогда же проверяется
 * синтаксис сгенерированного GDScript.
 */

import { convertJs } from "../core/js_to_gd.mjs";
import { parseHtml, summarize, collectIds } from "../core/html_dom.mjs";
import { convertHtml, parseCss } from "../core/html_to_scene.mjs";
import { lintGdscript, hasLinter } from "../core/gd_lint.mjs";
import { extractScripts } from "../core/html_scripts.mjs";
import { buildProject } from "../tools/build_project.mjs";
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, error: err });
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

function eq(actual, expected, what = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
  }
}

function includes(code, needle) {
  if (!code.includes(needle)) throw new Error(`в коде нет «${needle}»\n---\n${code.slice(0, 700)}`);
}

const tmp = mkdtempSync(join(tmpdir(), "webport-tests-"));
const gdFile = (code, name = "t.gd") => {
  const path = join(tmp, name);
  writeFileSync(path, code);
  return path;
};

console.log("JS → GDScript");

check("функция и локальные var", () => {
  const r = convertJs("export function add(a, b) { const c = a + b; return c; }", { filename: "t.mjs" });
  includes(r.code, "static func add(a, b):");
  includes(r.code, "var c := a + b");
  includes(r.code, "return c");
  eq(r.todo.length, 0, "todo");
});

check("const только для литералов", () => {
  const r = convertJs("const A = 1;\nconst B = a + 1;\nconst C = [1, 2];", { filename: "t.mjs" });
  includes(r.code, "const A := 1");
  includes(r.code, "var B := a + 1");
  includes(r.code, "const C := [1, 2]");
});

check("Math/Object/JSON → встроенные аналоги", () => {
  const r = convertJs("function f(x){ return Math.max(0, Math.min(9, Math.floor(x))) + Object.keys(x).length; }", { filename: "t.mjs" });
  includes(r.code, "max(0, min(9, floor(x)))");
  includes(r.code, ".size()");
  includes(r.code, "keys(x)");
  eq(r.todo.length, 0, "todo");
});

check("|| и && сохраняют значение операнда", () => {
  // строки и числа: значение операнда, а не bool
  const r = convertJs("function f(a, b){ return a || b; }", { filename: "t.mjs" });
  includes(r.code, "a or b");
  // member-выражение: значение сохраняется через тернарник
  const r3 = convertJs("function f(u, d){ return u.title || d; }", { filename: "t.mjs" });
  includes(r3.code, "(u.title if u.title else d)");
  const r2 = convertJs("function f(flag, value){ return flag && value; }", { filename: "t.mjs" });
  includes(r2.code, "flag and value");
});

check("для сравнений используется or/and", () => {
  const r = convertJs("function f(a){ return a > 1 || a < 0; }", { filename: "t.mjs" });
  includes(r.code, "a > 1 or a < 0");
});

check("массивы: map/filter/sort/reduce/includes", () => {
  const r = convertJs(
    "function f(xs){ const a = xs.filter(v => v > 0).map(v => v * 2);" +
    " xs.sort((a, b) => a - b); return a.includes(2) || xs.length; }", { filename: "t.mjs" });
  includes(r.code, "WebportRuntime.filter(xs");
  includes(r.code, "sort_custom(");
  includes(r.code, "(2 in a)");
});

check("for...of по массиву и Dictionary", () => {
  const r = convertJs("function f(xs){ const total = {};\n for (const x of xs) { total[x] = 1; }\n return total; }", { filename: "t.mjs" });
  includes(r.code, "for x in xs:");
  eq(r.todo.length, 0, "todo");
});

check("классический for → range()", () => {
  const r = convertJs("function f(n){ const s = 0;\n for (let i = 0; i < n; i += 1) { log(i); }\n return s; }", { filename: "t.mjs" });
  includes(r.code, "for i in n:");
});

check("for с && в условии → while", () => {
  const r = convertJs("function f(n, ok){ for (let i = 0; i < n && ok; i += 1) { log(i); } }", { filename: "t.mjs" });
  includes(r.code, "while i < n and ok:");
});

check("деструктуризация параметра", () => {
  const r = convertJs("export function f({a, b}) { return a + b; }", { filename: "t.mjs" });
  includes(r.code, 'var a = p_a_src["a"]');
});

check("тернарник со скобками", () => {
  const r = convertJs("function f(c){ return c ? 1 : 2; }", { filename: "t.mjs" });
  includes(r.code, "(1 if c else 2)");
});

check("опциональная цепочка", () => {
  const r = convertJs("function f(a){ return a?.b?.c; }", { filename: "t.mjs" });
  includes(r.code, "!= null else null");
});

check("try/catch не ломает отступы", () => {
  const r = convertJs(
    "function f(xs){ for (const x of xs) { try { log(x); } catch (e) { warn(e); } } }", { filename: "t.mjs" });
  const path = gdFile(r.code);
  if (hasLinter()) eq(lintGdscript(path).ok, true, "lint");
});

check("setTimeout/fetch помечаются в отчёте", () => {
  const r = convertJs("function f(){ setTimeout(() => {}, 10); fetch('/data.json'); }", { filename: "t.mjs" });
  eq(r.todo.length >= 1, true, "есть TODO");
});

check("уникальные имена вынесенных лямбд", () => {
  const r = convertJs(
    "function f(a, b){ return a.some(v => { if (!v) return false; return v > 0; }) && b.some(v => { if (!v) return false; return v < 0; }); }",
    { filename: "t.mjs" });
  const names = [...r.code.matchAll(/func (webport_top_level|_wb_lambda_\d+)/g)].map((m) => m[1]);
  eq(new Set(names).size, names.length, "уникальность имён");
});

check("импорт → preload", () => {
  const r = convertJs("import { step } from './battle_simulation.mjs';\nexport function f(){ return step(1); }", { filename: "t.mjs" });
  includes(r.code, 'const battle_simulation := preload("res://webport/src/battle_simulation.gd")');
  includes(r.code, "battle_simulation.step(1)");
});

check("sync-модуль без функций: код верхнего уровня → webport_top_level", () => {
  const r = convertJs("const x = loadData();\n\nwindow.addEventListener('load', () => {});", { filename: "t.mjs" });
  includes(r.code, "func webport_top_level():");
});

check("IIFE остаётся явным TODO, а не превращается в вызов null()", () => {
  const r = convertJs("(() => { document.title = 'game'; })();", { filename: "inline.mjs" });
  includes(r.code, "pass  # TODO(webport): немедленно вызываемая функция (IIFE)");
  eq(r.code.includes("null()"), false, "нет ошибочного вызова null");
  eq(r.todo.some((item) => item.message.includes("IIFE")), true, "IIFE отражена в TODO");
});

check("приоритет операторов: скобки расставлены по правилам GDScript", () => {
  includes(convertJs("function f(a,b){ return (a + 1) % b; }", { filename: "t.mjs" }).code, "(a + 1) % b");
  includes(convertJs("function f(a,b,c){ return a - (b - c); }", { filename: "t.mjs" }).code, "a - (b - c)");
  includes(convertJs("function f(a,b,c){ return a + b * 2; }", { filename: "t.mjs" }).code, "a + b * 2");
});

check("деление всегда даёт float (JS-семантика)", () => {
  const r = convertJs("function f(a,b){ return a / b; }", { filename: "t.mjs" });
  includes(r.code, "WebportRuntime.div(a, b)");
});

check("spread в объекте сохраняет порядок перекрытия", () => {
  const r = convertJs("function f(state){ return { ...state, gold: 1 }; }", { filename: "t.mjs" });
  includes(r.code, 'WebportRuntime.merge({}, state, {"gold": 1})');
});

console.log("HTML → сцена");

check("теги → узлы с путями", () => {
  const res = convertHtml('<html><body><div id="root"><button id="ok" disabled>Готово</button></div></body></html>', {});
  includes(res.scene, '[node name="Root"');
  includes(res.scene, '[node name="Ok" type="Button" parent="GameRoot/Root"]');
  includes(res.scene, 'text = "Готово"');
  includes(res.scene, "disabled = true");
  eq(res.nodePaths.get("ok"), "Ok", "путь по id");
});

check("canvas получает контейнер и SubViewport, а JS-рисование — TODO", () => {
  const res = convertHtml('<html><body><canvas id="world" width="640" height="360"></canvas></body></html>', {});
  includes(res.scene, '[node name="World" type="SubViewportContainer"');
  includes(res.scene, 'stretch = true');
  includes(res.scene, '[node name="CanvasViewport" type="SubViewport" parent="GameRoot/World"]');
  includes(res.scene, "size = Vector2i(640, 360)");
  eq(res.todo.some((item) => item.message.includes("#world") && item.message.includes("JavaScript-рисование")), true);
});

check("скрипт экрана подключается к корневому узлу сцены", () => {
  const res = convertHtml('<html><body><div id="game">Игра</div></body></html>', {
    rootName: "Game",
    rootScript: "scripts/Game.gd",
  });
  includes(res.scene, '[ext_resource type="Script" path="res://scripts/Game.gd"');
  includes(res.scene, 'script = ExtResource("1_Game.gd")');
});

check("вложенные id собираются в таблицу", () => {
  const html = '<html><body><section id="a"><div id="b"><span id="c">x</span></div></section></body></html>';
  const res = convertHtml(html, {});
  eq([...res.nodePaths.keys()].sort(), ["a", "b", "c"]);
});

check("CSS: размеры, цвет, фон, скругление", () => {
  const html = `<html><head><style>
    #panel { width: 240px; height: 80px; background-color: #202020; border-radius: 8px; border: 1px solid #c8a35c; }
    .title { font-size: 18px; color: rgba(240, 215, 164, 1); }
  </style></head><body><div id="panel"><div class="title">Корона</div></div></body></html>`;
  const res = convertHtml(html, {});
  includes(res.scene, "custom_minimum_size = Vector2(240, 80)");
  includes(res.scene, "StyleBoxFlat");
  includes(res.scene, "bg_color = Color(0.125, 0.125, 0.125, 1)");
  includes(res.scene, "theme_override_font_sizes/font_size = 18");
});

check("CSS: flex и grid превращаются в контейнеры", () => {
  const html = `<html><head><style>
    .row { display: flex; flex-direction: row; gap: 8px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  </style></head><body><div class="row"><button>1</button></div><div class="grid"><div>a</div></div></body></html>`;
  const res = convertHtml(html, {});
  includes(res.scene, 'type="HBoxContainer"');
  includes(res.scene, 'type="GridContainer"');
  includes(res.scene, "columns = 3");
});

check("селекторы с псевдоклассами не ломают каскад", () => {
  const rules = parseCss(".a:hover{color:#fff}.a{color:#000}");
  eq(rules.length, 2);
  const html = '<html><head><style>.a:hover{color:#fff}.a{color:#000}</style></head>' +
    '<body><div class="a">x</div></body></html>';
  const res = convertHtml(html, {});
  includes(res.scene, "Color(0, 0, 0, 1)");
});

check("картинки: существующие ассеты → ext_resource, отсутствующие → TODO", () => {
  const html = '<html><body><img src="/assets/ui/ok.png"><img src="/assets/ui/missing.png"></body></html>';
  const res = convertHtml(html, { assetExists: (p) => p === "assets/ui/ok.png" });
  includes(res.scene, 'path="res://assets/ui/ok.png"');
  eq(res.todo.some((t) => t.message.includes("missing.png")), true, "TODO об отсутствующем ассете");
});

check("HTML большой страницы парсится за разумное время", () => {
  const src = readFileSync(new URL("../../../viewer/game.html", import.meta.url), "utf8");
  const t0 = Date.now();
  const res = convertHtml(src, {});
  const elapsed = Date.now() - t0;
  if (elapsed > 5000) throw new Error(`слишком долго: ${elapsed} мс`);
  const summary = summarize(parseHtml(src));
  if (summary.count < 50) throw new Error(`слишком мало элементов в исходнике: ${summary.count}`);
  if (!res.scene.includes("[node name=")) throw new Error("сцена не собрана");
});

check("скрипты с угловыми скобками не обрезаются HTML-парсером", () => {
  const src = readFileSync(new URL("../../../viewer/game.html", import.meta.url), "utf8");
  const scripts = extractScripts(src);
  if (scripts.code.length < 200000 || !scripts.code.includes("if(state.food")) {
    throw new Error(`встроенный скрипт неожиданно обрезан: ${scripts.code.length} символов`);
  }
});

check("статические id связаны, динамические id отмечены для ручной сцены", () => {
  const src = readFileSync(new URL("../../../viewer/game.html", import.meta.url), "utf8");
  const staticIds = collectIds(parseHtml(src));
  const scene = convertHtml(src, {});
  eq(scene.nodePaths.size, staticIds.size, "карта статических id");
  const scripts = extractScripts(src).code;
  const dynamicIds = new Set([...scripts.matchAll(/\bid\s*=\s*['\"]([A-Za-z0-9_-]+)['\"]/g)].map((m) => m[1]));
  const missing = [...dynamicIds].filter((id) => !staticIds.has(id));
  const res = convertHtml(src, { dynamicIds });
  for (const id of missing) {
    if (!res.warnings.some((warning) => warning.message.includes(`#${id}`))) {
      throw new Error(`динамический узел #${id} не внесён в предупреждения`);
    }
  }
  if (missing.length === 0) throw new Error("ожидались HTML-узлы, создаваемые игровым JavaScript");
});

check("--only фильтрует HTML-экраны, но сохраняет модули, данные и ассеты", () => {
  const source = join(tmp, "build-fixture");
  const out = join(tmp, "build-fixture-out");
  mkdirSync(join(source, "src"), { recursive: true });
  mkdirSync(join(source, "assets"), { recursive: true });
  mkdirSync(join(source, "data"), { recursive: true });
  writeFileSync(join(source, "index.html"), '<html><body><button id="go">Go</button></body></html>');
  writeFileSync(join(source, "other.html"), '<html><body><div id="other">Other</div></body></html>');
  writeFileSync(join(source, "src", "logic.mjs"), "export function add(a, b) { return a + b; }");
  writeFileSync(join(source, "assets", "pixel.png"), Buffer.from([1, 2, 3]));
  writeFileSync(join(source, "data", "game.json"), '{"ok":true}');
  const { report } = buildProject({ source, out, only: "index.html", log: () => {} });
  eq(report.screens.length, 1, "экранов");
  eq(report.screens[0].page, "index.html", "выбранная страница");
  eq(report.modules.some((module) => module.source === "src/logic.mjs"), true, "ES-модуль сохранён");
  eq(report.assets.copied, 1, "ассеты сохранены");
  eq(report.data.length, 1, "JSON сохранён");
  eq(existsSync(join(out, "assets", "pixel.png")), true, "файл ассета скопирован");
  let refusedNestedOutput = false;
  try {
    buildProject({ source, out: join(source, "generated"), only: "index.html", log: () => {} });
  } catch (error) {
    refusedNestedOutput = error.message.includes("вне каталога исходников");
  }
  eq(refusedNestedOutput, true, "опасная вложенная сборка отклонена");
  eq(existsSync(join(source, "generated")), false, "исходники не изменены");
});

console.log("GDScript-линт сгенерированного кода");

check("многострочные блоки проходят gdparse", () => {
  if (!hasLinter()) { console.log("       (gdparse не установлен — проверка пропущена)"); return; }
  const r = convertJs(`
    export function step(state, units) {
      const next = state;
      for (const unit of units) {
        if (unit.hp <= 0 || ['routed', 'withdrawn'].includes(unit.state)) continue;
        const target = units.find((u) => u.side !== unit.side);
        if (!target) continue;
        const dist = Math.hypot(target.x - unit.x, target.y - unit.y);
        next.log.push({ from: unit.id, to: target.id, dist });
      }
      return next;
    }`, { filename: "t.mjs" });
  const result = lintGdscript(gdFile(r.code));
  eq(result.ok, true, `lint: ${result.errors?.[0] ?? ""}`);
});

check("runtime-хелперы компилируются", () => {
  if (!hasLinter()) return;
  const runtime = new URL("../runtime/webport_runtime.gd", import.meta.url).pathname;
  if (!existsSync(runtime)) throw new Error("нет runtime/webport_runtime.gd");
  eq(lintGdscript(runtime).ok, true, "lint runtime");
});

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} проверок пройдено, ${failures.length} провалено`);
if (failures.length) {
  for (const f of failures) console.log(`\n${f.name}\n${f.error.stack}`);
  process.exit(1);
}
