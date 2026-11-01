"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import {
	GraduationCapIcon,
	KanbanSquareIcon,
	LayoutGridIcon,
	Loader2Icon,
	MessageCircleQuestionIcon,
	MicIcon,
	PlusIcon,
	SparklesIcon,
	SquareIcon,
	XIcon,
} from "lucide-react";
import { useDictation } from "@/components/dictation";
import type { ExcalidrawImperativeAPI } from "./excalidraw-canvas";
import {
	improveSkeletons,
	itemsToPrompt,
	kanbanSkeletons,
	learnPrompt,
	noteSkeleton,
	sceneItems,
	tidyLayout,
	type ImproveNote,
	type KanbanColumn,
	type SceneEl,
	type Skeleton,
	type TidyGroup,
} from "./board-scene";

const Canvas = dynamic(() => import("./excalidraw-canvas"), {
	ssr: false,
	loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ładowanie tablicy…</div>,
});

interface BoardMeta {
	id: string;
	title: string;
	updatedAt: number;
}
interface BoardRecord extends BoardMeta {
	elements: unknown[];
	appState?: Record<string, unknown>;
	files?: Record<string, unknown>;
}

type Busy = null | "ask" | "improve" | "kanban" | "tidy" | "learn";

const LAST_KEY = "lh-board-last";

function sceneSignature(elements: readonly unknown[]): string {
	let sum = 0;
	for (const e of elements as { version?: number; versionNonce?: number }[]) sum += (e.version ?? 0) * 31 + (e.versionNonce ?? 0) % 997;
	return `${elements.length}:${sum}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
	const buf = new Uint8Array(await blob.arrayBuffer());
	let bin = "";
	for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
	return btoa(bin);
}

export function BoardView() {
	const router = useRouter();
	const [boards, setBoards] = useState<BoardMeta[]>([]);
	const [board, setBoard] = useState<BoardRecord | null>(null);
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState<Busy>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [askOpen, setAskOpen] = useState(false);
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState<string | null>(null);
	const [selCount, setSelCount] = useState(0);
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSig = useRef<string>("");
	const boardIdRef = useRef<string | null>(null);

	// ── load ──────────────────────────────────────────────────────────────
	const openBoard = useCallback(async (id: string) => {
		const res = await fetch(`/api/boards/${id}`);
		if (!res.ok) return false;
		const rec = (await res.json()) as BoardRecord;
		lastSig.current = sceneSignature(rec.elements);
		boardIdRef.current = rec.id;
		setBoard(rec);
		setTitle(rec.title);
		setAnswer(null);
		try { localStorage.setItem(LAST_KEY, rec.id); } catch { /* storage may be blocked */ }
		return true;
	}, []);

	const refreshList = useCallback(async () => {
		const res = await fetch("/api/boards");
		const { boards: list } = (await res.json()) as { boards: BoardMeta[] };
		setBoards(list);
		return list;
	}, []);

	const newBoard = useCallback(async (name = "Nowa tablica") => {
		const res = await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: name }) });
		const rec = (await res.json()) as BoardRecord;
		await refreshList();
		await openBoard(rec.id);
	}, [openBoard, refreshList]);

	const booted = useRef(false);
	useEffect(() => {
		// once per mount, StrictMode's double effect would create two boards
		if (booted.current) return;
		booted.current = true;
		void (async () => {
			const list = await refreshList();
			let last: string | null = null;
			try { last = localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
			const pick = list.find((b) => b.id === last) ?? list[0];
			if (pick) await openBoard(pick.id);
			else await newBoard("Moja tablica");
		})();
	}, [refreshList, openBoard, newBoard]);

	// ── save ──────────────────────────────────────────────────────────────
	const flushSave = useCallback(async () => {
		const api = apiRef.current;
		const id = boardIdRef.current;
		if (!api || !id) return;
		const elements = api.getSceneElements();
		const files = api.getFiles();
		const used = new Set(elements.map((e) => (e as { fileId?: string }).fileId).filter(Boolean));
		const keptFiles = Object.fromEntries(Object.entries(files).filter(([k]) => used.has(k)));
		await fetch(`/api/boards/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ elements, files: keptFiles, appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor } }),
		});
	}, []);

	const onChange = useCallback((elements: readonly unknown[], appState: Record<string, unknown>) => {
		const sel = Object.keys((appState.selectedElementIds as Record<string, boolean> | undefined) ?? {}).length;
		setSelCount((prev) => (prev === sel ? prev : sel));
		const sig = sceneSignature(elements);
		if (sig === lastSig.current) return;
		lastSig.current = sig;
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => void flushSave(), 700);
	}, [flushSave]);

	useEffect(() => () => {
		if (saveTimer.current) {
			clearTimeout(saveTimer.current);
			void flushSave();
		}
	}, [flushSave]);

	const renameBoard = useCallback(async () => {
		if (!board || !title.trim() || title.trim() === board.title) return;
		await fetch(`/api/boards/${board.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
		setBoard({ ...board, title: title.trim() });
		await refreshList();
	}, [board, title, refreshList]);

	// ── scene access ──────────────────────────────────────────────────────
	const sceneState = useCallback(() => {
		const api = apiRef.current!;
		const elements = api.getSceneElements() as unknown as SceneEl[];
		const selected = new Set(Object.keys(api.getAppState().selectedElementIds ?? {}));
		return { api, elements, selected };
	}, []);

	const addSkeletons = useCallback(async (skeletons: Skeleton[], extraMoves?: Map<string, { dx: number; dy: number }>) => {
		const { convertToExcalidrawElements, CaptureUpdateAction } = await import("./excalidraw-canvas");
		const api = apiRef.current!;
		const created = convertToExcalidrawElements(skeletons as never, { regenerateIds: true });
		let current = api.getSceneElements() as unknown as (SceneEl & { version: number; versionNonce: number })[];
		if (extraMoves && extraMoves.size > 0) {
			current = current.map((el) => {
				const m = extraMoves.get(el.id);
				return m ? { ...el, x: el.x + m.dx, y: el.y + m.dy, version: el.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : el;
			});
		}
		api.updateScene({ elements: [...current, ...created] as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
		const focus = created.length > 0 ? created : (api.getSceneElements() as never[]);
		api.scrollToContent(focus as never, { fitToContent: true, animate: true });
	}, []);

	const snapshot = useCallback(async (onlySelected: boolean): Promise<string | undefined> => {
		const { exportToBlob } = await import("./excalidraw-canvas");
		const { api, elements, selected } = sceneState();
		const els = onlySelected && selected.size > 0 ? elements.filter((e) => selected.has(e.id)) : elements;
		if (els.length === 0) return undefined;
		const blob = await exportToBlob({
			elements: els as never,
			appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false } as never,
			files: api.getFiles(),
			mimeType: "image/png",
			maxWidthOrHeight: 1600,
		});
		return blobToBase64(blob);
	}, [sceneState]);

	// ── AI ────────────────────────────────────────────────────────────────
	const assist = useCallback(async (mode: "ask" | "improve" | "kanban" | "tidy", extra?: { question?: string }) => {
		if (!apiRef.current || busy) return null;
		setBusy(mode);
		setError(null);
		setStatus(null);
		try {
			const { elements, selected } = sceneState();
			const items = sceneItems(elements, mode === "tidy" ? undefined : selected);
			const hasDrawings = elements.some((e) => !e.isDeleted && e.type !== "text");
			// Image only where it pays: ask/improve read drawings, and a board
			// with no text at all can only be read as a picture.
			const wantImage = (mode === "ask" || mode === "improve") ? hasDrawings : items.length === 0;
			const image = wantImage ? await snapshot(mode !== "tidy") : undefined;
			const res = await fetch("/api/boards/assist", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode, content: itemsToPrompt(items), image, ...extra }),
			});
			const body = (await res.json()) as { text?: string; data?: unknown; model?: string; error?: string };
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			setStatus(body.model ? `model: ${body.model}` : null);
			return { body, elements };
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return null;
		} finally {
			setBusy(null);
		}
	}, [busy, sceneState, snapshot]);

	const runImprove = useCallback(async () => {
		const out = await assist("improve");
		const notes = (out?.body.data as { notes?: ImproveNote[] } | undefined)?.notes;
		if (!out) return;
		if (!Array.isArray(notes) || notes.length === 0) return setError("Model nie zaproponował żadnych zmian");
		await addSkeletons(improveSkeletons(notes.filter((n) => typeof n?.text === "string"), out.elements));
	}, [assist, addSkeletons]);

	const runKanban = useCallback(async () => {
		const out = await assist("kanban");
		const columns = (out?.body.data as { columns?: KanbanColumn[] } | undefined)?.columns;
		if (!out) return;
		if (!Array.isArray(columns)) return setError("Model nie zwrócił kanbana");
		const clean = columns.map((c) => ({ title: String(c.title ?? ""), cards: Array.isArray(c.cards) ? c.cards.map(String) : [] }));
		if (clean.every((c) => c.cards.length === 0)) return setError("Nie znalazłem na tablicy żadnych zadań");
		await addSkeletons(kanbanSkeletons(clean, out.elements));
	}, [assist, addSkeletons]);

	const runTidy = useCallback(async () => {
		const out = await assist("tidy");
		const groups = (out?.body.data as { groups?: TidyGroup[] } | undefined)?.groups;
		if (!out) return;
		if (!Array.isArray(groups) || groups.length === 0) return setError("Model nie pogrupował tablicy");
		const { moves, headers } = tidyLayout(groups.map((g) => ({ title: String(g.title ?? ""), ids: Array.isArray(g.ids) ? g.ids.map(String) : [] })), out.elements);
		await addSkeletons(headers, moves);
	}, [assist, addSkeletons]);

	const runAsk = useCallback(async () => {
		const q = question.trim();
		if (!q) return;
		const out = await assist("ask", { question: q });
		if (out?.body.text) setAnswer(out.body.text);
	}, [assist, question]);

	const answerToNote = useCallback(async () => {
		if (!answer || !apiRef.current) return;
		const { scrollX, scrollY, zoom, width, height } = apiRef.current.getAppState();
		const z = zoom.value;
		await addSkeletons([noteSkeleton(answer.slice(0, 1200), -scrollX + width / (2 * z) - 130, -scrollY + height / (2 * z) - 60, "answer", { bg: "#d0ebff", stroke: "#1971c2" })]);
	}, [answer, addSkeletons]);

	const runLearn = useCallback(async () => {
		if (!apiRef.current || !board || busy) return;
		const { elements, selected } = sceneState();
		const items = sceneItems(elements, selected);
		if (items.length === 0) return setError("Zaznacz notatki z tekstem (albo zostaw nic niezaznaczone, żeby wziąć całą tablicę)");
		setBusy("learn");
		try {
			await flushSave();
			const prompt = learnPrompt(board.title, items);
			const res = await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Tablica: ${board.title}` }) });
			const { id } = (await res.json()) as { id: string };
			router.push(`/chat/${id}?prompt=${encodeURIComponent(prompt)}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(null);
		}
	}, [board, busy, sceneState, flushSave, router]);

	// ── dictation → sticky note at the viewport centre ────────────────────
	const appendDictation = useCallback((text: string) => {
		const t = text.trim();
		if (!t || !apiRef.current) return;
		const { scrollX, scrollY, zoom, width, height } = apiRef.current.getAppState();
		const z = zoom.value;
		const jitter = Math.round(Math.random() * 60);
		void addSkeletons([noteSkeleton(t, -scrollX + width / (2 * z) - 130 + jitter, -scrollY + height / (2 * z) - 40 + jitter)]);
	}, [addSkeletons]);
	const dictation = useDictation({ append: appendDictation });

	// ── UI ────────────────────────────────────────────────────────────────
	const btn = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50";
	const spin = (m: Busy) => (busy === m ? <Loader2Icon className="size-3.5 animate-spin" /> : null);

	return (
		<div className="flex h-dvh min-w-0 flex-col">
			<div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
				<select
					aria-label="Wybierz tablicę"
					className="rounded-md border border-border bg-background px-2 py-1 text-xs"
					value={board?.id ?? ""}
					onChange={(e) => void (async () => { await flushSave(); await openBoard(e.target.value); })()}
				>
					{boards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
				</select>
				<input
					aria-label="Nazwa tablicy"
					className="w-40 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs hover:border-border focus:border-border focus:outline-none"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					onBlur={() => void renameBoard()}
					onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
				/>
				<button type="button" className={btn} onClick={() => void (async () => { await flushSave(); await newBoard(); })()} title="Nowa tablica">
					<PlusIcon className="size-3.5" />
				</button>
				<span className="mx-1 h-4 w-px bg-border" />
				<button type="button" className={btn} disabled={!!busy} onClick={() => setAskOpen((v) => !v)} title="Zadaj pytanie o tablicę (albo o zaznaczenie)">
					<MessageCircleQuestionIcon className="size-3.5" /> Zapytaj
				</button>
				<button type="button" className={btn} disabled={!!busy} onClick={() => void runImprove()} title="Karteczki z sugestiami ulepszeń">
					{spin("improve") ?? <SparklesIcon className="size-3.5" />} Popraw
				</button>
				<button type="button" className={btn} disabled={!!busy} onClick={() => void runKanban()} title="Kanban z zadań na tablicy">
					{spin("kanban") ?? <KanbanSquareIcon className="size-3.5" />} Kanban
				</button>
				<button type="button" className={btn} disabled={!!busy} onClick={() => void runTidy()} title="Pogrupuj i ułóż elementy w kolumny (Ctrl+Z cofa)">
					{spin("tidy") ?? <LayoutGridIcon className="size-3.5" />} Uporządkuj
				</button>
				<button type="button" className={btn} disabled={!!busy} onClick={() => void runLearn()} title="Sesja nauki z zaznaczenia (lub całej tablicy)">
					{spin("learn") ?? <GraduationCapIcon className="size-3.5" />} Ucz mnie z tego
				</button>
				<span className="mx-1 h-4 w-px bg-border" />
				<button
					type="button"
					className={`${btn} ${dictation.active ? "bg-red-500/15 text-red-400" : ""}`}
					onClick={dictation.toggle}
					title="Dyktuj karteczkę (klik, mów, klik)"
				>
					{dictation.active ? <SquareIcon className="size-3.5" /> : <MicIcon className="size-3.5" />}
					{dictation.phase === "stopping" ? "Przepisuję…" : dictation.active ? "Stop" : "Dyktuj"}
				</button>
				<span className="ml-auto truncate text-[11px] text-muted-foreground/70">
					{error ?? dictation.error ?? status}
				</span>
				<span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${selCount > 0 ? "bg-primary/15 text-primary" : "text-muted-foreground/60"}`} title="Zaznacz elementy, żeby AI patrzyło tylko na nie (Uporządkuj zawsze bierze całość)">
					AI widzi: {selCount > 0 ? `zaznaczenie (${selCount})` : "całą tablicę"}
				</span>
			</div>
			<div className="relative flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">
					{board && (
						<Canvas
							key={board.id}
							initialData={board}
							onApi={(api) => { apiRef.current = api; }}
							onChange={onChange}
						/>
					)}
				</div>
				{askOpen && (
					<aside className="flex w-96 shrink-0 flex-col border-l border-border bg-background">
						<div className="flex items-center justify-between px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
							Zapytaj tablicę
							<button type="button" className={btn} onClick={() => setAskOpen(false)} aria-label="Zamknij"><XIcon className="size-3.5" /></button>
						</div>
						<div className="px-3">
							<textarea
								className="h-24 w-full resize-none rounded-md border border-border bg-transparent p-2 text-sm focus:outline-none"
								placeholder="Np. czego tu brakuje do egzaminu? (Enter wysyła)"
								value={question}
								onChange={(e) => setQuestion(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void runAsk(); } }}
							/>
							<div className="mt-1 flex gap-1">
								<button type="button" className={btn} disabled={!!busy || !question.trim()} onClick={() => void runAsk()}>
									{spin("ask") ?? <MessageCircleQuestionIcon className="size-3.5" />} Wyślij
								</button>
								{answer && (
									<button type="button" className={btn} onClick={() => void answerToNote()}>
										<PlusIcon className="size-3.5" /> Na tablicę
									</button>
								)}
							</div>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm leading-relaxed">
							{answer ? <Streamdown>{answer}</Streamdown> : <p className="text-muted-foreground/70">Odpowiedź pojawi się tutaj.</p>}
						</div>
					</aside>
				)}
			</div>
		</div>
	);
}
