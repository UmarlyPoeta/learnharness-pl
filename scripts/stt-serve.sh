#!/usr/bin/env bash
# Run the local dictation server from its venv, with pip's CUDA libs on the
# loader path (without them faster-whisper falls back to CPU).
set -euo pipefail
VENV="${LH_STT_VENV:-$HOME/.local/share/learnharness/stt-venv}"
nv="$(echo "$VENV"/lib/python3*/site-packages/nvidia)"
[ -d "$nv/cublas/lib" ] && export LD_LIBRARY_PATH="$nv/cublas/lib:$nv/cudnn/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$VENV/bin/python" "$(dirname "$(readlink -f "$0")")/../stt/server.py"
