@tool
extends EditorPlugin

# This prototype only connects through an explicit adb reverse to a computer.
# No token is written to project files or editor settings.
const POLL_URL := "http://127.0.0.1:8765/api/editor/poll"
const MENU_TITLE := "MCP Bridge (USB)"
var _dialog: ConfirmationDialog
var _token_input: LineEdit
var _status: Label
var _request: HTTPRequest
var _timer: Timer
var _token := ""
var _pending := false

func _enter_tree() -> void:
	_request = HTTPRequest.new()
	_request.timeout = 3.0
	add_child(_request)
	_request.request_completed.connect(_on_poll_completed)
	_timer = Timer.new()
	_timer.wait_time = 0.5
	add_child(_timer)
	_timer.timeout.connect(_poll)
	_create_dialog()
	add_tool_menu_item(MENU_TITLE, _show_dialog)

func _create_dialog() -> void:
	_dialog = ConfirmationDialog.new()
	_dialog.title = "MCP Bridge (USB)"
	_dialog.get_ok_button().text = "Connect"
	_dialog.add_button("Disconnect", false, "disconnect")
	_dialog.confirmed.connect(_connect_bridge)
	_dialog.custom_action.connect(_on_custom_action)
	var content := VBoxContainer.new()
	var info := Label.new()
	info.text = "Connect through adb reverse on USB. Enter your local bridge secret. It stays in memory only."
	info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	content.add_child(info)
	_token_input = LineEdit.new()
	_token_input.placeholder_text = "Bridge secret (32+ characters)"
	_token_input.secret = true
	content.add_child(_token_input)
	_status = Label.new()
	_status.text = "Disconnected"
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	content.add_child(_status)
	_dialog.add_child(content)
	EditorInterface.get_base_control().add_child(_dialog)

func _show_dialog() -> void:
	_dialog.popup_centered(Vector2i(560, 220))

func _connect_bridge() -> void:
	var value := _token_input.text
	_token_input.clear()
	if value.length() < 32:
		_status.text = "Secret must have at least 32 characters."
		_dialog.popup_centered()
		return
	for i in range(value.length()):
		var code := value.unicode_at(i)
		if code < 33 or code > 126:
			_status.text = "Use a printable ASCII secret without spaces."
			_dialog.popup_centered()
			return
	_disconnect_bridge()
	_token = value
	_status.text = "Connecting to the USB-forwarded bridge."
	_timer.start()
	_poll()

func _on_custom_action(action: StringName) -> void:
	if action == "disconnect":
		_disconnect_bridge()

func _disconnect_bridge() -> void:
	if is_instance_valid(_timer):
		_timer.stop()
	if is_instance_valid(_request):
		_request.cancel_request()
	_token = ""
	_pending = false
	if is_instance_valid(_token_input):
		_token_input.clear()
	if is_instance_valid(_status):
		_status.text = "Disconnected"

func _poll() -> void:
	if _token.is_empty() or _pending:
		return
	var headers := PackedStringArray(["Authorization: Bearer " + _token, "Content-Type: application/json"])
	var body := JSON.stringify({"playing": EditorInterface.is_playing_scene()})
	_pending = true
	var error := _request.request(POLL_URL, headers, HTTPClient.METHOD_POST, body)
	if error != OK:
		_pending = false
		_status.text = "Request could not start; check USB forwarding."

func _on_poll_completed(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	_pending = false
	if _token.is_empty():
		return
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_status.text = "Not connected; check USB, bridge and secret."
		return
	_status.text = "Connected via USB. MCP can queue Play and Stop."
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if not parsed is Dictionary:
		return
	var command := str(parsed.get("command", ""))
	if command == "play" and not EditorInterface.is_playing_scene():
		EditorInterface.play_main_scene()
	elif command == "stop" and EditorInterface.is_playing_scene():
		EditorInterface.stop_playing_scene()

func _exit_tree() -> void:
	_disconnect_bridge()
	remove_tool_menu_item(MENU_TITLE)
	if is_instance_valid(_dialog):
		_dialog.queue_free()
	if is_instance_valid(_request):
		_request.queue_free()
	if is_instance_valid(_timer):
		_timer.queue_free()
