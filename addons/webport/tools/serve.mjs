#!/usr/bin/env node
/**
 * serve.mjs — проверка перенесённого проекта без движка.
 *
 * Поднимает сервер с тремя страницами:
 *   /            — сравнение «HTML-скриншот» и список узлов Godot-сцены;
 *   /scene/<имя> — дерево узлов из .tscn + подсветка потерь из report.json;
 *   /report      — отчёт в человекочитаемом виде.
 *
 * Зачем: полный запуск Redot требует движка и видеокарты, а проверить
 * структуру сцены, пути ассетов и отчёт нужно сразу после сборки.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
};

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>WebPort — проверка переноса</title>
<style>
 body{margin:0;background:#15171a;color:#e8e2d4;font:14px/1.5 system-ui,sans-serif}
 header{padding:14px 18px;background:#1f2326;border-bottom:1px solid #333a3d}
 h1{margin:0;font:600 17px Georgia,serif;color:#e9c98a}
 .wrap{display:grid;grid-template-columns:340px 1fr;min-height:calc(100vh - 58px)}
 aside{background:#1a1d20;border-right:1px solid #2c3235;padding:12px}
 main{padding:16px 18px;overflow:auto}
 .row{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #262c2f;font-size:12px}
 .ok{color:#9dc46f}.warn{color:#e0b866}.bad{color:#df8074}
 pre{background:#101315;padding:10px;border-radius:6px;overflow:auto;font-size:12px;border:1px solid #262c2f}
 a{color:#c9b184}
 .stat{display:inline-block;margin:0 12px 8px 0;font-size:13px}
 .bar{height:8px;background:#2a3033;border-radius:4px;overflow:hidden;margin-top:4px}
 .bar i{display:block;height:100%;background:linear-gradient(90deg,#6f8f4f,#c9a45e)}
 .n{position:relative;box-sizing:border-box;font:12px/1.3 system-ui,sans-serif;color:#e8e2d4;margin:2px 0}
 .n i{display:block;font:9px/1 ui-monospace,monospace;color:#9aa4ad;opacity:.75;font-style:normal;margin-bottom:2px}
 button.n{color:inherit;cursor:default}
</style></head><body>
<header><h1>WebPort — проверка переноса в Redot</h1></header>
<div class="wrap"><aside id="side"></aside><main id="main"></main></div>
<script>
const P = __PAYLOAD__;
document.getElementById('side').innerHTML = P.screens.map(s =>
  '<div class="row"><a href="#" data-s="' + s.scene + '">' + s.page + '</a><span class="warn">' + s.nodes + ' узлов</span></div>').join('')
  + '<div class="row"><a href="#" data-s="__report">report.json</a><span class="ok">' + P.todo + ' todo</span></div>';
document.getElementById('main').innerHTML = P.html;
document.querySelectorAll('[data-s]').forEach(el => el.onclick = async (e) => {
  e.preventDefault();
  const r = await fetch('/data?s=' + encodeURIComponent(el.dataset.s));
  document.getElementById('main').innerHTML = await r.text();
  bindPreview();
});
function bindPreview(){
  document.querySelectorAll('[data-p]').forEach(el => el.onclick = async (e) => {
    e.preventDefault();
    const r = await fetch('/preview?s=' + encodeURIComponent(el.dataset.p));
    document.getElementById('main').innerHTML = await r.text();
    bindPreview();
  });
}
bindPreview();
</script></body></html>`;

export function startServer({ project, port = 8123 }) {
  const root = resolve(project);
  const reportPath = join(root, "webport", "report.json");

  const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const report = readJson(reportPath, { screens: [], modules: [], todo: [], summary: {} });

    if (url.pathname === "/preview") {
      const scene = url.searchParams.get("s") ?? "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(previewHtml(root, report, scene));
      return;
    }

    if (url.pathname === "/data") {
      const want = url.searchParams.get("s") ?? "";
      const body = want === "__report" ? reportHtml(report) : sceneHtml(root, report, want);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const payload = {
        screens: report.screens ?? [],
        todo: (report.todo ?? []).length,
        html: overviewHtml(report),
      };
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE.replace("__PAYLOAD__", JSON.stringify(payload)));
      return;
    }

    const file = join(root, url.pathname);
    if (existsSync(file) && !readdirSync(root).every((d) => d !== "")) {
      try {
        const data = readFileSync(file);
        res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(data);
        return;
      } catch {
        // каталог — падаем в 404
      }
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("не найдено");
  });

  return new Promise((done) => {
    server.listen(port, "0.0.0.0", () => {
      console.log(`проверка переноса: http://0.0.0.0:${port}/`);
      done(server);
    });
  });
}

function overviewHtml(report) {
  const s = report.summary ?? {};
  const stats = [
    ["Экранов", s.screens], ["JS-модулей", s.modules], ["Строк GDScript", s.gdLines],
    ["Ассетов", `${s.assetsCopied} (${s.assetsMB} МБ)`], ["Данных", s.dataFiles],
    ["Требует внимания", s.manual], ["Ошибок линтера", s.lintErrors],
  ];
  const rows = stats.map(([k, v]) => `<span class="stat">${k}: <b>${v ?? 0}</b></span>`).join("");
  const total = Math.max(1, (s.modules ?? 1));
  const quality = Math.round(((total - (s.lintErrors ?? 0)) / total) * 100);
  return `<h2 style="font:600 15px Georgia;color:#e9c98a;margin:0 0 10px">Итог сборки</h2>
    <div>${rows}</div>
    <div style="max-width:360px"><div class="muted" style="font-size:12px">Файлы проходят синтаксическую проверку: ${quality}%</div>
    <div class="bar"><i style="width:${quality}%"></i></div></div>
    <p style="color:#a9a294;font-size:13px">Слева выберите страницу, чтобы увидеть дерево узлов Godot-сцены
    и замечания по конкретному элементу. Полный запуск требует Redot, здесь проверяется структура.</p>
    <h3 style="font:600 14px Georgia;color:#e9c98a">Быстрый старт</h3>
    <pre>redot --path "${report.out}"        # открыть в редакторе
redot --path "${report.out}" --headless --quit   # проверить загрузку сцен</pre>`;
}

function sceneHtml(root, report, sceneRel) {
  const screen = (report.screens ?? []).find((s) => s.scene === sceneRel);
  if (!screen) return "<p>Сцена не найдена в отчёте.</p>";
  const tscnPath = join(root, sceneRel);
  const text = existsSync(tscnPath) ? readFileSync(tscnPath, "utf8") : "";
  const nodes = [];
  let depth = 0;
  const paths = [];
  for (const line of text.split("\n")) {
    const m = /^\[node name="([^"]+)" type="([^"]+)"(?: parent="([^"]+)")?\]/.exec(line);
    if (!m) continue;
    const [, name, type, parent] = m;
    const path = parent ? `${parent}/${name}` : name;
    paths.push({ name, type, path });
  }
  const items = paths.map((p) => {
    const lvl = p.path.split("/").length - 1;
    return `<div class="row" style="padding-left:${lvl * 14}px"><span>${p.name}</span><span class="ok">${p.type}</span></div>`;
  }).join("");
  const issues = (screen.todo ?? []).map((t) => `<div class="row"><span>${t.message}</span></div>`).join("")
    || '<div class="row ok">Замечаний нет.</div>';
  return `<p><a href="#" data-p="${decodeURIComponent(sceneRel)}">Предпросмотр сцены →</a></p>
    <h2 style="font:600 15px Georgia;color:#e9c98a;margin:0">${screen.page} → ${screen.scene}</h2>
    <p style="color:#a9a294;font-size:13px">${paths.length} узлов, ${screen.cssRules} CSS-правил.</p>
    <h3 style="font:600 14px Georgia;color:#e9c98a">Структура сцены</h3>${items}
    <h3 style="font:600 14px Georgia;color:#e9c98a">Замечания по экрану</h3>${issues}`;
}

/**
 * previewHtml — приблизительный предпросмотр перенесённой сцены.
 *
 * Полноценный Godot-рендер тут невозможен, поэтому строим дерево из .tscn
 * (Panel/Control/Button/Label/контейнеры) и раскрашиваем его теми StyleBoxFlat,
 * которые записал конвертер. Это ловит главные ошибки переноса: пропавшие узлы,
 * неверные размеры, потерянные фоны и рамки — до открытия движка.
 */
function previewHtml(root, report, sceneRel) {
  const text = readFileSync(join(root, sceneRel), "utf8");
  const blocks = text.split(/\n(?=\[(?:node|sub_resource) )/);
  const subResources = new Map();
  const nodes = [];
  for (const block of blocks) {
    const sub = /^\[sub_resource type="([^"]+)" id="([^"]+)"\]/.exec(block);
    if (sub) {
      subResources.set(sub[2], block);
      continue;
    }
    const m = /^\[node name="([^"]+)" type="([^"]+)"(?: parent="([^"]+)")?\]/.exec(block);
    if (!m) continue;
    const [, name, type, parent] = m;
    const path = parent ? `${parent}/${name}` : name;
    nodes.push({ name, type, path, body: block });
  }

  const styleOf = (body) => {
    const ref = /SubResource\("([^"]+)"\)/.exec(body);
    if (!ref) return "";
    const sb = subResources.get(ref[1]) ?? "";
    const bg = /bg_color = Color\(([^)]+)\)/.exec(sb);
    const border = /border_color = Color\(([^)]+)\)/.exec(sb);
    const radius = /corner_radius_top_left = ([\d.]+)/.exec(sb);
    const style = [];
    if (bg) {
      const [r, g, b, a] = bg[1].split(",").map((v) => Number(v.trim()));
      style.push(`background:rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`);
    }
    if (border) {
      const [r, g, b] = border[1].split(",").map((v) => Number(v.trim()));
      style.push(`border:1px solid rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},.9)`);
    }
    if (radius) style.push(`border-radius:${Number(radius[1])}px`);
    return style.join(";");
  };

  const isContainer = (type) => /(VBox|HBox|Grid)Container/.test(type);
  const html = [];
  const stack = [];
  for (const node of nodes) {
    const depth = node.path.split("/").length - 1;
    const body = node.body;
    const textProp = /^text = "(.+)"$/m.exec(body);
    const color = /theme_override_colors\/font_color = Color\(([^)]+)\)/.exec(body);
    const fontSize = /theme_override_font_sizes\/font_size = (\d+)/.exec(body);
    const minSize = /custom_minimum_size = Vector2\(([\d.]+), ([\d.]+)\)/.exec(body);
    const columns = /^columns = (\d+)$/m.exec(body);
    const style = styleOf(body);
    const label = node.path.replace(/^[^/]+\/?/, "").replace(/\//g, " › ") || node.name;

    const css = [style];
    if (minSize) css.push(`min-width:${Number(minSize[1])}px;min-height:${Number(minSize[2])}px`);
    if (textProp) {
      css.push("padding:4px 6px");
      if (color) {
        const [r, g, b] = color[1].split(",").map((v) => Number(v.trim()));
        css.push(`color:rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`);
      }
      if (fontSize) css.push(`font-size:${fontSize[1]}px`);
    }
    if (isContainer(node.type)) {
      css.push(node.type.startsWith("H") ? "display:flex;gap:4px;align-items:flex-start" : "display:flex;flex-direction:column;gap:4px");
      if (columns) css.push(`display:grid;grid-template-columns:repeat(${columns[1]},1fr);gap:4px`);
    }
    if (!css.filter(Boolean).length) css.push("outline:1px dashed #47506b");

    const tag = textProp ? (/Button/.test(node.type) ? "button" : "span") : "div";
    const content = textProp ? escapeHtml(textProp[1]) : "";
    html.push(
      `<${tag} class="n" style="${css.filter(Boolean).join(";")}" title="${escapeHtml(node.type)} · ${escapeHtml(node.path)}">` +
      `<i>${escapeHtml(node.name)}</i>${content}</${tag}>`,
    );
  }
  const issues = (report.screens ?? []).find((s) => s.scene === sceneRel)?.todo ?? [];
  return `<h2 style="font:600 15px Georgia;color:#e9c98a;margin:0">Предпросмотр сцены ${escapeHtml(sceneRel)}</h2>
    <p style="color:#a9a294;font-size:13px">Это эвристический HTML-рендер дерева .tscn: цвета и рамки из StyleBoxFlat,
    размеры из custom_minimum_size. Реальную раскладку контейнеров считает движок — здесь видно, что не потерялось.</p>
    <div style="background:#101315;border:1px solid #262c2f;border-radius:8px;padding:14px;max-width:900px">
      ${html.join("\n")}
    </div>
    <h3 style="font:600 14px Georgia;color:#e9c98a">Узлы, требующие ручной доработки</h3>
    ${issues.length ? `<ul style="font-size:13px;color:#d8cfbb">${issues.map((t) => `<li>${escapeHtml(t.message)}</li>`).join("")}</ul>` : '<p class="ok" style="color:#9dc46f">Замечаний по сцене нет.</p>'}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function reportHtml(report) {
  return `<pre>${JSON.stringify(report, null, 2).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</pre>`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const projectIdx = args.indexOf("--project");
  const portIdx = args.indexOf("--port");
  startServer({
    project: projectIdx >= 0 ? args[projectIdx + 1] : ".",
    port: portIdx >= 0 ? Number(args[portIdx + 1]) : 8123,
  });
}
