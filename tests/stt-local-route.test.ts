/**
 * /api/stt/local (local Whisper wave, 2026-10-26): the proxy to the local
 * faster-whisper server. fetch is swapped per test — no server, no network.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const route = await import("../app/api/stt/local/route.ts");
const { transcribeTimeoutMs } = await import("../src/server/stt-local.ts");
const realFetch = globalThis.fetch;
type Call = { url: string; init?: RequestInit };

function stubFetch(respond: (call: Call) => Response | Promise<Response>): Call[] {
	const calls: Call[] = [];
	globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
		const call = { url: String(url), init };
		calls.push(call);
		return respond(call);
	}) as typeof fetch;
	return calls;
}

const post = (bytes: Uint8Array<ArrayBuffer>) =>
	route.POST(new Request("http://localhost/api/stt/local", { method: "POST", body: bytes, headers: { "Content-Type": "application/octet-stream" } }));

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.LH_STT_URL;
});

describe("POST /api/stt/local", () => {
	it("forwards the exact bytes to the local server and returns its text", async () => {
		const calls = stubFetch(() => Response.json({ text: "Ala", seconds: 0.5, device: "cuda" }));
		const res = await post(new Uint8Array([1, 2, 3, 4]));
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { text: "Ala" });
		assert.equal(calls[0]!.url, "http://127.0.0.1:8765/transcribe");
		assert.equal(calls[0]!.init?.method, "POST");
		assert.deepEqual([...new Uint8Array(calls[0]!.init?.body as ArrayBuffer)], [1, 2, 3, 4]);
	});

	it("honors LH_STT_URL", async () => {
		process.env.LH_STT_URL = "http://x:1";
		const calls = stubFetch(() => Response.json({ text: "" }));
		await post(new Uint8Array([0, 0]));
		assert.equal(calls[0]!.url, "http://x:1/transcribe");
	});

	it("an unreachable server is 503 stt-down", async () => {
		stubFetch(() => {
			throw new TypeError("fetch failed");
		});
		const res = await post(new Uint8Array([0, 0]));
		assert.equal(res.status, 503);
		assert.deepEqual(await res.json(), { message: "stt-down" });
	});

	it("a server error is 502", async () => {
		stubFetch(() => Response.json({ error: "boom" }, { status: 500 }));
		const res = await post(new Uint8Array([0, 0]));
		assert.equal(res.status, 502);
	});
});

describe("GET /api/stt/local", () => {
	it("an unreachable server reads ok:false with a 200", async () => {
		stubFetch(() => {
			throw new TypeError("fetch failed");
		});
		const res = await route.GET();
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { ok: false, backend: "python", model: "ready" });
	});

	it("passes the server's health through", async () => {
		const calls = stubFetch(() => Response.json({ ok: true, loaded: true, device: "cuda", model: "large-v3-turbo" }));
		const res = await route.GET();
		assert.deepEqual(await res.json(), { ok: true, loaded: true, device: "cuda", backend: "python", model: "ready" });
		assert.equal(calls[0]!.url, "http://127.0.0.1:8765/health");
	});
});

describe("POST /api/stt/local — slow transcriptions (final review I1)", () => {
	it("a timeout is 504 stt-timeout, not stt-down", async () => {
		stubFetch(() => {
			throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
		});
		const res = await post(new Uint8Array([0, 0]));
		assert.equal(res.status, 504);
		assert.deepEqual(await res.json(), { message: "stt-timeout" });
	});

	it("the timeout scales with the audio: 10 minutes get far more than 2 minutes", () => {
		assert.ok(transcribeTimeoutMs(19_200_000) >= 30 * 60_000);
		assert.equal(transcribeTimeoutMs(0), 120_000);
	});
});

describe("the proxy body cap (final review C1)", () => {
	it("next.config lets a full 10-minute recording through the proxy", async () => {
		const config = (await import("../next.config.ts")).default as { experimental?: { proxyClientMaxBodySize?: number } };
		assert.ok((config.experimental?.proxyClientMaxBodySize ?? 10 * 1024 * 1024) >= 19_200_000);
	});
});

const { __setSttForTests, WhisperError } = await import("../src/server/whisper-engine.ts");
const { __setModelDownloaderForTests } = await import("../src/server/stt-model.ts");

describe("/api/stt/local with the bundled whisper.cpp (desktop app)", () => {
	type Engine = Parameters<typeof __setSttForTests>[0] extends infer O ? O extends { engine?: infer E } ? NonNullable<E> : never : never;
	const fakeEngine = (transcribe: (wav: Uint8Array) => Promise<string>, running = false): Engine =>
		({ ensure: async () => ({ url: "http://127.0.0.1:1" }), transcribe, stop() {}, running: () => running }) as Engine;
	const downloader = (state: "missing" | "downloading" | "ready" | "error") =>
		({ status: () => ({ state, received: 0, total: 5 }), start: () => true });
	afterEach(() => {
		__setSttForTests(null);
		__setModelDownloaderForTests(null);
	});

	it("wraps the PCM in a WAV and returns the engine's text", async () => {
		let got: Uint8Array | null = null;
		__setSttForTests({ engine: fakeEngine(async (wav) => { got = wav; return "Ala ma kota."; }) });
		const res = await post(new Uint8Array([1, 2, 3, 4]));
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { text: "Ala ma kota." });
		assert.equal(got!.byteLength, 48);
		assert.equal(String.fromCharCode(...got!.subarray(0, 4)), "RIFF");
	});

	it("no model is 409 stt-no-model", async () => {
		__setSttForTests({ engine: fakeEngine(async () => { throw new WhisperError("no-model"); }) });
		const res = await post(new Uint8Array([0, 0]));
		assert.equal(res.status, 409);
		assert.deepEqual(await res.json(), { message: "stt-no-model" });
	});

	it("an engine that won't come up is 503 stt-down", async () => {
		__setSttForTests({ engine: fakeEngine(async () => { throw new WhisperError("down"); }) });
		const res = await post(new Uint8Array([0, 0]));
		assert.equal(res.status, 503);
		assert.deepEqual(await res.json(), { message: "stt-down" });
	});

	it("GET names the backend and the model state", async () => {
		__setSttForTests({ engine: fakeEngine(async () => "") });
		__setModelDownloaderForTests(downloader("missing") as never);
		assert.deepEqual(await (await route.GET()).json(), { ok: true, backend: "whispercpp", model: "missing", device: null });
		__setModelDownloaderForTests(downloader("ready") as never);
		assert.deepEqual(await (await route.GET()).json(), { ok: true, backend: "whispercpp", model: "ready", device: null });
	});
});
