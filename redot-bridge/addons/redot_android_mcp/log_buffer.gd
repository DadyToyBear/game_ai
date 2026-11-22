@tool
extends Logger

# Logger callbacks may run on different threads. Never print from these callbacks.
const MAX_QUEUED := 100
const MAX_MESSAGE_CHARS := 512
var _lock := Mutex.new()
var _entries: Array[Dictionary] = []
var _secret := ""

func configure(secret: String) -> void:
	_lock.lock()
	_secret = secret
	_lock.unlock()

func _log_message(message: String, error: bool) -> void:
	_enqueue("error" if error else "info", message)

func _log_error(function: String, file: String, line: int, code: String, rationale: String, _editor_notify: bool, error_type: int, _script_backtraces: Array[ScriptBacktrace]) -> void:
	var level := "warning" if error_type == Logger.ERROR_TYPE_WARNING else "error"
	_enqueue(level, "%s:%d %s: %s %s" % [file, line, function, code, rationale])

func _enqueue(level: String, message: String) -> void:
	_lock.lock()
	if not _secret.is_empty():
		message = message.replace(_secret, "[bridge secret]")
	if _entries.size() >= MAX_QUEUED:
		_entries.pop_front()
	_entries.push_back({"level": level, "message": message.left(MAX_MESSAGE_CHARS)})
	_lock.unlock()

func take_batch() -> Array[Dictionary]:
	_lock.lock()
	var batch: Array[Dictionary] = []
	while not _entries.is_empty() and batch.size() < 2:
		batch.push_back(_entries.pop_front())
	_lock.unlock()
	return batch

func clear() -> void:
	_lock.lock()
	_entries.clear()
	_secret = ""
	_lock.unlock()
