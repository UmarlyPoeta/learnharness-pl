"""Local dictation server: faster-whisper behind a tiny localhost HTTP API.

POST /transcribe  body = raw PCM Int16 LE, 16 kHz, mono
                  → {"text", "seconds", "device"}; empty body → empty text;
                  more than MAX_BYTES (10 min) → 413
GET  /health      → {"ok", "loaded", "device", "model"}

The model loads on the first request (CUDA float16, CPU int8 when CUDA
fails to load or runs out of memory) and is dropped after LH_STT_IDLE_S
seconds without requests, so it doesn't hold VRAM while unused.

Env: LH_STT_PORT (8765), LH_STT_MODEL (large-v3-turbo), LH_STT_IDLE_S (600).
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

SAMPLE_RATE = 16000
MAX_BYTES = 10 * 60 * SAMPLE_RATE * 2
DEVICES = (("cuda", "float16"), ("cpu", "int8"))
# No initial_prompt: on silence or music Whisper parrots it back.
TRANSCRIBE_KWARGS = dict(language="pl", beam_size=5, vad_filter=True, condition_on_previous_text=False)


def pcm_to_float(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def whisper_factory(name, device, compute_type):
    from faster_whisper import WhisperModel

    return WhisperModel(name, device=device, compute_type=compute_type)


class Transcriber:
    def __init__(self, model_name, idle_s, factory=whisper_factory, clock=time.monotonic):
        self.model_name, self.idle_s, self.factory, self.clock = model_name, idle_s, factory, clock
        self.lock = threading.Lock()
        self.model = None
        self.device = None
        self.index = 0
        self.last_used = 0.0

    def _load(self, start=0):
        for i in range(start, len(DEVICES)):
            device, compute_type = DEVICES[i]
            try:
                self.model = self.factory(self.model_name, device, compute_type)
                self.device, self.index = device, i
                return
            except Exception as e:  # missing CUDA libs, OOM at load
                print(f"[stt] {device} load failed: {e}", flush=True)
        raise RuntimeError("no device could load the model")

    def _run(self, audio):
        segments, _info = self.model.transcribe(audio, **TRANSCRIBE_KWARGS)
        return "".join(s.text for s in segments).strip()

    def transcribe(self, pcm: bytes) -> dict:
        if not pcm:
            return {"text": "", "seconds": 0.0, "device": None}
        audio = pcm_to_float(pcm)
        with self.lock:
            if self.model is None:
                self._load()
            started = self.clock()
            try:
                text = self._run(audio)
            except RuntimeError as e:
                if self.device != "cuda":
                    raise
                print(f"[stt] cuda failed mid-run, retrying on cpu: {e}", flush=True)
                self.model = None
                self._load(self.index + 1)
                text = self._run(audio)
            self.last_used = self.clock()
            return {"text": text, "seconds": round(self.last_used - started, 3), "device": self.device}

    def state(self) -> dict:
        return {"loaded": self.model is not None, "device": self.device, "model": self.model_name}

    def reap(self):
        with self.lock:
            if self.model is not None and self.clock() - self.last_used >= self.idle_s:
                self.model = None
                self.device = None


def make_server(host, port, transcriber):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/health":
                return self._json(404, {"error": "not found"})
            self._json(200, {"ok": True, **transcriber.state()})

        def do_POST(self):
            if self.path != "/transcribe":
                return self._json(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BYTES:
                self.close_connection = True
                return self._json(413, {"error": "audio longer than 10 minutes"})
            pcm = self.rfile.read(length) if length else b""
            try:
                self._json(200, transcriber.transcribe(pcm))
            except Exception as e:
                self._json(500, {"error": str(e)})

        def log_message(self, fmt, *args):
            pass

    return ThreadingHTTPServer((host, port), Handler)


def main():
    port = int(os.environ.get("LH_STT_PORT", "8765"))
    transcriber = Transcriber(os.environ.get("LH_STT_MODEL", "large-v3-turbo"), float(os.environ.get("LH_STT_IDLE_S", "600")))

    def reaper():
        while True:
            time.sleep(30)
            transcriber.reap()

    threading.Thread(target=reaper, daemon=True).start()
    httpd = make_server("127.0.0.1", port, transcriber)
    print(f"[stt] listening on 127.0.0.1:{port} ({transcriber.model_name})", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
