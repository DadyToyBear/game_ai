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
	var config: Script = load("res://addons/redot_android_mcp/connection_config.gd")
	if config.call("base_url", "http://127.0.0.1:8765/") != "http://127.0.0.1:8765" or config.call("base_url", "https://relay.example.org/") != "https://relay.example.org":
		push_error("Valid bridge origins rejected")
		quit(1)
		return
	for bad in ["http://relay.example.org", "https://user@relay.example.org", "https://relay.example.org/path", "https://relay.example.org:99999", "https://relay.example.org?token=x"]:
		if config.call("base_url", bad) != "":
			push_error("Unsafe origin accepted: " + bad)
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
