/**
 * The managed whisper.cpp engine (release wave, 2026-10-27) — local
 * dictation in the installed desktop app, no Python. Electron passes the
 * bundled binary as LH_WHISPER_BIN; this module starts `whisper-server` on
 * the first dictation (free 127.0.0.1 port, the downloaded model, Polish),
 * waits for its /health, shares that one process across concurrent
 * requests, stops it after idling (VRAM stays free between sessions) and
 * starts a fresh one after a crash. Without LH_WHISPER_BIN the dictation
 * route keeps proxying to the Python dev server (stt/server.py).
 *
 * Arguments go to spawn as an array — never through a shell — so profile
 * paths with spaces or Polish letters stay one argument each.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { transcribeTimeoutMs } from "./stt-local.ts";

export const MODEL_FILE = "ggml-large-v3-turbo-q5_0.bin";

export class WhisperError extends Error {
	/** no-model: download it first; down: won't start / crashed; slow: the
	 *  transcription outlived its wait (the server keeps running). */
	constructor(readonly code: "no-model" | "down" | "slow", message?: string) {
		super(message ?? code);
	}
}

export type ChildLike = {
	pid?: number;
	kill(): boolean;
	on(ev: "exit", cb: (code: number | null) => void): unknown;
	on(ev: "error", cb: (err: Error) => void): unknown;
	stderr?: NodeJS.ReadableStream | null;
};
export type SpawnLike = (
	cmd: string,
	args: string[],
	opts: { cwd: string; stdio: ["ignore", "ignore", "pipe"]; windowsHide: true },
) => ChildLike;

export interface WhisperEngine {
	ensure(): Promise<{ url: string }>;
	transcribe(wav: Uint8Array<ArrayBuffer>): Promise<string>;
	stop(): void;
	running(): boolean;
}

export function createWhisperEngine(o: {
	bin: string;
	modelPath: string;
	threads: number;
	spawnImpl: SpawnLike;
	fetchImpl: typeof fetch;
	freePort: () => Promise<number>;
	modelExists: () => boolean;
	idleMs?: number;
	readyTimeoutMs?: number;
	pollMs?: number;
	onChild?: (child: ChildLike) => void;
}): WhisperEngine {
	const idleMs = o.idleMs ?? 600_000;
	const readyTimeoutMs = o.readyTimeoutMs ?? 60_000;
	const pollMs = o.pollMs ?? 250;
	let child: ChildLike | null = null;
	let url: string | null = null;
	let starting: Promise<{ url: string }> | null = null;
	let idle: ReturnType<typeof setTimeout> | null = null;
	/** Transcriptions in flight — the idle timer only arms at zero. */
	let inFlight = 0;

	const clearIdle = () => {
		if (idle) clearTimeout(idle);
		idle = null;
	};
	const stop = () => {
		clearIdle();
		const c = child;
		child = null;
		url = null;
		c?.kill();
	};

	async function start(): Promise<{ url: string }> {
		const port = await o.freePort();
		const base = `http://127.0.0.1:${port}`;
		// The model goes RELATIVE to cwd: whisper.cpp decodes narrow argv as
		// UTF-8, but Windows hands it the ANSI code page — a profile path with
		// Polish letters would fail to open. The file name itself is ASCII.
		const p = o.modelPath.includes("\\") ? path.win32 : path.posix;
		const args = ["--host", "127.0.0.1", "--port", String(port), "-m", p.basename(o.modelPath), "-l", "pl", "-t", String(o.threads)];
		// stdout is never read: an unread pipe fills up and blocks the server.
		const c = o.spawnImpl(o.bin, args, { cwd: p.dirname(o.modelPath), stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
		child = c;
		let exited = false;
		const gone = () => {
			exited = true;
			if (child === c) {
				child = null;
				url = null;
				clearIdle();
			}
		};
		c.on("exit", gone);
		// A missing or quarantined binary emits only "error" (no "exit") — and
		// an unhandled "error" would take the whole server down.
		c.on("error", gone);
		o.onChild?.(c);
		const deadline = Date.now() + readyTimeoutMs;
		while (!exited && Date.now() < deadline) {
			try {
				const res = await o.fetchImpl(`${base}/health`);
				if (res.ok) {
					url = base;
					return { url: base };
				}
			} catch {
				// not listening yet
			}
			if (exited) break;
			await new Promise((r) => setTimeout(r, pollMs));
		}
		if (child === c) stop();
		throw new WhisperError("down", exited ? "whisper-server exited during startup" : "whisper-server did not become ready");
	}

	async function ensure(): Promise<{ url: string }> {
		if (!o.modelExists()) throw new WhisperError("no-model");
		if (child && url) return { url };
		if (!starting) starting = start().finally(() => (starting = null));
		return starting;
	}

	async function transcribe(wav: Uint8Array<ArrayBuffer>): Promise<string> {
		const { url: base } = await ensure();
		inFlight++;
		clearIdle();
		const form = new FormData();
		form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
		form.append("response_format", "json");
		form.append("temperature", "0");
		try {
			let res: Response;
			try {
				res = await o.fetchImpl(`${base}/inference`, {
					method: "POST",
					body: form,
					signal: AbortSignal.timeout(transcribeTimeoutMs(wav.byteLength)),
				});
			} catch (e) {
				// Still transcribing, just slower than we wait — keep the server.
				if (e instanceof DOMException && e.name === "TimeoutError") throw new WhisperError("slow", e.message);
				stop();
				throw new WhisperError("down", e instanceof Error ? e.message : String(e));
			}
			if (!res.ok) {
				stop();
				throw new WhisperError("down", `inference ${res.status}`);
			}
			const text = ((await res.json()) as { text?: string }).text ?? "";
			// whisper.cpp ends each segment with a newline — a dictated answer is one line.
			return text.replace(/\s+/g, " ").trim();
		} finally {
			inFlight--;
			if (inFlight === 0 && child) {
				clearIdle();
				idle = setTimeout(stop, idleMs);
				idle.unref?.();
			}
		}
	}

	return { ensure, transcribe, stop, running: () => child !== null };
}

/** Loopback fetch over node:http with no headers/body timeouts — whisper-server
 *  answers only after the whole transcription, which on CPU can outlast
 *  undici's 300 s headersTimeout; the caller's AbortSignal is the only limit. */
export async function localFetch(url: string, init: RequestInit = {}): Promise<Response> {
	const request = new Request(url, init);
	const body = init.body == null ? null : Buffer.from(await request.arrayBuffer());
	const headers: Record<string, string> = {};
	request.headers.forEach((value, key) => (headers[key] = value));
	if (body) headers["content-length"] = String(body.byteLength);
	return new Promise<Response>((resolve, reject) => {
		const req = http.request(url, { method: request.method, headers, signal: init.signal ?? undefined }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (c: Buffer) => chunks.push(c));
			res.on("error", reject);
			res.on("end", () => {
				const out = new Headers();
				for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") out.set(k, v);
				resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500, headers: out }));
			});
		});
		req.on("error", (e) => reject(init.signal?.aborted ? init.signal.reason : e));
		if (body) req.write(body);
		req.end();
	});
}

export function modelPath(): string {
	return path.join(PATHS.data, "models", MODEL_FILE);
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.once("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address() as net.AddressInfo;
			srv.close(() => resolve(port));
		});
	});
}

let singleton: WhisperEngine | null | undefined;
let testOverride: { engine?: WhisperEngine | null } | null = null;

/** The app's engine from the environment — null without LH_WHISPER_BIN. */
export function whisperEngine(): WhisperEngine | null {
	if (testOverride && "engine" in testOverride) return testOverride.engine ?? null;
	if (singleton !== undefined) return singleton;
	const bin = process.env.LH_WHISPER_BIN;
	if (!bin) return (singleton = null);
	const model = modelPath();
	const logFile = path.join(PATHS.data, "whisper-server.log");
	singleton = createWhisperEngine({
		bin,
		modelPath: model,
		threads: Math.min(8, os.availableParallelism()),
		spawnImpl: spawn as unknown as SpawnLike,
		fetchImpl: ((input: string | URL | Request, init?: RequestInit) => localFetch(String(input instanceof Request ? input.url : input), init)) as typeof fetch,
		freePort,
		modelExists: () => fs.existsSync(model),
		onChild: (c) => {
			fs.mkdirSync(PATHS.data, { recursive: true });
			const log = fs.createWriteStream(logFile, { flags: "a" });
			c.stderr?.pipe(log);
		},
	});
	// The server process exiting (app quit, update install) takes
	// whisper-server with it — an orphan would hold VRAM and lock the
	// files the next update must replace.
	const engine = singleton;
	process.once("exit", () => engine.stop());
	return singleton;
}

/** Test seam: replaces what whisperEngine() returns (NODE_ENV=test only). */
export function __setSttForTests(over: { engine?: WhisperEngine | null } | null): void {
	if (process.env.NODE_ENV !== "test") return;
	testOverride = over;
}
