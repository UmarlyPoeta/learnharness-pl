/**
 * The managed whisper.cpp engine (release wave, 2026-10-27): the desktop
 * app's server starts whisper-server on first dictation, waits for
 * /health, shares one process across concurrent requests, stops it after
 * idling, and starts a fresh one after a crash. No process, no network:
 * spawn and fetch are fakes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWhisperEngine, WhisperError, type SpawnLike } from "../src/server/whisper-engine.ts";

type FakeChild = { killed: boolean; exit: (code: number | null) => void };

function fakes(opts: { healthAfter?: number; inference?: () => Response } = {}) {
	const spawned: Array<{ cmd: string; args: string[]; child: FakeChild }> = [];
	const spawnImpl: SpawnLike = (cmd, args) => {
		let onExit: ((code: number | null) => void) | null = null;
		const child: FakeChild = { killed: false, exit: (code) => onExit?.(code) };
		spawned.push({ cmd, args, child });
		return {
			pid: 4242,
			kill: () => {
				child.killed = true;
				onExit?.(null);
				return true;
			},
			on: (_ev: "exit", cb: (code: number | null) => void) => {
				onExit = cb;
			},
			stderr: null,
		};
	};
	let healthCalls = 0;
	const bodies: FormData[] = [];
	const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
		const u = String(url);
		if (u.endsWith("/health")) {
			healthCalls++;
			return new Response("{}", { status: healthCalls > (opts.healthAfter ?? 0) ? 200 : 503 });
		}
		if (u.endsWith("/inference")) {
			bodies.push(init?.body as FormData);
			return opts.inference ? opts.inference() : Response.json({ text: " Ala ma kota. " });
		}
		throw new Error(`unexpected ${u}`);
	}) as typeof fetch;
	return { spawned, spawnImpl, fetchImpl, bodies, health: () => healthCalls };
}

function engine(f: ReturnType<typeof fakes>, over: Partial<Parameters<typeof createWhisperEngine>[0]> = {}) {
	return createWhisperEngine({
		bin: "/w/whisper-server",
		modelPath: "/m/x.bin",
		threads: 4,
		spawnImpl: f.spawnImpl,
		fetchImpl: f.fetchImpl,
		freePort: async () => 5555,
		modelExists: () => true,
		pollMs: 1,
		...over,
	});
}

const wav = new Uint8Array([82, 73, 70, 70]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("whisper engine", () => {
	it("spawns with the pinned args and waits for /health", async () => {
		const f = fakes({ healthAfter: 1 });
		const e = engine(f);
		assert.deepEqual(await e.ensure(), { url: "http://127.0.0.1:5555" });
		assert.equal(f.spawned.length, 1);
		assert.equal(f.spawned[0]!.cmd, "/w/whisper-server");
		assert.deepEqual(f.spawned[0]!.args, ["--host", "127.0.0.1", "--port", "5555", "-m", "/m/x.bin", "-l", "pl", "-t", "4"]);
		assert.ok(f.health() >= 2, "polled past the first 503");
		e.stop();
	});

	it("paths with spaces and Polish letters stay one argument each", async () => {
		const f = fakes();
		const bin = "C:\\Users\\Łukasz Nowak\\AppData\\whisper\\whisper-server.exe";
		const model = "C:\\Users\\Łukasz Nowak\\AppData\\Roaming\\LearnHarness PL\\data\\models\\x.bin";
		const e = engine(f, { bin, modelPath: model });
		await e.ensure();
		assert.equal(f.spawned[0]!.cmd, bin);
		assert.equal(f.spawned[0]!.args[5], model);
		e.stop();
	});

	it("concurrent ensure calls share one process", async () => {
		const f = fakes({ healthAfter: 2 });
		const e = engine(f);
		const [a, b] = await Promise.all([e.ensure(), e.ensure()]);
		assert.equal(f.spawned.length, 1);
		assert.deepEqual(a, b);
		e.stop();
	});

	it("no model: no-model, and nothing is spawned", async () => {
		const f = fakes();
		const e = engine(f, { modelExists: () => false });
		await assert.rejects(e.ensure(), (err: unknown) => err instanceof WhisperError && err.code === "no-model");
		assert.equal(f.spawned.length, 0);
	});

	it("health never ready: down, and the process is killed", async () => {
		const f = fakes({ healthAfter: Number.POSITIVE_INFINITY });
		const e = engine(f, { readyTimeoutMs: 50 });
		await assert.rejects(e.ensure(), (err: unknown) => err instanceof WhisperError && err.code === "down");
		assert.equal(f.spawned[0]!.child.killed, true);
		assert.equal(e.running(), false);
	});

	it("a process that exits is replaced on the next ensure", async () => {
		const f = fakes();
		const e = engine(f);
		await e.ensure();
		f.spawned[0]!.child.exit(1);
		assert.equal(e.running(), false);
		await e.ensure();
		assert.equal(f.spawned.length, 2);
		e.stop();
	});

	it("stops after idling", async () => {
		const f = fakes();
		const e = engine(f, { idleMs: 10 });
		await e.transcribe(wav);
		assert.equal(e.running(), true);
		await sleep(40);
		assert.equal(e.running(), false);
		assert.equal(f.spawned[0]!.child.killed, true);
	});

	it("transcribe posts the WAV as multipart and trims the text", async () => {
		const f = fakes();
		const e = engine(f);
		assert.equal(await e.transcribe(wav), "Ala ma kota.");
		const form = f.bodies[0]!;
		assert.equal(form.get("response_format"), "json");
		assert.equal(form.get("temperature"), "0");
		const file = form.get("file") as Blob;
		assert.equal(file.type, "audio/wav");
		assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [82, 73, 70, 70]);
		e.stop();
	});

	it("segments whisper.cpp splits across lines read as one line of text", async () => {
		const f = fakes({ inference: () => Response.json({ text: " Pochodna funkcji złożonej.\n Sprawdźmy to.\n" }) });
		const e = engine(f);
		assert.equal(await e.transcribe(wav), "Pochodna funkcji złożonej. Sprawdźmy to.");
		e.stop();
	});

	it("a failed inference is down and stops the process", async () => {
		const f = fakes({ inference: () => new Response("boom", { status: 500 }) });
		const e = engine(f);
		await assert.rejects(e.transcribe(wav), (err: unknown) => err instanceof WhisperError && err.code === "down");
		assert.equal(e.running(), false);
	});
});
