#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x ./server ]; then
    echo "[run] server not found; run ./build.sh first" >&2
    exit 1
fi

# Open the local page once the server has had a moment to start.
# If no desktop opener is available (headless server), the server still runs.
if command -v xdg-open >/dev/null 2>&1; then
    (sleep 1; exec xdg-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
elif command -v gnome-open >/dev/null 2>&1; then
    (sleep 1; exec gnome-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
elif command -v kde-open >/dev/null 2>&1; then
    (sleep 1; exec kde-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
fi

exec ./server
