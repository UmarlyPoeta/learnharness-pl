/**
 * The foundation session card (nauka od korzeni §2): title, the "why" line,
 * and the button that creates the session through the draft contract —
 * locked while the create is in flight so a double click makes one session.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	FoundationSessionCardView,
	foundationWhyLine,
	openFoundationSession,
} from "../components/artifacts/foundation-session-card.tsx";

const INPUT = { title: "Macierze od zera", goal: "Chcę zrozumieć mnożenie macierzy. Potrzebne do LM." };

describe("FoundationSessionCardView", () => {
	it("renders the header, title, first sentence of the goal and the open button", () => {
		const html = renderToStaticMarkup(<FoundationSessionCardView input={INPUT} busy={false} onOpen={() => {}} />);
		assert.ok(html.includes("Sesja-korzeń"));
		assert.ok(html.includes("Macierze od zera"));
		assert.ok(html.includes("Chcę zrozumieć mnożenie macierzy."));
		assert.ok(!html.includes("Potrzebne do LM."), "only the first sentence");
		assert.ok(html.includes("Otwórz sesję-korzeń"));
		assert.ok(html.includes('data-testid="foundation-session-open"'));
	});

	it("shows a pending line and no button while the input does not parse", () => {
		const html = renderToStaticMarkup(<FoundationSessionCardView input={undefined} busy={false} onOpen={() => {}} />);
		assert.ok(html.includes("Przygotowuję sesję-korzeń…"));
		assert.ok(!html.includes("foundation-session-open"));
	});

	it("disables the button while busy", () => {
		const html = renderToStaticMarkup(<FoundationSessionCardView input={INPUT} busy onOpen={() => {}} />);
		assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="foundation-session-open"|<button[^>]*data-testid="foundation-session-open"[^>]*disabled=""/);
	});
});

describe("foundationWhyLine", () => {
	it("caps a sentence-less goal at 160 characters", () => {
		const line = foundationWhyLine("a".repeat(400));
		assert.equal(line.length, 160);
		assert.ok(line.endsWith("…"));
	});
});

describe("openFoundationSession", () => {
	it("creates the session from the goal and navigates to it", async () => {
		const pushed: string[] = [];
		const fakeFetch = (async () => new Response(JSON.stringify({ id: "chat_x" }))) as typeof fetch;
		const ok = await openFoundationSession(INPUT.goal, fakeFetch, (href) => pushed.push(href));
		assert.equal(ok, true);
		assert.deepEqual(pushed, [`/chat/chat_x?prompt=${encodeURIComponent(INPUT.goal)}`]);
	});

	it("does nothing for a blank goal", async () => {
		const pushed: string[] = [];
		const fakeFetch = (async () => {
			throw new Error("must not fetch");
		}) as typeof fetch;
		const ok = await openFoundationSession("  ", fakeFetch, (href) => pushed.push(href));
		assert.equal(ok, false);
		assert.deepEqual(pushed, []);
	});
});
