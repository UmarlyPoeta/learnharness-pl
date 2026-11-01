import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	improveSkeletons,
	itemsToPrompt,
	kanbanSkeletons,
	learnPrompt,
	sceneItems,
	tidyLayout,
	type SceneEl,
} from "../components/board/board-scene";
import { createBoard, deleteBoard, listBoards, readBoard, saveBoard } from "../src/server/board";

const el = (o: Partial<SceneEl> & { id: string }): SceneEl => ({ type: "rectangle", x: 0, y: 0, width: 100, height: 50, ...o });

const scene: SceneEl[] = [
	el({ id: "box1", x: 0, y: 0, boundElements: [{ id: "t1", type: "text" }] }),
	el({ id: "t1", type: "text", x: 10, y: 10, text: "Pochodne", containerId: "box1" }),
	el({ id: "t2", type: "text", x: 300, y: 5, text: "Całki" }),
	el({ id: "t3", type: "text", x: 0, y: 200, text: "Szeregi" }),
	el({ id: "gone", type: "text", x: 0, y: 400, text: "usunięte", isDeleted: true }),
];

describe("board scene", () => {
	it("reads text rows top to bottom, left to right, bound text addressed by container", () => {
		const items = sceneItems(scene);
		assert.deepEqual(items.map((i) => i.id), ["box1", "t2", "t3"]);
		assert.equal(itemsToPrompt(items), "[box1] Pochodne\n[t2] Całki\n[t3] Szeregi");
	});

	it("narrows to the selection (container or its text)", () => {
		assert.deepEqual(sceneItems(scene, new Set(["box1"])).map((i) => i.id), ["box1"]);
		assert.deepEqual(sceneItems(scene, new Set(["t3"])).map((i) => i.id), ["t3"]);
	});

	it("places suggestions beside their target without overlapping", () => {
		const sk = improveSkeletons([{ text: "a", near: "box1" }, { text: "b", near: "box1" }, { text: "c" }], scene);
		assert.equal(sk.length, 3);
		assert.equal(sk[0]!.x, 180);
		assert.ok(sk[1]!.y >= sk[0]!.y + (sk[0]!.height ?? 0));
		assert.ok(sk[2]!.x > 400);
	});

	it("lays the kanban out below the board", () => {
		const sk = kanbanSkeletons([{ title: "Do zrobienia", cards: ["x", "y"] }, { title: "Zrobione", cards: [] }], scene);
		assert.ok(sk.every((s) => s.y > 250));
		assert.equal(sk.filter((s) => s.type === "rectangle").length, 2);
	});

	it("tidy moves bound text with its container and skips unknown ids", () => {
		const { moves, headers } = tidyLayout([{ title: "A", ids: ["t3", "box1", "nope"] }], scene);
		assert.deepEqual(moves.get("t1"), moves.get("box1"));
		assert.equal(moves.has("t2"), false);
		assert.equal(headers.length, 1);
	});

	it("learn prompt carries the notes", () => {
		assert.match(learnPrompt("Analiza", sceneItems(scene)), /Analiza[\s\S]*- Całki/);
	});
});

describe("board store", () => {
	it("creates, saves, lists and deletes", () => {
		const b = createBoard("Test");
		saveBoard(b.id, { elements: [{ id: "x" }], title: "Inna" });
		assert.equal(readBoard(b.id)!.title, "Inna");
		assert.equal(readBoard(b.id)!.elements.length, 1);
		assert.ok(listBoards().some((m) => m.id === b.id));
		assert.equal(deleteBoard(b.id), true);
		assert.equal(readBoard(b.id), null);
		assert.throws(() => readBoard("../etc"));
	});
});
