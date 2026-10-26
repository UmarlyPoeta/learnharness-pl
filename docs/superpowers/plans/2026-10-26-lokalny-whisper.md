# Lokalny Whisper do dyktowania — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dyktowanie po polsku przez lokalny faster-whisper (GPU), wybierane w ustawieniach obok Deepgrama.

**Architecture:** Serwer Pythona (stdlib `http.server` + faster-whisper) na `127.0.0.1:8765`; trasa Next `/api/stt/local` go proksuje; `useDictation` w trybie `local` zbiera ramki PCM i wysyła je jednym `POST` po zatrzymaniu, wynik idzie istniejącą ścieżką `bufferRef → flush()`. Silnik siedzi w rekordzie ustawień jako sekcja `dictation`.

**Tech Stack:** Next.js 16 (route handlers), React 19, TypeScript, `node:test` przez `tsx`, Python 3.12, faster-whisper, `unittest`.

**Spec:** `docs/superpowers/specs/2026-10-26-lokalny-whisper-design.md`

## Global Constraints

- Serwer: `127.0.0.1`, port `LH_STT_PORT` (domyślnie `8765`); model `LH_STT_MODEL` (domyślnie `large-v3-turbo`); zwolnienie po `LH_STT_IDLE_S` (domyślnie `600`) s bezczynności.
- Transkrypcja: `language="pl"`, `beam_size=5`, `vad_filter=True`, `condition_on_previous_text=False`, **bez** `initial_prompt`.
- Audio: PCM Int16 LE, 16 kHz, mono; limit 10 min = `19_200_000` bajtów (serwer → 413, klient kończy nagranie sam).
- Urządzenie: `cuda`/`float16`, przy błędzie ładowania lub OOM → `cpu`/`int8` i ponowienie tego samego żądania.
- Venv: `~/.local/share/learnharness/stt-venv`; log serwera `~/.cache/learnharness-stt.log`.
- Trasa Next: cel `process.env.LH_STT_URL ?? "http://127.0.0.1:8765"`.
- Ustawienia: `dictation.engine ∈ {"local","deepgram"}`, domyślnie `"local"`.
- Teksty UI po polsku (aplikacja jest przetłumaczona); etykiet `Toggle` nie tłumaczyć (generują `data-testid`).
- Deepgram: `&language=pl` w `DG_URL`.
- Testy: `npm test` (bez sieci, bez GPU) musi przejść; jedyny dopuszczalny czerwony test to istniejący środowiskowy „main loader resolves Pi's import-only PUBLIC package exports…”.

## Review Focus

1. Klik i natychmiastowe puszczenie (zero ramek) → brak `POST`, nic nie wklejane, przycisk wraca do idle.
2. Serwer STT wyłączony przy dyktowaniu → czytelny błąd „Lokalny Whisper nie działa — uruchom learn” w pasku, bez wiszącej fazy `stopping`.
3. Esc w trakcie „przepisywania…” → wynik spóźnionego `POST` nie trafia do pola (guard generacji).
4. GPU zajęte (Ollama/Albert) → serwer przechodzi na CPU i zwraca tekst zamiast 500.
5. Silnik `local` bez klucza Deepgram → przycisk dyktowania działa, nie odsyła do ustawień kluczy.

Testy pinujące: (1),(2),(3) w Task 4; (4) w Task 2; (5) w Task 4.

---

### Task 1: Sekcja ustawień `dictation`

**Files:**
- Modify: `src/core/settings.ts` (typ `DictationSettings`, pole w `UserSettings`, `sanitizeDictation` w `sanitizeUserSettings`, eksport `dictationEngine`)
- Modify: `src/server/settings-body.ts` (`parseDictationSettingsBody`, wpis `dictation` w `SETTINGS_SECTIONS`)
- Modify: `components/settings-signal.ts` (`"dictation"` w unii `SettingsSection`)
- Test: `tests/dictation-settings.test.ts`

**Interfaces:**
- Produces:
  - `export type DictationEngine = "local" | "deepgram"`
  - `export interface DictationSettings { engine?: DictationEngine }`
  - `export function dictationEngine(record: UserSettings | null | undefined): DictationEngine` — `"local"` gdy brak/niepoprawne
  - `export function parseDictationSettingsBody(body: unknown): SettingsBodyResult<DictationSettings>`
  - eksport z `@/src/core` (dopisać do `src/core/index.ts`, jeśli tam re-eksportuje się settings)

- [ ] **Step 1: Write the failing test** — `tests/dictation-settings.test.ts`:
  - `dictationEngine(null) === "local"`, `dictationEngine({version:1}) === "local"`, `dictationEngine({version:1, dictation:{engine:"deepgram"}}) === "deepgram"`
  - `sanitizeUserSettings({version:1, dictation:{engine:"whisper"}})?.dictation` deep-equals `{}`
  - `parseDictationSettingsBody({engine:"local"})` → `{ok:true, settings:{engine:"local"}}`; `({engine:"x"})` → `ok:false`, error zawiera `engine`; `(null)` → `ok:false`
  - `"dictation" in SETTINGS_SECTIONS`
- [ ] **Step 2:** `NODE_ENV=test npx tsx --test tests/dictation-settings.test.ts` → FAIL (brak eksportów)
- [ ] **Step 3:** Implementacja wg wzorca `sanitizeGeneral` / `parseGeneralSettingsBody`.
- [ ] **Step 4:** test → PASS; `npx tsc --noEmit` → czysto
- [ ] **Step 5:** `git commit -m "feat(settings): dictation engine section"`

### Task 2: Serwer STT w Pythonie + instalator

**Files:**
- Create: `stt/server.py`, `stt/test_server.py`, `scripts/stt-setup.sh`, `scripts/stt-serve.sh`

**Interfaces:**
- Produces (HTTP):
  - `POST /transcribe` (body: PCM Int16 LE 16 kHz) → `200 {"text": str, "seconds": float, "device": "cuda"|"cpu"}`; puste body → `200 {"text": "", "seconds": 0.0, "device": null}`; > `19_200_000` B → `413 {"error": ...}`; inna ścieżka → 404
  - `GET /health` → `200 {"ok": true, "loaded": bool, "device": str|null, "model": str}`
- Produces (Python, dla testów): `class Transcriber(model_name: str, idle_s: float, factory: Callable[[str, str, str], Any])` z `transcribe(pcm: bytes) -> dict` i `state() -> dict`; `factory(model, device, compute_type)` zwraca obiekt z `.transcribe(audio: np.ndarray, **kw) -> (segments, info)` (interfejs `faster_whisper.WhisperModel`); `make_server(host, port, transcriber) -> ThreadingHTTPServer`.
- `scripts/stt-serve.sh`: ustawia `LD_LIBRARY_PATH` na `…/site-packages/nvidia/{cublas,cudnn}/lib` z venv i `exec`uje `python stt/server.py`.

- [ ] **Step 1: Write the failing tests** — `stt/test_server.py` (unittest, podstawiony `factory`, bez faster-whisper/GPU):
  - `test_pcm_to_float`: `b"\x00\x40"` (16384) → `[0.5]` float32
  - `test_empty_body_returns_empty_text` (przez prawdziwy `make_server` na porcie 0 + `urllib`)
  - `test_too_large_413`: nagłówek `Content-Length: 19200002` → 413, bez czytania ciała
  - `test_health_before_load`: `loaded == False`, `model == "large-v3-turbo"`
  - `test_joins_segments`: fake model zwraca segmenty `" Ala ma"`, `" kota."` → `text == "Ala ma kota."`
  - `test_cuda_oom_falls_back_to_cpu`: factory dla `"cuda"` rzuca `RuntimeError("CUDA out of memory")` przy `transcribe`, dla `"cpu"` działa → `device == "cpu"`, tekst zwrócony
  - `test_transcribe_kwargs`: fake model zapisuje kwargs → `language == "pl"`, `vad_filter is True`, `beam_size == 5`, `condition_on_previous_text is False`, brak `initial_prompt`
  - `test_idle_unload`: `idle_s=0`, po transkrypcji wywołanie `transcriber.reap()` → `state()["loaded"] is False`
- [ ] **Step 2:** `python3 -m unittest stt/test_server.py -v` → FAIL (brak modułu)
- [ ] **Step 3:** Implementacja `stt/server.py`: import `faster_whisper` leniwie w domyślnym `factory`; lock na transkrypcję; wątek-reaper co 30 s woła `reap()`; `numpy` do konwersji (`np.frombuffer(pcm, "<i2").astype(np.float32) / 32768`); `main()` czyta `LH_STT_*`.
- [ ] **Step 4:** testy → PASS
- [ ] **Step 5:** `scripts/stt-setup.sh`: `python3 -m venv` (jeśli brak) + `pip install -U faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12`; idempotentny, `set -euo pipefail`. Uruchomić go; potem `scripts/stt-serve.sh &` i `curl -s 127.0.0.1:8765/health` → `{"ok": true, "loaded": false, …}`; zatrzymać serwer (`fuser -k 8765/tcp`).
- [ ] **Step 6:** `git commit -m "feat(stt): local faster-whisper server"`

### Task 3: Trasa `/api/stt/local`

**Files:**
- Create: `app/api/stt/local/route.ts`
- Test: `tests/stt-local-route.test.ts`

**Interfaces:**
- Consumes: HTTP z Task 2.
- Produces: `POST /api/stt/local` (body: `application/octet-stream`) → `200 {text: string}` | `503 {message: "stt-down"}` (fetch rzucił) | `502 {message: string}` (serwer ≠ 2xx); `GET /api/stt/local` → zawsze `200`, `{ok: boolean, loaded?: boolean, device?: string|null}`.

- [ ] **Step 1: Write the failing test** — podmiana `globalThis.fetch` w teście, import `../app/api/stt/local/route.ts`:
  - POST: fetch dostaje URL `http://127.0.0.1:8765/transcribe`, te same bajty co wejście; odpowiedź `{text:"Ala"}` → 200 `{text:"Ala"}`
  - POST z `process.env.LH_STT_URL = "http://x:1"` → URL `http://x:1/transcribe`
  - POST, fetch rzuca → 503 `{message:"stt-down"}`
  - POST, serwer 500 → 502
  - GET, fetch rzuca → 200 `{ok:false}`; GET ok → przekazuje `loaded`/`device`
- [ ] **Step 2:** `NODE_ENV=test npx tsx --test tests/stt-local-route.test.ts` → FAIL
- [ ] **Step 3:** Implementacja (`export const dynamic = "force-dynamic"`; `await request.arrayBuffer()`; `fetch(..., {method:"POST", body, headers:{"Content-Type":"application/octet-stream"}})`; timeout `AbortSignal.timeout(120_000)` dla POST, `2_000` dla GET).
- [ ] **Step 4:** test → PASS
- [ ] **Step 5:** `git commit -m "feat(stt): /api/stt/local proxy route"`

### Task 4: Silnik lokalny w `useDictation`

**Files:**
- Modify: `components/dictation.tsx`
- Test: `tests/dictation-local.test.ts`

**Interfaces:**
- Consumes: `dictationEngine` (Task 1), `/api/stt/local` (Task 3), `GET /api/settings` → `{settings: UserSettings|null}`.
- Produces:
  - `export const LOCAL_STT_DOWN = "Lokalny Whisper nie działa — uruchom learn"`
  - `export const MAX_LOCAL_BYTES = 19_200_000`
  - `export function concatFrames(frames: ArrayBuffer[]): Uint8Array`
  - `export async function transcribeLocal(frames: ArrayBuffer[], fetchImpl: typeof fetch = fetch): Promise<string>` — `""` bez wywołania `fetch` gdy suma bajtów 0; 503 → `throw new Error(LOCAL_STT_DOWN)`; inny błąd → `Error(message ?? "transkrypcja nie powiodła się")`; zwraca `text.trim()`.

- [ ] **Step 1: Write the failing tests**:
  - `concatFrames([Int16Array.of(1,2).buffer, Int16Array.of(3).buffer])` → 6 bajtów, Int16 view `[1,2,3]`
  - `transcribeLocal([], fakeFetch)` → `""`, `fakeFetch` nie wywołany (Review Focus 1)
  - `transcribeLocal([buf], fetch→503)` rzuca `LOCAL_STT_DOWN` (Review Focus 2)
  - `transcribeLocal([buf], fetch→{text:"  Ala ma kota. "})` → `"Ala ma kota."`; body w fetch to `concatFrames` wyniku, metoda POST na `/api/stt/local`
  - `DG_URL` (wyeksportować) zawiera `language=pl`
- [ ] **Step 2:** `NODE_ENV=test npx tsx --test tests/dictation-local.test.ts` → FAIL
- [ ] **Step 3:** Implementacja helperów + integracja w hooku:
  - `engineRef` odświeżany przy montowaniu i na `onSettingsSaved("dictation")` (fetch `/api/settings`, `dictationEngine(...)`).
  - `start()` w trybie `local`: bez `warmTokens.mint()`, faza `recording` od razu po podpięciu workletu; ramki `audio` do `localFramesRef`; gdy suma bajtów ≥ `MAX_LOCAL_BYTES` → `stop()`.
  - `stop()` w trybie `local`: mikrofon najpierw (jak dziś), faza `stopping`, `transcribeLocal(frames)`; po `await` sprawdzić `gen === genRef.current` (Review Focus 3) — inaczej porzucić; tekst niepusty → `bufferRef.current.push(text)`; błąd → `setError(e.message)`; na końcu `cleanup()`.
  - `cleanup()` czyści `localFramesRef`; `warmTokens.refresh()` tylko gdy silnik = `deepgram`; pre-mint przy montowaniu też tylko dla `deepgram`.
  - `DictationBar`: w fazie `stopping` + silnik `local` napis „przepisywanie…”; klik w błąd `DICTATION_KEYLESS` bez zmian (dotyczy tylko Deepgrama — Review Focus 5: tryb `local` nigdy nie woła `/api/stt/token`).
  - `DG_URL` += `&language=pl`.
- [ ] **Step 4:** test → PASS; `NODE_ENV=test npx tsx --test tests/dictation-warm.test.ts` → PASS (bez regresji)
- [ ] **Step 5:** `git commit -m "feat(dictation): local whisper engine"`

### Task 5: Wybór silnika w Ustawieniach → Dostawcy AI → Dyktowanie

**Files:**
- Modify: `components/settings/keys-section.tsx` (grupa `Dictation`, linie ~462–470)
- Test: `tests/render-settings.test.tsx` (dopisać przypadek) lub nowy `tests/render-dictation-engine.test.tsx`

**Interfaces:**
- Consumes: `dictationEngine`, `PUT /api/settings/dictation` z body `{engine}`, `notifySettingsSaved("dictation")`, `GET /api/stt/local`.
- Produces: komponent `export function DictationEngineRow({ engine, status, onChange }: { engine: DictationEngine; status: { ok: boolean; device?: string | null } | null; onChange: (e: DictationEngine) => void })` renderowany na górze grupy Dyktowanie; `data-testid="dictation-engine"` na `<select>`, opcje `value="local"` „Lokalny Whisper”, `value="deepgram"` „Deepgram”; status `data-testid="dictation-engine-status"`: `null` → „sprawdzanie…”, ok → `działa · ${device ?? "—"}`, nie ok → „nie działa — uruchom learn”.

- [ ] **Step 1: Write the failing test** — `renderToStaticMarkup(<DictationEngineRow engine="local" status={{ok:true, device:"cuda"}} onChange={()=>{}} />)`: zawiera `data-testid="dictation-engine"`, wybrana opcja `local`, tekst „działa · cuda”; wariant `status={{ok:false}}` → „nie działa — uruchom learn”; `status={null}` → „sprawdzanie…”.
- [ ] **Step 2:** test → FAIL
- [ ] **Step 3:** Implementacja komponentu + podpięcie w `KeysSection`: odczyt silnika z `/api/settings` przy montowaniu, status z `GET /api/stt/local` (gdy `engine === "local"`), zapis `PUT` → `notifySettingsSaved("dictation")`.
- [ ] **Step 4:** test → PASS; `npm test` → wszystko zielone poza znanym testem środowiskowym (`tests/chatgpt-connection-ui.test.tsx` sprawdza nagłówki grup — nie zmieniamy ich)
- [ ] **Step 5:** `git commit -m "feat(settings): dictation engine picker"`

### Task 6: Launcher + weryfikacja end-to-end

**Files:**
- Modify: `scripts/learn-pl.sh`
- Modify: `README.md` (krótka sekcja „Dyktowanie lokalne”: `scripts/stt-setup.sh`, zmienne `LH_STT_*`)

**Interfaces:**
- Consumes: `scripts/stt-serve.sh` (Task 2).

- [ ] **Step 1:** `learn-pl.sh`: przed `next start` — jeśli `~/.local/share/learnharness/stt-venv/bin/python` istnieje i `curl -fsS 127.0.0.1:${LH_STT_PORT:-8765}/health` nie odpowiada → `nohup scripts/stt-serve.sh >~/.cache/learnharness-stt.log 2>&1 &`; jeśli venv brak → `echo "Dyktowanie lokalne: uruchom scripts/stt-setup.sh"`.
- [ ] **Step 2:** `npm run build`, potem `learn 3125` (z atrapą `wslview` w PATH) → `curl -s localhost:3125/api/stt/local` zwraca `{"ok":true,…}`.
- [ ] **Step 3:** E2E: `~/.hermes/hermes-agent/venv/bin/edge-tts --voice pl-PL-MarekNeural --text "Transformata Laplace'a zamienia równanie różniczkowe w równanie algebraiczne." --write-media /tmp/…/pl.mp3`; `ffmpeg -i pl.mp3 -ar 16000 -ac 1 -f s16le pl.raw`; `curl -s --data-binary @pl.raw -H 'Content-Type: application/octet-stream' localhost:3125/api/stt/local` → tekst zawiera „Laplace” i „równanie”; zmierzyć czas drugiego wywołania (model już załadowany) — cel < 1,5 s.
- [ ] **Step 4:** Ręcznie w przeglądarce: Ustawienia → Dostawcy AI → Dyktowanie pokazuje „Lokalny Whisper · działa · cuda”; dyktowanie w polu wiadomości wkleja polski tekst. (Krok dla użytkownika, jeśli agent nie ma mikrofonu.)
- [ ] **Step 5:** zatrzymać serwery testowe (`fuser -k 3125/tcp 8765/tcp`), `git commit -m "feat(stt): start local whisper from learn launcher"`
