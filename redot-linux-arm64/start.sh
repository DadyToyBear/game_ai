#!/usr/bin/env bash
# Run with bash after extracting the bundle. Does not modify projects.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ $(uname -s) != Linux || $(uname -m) != aarch64 ]]; then
  echo 'Этот комплект предназначен для Linux aarch64 (ARM64).' >&2; exit 1
fi
if ! command -v python3 >/dev/null; then echo 'Установите Python 3.' >&2; exit 1; fi
if ! command -v dotnet >/dev/null || ! dotnet --list-runtimes | grep -q '^Microsoft.NETCore.App 8\.'; then
  echo 'Редактор Mono требует .NET 8. Установите dotnet-sdk-8.0 из репозитория Fedora; без него редактор может аварийно завершиться.' >&2; exit 1
fi
if (( $# > 1 )); then echo 'Использование: bash start.sh [путь-к-проекту]' >&2; exit 1; fi
project_args=(); editor_args=()
if (( $# )); then
  project=$(realpath -e -- "$1")
  if [[ ! -f "$project/project.godot" ]]; then echo 'В папке нет project.godot.' >&2; exit 1; fi
  project_args=(--project-dir "$project"); editor_args=(--editor --path "$project")
fi
editor_path=$(cat editor-path.txt)
case "$editor_path" in editor/*) ;; *) echo 'Некорректный путь редактора в комплекте.' >&2; exit 1;; esac
[[ -f "$editor_path" && -x "$editor_path" ]] || { echo 'Файл редактора отсутствует или не исполняем: распакуйте tar.gz с сохранением прав.' >&2; exit 1; }
export REDOT_BRIDGE_ENABLED=1
export REDOT_BRIDGE_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
printf '\nСекрет для локальной страницы и MCP (не публикуйте его):\n%s\n\n' "$REDOT_BRIDGE_TOKEN"
printf '%s\n' 'Игра: http://127.0.0.1:8765/native.html' 'Web Redot: http://127.0.0.1:8765/editor/godot.editor.html' 'Папки/сеть/облако: http://127.0.0.1:8765/project-open.html' 'Остановить мост: Ctrl+C'
"$editor_path" "${editor_args[@]}" &
editor_pid=$!
cleanup() { kill "$editor_pid" 2>/dev/null || true; wait "$editor_pid" 2>/dev/null || true; }
trap cleanup EXIT
python3 redot-bridge/bridge.py serve --editor-dir web-editor "${project_args[@]}"
