/**
 * Nauka od korzeni (docs/superpowers/specs/2026-10-29-od-korzeni-design.md):
 * the doctrine changes that make the probe bracket down to a confirmed
 * floor and the teacher ask before descending into deep gaps. Pinned on
 * the composed (switch-less, source-only) instructions each agent sees.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { FOUNDATION_SESSION_ACK_TEXT, probeDoneInputSchema } from "../src/core/contracts.ts";

describe("od korzeni: prober", () => {
	const prober = composeInstructions("prober");

	it("drops the enter-near-the-top / school-basics assumption", () => {
		assert.ok(!prober.includes("Enter near the top"));
		assert.ok(!prober.includes("school-level basics"));
	});

	it("brackets down to a confirmed floor and reports the gap depth", () => {
		assert.ok(prober.includes("**Confirmed floor**"));
		assert.ok(prober.includes("confidence ≥ 70"));
		assert.ok(prober.includes("how deep the gap runs"));
	});

	it("probe_done's assessment description asks for the confirmed floor and gap depth", () => {
		const schema = JSON.stringify(probeDoneInputSchema);
		assert.ok(schema.includes("confirmed floor"));
		assert.ok(schema.includes("gap depth"));
	});
});

describe("od korzeni: teacher", () => {
	const teacher = composeInstructions("teacher");

	it("counts only a confirmed floor as held", () => {
		assert.ok(teacher.includes("only a confirmed floor counts as held"));
	});

	it("asks before descending into a deep gap and can split it off", () => {
		assert.ok(teacher.includes("## Deep gaps — ask before descending"));
		assert.ok(teacher.includes("3 or more plan nodes"));
		assert.ok(teacher.includes("foundation_session"));
	});

	it("confirms every plan root with a real check", () => {
		assert.ok(teacher.includes("confirm it with a `quiz`"));
	});

	it("handles Dlaczego requests as one-level detours that re-ask a skipped check", () => {
		assert.ok(teacher.includes('## "Dlaczego" requests'));
		assert.ok(teacher.includes("ask that same check again"));
	});
});

describe("od korzeni: review fixes", () => {
	const prober = composeInstructions("prober");
	const teacher = composeInstructions("teacher");

	it("defines the floor for free recall (no confidence recorded) and has a stopping rule", () => {
		assert.ok(prober.includes("no confidence is recorded"));
		assert.ok(prober.includes("stop descending"));
		assert.ok(teacher.includes("no confidence is recorded"));
		assert.ok(JSON.stringify(probeDoneInputSchema).includes("no confidence is recorded"));
	});

	it("no longer tells the prober to step up on a hesitant hit", () => {
		assert.ok(!prober.includes("fragile: step up gently"));
		assert.ok(prober.includes("not a floor: descend"));
	});

	it("keeps the plan presentation after a foundation split (phase-neutral wording)", () => {
		assert.ok(teacher.includes("present the plan (or keep teaching, mid-lesson)"));
		assert.ok(!FOUNDATION_SESSION_ACK_TEXT.includes("Keep teaching"));
		assert.ok(FOUNDATION_SESSION_ACK_TEXT.includes("present the plan"));
	});

	it("stress-tests roots by pushing down when in doubt", () => {
		assert.ok(teacher.includes("in doubt, push it down — never assume it held"));
	});
});
