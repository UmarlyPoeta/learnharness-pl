/**
 * The "Dlaczego?" request helpers (nauka od korzeni §3): the selected
 * fragment as text (KaTeX back to its TeX source), the composer request,
 * and the skip note a pending check carries.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { WHY_FRAGMENT_MAX, whyDismissNote, whyFragment, whyRequestText } from "../components/why-request.ts";

function root(html: string): ParentNode {
	return parseHTML(`<html><body><div id="r">${html}</div></body></html>`).document.getElementById("r")!;
}

describe("whyFragment", () => {
	it("collapses whitespace", () => {
		assert.equal(whyFragment(root("<p>Mamy   układ\n\n równań</p>")), "Mamy układ równań");
	});

	it("turns KaTeX back into its TeX source", () => {
		const html =
			'<p>Mamy <span class="katex"><span class="katex-mathml"><math><semantics>' +
			'<annotation encoding="application/x-tex">J^T J</annotation></semantics></math></span>' +
			'<span class="katex-html">JTJ</span></span> i dalej</p>';
		assert.equal(whyFragment(root(html)), "Mamy $J^T J$ i dalej");
	});

	it("caps long fragments with an ellipsis", () => {
		const out = whyFragment(root(`<p>${"a".repeat(400)}</p>`));
		assert.equal(out.length, WHY_FRAGMENT_MAX);
		assert.ok(out.endsWith("…"));
	});

	it("returns an empty string for whitespace only", () => {
		assert.equal(whyFragment(root("<p>   </p>")), "");
	});

	it("does not mutate the selection's source", () => {
		const r = root('<span class="katex"><annotation encoding="application/x-tex">x</annotation><span class="katex-html">x</span></span>');
		whyFragment(r);
		assert.ok((r as Element).querySelector(".katex"), "KaTeX node still there");
	});
});

describe("whyRequestText", () => {
	it("builds the bare request on an empty composer", () => {
		assert.equal(whyRequestText("x", ""), "Dlaczego „x”?");
	});

	it("keeps an existing draft and appends on a new line", () => {
		assert.equal(whyRequestText("x", "mój szkic  "), "mój szkic\nDlaczego „x”?");
	});
});

describe("whyDismissNote", () => {
	it("quotes the fragment", () => {
		assert.equal(whyDismissNote("x"), "Nie rozumiem: „x”");
	});
});
