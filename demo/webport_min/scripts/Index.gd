const WebportRuntime := preload("res://addons/webport/runtime/webport_runtime.gd")

# Сгенерировано WebPort (addons/webport) из index.html:inline.
# Правьте JS-исходник и пересобирайте: ручные правки здесь потеряются.
extends Node

const campaign := preload("res://webport/src/campaign.gd")  # import "./src/campaign.mjs"
var state := campaign.createCampaign({"gold": 120, "army": ["swords", "archers"]})
static func render():
	WebportRuntime.set_dom("gold", "textContent", state.gold)
	WebportRuntime.set_dom("army", "textContent", state.army.size())
	WebportRuntime.set_dom("log", "innerHTML", WebportRuntime.map(state.log, func(line): return "").join(""))

# Код верхнего уровня из index.html:inline: в GDScript у модуля нет «точки старта».
# Вызовите webport_top_level() из _ready() нужной сцены, если эти эффекты нужны.
static func webport_top_level():
	pass  # TODO(webport): .addEventListener("click") — подключите через WebportEvents или сигнал сцены
	render()
# ── связка DOM → узлы Godot (генерируется WebPort) ──
# Таблица id → имя узла в сцене (генерируется WebPort).
const DOM_IDS := {
	"game": "Game",
	"gold": "Gold",
	"army": "Army",
	"endTurn": "EndTurn",
	"layout": "Layout",
	"field": "Field",
	"sidebar": "Sidebar",
	"log": "Log",
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
