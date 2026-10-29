import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	FOUNDATION_SESSION_ACK_TEXT,
	FOUNDATION_SESSION_TOOL,
	foundationSessionInputSchema,
} from "../../core/contracts/foundation.ts";
import { serverExecute } from "../tool-execute.ts";

/** foundation_session (nauka od korzeni, 2026-10-29): the teacher splits a
 *  deep foundation into its own session. Ack only — the card creates the
 *  session on the learner's click, never this call. */
export const foundationSessionTool: AgentTool<typeof foundationSessionInputSchema> = {
	name: FOUNDATION_SESSION_TOOL,
	label: FOUNDATION_SESSION_TOOL,
	description:
		"Offer the learner a separate foundation session for a deep gap (a missing foundation needing 3 or more plan nodes). " +
		"Call it ONLY after he chose the separate session in the deep-gap question. The learner sees a card with a button " +
		"that opens the new session; `goal` becomes its first message. Then continue with that foundation as a borrowed root — " +
		"present the plan if it is not presented yet, otherwise keep teaching.",
	parameters: foundationSessionInputSchema,
	executionMode: "sequential",
	execute: serverExecute(FOUNDATION_SESSION_TOOL, foundationSessionInputSchema, () => FOUNDATION_SESSION_ACK_TEXT),
};
