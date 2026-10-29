/**
 * Nauka od korzeni (docs/superpowers/specs/2026-10-29-od-korzeni-design.md):
 * the doctrine changes that make the probe bracket down to a confirmed
 * floor and the teacher ask before descending into deep gaps. Pinned on
 * the composed (switch-less, source-only) instructions each agent sees.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { probeDoneInputSchema } from "../src/core/contracts.ts";

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
