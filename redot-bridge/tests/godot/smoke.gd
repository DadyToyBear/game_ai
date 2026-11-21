extends SceneTree

func _initialize() -> void:
	var paths := [
		"res://addons/redot_android_mcp/android_mcp.gd",
		"res://addons/redot_android_mcp/game_capture.gd",
		"res://addons/redot_local_bridge/editor_bridge.gd",
		"res://addons/redot_local_bridge/game_bridge.gd",
	]
	for path in paths:
		var script: Script = load(path)
		if script == null or not script.can_instantiate():
			push_error("Could not compile " + path)
			quit(1)
			return
	var capture: Node = load("res://addons/redot_android_mcp/game_capture.gd").new()
	if not capture.call("_valid_secret", "x".repeat(32)) or capture.call("_valid_secret", "short") or capture.call("_valid_secret", "x".repeat(32) + " ") or capture.call("_valid_secret", "x".repeat(32) + "\n"):
		push_error("Secret validation failed")
		capture.free()
		quit(1)
		return
	capture.free()
	print("Redot bridge scripts compiled and secret validation passed")
	quit(0)
