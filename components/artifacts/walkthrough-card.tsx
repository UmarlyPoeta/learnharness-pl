"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, MaximizeIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Toggle } from "@/components/settings/controls";
import { InvertDiscIcon } from "@/components/artifacts/invert-disc";
import { ChatActionsContext } from "@/components/chat";
import { downloadFile, slugFilename } from "@/components/artifacts/download";
import { DispatchCard } from "@/components/artifacts/dispatch-card";
import type { ArtifactPartProps, WalkthroughResult } from "@/src/core";

/**
 * The animated walkthrough (wyjaśnienia obrazowe, 2026-10-29): the iframe
 * shows only the SCENE (core/walkthrough runtime); the card owns the step —
 * caption (markdown + KaTeX, the lesson's renderer), ◀ ▶, counter, restart,
 * ←/→ while focused, and an enlarged overlay. The card drives the scene
 * with `walkthrough-goto`; the scene reports `walkthrough-ready` (with its
 * aspect ratio) and `walkthrough-error`.
 */

/** The neighbouring step, clamped — no wrap-around at either end. */
export function nextStep(current: number, total: number, dir: 1 | -1): number {
	return Math.max(0, Math.min(total - 1, current + dir));
}

const BUTTON =
	"rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export function WalkthroughView({
	result,
	step,
	onStep,
	onExpand,
	expanded = false,
	frame,
}: {
	result: WalkthroughResult;
	step: number;
	onStep: (step: number) => void;
	onExpand?: () => void;
	expanded?: boolean;
	/** The scene iframe (the live card passes its own; a static render gets a plain one). */
	frame?: React.ReactNode;
}) {
	const total = result.captions.length;
	return (
		<div className="flex flex-col gap-2">
			{frame ?? (
				<iframe
					title={result.title}
					sandbox="allow-scripts"
					srcDoc={result.html}
					className="w-full rounded-lg border bg-white"
				/>
			)}
			<div className="min-h-[2.5rem] text-sm" data-testid="walkthrough-caption">
				<MessageResponse>{result.captions[step] ?? ""}</MessageResponse>
			</div>
			<div className="flex items-center gap-1">
				<button
					type="button"
					aria-label="Poprzedni krok"
					className={BUTTON}
					disabled={step <= 0}
					onClick={() => onStep(nextStep(step, total, -1))}
				>
					<ChevronLeftIcon className="size-4" />
				</button>
				<span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground" data-testid="walkthrough-counter">
					{`${step + 1}/${total}`}
				</span>
				<button
					type="button"
					aria-label="Następny krok"
					className={BUTTON}
					disabled={step >= total - 1}
					onClick={() => onStep(nextStep(step, total, 1))}
				>
					<ChevronRightIcon className="size-4" />
				</button>
				<button type="button" aria-label="Od początku" className={BUTTON} disabled={step === 0} onClick={() => onStep(0)}>
					<RotateCcwIcon className="size-3.5" />
				</button>
				{!expanded && onExpand && (
					<button type="button" aria-label="Powiększ" className={`${BUTTON} ml-auto`} onClick={onExpand}>
						<MaximizeIcon className="size-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}

export function WalkthroughCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="walkthrough" />;
}

function SceneFrame({
	result,
	step,
	inverted,
	onError,
}: {
	result: WalkthroughResult;
	step: number;
	inverted: boolean;
	onError: (message: string) => void;
}) {
	const ref = useRef<HTMLIFrameElement | null>(null);
	const [aspect, setAspect] = useState(0.6);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (!ref.current || event.source !== ref.current.contentWindow) return;
			const data = event.data as { type?: string; aspect?: number; message?: string } | null;
			if (data?.type === "walkthrough-ready") {
				if (typeof data.aspect === "number" && data.aspect > 0) setAspect(data.aspect);
				setReady(true);
			} else if (data?.type === "walkthrough-error") onError(String(data.message ?? "błąd sceny"));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [onError]);
	useEffect(() => {
		if (ready) ref.current?.contentWindow?.postMessage({ type: "walkthrough-goto", step }, "*");
	}, [ready, step]);
	return (
		<iframe
			ref={ref}
			title={result.title}
			// allow-scripts ONLY — the scene runs code but never touches the app.
			sandbox="allow-scripts"
			srcDoc={result.html}
			scrolling="no"
			className="w-full rounded-lg border bg-white"
			style={{ aspectRatio: `${1 / aspect}`, filter: inverted ? "invert(1) hue-rotate(180deg)" : undefined }}
			data-testid="walkthrough-iframe"
		/>
	);
}

export function WalkthroughOutputCard({
	output,
	messageId,
	initialInverted = false,
}: {
	output: unknown;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const actions = useContext(ChatActionsContext);
	const result = output as WalkthroughResult | undefined;
	const [step, setStep] = useState(0);
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [inverted, setInverted] = useState(initialInverted);
	useEffect(() => {
		if (!expanded) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [expanded]);

	if (!result || typeof result.html !== "string" || !Array.isArray(result.captions)) {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				Animacja została ukończona, ale nie udało się wyświetlić wyniku.
			</div>
		);
	}
	if (result.html.length === 0) {
		return (
			<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="walkthrough-card-failed">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					animowane wyjaśnienie
					<span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-500">błąd</span>
				</div>
				<p className="mt-2 text-sm">Nie udało się zbudować animacji.</p>
				{result.notes && <p className="mt-1 text-sm text-muted-foreground">{result.notes}</p>}
			</div>
		);
	}
	const total = result.captions.length;
	const toggleInverted = (next: boolean) => {
		setInverted(next);
		if (!actions?.chatId || !messageId) return;
		void fetch(`/api/chats/${actions.chatId}/artifact-ui`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: { messageId, inverted: next } }),
		}).catch(() => {});
	};
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowRight") setStep((s) => nextStep(s, total, 1));
		else if (e.key === "ArrowLeft") setStep((s) => nextStep(s, total, -1));
		else return;
		e.preventDefault();
	};
	const view = (big: boolean) => (
		<WalkthroughView
			result={result}
			step={step}
			onStep={setStep}
			expanded={big}
			onExpand={() => setExpanded(true)}
			frame={<SceneFrame result={result} step={step} inverted={inverted} onError={setError} />}
		/>
	);
	return (
		<>
			<div
				className="rounded-xl border bg-card p-4 text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
				data-testid="walkthrough-card"
				tabIndex={0}
				onKeyDown={onKeyDown}
			>
				<div className="mb-2 flex items-center justify-between gap-2">
					<div className="flex min-w-0 items-baseline gap-2">
						<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							animowane wyjaśnienie
						</span>
						<span className="truncate text-xs font-medium tracking-wide text-foreground">{result.title}</span>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<Toggle
							checked={inverted}
							onChange={toggleInverted}
							label="Invert walkthrough brightness"
							title="Odwróć kolory"
							discIcon={<InvertDiscIcon className="size-3" />}
						/>
						<button
							type="button"
							aria-label="Download walkthrough as HTML"
							title="Pobierz jako HTML"
							onClick={() => downloadFile(`${slugFilename(result.title)}.html`, result.html, "text/html")}
							className={BUTTON}
						>
							<DownloadIcon className="size-3.5" />
						</button>
					</div>
				</div>
				{error && (
					<p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs text-red-500" data-testid="walkthrough-error">
						{error}
					</p>
				)}
				{!expanded && view(false)}
			</div>
			{expanded && (
				<div
					className="fixed inset-4 z-50 flex flex-col overflow-auto rounded-xl border bg-card p-6 text-card-foreground shadow-2xl"
					tabIndex={0}
					onKeyDown={onKeyDown}
					data-testid="walkthrough-expanded"
				>
					<div className="mb-3 flex items-center justify-between">
						<span className="text-sm font-medium">{result.title}</span>
						<button type="button" aria-label="Zamknij" className={BUTTON} onClick={() => setExpanded(false)}>
							<XIcon className="size-4" />
						</button>
					</div>
					<div className="mx-auto w-full max-w-5xl">{view(true)}</div>
				</div>
			)}
		</>
	);
}
