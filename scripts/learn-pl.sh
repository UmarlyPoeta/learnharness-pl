#!/usr/bin/env bash
# LearnHarness PL: build once, serve locally, open the browser.
# Usage: learn [port]   (default 3000; log in ~/.cache/learnharness.log)
set -euo pipefail
APP="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
PORT="${1:-${PORT:-3000}}"
URL="http://localhost:$PORT"
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/learnharness.log"
cd "$APP"
[ -d node_modules ] || npm install
[ -f .next/BUILD_ID ] || npm run build
if ! curl -fsS -o /dev/null "$URL" 2>/dev/null; then
	mkdir -p "$(dirname "$LOG")"
	nohup npx next start -p "$PORT" >"$LOG" 2>&1 &
	for _ in $(seq 1 60); do curl -fsS -o /dev/null "$URL" 2>/dev/null && break; sleep 0.5; done
fi
echo "LearnHarness PL: $URL  (log: $LOG; stop: fuser -k $PORT/tcp)"
if command -v wslview >/dev/null; then wslview "$URL"
elif command -v explorer.exe >/dev/null; then explorer.exe "$URL" || true
elif command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 &
fi
