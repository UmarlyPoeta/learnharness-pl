import type { QuestionAnswerData } from "./question-core.ts";

/** A teach-phase check counts as landed only with a correct answer at
 *  this stated confidence or above (the confirmed-floor bar of the probe). */
export const LANDING_CONFIDENCE = 70;

/** The mechanical nudge riding a check answer that did not land (wrong,
 *  "I don't know", or correct below LANDING_CONFIDENCE). Predictions are
 *  guesses by design and never get one; the reasoning half of the bar
 *  (sound thinking) stays the model's judgment. */
export function landingReminder(callInput: unknown, answer: QuestionAnswerData): string | undefined {
	const call = (callInput ?? {}) as { type?: unknown; nodeId?: unknown };
	if (call.type !== "check" || answer.dismissed) return undefined;
	let reason: string | undefined;
	if (answer.dontKnow) reason = `he answered "I don't know"`;
	else if (answer.correct === false) reason = "the answer was wrong";
	else if (typeof answer.confidence === "number" && answer.confidence < LANDING_CONFIDENCE)
		reason = `correct, but at confidence ${answer.confidence} (< ${LANDING_CONFIDENCE}) — a guess, not a hold`;
	if (!reason) return undefined;
	const node = typeof call.nodeId === "string" ? ` "${call.nodeId}"` : "";
	return `Reminder: this step has NOT landed — ${reason}. Stay on node${node}: diagnose from his thinking, repair, then ask a fresh, different check on the same node. Do not move to another node until a check lands.`;
}
