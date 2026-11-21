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
    start, end = text.index('async function chatList(prefixes){'), text.index('async function postChat(kind,payload,name){')
    replacement = (Path(__file__).resolve().parent / 'dashboard_chat_patch.js').read_text(encoding='utf-8')
    text = text[:start] + replacement + '\n' + text[end:]
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
