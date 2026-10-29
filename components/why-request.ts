/**
 * "Dlaczego?" request helpers (nauka od korzeni, 2026-10-29 — spec §3).
 * Pure: the selected lesson fragment as plain text, the composer request
 * built from it, and the note a skipped check carries.
 */

export const WHY_FRAGMENT_MAX = 300;

/** The selection's text: KaTeX back to `$<tex>$` (its MathML annotation —
 *  the rendered HTML would read as garbled glyphs), whitespace collapsed,
 *  capped at WHY_FRAGMENT_MAX with an ellipsis. Works on a CLONE, so the
 *  live lesson DOM is never touched. */
export function whyFragment(root: ParentNode): string {
	const clone = (root as unknown as Node).cloneNode(true) as unknown as ParentNode;
	for (const k of Array.from(clone.querySelectorAll(".katex"))) {
		const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
		k.replaceWith(tex != null ? `$${tex}$` : (k.querySelector(".katex-html")?.textContent ?? k.textContent ?? ""));
	}
	// KaTeX's vlist struts carry zero-width characters `\s` does not match.
	const text = ((clone as unknown as Node).textContent ?? "")
		.replace(/[\u200b-\u200d\ufeff]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > WHY_FRAGMENT_MAX ? `${text.slice(0, WHY_FRAGMENT_MAX - 1)}…` : text;
}

/** The composer text: the request alone, or appended on a new line under
 *  an existing draft (nothing the learner typed is lost). */
export function whyRequestText(fragment: string, existing: string): string {
	const request = `Dlaczego „${fragment}”?`;
	return existing.trim() ? `${existing.replace(/\s+$/, "")}\n${request}` : request;
}

/** The note a pending check is skipped with — the teacher re-asks it after
 *  the detour (teacher/20-teaching.md, "Dlaczego" requests). */
export function whyDismissNote(fragment: string): string {
	return `Nie rozumiem: „${fragment}”`;
}
