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

type FakeChild = { killed: boolean; exit: (code: number | null) => void; error: (e: Error) => void };

function fakes(opts: { healthAfter?: number; inference?: () => Response | Promise<Response> } = {}) {
	const spawned: Array<{ cmd: string; args: string[]; opts: Parameters<SpawnLike>[2]; child: FakeChild }> = [];
	const spawnImpl: SpawnLike = (cmd, args, spawnOpts) => {
		let onExit: ((code: number | null) => void) | null = null;
		let onError: ((e: Error) => void) | null = null;
		const child: FakeChild = { killed: false, exit: (code) => onExit?.(code), error: (e) => onError?.(e) };
		spawned.push({ cmd, args, opts: spawnOpts, child });
		return {
			pid: 4242,
			kill: () => {
				child.killed = true;
				onExit?.(null);
				return true;
			},
			on: ((ev: "exit" | "error", cb: (arg: never) => void) => {
				if (ev === "exit") onExit = cb as (code: number | null) => void;
				else onError = cb as (e: Error) => void;
			}) as ReturnType<SpawnLike>["on"],
			stderr: null,
		};
	};
	let healthCalls = 0;
	const bodies: FormData[] = [];
	const inits: Array<RequestInit | undefined> = [];
	const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
		const u = String(url);
		if (u.endsWith("/health")) {
			healthCalls++;
			return new Response("{}", { status: healthCalls > (opts.healthAfter ?? 0) ? 200 : 503 });
		}
		if (u.endsWith("/inference")) {
			bodies.push(init?.body as FormData);
			inits.push(init);
			return opts.inference ? opts.inference() : Response.json({ text: " Ala ma kota. " });
		}
		throw new Error(`unexpected ${u}`);
	}) as typeof fetch;
	return { spawned, spawnImpl, fetchImpl, bodies, inits, health: () => healthCalls };
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
		// The model is passed RELATIVE to cwd: whisper.cpp reads narrow argv
		// as UTF-8, but on Windows argv arrives in the ANSI code page — a
		// profile path with Polish letters would not open (final review C2).
		assert.deepEqual(f.spawned[0]!.args, ["--host", "127.0.0.1", "--port", "5555", "-m", "x.bin", "-l", "pl", "-t", "4"]);
		assert.equal(f.spawned[0]!.opts.cwd, "/m");
		assert.equal(f.spawned[0]!.opts.windowsHide, true, "no console window on Windows");
		assert.deepEqual(f.spawned[0]!.opts.stdio, ["ignore", "ignore", "pipe"], "stdout is never read — an unread pipe blocks the server");
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
		assert.equal(f.spawned[0]!.args[5], "x.bin", "only the ASCII file name goes through argv");
		assert.equal(f.spawned[0]!.opts.cwd, "C:\\Users\\Łukasz Nowak\\AppData\\Roaming\\LearnHarness PL\\data\\models");
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

	it("a spawn error (missing or quarantined binary) is down at once, and the next ensure retries", async () => {
		const f = fakes({ healthAfter: Number.POSITIVE_INFINITY });
		const e = engine(f, { readyTimeoutMs: 5_000 });
		const started = Date.now();
		const pending = e.ensure();
		await new Promise((r) => setTimeout(r, 5));
		f.spawned[0]!.child.error(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
		await assert.rejects(pending, (err: unknown) => err instanceof WhisperError && err.code === "down");
		assert.ok(Date.now() - started < 1_000, "no wait for the ready timeout");
		assert.equal(e.running(), false);
	});

	it("idle never stops a request still in flight", async () => {
		let releaseA!: () => void;
		const gateA = new Promise<void>((r) => (releaseA = r));
		let calls = 0;
		const f = fakes({
			inference: async () => {
				calls++;
				if (calls === 1) await gateA; // A: long
				if (calls === 3) await sleep(40); // C: longer than idleMs
				return Response.json({ text: "ok" });
			},
		});
		const e = engine(f, { idleMs: 15 });
		const a = e.transcribe(wav);
		await sleep(2);
		await e.transcribe(wav); // B finishes while A is still in flight
		await sleep(25); // past idleMs since B — A still running
		assert.equal(e.running(), true, "A is in flight");
		releaseA();
		await a;
		const c = e.transcribe(wav);
		await sleep(25); // A's and B's timers would have fired during C
		assert.equal(e.running(), true, "C is in flight");
		await c;
		await sleep(40);
		assert.equal(e.running(), false, "idles out once nothing is in flight");
	});

	it("a slow transcription times out as slow, passes a signal, and keeps the server", async () => {
		const f = fakes({ inference: () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); } });
		const e = engine(f);
		await assert.rejects(e.transcribe(wav), (err: unknown) => err instanceof WhisperError && err.code === "slow");
		assert.ok(f.inits[0]?.signal instanceof AbortSignal);
		assert.equal(e.running(), true);
		e.stop();
	});

	it("a failed inference is down and stops the process", async () => {
		const f = fakes({ inference: () => new Response("boom", { status: 500 }) });
		const e = engine(f);
		await assert.rejects(e.transcribe(wav), (err: unknown) => err instanceof WhisperError && err.code === "down");
		assert.equal(e.running(), false);
	});
});
