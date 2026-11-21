#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ $(uname -s) != Linux || $(uname -m) != aarch64 ]]; then
  echo 'This bundle is for Linux aarch64 (ARM64).' >&2; exit 1
fi
exec python3 redot-bridge/desktop_launcher.py "$@"
