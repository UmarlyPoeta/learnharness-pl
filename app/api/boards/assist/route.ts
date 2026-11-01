import { boardAssist, BoardAssistError, type AssistMode } from "@/src/server";

export const dynamic = "force-dynamic";

const MODES: AssistMode[] = ["ask", "improve", "kanban", "tidy"];

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const mode = body?.mode as AssistMode;
	if (!body || !MODES.includes(mode)) return Response.json({ error: "Nieznany tryb" }, { status: 400 });
	try {
		const out = await boardAssist(
			{
				mode,
				content: typeof body.content === "string" ? body.content : "",
				question: typeof body.question === "string" ? body.question : undefined,
				image: typeof body.image === "string" ? body.image : undefined,
			},
			request.signal,
		);
		return Response.json(out);
	} catch (err) {
		if (err instanceof BoardAssistError) return Response.json({ error: err.message }, { status: err.status });
		const msg = err instanceof Error ? err.message : String(err);
		return Response.json({ error: msg }, { status: 502 });
	}
}
