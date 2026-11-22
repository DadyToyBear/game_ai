#!/usr/bin/env python3
"""Make a separate filtered dashboard from the pinned upstream snapshot.

Never edits the input or deploys anything. Unknown dashboards are rejected.
"""
import argparse
import hashlib
from pathlib import Path
import sys

EXPECTED = 'ecf7cbc491ebaff84435b8b14cca77836c2ab6bdf5cd08ad27e38069607edc77'


def generate(source, output):
    source, output = Path(source), Path(output)
    if source.is_symlink() or not source.is_file():
        raise ValueError('Input must be a regular, non-symlink file')
    if output.name != 'dashboard-enhanced.html' or output.is_symlink() or output.exists() or not output.parent.is_dir():
        raise ValueError('Output must be a new dashboard-enhanced.html in an existing directory')
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise ValueError('Unknown dashboard version; refusing to patch it')
    text = raw.decode('utf-8')
    old = "replace(/\\/dashboard\\.html$/, '')"
    new = "replace(/\\/dashboard-enhanced\\.html$/, '')"
    if text.count(old) != 1:
        raise ValueError('Dashboard URL anchor mismatch')
    text = text.replace(old, new)
    refresh = 'async function refresh() {\n  try {'
    if text.count(refresh) != 1:
        raise ValueError('Dashboard refresh anchor mismatch')
    text = text.replace(refresh, "async function refresh() {\n  if (document.body.classList.contains('chat-mode')) return;\n  try {")
    marker = '      <div class="chat-scroll" id="room-feed"></div>'
    extra = '''      <div class="chat-tools"><label><input type="checkbox" id="chat-show-mcp"> Показать MCP-трафик (может содержать приватные данные)</label></div>
      <div id="chat-list-status" role="status" style="padding:4px 8px;color:var(--muted);font-size:11px"></div>
      <pre id="chat-mcp-feed" hidden style="white-space:pre-wrap;overflow:auto;max-height:20vh;padding:8px"></pre>
'''
    if text.count(marker) != 1:
        raise ValueError('Chat UI anchor mismatch')
    text = text.replace(marker, extra + marker)
    text = text.replace('<h3>🤖 Агенты (модели)</h3>', '<h3>🤖 Агенты · heartbeat не подтверждает работу</h3>')
    old_live = "document.getElementById('tab-live').onclick=()=>{setLiveMode(true);document.body.classList.remove('chat-mode');document.getElementById('tab-chat').classList.remove('active');};"
    if text.count(old_live) != 1:
        raise ValueError('Live tab anchor mismatch')
    text = text.replace(old_live, "document.getElementById('tab-live').onclick=()=>{setLiveMode(true);chatMode(false);};")
    start, end = text.index('function buildAgentList(){'), text.index('async function chatList(prefixes){')
    presence = (Path(__file__).resolve().parent / 'dashboard_presence_patch.js').read_text(encoding='utf-8')
    text = text[:start] + presence + '\n' + text[end:]
    start, end = text.index('async function chatList(prefixes){'), text.index('async function postChat(kind,payload,name){')
    replacement = (Path(__file__).resolve().parent / 'dashboard_chat_patch.js').read_text(encoding='utf-8')
    text = text[:start] + replacement + '\n' + text[end:]

    def replace_once(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise ValueError('Assignment or result display anchor mismatch')
        text = text.replace(old, new, 1)

    task_field = '''        <input id="task-params" placeholder='{"param":"value"}' value="{}" style="flex:1 1 100%">
        <button id="task-send" style="flex:1 1 100%">Назначить</button>'''
    replace_once(task_field, task_field.replace('        <button id="task-send"', '        <label style="flex:1 1 100%"><input type="checkbox" id="task-allow-empty"> Разрешить пустые параметры для метода без аргументов</label>\n        <button id="task-send"') + '\n        <div id="task-notice" role="status" style="flex:1 1 100%"></div>')
    replace_once('      <textarea id="params-input">{}</textarea>', '      <textarea id="params-input">{}</textarea>\n      <label><input type="checkbox" id="call-allow-empty"> Allow empty parameters for a parameterless method</label>')
    replace_once('<button class="btn sec" id="clear-pending-btn" style="margin-left:6px;">Clear pending</button>', '<button class="btn sec" id="clear-pending-btn" disabled title="Disabled: this creates fake result files and does not delete tasks" style="margin-left:6px;">Clear pending (disabled)</button>')
    replace_once('  return body.includes(\'"ok":true\') || body.includes(\'"ok": true\');', '  try { return r.ok && JSON.parse(body).ok === true; } catch (_) { return false; }')
    replace_once("    chatRefresh();\n  } else showToast('Не удалось записать файл','err');\n}", "    chatRefresh();\n    return true;\n  } else { showToast('Не удалось записать файл','err'); return false; }\n}")
    start, end = text.index("document.getElementById('task-send').onclick=async()=>{"), text.index("document.getElementById('chat-refresh').onclick=chatRefresh;")
    assignment = (Path(__file__).resolve().parent / 'dashboard_assignment_patch.js').read_text(encoding='utf-8')
    text = text[:start] + assignment + '\n' + text[end:]
    replace_once("    showToast('Params JSON invalid: ' + e.message, 'err');\n    return;\n  }\n\n  const id =", "    showToast('Params JSON invalid: ' + e.message, 'err');\n    return;\n  }\n  if (!params || typeof params !== 'object' || Array.isArray(params)) { showToast('Params must be a JSON object', 'err'); return; }\n  if (!Object.keys(params).length && !document.getElementById('call-allow-empty').checked) { showToast('Confirm an empty parameter object explicitly', 'err'); return; }\n\n  const id =")
    replace_once("  if (Object.keys(params).length > 0 || paramsText !== '{}') task.params = params;", "  task.params = params;")
    replace_once("  totSub.textContent = `${completed.length} done, ${pending.length} pending`;", "  totSub.textContent = `${completed.length} matched responses, ${pending.length} unmatched tasks`;")
    replace_once("  pendSub.textContent = pending.length === 0 ? 'all caught up'", "  pendSub.textContent = pending.length === 0 ? 'no unmatched tasks'")
    replace_once("        entry.status = obj.error ? 'err' : 'ok';", "        entry.status = obj.error ? 'err' : 'received';")
    replace_once('.entry .status.pending {', '.entry .status.received { background: rgba(212,161,78,0.15); color: var(--warn); }\n.entry .status.pending {')
    replace_once("        resultEl.className = 'action-result show ' + (isError ? 'err' : 'ok');\n        resultEl.textContent = JSON.stringify(obj, null, 2);\n        showToast(isError ? 'Error response' : 'Got response', isError ? 'err' : 'ok');", "        resultEl.className = 'action-result show ' + (isError ? 'err' : '');\n        resultEl.textContent = 'Response received; completion not verified.\\n' + JSON.stringify(obj, null, 2);\n        showToast(isError ? 'Error response' : 'Response received; completion not verified', isError ? 'err' : '');")
    # Exclusive create: neither an existing dashboard nor symlink is overwritten.
    with output.open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    try:
        generate(args.source, args.output)
    except (OSError, UnicodeError, ValueError) as exc:
        print(f'Cannot prepare dashboard: {exc}', file=sys.stderr)
        return 1
    print('Created a separate dashboard; input and live share were not modified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
