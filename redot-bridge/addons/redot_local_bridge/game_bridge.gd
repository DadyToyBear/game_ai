extends Node

# Add as an autoload manually for development; do not ship it with releases.
const BRIDGE_URL := "http://127.0.0.1:8765/api/frame"
const MAX_WIDTH := 960
var _request: HTTPRequest
var _timer: Timer
var _token := ""
var _capturing := false
var _request_pending := false

func _ready() -> void:
	if OS.get_environment("REDOT_BRIDGE_ENABLED") != "1" or not OS.is_debug_build():
		return
	_token = OS.get_environment("REDOT_BRIDGE_TOKEN")
	if _token.length() < 32:
		push_warning("Redot Local Bridge: missing or short REDOT_BRIDGE_TOKEN; capture is inactive.")
		return
	_request = HTTPRequest.new()
	_request.timeout = 3.0
	add_child(_request)
	_request.request_completed.connect(_on_frame_uploaded)
	_timer = Timer.new()
	_timer.wait_time = 0.5
	_timer.autostart = true
	add_child(_timer)
	_timer.timeout.connect(_capture)
	print("[RedotLocalBridge] Game viewport capture enabled (debug only).")

func _capture() -> void:
	if _capturing or _request_pending:
		return
	_capturing = true
	await RenderingServer.frame_post_draw
	if not is_inside_tree():
		return
	var image := get_tree().root.get_texture().get_image()
	if image == null or image.is_empty():
		_capturing = false
		return
	if image.get_width() > MAX_WIDTH:
		var target_height := maxi(1, roundi(float(image.get_height()) * MAX_WIDTH / image.get_width()))
		image.resize(MAX_WIDTH, target_height, Image.INTERPOLATE_BILINEAR)
	var bytes := image.save_jpg_to_buffer(0.7)
	_capturing = false
	if bytes.is_empty():
		return
	var headers := PackedStringArray(["Authorization: Bearer " + _token, "Content-Type: image/jpeg", "X-Redot-Source: native-game"])
	_request_pending = true
	var error := _request.request_raw(BRIDGE_URL, headers, HTTPClient.METHOD_POST, bytes)
	if error != OK:
		_request_pending = false

func _on_frame_uploaded(_result: int, _response_code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	_request_pending = false
