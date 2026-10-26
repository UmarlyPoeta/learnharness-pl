/**
 * /api/stt/local (local Whisper wave, 2026-10-26): the proxy to the local
 * faster-whisper server. fetch is swapped per test — no server, no network.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const route = await import("../app/api/stt/local/route.ts");
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
		assert.deepEqual(await res.json(), { ok: false });
	});

	it("passes the server's health through", async () => {
		const calls = stubFetch(() => Response.json({ ok: true, loaded: true, device: "cuda", model: "large-v3-turbo" }));
		const res = await route.GET();
		assert.deepEqual(await res.json(), { ok: true, loaded: true, device: "cuda" });
		assert.equal(calls[0]!.url, "http://127.0.0.1:8765/health");
	});
});
