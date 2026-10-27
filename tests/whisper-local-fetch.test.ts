/**
 * The engine's loopback fetch (final review I5/C3): node:http without
 * undici's 300 s headersTimeout — whisper-server sends headers only after a
 * whole (possibly minutes-long, CPU) transcription — aborted by a signal;
 * and the engine singleton stops whisper-server when the server process
 * exits, so a quit never orphans it.
 */
import assert from "node:assert/strict";
import * as http from "node:http";
import { after, describe, it } from "node:test";
import { localFetch, whisperEngine } from "../src/server/whisper-engine.ts";

const received: Array<{ method?: string; type?: string; body: Buffer }> = [];
const server = http.createServer((req, res) => {
	const chunks: Buffer[] = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", () => {
		received.push({ method: req.method, type: req.headers["content-type"], body: Buffer.concat(chunks) });
		if (req.url === "/slow") return setTimeout(() => res.end("{}"), 2_000);
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ text: "Ala", url: req.url }));
	});
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => server.close());

describe("localFetch", () => {
	it("GET returns a Response with status and JSON body", async () => {
		const res = await localFetch(`${base}/health`);
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { text: "Ala", url: "/health" });
	});

	it("POST serializes FormData as multipart with the file bytes", async () => {
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array([82, 73, 70, 70])], { type: "audio/wav" }), "audio.wav");
		form.append("response_format", "json");
		const res = await localFetch(`${base}/inference`, { method: "POST", body: form });
		assert.equal(res.status, 200);
		const last = received.at(-1)!;
		assert.equal(last.method, "POST");
		assert.match(last.type ?? "", /^multipart\/form-data; boundary=/);
		assert.ok(last.body.includes(Buffer.from("RIFF")));
		assert.ok(last.body.includes(Buffer.from('name="response_format"')));
	});

	it("an aborted signal rejects with the signal's reason", async () => {
		await assert.rejects(
			localFetch(`${base}/slow`, { signal: AbortSignal.timeout(50) }),
			(err: unknown) => err instanceof DOMException && err.name === "TimeoutError",
		);
	});
});

describe("whisperEngine singleton", () => {
	it("stops whisper-server when this process exits", () => {
		const before = process.listenerCount("exit");
		process.env.LH_WHISPER_BIN = "/nonexistent/whisper-server";
		try {
			assert.ok(whisperEngine());
			assert.equal(process.listenerCount("exit"), before + 1);
		} finally {
			delete process.env.LH_WHISPER_BIN;
		}
	});
});
