#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x ./notes-server ]; then
    echo "[run] 未找到 notes-server，先执行 ./build.sh"
    ./build.sh
fi

# 启动后自动打开本地页面；无桌面环境时服务器仍正常运行。
if command -v xdg-open >/dev/null 2>&1; then
    (sleep 1; exec xdg-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
elif command -v gnome-open >/dev/null 2>&1; then
    (sleep 1; exec gnome-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
elif command -v kde-open >/dev/null 2>&1; then
    (sleep 1; exec kde-open "http://127.0.0.1:8000") >/dev/null 2>&1 &
fi

exec ./notes-server
