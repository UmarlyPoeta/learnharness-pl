/**
 * useDictation's local-engine state machine (local Whisper wave, final
 * review): a mounted hook under linkedom with a fake mic, a fake worklet
 * port, and a scripted fetch — the paths the pure helpers can't reach.
 */

import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body><div id=root></div></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });

let worklet: { port: { onmessage: ((e: { data: unknown }) => void) | null } } | null = null;
class FakeAudioContext {
	state = "running";
	destination = {};
	audioWorklet = { addModule: async () => {} };
	createMediaStreamSource() {
		return { connect() {}, disconnect() {} };
	}
	async resume() {}
}
class FakeWorkletNode {
	port = { onmessage: null as ((e: { data: unknown }) => void) | null };
	constructor() {
		worklet = this;
	}
	connect() {}
	disconnect() {}
}
Object.assign(globalThis, { AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorkletNode });
Object.defineProperty(globalThis.navigator, "mediaDevices", {
	configurable: true,
	value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
});

const { useDictation, MAX_LOCAL_BYTES } = await import("../components/dictation.tsx");
const { notifySettingsSaved } = await import("../components/settings-signal.ts");
type Dictation = ReturnType<typeof useDictation>;

let engine: "local" | "deepgram" = "local";
let posts: Uint8Array[] = [];
let sttReply: () => Response = () => Response.json({ text: "Ala ma kota." });
const realFetch = globalThis.fetch;
let root: Root;
let d: Dictation;
let appended: string[];

function Harness() {
	d = useDictation({ append: (t) => appended.push(t) });
	return null;
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const frame = (bytes = 4096) => ({ data: { type: "audio", buffer: new ArrayBuffer(bytes) } });

beforeEach(async () => {
	engine = "local";
	posts = [];
	appended = [];
	sttReply = () => Response.json({ text: "Ala ma kota." });
	globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
		const u = String(url);
		if (u === "/api/settings") return Response.json({ settings: { version: 1, dictation: { engine } } });
		if (u === "/api/stt/local") {
			posts.push(init?.body as Uint8Array);
			return sttReply();
		}
		if (u === "/api/stt/token") return Response.json({ token: "t" });
		throw new Error(`unexpected fetch ${u}`);
	}) as typeof fetch;
	root = createRoot(document.getElementById("root")!);
	await act(async () => root.render(<Harness />));
	await flush();
});

afterEach(async () => {
	await act(async () => root.unmount());
	globalThis.fetch = realFetch;
});

async function record(frames: number) {
	await act(async () => d.toggle());
	await flush();
	assert.equal(d.phase, "recording");
	for (let i = 0; i < frames; i++) worklet!.port.onmessage!(frame());
}

test("a local run posts its audio once and appends the text", async () => {
	await record(3);
	await act(async () => d.stop());
	await flush();
	assert.equal(posts.length, 1);
	assert.equal(posts[0]!.byteLength, 3 * 4096);
	assert.deepEqual(appended, ["Ala ma kota."]);
	assert.equal(d.phase, "idle");
});

test("Esc while transcribing drops the late result", async () => {
	let release!: () => void;
	sttReply = () => Response.json({ text: "spóźnione" });
	const gate = new Promise<void>((r) => (release = r));
	const inner = globalThis.fetch;
	globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
		if (String(url) === "/api/stt/local") await gate;
		return inner(url, init);
	}) as typeof fetch;
	await record(2);
	await act(async () => d.stop());
	assert.equal(d.phase, "stopping");
	await act(async () => d.cancel());
	release();
	await flush();
	assert.deepEqual(appended, []);
	assert.equal(d.phase, "idle");
});

test("switching the engine mid-run still transcribes the run locally", async () => {
	await record(2);
	engine = "deepgram";
	await act(async () => notifySettingsSaved("dictation"));
	await flush();
	await act(async () => d.stop());
	await flush();
	assert.equal(posts.length, 1, "the run's audio reached the local server");
	assert.deepEqual(appended, ["Ala ma kota."]);
});

test("the 10-minute auto-stop never posts more than the server's cap", async () => {
	await record(Math.ceil(MAX_LOCAL_BYTES / 4096) + 3);
	await flush();
	assert.equal(posts.length, 1, "auto-stop fired once");
	assert.ok(posts[0]!.byteLength <= MAX_LOCAL_BYTES, `posted ${posts[0]!.byteLength} > ${MAX_LOCAL_BYTES}`);
});
