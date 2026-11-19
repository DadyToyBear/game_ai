# WebportPanel — док-панель редактора: «Мост Redot ↔ браузерная игра».
#
# Здесь всё, что нужно для повторяемого переноса:
#   • путь к веб-игре и путь к проекту Redot;
#   • кнопка «Собрать» (вызывает Node-сборщик и печатает его вывод);
#   • сводка последней сборки из webport/report.json;
#   • быстрые переключатели: копировать ассеты, открыть отчёт, сервер проверки.
extends VBoxContainer

signal build_requested(source: String, out_path: String, extra: PackedStringArray)

const SETTINGS_SECTION := "webport"

var _source_edit: LineEdit
var _out_edit: LineEdit
var _only_edit: LineEdit
var _build_button: Button
var _report_button: Button
var _serve_button: Button
var _copy_assets: CheckBox
var _log: RichTextLabel
var _summary: RichTextLabel
var _status: Label
var _build_timer: Timer
var _build_pid := -1
var _build_status_file := ""
var _build_out_path := ""
var _build_source_path := ""
var _build_extra_args := PackedStringArray()

var _plugin_dir := ""


func setup(plugin_dir: String) -> void:
	_plugin_dir = plugin_dir
	_build_ui()
	_restore_settings()
	var probe: Dictionary = load("res://addons/webport/gdscript/webport_cli.gd").probe(_plugin_dir)
	if probe["ok"]:
		_set_status("Node %s — готово к сборке" % probe["node"], Color(0.62, 0.78, 0.45))
	else:
		_set_status(str(probe["message"]), Color(0.9, 0.5, 0.4))
	_build_button.disabled = not probe["ok"]


func _build_ui() -> void:
	add_theme_constant_override("separation", 6)
	_build_timer = Timer.new()
	_build_timer.wait_time = 0.25
	_build_timer.timeout.connect(_poll_build_status)
	add_child(_build_timer)

	var title := Label.new()
	title.text = "WebPort — перенос браузерной игры в Redot"
	title.add_theme_font_size_override("font_size", 14)
	add_child(title)

	add_child(HSeparator.new())

	_source_edit = _add_path_row("Веб-игра (HTML/JS):", "webport/source_path", _pick_source)
	_out_edit = _add_path_row("Проект Redot (куда):", "webport/out_path", _pick_out)
	_only_edit = LineEdit.new()
	_only_edit.placeholder_text = "Все экраны или фильтр, например viewer/game.html"
	_only_edit.tooltip_text = "Оставьте пустым для всех HTML-страниц. Модули, JSON и ассеты сохраняются."
	_only_edit.text = str(ProjectSettings.get_setting("webport/only_filter", ""))
	_only_edit.text_changed.connect(func(value: String) -> void: _store_setting("webport/only_filter", value))
	add_child(_labeled_control("HTML-экраны:", _only_edit))

	var options := HBoxContainer.new()
	_copy_assets = CheckBox.new()
	_copy_assets.text = "копировать ассеты"
	_copy_assets.button_pressed = true
	_copy_assets.tooltip_text = "Выключите для быстрой проверки структуры: сборка станет в разы быстрее."
	_copy_assets.toggled.connect(func(value: bool) -> void: _store_setting("webport/copy_assets", value))
	options.add_child(_copy_assets)
	add_child(options)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 6)
	_build_button = Button.new()
	_build_button.text = "Собрать проект"
	_build_button.tooltip_text = "HTML/CSS → сцены .tscn, JS → GDScript, JSON и ассеты → в проект Redot"
	_build_button.pressed.connect(_on_build_pressed)
	buttons.add_child(_build_button)

	_report_button = Button.new()
	_report_button.text = "Отчёт"
	_report_button.tooltip_text = "Открыть webport/report.json в системном приложении"
	_report_button.pressed.connect(_on_report_pressed)
	buttons.add_child(_report_button)

	_serve_button = Button.new()
	_serve_button.text = "Проверка"
	_serve_button.tooltip_text = "Открыть локальную страницу проверки перенесённых сцен"
	_serve_button.pressed.connect(_on_serve_pressed)
	buttons.add_child(_serve_button)
	add_child(buttons)

	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)

	_summary = RichTextLabel.new()
	_summary.bbcode_enabled = true
	_summary.fit_content = true
	_summary.custom_minimum_size = Vector2(0, 84)
	add_child(_summary)

	_log = RichTextLabel.new()
	_log.bbcode_enabled = true
	_log.scroll_following = true
	_log.custom_minimum_size = Vector2(0, 160)
	_log.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_log)


func _add_path_row(label_text: String, setting_key: String, picker: Callable) -> LineEdit:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = label_text
	label.custom_minimum_size = Vector2(150, 0)
	row.add_child(label)

	var edit := LineEdit.new()
	edit.placeholder_text = "/путь/к/каталогу"
	edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	edit.text_changed.connect(func(value: String) -> void: _store_setting(setting_key, value))
	row.add_child(edit)

	var browse := Button.new()
	browse.text = "..."
	browse.pressed.connect(func() -> void: picker.call(edit))
	row.add_child(browse)

	add_child(row)
	return edit


func _labeled_control(label_text: String, control: Control) -> HBoxContainer:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = label_text
	label.custom_minimum_size = Vector2(150, 0)
	row.add_child(label)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(control)
	return row


func _pick_source(edit: LineEdit) -> void:
	var dialog := EditorFileDialog.new()
	dialog.file_mode = EditorFileDialog.FILE_MODE_OPEN_DIR
	dialog.access = EditorFileDialog.ACCESS_FILESYSTEM
	dialog.dir_selected.connect(func(path: String) -> void:
		edit.text = path
		_store_setting("webport/source_path", path))
	add_child(dialog)
	dialog.popup_centered_ratio(0.5)


func _pick_out(edit: LineEdit) -> void:
	var dialog := EditorFileDialog.new()
	dialog.file_mode = EditorFileDialog.FILE_MODE_OPEN_DIR
	dialog.access = EditorFileDialog.ACCESS_FILESYSTEM
	dialog.dir_selected.connect(func(path: String) -> void:
		edit.text = path
		_store_setting("webport/out_path", path))
	add_child(dialog)
	dialog.popup_centered_ratio(0.5)


func _on_build_pressed() -> void:
	var out_path := _out_edit.text.strip_edges()
	if out_path.is_empty():
		_set_status("Укажите каталог проекта Redot", Color(0.9, 0.6, 0.35))
		return
	var extra := PackedStringArray()
	var only_filter := _only_edit.text.strip_edges()
	if not only_filter.is_empty():
		extra.append_array(PackedStringArray(["--only", only_filter]))
	if not _copy_assets.button_pressed:
		extra.append("--no-copy-assets")
	_build_button.disabled = true
	_set_status("Сборка запущена в фоне…", Color(0.8, 0.75, 0.55))
	_log.clear()
	var cli = load("res://addons/webport/gdscript/webport_cli.gd")
	var result: Dictionary = cli.start_build(
		_plugin_dir, _source_edit.text.strip_edges(), out_path, extra)
	if not result["ok"]:
		_build_button.disabled = false
		_set_status(str(result.get("message", "Не удалось запустить сборку")), Color(0.9, 0.45, 0.4))
		_log.append_text(_colorize(str(result.get("message", "Ошибка запуска сборки"))))
		build_requested.emit(_source_edit.text.strip_edges(), out_path, extra)
		return
	_build_pid = int(result["pid"])
	_build_status_file = str(result["status_file"])
	_build_out_path = out_path
	_build_source_path = _source_edit.text.strip_edges()
	_build_extra_args = extra.duplicate()
	_build_timer.start()


func _poll_build_status() -> void:
	if _build_status_file.is_empty():
		return
	if not FileAccess.file_exists(_build_status_file):
		if _build_pid > 0 and not OS.is_process_running(_build_pid):
			_build_timer.stop()
			_build_button.disabled = false
			_set_status("Сборщик завершился без отчёта о результате", Color(0.9, 0.45, 0.4))
			_log.append_text(_colorize("Фоновый процесс завершился до записи status-файла"))
			_build_pid = -1
			_build_status_file = ""
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(_build_status_file))
	if not (data is Dictionary):
		if _build_pid > 0 and not OS.is_process_running(_build_pid):
			_build_timer.stop()
			_build_button.disabled = false
			_set_status("Не удалось прочитать результат сборки", Color(0.9, 0.45, 0.4))
			_build_pid = -1
			_build_status_file = ""
		return
	var state := str(data.get("state", "running"))
	if state == "running":
		return
	_build_timer.stop()
	_build_button.disabled = false
	_log.append_text(_colorize(str(data.get("output", ""))))
	if state == "done":
		_set_status("Готово: проект собран", Color(0.62, 0.78, 0.45))
		_refresh_summary(_build_out_path.path_join("webport/report.json"))
		if ProjectSettings.get_setting("webport/reload_after_build", true):
			EditorInterface.get_resource_filesystem().scan()
	else:
		_set_status("Сборка завершилась с ошибкой", Color(0.9, 0.45, 0.4))
	DirAccess.remove_absolute(_build_status_file)
	build_requested.emit(_build_source_path, _build_out_path, _build_extra_args)
	_build_pid = -1
	_build_status_file = ""
	_build_out_path = ""
	_build_source_path = ""
	_build_extra_args = PackedStringArray()


func _on_report_pressed() -> void:
	load("res://addons/webport/gdscript/webport_cli.gd").open_report(_out_edit.text.strip_edges())


func _on_serve_pressed() -> void:
	var out_path := _out_edit.text.strip_edges()
	var serve_script: String = _plugin_dir.path_join("tools/serve.mjs")
	var args := PackedStringArray([serve_script, "--project", out_path, "--port", str(ProjectSettings.get_setting("webport/serve_port", 8123))])
	var pid: int = OS.create_process("node", args)
	if pid > 0:
		_set_status("Сервер проверки запущен на порту %s" % str(ProjectSettings.get_setting("webport/serve_port", 8123)), Color(0.62, 0.78, 0.45))
		OS.shell_open("http://127.0.0.1:%s/" % str(ProjectSettings.get_setting("webport/serve_port", 8123)))
	else:
		_set_status("Не удалось запустить сервер проверки", Color(0.9, 0.45, 0.4))


func _refresh_summary(report_path: String) -> void:
	if not FileAccess.file_exists(report_path):
		_summary.text = "[color=#b8b09d]Отчёт не найден.[/color]"
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(report_path))
	if not (data is Dictionary):
		_summary.text = "[color=#df8074]Отчёт повреждён.[/color]"
		return
	var summary: Dictionary = data.get("summary", {})
	_summary.text = (
		"[b]Экранов:[/b] %s   [b]Модулей:[/b] %s   [b]Строк GDScript:[/b] %s\n"
		+ "[b]Ассетов:[/b] %s   [b]Данных:[/b] %s\n"
		+ "[b]TODO:[/b] [color=#e0b866]%s[/color]   [b]Предупреждений:[/b] %s   [b]Ошибок линтера:[/b] [color=#df8074]%s[/color]"
	) % [
		str(summary.get("screens", 0)), str(summary.get("modules", 0)), str(summary.get("gdLines", 0)),
		str(summary.get("assetsCopied", 0)), str(summary.get("dataFiles", 0)),
		str(summary.get("todo", 0)), str(summary.get("warnings", 0)), str(summary.get("lintErrors", 0)),
	]


func _set_status(text: String, color: Color) -> void:
	_status.text = text
	_status.add_theme_color_override("font_color", color)


func _colorize(output: String) -> String:
	var lines := output.split("\n")
	var out := ""
	for line in lines:
		if line.begins_with("Экранов") or line.begins_with("Готово"):
			out += "[color=#9dc46f]%s[/color]\n" % line
		elif line.contains("ошиб") or line.contains("FAIL") or line.contains("Error"):
			out += "[color=#df8074]%s[/color]\n" % line
		elif line.contains("Замечани") or line.contains("требуют"):
			out += "[color=#e0b866]%s[/color]\n" % line
		else:
			out += line + "\n"
	return out


func _restore_settings() -> void:
	_source_edit.text = str(ProjectSettings.get_setting("webport/source_path", ""))
	_out_edit.text = str(ProjectSettings.get_setting("webport/out_path", ""))
	_only_edit.text = str(ProjectSettings.get_setting("webport/only_filter", ""))
	_copy_assets.button_pressed = bool(ProjectSettings.get_setting("webport/copy_assets", true))
	if not _out_edit.text.is_empty():
		_refresh_summary(_out_edit.text.path_join("webport/report.json"))


func _store_setting(key: String, value: Variant) -> void:
	ProjectSettings.set_setting(key, value)
	if key == "webport/copy_assets":
		_copy_assets.button_pressed = bool(value)
