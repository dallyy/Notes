#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
    echo "[run] 未找到 python3，请先安装（Arch: sudo pacman -S python）" >&2
    exit 1
fi

# 服务器启动后自动打开本地页面；无桌面环境时服务器仍会正常运行。
if command -v xdg-open >/dev/null 2>&1; then
    (sleep 1; exec xdg-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
elif command -v gnome-open >/dev/null 2>&1; then
    (sleep 1; exec gnome-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
elif command -v kde-open >/dev/null 2>&1; then
    (sleep 1; exec kde-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
fi

exec python3 server.py
