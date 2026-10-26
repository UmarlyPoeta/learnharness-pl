/**
 * The dictation section (local Whisper wave, 2026-10-26): the engine pick
 * resolves to "local" unless the record says "deepgram"; the sanitizer
 * drops unknown engines; the PUT parser rejects them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dictationEngine, sanitizeUserSettings } from "../src/core/settings.ts";
import { parseDictationSettingsBody, SETTINGS_SECTIONS } from "../src/server/settings-body.ts";

describe("dictationEngine — the resolved engine", () => {
	it("no record or no section resolves to local", () => {
		assert.equal(dictationEngine(null), "local");
		assert.equal(dictationEngine(undefined), "local");
		assert.equal(dictationEngine({ version: 1 }), "local");
	});

	it("an explicit deepgram pick wins", () => {
		assert.equal(dictationEngine({ version: 1, dictation: { engine: "deepgram" } }), "deepgram");
	});
});

describe("sanitizeUserSettings — dictation", () => {
	it("drops an unknown engine", () => {
		assert.deepEqual(sanitizeUserSettings({ version: 1, dictation: { engine: "whisper" } })?.dictation, {});
	});

	it("keeps a known engine", () => {
		assert.deepEqual(sanitizeUserSettings({ version: 1, dictation: { engine: "local" } })?.dictation, { engine: "local" });
	});
});

describe("parseDictationSettingsBody — the PUT parser", () => {
	it("accepts both engines", () => {
		assert.deepEqual(parseDictationSettingsBody({ engine: "local" }), { ok: true, settings: { engine: "local" } });
		assert.deepEqual(parseDictationSettingsBody({ engine: "deepgram" }), { ok: true, settings: { engine: "deepgram" } });
	});

	it("rejects an unknown engine, naming the field", () => {
		const r = parseDictationSettingsBody({ engine: "x" });
		assert.equal(r.ok, false);
		assert.match((r as { error: string }).error, /engine/);
	});

	it("rejects a non-object body", () => {
		assert.equal(parseDictationSettingsBody(null).ok, false);
	});

	it("is registered as a writable section", () => {
		assert.ok("dictation" in SETTINGS_SECTIONS);
	});
});
