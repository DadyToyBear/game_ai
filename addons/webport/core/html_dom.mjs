/**
 * html_dom.mjs — разбор HTML на дерево узлов (подмножество, достаточное для игрового UI).
 *
 * Не претендует на соответствие спецификации HTML5: обрабатываются реальные
 * браузерные страницы игр — вложенные элементы, атрибуты в кавычках любого вида,
 * void-теги (<br>, <img>, <input>), комментарии, содержимое <script>/<style>.
 */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

const RAW_TEXT_TAGS = new Set(["script", "style"]);

export function parseHtml(source) {
  const root = { type: "element", tag: "root", attrs: {}, children: [], parent: null, text: "" };
  const stack = [root];
  let i = 0;
  const n = source.length;

  const pushText = (text) => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    if (RAW_TEXT_TAGS.has(parent.tag)) {
      parent.text += text; // содержимое script/style храним строкой
      return;
    }
    if (!text.trim()) return;
    parent.children.push({ type: "text", text: text.replace(/\s+/g, " ").trim(), parent });
  };

  while (i < n) {
    // HTML raw-text elements treat every `<` as text except their own closing
    // tag. This matters for real game scripts/styles, where comparisons and
    // template strings routinely contain angle brackets.
    const rawTag = stack[stack.length - 1].tag;
    if (RAW_TEXT_TAGS.has(rawTag)) {
      const close = new RegExp(`<\\s*\\/\\s*${rawTag}\\s*>`, "ig");
      close.lastIndex = i;
      const match = close.exec(source);
      if (!match) {
        pushText(source.slice(i));
        break;
      }
      pushText(source.slice(i, match.index));
      i = match.index + match[0].length;
      stack.pop();
      continue;
    }
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      pushText(source.slice(i));
      break;
    }
    pushText(source.slice(i, lt));

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (source.startsWith("<!", lt) || source.startsWith("<?", lt)) {
      const end = source.indexOf(">", lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const closeMatch = /^<\s*\/\s*([A-Za-z0-9:-]+)\s*>/.exec(source.slice(lt));
    if (closeMatch) {
      const tag = closeMatch[1].toLowerCase();
      for (let d = stack.length - 1; d > 0; d -= 1) {
        if (stack[d].tag === tag) {
          stack.length = d;
          break;
        }
      }
      i = lt + closeMatch[0].length;
      continue;
    }

    const openMatch = /^<\s*([A-Za-z0-9:-]+)/.exec(source.slice(lt));
    if (!openMatch) {
      pushText("<");
      i = lt + 1;
      continue;
    }
    const tag = openMatch[1].toLowerCase();
    let j = lt + openMatch[0].length;
    const attrs = {};
    let selfClosing = false;

    while (j < n) {
      while (j < n && /\s/.test(source[j])) j += 1;
      if (source[j] === ">") { j += 1; break; }
      if (source[j] === "/" && source[j + 1] === ">") { selfClosing = true; j += 2; break; }
      if (j >= n) break;

      const nameMatch = /^[^\s=/>]+/.exec(source.slice(j));
      if (!nameMatch) { j += 1; continue; }
      const name = nameMatch[0].toLowerCase();
      j += nameMatch[0].length;
      while (j < n && /\s/.test(source[j])) j += 1;

      let value = "";
      if (source[j] === "=") {
        j += 1;
        while (j < n && /\s/.test(source[j])) j += 1;
        const quote = source[j];
        if (quote === '"' || quote === "'") {
          const end = source.indexOf(quote, j + 1);
          value = source.slice(j + 1, end === -1 ? n : end);
          j = end === -1 ? n : end + 1;
        } else {
          const bareMatch = /^[^\s>]+/.exec(source.slice(j));
          value = bareMatch ? bareMatch[0] : "";
          j += value.length;
        }
      }
      if (attrs[name] === undefined) attrs[name] = value;
    }

    const el = { type: "element", tag, attrs, children: [], parent: stack[stack.length - 1], text: "" };
    stack[stack.length - 1].children.push(el);
    if (!VOID_TAGS.has(tag) && !selfClosing) stack.push(el);
    i = j;
  }

  return root;
}

/** Элементы с id, в порядке появления. */
export function collectIds(node, out = new Map()) {
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    const id = child.attrs?.id;
    if (id && !out.has(id)) out.set(id, child);
    collectIds(child, out);
  }
  return out;
}

/** Все элементы, удовлетворяющие предикату. */
export function findAll(node, predicate, out = []) {
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    if (predicate(child)) out.push(child);
    findAll(child, predicate, out);
  }
  return out;
}

export function classList(el) {
  return String(el.attrs?.class ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

export function hasClass(el, name) {
  return classList(el).includes(name);
}

/** Высота дерева и количество элементов — для отчёта. */
export function summarize(node, depth = 0, acc = { count: 0, depth: 0, tags: {} }) {
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    acc.count += 1;
    acc.depth = Math.max(acc.depth, depth + 1);
    acc.tags[child.tag] = (acc.tags[child.tag] ?? 0) + 1;
    summarize(child, depth + 1, acc);
  }
  return acc;
}
