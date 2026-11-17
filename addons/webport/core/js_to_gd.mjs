/**
 * js_to_gd.mjs — конвертация JavaScript (ES2022) в GDScript 4.
 *
 * Основано на AST от acorn (MIT, vendor/acorn.mjs). Это не «транспайлер всего JS»:
 * конвертируются конструкции, которыми реально написаны браузерные игры —
 * арифметика, объекты со строковыми ключами, массивы, функции, `.map/.filter/
 * .reduce/.some/.every/.find/.sort`, `for...of`, `if/else`, `try/catch`.
 *
 * Всё, что не удалось конвертировать, НЕ замалчивается: попадает в `todo`
 * с номером строки, а в GDScript остаётся заглушка `null` с комментарием TODO.
 * Так отчёт показывает реальную готовность переноса, а не «всё ок».
 */

import * as acorn from "../vendor/acorn.mjs";

const BINARY_OPS = {
  "+": "+", "-": "-", "*": "*", "/": "/", "%": "%", "**": "**",
  "<": "<", ">": ">", "<=": "<=", ">=": ">=",
  "==": "==", "!=": "!=", "===": "==", "!==": "!=",
  "&": "&", "|": "|", "^": "^", "<<": "<<", ">>": ">>", ">>>": ">>",
};

const ASSIGN_OPS = {
  "=": "=", "+=": "+=", "-=": "-=", "*=": "*=", "/=": "/=", "%=": "%=",
  "**=": "*=", "&=": "&=", "|=": "|=", "^=": "^=", "<<=": "<<=", ">>=": ">>=", ">>>=": ">>=",
};

const UNARY_OPS = { "-": "-", "+": "+", "!": "not ", "~": "~" };

// Приоритет операторов В GDScript (Python-подобный). Нужен, чтобы не потерять
// смысл выражений вроде (a + 1) % b: в JS % и + одного уровня, в GDScript % выше.
const GD_PREC = {
  "or": 1, "and": 2, "not": 3,
  "<": 4, ">": 4, "<=": 4, ">=": 4, "==": 4, "!=": 4,
  "|": 5, "^": 6, "&": 7,
  "<<": 8, ">>": 8,
  "+": 9, "-": 9,
  "*": 10, "/": 10, "%": 10,
  "**": 11,
};
const NON_ASSOC = new Set(["-", "/", "%", "<<", ">>"]);

// Свойства DOM, присваивание которых переносится через WebportLinks.set_prop.
const DOM_PROPS = new Set([
  "textContent", "innerText", "innerHTML", "className", "value", "checked", "disabled", "src",
]);

const GD_KEYWORDS = new Set([
  "and", "or", "not", "if", "else", "elif", "for", "while", "break", "continue",
  "pass", "return", "class", "extends", "is", "in", "as", "self", "signal",
  "await", "match", "when", "var", "const", "enum", "func", "static", "void",
  "true", "false", "null", "preload", "super", "trait", "namespace",
]);

// Глобальные функции/типы GDScript: локальная переменная с таким именем
// затеняет встроенную функцию и ломает вызовы, поэтому переименовываем.
const ARRAY_METHODS = new Set([
  "map", "filter", "forEach", "some", "every", "find", "findIndex", "sort", "reduce", "flatMap",
]);

const GD_SHADOWED = new Set([
  "abs", "sign", "min", "max", "clamp", "floor", "ceil", "round", "sqrt", "pow", "sin", "cos",
  "tan", "atan2", "exp", "log", "lerp", "snapped", "wrap", "posmod", "fmod", "range", "len",
  "str", "int", "float", "bool", "print", "printt", "printerr", "push_error", "push_warning",
  "typeof", "type_string", "is_instance_valid", "hash", "seed", "randf", "randi", "randf_range",
  "randi_range", "Color", "Vector2", "Vector2i", "Vector3", "Rect2", "Transform2D", "Array",
  "Dictionary", "Callable", "Signal", "String", "Time", "JSON", "FileAccess", "DirAccess",
  "load", "preload", "instantiate", "deg_to_rad", "rad_to_deg", "move_toward", "remap",
]);

const BUILTIN_CALLS = {
  "Math.abs": "abs", "Math.floor": "floor", "Math.ceil": "ceil", "Math.round": "round",
  "Math.min": "min", "Math.max": "max", "Math.sqrt": "sqrt", "Math.pow": "pow",
  "Math.sign": "sign", "Math.random": "randf", "Math.trunc": "trunc",
  "Number": "float", "String": "str", "Boolean": "bool",
  "parseInt": "int", "parseFloat": "float",
  "isNaN": "is_nan", "isFinite": "is_finite",
  "Object.keys": "KEYS", "Object.values": "VALUES", "Object.entries": "ENTRIES",
};

/** Имена, которые нельзя переименовывать: их ищет движок или пользователь. */
const RESERVED_EXPORTS = new Set(["World", "Battle", "Game", "Main"]);

export function reservedNames() {
  return RESERVED_EXPORTS;
}

export class Converter {
  /**
   * @param {object} opts
   * @param {string} opts.filename для сообщений и отчёта
   * @param {boolean} opts.classMode файл превращается в class-скрипт (extends Node)
   * @param {Record<string,string>} opts.globalMap переименование глобальных JS-имён
   */
  constructor(opts = {}) {
    this.filename = opts.filename ?? "<script>";
    this.classMode = opts.classMode ?? true;
    this.baseClass = opts.baseClass ?? "RefCounted";
    this.globalMap = opts.globalMap ?? {};
    this.todo = [];
    this.warnings = [];
    this.usedHelpers = new Set();
    this.objects = new Set();      // имена переменных, хранящих словари
    this.arrays = new Set();       // имена переменных, хранящих массивы
    this.indent = 0;
    this.depth = 0;   // 0 — верхний уровень файла, >0 — внутри функции
    this.pendingParams = [];
    this.deferred = [];   // вынесенные лямбды → методы класса
    this.deferredBodies = [];  // { name, header, body } — дообрабатываются после обхода
    this.importMap = {};  // локальное имя → Модуль.метод
    this.castOf = new Map();  // имя переменной → float|int|str|bool (для приведения при записи)
    this.lines = [];
  }

  // ── служебное ────────────────────────────────────────────────────────────

  fail(node, message) {
    const line = node?.loc?.start?.line ?? 0;
    this.todo.push({ line, message, file: this.filename });
    return "null";
  }

  /** Замечание на месте инструкции: внутри функции — `pass  # TODO`, на верхнем уровне — комментарий. */
  failStatement(node, message) {
    const line = node?.loc?.start?.line ?? 0;
    this.todo.push({ line, message, file: this.filename });
    return this.depth > 0 ? `pass  # TODO(webport): ${message}` : `# TODO(webport): ${message}`;
  }

  warn(node, message) {
    const line = node?.loc?.start?.line ?? 0;
    this.warnings.push({ line, message, file: this.filename });
  }

  push(text) {
    this.lines.push(text);
  }

  /** Добавляет один уровень отступа к каждой строке блока (код генерируется относительным). */
  pad(code, level = 1) {
    if (!code) return code;
    const prefix = "\t".repeat(level);
    return code
      .split("\n")
      .map((line) => (line.trim() === "" ? line : prefix + line))
      .join("\n");
  }

  /** Литеральное выражение, которое GDScript примет в const. */
  isConstantExpr(node) {
    if (!node) return false;
    switch (node.type) {
      case "Literal":
        return !node.regex;
      case "ArrayExpression":
        return node.elements.every((e) => this.isConstantExpr(e));
      case "ObjectExpression":
        return node.properties.every((p) => p.type === "Property" && this.isConstantExpr(p.value));
      case "UnaryExpression":
        return ["-", "+", "!"].includes(node.operator) && this.isConstantExpr(node.argument);
      case "BinaryExpression":
        return this.isConstantExpr(node.left) && this.isConstantExpr(node.right);
      default:
        return false;
    }
  }

  name(id) {
    if (id == null) return "null";
    const raw = String(id);
    if (this.globalMap[raw]) return this.globalMap[raw];
    let s = raw.replace(/[^A-Za-z0-9_]/g, "_");
    if (/^[0-9]/.test(s)) s = "v_" + s;
    if (GD_KEYWORDS.has(s)) s = s + "_";
    else if (GD_SHADOWED.has(s)) s = s + "_v";
    return s;
  }

  helper(kind) {
    this.usedHelpers.add(kind);
    return `WebportRuntime.${kind}`;
  }

  // ── точка входа ──────────────────────────────────────────────────────────

  convert(source, { module = true } = {}) {
    let ast;
    try {
      ast = acorn.parse(source, {
        ecmaVersion: 2024,
        sourceType: module ? "module" : "script",
        locations: true,
        allowHashBang: true,
      });
    } catch (err) {
      this.todo.push({ line: err.loc?.line ?? 0, message: "синтаксис JS не разобран: " + err.message, file: this.filename });
      return this.finish("", []);
    }

    this.assignTargets = new Set();
    const collectAssign = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "AssignmentExpression" && node.left?.type === "Identifier") {
        this.assignTargets.add(node.left.name);
      }
      if (node.type === "UpdateExpression" && node.argument?.type === "Identifier") {
        this.assignTargets.add(node.argument.name);
      }
      for (const key in node) {
        if (key === "loc" || key === "type") continue;
        const value = node[key];
        if (Array.isArray(value)) value.forEach(collectAssign);
        else if (value && typeof value === "object") collectAssign(value);
      }
    };
    collectAssign(ast);

    const top = [];
    const topLevelCode = [];
    const exportedFns = [];
    const exportedVars = [];
    for (const node of ast.body) {
      if (node.type === "ImportDeclaration") {
        top.push(this.handleImport(node));
      } else if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
        const inner = node.declaration;
        if (inner?.type === "FunctionDeclaration") {
          exportedFns.push(inner.id?.name ?? "anonymous");
          top.push(this.declaration(inner, { exported: true }));
        } else if (inner?.type === "VariableDeclaration") {
          for (const d of inner.declarations) if (d.id?.name) exportedVars.push(d.id.name);
          top.push(this.declaration(inner, { exported: true }));
        } else if (inner?.type === "ClassDeclaration") {
          this.todo.push({
            line: node.loc?.start?.line ?? 0,
            file: this.filename,
            message: `class ${inner?.id?.name ?? ""} не переносится автоматически: соберите сцену/узлы вручную`,
          });
          top.push(`# TODO(webport): class ${inner?.id?.name ?? ""} — перенесите вручную`);
        } else if (inner) {
          this.warn(node, "export без объявления — пропущен");
        }
        if (node.type === "ExportNamedDeclaration" && node.specifiers?.length) {
          for (const spec of node.specifiers) {
            const local = spec.local?.name ?? spec.exported?.name;
            if (local) exportedVars.push(local);
          }
        }
        if (node.type === "ExportNamedDeclaration" && node.source) {
          top.push(`# TODO(webport): re-export из ${node.source.value} — переносите вручную`);
        }
      } else if (node.type === "ExpressionStatement" || node.type === "ForStatement" ||
                 node.type === "WhileStatement" || node.type === "IfStatement" ||
                 node.type === "TryStatement" || node.type === "ForOfStatement") {
        // код верхнего уровня в JS-модуле: в class-скрипте он невалиден,
        // поэтому собираем его в отдельную функцию, которую вызывают вручную.
        topLevelCode.push(node);
      } else {
        const code = this.statement(node);
        if (code) top.push(code);
      }
    }

    if (topLevelCode.length) {
      this.depth = 1;
      const bodyLines = topLevelCode.map((n) => this.statement(n)).filter((c) => c && c.trim());
      this.depth = 0;
      top.push(
        `\n# Код верхнего уровня из ${this.filename}: в GDScript у модуля нет «точки старта».\n` +
        `# Вызовите webport_top_level() из _ready() нужной сцены, если эти эффекты нужны.\n` +
        `${this.classMode ? "static " : ""}func webport_top_level():\n${this.pad(bodyLines.join("\n") || "pass", 1)}`,
      );
    }

    const header = this.buildHeader(exportedFns, exportedVars.filter((v) => !exportedFns.includes(v)));
    return this.finish(header + top.filter(Boolean).join("\n"), exportedFns);
  }

  /** Догенерирует тела вынесенных лямбд на чистом состоянии конвертера. */
  computeDeferred() {
    const out = [];
    for (const item of this.deferredBodies) {
      const prev = { depth: this.depth, cast: new Map(this.castOf), map: { ...this.importMap } };
      this.depth = 1;
      const body = item.body.split("\n").filter((l) => l.trim()).join("\n");
      out.push(`${item.header}:\n${this.pad(body, 1)}`);
      this.depth = prev.depth;
      this.castOf = prev.cast;
      this.importMap = prev.map;
    }
    return out;
  }

  finish(body, exportedFns) {
    let prelude = "";
    if (this.usedHelpers.size) {
      prelude += `\nconst WebportRuntime := preload("res://addons/webport/runtime/webport_runtime.gd")\n`;
    }
    const tail = [];
    for (const kind of ["keys", "values", "entries"]) {
      if (this.usedHelpers.has(kind)) tail.push(this.staticHelper(kind));
    }
    let out = prelude + "\n" + body;
    const deferred = this.computeDeferred();
    if (deferred.length) out += "\n\n" + deferred.join("\n\n");
    if (tail.length) out += "\n\n" + tail.join("\n\n");
    return {
      code: out.trimStart(),
      todo: this.todo,
      warnings: this.warnings,
      exportedFns,
      helpers: [...this.usedHelpers],
    };
  }

  buildHeader(fns, vars) {
    const lines = [];
    lines.push(`# Сгенерировано WebPort (addons/webport) из ${this.filename}.`);
    lines.push("# Правьте JS-исходник и пересобирайте: ручные правки здесь потеряются.");
    if (this.classMode) {
      lines.push(`extends ${this.baseClass}`);
      lines.push("");
    }
    return lines.join("\n") + "\n";
  }

  staticHelper(kind) {
    const body = {
      keys: ["static func keys(d) -> Array:", "\tvar out := []", "\tif d is Dictionary:", "\t\tfor k in d.keys():", "\t\t\tout.append(k)", "\treturn out"],
      values: ["static func values(d) -> Array:", "\tvar out := []", "\tif d is Dictionary:", "\t\tfor k in d.keys():", "\t\t\tout.append(d[k])", "\treturn out"],
      entries: ["static func entries(d) -> Array:", "\tvar out := []", "\tif d is Dictionary:", "\t\tfor k in d.keys():", "\t\t\tout.append([k, d[k]])", "\treturn out"],
    }[kind];
    return body.join("\n");
  }

  // ── импорты ──────────────────────────────────────────────────────────────

  handleImport(node) {
    const from = node.source.value;
    if (node.specifiers.length === 0) {
      this.warn(node, `побочный импорт ${from} — в GDScript эквивалента нет`);
      return `# TODO(webport): import "${from}"`;
    }
    if (node.source.value.startsWith("http") || node.source.value.startsWith("node:")) {
      this.warn(node, `внешний модуль ${from} не переносится`);
      return `# TODO(webport): import "${from}" (внешний модуль)`;
    }
    const moduleName = this.name(this.stubName(from)).replace(/^_+/, "");
    const base = from.split("/").pop().replace(/\.m?js$/, "");
    const path = `res://webport/src/${base}.gd`;
    for (const spec of node.specifiers) {
      if (spec.local?.name) this.importMap[spec.local.name] = `${moduleName}.${this.name(spec.local.name)}`;
    }
    return `const ${moduleName} := preload("${path}")  # import "${from}"`;
  }

  stubName(path) {
    const base = path.split("/").pop().replace(/\.m?js$/, "");
    return this.name(base);
  }

  // ── объявления ───────────────────────────────────────────────────────────

  handleImportMeta(node) {
    return this.fail(node, "import.meta.url — нужен res:// путь вручную");
  }

  declaration(node, { exported = false } = {}) {
    if (node.type === "FunctionDeclaration") {
      const fname = this.name(node.id?.name ?? "anonymous");
      return this.functionDecl(node, fname, { isStatic: this.classMode });
    }
    if (node.type === "VariableDeclaration") {
      // В GDScript const требует константного выражения, поэтому:
      // на верхнем уровне const только для литералов, внутри функций всегда var.
      const out = [];
      for (const decl of node.declarations) {
        if (decl.id.type !== "Identifier") {
          this.fail(decl.id, "деструктуризация переменной не поддержана");
          continue;
        }
        const vname = this.name(decl.id.name);
        const arrow = decl.init && (decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression");
        if (arrow) {
          out.push(this.functionDecl({ ...decl.init, id: { name: vname }, params: decl.init.params }, vname));
          continue;
        }
        const init = decl.init ? this.expr(decl.init) : "null";
        this.inferKind(decl, vname);
        const reassigned = this.assignTargets?.has(decl.id.name);
        const kind = this.depth === 0 && this.isConstantExpr(decl.init) && !reassigned ? "const" : "var";
        const cast = /^(float|int|str|bool)\(/.exec(init);
        if (cast) this.castOf.set(decl.id.name, cast[1]);
        out.push(`${kind} ${vname} := ${init}`);
      }
      return out.length ? out.join("\n") : "";
    }
    return this.statement(node);
  }

  inferKind(decl, vname) {
    const init = decl.init;
    if (!init) return;
    if (init.type === "CallExpression" && this.calleeText(init.callee) === "document.getElementById") {
      this.domVarIds = this.domVarIds ?? new Map();
      const id = init.arguments[0]?.value;
      if (id) this.domVarIds.set(decl.id.name, id);
    }
    if (init.type === "ObjectExpression") this.objects.add(vname);
    else if (init.type === "ArrayExpression") this.arrays.add(vname);
    else if (init.type === "CallExpression") {
      const method = init.callee?.property?.name;
      if (["map", "filter", "slice", "concat", "split", "keys", "values", "entries", "flatMap"].includes(method)) {
        this.arrays.add(vname);
      }
    }
    else if (init.type === "NewExpression" && ["Map", "Set", "WeakMap"].includes(init.callee.name)) {
      this.arrays.add(vname);
    }
  }

  functionDecl(node, fname, { isStatic = false } = {}) {
    const params = node.params.map((p) => this.param(p));
    const header = `${isStatic ? "static " : ""}func ${fname}(${params.join(", ")})`;
    const savedDepth = this.depth;
    this.depth = 0;
    if (node.body.type !== "BlockStatement") {
      const ret = `${header}:\n\treturn ${this.expr(node.body)}`;
      this.depth = savedDepth;
      return ret;
    }
    this.depth += 1;
    const pending = this.pendingParams;
    this.pendingParams = [];
    const binds = pending.map(({ holder, pattern }) => this.patternBindings(holder, pattern)).filter(Boolean).join("\n");
    const body = [binds, this.blockStatements(node.body.body).join("\n")].filter((x) => x.trim()).join("\n");
    this.depth = savedDepth;
    const bodyLines = body.split("\n");
    const onlyComments = bodyLines.every((line) => !line.trim() || line.trim().startsWith("#"));
    if (!body.trim() || onlyComments) return `${header}:\n${this.pad([body, "pass"].filter(Boolean).join("\n"), 1)}`;
    return `${header}:\n${this.pad(body, 1)}`;
  }

  param(p) {
    if (p.type === "Identifier") return this.name(p.name);
    if (p.type === "RestElement") {
      this.warn(p, "rest-параметры (...) не поддержаны — используется Array");
      return this.name(p.argument?.name ?? "rest");
    }
    if (p.type === "AssignmentPattern") return `${this.param(p.left)} = ${this.expr(p.right)}`;
    if (p.type === "ObjectPattern") {
      const holder = `p_${(p.properties[0]?.key?.name ?? "obj")}_src`;
      this.pendingParams.push({ holder, pattern: p });
      return holder;
    }
    if (p.type === "ArrayPattern") {
      const holder = `p_arr_src`;
      this.pendingParams.push({ holder, pattern: p });
      return holder;
    }
    return "p_unused";
  }

  /** var a = p_src["a"] для параметров вида ({a, b}) и [x, y]. */
  patternBindings(holder, pattern) {
    const binds = [];
    if (pattern.type === "ObjectPattern") {
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") continue;
        const key = prop.key?.name ?? prop.key?.value;
        const target = prop.value?.type === "Identifier" ? prop.value.name : null;
        if (key == null || !target) continue;
        binds.push(`var ${this.name(target)} = ${holder}[${this.string(String(key))}]`);
      }
    } else if (pattern.type === "ArrayPattern") {
      pattern.elements.forEach((el, index) => {
        if (el?.type === "Identifier") binds.push(`var ${this.name(el.name)} = ${holder}[${index}]`);
      });
    }
    return binds.join("\n");
  }

  blockStatements(list) {
    const out = [];
    for (const st of list) {
      const c = this.statement(st);
      if (c) out.push(...c.split("\n"));
    }
    return out;
  }

  // ── инструкции ───────────────────────────────────────────────────────────

  statement(node) {
    if (!node) return "";
    switch (node.type) {
      case "ExpressionStatement": {
        const before = this.todo.length;
        const code = this.expr(node.expression);
        if (code == null || code === "") return "";
        if (code.startsWith("#")) return code;           // уже комментарий
        if (code === "pass") return code;
        if (code === "null" && this.todo.length > before) {
          const msg = this.todo[this.todo.length - 1].message;
          return `pass  # TODO(webport): ${msg}`;
        }
        return code;
      }
      case "VariableDeclaration":
        return this.declaration(node);
      case "FunctionDeclaration":
        return this.functionDecl(node, this.name(node.id?.name ?? "anonymous"), { isStatic: this.classMode });
      case "ReturnStatement":
        return node.argument ? `return ${this.expr(node.argument)}` : "return";
      case "IfStatement": {
        const test = this.expr(node.test);
        const body = this.branch(node.consequent);
        let out = `if ${test}:\n${body}`;
        if (node.alternate) {
          if (node.alternate.type === "IfStatement") {
            out += `\nelif ${this.expr(node.alternate.test)}:\n${this.branch(node.alternate.consequent)}`;
            let alt = node.alternate.alternate;
            while (alt) {
              if (alt.type === "IfStatement") {
                out += `\nelif ${this.expr(alt.test)}:\n${this.branch(alt.consequent)}`;
                alt = alt.alternate;
              } else {
                out += `\nelse:\n${this.branch(alt)}`;
                alt = null;
              }
            }
          } else {
            out += `\nelse:\n${this.branch(node.alternate)}`;
          }
        }
        return out;
      }
      case "ForOfStatement":
        return this.forOf(node);
      case "ForStatement":
        return this.forClassic(node);
      case "WhileStatement": {
        return `while ${this.expr(node.test)}:\n${this.branch(node.body)}`;
      }
      case "DoWhileStatement":
        return this.failStatement(node, "do...while — перепишите через while");
      case "BreakStatement":
        return "break";
      case "ContinueStatement":
        return "continue";
      case "BlockStatement":
        return this.blockStatements(node.body).join("\n");
      case "ThrowStatement":
        return `push_error(str(${this.expr(node.argument)}))`;
      case "TryStatement": {
        // В GDScript нет try/catch: тело try вставляется как есть, catch-ветка — рядом,
        // с предупреждением. Уровни отступов считаем от нуля (как обычный блок),
        // иначе вложенность в цикле/условии поедет.
        const tryBody = this.blockStatements(node.block.body).join("\n");
        if (!node.handler) return tryBody || "pass";
        this.warn(node, "try/catch: в GDScript нет исключений — catch выполняется всегда, обработку ошибок проверьте вручную");
        const errName = node.handler.param?.name ? this.name(node.handler.param.name) : "err";
        const handlerBody = this.blockStatements(node.handler.body.body).join("\n");
        const lines = [tryBody, `var ${errName} := ""`, `# ↑ catch-ветка вставлена линейно (GDScript не ловит исключения)`, handlerBody]
          .filter((part) => part && part.trim());
        return lines.join("\n");
      }
      case "EmptyStatement":
        return "";
      case "LabeledStatement":
        return this.failStatement(node, "метки (labels) не поддержаны");
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
        return this.statement(node.declaration);
      default:
        return this.failStatement(node, `инструкция ${node.type} не поддержана`);
    }
  }

  branch(node) {
    let out;
    if (node.type === "BlockStatement") {
      out = this.blockStatements(node.body);
    } else {
      const s = this.statement(node);
      out = s ? s.split("\n") : [];
    }
    if (!out.length || !out.join("").trim()) return "\tpass";
    const onlyComments = out.every((line) => !line.trim() || line.trim().startsWith("#"));
    if (onlyComments) out.push("pass");
    return this.pad(out.join("\n"), 1);
  }

  /** for (let i = 0; i < n; i += 1) → for i in range(n) / range(start, n). */
  forClassic(node) {
    const init = node.init;
    const test = node.test;
    const update = node.update;
    if (init?.type !== "VariableDeclaration" || init.declarations.length !== 1) {
      return this.fail(node, "классический for со сложным init — перепишите через while");
    }
    const decl = init.declarations[0];
    if (decl.id?.type !== "Identifier") return this.fail(node, "for с деструктуризацией не поддержан");
    const varName = this.name(decl.id.name);
    const start = decl.init ? this.expr(decl.init) : "0";
    if (test?.type !== "BinaryExpression" || !["<", "<=", ">", ">="].includes(test.operator)) {
      // for (let i = 0; i < n && cond; i += 1) → инициализация + while с шагом в конце
      if (!test) return this.fail(node, "for без условия — перепишите через while");
      const initCode = decl.init ? `var ${varName} := ${this.expr(decl.init)}` : "";
      const cond = this.expr(test);
      let stepCode = "";
      // (см. ниже)
      if (update?.type === "UpdateExpression") stepCode = `${varName}${update.operator}`;
      else if (update?.type === "AssignmentExpression") stepCode = `${varName} ${update.operator} ${this.expr(update.right)}`;
      else return this.fail(node, "for с нестандартным шагом — перепишите через while");
      const body = this.branch(node.body);
      return [initCode, `while ${cond}:`, body, this.pad(stepCode, 1)].filter(Boolean).join("\n");
    }
    const stepOk =
      (update?.type === "UpdateExpression" && update.operator === "++" &&
        update.argument?.name === decl.id.name) ||
      (update?.type === "AssignmentExpression" && ["+=", "-="].includes(update.operator) &&
        update.left?.name === decl.id.name);
    if (!stepOk) return this.fail(node, "for с нестандартным шагом — перепишите через while");

    const limit = this.expr(test.right);
    const inclusive = test.operator === "<=";
    const descending = update.operator === "--" || update.operator === "-=";
    let range;
    if (start === "0" && !descending) range = inclusive ? `range(${limit} + 1)` : limit;
    else if (start === "0" && descending) range = `range(${limit}, -1, -1)`;
    else range = inclusive ? `range(${start}, ${limit} + 1)` : `range(${start}, ${limit})`;
    return `for ${varName} in ${range}:\n${this.branch(node.body)}`;
  }

  forOf(node) {
    const left = node.left.type === "VariableDeclaration" ? node.left.declarations[0].id : node.left;
    if (left.type === "ArrayPattern" && node.right.type === "CallExpression" &&
        this.calleeText(node.right.callee) === "ENTRIES" && left.elements.length === 2) {
      const dict = this.expr(node.right.arguments[0]);
      const k = this.name(left.elements[0].name);
      const vName = this.name(left.elements[1].name);
      const bind = `var ${vName} = ${dict}[${k}]`;
      return `for ${k} in ${dict}.keys():\n${this.pad(bind, 1)}\n${this.branch(node.body)}`;
    }
    // for (const [i, v] of arr.entries())
    if (left.type === "ArrayPattern" && left.elements.length === 2 &&
        node.right.type === "CallExpression" && this.calleeText(node.right.callee) === "entries") {
      const arr = this.expr(node.right.callee.object);
      const iName = this.name(left.elements[0].name);
      const vName = this.name(left.elements[1].name);
      const idx = `${iName}`;
      const vBind = `var ${vName} = ${arr}[${idx}]`;
      return `for ${iName} in range(${arr}.size()):\n${this.pad(vBind, 1)}\n${this.branch(node.body)}`;
    }
    // for (const [k, v] of dict)
    if (left.type === "ArrayPattern" && left.elements.length === 2 &&
        node.right.type === "CallExpression" && this.calleeText(node.right.callee).endsWith("entries")) {
      const dict = this.expr(node.right.callee.object);
      const k = this.name(left.elements[0].name);
      const vName = this.name(left.elements[1].name);
      return `for ${k} in ${dict}.keys():\n${this.pad(`var ${vName} = ${dict}[${k}]`, 1)}\n${this.branch(node.body)}`;
    }
    // for (const [k, v] of collection): Dictionary → keys(), иначе универсальные пары
    if (left.type === "ArrayPattern" && left.elements.length === 2) {
      const coll = this.expr(node.right);
      const k = this.name(left.elements[0].name);
      const vName = this.name(left.elements[1].name);
      const isDict = node.right.type === "Identifier" && this.objects.has(node.right.name);
      if (isDict) {
        return `for ${k} in ${coll}.keys():\n${this.pad(`var ${vName} = ${coll}[${k}]`, 1)}\n${this.branch(node.body)}`;
      }
      const pair = `_pair_${k}`;
      const binds = [`var ${k} = ${pair}[0]`, `var ${vName} = ${pair}[1]`];
      return `for ${pair} in ${this.helper("iter_pairs")}(${coll}):\n${this.pad(binds.join("\n"), 1)}\n${this.branch(node.body)}`;
    }
    if (left.type !== "Identifier") return this.fail(node, "for...of с деструктуризацией не поддержан");
    const vname = this.name(left.name);
    const right = this.expr(node.right);
    // for (const [k, v] of Object.entries(x)) → for k in x.keys(): var v = x[k]
    if (node.right.type === "CallExpression" && this.calleeText(node.right.callee) === "ENTRIES") {
      const dict = this.expr(node.right.arguments[0]);
      const bind = `var ${vname} = [${vname}_key, ${dict}[${vname}_key]]`;
      return `for ${vname}_key in ${dict}.keys():\n${this.pad(bind, 1)}\n${this.branch(node.body)}`;
    }
    if (node.right.type === "CallExpression" && this.calleeText(node.right.callee) === "KEYS") {
      return `for ${vname} in ${this.expr(node.right.arguments[0])}.keys():\n${this.branch(node.body)}`;
    }
    return `for ${vname} in ${right}:\n${this.branch(node.body)}`;
  }

  calleeText(callee) {
    if (callee.type === "Identifier") return callee.name;
    if (callee.type === "MemberExpression" && !callee.computed) {
      return `${this.calleeText(callee.object)}.${callee.property.name}`;
    }
    return "";
  }

  // ── выражения ────────────────────────────────────────────────────────────

  expr(node) {
    if (!node) return "null";
    switch (node.type) {
      case "Literal": {
        if (node.regex) return this.fail(node, "регулярные выражения не переносятся, используйте RegEx вручную");
        if (node.value === null) return "null";
        if (typeof node.value === "string") return this.string(node.value);
        if (typeof node.value === "number") return this.number(node.value);
        if (typeof node.value === "boolean") return node.value ? "true" : "false";
        return "null";
      }
      case "Identifier": {
        if (this.importMap[node.name]) return this.importMap[node.name];
        if (node.name === "undefined") return "null";
        if (node.name === "NaN") return "NAN";
        if (node.name === "Infinity") return "INF";
        return this.name(node.name);
      }
      case "ThisExpression":
        return "self";
      case "ArrayExpression":
        return this.arrayLiteral(node);
      case "ObjectExpression":
        return this.objectLiteral(node);
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return this.fail(node, "анонимная функция/стрелка вне вызова — вынесите в отдельный func");
      case "UnaryExpression": {
        if (node.operator === "typeof") {
          const arg = this.expr(node.argument);
          return `${this.helper("typeof")}(${arg})`;
        }
        if (node.operator === "delete") {
          return this.fail(node, "delete — удаляйте ключ через Dictionary.erase()");
        }
        return `${UNARY_OPS[node.operator] ?? node.operator}${this.expr(node.argument)}`;
      }
      case "UpdateExpression": {
        const arg = this.expr(node.argument);
        return node.prefix ? `${node.operator}${arg}` : `${arg}${node.operator}`;
      }
      case "BinaryExpression": {
        if (node.operator === "instanceof") {
          return `${this.expr(node.left)} is ${this.classHint(node.right)}`;
        }
        if (node.operator === "in") {
          return `${this.expr(node.right)}.has(${this.expr(node.left)})`;
        }
        const op = BINARY_OPS[node.operator];
        if (!op) return this.fail(node, `оператор ${node.operator} не поддержан`);
        if (["&", "|", "^", "<<", ">>", ">>>"].includes(node.operator)) {
          this.warn(node, `побитовый ${node.operator} в GDScript работает с int: проверьте приведение`);
        }
        const prec = GD_PREC[op] ?? 4;
        if (op === "/") {
          // В GDScript 3/2 == 1 (int / int), в JS 3/2 == 1.5 — используем деление с float.
          const leftCode = this.child(node.left, prec, "left", op);
          const rightCode = this.child(node.right, prec, "right", op);
          return `${this.helper("div")}(${leftCode}, ${rightCode})`;
        }
        return `${this.child(node.left, prec, "left", op)} ${op} ${this.child(node.right, prec, "right", op)}`;
      }
      case "LogicalExpression":
        return this.logical(node);
      case "AssignmentExpression":
        return this.assignment(node);
      case "ConditionalExpression":
        return `(${this.expr(node.consequent)} if ${this.expr(node.test)} else ${this.expr(node.alternate)})`;
      case "CallExpression":
        return this.call(node);
      case "NewExpression":
        return this.newExpr(node);
      case "MemberExpression":
        return this.member(node);
      case "SequenceExpression":
        return node.expressions.map((e) => this.expr(e)).join(", ");
      case "TemplateLiteral":
        return this.template(node);
      case "SpreadElement":
        return this.expr(node.argument);
      case "ChainExpression":
        return this.expr(node.expression);
      case "MetaProperty":
        if (node.meta?.name === "import") return this.fail(node, "import.meta — замените на res:// путь");
        return this.fail(node, "MetaProperty не поддержан");
      case "AwaitExpression":
        return this.fail(node, "await — переносите асинхронность вручную (сигналы/tween)");
      default:
        return this.fail(node, `выражение ${node.type} не поддержано`);
    }
  }

  classHint(node) {
    if (node.type === "Identifier") {
      const map = { Array: "Array", Object: "Dictionary", String: "String", Number: "float", Boolean: "bool" };
      return map[node.name] ?? this.name(node.name);
    }
    return "Object";
  }

  string(value) {
    // GDScript: двойные кавычки, экранируем обратный слэш, кавычки, переводы строк
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return `"${escaped}"`;
  }

  number(value) {
    if (Number.isInteger(value)) return String(value);
    if (!Number.isFinite(value)) return "NAN";
    return String(value);
  }

  objectLiteral(node) {
    const parts = [];
    for (const prop of node.properties) {
      if (prop.type === "SpreadElement") {
        // {...a, b: 1} → WebportRuntime.merge({}, a, {b: 1})
        parts.push(`...${this.expr(prop.argument)}`);
        continue;
      }
      if (prop.computed) {
        this.fail(prop, "вычисляемый ключ в объекте не поддержан");
        continue;
      }
      let key;
      if (prop.key.type === "Identifier") key = this.string(prop.key.name);
      else if (prop.key.type === "Literal") key = this.string(String(prop.key.value));
      else {
        this.fail(prop, "ключ объекта не поддержан");
        continue;
      }
      let value;
      if (prop.method || prop.value?.type === "FunctionExpression" || prop.value?.type === "ArrowFunctionExpression") {
        value = `null # TODO(webport): метод ${String(prop.key.name ?? prop.key.value)} — вынесите в func`;
        this.todo.push({
          line: prop.loc?.start?.line ?? 0,
          message: `метод ${String(prop.key.name ?? prop.key.value)} в литерале объекта не перенесён`,
          file: this.filename,
        });
      } else {
        value = this.expr(prop.value);
      }
      parts.push(`${key}: ${value}`);
    }
    if (!parts.length) return "{}";
    if (parts.some((p) => p.startsWith("..."))) {
      // {...a, key: 1} — порядок важен: последующие ключи перекрывают предыдущие.
      // merge(цель, источник) копирует поверх, поэтому идём строго по порядку.
      const args = ["{}"];
      let pending = [];
      const flush = () => {
        if (pending.length) {
          args.push(`{${pending.join(", ")}}`);
          pending = [];
        }
      };
      for (const part of parts) {
        if (part.startsWith("...")) {
          flush();
          args.push(part.slice(3));
        } else {
          pending.push(part);
        }
      }
      flush();
      return `${this.helper("merge")}(${args.join(", ")})`;
    }
    const inline = `{${parts.join(", ")}}`;
    if (inline.length <= 100 && !inline.includes("\n")) return inline;
    return `{\n${parts.map((p) => this.pad(p, 1)).join(",\n")}\n}`;
  }

  member(node) {
    if (node.optional) {
      const objCode = this.expr(node.object);
      const access = this.member({ ...node, optional: false });
      return `(${access} if ${objCode} != null else null)`;
    }
    const obj = this.expr(node.object);
    if (node.computed) {
      const prop = this.expr(node.property);
      return `${this.wrapObject(obj)}[${prop}]`;
    }
    const prop = node.property.name;
    const constProps = { "PI": "PI", "E": "E", "TAU": "TAU", "SQRT2": "SQRT2", "LN2": "LN2", "LN10": "LN10" };
    const callee = this.calleeText(node.object);
    if (callee === "Math" && constProps[prop]) return constProps[prop];
    if (callee === "Number" && prop === "EPSILON") return "1e-6";
    if (callee === "Number" && prop === "MAX_SAFE_INTEGER") return "9007199254740991";
    if (callee === "Math" && prop === "random") return "randf()";
    if (prop === "length") return `${obj}.size()`;
    if (GD_KEYWORDS.has(prop)) return `${obj}[${this.string(prop)}]`;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(prop)) return `${obj}.${prop}`;
    return `${obj}[${this.string(prop)}]`;
  }

  wrapObject(code) {
    // объектный литерал или тернарник в индексе нуждается в скобках? GDScript требует
    if (/^\{[\s\S]*\}$/.test(code) || code.startsWith("(")) return code;
    return code;
  }

  /**
   * JS `a || b` и `a && b` возвращают ОПЕРАНД, а GDScript `or/and` — bool.
   * Если оба операнда заведомо булевы (сравнения, !, логика) — оставляем or/and,
   * иначе разворачиваем в тернарник/хелпер, чтобы не потерять значение.
   */
  logical(node) {
    const left = this.expr(node.left);
    const right = this.expr(node.right);
    if (node.operator === "??") return `(${left} if ${left} != null else ${right})`;

    const PURE_PREDICATES = new Set([
      "Array.isArray", "Number.isFinite", "Number.isInteger", "Object.hasOwn", "has", "includes",
      "some", "every", "startsWith", "endsWith", "hasOwnProperty",
    ]);
    const booleanish = (n) => {
      if (n.type === "LogicalExpression") return booleanish(n.left) && booleanish(n.right);
      if (n.type === "BinaryExpression") {
        return ["==", "!=", "===", "!==", "<", ">", "<=", ">="].includes(n.operator);
      }
      if (n.type === "UnaryExpression") return n.operator === "!";
      if (n.type === "Literal") return typeof n.value === "boolean";
      if (n.type === "CallExpression") {
        const name = this.calleeText(n.callee);
        return PURE_PREDICATES.has(name) || PURE_PREDICATES.has(name.split(".").pop());
      }
      if (n.type === "Identifier") {
        // простые флаги (`paused`, `ok`, `ready`) почти всегда bool;
        // доступ к полю (`unit.title`, `state.reason`) — почти всегда значение.
        return true;
      }
      return false;
    };

    if (booleanish(node.left) && booleanish(node.right)) {
      const op = node.operator === "&&" ? "and" : "or";
      const prec = GD_PREC[op];
      return `${this.child(node.left, prec, "left", op)} ${op} ${this.child(node.right, prec, "right", op)}`;
    }
    const SIMPLE = ["Identifier", "MemberExpression", "Literal", "CallExpression", "ArrayExpression",
      "ObjectExpression", "ChainExpression", "UnaryExpression"];
    const simpleLeft = SIMPLE.includes(node.left.type);
    if (simpleLeft) {
      // повторное вычисление простого выражения безопасно
      if (node.operator === "||") return `(${left} if ${left} else ${right})`;
      return `(${right} if ${left} else ${left})`;
    }
    this.warn(node, `${node.operator} с побочным эффектом в левой части — используется хелпер, right вычисляется всегда`);
    return node.operator === "||"
      ? `${this.helper("or_default")}(${left}, ${right})`
      : `${this.helper("and_default")}(${left}, ${right})`;
  }

  /**
   * Присваивание типизированной переменной в GDScript не приводит типы,
   * поэтому повторяем приведение: `var x := Number(y)` → `var x := float(y)` →
   * при записи снова `float(...)`. Иначе `:=` выводит тип один раз и падает на int.
   */
  emitCast(leftNode, rightCode) {
    if (leftNode?.type !== "Identifier") return rightCode;
    const cast = this.castOf.get(leftNode.name);
    if (!cast) return rightCode;
    if (/^(float|int|str|bool)\(/.test(rightCode)) return rightCode;
    if (rightCode.startsWith("(")) return rightCode; // тернарник: тип уже выведен внутри
    return `${cast}(${rightCode})`;
  }

  /** id элемента, к которому обращается DOM-вызов: getElementById("x") → x. */
  domNodeId(objNode) {
    if (!objNode) return null;
    if (objNode.type === "CallExpression" && this.calleeText(objNode.callee) === "document.getElementById") {
      return objNode.arguments[0]?.value ?? null;
    }
    if (objNode.type === "Identifier") return this.domVarIds?.get(objNode.name) ?? null;
    return null;
  }

  /** Приоритет узла в терминах GDScript (для расстановки скобок). */
  gdPrecOf(node) {
    if (!node) return 99;
    if (node.type === "Literal" || node.type === "Identifier" || node.type === "MemberExpression" ||
        node.type === "CallExpression" || node.type === "ArrayExpression" || node.type === "ObjectExpression" ||
        node.type === "TemplateLiteral" || node.type === "NewExpression" || node.type === "ChainExpression") return 99;
    if (node.type === "UnaryExpression") return node.operator === "!" ? GD_PREC.not : 12;
    if (node.type === "UpdateExpression") return 12;
    if (node.type === "BinaryExpression") return GD_PREC[BINARY_OPS[node.operator]] ?? 4;
    if (node.type === "LogicalExpression") {
      if (node.operator === "??") return 99;             // печатается как (… if … else …)
      return GD_PREC[node.operator === "&&" ? "and" : "or"];
    }
    if (node.type === "ConditionalExpression" || node.type === "AssignmentExpression") return 99; // в скобках
    return 99;
  }

  /** Оборачивает дочернее выражение в скобки, если иначе изменится смысл. */
  child(node, parentPrec, side = "left", parentOp = "") {
    const code = this.expr(node);
    const prec = this.gdPrecOf(node);
    const needs = prec < parentPrec ||
      (prec === parentPrec && side === "right" && NON_ASSOC.has(parentOp)) ||
      (prec === parentPrec && parentOp === "**" && side === "left");
    return needs ? `(${code})` : code;
  }

  assignment(node) {
    const op = ASSIGN_OPS[node.operator] ?? "=";
    const domProp = node.left?.type === "MemberExpression" && !node.left.computed
      ? node.left.property.name : null;
    if (domProp && DOM_PROPS.has(domProp)) {
      const nodeId = this.domNodeId(node.left.object);
      const value = this.expr(node.right);
      this.todo.push({
        line: node.loc?.start?.line ?? 0,
        file: this.filename,
        message: `${nodeId ? `#${nodeId}` : "узел"}.${domProp} = … — перенесите в WebportLinks.set_prop("${nodeId ?? "id"}", "${domProp === "textContent" ? "text" : "text"}")`,
      });
      return `${this.helper("set_dom")}("${nodeId ?? ""}", ${this.string(domProp)}, ${value})`;
    }
    const left = this.expr(node.left);
    const right = this.expr(node.right);
    if (op === "=") return `${left} = ${this.emitCast(node.left, right)}`;
    return `${left} ${op} ${right}`;
  }

  newExpr(node) {
    const callee = this.calleeText(node.callee);
    if (callee === "Map" || callee === "WeakMap") {
      return this.fail(node, "Map — используйте Dictionary");
    }
    if (callee === "Set" || callee === "WeakSet") {
      return this.fail(node, "Set — используйте Array.has() через WebportRuntime.unique()");
    }
    if (callee === "Array") return "[]";
    if (callee === "Object") return "{}";
    if (callee === "Error" || callee === "TypeError" || callee === "RangeError" || callee === "TypeError") {
      return this.expr(node.arguments[0] ?? { type: "Literal", value: "" });
    }
    const args = node.arguments.map((a) => this.expr(a)).join(", ");
    return `${this.name(callee)}.new(${args})`;
  }

  template(node) {
    const parts = [];
    for (const q of node.quasis) {
      if (q.value.cooked) parts.push(this.string(q.value.cooked));
    }
    const exprs = node.expressions.map((e) => `str(${this.expr(e)})`);
    if (!exprs.length) return parts[0] ?? '""';
    const all = [];
    // сохраняем порядок quas/expr
    for (let i = 0; i < node.quasis.length; i += 1) {
      const cooked = node.quasis[i].value.cooked;
      if (cooked) all.push(this.string(cooked));
      if (node.expressions[i]) all.push(`str(${this.expr(node.expressions[i])})`);
    }
    return `(${all.join(" + ")})`;
  }

  // ── вызовы ───────────────────────────────────────────────────────────────

  /** Аргументы вычисляются лениво: иначе лямбда-аргументы ловятся как «функция вне вызова». */
  argList(node, transform) {
    return node.arguments
      .map((a, index) => {
        const code = a.type === "SpreadElement" ? this.expr(a.argument) : this.expr(a);
        return transform ? transform(code, a, index) : code;
      })
      .join(", ");
  }

  call(node) {
    if (["ArrowFunctionExpression", "FunctionExpression"].includes(node.callee?.type)) {
      return this.fail(node, "немедленно вызываемая функция (IIFE) не развёрнута; перенесите тело вручную");
    }
    const calleeText = this.calleeText(node.callee);

    const GLOBAL_OBJECTS = /^(Math|Object|Number|JSON|String|Array|Date)\./;
    if (node.callee.type === "MemberExpression" && GLOBAL_OBJECTS.test(calleeText)) {
      const resolved = this.globalBuiltin(node, calleeText);
      if (resolved !== undefined) return resolved;
    }

    if (node.callee.type === "Identifier") {
      const builtin = BUILTIN_CALLS[calleeText];
      if (builtin && !["KEYS", "VALUES", "ENTRIES"].includes(builtin)) {
        return `${builtin}(${this.argList(node)})`;
      }
      if (["KEYS", "VALUES", "ENTRIES"].includes(builtin)) {
        const fnName = { KEYS: "keys", VALUES: "values", ENTRIES: "entries" }[builtin];
        this.usedHelpers.add(fnName);
        return `${fnName}(${this.argList(node)})`;
      }
      if (calleeText === "Array.isArray") return `${this.helper("is_array")}(${this.argList(node)})`;
      if (calleeText === "structuredClone") {
        const arg = node.arguments[0];
        if (arg && arg.type === "ArrayExpression") return `([...${this.expr(arg)}] as Array)`;
        return `${this.expr(arg)}.duplicate(true)`;
      }
      if (calleeText === "fetch") {
        return this.fail(node, "fetch() — замените на WebportData.load_json(path)");
      }
      if (["setTimeout", "setInterval", "requestAnimationFrame"].includes(calleeText)) {
        return this.fail(node, `${calleeText}() — замените на таймер/сигнал процесса`);
      }
      if (["alert", "prompt", "confirm"].includes(calleeText)) {
        return this.fail(node, `${calleeText}() — замените на UI-диалог`);
      }
      if (this.importMap[calleeText]) return `${this.importMap[calleeText]}(${this.argList(node)})`;
      return `${this.name(calleeText)}(${this.argList(node)})`;
    }

    if (node.callee.type === "MemberExpression" && !node.callee.computed) {
      const method = node.callee.property.name;
      // импортированный модуль: campaign.createCampaign(...) → campaign.createCampaign(...)
      const importedRoot = node.callee.object?.type === "Identifier" ? this.importMap[node.callee.object.name] : null;
      if (importedRoot && !ARRAY_METHODS.has(method)) {
        return `${importedRoot}.${this.name(method)}(${this.argList(node)})`;
      }
      if (ARRAY_METHODS.has(method)) return this.arrayMethod(node, method);

      const obj = this.expr(node.callee.object);
      const argList = this.argList(node);

      const simple = {
        push: (o, a) => (a.startsWith("[...") ? `${o}.append_array(${a.slice(4, -6).trim()})` : `${o}.append(${a})`),
        add: (o, a) => `WebportRuntime.push_unique(${o}, ${a})`,
        unshift: (o, a) => `${o}.push_front(${a})`,
        shift: (o) => `${o}.pop_front()`,
        pop: (o) => `${o}.pop_back()`,
        slice: (o, a) => `${o}.slice(${a})`,
        indexOf: (o, a) => `${o}.find(${a})`,
        has: (o, a) => `(${a} in ${o})`,
        join: (o, a) => `${o}.join(${a || '" "'})`,
        toString: (o) => `str(${o})`,
        toLowerCase: (o) => `${o}.to_lower()`,
        toUpperCase: (o) => `${o}.to_upper()`,
        trim: (o) => `${o}.strip_edges()`,
        startsWith: (o, a) => `${o}.begins_with(${a})`,
        endsWith: (o, a) => `${o}.ends_with(${a})`,
        split: (o, a) => `${o}.split(${a})`,
        replace: (o, a) => `${o}.replace(${a})`,
        replaceAll: (o, a) => `${o}.replace(${a})`,
        charAt: (o, a) => `${o}[${a}]`,
        substring: (o, a) => `${o}.substr(${a})`,
        substr: (o, a) => `${o}.substr(${a})`,
        keys: (o) => `${o}.keys()`,
        values: (o) => `${o}.values()`,
        hasOwnProperty: (o, a) => `${o}.has(${a})`,
        concat: (o, a) => `${o} + ${a}`,
        repeat: (o, a) => `${o}.repeat(int(${a}))`,
        padStart: (o) => `${o}.pad_zeros(2)`,
        toFixed: (o, a) => `String.num(${o}, ${a || "2"})`,
        getTime: () => `Time.get_ticks_msec()`,
        localeCompare: (o, a) => `WebportRuntime.compare(${o}, ${a})`,
      };
      if (method === "includes") {
        // [..].includes(x) → x in [..]; для строк остаётся .contains()
        const arg = this.expr(node.arguments[0]);
        const objNode = node.callee.object;
        const looksArray = objNode.type === "ArrayExpression" || this.arrays.has(this.calleeText(objNode)) ||
          objNode.type === "CallExpression" && ["map", "filter", "keys", "values", "entries", "Array.from"].includes(
            objNode.callee?.property?.name ?? objNode.callee?.name);
        return looksArray ? `(${arg} in ${obj})` : `${obj}.contains(${arg})`;
      }
      if (method === "set" && node.arguments.length === 2) {
        // Map.set(k, v) → dict[k] = v (работает как инструкция)
        return `${obj}[${this.expr(node.arguments[0])}] = ${this.expr(node.arguments[1])}`;
      }
      if (method === "get") return `${obj}.get(${argList})`;
      if (method === "entries" || method === "values" || method === "keys") {
        return simple[method] ? simple[method](obj, argList) : `${obj}.${method}()`;
      }
      if (simple[method]) return simple[method](obj, argList);

      if (method === "splice") return this.fail(node, "splice — используйте insert/remove_at");
      if (["then", "catch", "finally"].includes(method)) {
        return this.fail(node, "Promise (.then/.catch) — асинхронность переносится вручную");
      }
      if (method === "addEventListener") {
        const target = this.calleeText(node.callee.object);
        const event = node.arguments[0]?.value ?? "event";
        this.todo.push({
          line: node.loc?.start?.line ?? 0,
          message: `${target}.addEventListener("${event}") — подключите через WebportEvents или сигнал сцены`,
          file: this.filename,
        });
        return "null";
      }
      if (["querySelector", "querySelectorAll", "getElementById", "appendChild", "createElement"].includes(method)) {
        return this.fail(node, `${method}() — используйте WebportDom/узлы сцены`);
      }
      return `${obj}.${this.name(method)}(${argList})`;
    }

    return `${this.expr(node.callee)}(${this.argList(node)})`;
  }

  /** Math.*, Object.*, Number.*, JSON.*, Date.* → GDScript. */
  globalBuiltin(node, calleeText) {
    const table = {
      "Math.floor": "floor", "Math.ceil": "ceil", "Math.round": "round", "Math.abs": "abs",
      "Math.min": "min", "Math.max": "max", "Math.sqrt": "sqrt", "Math.pow": "pow",
      "Math.sign": "sign", "Math.trunc": "trunc", "Math.sin": "sin", "Math.cos": "cos",
      "Math.tan": "tan", "Math.atan2": "atan2", "Math.exp": "exp", "Math.log": "log",
      "Math.hypot": "WebportRuntime.hypot",
      "Number": "float", "String": "str", "Boolean": "bool",
      "Object.keys": "keys", "Object.values": "values", "Object.entries": "entries",
    };
    if (table[calleeText]) {
      const name = table[calleeText];
      if (name === "keys" || name === "values" || name === "entries") this.usedHelpers.add(name);
      return `${name}(${this.argList(node)})`;
    }
    if (calleeText === "Math.random") return "randf()";
    if (calleeText === "Object.freeze") return this.expr(node.arguments[0]);
    if (calleeText === "Object.assign") return `${this.helper("merge")}(${this.argList(node)})`;
    if (calleeText === "Object.fromEntries") return `${this.helper("from_entries")}(${this.argList(node)})`;
    if (calleeText === "Array.isArray") return `${this.helper("is_array")}(${this.argList(node)})`;
    if (calleeText === "Number.isFinite") return `is_finite(${this.helper("num")}(${this.argList(node)}))`;
    if (calleeText === "Number.isInteger") return `${this.helper("is_integer")}(${this.argList(node)})`;
    if (calleeText === "JSON.stringify") return `JSON.stringify(${this.argList(node)})`;
    if (calleeText === "JSON.parse") return `JSON.parse_string(${this.argList(node)})`;
    if (calleeText === "Date.now") return "Time.get_ticks_msec()";
    return undefined;
  }

  /** map/filter/find/sort/reduce/... → WebportRuntime или sort_custom. */
  /** Массив со spread: [a, ...b] → ([a] + b) для Array. */
  arrayLiteral(node) {
    const plain = () => `[${node.elements.map((el) => (el ? this.expr(el) : "null")).join(", ")}]`;
    if (node.type !== "ArrayExpression" || !node.elements.some((e) => e && e.type === "SpreadElement")) {
      return plain();
    }
    const segments = [];
    let current = [];
    for (const el of node.elements) {
      if (el && el.type === "SpreadElement") {
        if (current.length) { segments.push(`[${current.join(", ")}]`); current = []; }
        segments.push(this.expr(el.argument));
      } else {
        current.push(el ? this.expr(el) : "null");
      }
    }
    if (current.length) segments.push(`[${current.join(", ")}]`);
    return segments.length === 1 ? segments[0] : `(${segments.join(" + ")})`;
  }

  arrayMethod(node, method) {
    // arr.map(...).sort(...) → WebportRuntime.map(...).sort_custom(...)
    if (node.callee.object.type === "CallExpression" &&
        ["map", "filter"].includes(node.callee.object.callee?.property?.name) && !node.callee.object.optional) {
      const inner = node.callee.object;
      const innerCode = this.arrayMethod(inner, inner.callee.property.name);
      const fnNode = node.arguments[0];
      if (method === "sort" && fnNode) {
        const lam = this.lambdaFor(fnNode, "sort");
        return `(${innerCode}).sort_custom(${lam})`;
      }
      if (method === "slice") return `(${innerCode}).slice(${this.argList(node)})`;
    }

    const obj = this.expr(node.callee.object);
    const fn = node.arguments[0];

    if (method === "sort" && !fn) return `${obj}.sort()`;
    if (!fn) return this.fail(node, `${method}() без функции-аргумента — перенесите вручную`);
    if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") {
      return `${this.helper(method)}(${obj}, ${this.expr(fn)})`;
    }

    const lam = this.lambdaFor(fn, method);

    if (method === "sort") return `${obj}.sort_custom(${lam})`;
    if (method === "reduce") {
      const init = node.arguments[1] ? this.expr(node.arguments[1]) : "null";
      return `${this.helper("reduce")}(${obj}, ${lam}, ${init})`;
    }
    if (method === "forEach") return `${this.helper("for_each")}(${obj}, ${lam})`;
    if (method === "flatMap") return `${this.helper("flat_map")}(${obj}, ${lam})`;
    const map = { map: "map", filter: "filter", some: "any", every: "all", find: "find", findIndex: "find_index" };
    return `${this.helper(map[method] ?? method)}(${obj}, ${lam})`;
  }

  lambdaFor(fn, method) {
    const params = fn.params.map((p) => (p.type === "Identifier" ? this.name(p.name) : "v"));
    const bodyCode = this.lambdaBody(fn, method);
    if (bodyCode.startsWith("lambda_method:")) return bodyCode.slice("lambda_method:".length);
    return `func(${params.join(", ")}): return ${bodyCode}`;
  }

  lambdaBody(fn, method) {
    if (fn.body.type !== "BlockStatement") return this.expr(fn.body);
    const stmts = this.blockStatements(fn.body.body);
    const retIdx = stmts.map((s) => s.trim().startsWith("return")).lastIndexOf(true);
    if (retIdx === -1) {
      this.pendingParams = [];
      this.todo.push({
        line: fn.loc?.start?.line ?? 0,
        message: `лямбда в ${method}() без return — перенесена как null`,
        file: this.filename,
      });
      return "null";
    }
    if (stmts.length === 1) return stmts[0].trim().replace(/^return\s*/, "");

    // Многострочная лямбда: выносим в метод класса, иначе inline-функция ломает скобки.
    this.lambdaSeq = (this.lambdaSeq ?? 0) + 1;
    const name = `_wb_lambda_${this.lambdaSeq}`;
    const params = fn.params.map((p) => (p.type === "Identifier" ? this.name(p.name) : "v"));
    const bodyText = stmts.join("\n");
    if (/TODO\(webport\)/.test(bodyText)) {
      // Раз есть непереносимая конструкция — не выносим: тело с TODO останется null.
      this.warn(fn, `${method}(): в лямбде есть неперенесённый код, метод ${name}() не создан`);
      return "null";
    }
    const header = `${this.classMode ? "static " : ""}func ${name}(${params.join(", ")})`;
    this.deferredBodies.push({ name, header, body: bodyText });
    this.warn(fn, `многострочная лямбда вынесена в метод ${name}() — проверьте захват внешних переменных`);
    return `lambda_method:${name}`;
  }

  // ── конструкторы ─────────────────────────────────────────────────────────

  newExpr(node) {
    const callee = this.calleeText(node.callee);
    if (callee === "Set" || callee === "WeakSet") {
      // Set → Array: membership проверяется через `in`, см. includes/has
      if (node.arguments[0]) {
        this.warn(node, "Set → Array (для .has() используется оператор in)");
        return `(${this.expr(node.arguments[0])} as Array)`;
      }
      return "[]";
    }
    if (callee === "Map" || callee === "WeakMap") {
      this.warn(node, "Map → Dictionary");
      return "{}";
    }
    if (callee === "Array") return "[]";
    if (callee === "Object") return "{}";
    if (["Error", "TypeError", "RangeError", "TypeError"].includes(callee)) {
      return node.arguments[0] ? this.expr(node.arguments[0]) : '""';
    }
    return `${this.name(callee)}.new(${this.argList(node)})`;
  }
}

export function convertJs(source, opts = {}) {
  const conv = new Converter(opts);
  return conv.convert(source, { module: opts.module ?? true });
}
