/**
 * The local dictation engine's seam (local Whisper wave, 2026-10-26): a
 * same-origin proxy to the faster-whisper server (stt/server.py, started by
 * the `learn` launcher). The renderer POSTs the run's raw PCM (Int16 LE,
 * 16 kHz, mono) once the mic stops; GET is the settings row's health line.
 *
 * Unreachable server → 503 "stt-down", a timed-out transcription → 504
 * "stt-timeout" (the client maps both to its own short lines); the server
 * answering non-2xx → 502. GET never errors: an absent
 * server is a status, {ok:false}, not a failure.
 */

import { transcribeTimeoutMs } from "@/src/server";

export const dynamic = "force-dynamic";

const sttUrl = () => process.env.LH_STT_URL ?? "http://127.0.0.1:8765";

export async function POST(request: Request) {
	const body = await request.arrayBuffer();
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
	try {
		const res = await fetch(`${sttUrl()}/health`, { signal: AbortSignal.timeout(2_000) });
		const data = (await res.json()) as { ok?: boolean; loaded?: boolean; device?: string | null };
		return Response.json({ ok: res.ok && data.ok === true, loaded: data.loaded, device: data.device });
	} catch {
		return Response.json({ ok: false });
	}
}
