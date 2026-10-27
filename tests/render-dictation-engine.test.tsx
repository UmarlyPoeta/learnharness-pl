/**
 * The dictation engine picker (local Whisper wave, 2026-10-26): Settings →
 * Dostawcy AI → Dyktowanie leads with the engine select and the local
 * server's status line.
 */

import React from "react";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DictationEngineRow } from "../components/settings/keys-section.tsx";

const render = (props: Partial<React.ComponentProps<typeof DictationEngineRow>>) =>
	renderToStaticMarkup(<DictationEngineRow engine="local" status={null} onChange={() => {}} {...props} />);

describe("DictationEngineRow", () => {
	it("renders the engine select with both engines, local selected", () => {
		const html = render({ status: { ok: true, device: "cuda" } });
		assert.ok(html.includes('data-testid="dictation-engine"'));
		assert.match(html, /<option value="local" selected="">Lokalny Whisper<\/option>/);
		assert.match(html, /<option value="deepgram">Deepgram<\/option>/);
	});

	it("a running server reads działa with its device", () => {
		assert.match(render({ status: { ok: true, device: "cuda" } }), /data-testid="dictation-engine-status"[^>]*>działa · cuda</);
	});

	it("a down server tells the user what to run", () => {
		assert.match(render({ status: { ok: false } }), /nie działa — uruchom learn/);
	});

	it("an unknown status reads sprawdzanie…", () => {
		assert.match(render({ status: null }), /sprawdzanie…/);
	});

	it("the deepgram engine shows no local status line", () => {
		assert.ok(!render({ engine: "deepgram", status: { ok: false } }).includes('data-testid="dictation-engine-status"'));
	});
});

describe("DictationEngineRow — the bundled whisper.cpp model (desktop app)", () => {
	const desktop = (model: "missing" | "downloading" | "ready" | "error") => ({ ok: true, backend: "whispercpp" as const, model, device: null });

	it("missing model: one-click download button", () => {
		const html = render({ status: desktop("missing") });
		assert.match(html, /data-testid="stt-model-download"[^>]*>Pobierz model \(ok\. 550 MB\)</);
	});

	it("downloading: progress in MB", () => {
		const html = render({ status: desktop("downloading"), download: { received: 104857600, total: 574041195 } });
		assert.match(html, /data-testid="stt-model-progress"[^>]*>Pobieranie: 100 \/ 547 MB</);
		assert.ok(!html.includes('data-testid="stt-model-download"'));
	});

	it("error: the message and a retry", () => {
		const html = render({ status: desktop("error"), download: { received: 0, total: 574041195, error: "Pobieranie nie powiodło się (HTTP 404)" } });
		assert.match(html, /Pobieranie nie powiodło się \(HTTP 404\)/);
		assert.match(html, /data-testid="stt-model-download"[^>]*>Spróbuj ponownie</);
	});

	it("ready: the usual status line, no download affordance", () => {
		const html = render({ status: desktop("ready") });
		assert.match(html, /data-testid="dictation-engine-status"[^>]*>działa · —</);
		assert.ok(!html.includes("stt-model-"));
	});
});
