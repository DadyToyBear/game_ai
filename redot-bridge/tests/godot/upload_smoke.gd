extends SceneTree

const TEST_SECRET := "fake-secret-012345678901234567890123456789"
var uploader: Node

func _initialize() -> void:
	call_deferred("_run_test")

func _run_test() -> void:
	var port := ""
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--test-port="):
			port = argument.trim_prefix("--test-port=")
	if port.is_empty():
		push_error("Missing smoke test port")
		quit(1)
		return
	uploader = load("res://addons/redot_android_mcp/log_uploader.gd").new()
	root.add_child(uploader)
	uploader.call("start", "http://127.0.0.1:" + port, TEST_SECRET, "game")
	print("upload-smoke-marker ", TEST_SECRET)
	await create_timer(2.5).timeout
	root.remove_child(uploader)
	uploader.free()
	quit(0)
