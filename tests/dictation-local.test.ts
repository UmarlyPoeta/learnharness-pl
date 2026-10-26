/**
 * The local dictation engine's pure seams (local Whisper wave, 2026-10-26):
 * frame concatenation, the one-shot transcription call and its error
 * mapping, and the Deepgram language fix.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concatFrames, DG_URL, LOCAL_STT_DOWN, LOCAL_STT_SLOW, MAX_LOCAL_BYTES, transcribeLocal } from "../components/dictation.tsx";

type Call = { url: string; init?: RequestInit };

function fakeFetch(respond: () => Response): { fetch: typeof fetch; calls: Call[] } {
	const calls: Call[] = [];
	const f = (async (url: string | URL, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return respond();
	}) as typeof fetch;
	return { fetch: f, calls };
}

const frame = (...samples: number[]) => Int16Array.from(samples).buffer;

describe("concatFrames", () => {
	it("joins the worklet's Int16 frames in order", () => {
		const out = concatFrames([frame(1, 2), frame(3)]);
		assert.equal(out.byteLength, 6);
		assert.deepEqual([...new Int16Array(out.buffer, out.byteOffset, 3)], [1, 2, 3]);
	});
});

describe("concatFrames — the worklet's real frames", () => {
	it("Int16Array frames (what pcm-capture.js posts) keep their exact bytes", () => {
		// pcm-capture posts `buffer: this.frame` — an Int16Array, not an
		// ArrayBuffer. new Uint8Array(int16) would truncate each sample to
		// its low byte (the "KONIEC!" bug: Whisper heard noise).
		const out = concatFrames([Int16Array.of(1000, -1000), Int16Array.of(12345)]);
		assert.equal(out.byteLength, 6);
		assert.deepEqual([...new Int16Array(out.buffer, out.byteOffset, 3)], [1000, -1000, 12345]);
	});
});

describe("transcribeLocal", () => {
	it("no audio: empty text, and the server is never called", async () => {
		const f = fakeFetch(() => Response.json({ text: "x" }));
		assert.equal(await transcribeLocal([], f.fetch), "");
		assert.equal(f.calls.length, 0);
	});

	it("an unreachable server surfaces the short local-down line", async () => {
		const f = fakeFetch(() => Response.json({ message: "stt-down" }, { status: 503 }));
		await assert.rejects(transcribeLocal([frame(1)], f.fetch), { message: LOCAL_STT_DOWN });
	});

	it("posts the concatenated PCM once and returns the trimmed text", async () => {
		const f = fakeFetch(() => Response.json({ text: "  Ala ma kota. " }));
		assert.equal(await transcribeLocal([frame(1, 2), frame(3)], f.fetch), "Ala ma kota.");
		assert.equal(f.calls.length, 1);
		assert.equal(f.calls[0]!.url, "/api/stt/local");
		assert.equal(f.calls[0]!.init?.method, "POST");
		const body = f.calls[0]!.init?.body as Uint8Array;
		assert.deepEqual([...new Int16Array(body.buffer, body.byteOffset, 3)], [1, 2, 3]);
	});

	it("a server-side timeout says the transcription took too long (final review I1)", async () => {
		const f = fakeFetch(() => Response.json({ message: "stt-timeout" }, { status: 504 }));
		await assert.rejects(transcribeLocal([frame(1)], f.fetch), { message: LOCAL_STT_SLOW });
	});

	it("never posts more than the server's cap (final review C2)", async () => {
		const f = fakeFetch(() => Response.json({ text: "" }));
		await transcribeLocal([new ArrayBuffer(MAX_LOCAL_BYTES), new ArrayBuffer(4096)], f.fetch);
		assert.equal((f.calls[0]!.init?.body as Uint8Array).byteLength, MAX_LOCAL_BYTES);
	});

	it("another server failure keeps its message", async () => {
		const f = fakeFetch(() => Response.json({ message: "audio longer than 10 minutes" }, { status: 502 }));
		await assert.rejects(transcribeLocal([frame(1)], f.fetch), { message: "audio longer than 10 minutes" });
	});
});

describe("limits and the Deepgram fix", () => {
	it("the local cap is 10 minutes of 16 kHz Int16", () => {
		assert.equal(MAX_LOCAL_BYTES, 19_200_000);
	});

	it("Deepgram transcribes Polish", () => {
		assert.match(DG_URL, /[?&]language=pl(&|$)/);
	});
});
