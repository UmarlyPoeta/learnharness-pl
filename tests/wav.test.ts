/**
 * pcmToWav (release wave, 2026-10-27): whisper.cpp's /inference reads WAV,
 * the dictation path carries raw 16 kHz mono Int16 PCM.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pcmToWav } from "../src/core/wav.ts";

describe("pcmToWav", () => {
	it("writes a 44-byte PCM mono 16-bit header in front of the samples", () => {
		const wav = pcmToWav(new Uint8Array([1, 2, 3, 4]));
		assert.equal(wav.byteLength, 48);
		const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
		const ascii = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
		assert.equal(ascii(0), "RIFF");
		assert.equal(ascii(8), "WAVE");
		assert.equal(ascii(12), "fmt ");
		assert.equal(ascii(36), "data");
		assert.equal(v.getUint32(4, true), 40);
		assert.equal(v.getUint32(16, true), 16);
		assert.equal(v.getUint16(20, true), 1);
		assert.equal(v.getUint16(22, true), 1);
		assert.equal(v.getUint32(24, true), 16000);
		assert.equal(v.getUint32(28, true), 32000);
		assert.equal(v.getUint16(32, true), 2);
		assert.equal(v.getUint16(34, true), 16);
		assert.equal(v.getUint32(40, true), 4);
		assert.deepEqual([...wav.subarray(44)], [1, 2, 3, 4]);
	});

	it("honors another sample rate", () => {
		const v = new DataView(pcmToWav(new Uint8Array(0), 8000).buffer);
		assert.equal(v.getUint32(24, true), 8000);
		assert.equal(v.getUint32(28, true), 16000);
	});
});
