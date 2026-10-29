"use client";

import { useRef, useState } from "react";
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

/** The pure view — the render-test seam (no router). */
export function FoundationSessionCardView({
	input,
	busy,
	onOpen,
}: {
	input: FoundationSessionInput | undefined;
	busy: boolean;
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
						Otwórz sesję-korzeń
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
	// The ref closes the double-click window before the disabled state renders.
	const inFlight = useRef(false);
	// Parse, don't cast (the seam rule, src/core/tool-parts.ts): a streaming
	// partial or an errored call's input renders the pending line.
	const input = parseFoundationSessionInput(part.input);

	const onOpen = () => {
		if (!input || inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		void openFoundationSession(input.goal, fetch, (href) => router.push(href)).then(
			(ok) => {
				// Success keeps the button locked — the session exists now.
				if (!ok) {
					inFlight.current = false;
					setBusy(false);
				}
			},
			() => {
				inFlight.current = false;
				setBusy(false);
			},
		);
	};

	return <FoundationSessionCardView input={input} busy={busy} onOpen={onOpen} />;
}
