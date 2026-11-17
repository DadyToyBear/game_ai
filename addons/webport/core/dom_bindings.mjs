/**
 * dom_bindings.mjs — генерирует GDScript-обвязку «id из HTML → узел Godot».
 *
 * Зачем: в веб-версии код обращается к элементам по id. В Godot таких id нет,
 * но есть путь узла. Мы сохраняем привычный способ обращения:
 *
 *   var bar := ui("resourceBar")     # вернёт узел res://…/ResourceBar
 *   ui_set(ui("realmName"), "text", "Дом Кэрна")
 *
 * Таблица путей лежит в webport/dom_links.json и подхватывается автозагрузкой.
 */

export function buildBindings(nodePaths, { autoload = "WebportLinks" } = {}) {
  const entries = [...nodePaths.entries()]
    .map(([id, node]) => `\t"${id}": "${node.replace(/"/g, '\\"')}",`)
    .join("\n");

  return `# Таблица id → имя узла в сцене (генерируется WebPort).
const DOM_IDS := {
${entries || '\t# (в HTML не было элементов с id)'}
}


# Узел по id из исходного HTML. Возвращает null, если элемент не перенесён.
func ui(id: String) -> Node:
	if not DOM_IDS.has(id):
		return null
	var path: String = DOM_IDS[id]
	if not path.begins_with("/"):
		path = get_path() + "/" + path
	return get_node_or_null(path)


# Универсальный сеттер: ui_set("realmName", "text", "Дом Кэрна").
func ui_set(id: String, property: String, value: Variant) -> bool:
	var node := ui(id)
	if node == null:
		push_warning("WebPort: элемент #%s не найден в сцене" % id)
		return false
	node.set(property, value)
	return true


func ui_text(id: String) -> String:
	var node := ui(id)
	return str(node.text) if node != null and "text" in node else ""


func ui_visible(id: String, value: bool) -> void:
	var node := ui(id)
	if node != null:
		node.visible = value
`;
}
