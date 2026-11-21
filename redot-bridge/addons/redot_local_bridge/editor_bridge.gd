@tool
extends EditorPlugin

const BRIDGE_URL := "http://127.0.0.1:8765/api/editor/poll"
var _request: HTTPRequest
var _timer: Timer
var _token := ""
var _request_pending := false

func _enter_tree() -> void:
	if OS.get_environment("REDOT_BRIDGE_ENABLED") != "1":
		print("[RedotLocalBridge] Inactive: REDOT_BRIDGE_ENABLED is not 1.")
		return
	_token = OS.get_environment("REDOT_BRIDGE_TOKEN")
	if _token.length() < 32:
		push_warning("Redot Local Bridge: missing or short REDOT_BRIDGE_TOKEN; controls are inactive.")
		return
	_request = HTTPRequest.new()
	_request.timeout = 3.0
	add_child(_request)
	_request.request_completed.connect(_on_poll_completed)
	_timer = Timer.new()
	_timer.wait_time = 0.5
	_timer.autostart = true
	add_child(_timer)
	_timer.timeout.connect(_poll)
	print("[RedotLocalBridge] Local editor bridge enabled.")

func _poll() -> void:
	if _request_pending:
		return
	var headers := PackedStringArray(["Authorization: Bearer " + _token, "Content-Type: application/json"])
	var body := JSON.stringify({"playing": EditorInterface.is_playing_scene()})
	_request_pending = true
	var error := _request.request(BRIDGE_URL, headers, HTTPClient.METHOD_POST, body)
	if error != OK:
		_request_pending = false

func _on_poll_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	_request_pending = false
	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		return
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if not parsed is Dictionary:
		return
	var command: String = str(parsed.get("command", ""))
	if command == "play":
		if not EditorInterface.is_playing_scene():
			EditorInterface.play_main_scene()
	elif command == "stop":
		if EditorInterface.is_playing_scene():
			EditorInterface.stop_playing_scene()

func _exit_tree() -> void:
	if is_instance_valid(_timer):
		_timer.stop()
		_timer.queue_free()
	if is_instance_valid(_request):
		_request.cancel_request()
		_request.queue_free()
	_token = ""
