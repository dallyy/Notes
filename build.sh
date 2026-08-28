#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

GO="${GO:-go}"
if ! command -v "$GO" >/dev/null 2>&1; then
    echo "[build] 未找到 go。Arch: sudo pacman -S go" >&2
    exit 1
fi

echo "[build] 编译 Go 后端..."
"$GO" build -o notes-server .
echo "[build] 完成：./notes-server"
