@tool
extends EditorPlugin

var dock: Label

func _enter_tree() -> void:
	dock = Label.new()
	dock.name = "Web Smoke Test"
	dock.text = "GDScript editor plugin is running."
	add_control_to_dock(DOCK_SLOT_LEFT_UL, dock)
	print("Web Smoke Test: plugin enabled")

func _exit_tree() -> void:
	if is_instance_valid(dock):
		remove_control_from_docks(dock)
		dock.queue_free()
