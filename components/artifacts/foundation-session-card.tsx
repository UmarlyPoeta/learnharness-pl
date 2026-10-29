"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SproutIcon } from "lucide-react";
import { parseFoundationSessionInput, type ArtifactPartProps, type FoundationSessionInput } from "@/src/core";
import { startDraftSession } from "@/components/new-session";

/**
 * The foundation session card (nauka od korzeni, 2026-10-29 — spec §2):
 * renders the teacher's foundation_session call. The session does NOT
 * exist yet — the button creates it through the draft contract (title =
 * first message = the call's goal), so an ignored card leaves nothing
 * behind. The parent session stays in the sidebar.
 */

const WHY_MAX = 160;

/** The card's "why" line: the goal's first sentence, capped. */
export function foundationWhyLine(goal: string): string {
	const t = goal.trim();
	const end = t.search(/[.!?](\s|$)/);
	const sentence = end === -1 ? t : t.slice(0, end + 1);
	return sentence.length > WHY_MAX ? `${sentence.slice(0, WHY_MAX - 1)}…` : sentence;
}

/** Create the session from the goal and navigate to it — false when the
 *  goal is blank (startDraftSession refuses empty text). */
export async function openFoundationSession(
	goal: string,
	fetchLike: typeof fetch,
	push: (href: string) => void,
): Promise<boolean> {
	const target = await startDraftSession(goal, fetchLike);
	if (!target) return false;
	push(target);
	return true;
}

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const storageKey = (toolCallId: string) => `lh:foundation-session:${toolCallId}`;

/** The session this card already created, if any — so revisiting the parent
 *  navigates to it instead of creating a duplicate. Per-browser convenience
 *  (localStorage); any storage failure reads as "not created". */
export function rememberedFoundationHref(storage: Pick<StorageLike, "getItem"> | null, toolCallId: string): string | null {
	try {
		return storage?.getItem(storageKey(toolCallId)) ?? null;
	} catch {
		return null;
	}
}

/** Remember the created session WITHOUT its `?prompt=` — re-opening that
 *  URL would deliver the goal as a first message all over again. */
export function rememberFoundationHref(storage: Pick<StorageLike, "setItem"> | null, toolCallId: string, href: string): void {
	try {
		storage?.setItem(storageKey(toolCallId), href.split("?")[0]!);
	} catch {
		/* blocked storage: the card simply offers to create again */
	}
}

function browserStorage(): StorageLike | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

/** The pure view — the render-test seam (no router). */
export function FoundationSessionCardView({
	input,
	busy,
	opened = false,
	onOpen,
}: {
	input: FoundationSessionInput | undefined;
	busy: boolean;
	/** This card already created its session — the button goes there. */
	opened?: boolean;
	onOpen: () => void;
}) {
	return (
		<div data-testid="foundation-session-card" className="my-3 rounded-xl border bg-card/60 p-3">
			<div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<SproutIcon className="size-3.5 text-primary" />
				Sesja-korzeń
			</div>
			{input ? (
				<div className="space-y-2">
					<div className="text-sm font-medium">{input.title}</div>
					<p className="text-sm text-muted-foreground">{foundationWhyLine(input.goal)}</p>
					<button
						type="button"
						data-testid="foundation-session-open"
						disabled={busy}
						onClick={onOpen}
						className="rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
					>
						{opened ? "Przejdź do sesji-korzenia" : "Otwórz sesję-korzeń"}
					</button>
				</div>
			) : (
				<p className="text-sm text-muted-foreground">Przygotowuję sesję-korzeń…</p>
			)}
		</div>
	);
}

export function FoundationSessionCard({ part }: ArtifactPartProps) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [openedHref, setOpenedHref] = useState<string | null>(null);
	// The ref closes the double-click window before the disabled state renders.
	const inFlight = useRef(false);
	// Parse, don't cast (the seam rule, src/core/tool-parts.ts): a streaming
	// partial or an errored call's input renders the pending line.
	const input = parseFoundationSessionInput(part.input);

	// Read after mount (no storage during server render).
	useEffect(() => {
		setOpenedHref(rememberedFoundationHref(browserStorage(), part.toolCallId));
	}, [part.toolCallId]);

	const onOpen = () => {
		if (!input || inFlight.current) return;
		if (openedHref) {
			router.push(openedHref);
			return;
		}
		inFlight.current = true;
		setBusy(true);
		const done = () => {
			inFlight.current = false;
			setBusy(false);
		};
		void openFoundationSession(input.goal, fetch, (href) => {
			rememberFoundationHref(browserStorage(), part.toolCallId, href);
			setOpenedHref(href.split("?")[0]!);
			router.push(href);
		}).then(done, done);
	};

	return <FoundationSessionCardView input={input} busy={busy} opened={openedHref !== null} onOpen={onOpen} />;
}
