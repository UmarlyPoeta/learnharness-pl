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
