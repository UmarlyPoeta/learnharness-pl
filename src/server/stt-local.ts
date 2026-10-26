/** Local dictation helpers for /api/stt/local (route files may only export
 *  route fields, so the testable bits live here). */

/** 16 kHz Int16 mono. */
const BYTES_PER_SECOND = 32_000;

/** The proxy's wait for one transcription: 2 minutes, or 3× the audio
 *  length when longer — the CPU fallback runs slower than real time
 *  (final review I1), and a timeout loses the whole transcript. */
export function transcribeTimeoutMs(bytes: number): number {
	return Math.max(120_000, Math.ceil((bytes / BYTES_PER_SECOND) * 3 * 1000));
}
