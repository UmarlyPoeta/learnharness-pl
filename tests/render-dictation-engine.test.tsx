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
