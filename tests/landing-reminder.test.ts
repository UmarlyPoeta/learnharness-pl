import assert from "node:assert";
import test from "node:test";
import { landingReminder } from "../src/core/landing-reminder.ts";
import type { QuestionAnswerData } from "../src/core/question-core.ts";

const ans = (a: Partial<QuestionAnswerData>) =>
	({ kind: "quiz", questionText: "q", dontKnow: false, answers: [], answeredAt: "", ...a }) as QuestionAnswerData;
const check = { type: "check", nodeId: "galerkin" };

test("a check that did not land gets the reminder; a landed one or a prediction does not", () => {
	assert.match(landingReminder(check, ans({ correct: false, confidence: 90 }))!, /wrong.*"galerkin"/);
	assert.match(landingReminder(check, ans({ dontKnow: true }))!, /I don't know/);
	assert.match(landingReminder(check, ans({ correct: true, confidence: 50 }))!, /confidence 50/);
	assert.equal(landingReminder(check, ans({ correct: true, confidence: 80 })), undefined);
	assert.equal(landingReminder({ type: "predict", nodeId: "x" }, ans({ correct: false, confidence: 20 })), undefined);
	assert.equal(landingReminder(check, ans({ dismissed: true })), undefined);
});

import { graphicReminder } from "../src/core/graphic-reminder.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

test("graphicReminder: a check on a node without a graphic is nudged; with one, not", () => {
	const quiz = { tool: "quiz", input: { type: "check", nodeId: "jakobian" } };
	assert.match(graphicReminder([], quiz)!, /plan node "jakobian" has no graphic yet/);
	const withGraphic = [
		{ role: "assistant", content: [{ type: "toolCall", name: "walkthrough", arguments: { nodeId: "jakobian" } }] },
	] as unknown as LhMessage[];
	assert.equal(graphicReminder(withGraphic, quiz), null);
	assert.equal(graphicReminder([], { tool: "quiz", input: { type: "predict", nodeId: "jakobian" } }), null);
	assert.equal(graphicReminder([], { tool: "quiz", input: { type: "check" } }), null);
	assert.equal(graphicReminder([], { tool: "probe", input: { type: "check", nodeId: "jakobian" } }), null);
});
