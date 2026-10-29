# Wyjaśnienia obrazowe — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animowane wyprowadzenia krok po kroku (`walkthrough`) jako karta w czacie, reguła „grafika na węzeł” z mechanicznym przypomnieniem i przycisk „Pokaż”.

**Architecture:** Czysty silnik scen w TS (`src/core/walkthrough/engine.ts`: stan kroku, walidacja, interpolacja, render SVG) + wejście przeglądarkowe (`window.LH`) zbundlowane esbuildem do stałej `WALKTHROUGH_RUNTIME_JS`, wstrzykiwanej do iframe. Podagent `walkthrough-builder` (pętla jak `visual-maker`, obrazy w pętli) pisze tylko skrypt sceny; `run_scene`/`look_step` używają istniejących `headless.runDemo` (sonda zwraca JSON / SVG kroku) i `headless.renderSvg`. Nowy rodzaj zadania `walkthrough` w istniejącym pipeline zadań w tle; karta w `steer-card`.

**Tech Stack:** TypeScript, React (Next 16), typebox, node:test przez `bash scripts/test-isolated.sh`, linkedom, esbuild 0.28 (tranzytywny, tylko skrypt generujący), puppeteer-core (istniejący headless), resvg (istniejący).

**Spec:** `docs/superpowers/specs/2026-10-29-wyjasnienia-obrazowe-design.md`

**Odstępstwa od specu (świadome):**
- Spec przewidywał nową metodę zrzutu w `headless.ts`; plan jej nie dodaje — silnik zwraca SVG kroku (`LH.__svgAt`), który istniejący `renderSvg` rasteryzuje. Mniej kodu, ten sam efekt.
- Prośba „Pokaż” bez pytajnika: `Pokaż „<fragment>”` (spec: `Pokaż „<fragment>”?`) — to polecenie, nie pytanie.
- Dodatkowe zadanie 1: poprawka z podprojektu 1 — `compactAnswerForModel` gubi notatkę pominięcia (`Nie rozumiem: …`), więc model jej nie widzi; „Pokaż” korzysta z tej samej ścieżki.

## Global Constraints

- Nazwy: narzędzie i rodzaj zadania `walkthrough`; rola modelu `walkthroughBuilder` → slot **vision**; podagent `src/agent/subagents/walkthrough-builder.ts`.
- Liczba kroków **3–12**; każdy krok ma niepusty `caption` (markdown + `$…$`).
- Paleta (dokładnie): `blue #2563eb`, `red #dc2626`, `green #16a34a`, `orange #ea580c`, `purple #7c3aed`, `gray #6b7280`, `black #111827`.
- Przejście do sąsiedniego kroku: tween **600 ms**, easeInOutCubic; skok o >1 krok — natychmiast.
- „Daleko poza sceną” = współrzędna poza zakresem sceny rozszerzonym o 50% rozpiętości z każdej strony.
- Brama ukończenia podagenta: czyste ostatnie `run_scene` na bieżącym skrypcie **i** obejrzane kroki: pierwszy, ostatni i co najmniej jeden środkowy (dla bieżącego skryptu).
- Teksty UI (dokładnie): nagłówek karty `animowane wyjaśnienie`; przyciski `aria-label` „Poprzedni krok” / „Następny krok” / „Od początku” / „Powiększ”; licznik `3/8`; etykieta aktywności `Buduję animację…`; etykieta doku `Generator animacji`; porażka `Nie udało się zbudować animacji.`; przycisk zaznaczenia `Pokaż`.
- Prośba „Pokaż”: `Pokaż „<fragment>”`; notatka pominięcia: `Chcę zobaczyć: „<fragment>”`.
- Przypomnienie (dokładny tekst w wyniku odpowiedzi): `Reminder: plan node "<nodeId>" has no graphic yet — dispatch a walkthrough, demo or visual for it (with nodeId) now.`
- Nie tłumaczyć etykiet `Toggle` (`data-testid`). Testy przez `bash scripts/test-isolated.sh`.
- Prompty po angielsku, zwarte akapity.

## Review Focus

- Skrypt sceny rzuca wyjątek przy ładowaniu (literówka w API) → `run_scene` raportuje błąd z komunikatem, karta nigdy nie dostaje takiej animacji. Test: Task 3 (`__check` przy wyjątku skryptu) + Task 5.
- Funkcja `curve`/`grid` zwraca NaN dla części dziedziny (np. `Math.sqrt` ujemnej) → walidacja zgłasza błąd z numerem kroku, nie biały ekran. Test: Task 2.
- `polygon` zmienia liczbę wierzchołków między krokami → błąd walidacji (interpolacja niemożliwa). Test: Task 2.
- Klik ◀ na kroku 1 / ▶ na ostatnim → nic się nie dzieje, licznik bez zmian. Test: Task 6.
- Stara sesja z zapisem zadań bez `walkthrough` / quiz bez `nodeId` → wszystko działa jak dotąd (pola opcjonalne, brak przypomnienia dla quizów bez `nodeId`). Test: Task 7.

---

### Task 1: Notatka pominięcia dociera do modelu (poprawka z podprojektu 1)

**Files:**
- Modify: `src/core/question-core.ts:779-780` (`compactAnswerForModel`)
- Test: `tests/question-core.test.ts`

**Interfaces:**
- Produces: dla `dismissed` wynik `{ kind, dismissed: true, thinkingWhileReading? }`.

- [ ] **Step 1: Failing test** — `compactAnswerForModel({...dismissedAnswer("quiz","Q?"), readingThinking: "Nie rozumiem: „x”"})` deepEquals `{ kind: "quiz", dismissed: true, thinkingWhileReading: "Nie rozumiem: „x”" }`; bez `readingThinking` → `{ kind: "quiz", dismissed: true }`.
- [ ] **Step 2:** Run `bash scripts/test-isolated.sh tests/question-core.test.ts` — FAIL.
- [ ] **Step 3:** W gałęzi `dismissed` dołącz `thinkingWhileReading`, gdy `ad.readingThinking` niepusty.
- [ ] **Step 4:** Run jak wyżej + `tests/dismissal-park.test.ts tests/chat-flow.test.ts` — PASS.
- [ ] **Step 5:** Commit `fix(question): keep the reading note on a dismissed check`.

---

### Task 2: Silnik scen (czysty)

**Files:**
- Create: `src/core/walkthrough/engine.ts`
- Test: `tests/walkthrough-engine.test.ts`

**Interfaces:**
- Produces (eksporty):
  - `type Vec = [number, number]`; `type Params = Record<string, number>`; `type ColorName = "blue"|"red"|"green"|"orange"|"purple"|"gray"|"black"`; `const PALETTE: Record<ColorName, string>` (wartości z Global Constraints).
  - `type ObjectSpec` — unia po `kind`:
    `point {x,y,label?,color?}`, `segment {from,to,color?,dashed?}`, `arrow {from,to,color?}`, `polygon {points: Vec[], color?, fill?}`, `curve {fn:(x,p)=>number, params?, domain: Vec, color?}`, `grid {map:(u,v,p)=>Vec, params?, u: Vec, v: Vec, lines?: number (domyślnie 8), color?}`, `label {at: Vec, text, color?, size?}`.
  - `interface StepSpec { caption: string; show?: string[]; hide?: string[]; set?: Record<string, Record<string, unknown>> }` (`set` dla `params` łączy klucze, nie zastępuje).
  - `interface Scene { stage: { x: Vec; y: Vec }; objects: Record<string, ObjectSpec>; steps: StepSpec[] }`
  - `type SceneState = Record<string, { spec: ObjectSpec; visible: boolean }>` — obiekty domyślnie niewidoczne.
  - `validateScene(scene: Scene): string[]` — komunikaty po angielsku, z prefiksem `step N:` (1-based) tam, gdzie dotyczą kroku.
  - `stateAt(scene: Scene, step: number): SceneState` (0-based; stan kumulatywny kroków 0..step).
  - `interface FrameObject { spec: ObjectSpec; opacity: number }`; `frameBetween(a: SceneState, b: SceneState, t: number): Record<string, FrameObject>` — liczby, `Vec`, tablice `Vec` o równej długości i wartości `params` interpolowane liniowo; widoczność → opacity 0..1; reszta (tekst, kolor, fn) z `b`.
  - `renderSvg(stage, frame, width = 720): string` — `<svg xmlns=… viewBox="0 0 W H">`, H z proporcji zakresów, oś y w górę, białe tło, krzywe/siatki próbkowane (krzywa 200 próbek; siatka `lines` linii w każdym kierunku × 40 próbek), etykiety jako `<text>` (font-family sans-serif, escapowane).
  - `easeInOutCubic(t: number): number`.

- [ ] **Step 1: Failing testy:**
  - `validateScene`: poprawna scena 3 kroki → `[]`; 2 kroki i 13 kroków → błąd z `3–12`; pusty caption → `step 2: empty caption`; `show: ["X"]` nieznane → `step 1: unknown object "X"`; `set` z NaN → błąd zawierający `not finite`; punkt `x: 100` przy scenie `[-2,2]` → `outside the stage`; `curve` z `fn: x => Math.sqrt(x)` na `[-1,1]` → `step N: curve "f" is not finite`; polygon zmieniający liczbę punktów w `set` → `changes its point count`; `set` z kluczem spoza rodzaju (np. `radius` dla point) → `unknown property`.
  - `stateAt`: `stateAt(s,2)` równa się stanowi uzyskanemu przez stosowanie kroków 0,1,2 po kolei; obiekt z `hide` w kroku 2 ma `visible:false`; `params` łączone.
  - `frameBetween(a,b,0.5)`: punkt w połowie drogi; obiekt pojawiający się → opacity 0.5.
  - `renderSvg`: zawiera `viewBox="0 0 720 `, punkt `(0,0)` na scenie `x:[-2,2], y:[-1,1]` w pikselach `(360, 180)`; etykieta `<b>` escapowana do `&lt;b&gt;`; niewidoczny obiekt (opacity 0) nie jest rysowany.
  - `easeInOutCubic(0)=0, (1)=1, (0.5)=0.5`.
- [ ] **Step 2:** Run `bash scripts/test-isolated.sh tests/walkthrough-engine.test.ts` — FAIL.
- [ ] **Step 3:** Implementacja `src/core/walkthrough/engine.ts` (bez DOM, bez importów z aplikacji).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(walkthrough): pure scene engine`.

---

### Task 3: Runtime przeglądarkowy, bundle, dokument HTML

**Files:**
- Create: `src/core/walkthrough/runtime-entry.ts` (wejście przeglądarkowe)
- Create: `scripts/build-walkthrough-runtime.mjs`
- Create (generowany, commitowany): `src/core/walkthrough/runtime-bundle.ts` — `export const WALKTHROUGH_RUNTIME_JS: string`
- Create: `src/core/walkthrough/html.ts`
- Modify: `package.json` — skrypt `"build:walkthrough": "node scripts/build-walkthrough-runtime.mjs"`
- Test: `tests/walkthrough-runtime.test.ts`

**Interfaces:**
- Consumes: Task 2 (wszystkie eksporty).
- Produces:
  - `window.LH` w iframe: `LH.stage({x, y})` zwraca budowniczego z metodami `point/segment/arrow/polygon/curve/grid/label(id, props)` (zwracają budowniczego); `LH.steps(list)` — waliduje, renderuje krok 0 do `#lh-stage`, wysyła do rodzica `{type:"walkthrough-ready", steps, captions}` albo `{type:"walkthrough-error", message}`; nasłuch `message` `{type:"walkthrough-goto", step}` (0-based) → animacja wg Global Constraints → `{type:"walkthrough-step", step}`; `LH.__check()` → `{ ok: boolean, errors: string[], steps: number, captions: string[] }` (jeśli `steps()` nie wywołano: `ok:false, errors:["LH.steps() was never called"]`; jeśli skrypt rzucił — błąd z komunikatem wyjątku); `LH.__svgAt(n)` → SVG kroku n (0-based) bez animacji.
  - `buildWalkthroughHtml(script: string): string` — `<!doctype html>`, `<meta charset="utf-8">`, styl (margin 0, białe tło, `#lh-stage svg {width:100%;height:auto;display:block}`), `<div id="lh-stage">`, `<script>${WALKTHROUGH_RUNTIME_JS}</script>`, skrypt użytkownika w `try { … } catch (e) { LH.__fail(e) }` (`__fail` zapisuje błąd dla `__check` i wysyła `walkthrough-error`). Treść skryptu escapowana tak, by `</script>` nie zamknął tagu (`<\/script>`).
  - `scripts/build-walkthrough-runtime.mjs` eksportuje `buildRuntimeSource(): Promise<string>` (esbuild: `bundle: true, format: "iife", minify: true, target: "es2019", write: false`) i przy uruchomieniu bezpośrednim zapisuje `runtime-bundle.ts` z nagłówkiem `// GENERATED by scripts/build-walkthrough-runtime.mjs — do not edit`.

- [ ] **Step 1: Failing testy:**
  - aktualność: `await buildRuntimeSource()` === `WALKTHROUGH_RUNTIME_JS` (dynamiczny import skryptu .mjs).
  - wykonanie runtime'u w `linkedom` (`new Function("window","document", WALKTHROUGH_RUNTIME_JS + script)` z oknem linkedom, `parent.postMessage` przechwycone): poprawna scena 3 kroki → `LH.__check()` = `{ok:true, steps:3, captions:[…3]}` i wysłane `walkthrough-ready`; skrypt odwołujący się do `LH.stage(...).circle(...)` (nie istnieje) uruchomiony przez ścieżkę `buildWalkthroughHtml` (wycięty skrypt wykonany z owijką try/catch) → `__check().ok === false` i błąd zawiera `circle`; `__svgAt(1)` zaczyna się od `<svg`.
  - `buildWalkthroughHtml("x='</script>'")` nie zawiera literalnie drugiego `</script>` przed końcem skryptu użytkownika.
- [ ] **Step 2:** Run `bash scripts/test-isolated.sh tests/walkthrough-runtime.test.ts` — FAIL.
- [ ] **Step 3:** Implementacja; `npm run build:walkthrough` generuje bundle.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(walkthrough): browser runtime and document builder`.

---

### Task 4: Kontrakty, rola, narzędzie `walkthrough`, `nodeId` na narzędziach grafik

**Files:**
- Modify: `src/core/contracts/jobs.ts` (`JobKind`, `WalkthroughResult`, unie wyników w `SubagentArtifactData`/`SteerDetails`/`isSubagentFailure`/`steerText`/`buildSubagentSteer`, `setSteerUiInverted`)
- Modify: `app/api/chats/[id]/artifact-ui/route.ts:34` (dopuszcza `walkthrough`)
- Modify: `config.ts` (`ModelRole` + `"walkthroughBuilder"`), `src/core/settings.ts` (`BACKGROUND_MODEL_ROLES`, `ROLE_SLOT.walkthroughBuilder = "vision"`)
- Modify: `src/core/pending.ts` (`JOB_TOOLS`, `TOGGLEABLE_TOOLS`, `ACTIVITY_LABELS.walkthrough = "Buduję animację…"`)
- Modify: `components/settings/agent-section.tsx:91` (`TOGGLE_TOOLS`), `components/activity-dock.tsx` (`KIND_ICON.walkthrough = FilmIcon`, etykieta `Generator animacji`)
- Modify: `src/agent/tools/jobs.ts` (schemat + narzędzie `walkthrough`; opcjonalne `nodeId` w `demo`/`visual`/`walkthrough`; `JobToolContext.nodeIdProblem?`), `src/agent/tools.ts` (`createTeacherTools` przekazuje `nodeIdProblem: (id) => nodeIdProblem(ctx, id)`; prober bez zmian)
- Modify: testy z listami: `tests/question-tools.test.ts`, `tests/model-catalog.test.ts`, `tests/settings*.test.ts` (tam, gdzie przypinają zestawy ról/narzędzi)
- Test: `tests/walkthrough-tool.test.ts`

**Interfaces:**
- Produces:
  - `interface WalkthroughResult { title: string; html: string; captions: string[]; tested: true; notes?: string }`
  - `walkthroughInputSchema = Type.Object({ title, brief, nodeId: Type.Optional(Type.String()) })`; `type WalkthroughInput`.
  - Ack: `WALKTHROUGH_ACK` = „fire-and-forget … The tested walkthrough arrives as a new message when ready and is rendered in the lesson; teach with it then — point at its steps by number.”
  - `steerText("walkthrough", ok)` = `The animated walkthrough "<title>" (<n> steps) is built, tested step by step and rendered in the lesson. Builder notes: <notes>.\nSteps:\n1. <caption>\n…\nTeach with it — point the learner at specific steps by number.`; porażka: `The walkthrough "<title>" could not be built: <notes>. Fall back to prose, a visual or a demo; if the brief was the problem, re-call walkthrough with a tighter one.`
  - `isSubagentFailure("walkthrough", r)` ⇔ `html` pusty.
  - Narzędzie z `nodeId`, który nie pasuje do planu → zwraca tekst błędu z `nodeIdProblem` i **nie** tworzy zadania; bez `nodeId` → bez walidacji.

- [ ] **Step 1: Failing testy** (`tests/walkthrough-tool.test.ts`): teacher ma `walkthrough`, prober nie; `{walkthrough:false}` usuwa tylko je; wywołanie z poprawnym wejściem tworzy zadanie `kind:"walkthrough"` i woła `spawn`; `nodeId` nieznany przy istniejącym planie → brak zadania, tekst zawiera `matches no node`; `demo` z `nodeId` przechodzi walidację tak samo; `isSubagentFailure`/`buildSubagentSteer` dla sukcesu (zawiera `Steps:\n1. ` i `(3 steps)`) i porażki; `toolActivityLabel("walkthrough")`; `ROLE_SLOT.walkthroughBuilder === "vision"`; `BACKGROUND_MODEL_ROLES` zawiera `walkthroughBuilder`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implementacja; zaktualizuj przypięte listy w istniejących testach.
- [ ] **Step 4:** Run `bash scripts/test-isolated.sh tests/walkthrough-tool.test.ts tests/question-tools.test.ts tests/model-catalog.test.ts tests/settings-resolution.test.ts tests/settings.test.ts tests/settings-body.test.ts tests/jobs.test.ts tests/chat-flow.test.ts` + `npx tsc --noEmit` — PASS.
- [ ] **Step 5:** Commit `feat(walkthrough): job kind, tool and nodeId on graphic tools`.

---

### Task 5: Podagent `walkthrough-builder` + runner

**Files:**
- Create: `src/agent/subagents/walkthrough-builder.ts`
- Modify: `src/agent/subagents/runner.ts` (`KIND_ROLE.walkthrough = "walkthroughBuilder"`, `walkthroughModelOverride`, `KIND_RUNNERS.walkthrough`, kształt porażki, `runWalkthroughJob` jak `runVisualJob`)
- Test: `tests/walkthrough-builder.test.ts`

**Interfaces:**
- Consumes: `buildWalkthroughHtml` (Task 3), `WalkthroughResult` (Task 4), `HeadlessApi.runDemo/renderSvg/unavailableReason`, wzorzec pętli `streamOnce`/`toolText` z `visual-maker.ts` (skopiuj lokalnie albo wydziel wspólny helper — wybór wykonawcy, bez zmiany zachowania visual-makera).
- Produces:
  - `runWalkthroughBuilder(input: { title: string; brief: string }, opts?: { engine?: PiEngine; headless?: HeadlessApi; maxIterations?: number (domyślnie 16); onActivity?; abortSignal?; chatId? }): Promise<WalkthroughResult>`
  - Narzędzia modelu (bez `execute`, pętla wykonuje sama): `write_scene { script }`, `edit_scene { old_text, new_text }` (dokładnie jedno wystąpienie), `run_scene {}`, `look_step { step: integer ≥ 1 }`.
  - `run_scene` → `headless.runDemo(buildWalkthroughHtml(script), { probe: "JSON.stringify(window.LH && window.LH.__check ? window.LH.__check() : {ok:false,errors:['runtime missing'],steps:0,captions:[]})" })`; wynik dla modelu: `PASSED: <n> steps.` + lista podpisów, albo `FAILED:` + błędy JS/walidacji.
  - `look_step(n)` → `runDemo` z sondą `window.LH.__svgAt(n-1)` → `headless.renderSvg(svg)` → wiadomość z obrazem (jak `visual-maker`).
  - Brama (Global Constraints): przy próbie zakończenia bez czystego `run_scene` na bieżącym skrypcie → wiadomość `Run run_scene on your current script before finishing.`; bez wymaganych obejrzeń → pętla sama renderuje brakujące kroki, pokazuje je i prosi o potwierdzenie lub poprawki (jak `UNLOOKED_FINISH_MESSAGE`). Wyczerpanie iteracji → `{ title, html: "", captions: [], tested: true, notes: "FAILED: <powód>" }`.
  - Sukces: `{ title, html: buildWalkthroughHtml(script), captions (z ostatniego __check), tested: true, notes: <ostatni tekst modelu> }`.
  - Instrukcje (stała `INSTRUCTIONS`, po angielsku): pełne API `LH` z Task 3 z jednym przykładem sceny (jakobian elementu: kwadrat odniesienia → odwzorowana siatka), zasady: jedna idea, 3–12 kroków, jeden podpis = jedno zdanie, współrzędne matematyczne, etykiety Unicode, **wszystkie teksty widoczne dla ucznia po polsku**, „never deliver unlooked”.

- [ ] **Step 1: Failing testy** (faux engine jak w `tests/jobs.test.ts`/visual-maker tests; fałszywy `HeadlessApi`):
  - sukces: write → run (PASSED) → look 1, 2, 3 → koniec → `html` niepusty, `captions.length === 3`.
  - koniec bez `run_scene` → pętla wysyła wiadomość z `Run run_scene` i nie kończy.
  - koniec po `run_scene`, ale bez obejrzeń → fałszywy headless dostaje `renderSvg` dla brakujących kroków (1 i ostatni + środkowy), model widzi obraz.
  - `edit_scene` po obejrzeniu unieważnia obejrzenia i czysty run.
  - wyczerpanie iteracji → `notes` zaczyna się od `FAILED:`, `html === ""`.
  - `headless.unavailableReason()` niepuste → natychmiastowe `FAILED`.
  - runner: zadanie `walkthrough` kończy się steerem z `kind:"walkthrough"` (wzorzec z `tests/jobs.test.ts`).
- [ ] **Step 2:** Run `bash scripts/test-isolated.sh tests/walkthrough-builder.test.ts` — FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** Run + `tests/jobs.test.ts tests/job-delivery-recovery.test.ts` — PASS.
- [ ] **Step 5:** Commit `feat(walkthrough): builder sub-agent with step checks and looks`.

---

### Task 6: Karta animacji w czacie

**Files:**
- Create: `components/artifacts/walkthrough-card.tsx`
- Modify: `components/artifacts/index.ts` (`walkthrough: WalkthroughDispatchCard` — `DispatchCard kind="walkthrough"`), `components/artifacts/steer-card.tsx` (`case "walkthrough"`), `components/artifacts/dispatch-card.tsx` jeśli typ `kind` jest zamknięty
- Test: `tests/walkthrough-card.test.tsx`

**Interfaces:**
- Consumes: `WalkthroughResult`, `buildDemoSrcDoc` (most wysokości z `demo-card.tsx`), `MessageResponse` (render podpisu), `Toggle` + odwracanie kolorów jak w `DemoFrame`, `downloadFile`/`slugFilename`.
- Produces:
  - `nextStep(current: number, total: number, dir: 1 | -1): number` — granice bez zawijania.
  - `WalkthroughView({ result, step, onStep, expanded, onExpand })` — czysty widok (testowalny statycznie): nagłówek `animowane wyjaśnienie` + tytuł, iframe (`sandbox="allow-scripts"`, `srcDoc`), podpis `captions[step]` przez `MessageResponse`, licznik `${step+1}/${total}`, przyciski z `aria-label` z Global Constraints, `disabled` na granicach.
  - `WalkthroughOutputCard({ output, messageId, initialInverted })` — stan kroku; przy zmianie wysyła do iframe `postMessage({type:"walkthrough-goto", step}, "*")`; ←/→ gdy karta (`tabIndex=0`) ma fokus; „Powiększ” = nakładka `fixed inset-4 z-50` z tym samym widokiem (Esc zamyka); porażka (`html===""`) → `Nie udało się zbudować animacji.` + `notes`.

- [ ] **Step 1: Failing testy:** `nextStep(0,5,-1)===0`, `nextStep(4,5,1)===4`, `nextStep(2,5,1)===3`; statyczny render widoku: zawiera nagłówek, tytuł, `1/3`, pierwszy podpis z KaTeX (`class="katex"` dla `$x^2$`), `sandbox="allow-scripts"`, przycisk „Poprzedni krok” `disabled` na kroku 0; porażka → tekst porażki; `steer-card` z `kind:"walkthrough"` renderuje kartę (`data-testid="walkthrough-card"`).
- [ ] **Step 2:** Run `bash scripts/test-isolated.sh tests/walkthrough-card.test.tsx` — FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** Run + `tests/render-cards.test.tsx tests/demos.test.tsx tests/artifact-ui.test.ts` — PASS.
- [ ] **Step 5:** Commit `feat(ui): walkthrough card with step controls`.

---

### Task 7: Przypomnienie „węzeł bez grafiki”

**Files:**
- Create: `src/core/graphic-reminder.ts`
- Modify: `src/core/native-messages.ts` (`newAnswerResult(toolCallId, toolName, answer, reminder?: string)` — przypomnienie jako druga część `content` typu text), `src/core/input-events.ts` (gałąź `answer`)
- Test: `tests/graphic-reminder.test.ts`

**Interfaces:**
- Produces:
  - `GRAPHIC_TOOLS = ["walkthrough", "demo", "visual"] as const`
  - `graphicReminder(messages: readonly LhMessage[], pending: { tool: string; input: unknown }): string | null` — `null`, gdy narzędzie nie jest `quiz`/`explain`, gdy `input.type !== "check"`, gdy brak `nodeId`, albo gdy którekolwiek wcześniejsze wywołanie `GRAPHIC_TOOLS` w `messages` ma `arguments.nodeId === nodeId`; inaczej dokładny tekst z Global Constraints.
  - `inputAppends` (answer): `newAnswerResult(id, pending.tool, input.answer, graphicReminder(record.messages, pending) ?? undefined)`.

- [ ] **Step 1: Failing testy:** check z `nodeId:"jakobian"` bez grafik → tekst; z wcześniejszym `walkthrough {nodeId:"jakobian"}` → `null`; z grafiką dla innego węzła → tekst; `type:"predict"` → `null`; quiz bez `nodeId` (stary zapis) → `null`; `probe` → `null`; `inputAppends` dla odpowiedzi: wynik ma dwa bloki tekstu, drugi = przypomnienie; bez przypomnienia — jeden blok (jak dotąd).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** Run + `tests/chat-flow.test.ts tests/compaction-native-parity.test.ts tests/session-core.test.ts tests/golden-fixtures.test.ts` — PASS.
- [ ] **Step 5:** Commit `feat(teacher): remind about plan nodes without a graphic`.

---

### Task 8: Doktryna grafik i „Pokaż”

**Files:**
- Modify: `src/agent/prompts/teacher/50-demos.md` (przepisany nagłówek i sekcja wyboru formy + reguła węzła; sekcja async bez zmian w treści poza dodaniem `walkthrough`)
- Modify: `src/agent/prompts/teacher/20-teaching.md` (sekcja `## "Pokaż" requests`)
- Test: `tests/od-korzeni-prompts.test.ts` → nowy `describe("wyjaśnienia obrazowe")` (ten sam plik testów doktryny)

- [ ] **Step 1: Failing testy** — `composeInstructions("teacher")`: zawiera `### \`walkthrough\` — animated derivations`, `Every plan node gets at least one graphic`, `mermaid does not count`, `at the start of the node`, `with its \`nodeId\``, `## "Pokaż" requests`, `ask that same check again` (już jest — dodatkowo `Chcę zobaczyć`); **nie** zawiera `If the concept is DYNAMIC`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Treść:

`50-demos.md` — tytuł `## Graphics — build the picture, don't describe it`, potem:

```markdown
Choose the form per step:
- **`walkthrough`** — a derivation or process with stages (a mapping deforming, a sum building up, an optimizer stepping): an animated, step-by-step scene the learner moves through.
- **`demo`** — dependence on a parameter (what happens as λ grows): an instrument to operate.
- **`visual`** — exact static geometry: coordinates, vectors, a precise plot.
- **mermaid inline** — relations, flows, taxonomies.

**Every plan node gets at least one graphic** (`walkthrough`, `demo` or `visual` — mermaid does not count). Dispatch it at the start of the node, with its `nodeId`, then keep teaching while it builds; when it arrives, teach WITH it — name the step or control to look at.

### `walkthrough` — animated derivations
A background sub-agent builds a stepped scene (3–12 steps, one caption sentence each) on a fixed scene engine and checks every step by running and looking before it reaches the lesson. Inputs: `title`, `brief` — the objects, their coordinates, what changes in each step and what each caption says; it never sees the lesson. Optional `nodeId`. When it arrives, its result lists the captions by step number — refer to steps by number.
```
(istniejące podsekcje `demo` i `visual` zostają; z opisu `demo` usuń zdanie zaczynające się od „If the concept is DYNAMIC”; w obu dopisz „Optional `nodeId` — the plan node it serves.”)

`20-teaching.md` — na końcu:

```markdown
## "Pokaż" requests

A learner message of the form `Pokaż „…”` asks to SEE that fragment: dispatch the graphic that fits it best (usually `walkthrough`) with the current node's `nodeId`, say in one sentence what is coming, and keep teaching; when it arrives, walk him through it. If it arrived through a skipped check (the note `Chcę zobaczyć: „…”`), ask that same check again after showing it.
```
- [ ] **Step 4:** Run `bash scripts/test-isolated.sh tests/od-korzeni-prompts.test.ts tests/practice-agents.test.ts tests/prompt-overrides.test.ts` — PASS.
- [ ] **Step 5:** Commit `feat(teacher): a graphic per plan node, walkthroughs, Pokaż requests`.

---

### Task 9: Przycisk „Pokaż”

**Files:**
- Modify: `components/why-request.ts` (`showRequestText`, `showDismissNote`)
- Modify: `components/why-button.tsx` (pasek z dwoma przyciskami; `runWhy` dostaje tryb)
- Modify: `components/chat.tsx` (`onWhy` → `onAsk(mode, fragment)`)
- Test: `tests/why-request.test.ts`, `tests/why-button.test.tsx`

**Interfaces:**
- Produces:
  - `type AskMode = "why" | "show"`
  - `showRequestText(fragment, existing)` — jak `whyRequestText`, prośba `Pokaż „<fragment>”`; `showDismissNote(fragment)` = `Chcę zobaczyć: „<fragment>”`.
  - `runAsk(mode: AskMode, fragment: string, deps: WhyDeps): boolean` — `runWhy` staje się `runAsk("why", …)` (zachowaj eksport `runWhy` jako cienki alias dla istniejących testów).
  - `WhyButton({ onAsk, active })` — dwa przyciski `Dlaczego?` (`data-testid="why-button"`) i `Pokaż` (`data-testid="show-button"`) w jednym pływającym kontenerze (`data-testid="ask-toolbar"`).
- [ ] **Step 1: Failing testy:** `showRequestText("x","")==="Pokaż „x”"`, z szkicem — nowa linia; `showDismissNote`; `runAsk("show", "x", deps)` z pending → `dismiss:Chcę zobaczyć: „x”` przed `apply:Pokaż „x”`; istniejące testy `runWhy` dalej zielone.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** Run `bash scripts/test-isolated.sh tests/why-request.test.ts tests/why-button.test.tsx` + `npx tsc --noEmit` — PASS.
- [ ] **Step 5:** Commit `feat(ui): Pokaż button next to Dlaczego?`.

---

### Task 10: Weryfikacja całości

- [ ] **Step 1:** `npm run build:walkthrough && git diff --exit-code src/core/walkthrough/runtime-bundle.ts` — bundle aktualny.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint` — bez błędów.
- [ ] **Step 3:** `npm test` — zielone poza znanym „main loader resolves Pi's…”; każdy inny czerwony test do naprawy (niestabilny — potwierdzić osobnym uruchomieniem).
- [ ] **Step 4:** `npm run build` — sukces.
- [ ] **Step 5: Dymny test podagenta na prawdziwym headless (bez modelu):** skrypt w scratchpadzie wołający `getHeadless().runDemo(buildWalkthroughHtml(<przykład z INSTRUCTIONS>), {probe: …__check…})` i `renderSvg(__svgAt(1))` → `ok:true`, PNG zapisany i obejrzany.
- [ ] **Step 6: Próba ręczna (użytkownik):** sesja MES „jakobian odwzorowania elementu” — grafika dla węzła, poprawny wygląd animacji, nawigacja, „Pokaż” na zaznaczeniu.
