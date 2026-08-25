#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

GXX="${GXX:-g++}"
if ! command -v "$GXX" >/dev/null 2>&1; then
    echo "[build] No g++ found. Install build-essential (Debian/Ubuntu) or gcc-c++ (Fedora/RHEL)." >&2
    exit 1
fi

echo "[build] compiler: $GXX"
"$GXX" -O2 -std=c++17 -pthread -I. server.cpp -o server
echo "[build] server built successfully"
