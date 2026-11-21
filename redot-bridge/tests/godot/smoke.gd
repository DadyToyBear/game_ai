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
	var buffer: Logger = load("res://addons/redot_android_mcp/log_buffer.gd").new()
	var fake_secret := "fake-secret-012345678901234567890123456789"
	buffer.call("configure", fake_secret)
	OS.add_logger(buffer)
	print("logger smoke test ", fake_secret)
	push_warning("logger smoke warning")
	OS.remove_logger(buffer)
	var entries: Array = []
	for _i in range(50):
		var batch: Array = buffer.call("take_batch")
		if batch.is_empty():
			break
		entries.append_array(batch)
	var found_message := false
	var found_warning := false
	for entry in entries:
		if entry["message"].contains(fake_secret):
			push_error("Logger leaked the bridge secret")
			quit(1)
			return
		if entry["message"].contains("logger smoke test") and entry["message"].contains("[bridge secret]"):
			found_message = true
		if entry["message"].contains("logger smoke warning"):
			found_warning = true
	buffer.call("clear")
	if not found_message or not found_warning:
		push_error("Logger did not capture expected messages")
		quit(1)
		return
	print("Redot bridge scripts compiled and logger smoke test passed")
	quit(0)
