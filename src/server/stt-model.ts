/**
 * The local dictation model download (release wave, 2026-10-27): one
 * click in Settings fetches whisper.cpp's large-v3-turbo (q5_0) into the
 * data dir. One download at a time; progress while it streams; the bytes
 * go to `<dest>.part`, are hashed on the way, and only a matching SHA-256
 * is renamed into place — a killed app or a bad network never leaves a
 * half-written model that would later look "ready".
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { modelPath } from "./whisper-engine.ts";

export type ModelStatus = {
	state: "missing" | "downloading" | "ready" | "error";
	received: number;
	total: number;
	error?: string;
};

export const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
export const MODEL_SIZE = 574_041_195;
export const MODEL_SHA256 = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2";

export function createModelDownloader(o: {
	url: string;
	sha256: string;
	size: number;
	dest: string;
	fetchImpl: typeof fetch;
}): { status(): ModelStatus; start(): boolean } {
	let running = false;
	let received = 0;
	let error: string | undefined;
	const part = `${o.dest}.part`;

	const status = (): ModelStatus => {
		if (running) return { state: "downloading", received, total: o.size };
		if (fs.existsSync(o.dest)) return { state: "ready", received: o.size, total: o.size };
		if (error) return { state: "error", received, total: o.size, error };
		return { state: "missing", received: 0, total: o.size };
	};

	async function download(): Promise<void> {
		fs.mkdirSync(path.dirname(o.dest), { recursive: true });
		const res = await o.fetchImpl(o.url);
		if (res.status !== 200 || !res.body) throw new Error(`Pobieranie nie powiodło się (HTTP ${res.status})`);
		const hash = createHash("sha256");
		const out = fs.createWriteStream(part, { flags: "w" });
		const done = new Promise<void>((resolve, reject) => {
			out.on("finish", resolve);
			out.on("error", reject);
		});
		const reader = res.body.getReader();
		try {
			for (;;) {
				const { done: end, value } = await reader.read();
				if (end) break;
				hash.update(value);
				received += value.byteLength;
				if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
			}
		} finally {
			out.end();
		}
		await done;
		if (hash.digest("hex") !== o.sha256) throw new Error("Suma kontrolna się nie zgadza — plik jest uszkodzony, spróbuj ponownie");
		fs.renameSync(part, o.dest);
	}

	function start(): boolean {
		if (running) return false;
		running = true;
		received = 0;
		error = undefined;
		download()
			.catch((e: unknown) => {
				error = e instanceof Error ? e.message : String(e);
				fs.rmSync(part, { force: true });
			})
			.finally(() => {
				running = false;
			});
		return true;
	}

	return { status, start };
}

let singleton: ReturnType<typeof createModelDownloader> | null = null;
let testOverride: ReturnType<typeof createModelDownloader> | null = null;

export function modelDownloader(): ReturnType<typeof createModelDownloader> {
	if (testOverride) return testOverride;
	singleton ??= createModelDownloader({ url: MODEL_URL, sha256: MODEL_SHA256, size: MODEL_SIZE, dest: modelPath(), fetchImpl: fetch });
	return singleton;
}

/** Test seam: replaces what modelDownloader() returns (NODE_ENV=test only). */
export function __setModelDownloaderForTests(d: ReturnType<typeof createModelDownloader> | null): void {
	if (process.env.NODE_ENV !== "test") return;
	testOverride = d;
}
