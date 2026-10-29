/**
 * The "Dlaczego?" button's decisions (nauka od korzeni §3): when a
 * selection qualifies (inside ONE lesson passage), and what a click does —
 * skip a pending check with the note first, then fill the composer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { runWhy, whySelectionScope } from "../components/why-button.tsx";

const { document } = parseHTML(
	"<html><body>" +
		'<div class="lh-source-passage" id="a"><p id="a1">Pierwszy akapit</p><p id="a2">Drugi akapit</p></div>' +
		'<div class="lh-source-passage" id="b"><p id="b1">Inna wiadomość</p></div>' +
		'<div id="user"><p id="u1">Moja wiadomość</p></div>' +
		"</body></html>",
);
const text = (id: string) => document.getElementById(id)!.firstChild!;

describe("whySelectionScope", () => {
	it("returns the passage when both ends sit in the same one", () => {
		const scope = whySelectionScope({ anchorNode: text("a1"), focusNode: text("a2"), isCollapsed: false });
		assert.equal(scope, document.getElementById("a"));
	});

	it("rejects a selection spanning two passages", () => {
		assert.equal(whySelectionScope({ anchorNode: text("a1"), focusNode: text("b1"), isCollapsed: false }), null);
	});

	it("rejects a selection with an end outside any passage", () => {
		assert.equal(whySelectionScope({ anchorNode: text("a1"), focusNode: text("u1"), isCollapsed: false }), null);
	});

	it("rejects a collapsed selection", () => {
		assert.equal(whySelectionScope({ anchorNode: text("a1"), focusNode: text("a1"), isCollapsed: true }), null);
	});

	it("rejects no selection", () => {
		assert.equal(whySelectionScope(null), null);
	});
});

function fakeDeps(opts: { pending: boolean; text?: string }) {
	const calls: string[] = [];
	return {
		calls,
		deps: {
			hasPending: () => opts.pending,
			dismissPending: (note: string) => calls.push(`dismiss:${note}`),
			getText: () => opts.text ?? "",
			applyText: (v: string) => calls.push(`apply:${v}`),
			focusComposer: () => calls.push("focus"),
		},
	};
}

describe("runWhy", () => {
	it("fills the composer and focuses it when nothing is pending", () => {
		const { calls, deps } = fakeDeps({ pending: false });
		assert.equal(runWhy("x", deps), true);
		assert.deepEqual(calls, ["apply:Dlaczego „x”?", "focus"]);
	});

	it("skips a pending check with the note BEFORE filling the composer", () => {
		const { calls, deps } = fakeDeps({ pending: true });
		assert.equal(runWhy("x", deps), true);
		assert.deepEqual(calls, ["dismiss:Nie rozumiem: „x”", "apply:Dlaczego „x”?", "focus"]);
	});

	it("does nothing for an empty fragment", () => {
		const { calls, deps } = fakeDeps({ pending: true });
		assert.equal(runWhy("", deps), false);
		assert.deepEqual(calls, []);
	});

	it("keeps an existing draft", () => {
		const { calls, deps } = fakeDeps({ pending: false, text: "szkic" });
		runWhy("x", deps);
		assert.equal(calls[0], "apply:szkic\nDlaczego „x”?");
	});
});
