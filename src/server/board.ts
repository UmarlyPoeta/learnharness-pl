/**
 * Tablica (whiteboard): Excalidraw scenes stored as plain JSON files under
 * <data>/boards/<id>.json, plus the one-shot AI helpers the board toolbar
 * calls (ask / improve / kanban / tidy). The model comes from the user's
 * slots like everything else: the VISION slot when a snapshot image rides
 * along, the CHEAP slot otherwise (BYOK, no factory pins).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Message, TextContent, ImageContent } from "@earendil-works/pi-ai";
import { PATHS } from "../../config.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { streamOnce } from "../agent/subagents/visual-maker.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { stores } from "./stores.ts";
import "./keys.ts";

const BOARDS_DIR = path.join(PATHS.data, "boards");
const ID_RE = /^[a-z0-9-]{1,64}$/;

export interface BoardMeta {
	id: string;
	title: string;
	updatedAt: number;
}

export interface BoardRecord extends BoardMeta {
	elements: unknown[];
	appState?: Record<string, unknown>;
	files?: Record<string, unknown>;
}

function boardPath(id: string): string {
	if (!ID_RE.test(id)) throw new Error("invalid board id");
	return path.join(BOARDS_DIR, `${id}.json`);
}

export function listBoards(): BoardMeta[] {
	if (!fs.existsSync(BOARDS_DIR)) return [];
	const out: BoardMeta[] = [];
	for (const name of fs.readdirSync(BOARDS_DIR)) {
		if (!name.endsWith(".json")) continue;
		try {
			const rec = JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, name), "utf8")) as BoardRecord;
			out.push({ id: rec.id, title: rec.title, updatedAt: rec.updatedAt });
		} catch {
			// a half-written or hand-broken file never takes the list down
		}
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readBoard(id: string): BoardRecord | null {
	const file = boardPath(id);
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, "utf8")) as BoardRecord;
}

export function createBoard(title: string): BoardRecord {
	const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
	const rec: BoardRecord = { id, title: title.trim() || "Nowa tablica", updatedAt: Date.now(), elements: [] };
	writeBoard(rec);
	return rec;
}

export function writeBoard(rec: BoardRecord): void {
	fs.mkdirSync(BOARDS_DIR, { recursive: true });
	const file = boardPath(rec.id);
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(rec));
	fs.renameSync(tmp, file);
}

export function saveBoard(id: string, patch: Partial<Omit<BoardRecord, "id">>): BoardRecord {
	const current = readBoard(id);
	if (!current) throw new Error("board not found");
	const next: BoardRecord = {
		...current,
		...patch,
		id,
		title: typeof patch.title === "string" && patch.title.trim() ? patch.title.trim() : current.title,
		updatedAt: Date.now(),
	};
	writeBoard(next);
	return next;
}

export function deleteBoard(id: string): boolean {
	const file = boardPath(id);
	if (!fs.existsSync(file)) return false;
	fs.unlinkSync(file);
	return true;
}

// ─── AI ────────────────────────────────────────────────────────────────────

export type AssistMode = "ask" | "improve" | "kanban" | "tidy";

export interface AssistInput {
	mode: AssistMode;
	/** Board content as text: one line per item, "[id] text". */
	content: string;
	question?: string;
	/** PNG snapshot, base64 without the data: prefix. */
	image?: string;
}

export class BoardAssistError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

const BASE = [
	"Jesteś asystentem tablicy z notatkami w aplikacji do nauki LearnHarness PL.",
	"Treść tablicy dostajesz jako listę elementów w formacie `[id] tekst` (kolejność: z góry na dół, od lewej), czasem także zrzut ekranu tablicy.",
	"Odpowiadaj po polsku, zwięźle. Nie używaj długich myślników (em dash), używaj przecinków albo dwukropków.",
	"Na karteczkach nie używaj LaTeX ani markdown: wzory pisz zwykłymi znakami Unicode, np. f′(x) = lim h→0 (f(x+h) − f(x))/h, ∫ u dv = uv − ∫ v du.",
].join("\n");

const PROMPTS: Record<AssistMode, string> = {
	ask: `${BASE}\nOdpowiedz na pytanie użytkownika na podstawie tablicy. Możesz używać markdown. Jeśli tablica nie zawiera odpowiedzi, powiedz to i odpowiedz z własnej wiedzy, zaznaczając to.`,
	improve: `${BASE}
Zaproponuj od 3 do 8 konkretnych ulepszeń notatek: brakujące pojęcia, błędy merytoryczne, niejasności, lepsza struktura, pytania do przemyślenia.
Każda sugestia to krótka karteczka (maks. ok. 160 znaków). Jeśli dotyczy konkretnego elementu, podaj jego id w polu "near".
Zwróć WYŁĄCZNIE JSON: {"notes":[{"text":"...","near":"id albo null"}]}`,
	kanban: `${BASE}
Wyciągnij z tablicy zadania do zrobienia (rzeczy do nauczenia się, do sprawdzenia, do zrobienia) i ułóż je w kanbanie.
Kolumny: "Do zrobienia", "W trakcie", "Zrobione". Zadanie trafia do "Zrobione" tylko gdy z notatek wynika, że jest skończone; do "W trakcie" gdy jest zaczęte. Karty krótkie (maks. ok. 80 znaków), konkretne, zaczynające się od czasownika.
Zwróć WYŁĄCZNIE JSON: {"columns":[{"title":"Do zrobienia","cards":["..."]},{"title":"W trakcie","cards":[]},{"title":"Zrobione","cards":[]}]}`,
	tidy: `${BASE}
Pogrupuj elementy tablicy tematycznie, żeby uporządkować bałagan. Każdy element (po id) trafia do dokładnie jednej grupy. Grupy w sensownej kolejności, od 2 do 6 grup, krótkie tytuły.
Zwróć WYŁĄCZNIE JSON: {"groups":[{"title":"...","ids":["id1","id2"]}]}`,
};

function extractJson(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fenced ? fenced[1]! : text;
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	const fail = () => {
		console.warn("[board] unparseable model output:", text.slice(0, 600));
		return new BoardAssistError("Model nie zwrócił poprawnego JSON, spróbuj jeszcze raz", 502);
	};
	if (start < 0 || end <= start) throw fail();
	const raw = body.slice(start, end + 1);
	try {
		return JSON.parse(raw);
	} catch {
		// Models write LaTeX into strings (\, \frac, \int): escape every
		// backslash that is not a real JSON escape. "\n " stays a newline,
		// "\nabla" becomes a literal backslash.
		try {
			return JSON.parse(raw.replace(/\\(?!["\\/u]|[bfnrt](?![a-zA-Z]))/g, "\\\\"));
		} catch {
			throw fail();
		}
	}
}

export async function boardAssist(input: AssistInput, signal?: AbortSignal): Promise<{ text?: string; data?: unknown; model: string }> {
	if (!input.content.trim() && !input.image) throw new BoardAssistError("Tablica jest pusta", 400);
	const settings = stores.settingsStore.readSettings();
	const useVision = Boolean(input.image);
	const spec = resolveRoleSpec(useVision ? "visualMaker" : "extractor", settings);
	if (!spec) throw new BoardAssistError("Ustaw modele w Ustawieniach (sloty tani i wizyjny)", 503);
	const engine = piEngineForSpec(spec, true);

	const parts: (TextContent | ImageContent)[] = [
		{ type: "text", text: `Treść tablicy:\n${input.content.slice(0, 40_000) || "(tylko obraz)"}` },
	];
	if (input.question) parts.push({ type: "text", text: `Pytanie: ${input.question.slice(0, 4000)}` });
	if (input.image) parts.push({ type: "image", data: input.image, mimeType: "image/png" });
	const messages: Message[] = [{ role: "user", content: parts, timestamp: Date.now() }];

	const result = await streamOnce(engine, PROMPTS[input.mode], messages, [], `board-${input.mode}-${Date.now()}`, undefined, signal);
	const text = result.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("")
		.trim();
	const model = `${spec.provider}/${spec.id}`;
	if (input.mode === "ask") return { text, model };
	return { data: extractJson(text), model };
}
