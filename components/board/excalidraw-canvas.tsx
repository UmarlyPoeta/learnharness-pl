"use client";

// Loaded only through next/dynamic with ssr:false (Excalidraw touches
// window at import time).
// Fonts: the Latin families ship in public/excalidraw (offline desktop);
// anything missing there (CJK Xiaolai) falls through to the CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string[] }).EXCALIDRAW_ASSET_PATH = [
	"/excalidraw/",
	"https://unpkg.com/@excalidraw/excalidraw@0.18.1/dist/prod/",
];
import { Excalidraw, MainMenu, convertToExcalidrawElements, exportToBlob, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type { ExcalidrawImperativeAPI };
export { convertToExcalidrawElements, exportToBlob, CaptureUpdateAction };

export interface CanvasProps {
	initialData: { elements: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
	onApi: (api: ExcalidrawImperativeAPI) => void;
	onChange: (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;
}

export default function ExcalidrawCanvas({ initialData, onApi, onChange }: CanvasProps) {
	return (
		<Excalidraw
			excalidrawAPI={onApi}
			initialData={{
				elements: initialData.elements as never,
				appState: { ...(initialData.appState ?? {}), theme: "dark", collaborators: new Map() } as never,
				files: (initialData.files ?? {}) as never,
				scrollToContent: true,
			}}
			theme="dark"
			langCode="pl-PL"
			onChange={(els, state, files) => onChange(els, state as unknown as Record<string, unknown>, files as unknown as Record<string, unknown>)}
			UIOptions={{ canvasActions: { loadScene: true, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
		>
			<MainMenu>
				<MainMenu.DefaultItems.LoadScene />
				<MainMenu.DefaultItems.Export />
				<MainMenu.DefaultItems.SaveAsImage />
				<MainMenu.DefaultItems.SearchMenu />
				<MainMenu.DefaultItems.Help />
				<MainMenu.DefaultItems.ClearCanvas />
				<MainMenu.Separator />
				<MainMenu.DefaultItems.ChangeCanvasBackground />
			</MainMenu>
		</Excalidraw>
	);
}
