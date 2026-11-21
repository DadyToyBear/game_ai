#!/usr/bin/env python3
"""Patch RC2 Web editor Stop to close the game instance in the HTML shell.

RC2's Web create_process does not provide a child PID, so EditorRun::stop()
never calls OS::kill(). The standard RC2 editor shell owns exactly one game and
exposes closeGame(), which requests that game's orderly quit. Non-Web builds
are unchanged; shells without closeGame() safely do nothing.
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('Usage: python build-patches/fix_web_editor_stop.py <redot-source-dir>')
path = Path(sys.argv[1]) / 'editor/run/editor_run.cpp'
source = path.read_text(encoding='utf-8')
include = '#include "editor_run.h"\n'
stop = 'void EditorRun::stop() {\n\tif (status != STATUS_STOP && pids.size() > 0) {'
if source.count(include) != 1 or source.count(stop) != 1 or 'REDOT_WEB_GAME_STOP_FIX' in source:
    raise SystemExit(f'Redot source does not match unpatched expected RC2: {path}')
source = source.replace(include, include + '\n#ifdef WEB_ENABLED\n#include <emscripten.h>\n#endif\n', 1)
source = source.replace(stop, '''void EditorRun::stop() {
#ifdef WEB_ENABLED
	// REDOT_WEB_GAME_STOP_FIX: the Web shell owns the game instance and
	// create_instance() does not supply a PID for OS::kill().
	if (status != STATUS_STOP) {
		MAIN_THREAD_EM_ASM({
			if (typeof globalThis.closeGame === 'function') {
				globalThis.closeGame();
			}
		});
	}
#endif
	if (status != STATUS_STOP && pids.size() > 0) {''', 1)
path.write_text(source, encoding='utf-8')
print(f'Applied Web editor game Stop fix to {path}')
