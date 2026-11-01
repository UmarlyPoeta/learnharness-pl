import { deleteBoard, readBoard, saveBoard } from "@/src/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function guard<T>(fn: () => T): T | Response {
	try {
		return fn();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return Response.json({ error: msg }, { status: msg === "board not found" ? 404 : 400 });
	}
}

export async function GET(_req: Request, { params }: Ctx) {
	const { id } = await params;
	const out = guard(() => readBoard(id));
	if (out instanceof Response) return out;
	return out ? Response.json(out) : Response.json({ error: "board not found" }, { status: 404 });
}

export async function PUT(request: Request, { params }: Ctx) {
	const { id } = await params;
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	const patch: Parameters<typeof saveBoard>[1] = {};
	if (typeof body.title === "string") patch.title = body.title;
	if (Array.isArray(body.elements)) patch.elements = body.elements;
	if (body.appState && typeof body.appState === "object") patch.appState = body.appState as Record<string, unknown>;
	if (body.files && typeof body.files === "object") patch.files = body.files as Record<string, unknown>;
	const out = guard(() => saveBoard(id, patch));
	if (out instanceof Response) return out;
	return Response.json({ id: out.id, title: out.title, updatedAt: out.updatedAt });
}

export async function DELETE(_req: Request, { params }: Ctx) {
	const { id } = await params;
	const out = guard(() => deleteBoard(id));
	if (out instanceof Response) return out;
	return Response.json({ ok: out });
}
