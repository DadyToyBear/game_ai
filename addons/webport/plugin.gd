@tool
# WebportPlugin — редакторский плагин «WebPort».
#
# Что делает в редакторе:
#   • добавляет док-панель (Project → Tools → WebPort);
#   • меню «Проект → WebPort» с быстрыми командами;
#   • настройки проекта в разделе webport/*.
#
# Сам перенос выполняет Node-сборщик (tools/build_project.mjs): GDScript в
# редакторе не умеет разбирать JS и CSS, поэтому плагин честно вызывает внешний процесс.
extends EditorPlugin

const PANEL_SCRIPT := "res://addons/webport/gdscript/webport_panel.gd"

var _panel: Control
var _plugin_dir := ""


func _enter_tree() -> void:
	_plugin_dir = get_script().resource_path.get_base_dir()
	_register_settings()
	_build_panel()
	add_tool_menu_item("WebPort: открыть панель переноса", _show_panel)


func _exit_tree() -> void:
	remove_tool_menu_item("WebPort: открыть панель переноса")
	if is_instance_valid(_panel):
		remove_control_from_bottom_panel(_panel)
		_panel.queue_free()


func _register_settings() -> void:
	_add_setting("webport/source_path", "", PROPERTY_HINT_GLOBAL_DIR, "путь к каталогу веб-игры")
	_add_setting("webport/out_path", "", PROPERTY_HINT_GLOBAL_DIR, "каталог проекта Redot для сборки")
	_add_setting("webport/copy_assets", true, PROPERTY_HINT_NONE, "копировать картинки и звук в проект")
	_add_setting("webport/reload_after_build", true, PROPERTY_HINT_NONE, "обновлять файловую систему после сборки")
	_add_setting("webport/serve_port", 8123, PROPERTY_HINT_RANGE, "порт локальной страницы проверки")


func _add_setting(key: String, default_value: Variant, hint: int, hint_string: String) -> void:
	if ProjectSettings.has_setting(key):
		return
	ProjectSettings.set_setting(key, default_value)
	ProjectSettings.add_property_info({
		"name": key,
		"type": typeof(default_value),
		"hint": hint,
		"hint_string": hint_string,
	})
	ProjectSettings.set_initial_value(key, default_value)


func _build_panel() -> void:
	_panel = VBoxContainer.new()
	_panel.name = "WebPort"
	_panel.set_script(load(PANEL_SCRIPT))
	if _panel.has_method("setup"):
		_panel.call("setup", _plugin_dir)
	add_control_to_bottom_panel(_panel, "WebPort")


func _show_panel() -> void:
	if is_instance_valid(_panel):
		make_bottom_panel_item_visible(_panel)
