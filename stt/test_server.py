"""Local STT server tests: no GPU, no faster-whisper; a fake model factory.

Run: ~/.local/share/learnharness/stt-venv/bin/python -m unittest stt/test_server.py -v
"""

import http.client
import json
import os
import sys
import threading
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402


class FakeModel:
    def __init__(self, device, texts=(" Ala ma", " kota."), fail=None):
        self.device, self.texts, self.fail, self.kwargs = device, texts, fail, None

    def transcribe(self, audio, **kwargs):
        self.kwargs = kwargs
        if self.fail:
            raise self.fail

        def segments():
            for t in self.texts:
                yield SimpleNamespace(text=t)

        return segments(), SimpleNamespace(duration=len(audio) / 16000)


def fake_factory(models):
    def factory(name, device, compute_type):
        m = models.get(device)
        if isinstance(m, Exception):
            raise m
        return m or FakeModel(device)

    return factory


class ServerCase(unittest.TestCase):
    def start(self, transcriber):
        httpd = server.make_server("127.0.0.1", 0, transcriber)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        return httpd.server_address[1]

    def request(self, port, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, json.loads(data) if data else None


class TestPcm(unittest.TestCase):
    def test_pcm_to_float(self):
        out = server.pcm_to_float(b"\x00\x40")
        self.assertEqual(out.dtype.name, "float32")
        self.assertEqual(out.tolist(), [0.5])


class TestTranscriber(unittest.TestCase):
    def test_joins_segments(self):
        t = server.Transcriber("large-v3-turbo", 600, fake_factory({}))
        r = t.transcribe(b"\x00\x00" * 1600)
        self.assertEqual(r["text"], "Ala ma kota.")
        self.assertEqual(r["device"], "cuda")

    def test_transcribe_kwargs(self):
        cuda = FakeModel("cuda")
        t = server.Transcriber("large-v3-turbo", 600, fake_factory({"cuda": cuda}))
        t.transcribe(b"\x00\x00" * 1600)
        self.assertEqual(cuda.kwargs["language"], "pl")
        self.assertIs(cuda.kwargs["vad_filter"], True)
        self.assertEqual(cuda.kwargs["beam_size"], 5)
        self.assertIs(cuda.kwargs["condition_on_previous_text"], False)
        self.assertNotIn("initial_prompt", cuda.kwargs)

    def test_cuda_oom_falls_back_to_cpu(self):
        models = {"cuda": FakeModel("cuda", fail=RuntimeError("CUDA out of memory"))}
        t = server.Transcriber("large-v3-turbo", 600, fake_factory(models))
        r = t.transcribe(b"\x00\x00" * 1600)
        self.assertEqual(r["device"], "cpu")
        self.assertEqual(r["text"], "Ala ma kota.")

    def test_cuda_load_failure_falls_back_to_cpu(self):
        models = {"cuda": RuntimeError("libcublas.so.12 not found")}
        t = server.Transcriber("large-v3-turbo", 600, fake_factory(models))
        self.assertEqual(t.transcribe(b"\x00\x00" * 1600)["device"], "cpu")

    def test_idle_unload(self):
        t = server.Transcriber("large-v3-turbo", 0, fake_factory({}))
        t.transcribe(b"\x00\x00" * 1600)
        self.assertTrue(t.state()["loaded"])
        t.reap()
        self.assertFalse(t.state()["loaded"])


class TestHttp(ServerCase):
    def test_health_before_load(self):
        port = self.start(server.Transcriber("large-v3-turbo", 600, fake_factory({})))
        status, body = self.request(port, "GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True, "loaded": False, "device": None, "model": "large-v3-turbo"})

    def test_empty_body_returns_empty_text(self):
        port = self.start(server.Transcriber("large-v3-turbo", 600, fake_factory({})))
        status, body = self.request(port, "POST", "/transcribe", body=b"")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"text": "", "seconds": 0.0, "device": None})

    def test_transcribe_over_http(self):
        port = self.start(server.Transcriber("large-v3-turbo", 600, fake_factory({})))
        status, body = self.request(port, "POST", "/transcribe", body=b"\x00\x00" * 1600)
        self.assertEqual(status, 200)
        self.assertEqual(body["text"], "Ala ma kota.")

    def test_too_large_413(self):
        port = self.start(server.Transcriber("large-v3-turbo", 600, fake_factory({})))
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.putrequest("POST", "/transcribe")
        conn.putheader("Content-Length", str(server.MAX_BYTES + 2))
        conn.endheaders()
        resp = conn.getresponse()
        self.assertEqual(resp.status, 413)
        conn.close()

    def test_unknown_path_404(self):
        port = self.start(server.Transcriber("large-v3-turbo", 600, fake_factory({})))
        status, _ = self.request(port, "GET", "/nope")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
