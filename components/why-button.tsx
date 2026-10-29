"use client";

import { useEffect, useRef, useState } from "react";
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

function passageElement(node: Node | null): Element | null {
	if (!node) return null;
	return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

function passageOf(node: Node | null): Element | null {
	return passageElement(node)?.closest(PASSAGE) ?? null;
}

/** The lesson passage a selection lives in — both ends inside the SAME one,
 *  non-empty — or null (a selection reaching into another message or the
 *  learner's own words never qualifies). */
export function whySelectionScope(selection: SelectionLike | null): Element | null {
	if (!selection || selection.isCollapsed) return null;
	const a = passageOf(selection.anchorNode);
	return a && a === passageOf(selection.focusNode) ? a : null;
}

type RangeLike = {
	startContainer: Node;
	endContainer: Node;
	cloneRange(): RangeLike;
	setStartBefore(node: Node): void;
	setEndAfter(node: Node): void;
};

/** A copy of the range with each end that falls INSIDE a formula moved to
 *  the formula's edge — cloneContents only keeps nodes below the common
 *  ancestor, so a selection starting or living inside KaTeX would lose the
 *  `.katex` wrapper (and its TeX annotation) and read as glyph soup. */
export function widenToFormulas<R extends RangeLike>(range: R): R {
	const wide = range.cloneRange() as R;
	const startFormula = passageElement(range.startContainer)?.closest(".katex");
	const endFormula = passageElement(range.endContainer)?.closest(".katex");
	if (startFormula) wide.setStartBefore(startFormula);
	if (endFormula) wide.setEndAfter(endFormula);
	return wide;
}

type RectLike = { left: number; width: number; top: number; bottom: number };

/** Where the button sits for a selection rect: above it, or below when too
 *  close to the top edge — null once the selection left the viewport. */
export function whyButtonPlacement(rect: RectLike, viewportHeight: number): { x: number; y: number } | null {
	if (rect.bottom < 0 || rect.top > viewportHeight) return null;
	const above = rect.top - 36;
	return { x: rect.left + rect.width / 2, y: above > 8 ? above : rect.bottom + 6 };
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

/** The one visibility gate: an in-passage, non-empty selection, and the
 *  composer reachable (an open practice problem unmounts it — a click
 *  would fill a hidden composer and look dead). */
export function whyVisible({ active, scope, fragment }: { active: boolean; scope: Element | null; fragment: string }): boolean {
	return active && scope !== null && fragment !== "";
}

export function WhyButton({ onWhy, active }: { onWhy: (fragment: string) => void; active: boolean }) {
	const [shown, setShown] = useState<Shown | null>(null);
	// The listeners are mount-scoped; `active` is render-scoped.
	const activeRef = useRef(active);
	activeRef.current = active;
	useEffect(() => {
		if (!active) setShown(null);
	}, [active]);

	useEffect(() => {
		const place = (range: Range, fragment: string) => {
			const at = whyButtonPlacement(range.getBoundingClientRect(), window.innerHeight);
			setShown(at ? { fragment, ...at } : null);
		};
		// Shown on release (mouse or keyboard selection), not on every
		// selectionchange — a drag in progress would make it jump around.
		const evaluate = () => {
			const sel = window.getSelection();
			const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
			const scope = whySelectionScope(sel);
			const fragment = range && scope ? whyFragment(widenToFormulas(range).cloneContents()) : "";
			if (!range || !whyVisible({ active: activeRef.current, scope, fragment })) {
				setShown(null);
				return;
			}
			place(range, fragment);
		};
		const onSelectionChange = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) setShown(null);
		};
		// A streaming turn keeps scrolling the pinned transcript after the
		// mouse is released — FOLLOW the live selection instead of hiding,
		// or the button would vanish before it could be clicked mid-turn.
		const onScroll = () => {
			setShown((prev) => {
				if (!prev) return prev;
				const sel = window.getSelection();
				if (!sel || sel.rangeCount === 0 || !whySelectionScope(sel)) return null;
				const at = whyButtonPlacement(sel.getRangeAt(0).getBoundingClientRect(), window.innerHeight);
				return at ? { fragment: prev.fragment, ...at } : null;
			});
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setShown(null);
			else if (e.shiftKey) evaluate();
		};
		document.addEventListener("mouseup", evaluate);
		document.addEventListener("keyup", onKey);
		document.addEventListener("selectionchange", onSelectionChange);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("mouseup", evaluate);
			document.removeEventListener("keyup", onKey);
			document.removeEventListener("selectionchange", onSelectionChange);
			window.removeEventListener("scroll", onScroll, true);
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
