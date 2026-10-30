import { randomUUID } from "node:crypto";
import type { Message, ToolResultMessage, Tool, Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { piEngineFor, type PiEngine } from "../models.ts";
import { providerEventObserver } from "../provider-events.ts";
import type { WalkthroughResult } from "../../core/contracts.ts";
import { buildWalkthroughHtml } from "../../core/walkthrough/html.ts";
import { getHeadless, type HeadlessApi } from "./headless.ts";
import { snippetAround, streamOnce, toolText } from "./visual-maker.ts";

/**
 * The walkthrough-builder sub-agent (wyjaśnienia obrazowe, 2026-10-29):
 * writes ONE scene script for the fixed walkthrough engine (core/walkthrough),
 * runs it headlessly through every step, LOOKS at rendered steps, and
 * iterates — the visual-maker's image-in-the-loop shape. Code-enforced gate:
 * nothing is delivered without a clean run of the CURRENT script and looks
 * at its first, last and at least one middle step (the loop renders and
 * shows any missing ones itself). Failure: { html: "", notes: "FAILED: …" }.
 */

export interface WalkthroughBuilderInput {
	title: string;
	brief: string;
}

export interface WalkthroughBuilderOptions {
	/** Test seam: scripted engine; production uses the walkthroughBuilder role. */
	engine?: PiEngine;
	headless?: HeadlessApi;
	/** Max model rounds. Default 16. */
	maxIterations?: number;
	onActivity?: (line: string) => void;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	chatId?: string;
}

const INSTRUCTIONS = `You build ONE animated, step-by-step walkthrough for a lesson: a scene on a fixed
engine that a learner steps through with ◀ ▶, each step one small change plus a one-sentence caption.
You receive a brief from the teacher; you never see the lesson. Above everything: CORRECTNESS — every
coordinate, direction and caption must be true.

You write a JavaScript scene script against the engine API \`LH\` (nothing else is available — no DOM, no
canvas, no libraries):

  const s = LH.stage({ x: [xmin, xmax], y: [ymin, ymax] });   // math coordinates, y up
  s.point(id, { x, y, label?, color? })
   .segment(id, { from: [x, y], to: [x, y], color?, dashed? })
   .arrow(id, { from: [x, y], to: [x, y], color? })
   .polygon(id, { points: [[x, y], ...], color?, fill? })      // ≥ 3 points, count fixed for life
   .curve(id, { fn: (x, p) => y, params?: { a: 1 }, domain: [a, b], color? })
   .grid(id, { map: (u, v, p) => [x, y], params?, u: [a, b], v: [a, b], lines?: 8, color? })
   .label(id, { at: [x, y], text, color?, size? });             // plain Unicode text (ξ, η, ∂, ²)
  LH.steps([
    { caption: "…", show?: [ids], hide?: [ids], set?: { id: { prop: value, params: { a: 2 } } } },
    ...
  ]);

- Every object starts HIDDEN; a step shows/hides objects and sets new property values. Steps are states:
  the engine interpolates numbers, points and params between neighbouring steps (600 ms) and fades
  objects in and out. Changing a polygon's point count is an error.
- Colors: blue, red, green, orange, purple, gray, black. 3–12 steps. Keep every visible thing inside the
  stage (a margin of half the stage size is tolerated, not more).
- Captions: ONE sentence each, markdown with $…$ math (the card renders KaTeX — use it there, never on
  the stage). Escape backslashes in JS strings ("$\\\\xi$").

Example (the Jacobian of an element mapping):

const s = LH.stage({ x: [-0.5, 3.5], y: [-0.5, 2.5] });
s.polygon("ref", { points: [[0, 0], [1, 0], [1, 1], [0, 1]], color: "blue", fill: true })
 .grid("g", { map: (u, v, p) => [u + p.t * (1.2 * u + 0.4 * v), v + p.t * (0.3 * u + 0.6 * v)], params: { t: 0 }, u: [0, 1], v: [0, 1], lines: 4, color: "gray" })
 .arrow("e1", { from: [0, 0], to: [1, 0], color: "red" })
 .label("xi", { at: [0.5, -0.25], text: "ξ", color: "blue" });
LH.steps([
  { caption: "Element odniesienia: kwadrat $[0,1]^2$ we współrzędnych $(\\\\xi,\\\\eta)$.", show: ["ref", "g", "xi"] },
  { caption: "Odwzorowanie $x(\\\\xi,\\\\eta)$ przenosi siatkę na element rzeczywisty.", set: { g: { params: { t: 1 } } } },
  { caption: "Kolumna jakobianu to obraz wektora bazowego: $\\\\partial x/\\\\partial \\\\xi$.", show: ["e1"], set: { e1: { to: [2.2, 0.3] } } },
]);

Your tools:
- write_scene({ script }) — the complete script (overwrites the previous one).
- edit_scene({ old_text, new_text }) — exact-match replacement, old_text must occur EXACTLY ONCE.
- run_scene({}) — loads the scene headlessly and validates EVERY step; reports errors per step and the
  captions. A clean run is required before anything else counts.
- look_step({ step }) — renders step N (1-based) as a PNG and shows it to you.

THE RULE: verify by looking. Run, then look at the first, the last and the middle steps (more when in
doubt): is every point where the math says, every arrow pointing the right way, every label readable and
not overlapping, nothing clipped, and does each picture show exactly what its caption claims? Fix and
re-run until true. One idea, few objects, large and sparse beats busy.

LANGUAGE: every caption and every label is in Polish.

Your FINAL message: 1–2 sentences of notes for the teacher referring to steps by number — never the script.
If you cannot build a correct walkthrough of the brief, say exactly that and why.`;

export function createWalkthroughTools(): Record<string, Tool> {
	return {
		write_scene: {
			name: "write_scene",
			description: "Write the complete scene script (overwrites any previous version).",
			parameters: Type.Object({ script: Type.String({ description: "The full JavaScript scene script using LH." }) }),
		},
		edit_scene: {
			name: "edit_scene",
			description: "Replace one exact spot in the current script: old_text must appear EXACTLY ONCE.",
			parameters: Type.Object({
				old_text: Type.String({ description: "The exact text to replace — must match exactly once." }),
				new_text: Type.String({ description: "The replacement text." }),
			}),
		},
		run_scene: {
			name: "run_scene",
			description: "Load the current scene headlessly and validate every step. No arguments.",
			parameters: Type.Object({}),
		},
		look_step: {
			name: "look_step",
			description: "Render step N (1-based) of the current, cleanly-run scene and show it to you.",
			parameters: Type.Object({ step: Type.Integer({ minimum: 1, description: "Step number, 1-based." }) }),
		},
	};
}

const CHECK_PROBE =
	"(window.LH && window.LH.__check) ? window.LH.__check() : { ok: false, errors: ['the engine runtime did not load'], steps: 0, captions: [] }";
const svgProbe = (step: number) => `(window.LH && window.LH.__svgAt) ? window.LH.__svgAt(${step - 1}) : ''`;

interface CheckResult {
	ok: boolean;
	errors: string[];
	steps: number;
	captions: string[];
}

/** The steps the delivery gate requires to have been looked at (1-based). */
export function missingLooks(looked: ReadonlySet<number>, steps: number): number[] {
	const missing: number[] = [];
	if (steps < 1) return missing;
	if (!looked.has(1)) missing.push(1);
	if (steps > 1 && !looked.has(steps)) missing.push(steps);
	const hasMiddle = [...looked].some((n) => n > 1 && n < steps);
	if (steps > 2 && !hasMiddle) missing.push(Math.ceil(steps / 2) === 1 ? 2 : Math.ceil(steps / 2));
	return missing;
}

const LOOK_TEXT = (step: number, total: number, caption: string) =>
	`Here is step ${step} of ${total} (caption: "${caption}") — check it against the caption and the math:`;
function lookMessage(text: string, png: Buffer): Message {
	return {
		role: "user",
		content: [
			{ type: "text", text },
			{ type: "image", data: png.toString("base64"), mimeType: "image/png" },
		],
		timestamp: Date.now(),
	};
}

const UNRUN_FINISH = "Run run_scene on your current script before finishing.";
const UNLOOKED_FINISH =
	"You finished without looking at the required steps of your final scene. Their renders are above. If they are correct, reply with just your notes; otherwise fix the script, run it and look again.";

export async function runWalkthroughBuilder(
	input: WalkthroughBuilderInput,
	opts: WalkthroughBuilderOptions = {},
): Promise<WalkthroughResult> {
	const title = input.title.trim() || "Animowane wyjaśnienie";
	const fail = (notes: string): WalkthroughResult => ({ title, html: "", captions: [], tested: true, notes: `FAILED: ${notes}` });
	const headless = opts.headless ?? getHeadless();
	const reason = headless.unavailableReason();
	if (reason) return fail(reason);

	const maxIterations = opts.maxIterations ?? 16;
	const engine = opts.engine ?? piEngineFor("walkthroughBuilder");
	const tools = Object.values(createWalkthroughTools());
	const sessionId = randomUUID();
	let messages: Message[] = [
		{
			role: "user",
			content: [
				`Title: ${title}`,
				"Brief from the teacher (verbatim — it is everything you know):",
				input.brief.trim() || "(no brief)",
				"",
				"Write the scene, run it, look at its steps, iterate until correct, then finish with your notes.",
			].join("\n"),
			timestamp: Date.now(),
		},
	];

	let script: string | null = null;
	/** The script of the last clean run_scene (null = none for the current script). */
	let passed: string | null = null;
	let check: CheckResult = { ok: false, errors: [], steps: 0, captions: [] };
	let looked = new Set<number>();
	let finalText = "";

	const invalidate = () => {
		passed = null;
		looked = new Set();
	};

	async function stepPng(step: number): Promise<Buffer> {
		const run = await headless.runDemo(buildWalkthroughHtml(script!), { probe: svgProbe(step), settleMs: 300 });
		const svg = typeof run.probeResult === "string" ? run.probeResult : "";
		if (!svg.startsWith("<svg")) throw new Error(`step ${step} produced no picture`);
		return headless.renderSvg(svg);
	}

	try {
		for (let iteration = 0; iteration < maxIterations; iteration++) {
			const result = await streamOnce(
				engine,
				INSTRUCTIONS,
				messages,
				tools,
				sessionId,
				engine.level,
				opts.abortSignal,
				opts.chatId ? providerEventObserver(opts.chatId, "job:walkthroughBuilder") : undefined,
			);
			opts.onUsage?.(result.usage);
			messages = [...messages, result];

			const calls = result.content.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall");
			if (calls.length === 0) {
				finalText = result.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("")
					.trim();
				if (!script) return fail(`the builder never wrote a scene.${finalText ? ` (${finalText.slice(0, 300)})` : ""}`);
				if (passed !== script) {
					messages = [...messages, { role: "user", content: UNRUN_FINISH, timestamp: Date.now() }];
					continue;
				}
				const missing = missingLooks(looked, check.steps);
				if (missing.length > 0) {
					const shown: Message[] = [];
					for (const step of missing) {
						const png = await stepPng(step);
						looked.add(step);
						shown.push(lookMessage(LOOK_TEXT(step, check.steps, check.captions[step - 1] ?? ""), png));
					}
					opts.onActivity?.("look_step: inspecting required steps");
					messages = [...messages, ...shown, { role: "user", content: UNLOOKED_FINISH, timestamp: Date.now() }];
					continue;
				}
				return { title, html: buildWalkthroughHtml(script), captions: check.captions, tested: true, notes: finalText || undefined };
			}

			const results: ToolResultMessage[] = [];
			const images: Message[] = [];
			for (const call of calls) {
				const args = (call.arguments ?? {}) as Record<string, unknown>;
				if (call.name === "write_scene") {
					if (typeof args.script !== "string" || !args.script.includes("LH.")) {
						results.push(toolText(call.id, call.name, "ERROR: expected the full scene script (using LH) in `script`."));
						continue;
					}
					script = args.script;
					invalidate();
					opts.onActivity?.(`write_scene: ${(script.length / 1024).toFixed(1)} KB`);
					results.push(toolText(call.id, call.name, "Saved. Call run_scene to validate it."));
				} else if (call.name === "edit_scene") {
					if (!script) {
						results.push(toolText(call.id, call.name, "ERROR: nothing to edit — call write_scene first."));
						continue;
					}
					if (typeof args.old_text !== "string" || typeof args.new_text !== "string" || !args.old_text) {
						results.push(toolText(call.id, call.name, "ERROR: expected old_text (non-empty) and new_text strings."));
						continue;
					}
					const count = script.split(args.old_text).length - 1;
					if (count !== 1) {
						results.push(
							toolText(
								call.id,
								call.name,
								count === 0
									? `ERROR: old_text not found. Closest line:\n${snippetAround(script, args.old_text)}`
									: `ERROR: old_text appears ${count} times — it must match EXACTLY ONCE.`,
							),
						);
						continue;
					}
					script = script.replace(args.old_text, args.new_text);
					invalidate();
					opts.onActivity?.("edit_scene: applied");
					results.push(toolText(call.id, call.name, "OK — replaced 1 occurrence. Call run_scene again."));
				} else if (call.name === "run_scene") {
					if (!script) {
						results.push(toolText(call.id, call.name, "ERROR: nothing to run — call write_scene first."));
						continue;
					}
					const run = await headless.runDemo(buildWalkthroughHtml(script), { probe: CHECK_PROBE, settleMs: 300 });
					const probed = (run.probeResult ?? {}) as Partial<CheckResult>;
					const errors = [...run.pageErrors, ...run.consoleErrors, ...(probed.errors ?? [])];
					if (probed.ok && run.pageErrors.length === 0 && errors.length === 0) {
						passed = script;
						looked = new Set();
						check = { ok: true, errors: [], steps: probed.steps ?? 0, captions: probed.captions ?? [] };
						opts.onActivity?.(`run_scene: ${check.steps} steps OK`);
						const list = check.captions.map((c, i) => `${i + 1}. ${c}`).join("\n");
						results.push(toolText(call.id, call.name, `PASSED: ${check.steps} steps.\n${list}\nNow look at the steps.`));
					} else {
						passed = null;
						opts.onActivity?.("run_scene: errors");
						const lines = errors.length > 0 ? errors : ["LH.steps() was never called"];
						results.push(toolText(call.id, call.name, `ERROR: the scene failed.\n${lines.map((e) => `- ${e}`).join("\n")}`));
					}
				} else if (call.name === "look_step") {
					const step = Number(args.step);
					if (!script || passed !== script) {
						results.push(toolText(call.id, call.name, "ERROR: run_scene must pass on the current script first."));
						continue;
					}
					if (!Number.isInteger(step) || step < 1 || step > check.steps) {
						results.push(toolText(call.id, call.name, `ERROR: step must be 1–${check.steps}.`));
						continue;
					}
					try {
						const png = await stepPng(step);
						looked.add(step);
						opts.onActivity?.(`look_step: ${step}/${check.steps}`);
						results.push(toolText(call.id, call.name, "Rendered — the PNG follows in the next message."));
						images.push(lookMessage(LOOK_TEXT(step, check.steps, check.captions[step - 1] ?? ""), png));
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						results.push(toolText(call.id, call.name, `ERROR: rendering step ${step} failed — ${msg}`));
					}
				} else {
					results.push(toolText(call.id, call.name, `ERROR: unknown tool "${call.name}".`));
				}
			}
			messages = [...messages, ...results, ...images];
		}
	} catch (err) {
		if (opts.abortSignal?.aborted) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		return fail(`the builder crashed — ${msg}`);
	}
	return fail(`iteration limit (${maxIterations}) reached without a checked walkthrough.`);
}
