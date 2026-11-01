import { deleteSources, readOrganizationAction, sourceDirectory, SourceDeletionError, SourceOrganizationInputError } from "@/src/server";
import { emit } from "@/src/core";

export const dynamic = "force-dynamic";

export async function GET() {
	try { return Response.json(sourceDirectory.read()); }
	catch { return Response.json({ error: "Nie udało się wczytać organizacji źródeł." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
	try { return Response.json(deleteSources(await readOrganizationAction(request))); }
	catch (error) {
		if (error instanceof SourceDeletionError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
		if (error instanceof SourceOrganizationInputError) return Response.json({ error: error.message }, { status: 400 });
		return Response.json({ error: "Nie udało się dokończyć usuwania źródeł. Część wpisów mogła już zostać usunięta; odśwież albo spróbuj ponownie." }, { status: 500 });
	} finally {
		emit("sources-changed", {}); emit("chats-changed", {}); emit("activity-changed", {});
	}
}

export async function POST(request: Request) {
	try { return Response.json(sourceDirectory.change(await readOrganizationAction(request))); }
	catch (error) {
		const input = error instanceof SourceOrganizationInputError;
		return Response.json({ error: input ? error.message : "Nie udało się zapisać organizacji źródeł." }, { status: input ? 400 : 500 });
	}
}
