import { WALKTHROUGH_RUNTIME_JS } from "./runtime-bundle.ts";

/** Keep a script's text from closing its own <script> tag. */
const escapeScript = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1");

/** The complete walkthrough document: engine runtime + the scene script,
 *  whose load-time errors are reported through LH.__fail. */
export function buildWalkthroughHtml(script: string): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#ffffff}#lh-stage svg{width:100%;height:auto;display:block}</style>
</head><body><div id="lh-stage"></div>
<script>${escapeScript(WALKTHROUGH_RUNTIME_JS)}</script>
<script>try {
${escapeScript(script)}
} catch (e) { window.LH.__fail(e); }</script>
</body></html>`;
}
