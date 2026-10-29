"use client";

import { useEffect, useState } from "react";
import { whyDismissNote, whyFragment, whyRequestText } from "@/components/why-request";

/**
 * The "Dlaczego?" button (nauka od korzeni, 2026-10-29 — spec §3): select
 * text inside a lesson passage (the teacher's text parts, `.lh-source-passage`)
 * and a small floating button asks for one level deeper under it. The click
 * fills the composer — the learner can add to it before sending, and the send
 * takes the normal steer-or-send path. A pending check is skipped first, with
 * the note the teacher re-asks it from.
 */

const PASSAGE = ".lh-source-passage";

type SelectionLike = { anchorNode: Node | null; focusNode: Node | null; isCollapsed: boolean };

function passageOf(node: Node | null): Element | null {
	if (!node) return null;
	const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
	return el?.closest(PASSAGE) ?? null;
}

/** The lesson passage a selection lives in — both ends inside the SAME one,
 *  non-empty — or null (a selection reaching into another message or the
 *  learner's own words never qualifies). */
export function whySelectionScope(selection: SelectionLike | null): Element | null {
	if (!selection || selection.isCollapsed) return null;
	const a = passageOf(selection.anchorNode);
	return a && a === passageOf(selection.focusNode) ? a : null;
}

export interface WhyDeps {
	hasPending: () => boolean;
	dismissPending: (note: string) => void;
	getText: () => string;
	applyText: (v: string) => void;
	focusComposer: () => void;
}

/** One click: skip a pending check with the note (variant b), then put the
 *  request in the composer. False — and nothing done — for an empty fragment. */
export function runWhy(fragment: string, deps: WhyDeps): boolean {
	if (!fragment) return false;
	if (deps.hasPending()) deps.dismissPending(whyDismissNote(fragment));
	deps.applyText(whyRequestText(fragment, deps.getText()));
	deps.focusComposer();
	return true;
}

type Shown = { fragment: string; x: number; y: number };

export function WhyButton({ onWhy }: { onWhy: (fragment: string) => void }) {
	const [shown, setShown] = useState<Shown | null>(null);

	useEffect(() => {
		// Shown on release (mouse or keyboard selection), not on every
		// selectionchange — a drag in progress would make it jump around.
		const evaluate = () => {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || !whySelectionScope(sel)) {
				setShown(null);
				return;
			}
			const range = sel.getRangeAt(0);
			const fragment = whyFragment(range.cloneContents());
			if (!fragment) {
				setShown(null);
				return;
			}
			const rect = range.getBoundingClientRect();
			const above = rect.top - 36;
			setShown({ fragment, x: rect.left + rect.width / 2, y: above > 8 ? above : rect.bottom + 6 });
		};
		const onSelectionChange = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) setShown(null);
		};
		const hide = () => setShown(null);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") hide();
			else if (e.shiftKey) evaluate();
		};
		document.addEventListener("mouseup", evaluate);
		document.addEventListener("keyup", onKey);
		document.addEventListener("selectionchange", onSelectionChange);
		window.addEventListener("scroll", hide, true);
		return () => {
			document.removeEventListener("mouseup", evaluate);
			document.removeEventListener("keyup", onKey);
			document.removeEventListener("selectionchange", onSelectionChange);
			window.removeEventListener("scroll", hide, true);
		};
	}, []);

	if (!shown) return null;
	return (
		<button
			type="button"
			data-testid="why-button"
			style={{ position: "fixed", left: shown.x, top: shown.y }}
			className="z-50 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent"
			// Keep the selection alive through the press.
			onMouseDown={(e) => e.preventDefault()}
			// The release must not re-evaluate the selection into a new button.
			onMouseUp={(e) => e.stopPropagation()}
			onClick={() => {
				onWhy(shown.fragment);
				setShown(null);
				window.getSelection()?.removeAllRanges();
			}}
		>
			Dlaczego?
		</button>
	);
}
