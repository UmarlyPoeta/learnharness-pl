/**
 * The walkthrough scene engine — pure (no DOM, no app imports): it runs
 * both in the app (tests, the builder's checks) and bundled inside the
 * walkthrough iframe (runtime-entry.ts). A scene is a math-coordinate
 * stage, named objects (hidden until a step shows them) and 3–12 steps;
 * a step is a STATE change, so any step can be rendered directly and
 * stepping back always works.
 */

export type Vec = [number, number];
export type Params = Record<string, number>;
export type ColorName = "blue" | "red" | "green" | "orange" | "purple" | "gray" | "black";

export const PALETTE: Record<ColorName, string> = {
	blue: "#2563eb",
	red: "#dc2626",
	green: "#16a34a",
	orange: "#ea580c",
	purple: "#7c3aed",
	gray: "#6b7280",
	black: "#111827",
};

export type ObjectSpec =
	| { kind: "point"; x: number; y: number; label?: string; color?: ColorName }
	| { kind: "segment"; from: Vec; to: Vec; color?: ColorName; dashed?: boolean }
	| { kind: "arrow"; from: Vec; to: Vec; color?: ColorName }
	| { kind: "polygon"; points: Vec[]; color?: ColorName; fill?: boolean }
	| { kind: "curve"; fn: (x: number, p: Params) => number; params?: Params; domain: Vec; color?: ColorName }
	| {
			kind: "grid";
			map: (u: number, v: number, p: Params) => Vec;
			params?: Params;
			u: Vec;
			v: Vec;
			lines?: number;
			color?: ColorName;
	  }
	| { kind: "label"; at: Vec; text: string; color?: ColorName; size?: number };

export type ObjectKind = ObjectSpec["kind"];

export interface StepSpec {
	caption: string;
	show?: string[];
	hide?: string[];
	set?: Record<string, Record<string, unknown>>;
}

export interface Stage {
	x: Vec;
	y: Vec;
}

export interface Scene {
	stage: Stage;
	objects: Record<string, ObjectSpec>;
	steps: StepSpec[];
}

export type SceneState = Record<string, { spec: ObjectSpec; visible: boolean }>;

export interface FrameObject {
	spec: ObjectSpec;
	opacity: number;
}

export const MIN_STEPS = 3;
export const MAX_STEPS = 12;
const CURVE_SAMPLES = 200;
const GRID_SAMPLES = 40;
const DEFAULT_GRID_LINES = 8;

/** The properties each kind accepts (besides `kind`) — `set` may touch only these. */
const KIND_PROPS: Record<ObjectKind, readonly string[]> = {
	point: ["x", "y", "label", "color"],
	segment: ["from", "to", "color", "dashed"],
	arrow: ["from", "to", "color"],
	polygon: ["points", "color", "fill"],
	curve: ["fn", "params", "domain", "color"],
	grid: ["map", "params", "u", "v", "lines", "color"],
	label: ["at", "text", "color", "size"],
};

const isVec = (v: unknown): v is Vec => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");
const isVecList = (v: unknown): v is Vec[] => Array.isArray(v) && v.every(isVec);

function cloneValue<T>(v: T): T {
	if (Array.isArray(v)) return v.map(cloneValue) as T;
	if (v && typeof v === "object" && typeof v !== "function") {
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v)) out[k] = cloneValue(x);
		return out as T;
	}
	return v;
}

/** Apply one step's changes to a state (in place). `params` merge key by key. */
function applyStep(state: SceneState, step: StepSpec): void {
	for (const id of step.show ?? []) if (state[id]) state[id].visible = true;
	for (const id of step.hide ?? []) if (state[id]) state[id].visible = false;
	for (const [id, changes] of Object.entries(step.set ?? {})) {
		const entry = state[id];
		if (!entry) continue;
		const spec = { ...entry.spec } as Record<string, unknown>;
		for (const [key, value] of Object.entries(changes)) {
			if (key === "params" && value && typeof value === "object") {
				spec.params = { ...((spec.params as Params) ?? {}), ...cloneValue(value as Params) };
			} else spec[key] = cloneValue(value);
		}
		entry.spec = spec as unknown as ObjectSpec;
	}
}

function initialState(scene: Scene): SceneState {
	const state: SceneState = {};
	for (const [id, spec] of Object.entries(scene.objects)) state[id] = { spec: cloneValue(spec), visible: false };
	return state;
}

/** The cumulative state after steps 0..step (0-based). */
export function stateAt(scene: Scene, step: number): SceneState {
	const state = initialState(scene);
	const last = Math.min(step, scene.steps.length - 1);
	for (let i = 0; i <= last; i++) applyStep(state, scene.steps[i]!);
	return state;
}

/** Sample a curve as [x, y] points (non-finite y kept as NaN). */
function sampleCurve(spec: Extract<ObjectSpec, { kind: "curve" }>): Vec[] {
	const [a, b] = spec.domain;
	const out: Vec[] = [];
	for (let i = 0; i <= CURVE_SAMPLES; i++) {
		const x = a + ((b - a) * i) / CURVE_SAMPLES;
		let y: number;
		try {
			y = spec.fn(x, spec.params ?? {});
		} catch {
			y = Number.NaN;
		}
		out.push([x, y]);
	}
	return out;
}

/** Grid lines as polylines: `lines`+1 lines along each parameter. */
function sampleGrid(spec: Extract<ObjectSpec, { kind: "grid" }>): Vec[][] {
	const lines = Math.max(1, Math.round(spec.lines ?? DEFAULT_GRID_LINES));
	const [u0, u1] = spec.u;
	const [v0, v1] = spec.v;
	const p = spec.params ?? {};
	const at = (u: number, v: number): Vec => {
		try {
			const r = spec.map(u, v, p);
			return isVec(r) ? r : [Number.NaN, Number.NaN];
		} catch {
			return [Number.NaN, Number.NaN];
		}
	};
	const out: Vec[][] = [];
	for (let i = 0; i <= lines; i++) {
		const u = u0 + ((u1 - u0) * i) / lines;
		const v = v0 + ((v1 - v0) * i) / lines;
		const alongV: Vec[] = [];
		const alongU: Vec[] = [];
		for (let k = 0; k <= GRID_SAMPLES; k++) {
			alongV.push(at(u, v0 + ((v1 - v0) * k) / GRID_SAMPLES));
			alongU.push(at(u0 + ((u1 - u0) * k) / GRID_SAMPLES, v));
		}
		out.push(alongV, alongU);
	}
	return out;
}

/** Every coordinate an object places on the stage (for range checks). */
function objectPoints(spec: ObjectSpec): Vec[] {
	switch (spec.kind) {
		case "point":
			return [[spec.x, spec.y]];
		case "segment":
		case "arrow":
			return [spec.from, spec.to];
		case "polygon":
			return spec.points;
		case "curve":
			return sampleCurve(spec);
		case "grid":
			return sampleGrid(spec).flat();
		case "label":
			return [spec.at];
	}
}

function shapeProblem(id: string, spec: ObjectSpec): string | null {
	switch (spec.kind) {
		case "point":
			return typeof spec.x === "number" && typeof spec.y === "number" ? null : `point "${id}" needs numeric x and y`;
		case "segment":
		case "arrow":
			return isVec(spec.from) && isVec(spec.to) ? null : `${spec.kind} "${id}" needs from and to as [x, y]`;
		case "polygon":
			return isVecList(spec.points) && spec.points.length >= 3 ? null : `polygon "${id}" needs at least 3 points [x, y]`;
		case "curve":
			return typeof spec.fn === "function" && isVec(spec.domain) ? null : `curve "${id}" needs fn and domain [a, b]`;
		case "grid":
			return typeof spec.map === "function" && isVec(spec.u) && isVec(spec.v)
				? null
				: `grid "${id}" needs map, u [a, b] and v [a, b]`;
		case "label":
			return isVec(spec.at) && typeof spec.text === "string" ? null : `label "${id}" needs at [x, y] and text`;
	}
}

function nonFiniteIn(value: unknown): boolean {
	if (typeof value === "number") return !Number.isFinite(value);
	if (Array.isArray(value)) return value.some(nonFiniteIn);
	if (value && typeof value === "object" && typeof value !== "function") return Object.values(value).some(nonFiniteIn);
	return false;
}

/** All problems with a scene, in English, `step N:` (1-based) where a step is at fault. */
export function validateScene(scene: Scene): string[] {
	const errors: string[] = [];
	const { x, y } = scene.stage ?? ({} as Stage);
	if (!isVec(x) || !isVec(y) || nonFiniteIn([x, y]) || x[0] >= x[1] || y[0] >= y[1]) {
		return ["stage needs x: [min, max] and y: [min, max] with min < max"];
	}
	const steps = Array.isArray(scene.steps) ? scene.steps : [];
	if (steps.length < MIN_STEPS || steps.length > MAX_STEPS) {
		errors.push(`a walkthrough needs 3–12 steps (has ${steps.length})`);
	}
	for (const [id, spec] of Object.entries(scene.objects)) {
		if (!spec || !(spec.kind in KIND_PROPS)) {
			errors.push(`object "${id}" has an unknown kind`);
			continue;
		}
		const problem = shapeProblem(id, spec);
		if (problem) errors.push(problem);
	}
	if (errors.length > 0) return errors;

	const spanX = x[1] - x[0];
	const spanY = y[1] - y[0];
	const inside = ([px, py]: Vec) =>
		px >= x[0] - spanX / 2 && px <= x[1] + spanX / 2 && py >= y[0] - spanY / 2 && py <= y[1] + spanY / 2;

	const state = initialState(scene);
	steps.forEach((step, i) => {
		const tag = `step ${i + 1}:`;
		if (typeof step.caption !== "string" || step.caption.trim().length === 0) errors.push(`${tag} empty caption`);
		for (const id of [...(step.show ?? []), ...(step.hide ?? []), ...Object.keys(step.set ?? {})]) {
			if (!state[id]) errors.push(`${tag} unknown object "${id}"`);
		}
		for (const [id, changes] of Object.entries(step.set ?? {})) {
			const entry = state[id];
			if (!entry) continue;
			for (const [key, value] of Object.entries(changes)) {
				if (!KIND_PROPS[entry.spec.kind].includes(key)) {
					errors.push(`${tag} unknown property "${key}" on ${entry.spec.kind} "${id}"`);
				} else if (nonFiniteIn(value)) {
					errors.push(`${tag} "${id}".${key} is not finite`);
				} else if (
					entry.spec.kind === "polygon" &&
					key === "points" &&
					Array.isArray(value) &&
					value.length !== entry.spec.points.length
				) {
					errors.push(`${tag} polygon "${id}" changes its point count`);
				}
			}
		}
		applyStep(state, step);
		for (const [id, { spec, visible }] of Object.entries(state)) {
			if (!visible) continue;
			const shape = shapeProblem(id, spec);
			if (shape) {
				errors.push(`${tag} ${shape}`);
				continue;
			}
			const points = objectPoints(spec);
			if (points.some((p) => nonFiniteIn(p))) errors.push(`${tag} ${spec.kind} "${id}" is not finite`);
			else if (!points.every(inside)) errors.push(`${tag} ${spec.kind} "${id}" is outside the stage`);
		}
	});
	return errors;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpValue(a: unknown, b: unknown, t: number): unknown {
	if (typeof a === "number" && typeof b === "number") return lerp(a, b, t);
	if (isVec(a) && isVec(b)) return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
	if (isVecList(a) && isVecList(b) && a.length === b.length) return a.map((p, i) => lerpValue(p, b[i], t));
	return b;
}

/** The frame t ∈ [0, 1] of the way from state a to state b. */
export function frameBetween(a: SceneState, b: SceneState, t: number): Record<string, FrameObject> {
	const frame: Record<string, FrameObject> = {};
	for (const id of Object.keys(b)) {
		const from = a[id];
		const to = b[id]!;
		const opacity = lerp(from?.visible ? 1 : 0, to.visible ? 1 : 0, t);
		// An object fading in appears where it ends; one fading out stays where it was.
		if (!from || !from.visible || !to.visible) {
			frame[id] = { spec: (to.visible || !from ? to : from).spec, opacity };
			continue;
		}
		const spec: Record<string, unknown> = { ...to.spec };
		const fromSpec = from.spec as Record<string, unknown>;
		for (const [key, value] of Object.entries(to.spec)) {
			if (key === "params" && value && typeof value === "object") {
				const pa = (fromSpec.params ?? {}) as Params;
				const pb = value as Params;
				spec.params = Object.fromEntries(
					Object.entries(pb).map(([k, v]) => [k, typeof pa[k] === "number" ? lerp(pa[k]!, v, t) : v]),
				);
			} else spec[key] = lerpValue(fromSpec[key], value, t);
		}
		frame[id] = { spec: spec as unknown as ObjectSpec, opacity };
	}
	return frame;
}

export function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

const escapeXml = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => String(Math.round(n * 100) / 100);

/** One frame as a standalone SVG (math coordinates, y up, white background). */
export function renderSvg(stage: Stage, frame: Record<string, FrameObject>, width = 720): string {
	const [x0, x1] = stage.x;
	const [y0, y1] = stage.y;
	const height = Math.round((width * (y1 - y0)) / (x1 - x0));
	const px = (p: Vec): [number, number] => [((p[0] - x0) / (x1 - x0)) * width, height - ((p[1] - y0) / (y1 - y0)) * height];
	const path = (pts: Vec[]) => {
		let d = "";
		let pen = false;
		for (const p of pts) {
			if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
				pen = false;
				continue;
			}
			const [sx, sy] = px(p);
			d += `${pen ? "L" : "M"}${num(sx)} ${num(sy)} `;
			pen = true;
		}
		return d.trim();
	};
	const parts: string[] = [`<rect width="${width}" height="${height}" fill="#ffffff"/>`];
	for (const { spec, opacity } of Object.values(frame)) {
		if (opacity <= 0) continue;
		const color = PALETTE[spec.color ?? "black"] ?? PALETTE.black;
		const op = `opacity="${num(opacity)}"`;
		switch (spec.kind) {
			case "point": {
				const [cx, cy] = px([spec.x, spec.y]);
				parts.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="5" fill="${color}" ${op}/>`);
				if (spec.label)
					parts.push(
						`<text x="${num(cx + 8)}" y="${num(cy - 8)}" font-family="sans-serif" font-size="16" fill="${color}" ${op}>${escapeXml(spec.label)}</text>`,
					);
				break;
			}
			case "segment": {
				const [ax, ay] = px(spec.from);
				const [bx, by] = px(spec.to);
				const dash = spec.dashed ? ` stroke-dasharray="6 5"` : "";
				parts.push(
					`<line x1="${num(ax)}" y1="${num(ay)}" x2="${num(bx)}" y2="${num(by)}" stroke="${color}" stroke-width="2.5"${dash} ${op}/>`,
				);
				break;
			}
			case "arrow": {
				const [ax, ay] = px(spec.from);
				const [bx, by] = px(spec.to);
				const len = Math.hypot(bx - ax, by - ay) || 1;
				const ux = (bx - ax) / len;
				const uy = (by - ay) / len;
				const head = Math.min(12, len / 2);
				const baseX = bx - ux * head;
				const baseY = by - uy * head;
				parts.push(
					`<line x1="${num(ax)}" y1="${num(ay)}" x2="${num(baseX)}" y2="${num(baseY)}" stroke="${color}" stroke-width="2.5" ${op}/>`,
					`<polygon points="${num(bx)},${num(by)} ${num(baseX - uy * head * 0.5)},${num(baseY + ux * head * 0.5)} ${num(baseX + uy * head * 0.5)},${num(baseY - ux * head * 0.5)}" fill="${color}" ${op}/>`,
				);
				break;
			}
			case "polygon": {
				const pts = spec.points.map((p) => px(p).map(num).join(",")).join(" ");
				const fill = spec.fill ? `fill="${color}" fill-opacity="0.15"` : `fill="none"`;
				parts.push(`<polygon points="${pts}" ${fill} stroke="${color}" stroke-width="2.5" ${op}/>`);
				break;
			}
			case "curve":
				parts.push(`<path d="${path(sampleCurve(spec))}" fill="none" stroke="${color}" stroke-width="2.5" ${op}/>`);
				break;
			case "grid":
				for (const line of sampleGrid(spec))
					parts.push(`<path d="${path(line)}" fill="none" stroke="${color}" stroke-width="1.2" ${op}/>`);
				break;
			case "label": {
				const [lx, ly] = px(spec.at);
				parts.push(
					`<text x="${num(lx)}" y="${num(ly)}" font-family="sans-serif" font-size="${spec.size ?? 16}" fill="${color}" text-anchor="middle" dominant-baseline="middle" ${op}>${escapeXml(spec.text)}</text>`,
				);
				break;
			}
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join("")}</svg>`;
}

/** The settled SVG of step n (0-based) — what a learner sees after the tween. */
export function svgAtStep(scene: Scene, step: number, width = 720): string {
	const s = stateAt(scene, step);
	return renderSvg(scene.stage, frameBetween(s, s, 1), width);
}
