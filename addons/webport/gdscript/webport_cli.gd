# WebportCli — вызывает Node-сборщик из редактора Redot.
#
# Редакторский плагин не может парсить JS, поэтому вся тяжёлая работа
# идёт в отдельном процессе Node. Здесь только запуск и разбор вывода.
extends RefCounted

const NODE_BINARY := "node"


## Проверяет, чем запускать сборщик, и версию Node.
## Возвращает {"ok": bool, "node": String, "message": String}.
static func probe(plugin_dir: String) -> Dictionary:
	var script_path: String = plugin_dir.path_join("tools/build_project.mjs")
	if not FileAccess.file_exists(script_path):
		return {"ok": false, "node": "", "message": "не найден %s — каталог tools должен лежать рядом с plugin.cfg" % script_path}
	var out: Array = []
	var code: int = OS.execute(NODE_BINARY, ["--version"], out, true)
	if code != 0:
		return {"ok": false, "node": "", "message": "Node.js не найден в PATH. Нужен Node 18+ (проверьте `node --version`)."}
	var version: String = "?"
	if out.size() > 0:
		version = str(out[0]).strip_edges()
	return {"ok": true, "node": version, "message": "Node доступен"}


## Запускает сборку проекта из браузерной игры.
## Возвращает {"ok": bool, "output": String, "exit_code": int}.
static func build(plugin_dir: String, source_path: String, out_path: String, extra_args: PackedStringArray = PackedStringArray()) -> Dictionary:
	if source_path.is_empty() or not DirAccess.dir_exists_absolute(source_path):
		return {"ok": false, "output": "каталог исходников не найден: " + source_path, "exit_code": -1}
	if out_path.is_empty():
		return {"ok": false, "output": "не выбран каталог для проекта Redot", "exit_code": -1}
	var script_path: String = plugin_dir.path_join("tools/build_project.mjs")
	if not FileAccess.file_exists(script_path):
		return {"ok": false, "output": "не найден сборщик: " + script_path, "exit_code": -1}

	var args := PackedStringArray([script_path, "--source", source_path, "--out", out_path])
	args.append_array(extra_args)
	var output: Array = []
	var code: int = OS.execute(NODE_BINARY, args, output, true)
	var text := ""
	for line in output:
		text += str(line) + "\n"
	return {"ok": code == 0, "output": text, "exit_code": code}


## Открывает машиночитаемый отчёт после сборки.
static func open_report(out_path: String) -> void:
	var report: String = out_path.path_join("webport/report.json")
	if FileAccess.file_exists(report):
		OS.shell_open(report)
	else:
		push_warning("WebPort: отчёт не найден — сначала выполните сборку")
