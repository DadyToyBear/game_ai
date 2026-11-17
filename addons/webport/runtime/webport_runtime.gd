# WebPortRuntime — аналоги JS-функций, которых нет в GDScript.
#
# Подключается сгенерированным кодом как:
#   const WebportRuntime := preload("res://addons/webport/runtime/webport_runtime.gd")
#
# Все функции статические: WebportRuntime.map(...), WebportRuntime.compare(...).
# Реализация намеренно простая и предсказуемая — это переходный слой,
# а не попытка воспроизвести весь стандарт JavaScript.
extends RefCounted

const EPSILON := 1e-9


# ── массивы: аналоги Array.prototype ────────────────────────────────────────

static func map(items: Variant, fn: Callable) -> Array:
	var out := []
	if not (items is Array or items is PackedStringArray):
		return out
	var index := 0
	for item in items:
		out.append(fn.call(item, index))
		index += 1
	return out


static func filter(items: Variant, fn: Callable) -> Array:
	var out := []
	if not (items is Array or items is PackedStringArray):
		return out
	var index := 0
	for item in items:
		if fn.call(item, index):
			out.append(item)
		index += 1
	return out


static func for_each(items: Variant, fn: Callable) -> void:
	var index := 0
	for item in items:
		fn.call(item, index)
		index += 1


static func any(items: Variant, fn: Callable) -> bool:
	var index := 0
	for item in items:
		if fn.call(item, index):
			return true
		index += 1
	return false


static func all(items: Variant, fn: Callable) -> bool:
	var index := 0
	for item in items:
		if not fn.call(item, index):
			return false
		index += 1
	return true


static func find(items: Variant, fn: Callable) -> Variant:
	var index := 0
	for item in items:
		if fn.call(item, index):
			return item
		index += 1
	return null


static func find_index(items: Variant, fn: Callable) -> int:
	var index := 0
	for item in items:
		if fn.call(item, index):
			return index
		index += 1
	return -1


static func reduce(items: Variant, fn: Callable, initial: Variant = null) -> Variant:
	var acc: Variant = initial
	var index := 0
	var started := initial != null
	for item in items:
		if not started:
			acc = item
			started = true
			index += 1
			continue
		acc = fn.call(acc, item, index)
		index += 1
	return acc


static func flat_map(items: Variant, fn: Callable) -> Array:
	var out := []
	var index := 0
	for item in items:
		var part: Variant = fn.call(item, index)
		if part is Array:
			out.append_array(part)
		elif part != null:
			out.append(part)
		index += 1
	return out


static func push_unique(target: Array, value: Variant) -> Array:
	if not target.has(value):
		target.append(value)
	return target


## Пары [ключ, значение] для `for (const [k, v] of coll)`.
## Работает и для Dictionary, и для массива пар — JS-код не различает эти случаи.
static func iter_pairs(collection: Variant) -> Array:
	var out := []
	if collection is Dictionary:
		for key in collection.keys():
			out.append([key, collection[key]])
		return out
	if collection is Array:
		for index in range(collection.size()):
			var item: Variant = collection[index]
			if item is Array and item.size() >= 2:
				out.append([item[0], item[1]])
			elif item is Array and item.size() == 1:
				out.append([item[0], null])
			else:
				out.append([index, item])
	return out


# ── объекты: аналоги Object.* ───────────────────────────────────────────────

static func merge(target: Dictionary, source: Dictionary) -> Dictionary:
	target.merge(source, true)
	return target


static func from_entries(entries: Variant) -> Dictionary:
	var out := {}
	if entries is Array:
		for pair in entries:
			if pair is Array and pair.size() >= 2:
				out[pair[0]] = pair[1]
	return out


static func is_array(value: Variant) -> bool:
	return value is Array or value is PackedStringArray


static func is_integer(value: Variant) -> bool:
	if value is int:
		return true
	if value is float:
		return is_equal_approx(value, round(value))
	return false


# ── DOM-совместимый слой ────────────────────────────────────────────────────
#
# Присваивания вида el.textContent = x превращаются в set_dom("id", "textContent", x).
# Узел ищется по таблице id → путь из WebportLinks; если узел — Label/Button,
# значение кладётся в свойство text, иначе в metadata["webport_" + prop].

static func set_dom(node_id: String, prop: String, value: Variant) -> bool:
	if node_id.is_empty():
		return false
	var node: Node = null
	var root := Engine.get_main_loop()
	if root is SceneTree:
		var current := (root as SceneTree).current_scene
		if current != null:
			node = current.find_child(node_id, true, false)
	if node == null:
		# имя узла могло быть нормализовано (resourceBar → ResourceBar)
		if root is SceneTree and (root as SceneTree).current_scene != null:
			node = (root as SceneTree).current_scene.find_child(_pascal(node_id), true, false)
	if node == null:
		return false
	match prop:
		"textContent", "innerText":
			if "text" in node:
				node.set("text", str(value))
			else:
				node.set_meta("webport_text", str(value))
		"innerHTML":
			if "text" in node:
				node.set("text", str(value))
			node.set_meta("webport_html", str(value))
		"value":
			if "value" in node:
				node.set("value", value)
			else:
				node.set_meta("webport_value", value)
		"checked":
			if "button_pressed" in node:
				node.set("button_pressed", bool(value))
		"disabled":
			if "disabled" in node:
				node.set("disabled", bool(value))
		"src":
			node.set_meta("webport_src", str(value))
		"className":
			node.set_meta("webport_class", str(value))
		_:
			node.set_meta("webport_" + prop, value)
	return true


static func _pascal(value: String) -> String:
	var out := ""
	for part in value.split("_", false):
		if part.length() > 0:
			out += part.substr(0, 1).to_upper() + part.substr(1)
	return out


# ── числа и значения ────────────────────────────────────────────────────────

## Деление как в JS: 3/2 == 1.5. В GDScript int/int даёт int — это тихая ошибка при переносе.
static func div(a: Variant, b: Variant) -> float:
	var denominator := num(b)
	if is_zero_approx(denominator):
		return INF
	return num(a) / denominator


## Приведение к числу как Number(x) в JS: без него is_finite("12") не работает.
static func num(value: Variant) -> float:
	if value is float or value is int:
		return float(value)
	if value is bool:
		return 1.0 if value else 0.0
	if value is String or value is StringName:
		return float(value) if str(value).is_valid_float() else NAN
	return NAN


static func hypot(a: float, b: float) -> float:
	return sqrt(a * a + b * b)


static func typeof(value: Variant) -> String:
	# Строки имён совпадают с результатом JS typeof — код сравнивает с "object"/"string"/"number".
	if value == null:
		return "null"
	if value is bool:
		return "boolean"
	if value is int or value is float:
		return "number"
	if value is String or value is StringName:
		return "string"
	if value is Callable:
		return "function"
	if value is Dictionary or value is Object:
		return "object"
	return "object"


static func compare(a: Variant, b: Variant) -> int:
	# Аналог (a > b) - (a < b): localeCompare и sort_custom ждут int.
	if a == b:
		return 0
	if a is String or b is String:
		return -1 if str(a) < str(b) else 1
	return -1 if float(a) < float(b) else 1


static func or_default(value: Variant, fallback: Variant) -> Variant:
	return value if value else fallback


static func and_default(value: Variant, fallback: Variant) -> Variant:
	return fallback if value else value


static func clone(value: Variant) -> Variant:
	return value.duplicate(true) if value is Dictionary or value is Array else value
