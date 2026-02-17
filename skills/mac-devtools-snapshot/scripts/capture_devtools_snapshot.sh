#!/usr/bin/env bash
set -euo pipefail

BROWSER_APP="${1:-Google Chrome}"
OUT_PATH="${2:-/tmp/devtools-snapshot.png}"

# Bring target browser forward so DevTools is visible in the screenshot.
osascript -e "tell application \"${BROWSER_APP}\" to activate" >/dev/null 2>&1 || true
sleep 0.4

# Capture the active display as a deterministic artifact for review.
screencapture -x "${OUT_PATH}"

printf '%s\n' "${OUT_PATH}"
