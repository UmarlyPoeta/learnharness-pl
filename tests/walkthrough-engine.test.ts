import assert from "node:assert";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
	easeInOutCubic,
	frameBetween,
	renderSvg,
	type Scene,
	stateAt,
	validateScene,
} from "../src/core/walkthrough/engine.ts";
import { buildWalkthroughHtml } from "../src/core/walkthrough/html.ts";
import { WALKTHROUGH_RUNTIME_JS } from "../src/core/walkthrough/runtime-bundle.ts";

const scene = (over: Partial<Scene> = {}): Scene => ({
	stage: { x: [-2, 2], y: [-1, 1] },
	objects: {
		p: { kind: "point", x: 0, y: 0 },
		q: { kind: "polygon", points: [[0, 0], [1, 0], [0, 1]] },
	},
	steps: [
		{ caption: "Punkt.", show: ["p"] },
		{ caption: "Ruch.", set: { p: { x: 1 } } },
		{ caption: "Trójkąt.", show: ["q"], hide: ["p"] },
	],
	...over,
});

test("validateScene: a good scene passes; each defect is named", () => {
	assert.deepEqual(validateScene(scene()), []);
	const s = scene();
	assert.match(validateScene({ ...s, steps: s.steps.slice(0, 2) }).join(), /3–12/);
	assert.match(validateScene({ ...s, steps: [s.steps[0]!, { caption: " " }, s.steps[2]!] }).join(), /step 2: empty caption/);
	assert.match(validateScene({ ...s, steps: [{ caption: "a", show: ["X"] }, ...s.steps.slice(1)] }).join(), /step 1: unknown object "X"/);
	assert.match(validateScene({ ...s, steps: [s.steps[0]!, { caption: "a", set: { p: { x: Number.NaN } } }, s.steps[2]!] }).join(), /not finite/);
	assert.match(validateScene({ ...s, steps: [s.steps[0]!, { caption: "a", set: { p: { x: 100 } } }, s.steps[2]!] }).join(), /outside the stage/);
	assert.match(validateScene({ ...s, steps: [s.steps[0]!, { caption: "a", set: { p: { radius: 1 } } }, s.steps[2]!] }).join(), /unknown property "radius"/);
	assert.match(
		validateScene({ ...s, steps: [s.steps[0]!, s.steps[1]!, { caption: "a", show: ["q"], set: { q: { points: [[0, 0], [1, 1]] } } }] }).join(),
		/changes its point count/,
	);
	const curve = scene({
		objects: { f: { kind: "curve", fn: (x) => Math.sqrt(x), domain: [-1, 1] } },
		steps: [{ caption: "a" }, { caption: "b", show: ["f"] }, { caption: "c" }],
	});
	assert.match(validateScene(curve).join(), /step 2: curve "f" is not finite/);
});

test("stateAt is cumulative; frameBetween interpolates and fades", () => {
	const s = scene();
	assert.equal((stateAt(s, 1).p!.spec as { x: number }).x, 1);
	assert.equal(stateAt(s, 2).p!.visible, false);
	const mid = frameBetween(stateAt(s, 0), stateAt(s, 1), 0.5);
	assert.equal((mid.p!.spec as { x: number }).x, 0.5);
	assert.equal(frameBetween(stateAt(s, 1), stateAt(s, 2), 0.5).q!.opacity, 0.5);
	assert.deepEqual([easeInOutCubic(0), easeInOutCubic(0.5), easeInOutCubic(1)], [0, 0.5, 1]);
});

test("renderSvg maps math coordinates and escapes text", () => {
	const svg = renderSvg(
		{ x: [-2, 2], y: [-1, 1] },
		{
			p: { spec: { kind: "point", x: 0, y: 0, label: "<b>" }, opacity: 1 },
			h: { spec: { kind: "point", x: 1, y: 1 }, opacity: 0 },
		},
	);
	assert.match(svg, /viewBox="0 0 720 360"/);
	assert.match(svg, /cx="360" cy="180"/);
	assert.match(svg, /&lt;b&gt;/);
	assert.equal(svg.match(/<circle/g)?.length, 1);
});

function runDocument(script: string) {
	const { window, document } = parseHTML('<html><body><div id="lh-stage"></div></body></html>');
	const posted: Record<string, unknown>[] = [];
	(window as unknown as { parent: unknown }).parent = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
	const html = buildWalkthroughHtml(script);
	const user = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
	new Function("window", "document", `${WALKTHROUGH_RUNTIME_JS};${user}`)(window, document);
	return { LH: (window as unknown as { LH: Record<string, (...a: unknown[]) => unknown> }).LH, posted, document };
}

const GOOD = `LH.stage({ x: [-2, 2], y: [-1, 1] }).point("p", { x: 0, y: 0 });
LH.steps([{ caption: "a", show: ["p"] }, { caption: "b", set: { p: { x: 1 } } }, { caption: "c" }]);`;

test("runtime: a good scene is ready, a bad API call is reported", () => {
	const ok = runDocument(GOOD);
	assert.deepEqual(ok.LH.__check!(), { ok: true, errors: [], steps: 3, captions: ["a", "b", "c"] });
	assert.equal(ok.posted[ok.posted.length - 1]!.type, "walkthrough-ready");
	assert.match(String(ok.LH.__svgAt!(1)), /^<svg/);
	assert.match(ok.document.getElementById("lh-stage")!.innerHTML, /<svg/);
	const bad = runDocument(`LH.stage({ x: [-2, 2], y: [-1, 1] }).circle("c", {});`);
	const check = bad.LH.__check!() as { ok: boolean; errors: string[] };
	assert.equal(check.ok, false);
	assert.match(check.errors.join(), /circle/);
});

test("the bundle is fresh and the document keeps </script> inside the script", async () => {
	const { buildRuntimeSource } = await import("../scripts/build-walkthrough-runtime.mjs");
	assert.equal(await buildRuntimeSource(), WALKTHROUGH_RUNTIME_JS);
	const html = buildWalkthroughHtml("x='</script>'");
	assert.equal(html.match(/<\/script>/g)?.length, 2);
});
