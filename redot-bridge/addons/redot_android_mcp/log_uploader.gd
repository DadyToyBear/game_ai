@tool
extends Node

const LogBuffer = preload("res://addons/redot_android_mcp/log_buffer.gd")
var _logger: Logger
var _request: HTTPRequest
var _timer: Timer
var _token := ""
var _url := ""
var _source := ""
var _pending := false

# Invoke only after the user explicitly opted in to sharing raw logs.
func start(base_url: String, token: String, source: String) -> void:
	_token = token
	_url = base_url + "/api/logs"
	_source = source
	_request = HTTPRequest.new()
	_request.timeout = 5.0
	_request.max_redirects = 0
	add_child(_request)
	_request.request_completed.connect(_completed)
	_timer = Timer.new()
	_timer.wait_time = 1.0
	add_child(_timer)
	_timer.timeout.connect(_send)
	_logger = LogBuffer.new()
	_logger.call("configure", token)
	OS.add_logger(_logger)
	_timer.start()

func _send() -> void:
	if _pending or _logger == null:
		return
	var batch: Array = _logger.call("take_batch")
	if batch.is_empty():
		return
	var headers := PackedStringArray(["Authorization: Bearer " + _token, "Content-Type: application/json"])
	_pending = true
	var error := _request.request(_url, headers, HTTPClient.METHOD_POST, JSON.stringify({"source": _source, "entries": batch}))
	if error != OK:
		_pending = false
	# Failed batches are intentionally dropped. No retry queue or disk storage.

func _completed(_result: int, _response_code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	_pending = false

func _exit_tree() -> void:
	if _logger != null:
		OS.remove_logger(_logger)
		_logger.call("clear")
		_logger = null
	if is_instance_valid(_timer):
		_timer.stop()
	if is_instance_valid(_request):
		_request.cancel_request()
	_token = ""
	_url = ""
