/**
 * foundation_session — the teacher's deep-gap split (docs/superpowers/specs/
 * 2026-10-29-od-korzeni-design.md §2). Server-side it only acks: the card
 * the learner sees creates the session on click, so a call never leaves an
 * empty session behind. Teacher-only, always-on (not a toggle).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createProberTools, createTeacherTools, type TeacherToolContext } from "../src/agent/tools.ts";
import { FOUNDATION_SESSION_ACK_TEXT, FOUNDATION_SESSION_TOOL } from "../src/core/contracts.ts";
import { toolActivityLabel } from "../src/core/pending.ts";
import { parseFoundationSessionInput } from "../src/core/tool-parts.ts";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { PATHS } from "../config.ts";

const createdChats: string[] = [];
after(() => {
	for (const id of createdChats) {
		try {
			fs.unlinkSync(path.join(PATHS.chats, `${id}.json`));
		} catch {
			/* scratch cleanup, best effort */
		}
	}
});

function teacherCtx(): TeacherToolContext {
	const chat = chatStore.createChat("Foundation: ctx");
	createdChats.push(chat.id);
	return { chatId: chat.id, chatStore, jobStore, spawn: () => {} };
}

const INPUT = { title: "Macierze od zera", goal: "Chcę zrozumieć mnożenie macierzy. Potrzebne do LM." };

describe("foundation_session", () => {
	it("parses a valid input and rejects empty or malformed ones", () => {
		assert.deepEqual(parseFoundationSessionInput(INPUT), INPUT);
		assert.equal(parseFoundationSessionInput({ title: "", goal: "x" }), undefined);
		assert.equal(parseFoundationSessionInput({ title: "x" }), undefined);
		assert.equal(parseFoundationSessionInput("str"), undefined);
	});

	it("is a teacher tool and never a prober tool", () => {
		const ctx = teacherCtx();
		assert.ok(createTeacherTools(ctx)[FOUNDATION_SESSION_TOOL]);
		const prober = createProberTools({ chatId: ctx.chatId, chatStore, deliver: () => {}, jobStore, spawn: () => {} });
		assert.equal(prober[FOUNDATION_SESSION_TOOL], undefined);
	});

	it("cannot be toggled off", () => {
		const tools = createTeacherTools(teacherCtx(), { [FOUNDATION_SESSION_TOOL]: false });
		assert.ok(tools[FOUNDATION_SESSION_TOOL]);
	});

	it("only acks — no session is created by the call", async () => {
		const tools = createTeacherTools(teacherCtx());
		const result = await tools[FOUNDATION_SESSION_TOOL]!.execute("f1", INPUT);
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("");
		assert.equal(text, FOUNDATION_SESSION_ACK_TEXT);
		// Files run in parallel over one data dir, so no global count: the
		// draft contract titles a created session with its first message.
		assert.ok(!chatStore.listChats().some((c) => c.title === INPUT.goal || c.title === INPUT.title));
	});

	it("has a Polish activity label", () => {
		assert.equal(toolActivityLabel(FOUNDATION_SESSION_TOOL), "Przygotowuję sesję-korzeń…");
	});
});
