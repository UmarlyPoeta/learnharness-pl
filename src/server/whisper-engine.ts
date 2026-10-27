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
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { PATHS } from "../../config.ts";

export const MODEL_FILE = "ggml-large-v3-turbo-q5_0.bin";

export class WhisperError extends Error {
	constructor(readonly code: "no-model" | "down", message?: string) {
		super(message ?? code);
	}
}

export type ChildLike = {
	pid?: number;
	kill(): boolean;
	on(ev: "exit", cb: (code: number | null) => void): unknown;
	stderr?: NodeJS.ReadableStream | null;
};
export type SpawnLike = (cmd: string, args: string[], opts: { stdio: ["ignore", "pipe", "pipe"] }) => ChildLike;

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
		const args = ["--host", "127.0.0.1", "--port", String(port), "-m", o.modelPath, "-l", "pl", "-t", String(o.threads)];
		const c = o.spawnImpl(o.bin, args, { stdio: ["ignore", "pipe", "pipe"] });
		child = c;
		let exited = false;
		c.on("exit", () => {
			exited = true;
			if (child === c) {
				child = null;
				url = null;
				clearIdle();
			}
		});
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
		clearIdle();
		const form = new FormData();
		form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
		form.append("response_format", "json");
		form.append("temperature", "0");
		let text: string;
		try {
			const res = await o.fetchImpl(`${base}/inference`, { method: "POST", body: form });
			if (!res.ok) throw new Error(`inference ${res.status}`);
			text = ((await res.json()) as { text?: string }).text ?? "";
		} catch (e) {
			stop();
			throw new WhisperError("down", e instanceof Error ? e.message : String(e));
		}
		idle = setTimeout(stop, idleMs);
		idle.unref?.();
		return text.trim();
	}

	return { ensure, transcribe, stop, running: () => child !== null };
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
		fetchImpl: fetch,
		freePort,
		modelExists: () => fs.existsSync(model),
		onChild: (c) => {
			fs.mkdirSync(PATHS.data, { recursive: true });
			const log = fs.createWriteStream(logFile, { flags: "a" });
			c.stderr?.pipe(log);
		},
	});
	return singleton;
}

/** Test seam: replaces what whisperEngine() returns (NODE_ENV=test only). */
export function __setSttForTests(over: { engine?: WhisperEngine | null } | null): void {
	if (process.env.NODE_ENV !== "test") return;
	testOverride = over;
}
