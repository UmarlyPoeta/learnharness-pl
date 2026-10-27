/**
 * The local dictation engine's seam (local Whisper wave, 2026-10-26): a
 * same-origin proxy to the faster-whisper server (stt/server.py, started by
 * the `learn` launcher). The renderer POSTs the run's raw PCM (Int16 LE,
 * 16 kHz, mono) once the mic stops; GET is the settings row's health line.
 *
 * In the installed desktop app (LH_WHISPER_BIN set, release wave
 * 2026-10-27) the PCM goes to the bundled whisper.cpp instead, wrapped in
 * a WAV: no model yet → 409 "stt-no-model", engine won't come up → 503.
 *
 * Unreachable server → 503 "stt-down", a timed-out transcription → 504
 * "stt-timeout" (the client maps both to its own short lines); the server
 * answering non-2xx → 502. GET never errors: an absent
 * server is a status, {ok:false}, not a failure.
 */

import { pcmToWav } from "@/src/core";
import { modelDownloader, transcribeTimeoutMs, whisperEngine, WhisperError } from "@/src/server";

/** 10 minutes of 16 kHz Int16 mono — the same cap the Python server enforces. */
const MAX_PCM_BYTES = 19_200_000;

export const dynamic = "force-dynamic";

const sttUrl = () => process.env.LH_STT_URL ?? "http://127.0.0.1:8765";

export async function POST(request: Request) {
	const body = await request.arrayBuffer();
	const engine = whisperEngine();
	if (engine) {
		try {
			const text = await engine.transcribe(pcmToWav(new Uint8Array(body).subarray(0, MAX_PCM_BYTES)));
			return Response.json({ text });
		} catch (e) {
			if (e instanceof WhisperError && e.code === "no-model") return Response.json({ message: "stt-no-model" }, { status: 409 });
			if (e instanceof WhisperError && e.code === "slow") return Response.json({ message: "stt-timeout" }, { status: 504 });
			// backend tells the client this is the installed app — no `learn` to run there.
			return Response.json({ message: "stt-down", backend: "whispercpp" }, { status: 503 });
		}
	}
	let res: Response;
	try {
		res = await fetch(`${sttUrl()}/transcribe`, {
			method: "POST",
			body,
			headers: { "Content-Type": "application/octet-stream" },
			signal: AbortSignal.timeout(transcribeTimeoutMs(body.byteLength)),
		});
	} catch (e) {
		// A timeout means the server is alive but slow — never "not running".
		if (e instanceof DOMException && e.name === "TimeoutError") {
			return Response.json({ message: "stt-timeout" }, { status: 504 });
		}
		return Response.json({ message: "stt-down" }, { status: 503 });
	}
	const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
	if (!res.ok) {
		return Response.json({ message: data.error ?? `stt server ${res.status}` }, { status: 502 });
	}
	return Response.json({ text: data.text ?? "" });
}

export async function GET() {
	if (whisperEngine()) {
		return Response.json({ ok: true, backend: "whispercpp", model: modelDownloader().status().state, device: null });
	}
	try {
		const res = await fetch(`${sttUrl()}/health`, { signal: AbortSignal.timeout(2_000) });
		const data = (await res.json()) as { ok?: boolean; loaded?: boolean; device?: string | null };
		return Response.json({ ok: res.ok && data.ok === true, loaded: data.loaded, device: data.device, backend: "python", model: "ready" });
	} catch {
		return Response.json({ ok: false, backend: "python", model: "ready" });
	}
}
