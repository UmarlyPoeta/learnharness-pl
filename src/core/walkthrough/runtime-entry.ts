/**
 * The walkthrough iframe runtime — bundled (scripts/build-walkthrough-runtime.mjs)
 * into WALKTHROUGH_RUNTIME_JS and injected before the scene script. It
 * exposes `window.LH`: the scene builder the sub-agent's script calls, the
 * step player the card drives over postMessage, and two hooks the builder's
 * headless checks probe (`__check`, `__svgAt`).
 */
import {
	easeInOutCubic,
	frameBetween,
	type ObjectSpec,
	renderSvg,
	type Scene,
	type SceneState,
	type Stage,
	type StepSpec,
	stateAt,
	svgAtStep,
	validateScene,
} from "./engine.ts";

const TWEEN_MS = 600;
type Msg = Record<string, unknown>;

const w = window as unknown as Window & { LH: unknown };
let scene: Scene | null = null;
let errors: string[] = [];
let ready = false;
let current = 0;
let shown: SceneState | null = null;
let raf = 0;

function post(msg: Msg) {
	try {
		w.parent.postMessage(msg, "*");
	} catch {
		// no parent to tell (a bare page) — the probes still read the state
	}
}

function fail(message: string) {
	errors = [...errors, message];
	post({ type: "walkthrough-error", message });
}

function draw(svg: string) {
	const host = document.getElementById("lh-stage");
	if (host) host.innerHTML = svg;
}

function show(step: number, animate: boolean) {
	if (!scene) return;
	const target = stateAt(scene, step);
	if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
	const from = shown ?? target;
	shown = target;
	current = step;
	post({ type: "walkthrough-step", step });
	if (!animate || typeof requestAnimationFrame !== "function") {
		draw(renderSvg(scene.stage, frameBetween(target, target, 1)));
		return;
	}
	const start = performance.now();
	const s = scene;
	const tick = (now: number) => {
		const t = Math.min(1, (now - start) / TWEEN_MS);
		draw(renderSvg(s.stage, frameBetween(from, target, easeInOutCubic(t))));
		if (t < 1) raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);
}

const KINDS = ["point", "segment", "arrow", "polygon", "curve", "grid", "label"] as const;

const LH = {
	stage(range: Stage) {
		scene = { stage: range, objects: {}, steps: [] };
		const builder: Record<string, (id: string, props: Record<string, unknown>) => unknown> = {};
		for (const kind of KINDS) {
			builder[kind] = (id: string, props: Record<string, unknown>) => {
				if (!scene) throw new Error("LH.stage() must come first");
				if (scene.objects[id]) throw new Error(`object "${id}" is defined twice`);
				scene.objects[id] = { ...props, kind } as ObjectSpec;
				return builder;
			};
		}
		return builder;
	},
	steps(list: StepSpec[]) {
		if (!scene) {
			fail("LH.steps() was called before LH.stage()");
			return;
		}
		scene.steps = Array.isArray(list) ? list : [];
		const problems = validateScene(scene);
		if (problems.length > 0) {
			errors = [...errors, ...problems];
			post({ type: "walkthrough-error", message: problems.join("\n") });
			return;
		}
		ready = true;
		show(0, false);
		const [x0, x1] = scene.stage.x;
		const [y0, y1] = scene.stage.y;
		post({
			type: "walkthrough-ready",
			steps: scene.steps.length,
			captions: scene.steps.map((s) => s.caption),
			aspect: (y1 - y0) / (x1 - x0),
		});
	},
	__fail(e: unknown) {
		fail(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
	},
	__check() {
		const captions = scene?.steps.map((s) => s.caption) ?? [];
		if (errors.length > 0) return { ok: false, errors, steps: captions.length, captions };
		if (!ready) return { ok: false, errors: ["LH.steps() was never called"], steps: 0, captions: [] };
		return { ok: true, errors: [], steps: captions.length, captions };
	},
	__svgAt(n: number) {
		return scene && ready ? svgAtStep(scene, Math.max(0, Math.min(n, scene.steps.length - 1))) : "";
	},
};

w.LH = LH;
w.addEventListener("message", (event: MessageEvent) => {
	const data = event.data as Msg | null;
	if (!data || data.type !== "walkthrough-goto" || !scene || !ready) return;
	const step = Math.max(0, Math.min(Number(data.step) || 0, scene.steps.length - 1));
	if (step === current) return;
	show(step, Math.abs(step - current) === 1);
});
