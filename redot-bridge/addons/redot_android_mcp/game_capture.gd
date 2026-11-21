extends Node

# Development-only Autoload: the running game asks before sharing its viewport.
# The game is a separate Android process; no secret is stored in the project.
const ConnectionConfig = preload("res://addons/redot_android_mcp/connection_config.gd")
const LogUploader = preload("res://addons/redot_android_mcp/log_uploader.gd")
const MAX_WIDTH := 960
const CAPTURE_INTERVAL := 0.5

var _dialog: ConfirmationDialog
var _token_input: LineEdit
var _url_input: LineEdit
var _share_logs: CheckBox
var _base_url := ""
var _status: Label
var _request: HTTPRequest
var _timer: Timer
var _token := ""
var _capturing := false
var _request_pending := false
var _last_upload_error := ""

func _ready() -> void:
	# Do not activate in exported release builds or on other platforms.
	if not OS.has_feature("android") or not OS.is_debug_build():
		return
	_request = HTTPRequest.new()
	_request.timeout = 5.0
	_request.max_redirects = 0
	add_child(_request)
	_request.request_completed.connect(_on_frame_uploaded)
	_timer = Timer.new()
	_timer.wait_time = CAPTURE_INTERVAL
	add_child(_timer)
	_timer.timeout.connect(_capture)
	_create_dialog()
	_dialog.call_deferred("popup_centered")

func _create_dialog() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 100
	add_child(layer)
	_dialog = ConfirmationDialog.new()
	_dialog.title = "Share game viewport?"
	_dialog.get_ok_button().text = "Share"
	_dialog.get_cancel_button().text = "Not now"
	_dialog.confirmed.connect(_start_capture)
	_dialog.canceled.connect(_clear_secret)
	var content := VBoxContainer.new()
	var info := Label.new()
	info.text = "Only share with a trusted bridge. Sharing stops when the game closes."
	info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	content.add_child(info)
	_url_input = LineEdit.new()
	_url_input.text = "http://127.0.0.1:8765"
	_url_input.placeholder_text = "USB address or HTTPS relay origin"
	content.add_child(_url_input)
	_token_input = LineEdit.new()
	_token_input.placeholder_text = "Bridge secret (32+ characters)"
	_token_input.secret = true
	content.add_child(_token_input)
	_share_logs = CheckBox.new()
	_share_logs.text = "Share game logs (may contain secrets)"
	_share_logs.button_pressed = false
	content.add_child(_share_logs)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	content.add_child(_status)
	_dialog.add_child(content)
	layer.add_child(_dialog)

func _valid_secret(value: String) -> bool:
	if value.length() < 32:
		return false
	for i in range(value.length()):
		var code := value.unicode_at(i)
		if code < 33 or code > 126:
			return false
	return true

func _start_capture() -> void:
	var value := _token_input.text
	_token_input.clear()
	var base: String = ConnectionConfig.base_url(_url_input.text)
	if base.is_empty():
		_status.text = "Use the USB address or an HTTPS origin without a path."
		_dialog.call_deferred("popup_centered")
		return
	if not _valid_secret(value):
		_status.text = "Use at least 32 printable ASCII characters without spaces."
		_dialog.call_deferred("popup_centered")
		return
	_token = value
	_base_url = base
	if _share_logs.button_pressed:
		var log_uploader: Node = LogUploader.new()
		add_child(log_uploader)
		log_uploader.call("start", _base_url, _token, "game")
	# Timer's first tick occurs after the dialog closes, so it is not captured.
	_timer.start()

func _clear_secret() -> void:
	if is_instance_valid(_token_input):
		_token_input.clear()

func _capture() -> void:
	if _token.is_empty() or _capturing or _request_pending:
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
		var height := maxi(1, roundi(float(image.get_height()) * MAX_WIDTH / image.get_width()))
		image.resize(MAX_WIDTH, height, Image.INTERPOLATE_BILINEAR)
	var data := image.save_jpg_to_buffer(0.7)
	_capturing = false
	if data.is_empty():
		return
	var headers := PackedStringArray(["Authorization: Bearer " + _token, "Content-Type: image/jpeg", "X-Redot-Source: native-game"])
	_request_pending = true
	var error := _request.request_raw(_base_url + "/api/frame", headers, HTTPClient.METHOD_POST, data)
	if error != OK:
		_request_pending = false
		_report_upload_error("Could not start frame upload.")

func _on_frame_uploaded(result: int, response_code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	_request_pending = false
	if result != HTTPRequest.RESULT_SUCCESS or response_code != 204:
		_report_upload_error("Frame upload failed; check network, certificate and device secret (result %d, HTTP %d)." % [result, response_code])
	else:
		_last_upload_error = ""

func _report_upload_error(message: String) -> void:
	if message != _last_upload_error:
		push_warning("Android MCP: " + message)
		_last_upload_error = message

func _exit_tree() -> void:
	if is_instance_valid(_timer):
		_timer.stop()
	if is_instance_valid(_request):
		_request.cancel_request()
	_clear_secret()
	_token = ""
	_base_url = ""
