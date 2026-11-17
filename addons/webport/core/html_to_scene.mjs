/**
 * html_to_scene.mjs — HTML-дерево → Godot-сцена (.tscn) + таблица id → путь к узлу.
 *
 * Соответствие тегов намеренно «одно в одно», чтобы перенос оставался предсказуемым:
 *   div/section/main/aside/header/footer/nav  → Panel
 *   button                                    → Button
 *   input[type=text|number] / textarea        → LineEdit
 *   select                                    → OptionButton
 *   img                                       → TextureRect
 *   canvas                                    → SubViewportContainer + SubViewport
 *   span/b/strong/small/i/em/label/h1..h6/p   → Label
 *   ul/ol                                     → VBoxContainer (li → Panel+Label)
 *
 * Стили берутся из CSS по селекторам (класс/id/тег): размеры, отступы, цвета, фон,
 * закругления, шрифт. Всё, что не удалось выразить, фиксируется в отчёте.
 */

import { parseHtml, collectIds, findAll, classList, hasClass } from "./html_dom.mjs";

const TAGS = {
  div: "Panel", section: "Panel", main: "Panel", aside: "Panel", header: "Panel",
  footer: "Panel", nav: "Panel", article: "Panel", form: "Panel", figure: "Panel",
  button: "Button", select: "OptionButton", textarea: "LineEdit", canvas: "SubViewportContainer",
  img: "TextureRect", span: "Label", b: "Label", strong: "Label", small: "Label",
  i: "Label", em: "Label", label: "Label", p: "Label", h1: "Label", h2: "Label",
  h3: "Label", h4: "Label", h5: "Label", h6: "Label", li: "Label", td: "Label", th: "Label",
  ul: "VBoxContainer", ol: "VBoxContainer", table: "GridContainer", tr: "HBoxContainer",
};

const SKIP_TAGS = new Set(["script", "style", "meta", "link", "title", "head", "br", "hr"]);

export function convertHtml(source, options = {}) {
  const root = parseHtml(source);
  const cssSources = collectCss(root);
  const rules = parseCss(cssSources.inline);
  const ids = collectIds(root);
  const dynamicIds = options.dynamicIds ?? new Set();

  const html = root.children.find((c) => c.tag === "html") ?? root;
  const body = findAll(html, (el) => el.tag === "body")[0] ?? html;

  const ctx = {
    options,
    rules,
    ids,
    nodePaths: new Map(),
    todo: [],
    warnings: [],
    usedLayout: new Set(),
  };

  const rootName = options.rootName ?? "GameRoot";
  const nodes = [];
  const rootNode = {
    name: rootName,
    type: "Control",
    props: [
      ["anchors_preset", 15],
      ["anchor_right", 1.0],
      ["anchor_bottom", 1.0],
      ["grow_horizontal", 2],
      ["grow_vertical", 2],
    ],
    children: [],
    htmlPath: "#root",
  };

  for (const child of body.children) {
    const node = convertElement(child, ctx, rootNode.htmlPath);
    if (node) rootNode.children.push(node);
  }

  applyLayout(rootNode, ctx);
  const scene = serializeScene(rootNode, ctx, options);

  for (const id of dynamicIds) {
    if (!ctx.nodePaths.has(id)) {
      ctx.warnings.push({ message: `innerHTML-контейнер #${id} отсутствует в HTML — создайте узел вручную` });
    }
  }

  return {
    scene,
    nodePaths: ctx.nodePaths,
    todo: ctx.todo,
    warnings: ctx.warnings,
    cssRules: rules.length,
    externalCss: cssSources.external,
    elementCount: ctx.nodePaths.size,
  };
}

// ── CSS ─────────────────────────────────────────────────────────────────────

function collectCss(root) {
  const styles = findAll(root, (el) => el.tag === "style");
  const links = findAll(root, (el) => el.tag === "link" && /stylesheet/.test(el.attrs?.rel ?? ""));
  return {
    inline: styles.map((s) => s.text).join("\n"),
    external: links.map((l) => l.attrs?.href).filter(Boolean),
  };
}

/** Разбор CSS в список правил: { selectors: [...], decls: {...}, order }. */
export function parseCss(source) {
  const rules = [];
  if (!source) return rules;
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  let order = 0;
  while (i < clean.length) {
    const open = clean.indexOf("{", i);
    if (open === -1) break;
    const prelude = clean.slice(i, open).trim();
    // @media и @keyframes — пропускаем, но разбираем внутренности @media
    let depth = 1;
    let j = open + 1;
    while (j < clean.length && depth > 0) {
      if (clean[j] === "{") depth += 1;
      else if (clean[j] === "}") depth -= 1;
      j += 1;
    }
    const body = clean.slice(open + 1, j - 1);
    if (/^@media/.test(prelude)) {
      const inner = parseCss(body);
      for (const r of inner) rules.push({ ...r, order: order++ });
    } else if (/^@/.test(prelude)) {
      // @keyframes/@font-face — не участвуют в раскладке
    } else {
      const decls = parseDeclarations(body);
      for (const selector of prelude.split(",").map((s) => s.trim()).filter(Boolean)) {
        rules.push({ selector, decls, order: order++ });
      }
    }
    i = j;
  }
  return rules;
}

function parseDeclarations(body) {
  const decls = {};
  for (const part of body.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (!prop || !value) continue;
    decls[prop] = value;
  }
  return decls;
}

/** Каскад: чем больше специфичность и позже объявление — тем приоритетнее. */
function matchRules(el, rules) {
  const classes = classList(el);
  const id = el.attrs?.id;
  const matched = [];
  for (const rule of rules) {
    const weight = selectorMatch(rule.selector, el.tag, id, classes);
    if (weight > 0) matched.push({ rule, weight });
  }
  matched.sort((a, b) => a.weight - b.weight || a.rule.order - b.rule.order);
  const decls = {};
  for (const { rule } of matched) Object.assign(decls, rule.decls);
  return decls;
}

function selectorMatch(selector, tag, id, classes) {
  // Поддержка: tag, .class, #id, tag.class, tag#id, .a.b, потомки через пробел (учитывается последний).
  const last = selector.split(/\s+/).pop();
  if (!last || /[:\[\]>+~*]/.test(last)) {
    // сложные селекторы (псевдоклассы, атрибуты) не поддерживаем — не применяем
    return 0;
  }
  const parts = last.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/);
  if (!parts) return 0;
  const selTag = parts[1];
  const mods = parts[2] ? parts[2].match(/[.#][\w-]+/g) ?? [] : [];
  let weight = 0;
  if (selTag) {
    if (selTag.toLowerCase() !== tag) return 0;
    weight += 1;
  }
  for (const mod of mods) {
    if (mod.startsWith("#")) {
      if (id !== mod.slice(1)) return 0;
      weight += 100;
    } else {
      if (!classes.includes(mod.slice(1))) return 0;
      weight += 10;
    }
  }
  return weight || 1;
}

// ── элементы ────────────────────────────────────────────────────────────────

function convertElement(el, ctx, htmlPath) {
  if (!el || el.type !== "element") return null;
  if (SKIP_TAGS.has(el.tag)) return null;
  const id = el.attrs?.id ?? "";
  const classes = classList(el);
  let type = TAGS[el.tag] ?? "Panel";

  // эвристика: div с id «...Modal/Overlay/Panel» — тоже панель, а <div class="overlay"> скрыт по умолчанию
  if (el.tag === "div" && hasClass(el, "toast")) type = "Panel";
  if (el.tag === "input") {
    const inputType = (el.attrs?.type ?? "text").toLowerCase();
    if (inputType === "checkbox" || inputType === "radio") type = "CheckBox";
    else if (inputType === "range") type = "HSlider";
    else type = "LineEdit";
  }
  if (el.tag === "a") type = "Button";

  const name = makeNodeName(el, ctx);
  const htmlNodePath = `${htmlPath}/${id ? "#" + id : el.tag + "[" + name + "]"}`;
  const node = { name, type, props: [], children: [], htmlPath: htmlNodePath, htmlTag: el.tag, attrs: el.attrs };

  if (id) ctx.nodePaths.set(id, name);
  node.path = ctx.nodePathString ? `${ctx.nodePathString}/${name}` : name;

  const decls = matchRules(el, ctx.rules);
  // Панель без фона/рамки — просто контейнер: делаем Control, чтобы не рисовать прямоугольник.
  const hasSurface = Boolean(decls["background-color"] || decls.background || decls["border-radius"] ||
    decls.border || /url\(/.test(decls["background-image"] ?? ""));
  if (node.type === "Panel" && !hasSurface) {
    node.type = "Control";
    node.bareControl = true;
  }
  applyDecls(node, decls, el, ctx);

  // текст
  const text = el.children.filter((c) => c.type === "text").map((c) => c.text).join(" ").trim();
  if (text && ["Label", "Button"].includes(node.type)) {
    node.props.push(["text", text]);
  } else if (text) {
    const label = { name: "Text", type: "Label", props: [["text", text]], children: [], htmlPath: htmlNodePath + "/text", isTextChild: true };
    if (node.bold) label.bold = true;
    if (decls.color) label.inheritColor = decls.color;
    if (decls["font-size"]) label.inheritFontSize = decls["font-size"];
    node.textChild = label;
  }

  // атрибуты, влияющие на вид
  if (type === "TextureRect" && el.attrs?.src) {
    node.props.push(["__texture_src", el.attrs.src]);
  }
  if (type === "TextureRect" && el.attrs?.alt) node.props.push(["tooltip_text", el.attrs.alt]);
  if (type === "OptionButton") {
    const options = findAll(el, (c) => c.tag === "option").map((c) => c.children.map((t) => t.text ?? "").join(""));
    if (options.length) node.props.push(["__options", options]);
  }
  if (el.attrs?.value && type === "LineEdit") node.props.push(["placeholder_text", el.attrs.value]);
  if (el.attrs?.disabled === "" || el.attrs?.disabled === "disabled") node.props.push(["disabled", true]);
  if (el.attrs?.title) node.props.push(["tooltip_text", el.attrs.title]);
  if (id && ctx.options.dynamicIds?.has(id)) {
    node.props.push(["metadata/webport_dynamic", true]);
  }
  if (el.attrs?.["data-tip"]) {
    node.props.push(["tooltip_text", el.attrs["data-tip"]]);
  }

  if (el.tag === "canvas") {
    const widthAttr = String(el.attrs?.width ?? "");
    const heightAttr = String(el.attrs?.height ?? "");
    const width = /^[1-9]\d*$/.test(widthAttr) ? Number(widthAttr) : 300;
    const height = /^[1-9]\d*$/.test(heightAttr) ? Number(heightAttr) : 150;
    node.props.push(["stretch", true]);
    const viewportChildren = [];
    const canvasBackground = el.attrs?.["data-background-image"];
    const canvasOverlay = el.attrs?.["data-overlay-image"];
    if (canvasBackground) {
      viewportChildren.push({
        name: "StaticCanvasBackground",
        type: "TextureRect",
        props: [
          ["__texture_src", canvasBackground],
          ["anchors_preset", 15],
          ["anchor_right", 1.0],
          ["anchor_bottom", 1.0],
          ["grow_horizontal", 2],
          ["grow_vertical", 2],
          ["mouse_filter", 2],
          ["expand_mode", 0],
          ["stretch_mode", 6],
        ],
        children: [],
        htmlPath: `${htmlNodePath}/CanvasViewport/StaticCanvasBackground`,
        htmlTag: "texture_rect",
      });
    }
    if (canvasOverlay) {
      viewportChildren.push({
        name: "StaticCanvasOverlay",
        type: "TextureRect",
        props: [
          ["__texture_src", canvasOverlay],
          ["anchors_preset", 15],
          ["anchor_right", 1.0],
          ["anchor_bottom", 1.0],
          ["grow_horizontal", 2],
          ["grow_vertical", 2],
          ["mouse_filter", 2],
          ["expand_mode", 0],
          ["stretch_mode", 6],
        ],
        children: [],
        htmlPath: `${htmlNodePath}/CanvasViewport/StaticCanvasOverlay`,
        htmlTag: "texture_rect",
      });
      ctx.todo.push({
        message: `<canvas${id ? ` #${id}` : ""}>: data-overlay-image статичен; маркеры объектов, выбор и смена владения не синхронизируются`,
      });
    }
    node.children.push({
      name: "CanvasViewport",
      type: "SubViewport",
      props: [["size", `Vector2i(${width}, ${height})`]],
      children: viewportChildren,
      htmlPath: `${htmlNodePath}/CanvasViewport`,
      htmlTag: "subviewport",
    });
    ctx.todo.push({
      message: `<canvas${id ? ` #${id}` : ""}>: JavaScript-рисование и ввод не переносятся; реализуйте _draw() или собственные узлы внутри SubViewport`,
    });
  }

  // дети (для script/style уже отфильтровано)
  for (const child of el.children) {
    const childNode = convertElement(child, ctx, htmlNodePath);
    if (childNode) node.children.push(childNode);
  }
  if (node.backgroundImage) {
    node.children.unshift({
      name: "BackgroundTexture",
      type: "TextureRect",
      props: [
        ["__texture_src", node.backgroundImage],
        ["anchors_preset", 15],
        ["anchor_right", 1.0],
        ["anchor_bottom", 1.0],
        ["grow_horizontal", 2],
        ["grow_vertical", 2],
        ["mouse_filter", 2],
        ["expand_mode", 0],
        ["stretch_mode", 6],
      ],
      children: [],
      htmlPath: `${htmlNodePath}/BackgroundTexture`,
      htmlTag: "texture_rect",
    });
    node.backgroundImage = null;
  }

  // <li> — в нашем отображении Label внутри VBoxContainer
  return node;
}

function makeNodeName(el, ctx) {
  const id = el.attrs?.id;
  if (id) return toPascal(id);
  const cls = classList(el)[0];
  const base = cls ? toPascal(cls) : capitalize(el.tag);
  const key = `${el.tag}:${cls ?? ""}`;
  ctx.nameSeq = ctx.nameSeq ?? new Map();
  const n = (ctx.nameSeq.get(key) ?? 0) + 1;
  ctx.nameSeq.set(key, n);
  return n === 1 ? base : `${base}${n}`;
}

function toPascal(value) {
  return String(value)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => capitalize(part))
    .join("") || "Node";
}

function capitalize(value) {
  const s = String(value);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── стили ───────────────────────────────────────────────────────────────────

function px(value, ownFontSize = 14) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s.endsWith("rem")) return parseFloat(s) * 16;
  if (s.endsWith("vw")) return parseFloat(s) * 12.8;   // 1280 — базовая ширина проекта
  if (s.endsWith("vh")) return parseFloat(s) * 7.2;    // 720 — базовая высота
  if (s.endsWith("em")) return parseFloat(s) * ownFontSize;
  if (s.endsWith("%")) return null;                    // проценты — отдельно
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : null;
}

function parseColor(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 6) hex += "ff";
    if (hex.length !== 8) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return `Color(${round(r / 255)}, ${round(g / 255)}, ${round(b / 255)}, ${round(a)})`;
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean).map((p) => parseFloat(p));
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    return `Color(${round(r / 255)}, ${round(g / 255)}, ${round(b / 255)}, ${round(a)})`;
  }
  return null;
}

function round(v) {
  return Math.round(Number(v) * 1000) / 1000;
}

function boxShorthand(value) {
  if (!value) return null;
  const parts = String(value).trim().split(/\s+/);
  const nums = parts.map((p) => px(p));
  if (nums.some((n) => n === null)) return null;
  if (nums.length === 1) return { top: nums[0], right: nums[0], bottom: nums[0], left: nums[0] };
  if (nums.length === 2) return { top: nums[0], right: nums[1], bottom: nums[0], left: nums[1] };
  if (nums.length === 3) return { top: nums[0], right: nums[1], bottom: nums[2], left: nums[1] };
  return { top: nums[0], right: nums[1], bottom: nums[2], left: nums[3] };
}

function applyDecls(node, decls, el, ctx) {
  const p = node.props;
  const set = (key, value) => {
    const existing = p.findIndex(([k]) => k === key);
    if (existing >= 0) p[existing][1] = value;
    else p.push([key, value]);
  };

  const isTextNode = ["Label", "Button", "LineEdit", "OptionButton", "CheckBox"].includes(node.type);
  const fontSize = px(decls["font-size"], 14) ?? 14;
  if (decls["font-size"] && isTextNode) set("theme_override_font_sizes/font_size", Math.round(fontSize));
  const color = parseColor(decls.color);
  if (color && isTextNode) set("theme_override_colors/font_color", color);
  if (decls["font-weight"]) {
    const weight = Number(decls["font-weight"]) || (decls["font-weight"] === "bold" ? 700 : 400);
    node.bold = weight >= 600;
  }
  if (decls["text-align"] === "center") set("horizontal_alignment", 1);
  if (decls["text-align"] === "right") set("horizontal_alignment", 2);
  if (decls["letter-spacing"]) {
    const ls = px(decls["letter-spacing"]);
    if (ls != null) set("theme_override_constants/outline_size", 0), ctx.warnings.push({
      message: `letter-spacing не поддерживается Label — перенесите в шрифт (${node.name})`,
    });
  }

  const bgColor = parseColor(decls["background-color"] ?? decls.background?.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/i)?.[0]);
  const radius = px(decls["border-radius"]);
  if (bgColor && node.type === "Panel") {
    node.stylebox = node.stylebox ?? {};
    node.stylebox.bg = bgColor;
  } else if (bgColor && ["Button", "LineEdit", "OptionButton"].includes(node.type)) {
    node.stylebox = node.stylebox ?? {};
    node.stylebox.bg = bgColor;
  }
  if (radius != null) {
    node.stylebox = node.stylebox ?? {};
    node.stylebox.radius = radius;
  }
  const border = decls.border?.match(/([\d.]+)px\s+\w+\s+(#[0-9a-f]{3,8}|rgba?\([^)]*\))/i);
  if (border) {
    node.stylebox = node.stylebox ?? {};
    node.stylebox.border = parseColor(border[2]);
    node.stylebox.borderWidth = px(border[1]) ?? 1;
  }
  if (decls["border-color"]) {
    node.stylebox = node.stylebox ?? {};
    node.stylebox.border = parseColor(decls["border-color"]);
  }

  // размеры и позиционирование
  const width = decls.width ? (String(decls.width).endsWith("%") ? null : px(decls.width)) : null;
  const height = decls.height ? (String(decls.height).endsWith("%") ? null : px(decls.height)) : null;
  const minWidth = px(decls["min-width"]);
  const maxWidth = px(decls["max-width"]);
  const minHeight = px(decls["min-height"]);
  if (width != null) set("custom_minimum_size", `Vector2(${Math.round(width)}, ${Math.round(height ?? 0)})`);
  else if (minWidth != null || minHeight != null) {
    set("custom_minimum_size", `Vector2(${Math.round(minWidth ?? 0)}, ${Math.round(minHeight ?? 0)})`);
  }
  if (maxWidth != null) node.maxWidth = maxWidth;

  const padding = boxShorthand(decls.padding);
  const margin = boxShorthand(decls.margin);
  const gap = px(decls.gap);
  const display = decls.display;
  const direction = decls["flex-direction"];
  const gridColumns = decls["grid-template-columns"];

  node.layoutHint = { display, direction, gridColumns, gap, padding, margin, decls };
  const insets = ["inset", "top", "left", "right", "bottom"].some((k) => decls[k] != null);
  node.fullRect = insets && (decls.position === "absolute" || decls.inset != null);

  if (decls.position === "absolute" || decls.position === "fixed") {
    node.absolute = {
      top: px(decls.top), right: px(decls.right), bottom: px(decls.bottom), left: px(decls.left),
    };
  }
  if (decls.overflow === "auto" || decls["overflow-y"] === "auto") node.scroll = true;
  if (decls.cursor === "pointer" && node.type === "Panel") node.pointer = true;

  // фон-картинка
  const bgImage = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(decls["background-image"] ?? decls.background ?? "");
  if (bgImage) node.backgroundImage = bgImage[1];
  if (/^(none|transparent)$/.test(decls.display ?? "") || decls.opacity === "0") node.hiddenByDefault = true;
}

// ── раскладка и сериализация ────────────────────────────────────────────────

const CONTAINER_TYPES = new Set(["VBoxContainer", "HBoxContainer", "GridContainer", "Panel", "Control"]);

function applyLayout(node, ctx) {
  if (node.textChild) {
    const label = node.textChild;
    if (label.inheritFontSize) label.props.push(["theme_override_font_sizes/font_size", Math.round(px(label.inheritFontSize, 14) ?? 14)]);
    if (label.inheritColor) {
      const c = parseColor(label.inheritColor);
      if (c) label.props.push(["theme_override_colors/font_color", c]);
    }
    node.children.unshift(label);
    node.textChild = null;
  }
  const hint = node.layoutHint ?? {};
  const isContainer = CONTAINER_TYPES.has(node.type);
  const children = node.children.filter((c) => !["Label", "TextureRect"].includes(c.type) || node.children.length > 1);

  if (node.type === "Panel" || node.type === "Control") {
    const display = hint.display ?? "";
    const direction = hint.direction ?? "";
    const isFlex = display.includes("flex");
    const isGrid = display.includes("grid");

    if (isGrid && hint.gridColumns) {
      node.type = "GridContainer";
      const cols = countColumns(hint.gridColumns);
      node.props.push(["columns", cols]);
      ctx.usedLayout.add("GridContainer");
      if (hint.gap != null) node.props.push(["theme_override_constants/h_separation", Math.round(hint.gap)]);
      if (hint.gap != null) node.props.push(["theme_override_constants/v_separation", Math.round(hint.gap)]);
    } else if (isFlex) {
      node.type = direction.startsWith("column") ? "VBoxContainer" : "HBoxContainer";
      ctx.usedLayout.add(node.type);
      if (hint.gap != null) {
        const key = node.type === "HBoxContainer" ? "theme_override_constants/separation" : "theme_override_constants/separation";
        node.props.push([key, Math.round(hint.gap)]);
      }
      if (hint.decls?.["justify-content"]?.includes("center")) node.props.push(["alignment", 1]);
      if (hint.decls?.["align-items"]?.includes("center")) node.props.push(["alignment", 1]);
    } else if (hasFlexibleChildren(node)) {
      // обычный поток: блоки идут сверху вниз
      node.type = "VBoxContainer";
      ctx.usedLayout.add("VBoxContainer");
    }
  }
  if (node.type === "VBoxContainer" || node.type === "HBoxContainer") {
    // Внутренние отступы и margin показываем комментарием: в Control нет
    // margin-констант, а MarginContainer вставлять автоматически нельзя —
    // это сломало бы пути узлов, которые ищет JS.
    if (hint.padding) {
      node.props.push(["__original_padding", hint.padding]);
    }
    if (hint.margin) {
      node.props.push(["__original_margin", hint.margin]);
    }
  }

  const isFlexParent = ["VBoxContainer", "HBoxContainer", "GridContainer"].includes(node.type);
  if (!isFlexParent) {
    applySizebox(node, hint.decls ?? {});
  }
  for (const child of node.children) {
    applyLayout(child, ctx);
    if (!isFlexParent) {
      // абсолютное позиционирование внутри Panel/Control
      const left = child.absolute?.left ?? child.layoutHint?.margin?.left;
      const top = child.absolute?.top ?? child.layoutHint?.margin?.top;
      if (left != null || top != null) {
        child.props.push(["offset_left", Math.round(left ?? 0)]);
        child.props.push(["offset_top", Math.round(top ?? 0)]);
      }
    } else if (child.layoutHint?.decls?.["flex-grow"] && Number(child.layoutHint.decls["flex-grow"]) > 0) {
      child.props.push(["size_flags_horizontal", 3]);
    }
  }

  // одиночный текст внутри Panel → Label, иначе Panel без детей выглядит пусто
  if (node.type === "Panel" && children.length === 0 && !node.children.length) {
    // ничего: пустой контейнер остаётся панелью (может заполняться из JS)
  }
}

/**
 * Ширина/высота в процентах и отступы у Absolute-раскладки:
 * Control (не контейнер) получает anchors + offsets, Panel/Panel-контейнер — margins,
 * если он растянут на весь родитель.
 */
function applySizebox(node, decls) {
  const pct = (value) => {
    const m = /^([\d.]+)%$/.exec(String(value ?? "").trim());
    return m ? Number(m[1]) / 100 : null;
  };
  const left = pct(decls.left);
  const top = pct(decls.top);
  const right = pct(decls.right);
  const bottom = pct(decls.bottom);
  const widthPct = pct(decls.width);
  const heightPct = pct(decls.height);
  const inset = pct(decls.inset);
  const anyInset = left != null || top != null || right != null || bottom != null || inset != null;

  // Control-обёртка без размеров: отдаём размер по содержимому, а не растягиваем
  if (node.type === "Control" && !anyInset && widthPct == null && heightPct == null) {
    const minW = px(decls["min-width"]) ?? 0;
    const minH = px(decls["min-height"]) ?? 0;
    if (minW || minH) node.props.push(["custom_minimum_size", `Vector2(${Math.round(minW)}, ${Math.round(minH)})`]);
    node.props.push(["size_flags_horizontal", 1 ^ 0 || 1]);
    return;
  }

  const anchorLeft = left ?? inset ?? 0;
  const anchorTop = top ?? inset ?? 0;
  const anchorRight = widthPct != null ? anchorLeft + widthPct : (right != null || inset != null ? 1 - (right ?? inset) : 1);
  const anchorBottom = heightPct != null ? anchorTop + heightPct : (bottom != null || inset != null ? 1 - (bottom ?? inset) : 1);
  if (node.type === "Control" || widthPct != null || heightPct != null || anyInset) {
    node.props.push(["anchor_left", anchorLeft]);
    node.props.push(["anchor_top", anchorTop]);
    node.props.push(["anchor_right", anchorRight]);
    node.props.push(["anchor_bottom", anchorBottom]);
    node.props.push(["offset_left", 0]);
    node.props.push(["offset_top", 0]);
    node.props.push(["offset_right", 0]);
    node.props.push(["offset_bottom", 0]);
  }
}

function hasFlexibleChildren(node) {
  return node.children.some((c) => !["Label", "TextureRect"].includes(c.type));
}

function countColumns(value) {
  const repeat = /repeat\(\s*(\d+)/.exec(value);
  if (repeat) return Number(repeat[1]);
  const parts = value.split(/\s+/).filter((p) => p && !/^(1fr|auto)$/.test(p));
  return Math.max(1, parts.length || 1);
}

function serializeScene(rootNode, ctx, options) {
  const lines = [];
  const idCounter = { value: 1 };
  const subResources = [];
  const externalResources = [];
  const resourceIndex = new Map();

  const addExternal = (path, type) => {
    if (resourceIndex.has(path)) return resourceIndex.get(path);
    const id = externalResources.length + 1;
    externalResources.push({ id, path, type });
    resourceIndex.set(path, id);
    return id;
  };

  const typeOfResource = (path) => {
    if (/\.(png|jpg|jpeg|webp|svg)$/i.test(path)) return "Texture2D";
    if (/\.(ttf|otf)$/i.test(path)) return "FontFile";
    return "Resource";
  };

  const walk = (node, parentPath, depth) => {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (ctx.options.trackPaths) ctx.options.trackPaths.set(node.name, path);
    lines.push(`[node name="${node.name}" type="${node.type}"${parentPath ? ` parent="${parentPath}"` : ""}]`);
    if (node === rootNode && options.rootScript) {
      const scriptPath = String(options.rootScript).startsWith("res://")
        ? String(options.rootScript)
        : `res://${options.rootScript}`;
      const scriptId = addExternal(scriptPath, "Script");
      lines.push(`script = ExtResource("${scriptId}_${basename(scriptPath)}")`);
    }

    let styleboxId = null;
    if (node.stylebox && (node.stylebox.bg || node.stylebox.radius || node.stylebox.border)) {
      const sb = node.stylebox;
      subResources.push(
        `[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_${idCounter.value}"]\n` +
        [
          sb.bg ? `bg_color = ${sb.bg}` : null,
          sb.border ? `border_color = ${sb.border}` : null,
          sb.borderWidth != null ? `border_width_left = ${sb.borderWidth}\nborder_width_top = ${sb.borderWidth}\nborder_width_right = ${sb.borderWidth}\nborder_width_bottom = ${sb.borderWidth}` : null,
          sb.radius != null ? `corner_radius_top_left = ${sb.radius}\ncorner_radius_top_right = ${sb.radius}\ncorner_radius_bottom_right = ${sb.radius}\ncorner_radius_bottom_left = ${sb.radius}` : null,
        ].filter(Boolean).join("\n"),
      );
      styleboxId = `StyleBoxFlat_${idCounter.value}`;
      idCounter.value += 1;
    }

    for (const [key, value] of node.props) {
      if (key === "__texture_src") {
        const resPath = assetPath(value, options);
        if (!resPath) {
          ctx.todo.push({ message: `${value}: ассет не найден — узел ${node.name} без текстуры` });
          continue;
        }
        const rid = addExternal(resPath, typeOfResource(resPath));
        lines.push(`texture = ExtResource("${rid}_${basename(resPath)}")`);
        continue;
      }
      if (key === "__original_padding" || key === "__original_margin") {
        const label = key === "__original_padding" ? "padding" : "margin";
        const v = value;
        lines.push(`# ${label} в CSS: ${["top", "right", "bottom", "left"].map((side) => `${side}=${Math.round(v[side] ?? 0)}`).join(" ")}`);
        continue;
      }
      if (key === "__options") {
        for (const option of value) lines.push(`item_count = ${value.length}`);
        continue;
      }
      lines.push(`${key} = ${formatValue(value)}`);
    }

    if (styleboxId) {
      const key = node.type === "Panel" ? "theme_override_styles/panel" : "theme_override_styles/normal";
      lines.push(`${key} = SubResource("${styleboxId}")`);
    }
    if (node.backgroundImage) {
      const resPath = assetPath(node.backgroundImage, options);
      if (resPath) {
        const rid = addExternal(resPath, "Texture2D");
        lines.push(`# фон ${node.backgroundImage} → ExtResource("${rid}_${basename(resPath)}") (TextureRect под узлом)`);
      } else {
        ctx.todo.push({ message: `фон ${node.backgroundImage} не найден (${node.name})` });
      }
    }
    if (node.hiddenByDefault) lines.push("visible = false");
    if (node.scroll) lines.push("clip_contents = true");
    if (node.maxWidth != null) ctx.todo.push({ message: `max-width ${node.maxWidth}px у ${node.name} — замените на size_flags/скрипт` });
    lines.push("");

    for (const child of node.children) walk(child, path, depth + 1);
  };

  walk(rootNode, "", 0);

  const header = [];
  header.push("[gd_scene load_steps=" + (externalResources.length + subResources.length + 1) + " format=3]");
  header.push("");
  for (const res of externalResources) {
    header.push(`[ext_resource type="${res.type}" path="${res.path}" id="${res.id}_${basename(res.path)}"]`);
  }
  if (externalResources.length) header.push("");
  header.push(...subResources);
  header.push("");
  return header.join("\n") + lines.join("\n").trimEnd() + "\n";
}

function formatValue(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "string") {
    if (/^(Vector2i?|Color|SubResource|ExtResource)\(/.test(value)) return value;
    return JSON.stringify(value);
  }
  return String(value);
}

function basename(path) {
  return String(path).split("/").pop().replace(/[^A-Za-z0-9_.]/g, "_");
}

/** /assets/ui/x.png → res://assets/ui/x.png (если файл существует в проекте). */
function assetPath(src, options) {
  if (!src || /^(data:|https?:)/.test(src)) return null;
  const clean = src.split("?")[0].split("#")[0].replace(/^\//, "");
  const exists = options.assetExists;
  if (typeof exists === "function" && !exists(clean)) return null;
  return `res://${clean}`;
}
