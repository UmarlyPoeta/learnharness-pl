import type { LhMessage } from "./native-messages.ts";

/** The tools that give a plan node its graphic (mermaid does not count). */
export const GRAPHIC_TOOLS = ["walkthrough", "demo", "visual"] as const;

/** The nudge riding a check answer whose plan node has no graphic yet in
 *  this session (null otherwise — predictions, untagged quizzes and old
 *  records never get one). Never blocks: the teacher reads it with the answer. */
export function graphicReminder(
	messages: readonly LhMessage[],
	pending: { tool: string; input: unknown },
): string | null {
	if (pending.tool !== "quiz" && pending.tool !== "explain") return null;
	const call = (pending.input ?? {}) as { type?: unknown; nodeId?: unknown };
	if (call.type !== "check" || typeof call.nodeId !== "string" || call.nodeId.length === 0) return null;
	const nodeId = call.nodeId;
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		const content = (m as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content as Array<{ type?: string; name?: string; arguments?: { nodeId?: unknown } }>) {
			if (block.type !== "toolCall" || !(GRAPHIC_TOOLS as readonly string[]).includes(block.name ?? "")) continue;
			if (block.arguments?.nodeId === nodeId) return null;
		}
	}
	return `Reminder: plan node "${nodeId}" has no graphic yet — dispatch a walkthrough, demo or visual for it (with nodeId) now.`;
}
