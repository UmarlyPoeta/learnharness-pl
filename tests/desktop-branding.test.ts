/**
 * LearnHarness PL's desktop identity (release wave, 2026-10-27): the app
 * name decides the userData directory, so the fork must never share data
 * with the original LearnHarness install; the shell's own copy is Polish.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const main = readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");

describe("desktop branding", () => {
	it("the app name — and with it userData — is LearnHarness PL", () => {
		assert.match(main, /^const PRODUCT_NAME = "LearnHarness PL";$/m);
	});

	it("menus and update dialogs are Polish", () => {
		for (const english of ["Check for Updates…", "You're up to date.", "Couldn't check for updates.", '"Edit"', '"View"', "Actual Size", "Zoom In", "Zoom Out"]) {
			assert.ok(!main.includes(english), `English copy left: ${english}`);
		}
		for (const polish of ["Sprawdź aktualizacje…", "Masz najnowszą wersję.", "Edycja", "Widok", "Rzeczywisty rozmiar", "Powiększ", "Pomniejsz"]) {
			assert.ok(main.includes(polish), `missing: ${polish}`);
		}
	});
});

describe("bundled whisper.cpp wiring", () => {
	it("the packaged server is told where whisper-server lives", () => {
		assert.match(main, /LH_WHISPER_BIN/);
		assert.match(main, /path\.join\(process\.resourcesPath, "whisper", process\.platform === "win32" \? "whisper-server\.exe" : "whisper-server"\)/);
	});

	it("electron-builder ships resources/whisper as <resources>/whisper", async () => {
		const { createRequire } = await import("node:module");
		const yaml = createRequire(import.meta.url)("js-yaml") as { load(source: string): { extraResources: Array<{ from: string; to: string }> } };
		const config = yaml.load(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"));
		assert.ok(config.extraResources.some((entry) => entry.from === "resources/whisper" && entry.to === "whisper"));
	});
});
