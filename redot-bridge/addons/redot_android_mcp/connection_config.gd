extends RefCounted

# Only the explicit adb-reverse endpoint may use plain HTTP. A remote origin
# must be HTTPS, with no path, userinfo, query or fragment, and no redirects.
static func base_url(value: String) -> String:
	var url := value.strip_edges()
	if url == "http://127.0.0.1:8765" or url == "http://127.0.0.1:8765/":
		return "http://127.0.0.1:8765"
	var regex := RegEx.new()
	regex.compile("^https://([A-Za-z0-9][A-Za-z0-9.-]*)(?::([0-9]{1,5}))?/?$")
	var match_result := regex.search(url)
	if match_result == null:
		return ""
	var hostname := match_result.get_string(1)
	if hostname.length() > 253:
		return ""
	for label in hostname.split("."):
		if label.is_empty() or label.length() > 63 or label.begins_with("-") or label.ends_with("-"):
			return ""
	var port := match_result.get_string(2)
	if not port.is_empty() and (int(port) < 1 or int(port) > 65535):
		return ""
	return url.trim_suffix("/")
