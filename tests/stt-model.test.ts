/**
 * The dictation model download (release wave, 2026-10-27): one download
 * at a time, progress while streaming, SHA-256 checked before the file
 * lands, and nothing half-written left behind on any failure.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createModelDownloader, MODEL_URL } from "../src/server/stt-model.ts";

const BYTES = [1, 2, 3, 4, 5];
const SHA = createHash("sha256").update(Buffer.from(BYTES)).digest("hex");

function tmpDest(): string {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lh-model-")), "models", "m.bin");
}

/** A response streaming [1,2,3] then [4,5]; `gate` holds the second chunk. */
function streamFetch(gate?: Promise<void>, status = 200): typeof fetch {
	return (async () => {
		if (status !== 200) return new Response("nope", { status });
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				controller.enqueue(new Uint8Array([1, 2, 3]));
				if (gate) await gate;
				controller.enqueue(new Uint8Array([4, 5]));
				controller.close();
			},
		});
		return new Response(body, { status: 200, headers: { "content-length": "5" } });
	}) as typeof fetch;
}

async function settled(d: ReturnType<typeof createModelDownloader>) {
	for (let i = 0; i < 200 && d.status().state === "downloading"; i++) await new Promise((r) => setTimeout(r, 5));
	return d.status();
}

describe("model downloader", () => {
	it("missing before; ready after, with the exact bytes and no .part", async () => {
		const dest = tmpDest();
		const d = createModelDownloader({ url: "https://x/m.bin", sha256: SHA, size: 5, dest, fetchImpl: streamFetch() });
		assert.equal(d.status().state, "missing");
		assert.equal(d.start(), true);
		const s = await settled(d);
		assert.equal(s.state, "ready");
		assert.equal(s.received, 5);
		assert.deepEqual([...fs.readFileSync(dest)], BYTES);
		assert.equal(fs.existsSync(dest + ".part"), false);
	});

	it("reports progress while streaming", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const d = createModelDownloader({ url: "https://x/m.bin", sha256: SHA, size: 5, dest: tmpDest(), fetchImpl: streamFetch(gate) });
		d.start();
		for (let i = 0; i < 100 && d.status().received < 3; i++) await new Promise((r) => setTimeout(r, 5));
		assert.deepEqual({ state: d.status().state, received: d.status().received, total: d.status().total }, { state: "downloading", received: 3, total: 5 });
		release();
		assert.equal((await settled(d)).state, "ready");
	});

	it("a checksum mismatch is an error, and no file is left", async () => {
		const dest = tmpDest();
		const d = createModelDownloader({ url: "https://x/m.bin", sha256: "00".repeat(32), size: 5, dest, fetchImpl: streamFetch() });
		d.start();
		const s = await settled(d);
		assert.equal(s.state, "error");
		assert.match(s.error ?? "", /Suma kontrolna/);
		assert.equal(fs.existsSync(dest), false);
		assert.equal(fs.existsSync(dest + ".part"), false);
	});

	it("an HTTP failure names the status and leaves no .part", async () => {
		const dest = tmpDest();
		const d = createModelDownloader({ url: "https://x/m.bin", sha256: SHA, size: 5, dest, fetchImpl: streamFetch(undefined, 404) });
		d.start();
		const s = await settled(d);
		assert.equal(s.state, "error");
		assert.match(s.error ?? "", /HTTP 404/);
		assert.equal(fs.existsSync(dest + ".part"), false);
	});

	it("a network failure is an error with its message", async () => {
		const d = createModelDownloader({
			url: "https://x/m.bin", sha256: SHA, size: 5, dest: tmpDest(),
			fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch,
		});
		d.start();
		const s = await settled(d);
		assert.equal(s.state, "error");
		assert.match(s.error ?? "", /fetch failed/);
	});

	it("a stale .part from a killed run is overwritten, not appended to", async () => {
		const dest = tmpDest();
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest + ".part", Buffer.alloc(10, 7));
		const d = createModelDownloader({ url: "https://x/m.bin", sha256: SHA, size: 5, dest, fetchImpl: streamFetch() });
		assert.equal(d.status().state, "missing", "a leftover .part is not a model");
		d.start();
		assert.equal((await settled(d)).state, "ready");
		assert.deepEqual([...fs.readFileSync(dest)], BYTES);
	});

	it("a write failure (full disk) ends in error instead of hanging", async () => {
		const dest = tmpDest();
		fs.mkdirSync(dest + ".part", { recursive: true }); // .part is a directory: the write stream fails like ENOSPC would
		const d = createModelDownloader({ url: "https://x/m.bin", sha256: SHA, size: 5, dest, fetchImpl: streamFetch() });
		d.start();
		const s = await settled(d);
		assert.equal(s.state, "error");
		assert.ok(s.error);
	});

	it("the model URL is pinned to a repository revision, not main", () => {
		assert.match(MODEL_URL, /\/resolve\/[0-9a-f]{40}\/ggml-large-v3-turbo-q5_0\.bin$/);
	});

	it("a second start while downloading is refused", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const d = createModelDownloader({ url: "https://x/m.bin", sha256: SHA, size: 5, dest: tmpDest(), fetchImpl: streamFetch(gate) });
		assert.equal(d.start(), true);
		assert.equal(d.start(), false);
		release();
		await settled(d);
	});

	it("an existing model reads ready without downloading", () => {
		const dest = tmpDest();
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, Buffer.from(BYTES));
		const d = createModelDownloader({ url: "https://x/m.bin", sha256: SHA, size: 5, dest, fetchImpl: streamFetch() });
		assert.deepEqual(d.status(), { state: "ready", received: 5, total: 5 });
	});
});

describe("/api/stt/model", () => {
	it("GET reports the status; POST starts once, then 409 while downloading", async () => {
		const { __setModelDownloaderForTests } = await import("../src/server/stt-model.ts");
		const route = await import("../app/api/stt/model/route.ts");
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		__setModelDownloaderForTests(createModelDownloader({ url: "https://x/m.bin", sha256: SHA, size: 5, dest: tmpDest(), fetchImpl: streamFetch(gate) }));
		try {
			assert.deepEqual(await (await route.GET()).json(), { state: "missing", received: 0, total: 5 });
			const first = await route.POST();
			assert.equal(first.status, 202);
			assert.equal(((await first.json()) as { state: string }).state, "downloading");
			const second = await route.POST();
			assert.equal(second.status, 409);
			assert.deepEqual(await second.json(), { message: "already-downloading" });
			release();
		} finally {
			__setModelDownloaderForTests(null);
		}
	});
});
