# WebportLinks — автозагрузка (autoload) с таблицей «id из HTML → путь к узлу».
#
# Генерируется в проект скриптом build_project.mjs. Если вам нужно обращаться
# к элементам веб-интерфейса по их html-id, используйте:
#
#   WebportLinks.ui("resourceBar")
#   WebportLinks.set_prop("realmName", "text", "Дом Кэрна")
#
# Таблица читается из res://webport/dom_links.json: {"res://scenes/Game.tscn": {"id": "Node"}}.
extends Node

const LINKS_PATH := "res://webport/dom_links.json"

var _tables: Dictionary = {}


func _ready() -> void:
	if not FileAccess.file_exists(LINKS_PATH):
		return
	var text := FileAccess.get_file_as_string(LINKS_PATH)
	var data: Variant = JSON.parse_string(text)
	if data is Dictionary:
		_tables = data


func has_table(scene_path: String) -> bool:
	return _tables.has(scene_path)


func node_name_for(scene_path: String, id: String) -> String:
	var table: Dictionary = _tables.get(scene_path, {})
	return str(table.get(id, ""))


## Ищет узел по html-id: сначала в текущей сцене, затем по таблице путей.
func ui(id: String) -> Node:
	var tree := get_tree()
	if tree == null:
		return null
	var current := tree.current_scene
	if current == null:
		return null
	var direct := current.find_child(id, true, false)
	if direct != null:
		return direct
	for scene_path in _tables.keys():
		var table: Dictionary = _tables[scene_path]
		if not table.has(id):
			continue
		var path: String = str(table[id])
		var found := current.get_node_or_null(NodePath(path))
		if found != null:
			return found
		# Older dom_links.json snapshots stored only a node name; keep that
		# fallback while preferring exact paths for nested and scroll-wrapped IDs.
		found = current.find_child(path.split("/")[-1], true, false)
		if found != null:
			return found
	return null


func set_prop(id: String, property: String, value: Variant) -> bool:
	var node := ui(id)
	if node == null:
		push_warning("WebportLinks: #%s не найден" % id)
		return false
	node.set(property, value)
	return true
