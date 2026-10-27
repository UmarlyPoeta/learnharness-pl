/**
 * WAV wrapper for dictation audio (release wave, 2026-10-27): the local
 * whisper.cpp server's /inference reads WAV files, while the dictation path
 * carries raw PCM — Int16 little-endian, mono (16 kHz unless told).
 *
 * Browser-safe pure logic (no node builtins).
 */

/** A 44-byte canonical PCM header (mono, 16-bit) followed by `pcm`. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 16000): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(44 + pcm.byteLength);
	const v = new DataView(out.buffer);
	const ascii = (at: number, text: string) => {
		for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
	};
	ascii(0, "RIFF");
	v.setUint32(4, 36 + pcm.byteLength, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	v.setUint32(16, 16, true); // fmt chunk size
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, 1, true); // mono
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * 2, true); // byte rate
	v.setUint16(32, 2, true); // block align
	v.setUint16(34, 16, true); // bits per sample
	ascii(36, "data");
	v.setUint32(40, pcm.byteLength, true);
	out.set(pcm, 44);
	return out;
}
