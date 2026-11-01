import { createBoard, listBoards } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	return Response.json({ boards: listBoards() });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { title?: unknown };
	const board = createBoard(typeof body.title === "string" ? body.title : "");
	return Response.json(board);
}
