#!/bin/bash
# Installs graphify in Claude Code cloud sessions and refreshes the code graph.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v graphify >/dev/null 2>&1; then
  pip install -q "graphifyy[sql]" >/dev/null 2>&1
fi

cd "$CLAUDE_PROJECT_DIR"
graphify update . >/dev/null 2>&1 || true
