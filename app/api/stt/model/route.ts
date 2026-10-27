/**
 * The dictation model download (release wave, 2026-10-27): GET is the
 * Settings row's status (missing / downloading with progress / ready /
 * error); POST starts the one download, 409 while one already runs.
 */
import { modelDownloader } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(modelDownloader().status());
}

export async function POST() {
	const downloader = modelDownloader();
	if (!downloader.start()) return Response.json({ message: "already-downloading" }, { status: 409 });
	return Response.json(downloader.status(), { status: 202 });
}
