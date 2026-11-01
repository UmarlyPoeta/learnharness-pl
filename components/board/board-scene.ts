/**
 * Pure scene helpers for the Tablica: Excalidraw elements → text for the
 * model, and the model's answers → element skeletons / repositioning.
 * No Excalidraw runtime import here, so it stays testable under node.
 */

/** The slice of an Excalidraw element these helpers read. */
export interface SceneEl {
	id: string;
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	isDeleted?: boolean;
	text?: string;
	originalText?: string;
	containerId?: string | null;
	boundElements?: readonly { id: string; type: string }[] | null;
	groupIds?: readonly string[];
}

export interface SceneItem {
	/** The addressable id: the container's id for bound text. */
	id: string;
	text: string;
	x: number;
	y: number;
}

const live = (els: readonly SceneEl[]) => els.filter((e) => !e.isDeleted);

/** Text items on the board, top-to-bottom then left-to-right (rows are
 *  bucketed so items on roughly the same line read left to right). */
export function sceneItems(elements: readonly SceneEl[], selectedIds?: ReadonlySet<string>): SceneItem[] {
	const els = live(elements);
	const byId = new Map(els.map((e) => [e.id, e]));
	const items: SceneItem[] = [];
	for (const el of els) {
		if (el.type !== "text") continue;
		const text = (el.originalText ?? el.text ?? "").trim();
		if (!text) continue;
		const container = el.containerId ? byId.get(el.containerId) : undefined;
		const anchor = container ?? el;
		if (selectedIds && selectedIds.size > 0 && !selectedIds.has(el.id) && !selectedIds.has(anchor.id)) continue;
		items.push({ id: anchor.id, text, x: anchor.x, y: anchor.y });
	}
	const ROW = 40;
	return items.sort((a, b) => Math.round(a.y / ROW) - Math.round(b.y / ROW) || a.x - b.x);
}

export function itemsToPrompt(items: readonly SceneItem[]): string {
	return items.map((i) => `[${i.id}] ${i.text.replace(/\s+/g, " ")}`).join("\n");
}

export function bounds(elements: readonly SceneEl[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
	const els = live(elements);
	if (els.length === 0) return null;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const e of els) {
		minX = Math.min(minX, e.x);
		minY = Math.min(minY, e.y);
		maxX = Math.max(maxX, e.x + e.width);
		maxY = Math.max(maxY, e.y + e.height);
	}
	return { minX, minY, maxX, maxY };
}

// ─── Skeletons (convertToExcalidrawElements input) ─────────────────────────

export const NOTE = { width: 260, bg: "#ffec99", stroke: "#f08c00" } as const;
const CHARS_PER_LINE = 26;
const LINE_H = 23;

export function noteHeight(text: string): number {
	const lines = wrapText(text).split("\n").length;
	return Math.max(56, lines * LINE_H + 22);
}

export interface Skeleton {
	type: "rectangle" | "text";
	x: number;
	y: number;
	width?: number;
	height?: number;
	backgroundColor?: string;
	strokeColor?: string;
	fillStyle?: "solid";
	roundness?: { type: number } | null;
	text?: string;
	fontSize?: number;
	label?: { text: string; fontSize?: number; textAlign?: "left" | "center"; verticalAlign?: "top" | "middle" };
	customData?: Record<string, unknown>;
}

/** Hard-wrap at word boundaries: Excalidraw measures label width before the
 *  hand font loads, so its own wrap overflows the note's right edge. */
export function wrapText(text: string, width = CHARS_PER_LINE - 2): string {
	return text
		.split("\n")
		.map((line) => {
			const out: string[] = [];
			let cur = "";
			for (const word of line.split(/\s+/).filter(Boolean)) {
				if (!cur) cur = word;
				else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
				else {
					out.push(cur);
					cur = word;
				}
				while (cur.length > width) {
					out.push(cur.slice(0, width));
					cur = cur.slice(width);
				}
			}
			out.push(cur);
			return out.join("\n");
		})
		.join("\n");
}

export function noteSkeleton(raw: string, x: number, y: number, kind = "note", colors: { bg: string; stroke: string } = NOTE): Skeleton {
	const text = wrapText(raw);
	return {
		type: "rectangle",
		x,
		y,
		width: NOTE.width,
		height: noteHeight(text),
		backgroundColor: colors.bg,
		strokeColor: colors.stroke,
		fillStyle: "solid",
		roundness: { type: 3 },
		label: { text, fontSize: 16, textAlign: "left", verticalAlign: "top" },
		customData: { lh: kind },
	};
}

export interface ImproveNote {
	text: string;
	near?: string | null;
}

/** Suggestion notes: beside their target element when it exists, the rest
 *  in a column to the right of everything. Notes never overlap each other. */
export function improveSkeletons(notes: readonly ImproveNote[], elements: readonly SceneEl[]): Skeleton[] {
	const els = live(elements);
	const byId = new Map(els.map((e) => [e.id, e]));
	const b = bounds(els) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	const out: Skeleton[] = [];
	const placed: { x: number; y: number; w: number; h: number }[] = [];
	const collides = (x: number, y: number, h: number) =>
		placed.some((p) => x < p.x + p.w && x + NOTE.width > p.x && y < p.y + p.h + 16 && y + h + 16 > p.y);
	let columnY = b.minY;
	const columnX = b.maxX + 120;
	for (const note of notes) {
		const text = `💡 ${note.text.trim()}`;
		const h = noteHeight(text);
		const target = note.near ? byId.get(note.near) : undefined;
		let x: number, y: number;
		if (target) {
			x = target.x + target.width + 80;
			y = target.y;
			while (collides(x, y, h)) y += 30;
		} else {
			x = columnX;
			y = columnY;
			while (collides(x, y, h)) y += 30;
			columnY = y + h + 20;
		}
		placed.push({ x, y, w: NOTE.width, h });
		out.push(noteSkeleton(text, x, y, "suggestion"));
	}
	return out;
}

export interface KanbanColumn {
	title: string;
	cards: string[];
}

const COLUMN_COLORS = [
	{ bg: "#ffc9c9", stroke: "#e03131" },
	{ bg: "#ffec99", stroke: "#f08c00" },
	{ bg: "#b2f2bb", stroke: "#2f9e44" },
];

/** A kanban laid out below everything on the board: one header text per
 *  column, cards stacked under it. */
export function kanbanSkeletons(columns: readonly KanbanColumn[], elements: readonly SceneEl[]): Skeleton[] {
	const b = bounds(elements);
	const originX = b ? b.minX : 0;
	const originY = b ? b.maxY + 160 : 0;
	const gap = 40;
	const out: Skeleton[] = [{ type: "text", x: originX, y: originY - 70, text: "Kanban", fontSize: 32, customData: { lh: "kanban" } }];
	columns.forEach((col, i) => {
		const x = originX + i * (NOTE.width + gap);
		out.push({ type: "text", x, y: originY, text: `${col.title} (${col.cards.length})`, fontSize: 20, customData: { lh: "kanban" } });
		let y = originY + 44;
		for (const card of col.cards) {
			const sk = noteSkeleton(card.trim(), x, y, "kanban", COLUMN_COLORS[i % COLUMN_COLORS.length]);
			out.push(sk);
			y += (sk.height ?? 70) + 16;
		}
	});
	return out;
}

export interface TidyGroup {
	title: string;
	ids: string[];
}

/** New positions for tidy: each group becomes a column (title + its
 *  items stacked). Returns the moves by element id (bound text follows its
 *  container), plus header skeletons. Unknown ids are skipped; elements
 *  the model left out keep their place. */
export function tidyLayout(
	groups: readonly TidyGroup[],
	elements: readonly SceneEl[],
): { moves: Map<string, { dx: number; dy: number }>; headers: Skeleton[] } {
	const els = live(elements);
	const byId = new Map(els.map((e) => [e.id, e]));
	const b = bounds(els) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	const moves = new Map<string, { dx: number; dy: number }>();
	const headers: Skeleton[] = [];
	const seen = new Set<string>();
	let x = b.minX;
	for (const g of groups) {
		const members = g.ids.map((id) => byId.get(id)).filter((e): e is SceneEl => Boolean(e) && !seen.has(e!.id));
		if (members.length === 0) continue;
		headers.push({ type: "text", x, y: b.minY - 60, text: g.title, fontSize: 24, customData: { lh: "tidy" } });
		let y = b.minY;
		let colW = 0;
		for (const el of members) {
			seen.add(el.id);
			const d = { dx: x - el.x, dy: y - el.y };
			moves.set(el.id, d);
			for (const bound of el.boundElements ?? []) if (bound.type === "text") moves.set(bound.id, d);
			y += el.height + 24;
			colW = Math.max(colW, el.width);
		}
		x += Math.max(colW, 200) + 80;
	}
	return { moves, headers };
}

/** The prompt that starts a learning session from board content. */
export function learnPrompt(boardTitle: string, items: readonly SceneItem[]): string {
	const body = items.map((i) => `- ${i.text.replace(/\s+/g, " ")}`).join("\n").slice(0, 5000);
	return `Chcę się nauczyć tematu z moich notatek z tablicy „${boardTitle}”. Zacznij od sprawdzenia, co już rozumiem, i oprzyj naukę na tym, co zapisałem:\n\n${body}`;
}
