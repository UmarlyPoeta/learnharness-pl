# Nauka od korzeni — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sonda i nauczyciel schodzą do potwierdzonej podłogi wiedzy; głęboka dziura → pytanie i opcjonalna sesja-korzeń (`foundation_session`); przycisk „Dlaczego?” na zaznaczonym fragmencie lekcji.

**Architecture:** Trzy warstwy: (1) doktryna w promptach prober/teacher + opis pola `assessment` w `probe_done`; (2) nowe narzędzie nauczyciela `foundation_session` (kontrakt w `src/core/contracts/`, narzędzie w `src/agent/tools/`, karta w `components/artifacts/`) wg wzorca `probe_done`; (3) czyste helpery „Dlaczego?” + pływający przycisk podpięty w `components/chat.tsx` przez istniejące `applyText` / ścieżkę pomijania pytania.

**Tech Stack:** Next.js 16 + React, TypeScript, typebox, `node:test` przez `tsx` (`bash scripts/test-isolated.sh <pliki>`), `linkedom` w testach DOM, `react-dom/server` w testach renderu.

**Spec:** `docs/superpowers/specs/2026-10-29-od-korzeni-design.md`

## Global Constraints

- Tryb zawsze włączony — żadnego ustawienia ani przełącznika.
- Potwierdzona podłoga: poprawnie **i** pewność ≥ 70 **i** sensowny tok w thinking.
- Reguła C: brakujący fundament potrzebujący **3+ węzłów planu** → pytanie `ask_user_question` przed prezentacją planu.
- Nazwa narzędzia: `foundation_session`; pola `title`, `goal`; tylko nauczyciel; nie jest przełączalne (nie w `TOGGLEABLE_TOOLS`).
- Napisy UI (dokładnie): przycisk karty `Otwórz sesję-korzeń`; nagłówek karty `Sesja-korzeń`; przycisk zaznaczenia `Dlaczego?`; etykieta aktywności `Przygotowuję sesję-korzeń…`.
- Tekst prośby: `Dlaczego „<fragment>”?`; notatka pominięcia: `Nie rozumiem: „<fragment>”`; fragment zwinięty z białych znaków, maks. **300** znaków, przy obcięciu kończy się `…`.
- Prompty pisane po angielsku jak reszta fragmentów; zmiany w zwartych akapitach (merge z upstreamem).
- Nie edytować etykiet `Toggle` (generują `data-testid`).
- Testy zawsze przez `bash scripts/test-isolated.sh` (izolowany katalog danych).

## Review Focus

- Zaznaczenie wychodzące poza jeden fragment `.lh-source-passage` (np. od lekcji do wiadomości użytkownika) → brak przycisku. Test: Task 6 `whySelectionScope`.
- Zaznaczenie wzoru KaTeX → fragment zawiera `$<tex>$` z adnotacji, nie zdublowany tekst MathML+HTML. Test: Task 5.
- Zaznaczenie puste / same spacje → brak przycisku i brak pustej prośby. Test: Task 5 (`whyFragment` → `""`) + Task 6.
- Niepusty kompozytor przy kliknięciu „Dlaczego?” → szkic zostaje, prośba w nowej linii. Test: Task 5 `whyRequestText`.
- Podwójny klik „Otwórz sesję-korzeń” → jedna sesja (przycisk zablokowany w trakcie). Test: Task 4.

---

### Task 1: Doktryna sondy — potwierdzona podłoga

**Files:**
- Modify: `src/agent/prompts/prober/10-probe-doctrine.md` (sekcja „4. Binary-search every strand”, punkt „Enter near the top…” i „Strands inform each other”; sekcja „5. Conclude”)
- Modify: `src/core/contracts/probe.ts:56-60` (opis pola `assessment` w nitce)
- Test: `tests/od-korzeni-prompts.test.ts` (nowy)

**Interfaces:**
- Consumes: `composeInstructions(agent: "teacher" | "prober", switches?)` z `src/agent/teacher-agent.ts` (ten sam import co `tests/prompt-overrides.test.ts`).
- Produces: nic dla innych zadań poza plikiem testowym, który Task 2 rozszerza.

- [ ] **Step 1: Napisz failing test**

`tests/od-korzeni-prompts.test.ts`, `describe("od korzeni: prober")`:
- `composeInstructions("prober")` **nie** zawiera `"Enter near the top"` ani `"school-level basics"`.
- zawiera `"**Confirmed floor**"`, `"confidence ≥ 70"`, `"how deep the gap runs"`.
- `JSON.stringify(probeDoneInputSchema)` zawiera `"confirmed floor"` i `"gap depth"`.

- [ ] **Step 2: Uruchom — ma paść**

Run: `bash scripts/test-isolated.sh tests/od-korzeni-prompts.test.ts`
Expected: FAIL (brak fraz).

- [ ] **Step 3: Zmień prompt sondy**

Zastąp punkt „Enter near the top, not the bottom.” tym akapitem:

```markdown
- **Enter at the goal's level, then bracket DOWN to a confirmed floor.** Never assume basics are held because the learner is an adult or the goal is advanced — this learner's gaps are often in the foundations. A **Confirmed floor** is a correct answer with confidence ≥ 70 AND sound reasoning in the thinking field. Correct but low-confidence, reached by elimination, or a visible guess is a CEILING, not a floor — keep descending until a confirmed floor appears.
```

Zastąp punkt „Strands inform each other.”:

```markdown
- **Strands inform each other — upward only.** A strand crushed at height may start its neighbors higher, but every strand still needs its own confirmed floor; never skip descending because a neighbor was strong.
```

W sekcji „5. Conclude” po zdaniu z „One entry per strand: …” dopisz:

```markdown
Each entry states the confirmed floor with its evidence, and **how deep the gap runs**: how many layers of foundation sit between that floor and what the goal needs. The teacher uses this to decide whether to ask about a separate foundation session.
```

- [ ] **Step 4: Zmień opis `assessment` w `src/core/contracts/probe.ts`**

Nowy opis (zastępuje obecny ciąg):
`"Where his edge sits on this strand: the confirmed floor (correct, confidence ≥ 70, sound reasoning) with its evidence, the ceiling (where it runs out — low-confidence or guessed hits count here), the gap depth (how many layers of foundation lie between the floor and what the goal needs), misconceptions found, and what the lesson should build from."`

- [ ] **Step 5: Uruchom — ma przejść; plus istniejące testy promptów i probe_done**

Run: `bash scripts/test-isolated.sh tests/od-korzeni-prompts.test.ts tests/prompt-overrides.test.ts tests/probe-done.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompts/prober/10-probe-doctrine.md src/core/contracts/probe.ts tests/od-korzeni-prompts.test.ts
git commit -m "feat(prober): bracket down to a confirmed floor"
```

---

### Task 2: Doktryna nauczyciela — reguła C, potwierdzanie korzeni, „Dlaczego?”

**Files:**
- Modify: `src/agent/prompts/teacher/10-planning.md` (sekcja „Planning — think hard here”, punkt o „minimal tree”; nowa podsekcja przed „## The plan map”)
- Modify: `src/agent/prompts/teacher/20-teaching.md` (krok 4 w „Per step”; nowa podsekcja na końcu pliku)
- Modify: `src/agent/prompts/teacher/05-method.md` (akapit „Confirm the foundation before building on it.”)
- Test: `tests/od-korzeni-prompts.test.ts` (rozszerzenie)

**Interfaces:**
- Consumes: plik testowy z Task 1.
- Produces: prompt odwołuje się do narzędzia `foundation_session` (pola `title`, `goal`) — definiuje je Task 3.

- [ ] **Step 1: Dopisz failing testy** — `describe("od korzeni: teacher")`, `composeInstructions("teacher")` zawiera:
`"only a confirmed floor counts as held"`, `"## Deep gaps — ask before descending"`, `"3 or more plan nodes"`, `"foundation_session"`, `"## \"Dlaczego\" requests"`, `"ask that same check again"`, oraz `"confirm it with a \`quiz\`"`.

- [ ] **Step 2: Uruchom — ma paść** (`bash scripts/test-isolated.sh tests/od-korzeni-prompts.test.ts`).

- [ ] **Step 3: `teacher/10-planning.md`**

Punkt o „Which of those does he already hold (from the probe)?…” — dopisz na końcu punktu:
`"Here only a confirmed floor counts as held (the probe's evidence: correct, confidence ≥ 70, sound reasoning) — anything shaky enters the plan."`

Nowa podsekcja przed `## The plan map`:

```markdown
## Deep gaps — ask before descending

The plan reaches down to the confirmed floor. When a missing foundation would itself take 3 or more plan nodes, do not silently fold it in: before presenting the plan, call `ask_user_question` showing what lies underneath (the chain from his floor up to the goal) and offering two options — descend in this session, or split "<X> od zera" into a separate foundation session and start here with X as an assumption. Smaller gaps simply enter the plan.

If he chooses the separate session, call `foundation_session` with `title` (short, e.g. "Macierze od zera") and `goal` — the new session's first message written as his goal, in Polish: what it is needed for (this session and its goal), what the probe found (floor, ceiling, shaky spots), and that it starts from the very basics. Call it only after that choice. Then X is a borrowed root: keep teaching, say which steps stand on it, and when he returns, the usual root confirmation decides whether to continue.
```

- [ ] **Step 4: `teacher/05-method.md`** — zastąp akapit „**Confirm the foundation before building on it.** …” tym:

```markdown
**Confirm the foundation before building on it — with a real check.** Every root of the plan must be confirmed with a `quiz` (or `explain`) before anything is built on it — never judged in your head. If a core truth doesn't land as rock-solid, stop and fix the foundation — don't build on sand.
```

- [ ] **Step 5: `teacher/20-teaching.md`**

W kroku 4 („Check that the step landed…”) dopisz zdanie: `"A miss that exposes a missing foundation underneath follows the deep-gap rule: a small gap is a detour right now; one needing 3 or more plan nodes means asking whether to split it into a foundation session."` — i zadbaj, by plik zawierał frazę `confirm it with a \`quiz\`` w zdaniu: `"Before building on a plan root, confirm it with a \`quiz\`."` dopisanym w tym samym kroku.

Nowa podsekcja na końcu pliku:

```markdown
## "Dlaczego" requests

A learner message of the form `Dlaczego „…”?` asks you to go exactly one level below that fragment: name the fact it stands on, check with a question whether he holds it, and if not, descend (a detour, or the deep-gap rule). Then return explicitly to where you were. If it arrived through a skipped check (the skip carries the note `Nie rozumiem: „…”`), ask that same check again after the detour.
```

- [ ] **Step 6: Uruchom — ma przejść**

Run: `bash scripts/test-isolated.sh tests/od-korzeni-prompts.test.ts tests/prompt-overrides.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/prompts/teacher tests/od-korzeni-prompts.test.ts
git commit -m "feat(teacher): deep-gap rule, confirmed roots, Dlaczego detours"
```

---

### Task 3: Narzędzie `foundation_session`

**Files:**
- Create: `src/core/contracts/foundation.ts`
- Modify: `src/core/contracts.ts` (re-eksport, jak `./contracts/probe.ts`)
- Modify: `src/core/tool-parts.ts` (parser obok `parseProbeDoneInput`)
- Create: `src/agent/tools/foundation.ts`
- Modify: `src/agent/tools.ts` — `createTeacherTools` (wpis obok `...planTools(ctx)`)
- Modify: `src/core/pending.ts:140-151` — `ACTIVITY_LABELS`
- Modify: `tests/question-tools.test.ts:298-315` (oczekiwane zestawy kluczy nauczyciela)
- Test: `tests/foundation-session.test.ts` (nowy)

**Interfaces:**
- Produces:
  - `foundationSessionInputSchema` (typebox `Type.Object({ title: Type.String({minLength:1, pattern:"\\S"}), goal: Type.String({minLength:1, pattern:"\\S"}) })`, z opisami pól po angielsku zgodnymi z Task 2)
  - `type FoundationSessionInput = { title: string; goal: string }`
  - `FOUNDATION_SESSION_TOOL = "foundation_session"`
  - `FOUNDATION_SESSION_ACK_TEXT = "Foundation session card shown — the learner opens it when ready. Keep teaching with it as a borrowed root."`
  - `parseFoundationSessionInput(input: unknown): FoundationSessionInput | undefined` (przez `boundaryParse`, jak `parseProbeDoneInput`)
  - `foundationSessionTool: AgentTool<typeof foundationSessionInputSchema>` — `executionMode: "sequential"`, `execute: serverExecute(FOUNDATION_SESSION_TOOL, schema, () => FOUNDATION_SESSION_ACK_TEXT)`; niczego nie tworzy.

- [ ] **Step 1: Failing testy** w `tests/foundation-session.test.ts`:
  - `parseFoundationSessionInput({title:"Macierze od zera", goal:"Chcę…"})` zwraca obiekt; `({title:"", goal:"x"})`, `({title:"x"})`, `("str")` → `undefined`.
  - `createTeacherTools(ctx)` ma klucz `foundation_session`; `createProberTools(ctx)` go nie ma (ctx jak w `tests/question-tools.test.ts`).
  - wykonanie narzędzia z poprawnym wejściem zwraca wynik, którego tekst = `FOUNDATION_SESSION_ACK_TEXT` (wywołanie `execute` jak w `tests/send-to-user.test.ts`); żaden czat nie powstał (`chatStore.listChats().length` bez zmian).
  - `toolActivityLabel("foundation_session") === "Przygotowuję sesję-korzeń…"`.
  - `createTeacherTools(ctx, { foundation_session: false })` **nadal** ma `foundation_session` (nie jest przełączalne) — implementacja: wpis poza `filterEnabledTools`, analogicznie jak quizzing jest wyjęty z filtrowania.

- [ ] **Step 2: Uruchom — ma paść** (`bash scripts/test-isolated.sh tests/foundation-session.test.ts`).

- [ ] **Step 3: Zaimplementuj** kontrakt, parser, narzędzie, wpis w `createTeacherTools`, etykietę aktywności. Zaktualizuj oczekiwane listy w `tests/question-tools.test.ts:298-315` o `"foundation_session"` (posortowane).

- [ ] **Step 4: Uruchom — ma przejść**

Run: `bash scripts/test-isolated.sh tests/foundation-session.test.ts tests/question-tools.test.ts tests/chat-flow.test.ts tests/jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/contracts/foundation.ts src/core/contracts.ts src/core/tool-parts.ts src/agent/tools/foundation.ts src/agent/tools.ts src/core/pending.ts tests/foundation-session.test.ts tests/question-tools.test.ts
git commit -m "feat(teacher): foundation_session tool"
```

---

### Task 4: Karta sesji-korzenia

**Files:**
- Create: `components/artifacts/foundation-session-card.tsx`
- Modify: `components/artifacts/index.ts` (wpis `foundation_session: FoundationSessionCard`)
- Test: `tests/foundation-session-card.test.tsx` (nowy)

**Interfaces:**
- Consumes: `parseFoundationSessionInput` (Task 3); `startDraftSession(text, fetchLike)` z `components/new-session.tsx` (zwraca `"/chat/<id>?prompt=…"` albo `null`).
- Produces:
  - `openFoundationSession(goal: string, fetchLike: typeof fetch, push: (href: string) => void): Promise<boolean>` — woła `startDraftSession(goal, fetchLike)`, przy niepustym wyniku `push(target)` i `true`; inaczej `false`.
  - `FoundationSessionCard({ part }: ArtifactPartProps)` — `data-testid="foundation-session-card"`; nagłówek `Sesja-korzeń`; `title` jako tytuł; pierwsze zdanie `goal` (do pierwszej kropki, maks. 160 znaków) jako „po co”; przycisk `Otwórz sesję-korzeń` (`data-testid="foundation-session-open"`), `disabled` w trakcie i po sukcesie; nawigacja przez `useRouter().push`. Wejście, które się nie parsuje (strumień w toku / output-error) → tekst `Przygotowuję sesję-korzeń…` i brak przycisku.

- [ ] **Step 1: Failing testy**
  - `renderToStaticMarkup(<FoundationSessionCard part={{type:"tool-foundation_session", state:"input-available", toolCallId:"f1", input:{title:"Macierze od zera", goal:"Chcę zrozumieć mnożenie macierzy. Potrzebne do LM."}}} />)` zawiera `Sesja-korzeń`, `Macierze od zera`, `Chcę zrozumieć mnożenie macierzy.` i `Otwórz sesję-korzeń`. (Jeśli `useRouter` wymaga kontekstu w renderze statycznym — wydziel `FoundationSessionCardView({ input, onOpen, busy })` i testuj widok; `FoundationSessionCard` tylko go zasila.)
  - nieparsowalne wejście (`input: {title: ""}`) → brak `foundation-session-open`, jest `Przygotowuję sesję-korzeń…`.
  - `openFoundationSession` z fałszywym `fetch` zwracającym `{id:"chat_x"}`: `push` dostaje `/chat/chat_x?prompt=` + zakodowany `goal`, wynik `true`; z pustym `goal` (`"  "`) → `push` niewołany, wynik `false`.
  - podwójne wywołanie handlera karty przy `busy` → `openFoundationSession` wołane raz (test na widoku: `onOpen` nie jest wołany, gdy `busy`; przycisk ma `disabled`).

- [ ] **Step 2: Uruchom — ma paść** (`bash scripts/test-isolated.sh tests/foundation-session-card.test.tsx`).

- [ ] **Step 3: Zaimplementuj** kartę (wzorzec stylu jak `probe-done-card.tsx`: `my-3 rounded-xl border bg-card/60 p-3`, ikona z `lucide-react`, np. `SproutIcon`) i wpis w rejestrze.

- [ ] **Step 4: Uruchom — ma przejść**

Run: `bash scripts/test-isolated.sh tests/foundation-session-card.test.tsx tests/render-cards.test.tsx tests/artifact-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/artifacts/foundation-session-card.tsx components/artifacts/index.ts tests/foundation-session-card.test.tsx
git commit -m "feat(ui): foundation session card"
```

---

### Task 5: Czyste helpery „Dlaczego?”

**Files:**
- Create: `components/why-request.ts`
- Test: `tests/why-request.test.ts` (nowy, `linkedom`)

**Interfaces:**
- Produces:
  - `WHY_FRAGMENT_MAX = 300`
  - `whyFragment(root: ParentNode): string` — dla każdego `.katex` w klonie: zastąp element tekstem `$` + `annotation[encoding="application/x-tex"]`.textContent + `$` (brak adnotacji → `textContent` z `.katex-html`); potem `textContent`, zwiń `\s+` do spacji, `trim`; dłuższy niż 300 → pierwsze 299 znaków + `…`. Puste → `""`.
  - `whyRequestText(fragment: string, existing: string): string` — `req = "Dlaczego „" + fragment + "”?"`; `existing.trim()` puste → `req`, inaczej `existing.replace(/\s+$/, "") + "\n" + req`.
  - `whyDismissNote(fragment: string): string` — `"Nie rozumiem: „" + fragment + "”"`.

- [ ] **Step 1: Failing testy**
  - zwykły tekst z wieloma spacjami/nowymi liniami → zwinięty.
  - `<p>Mamy <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">J^T J</annotation></semantics></math></span><span class="katex-html">JTJ</span></span> i dalej</p>` → `"Mamy $J^T J$ i dalej"`.
  - 400 znaków → długość 300, ostatni znak `…`.
  - `"   "` → `""`.
  - `whyRequestText("x", "")` → `Dlaczego „x”?`; `whyRequestText("x", "mój szkic  ")` → `"mój szkic\nDlaczego „x”?"`.
  - `whyDismissNote("x")` → `Nie rozumiem: „x”`.

- [ ] **Step 2: Uruchom — ma paść** (`bash scripts/test-isolated.sh tests/why-request.test.ts`).
- [ ] **Step 3: Zaimplementuj** `components/why-request.ts`.
- [ ] **Step 4: Uruchom — ma przejść.**
- [ ] **Step 5: Commit**

```bash
git add components/why-request.ts tests/why-request.test.ts
git commit -m "feat(ui): Dlaczego request helpers"
```

---

### Task 6: Przycisk „Dlaczego?” w czacie

**Files:**
- Create: `components/why-button.tsx`
- Modify: `components/chat.tsx` — (a) wydziel gałąź pending z `confirmAbort` (`components/chat.tsx:390-426`, blok `const p = pendingRef.current; if (p) {…}`) do `const dismissPendingQuestion = useCallback((noteOverride?: string) => boolean, …)` zwracającego `true`, gdy coś pominięto; `confirmAbort` woła ją bez notatki; (b) zamontuj `<WhyButton onWhy={onWhy} />` raz w widoku czatu; (c) `onWhy`.
- Test: `tests/why-button.test.tsx` (nowy)

**Interfaces:**
- Consumes: `whyFragment`, `whyRequestText`, `whyDismissNote` (Task 5); istniejące w `chat.tsx`: `applyText`, `textRef`, `pendingRef`, `readingThinkingRef`, `clearReadingThinking`, `dismissedAnswer`, `toolQuestionKind`, `dismissQuestion`, `abortInFlightTurn`, `busyRef`.
- Produces:
  - `whySelectionScope(selection: { anchorNode: Node | null; focusNode: Node | null; isCollapsed: boolean } | null): Element | null` — zwraca wspólny przodek `.lh-source-passage`, gdy oba końce leżą w **tym samym** takim elemencie i zaznaczenie nie jest puste; inaczej `null`.
  - `runWhy(fragment: string, deps: { hasPending: () => boolean; dismissPending: (note: string) => void; getText: () => string; applyText: (v: string) => void; focusComposer: () => void }): boolean` — pusty fragment → `false` i nic; jeśli `hasPending()` → najpierw `dismissPending(whyDismissNote(fragment))`; potem `applyText(whyRequestText(fragment, getText()))`, `focusComposer()`; `true`.
  - `WhyButton({ onWhy }: { onWhy: (fragment: string) => void })` — słucha `selectionchange` na `document`; gdy `whySelectionScope` daje element i `whyFragment(range.cloneContents())` niepusty → pływający przycisk `Dlaczego?` (`data-testid="why-button"`, pozycja z `range.getBoundingClientRect()`, `position: fixed`, nad zaznaczeniem); `mousedown` na przycisku z `preventDefault` (nie gubi zaznaczenia); klik → `onWhy(fragment)` i ukrycie; ukrywa się przy zwinięciu zaznaczenia, `scroll` (capture) i `Escape`.
  - W `chat.tsx`: `onWhy = (f) => runWhy(f, { hasPending: () => !!pendingRef.current, dismissPending: (n) => dismissPendingQuestion(n), getText: () => textRef.current, applyText, focusComposer })`. `dismissPendingQuestion(note)` ustawia `readingThinking` na `note`, a gdy był już tekst w polu czytania — `existing + "\n" + note`. `focusComposer = () => composerInputRef.current?.focus()` (istniejący ref, `components/chat.tsx:655`).

- [ ] **Step 1: Failing testy** (`linkedom` + fałszywe deps):
  - `whySelectionScope`: oba końce w tym samym `.lh-source-passage` → ten element; końce w dwóch różnych passage → `null`; jeden koniec poza passage → `null`; `isCollapsed: true` → `null`.
  - `runWhy("x", deps)` bez pending: `applyText` dostaje `Dlaczego „x”?`, `dismissPending` niewołane, `focusComposer` wołane, wynik `true`.
  - z pending: `dismissPending` dostaje `Nie rozumiem: „x”` **przed** `applyText` (kolejność w tablicy wywołań).
  - `runWhy("", deps)` → `false`, nic nie wołane.
  - z istniejącym szkicem `"szkic"` → `applyText("szkic\nDlaczego „x”?")`.

- [ ] **Step 2: Uruchom — ma paść** (`bash scripts/test-isolated.sh tests/why-button.test.tsx`).
- [ ] **Step 3: Zaimplementuj** `components/why-button.tsx` i zmiany w `chat.tsx` (minimalne; komentarze w stylu pliku: data + krótkie uzasadnienie).
- [ ] **Step 4: Uruchom — ma przejść, plus testy czatu/kompozytora**

Run: `bash scripts/test-isolated.sh tests/why-button.test.tsx tests/why-request.test.ts tests/render-composer.test.tsx tests/esc-layering.test.ts tests/dismissal-park.test.ts tests/session-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/why-button.tsx components/chat.tsx tests/why-button.test.tsx
git commit -m "feat(ui): Dlaczego? button on selected lesson text"
```

---

### Task 7: Weryfikacja całości i próba ręczna

- [ ] **Step 1:** `npm run typecheck` — Expected: brak błędów.
- [ ] **Step 2:** `npm run lint` — Expected: brak błędów.
- [ ] **Step 3:** `npm test` — Expected: wszystko zielone poza znanymi przypadkami środowiskowymi z notatek (`openrouter-free-models` przy kluczu w `auth.json`, „main loader resolves Pi's…”); każdy inny czerwony test = do naprawy przed końcem.
- [ ] **Step 4:** `npm run build` — Expected: sukces.
- [ ] **Step 5: Próba ręczna** (`learn`, przebuduje i zrestartuje serwer — sprawdź, że stempel builda się zmienił): nowa sesja „Chcę zrozumieć i zaimplementować Levenberga-Marquardta do optymalizacji pose graph w Loop Closure”. Sprawdź i zanotuj:
  1. sonda schodzi poniżej jakobianu, dopóki nie trafi na pewność ≥ 70;
  2. karta oceny zawiera głębokość dziury;
  3. przed planem pada pytanie reguły C (jeśli dziura ≥ 3 węzły);
  4. wybór „osobna sesja” → karta `Sesja-korzeń` → przycisk otwiera nową sesję z celem;
  5. zaznaczenie zdania z wzorem → `Dlaczego?` → prośba w kompozytorze z `$…$`; objazd i powrót;
  6. to samo przy otwartym pytaniu → pytanie pominięte, po objeździe zadane ponownie.
- [ ] **Step 6:** Zapisz wynik próby (co zadziałało, co model zignorował) w podsumowaniu dla użytkownika; jeśli model pomija regułę C — zgłoś, nie poprawiaj promptów na ślepo.
