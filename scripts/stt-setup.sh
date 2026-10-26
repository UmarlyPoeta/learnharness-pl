#!/usr/bin/env bash
# Local dictation: create the faster-whisper venv the STT server runs in.
# Idempotent; the model itself comes from ~/.cache/huggingface on first use.
set -euo pipefail
VENV="${LH_STT_VENV:-$HOME/.local/share/learnharness/stt-venv}"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q -U pip
"$VENV/bin/pip" install -q -U faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12
echo "STT venv gotowy: $VENV"
