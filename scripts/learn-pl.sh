#!/usr/bin/env bash
# LearnHarness PL: build when the code changed, serve locally, open the browser.
# Usage: learn [port]   (default 3000; log in ~/.cache/learnharness.log)
set -euo pipefail
APP="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
PORT="${1:-${PORT:-3000}}"
URL="http://localhost:$PORT"
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/learnharness.log"
cd "$APP"
[ -d node_modules ] || npm install
# Rebuild when there is no build or any source is newer than it.
if [ ! -f .next/BUILD_ID ] || [ -n "$(find app components lib src public next.config.ts -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
	echo "Budowanie aplikacji…"
	npm run build
fi
BUILD="$(cat .next/BUILD_ID)"
STAMP="$(dirname "$LOG")/learnharness-$PORT.build"
# Local dictation server (stt/server.py) — started once, survives the app.
STT_PORT="${LH_STT_PORT:-8765}"
STT_VENV="${LH_STT_VENV:-$HOME/.local/share/learnharness/stt-venv}"
if [ -x "$STT_VENV/bin/python" ]; then
	if ! curl -fsS -o /dev/null "http://127.0.0.1:$STT_PORT/health" 2>/dev/null; then
		mkdir -p "$(dirname "$LOG")"
		nohup "$APP/scripts/stt-serve.sh" >"$(dirname "$LOG")/learnharness-stt.log" 2>&1 &
	fi
else
	echo "Dyktowanie lokalne: uruchom $APP/scripts/stt-setup.sh"
fi
# A server already on the port keeps serving the build it started with — a
# stale one is restarted (its stamp, written at start, names that build).
if curl -fsS -o /dev/null "$URL" 2>/dev/null && [ "$(cat "$STAMP" 2>/dev/null)" != "$BUILD" ]; then
	echo "Serwer na :$PORT działa ze starego buildu — restartuję."
	fuser -k "$PORT/tcp" >/dev/null 2>&1 || true
	for _ in $(seq 1 20); do curl -fsS -o /dev/null "$URL" 2>/dev/null || break; sleep 0.5; done
fi
if ! curl -fsS -o /dev/null "$URL" 2>/dev/null; then
	mkdir -p "$(dirname "$LOG")"
	nohup npx next start -p "$PORT" >"$LOG" 2>&1 &
	echo "$BUILD" >"$STAMP"
	for _ in $(seq 1 60); do curl -fsS -o /dev/null "$URL" 2>/dev/null && break; sleep 0.5; done
fi
echo "LearnHarness PL: $URL  (log: $LOG; stop: fuser -k $PORT/tcp)"
if command -v wslview >/dev/null; then wslview "$URL"
elif command -v explorer.exe >/dev/null; then explorer.exe "$URL" || true
elif command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 &
fi
