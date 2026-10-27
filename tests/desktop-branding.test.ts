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
		// Upstream 0.3.8 moved manual-check results from dialogs to Settings → General.
		for (const polish of ["Sprawdź aktualizacje…", "Edycja", "Widok", "Rzeczywisty rozmiar", "Powiększ", "Pomniejsz"]) {
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

describe("bundled whisper.cpp build hygiene (final review)", () => {
	const script = readFileSync(new URL("../scripts/build-whisper.sh", import.meta.url), "utf8");
	const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
	const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

	it("Linux installs the SPIR-V headers ggml-vulkan's CMake requires", () => {
		assert.match(release, /apt-get install -y [^\n]*\blibvulkan-dev\b[^\n]*\bglslc\b[^\n]*\bspirv-headers\b|apt-get install -y [^\n]*\bspirv-headers\b/);
	});

	it("no runtime DLL the user may lack: static MSVC runtime, no OpenMP", () => {
		assert.match(script, /-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded\b/);
		assert.match(script, /-DGGML_OPENMP=OFF\b/);
	});

	it("ships whisper.cpp's MIT license next to the binaries", () => {
		assert.match(script, /cp "\$SRC\/LICENSE" "\$OUT\/LICENSE-whisper\.cpp\.txt"/);
	});

	it("TypeScript never compiles the whisper.cpp tree (CMake writes compiler_depend.ts files)", () => {
		const tsconfig = JSON.parse(readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8")) as { exclude: string[] };
		assert.ok(tsconfig.exclude.includes("build/whisper-src"));
		assert.ok(tsconfig.exclude.includes("resources"));
		assert.ok(!/"resources\/\*\*"/.test(nextConfig), "a resources/** trace exclude strips @anthropic-ai/sdk/resources");
	});

	it("quitting kills the server's whole process tree on Windows (no orphaned whisper-server)", () => {
		assert.match(main, /taskkill(\.exe)?"?, \["\/pid", String\([^)]*\.pid\), "\/T", "\/F"\]/);
	});
});
