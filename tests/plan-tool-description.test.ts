import assert from "node:assert";
import test from "node:test";
import { planTools, type PlanToolContext } from "../src/agent/tools/plan.ts";

const description = planTools({} as PlanToolContext).plan_init.description;

test("plan_init sets no node-count ceiling (matches teacher/10-planning.md)", () => {
	assert.doesNotMatch(description, /5[–-]15/);
	assert.doesNotMatch(description, /compress/i);
	assert.match(description, /no size ceiling/i);
});
