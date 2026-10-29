/**
 * The "Dlaczego?" button's decisions (nauka od korzeni §3): when a
 * selection qualifies (inside ONE lesson passage), and what a click does —
 * skip a pending check with the note first, then fill the composer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { runWhy, whyButtonPlacement, whySelectionScope, whyVisible, widenToFormulas } from "../components/why-button.tsx";

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

describe("widenToFormulas", () => {
	const { document: d } = parseHTML(
		"<html><body><p>" +
			'<span class="katex" id="k1"><span class="katex-html"><span id="g1">JTJ</span></span></span> i ' +
			'<span class="katex" id="k2"><span class="katex-html"><span id="g2">x2</span></span></span> koniec' +
			"</p></body></html>",
	);
	function fakeRange(start: Node, end: Node) {
		const calls: string[] = [];
		const range = {
			startContainer: start,
			endContainer: end,
			cloneRange: () => range,
			setStartBefore: (n: Node) => calls.push(`start:${(n as Element).id}`),
			setEndAfter: (n: Node) => calls.push(`end:${(n as Element).id}`),
		};
		return { range, calls };
	}

	it("widens both ends that sit inside formulas to the whole formula", () => {
		const { range, calls } = fakeRange(d.getElementById("g1")!.firstChild!, d.getElementById("g2")!.firstChild!);
		widenToFormulas(range);
		assert.deepEqual(calls, ["start:k1", "end:k2"]);
	});

	it("leaves a plain-text selection alone", () => {
		const p = d.querySelector("p")!.lastChild!;
		const { range, calls } = fakeRange(p, p);
		widenToFormulas(range);
		assert.deepEqual(calls, []);
	});
});

describe("whyButtonPlacement", () => {
	it("sits above the selection when there is room", () => {
		assert.deepEqual(whyButtonPlacement({ left: 100, width: 50, top: 200, bottom: 220 }, 800), { x: 125, y: 164 });
	});

	it("drops below the selection near the top edge", () => {
		assert.deepEqual(whyButtonPlacement({ left: 0, width: 10, top: 20, bottom: 40 }, 800), { x: 5, y: 46 });
	});

	it("hides when the selection scrolled out of view", () => {
		assert.equal(whyButtonPlacement({ left: 0, width: 10, top: -60, bottom: -40 }, 800), null);
		assert.equal(whyButtonPlacement({ left: 0, width: 10, top: 900, bottom: 920 }, 800), null);
	});
});

describe("whyVisible", () => {
	const scope = document.getElementById("a");
	it("shows for an in-passage, non-empty selection while active", () => {
		assert.equal(whyVisible({ active: true, scope, fragment: "x" }), true);
	});

	it("stays hidden while inactive (an open practice problem hides the composer)", () => {
		assert.equal(whyVisible({ active: false, scope, fragment: "x" }), false);
	});

	it("stays hidden without a scope or fragment", () => {
		assert.equal(whyVisible({ active: true, scope: null, fragment: "x" }), false);
		assert.equal(whyVisible({ active: true, scope, fragment: "" }), false);
	});
});
