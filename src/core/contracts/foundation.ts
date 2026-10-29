/**
 * foundation_session — the teacher's deep-gap split (nauka od korzeni,
 * docs/superpowers/specs/2026-10-29-od-korzeni-design.md §2).
 *
 * When a missing foundation would take 3+ plan nodes and the learner chose
 * to learn it separately, the teacher calls this tool. Server-side it only
 * acks; the card renders a button that creates the session on click (the
 * draft-session contract), so no call ever leaves an empty session behind.
 */

import { Type, type Static } from "typebox";

export const FOUNDATION_SESSION_TOOL = "foundation_session";

export const foundationSessionInputSchema = Type.Object({
	title: Type.String({
		minLength: 1,
		pattern: "\\S",
		description: "Short name of the foundation session, in Polish (e.g. 'Macierze od zera').",
	}),
	goal: Type.String({
		minLength: 1,
		pattern: "\\S",
		description:
			"The new session's first message, written as the learner's goal in Polish: what it is needed for (this session " +
			"and its goal), what the probe found (floor, ceiling, shaky spots), and that it starts from the very basics.",
	}),
});

export type FoundationSessionInput = Static<typeof foundationSessionInputSchema>;

/** The model-facing ack — nothing to echo: the card carries the input. */
export const FOUNDATION_SESSION_ACK_TEXT =
	"Foundation session card shown — the learner opens it when ready. Keep teaching with it as a borrowed root.";
