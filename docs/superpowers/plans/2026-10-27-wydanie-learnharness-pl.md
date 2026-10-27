# Wydanie LearnHarness PL — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publiczny fork `UmarlyPoeta/learnharness-pl` z instalatorami Windows/Linux, marką „LearnHarness PL” i lokalnym dyktowaniem przez wbudowany whisper.cpp.

**Architecture:** Istniejący pipeline electron-builder + GitHub Actions przestawiony na fork (bez macOS). Serwer Next w aplikacji desktopowej zarządza procesem `whisper-server` (whisper.cpp, Vulkan + CPU, ścieżka z `LH_WHISPER_BIN`) i pobiera model do katalogu danych; bez `LH_WHISPER_BIN` zostaje obecny serwer Pythona.

**Tech Stack:** Next.js 16 route handlers, TypeScript, `node:test` przez `tsx`, Electron 44 + electron-builder 26, whisper.cpp v1.9.5 (CMake, Vulkan), GitHub Actions, `gh`.

**Spec:** `docs/superpowers/specs/2026-10-27-wydanie-learnharness-pl-design.md`

## Global Constraints

- Platformy: Windows x64 (`windows-2025`), Linux x64 (`ubuntu-24.04`). Bez macOS.
- `appId: com.umarlypoeta.LearnHarnessPL`, `productName: LearnHarness PL`, artefakty `LearnHarness-PL-<v>-…`, `desktopName: learnharness-pl.desktop`, `package.json` `name: learnharness-pl`, `version: 1.0.0`.
- Publish: `provider: github`, `owner: UmarlyPoeta`, `repo: learnharness-pl`, `releaseType: draft`.
- whisper.cpp `v1.9.5`; CMake: `-DGGML_VULKAN=ON -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DGGML_NATIVE=OFF -DWHISPER_BUILD_SERVER=ON -DCMAKE_BUILD_TYPE=Release`.
- Model: `ggml-large-v3-turbo-q5_0.bin`, URL `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`, rozmiar `574041195`, SHA-256 `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`, ścieżka `<LH_DATA_DIR>/models/ggml-large-v3-turbo-q5_0.bin`.
- `whisper-server`: `--host 127.0.0.1 --port <wolny> -m <model> -l pl -t <min(8, os.availableParallelism())>`; gotowość `GET /health` = 200, limit 60 s; zamknięcie po 600 s bez żądań.
- `/inference`: multipart `file` (WAV 16 kHz mono 16-bit), `response_format=json`, `temperature=0`.
- Komunikaty po polsku; licencja AGPL-3.0 i autor oryginału zachowani; README z sekcją „Pochodzenie i licencja”.
- Testy przez `npm test` (izolowany katalog danych). Dopuszczalny czerwony: tylko istniejący „main loader resolves Pi's import-only PUBLIC package exports…”.
- Nic z `data/` ani `auth.json` nie trafia do repo.

## Review Focus

1. Dwa dyktowania naraz, gdy `whisper-server` jeszcze startuje → jeden proces, oba żądania dostają ten sam URL (Task 4).
2. Aplikacja zamknięta w trakcie pobierania → przy następnym starcie stan `missing`, ponowne pobieranie nadpisuje stary `.part` (Task 5).
3. `whisper-server` pada w trakcie żądania → 503 teraz, nowy proces przy następnym dyktowaniu (Task 4).
4. HuggingFace zwraca 404/brak sieci/pełny dysk → stan `error` z komunikatem, bez pliku `.part` (Task 5).
5. Profil Windows ze spacją lub polską literą (`C:\Users\Łukasz Nowak\…`) → ścieżki przekazane do `spawn` jako elementy tablicy, bez powłoki (Task 4).

---

### Task 1: Porządki: izolacja testów, fixtury, spec

**Files:**
- Commit: `scripts/test-isolated.sh`, `package.json` (skrypt `test`), `docs/superpowers/specs/2026-10-27-wydanie-learnharness-pl-design.md`, ten plan
- Move (poza repo): fixtury z `data/chats`, `data/jobs`

- [ ] **Step 1:** `bash scripts/test-isolated.sh` (pełny zestaw) → wszystko zielone poza znanym testem Pi; przed i po: `ls data/chats | wc -l` bez zmian, mtime plików `data/graph/*` bez zmian.
- [ ] **Step 2:** Przenieś do `~/learnharness-test-fixtures-2026-10-26/{chats,jobs}/`: każdy `data/chats/*.json` z `title` ∈ {`Fixture mixed queue`, `Scratch mixed queue`, `Toggle bridge test`, `steer: live`, `steer: idle`, `steer: reconcile`, `getApiKey pin`} oraz pliki o rozmiarze < 300 B bez wiadomości; każdy `data/jobs/*.json`, którego `chatId` ≠ `chat_mvoijkuu_084b8e5e`. Zostaje dokładnie 1 sesja; `curl -s localhost:3000/api/chats` pokazuje tylko „procesy kształtowania metali…”.
- [ ] **Step 3:** `git add scripts/test-isolated.sh package.json docs/superpowers && git commit -m "chore: isolated test runs; release spec and plan"`

### Task 2: Marka i tożsamość

**Files:**
- Modify: `package.json`, `electron-builder.yml`, `electron/main.cjs`, `app/layout.tsx`, `components/update-banner.tsx`, `scripts/verify-release.ts`, `tests/verify-release.test.ts`, `scripts/make-icons.mjs`, `build/icon.ico`, `build/icon.png`, `README.md`, `.github/ISSUE_TEMPLATE/*.yml`
- Create: `build/icon-pl-badge.svg` (sama plakietka) lub plakietka wstawiana w `make-icons.mjs`

**Interfaces:**
- Produces: `scripts/verify-release.ts` `expectedAssets(version)` → `{ win: { exe, feed: "latest.yml" }, linux: { appImage, deb, feed: "latest-linux.yml" }, files: string[] }` z `PRODUCT_NAME = "LearnHarness-PL"` (6 plików); bez klucza `mac`.

- [ ] **Step 1: Failing test** — w `tests/verify-release.test.ts` zmień oczekiwania: `expectedAssets("1.0.0").files` deep-equals posortowane `["LearnHarness-PL-1.0.0-x64-setup.exe", "LearnHarness-PL-1.0.0-x64-setup.exe.blockmap", "LearnHarness-PL-1.0.0-x86_64.AppImage", "LearnHarness-PL-1.0.0-amd64.deb", "latest.yml", "latest-linux.yml"]`; walidacja `electron-builder.yml` przechodzi bez sekcji `mac` i odrzuca `publish.owner` ≠ `UmarlyPoeta`. Usuń przypadki testowe dotyczące `latest-mac.yml`/DMG/ZIP.
- [ ] **Step 2:** `bash scripts/test-isolated.sh tests/verify-release.test.ts` → FAIL.
- [ ] **Step 3:** Implementacja: `verify-release.ts` bez gałęzi mac; `electron-builder.yml` — wartości z Global Constraints, `nsis.artifactName: "LearnHarness-PL-${version}-${arch}-setup.${ext}"`, `linux.artifactName: "LearnHarness-PL-${version}-${arch}.${ext}"`, usunięte `mac:` i `dmg:`; `package.json` — `name`, `version`, `homepage`, `description` („Polska wersja LearnHarness: uprząż agentowa do nauki — adaptacyjne nauczanie, ćwiczenia i trwały graf wiedzy.”), `desktopName`, `contributors: ["UmarlyPoeta"]`, `desktop:dist` usunięty; `electron/main.cjs` — `PRODUCT_NAME = "LearnHarness PL"`, menu po polsku („Sprawdź aktualizacje…”, „Edycja”, „Widok”, „Rzeczywisty rozmiar”, „Powiększ”, „Pomniejsz”, okna dialogowe aktualizacji: „Masz najnowszą wersję.”, „LearnHarness PL ${v} to najnowsza wersja.”); `app/layout.tsx` `title: "LearnHarness PL"`; baner: „LearnHarness PL {v} jest gotowy”.
- [ ] **Step 4:** Ikona: `make-icons.mjs` nakłada na `icon-flat.svg` plakietkę „PL” (prawy dolny róg, ok. 38% szerokości, czerwone tło `#dc2626`, biały tekst, zaokrąglony prostokąt) i generuje `build/icon.ico` + `build/icon.png`; `node scripts/make-icons.mjs`; obejrzyj `build/icon.png` (Read) — plakietka czytelna przy 32 px.
- [ ] **Step 5:** README po polsku (sekcje: opis, Pobierz — linki `https://github.com/UmarlyPoeta/learnharness-pl/releases/latest`, Windows SmartScreen, Linux AppImage `chmod +x`, Pierwsze kroki z OpenRouter i tanimi modelami DeepSeek, Dyktowanie lokalne, Rozwój (`npm install`, `learn`, `npm test`), Pochodzenie i licencja z linkiem do `amosblomqvist/learnharness` i listą zmian). Issue templates: linki → fork.
- [ ] **Step 6:** `bash scripts/test-isolated.sh` → zielone (poza Pi); `npx tsc --noEmit`, `npx eslint .` czyste; `grep -rn "amosblomqvist/learnharness/issues\|learnharness.ai" --include=*.ts --include=*.tsx --include=*.cjs --include=*.yml . | grep -v node_modules` → tylko README/LICENSE-kontekst.
- [ ] **Step 7:** `git commit -m "feat: LearnHarness PL branding and release identity"`

### Task 3: WAV

**Files:**
- Create: `src/core/wav.ts` (re-eksport z `src/core/index.ts`)
- Test: `tests/wav.test.ts`

**Interfaces:**
- Produces: `pcmToWav(pcm: Uint8Array, sampleRate = 16000): Uint8Array<ArrayBuffer>` — 44-bajtowy nagłówek PCM mono 16-bit + dane.

- [ ] **Step 1: Failing test** — dla `pcm = new Uint8Array([1,2,3,4])`: długość 48; ASCII `RIFF` @0, `WAVE` @8, `fmt ` @12, `data` @36; LE u32 @4 = 40, u16 @20 = 1, u16 @22 = 1, u32 @24 = 16000, u32 @28 = 32000, u16 @32 = 2, u16 @34 = 16, u32 @40 = 4; bajty 44–47 = `[1,2,3,4]`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementacja (`DataView`). **Step 4:** → PASS.
- [ ] **Step 5:** `git commit -m "feat(core): pcmToWav"`

### Task 4: Silnik whisper.cpp

**Files:**
- Create: `src/server/whisper-engine.ts` (eksport przez `src/server/index.ts`)
- Test: `tests/whisper-engine.test.ts`

**Interfaces:**
- Produces:
  - `type SpawnLike = (cmd: string, args: string[], opts: { stdio: ["ignore", "pipe", "pipe"] }) => { pid?: number; kill(): boolean; on(ev: "exit", cb: (code: number | null) => void): unknown; stderr?: NodeJS.ReadableStream | null }`
  - `createWhisperEngine(o: { bin: string; modelPath: string; threads: number; spawnImpl: SpawnLike; fetchImpl: typeof fetch; freePort: () => Promise<number>; idleMs?: number /* 600_000 */; readyTimeoutMs?: number /* 60_000 */; modelExists: () => boolean }): WhisperEngine`
  - `interface WhisperEngine { ensure(): Promise<{ url: string }>; transcribe(wav: Uint8Array): Promise<string>; stop(): void; running(): boolean }` — `ensure` rzuca `new WhisperError("no-model")` gdy `!modelExists()`, `WhisperError("down")` gdy `/health` ≠ 200 w limicie lub proces wyszedł; `transcribe` = `ensure` + `POST {url}/inference` (FormData: `file` Blob `audio.wav` `audio/wav`, `response_format=json`, `temperature=0`) → `text.trim()`; błąd fetch/≠2xx → `WhisperError("down")` + `stop()`.
  - `class WhisperError extends Error { code: "no-model" | "down" }`
  - `whisperEngine(): WhisperEngine | null` — singleton z env: `LH_WHISPER_BIN` brak → `null`; model `<PATHS.data>/models/ggml-large-v3-turbo-q5_0.bin`; prawdziwy `spawn`, `fetch`, wolny port przez `net` (listen 0 na 127.0.0.1).
  - `MODEL_FILE = "ggml-large-v3-turbo-q5_0.bin"`, `modelPath(): string`

- [ ] **Step 1: Failing tests** (fałszywy `spawnImpl` zapisujący `cmd/args`, `fetchImpl` ze skryptem odpowiedzi, `freePort` → 5555):
  - `spawns with the pinned args`: args === `["--host","127.0.0.1","--port","5555","-m","/m/x.bin","-l","pl","-t","4"]`; `ensure()` → `{url:"http://127.0.0.1:5555"}` po tym, jak `/health` zwrócił 503, potem 200.
  - `paths with spaces and Polish letters stay one argument`: `bin = "C:\\Users\\Łukasz Nowak\\w\\whisper-server.exe"`, `modelPath` ze spacją → `cmd === bin`, `args[5] === modelPath`.
  - `concurrent ensure calls share one process`: `Promise.all([ensure(), ensure()])` → spawn wywołany 1×, oba URL równe.
  - `no model → no-model, nothing spawned`.
  - `health never ready → down and the process is killed` (`readyTimeoutMs: 50`).
  - `process exit → next ensure respawns` (wywołaj callback `exit`, potem `ensure()` → spawn 2×).
  - `idle → stopped` (`idleMs: 10`; po `transcribe` + 30 ms `running() === false`, `kill` wywołany).
  - `transcribe posts multipart and trims`: odpowiedź `/inference` `{text:" Ala ma kota. "}` → `"Ala ma kota."`; FormData ma `response_format=json`, `temperature=0`, `file` typu `audio/wav`.
  - `inference failure → down and stop`.
- [ ] **Step 2:** `bash scripts/test-isolated.sh tests/whisper-engine.test.ts` → FAIL.
- [ ] **Step 3:** Implementacja: jedna obietnica startu współdzielona przez równoległe `ensure`; sondowanie `/health` co 250 ms; timer bezczynności odświeżany w `transcribe`; stderr procesu dopisywany do `<PATHS.data>/whisper-server.log` (tylko w singletonie).
- [ ] **Step 4:** → PASS. **Step 5:** `git commit -m "feat(stt): managed whisper.cpp engine"`

### Task 5: Pobieranie modelu + `/api/stt/model`

**Files:**
- Create: `src/server/stt-model.ts` (eksport przez barrel), `app/api/stt/model/route.ts`
- Test: `tests/stt-model.test.ts`

**Interfaces:**
- Produces:
  - `type ModelStatus = { state: "missing" | "downloading" | "ready" | "error"; received: number; total: number; error?: string }`
  - `createModelDownloader(o: { url: string; sha256: string; size: number; dest: string; fetchImpl: typeof fetch }): { status(): ModelStatus; start(): boolean /* false gdy już pobiera */ }` — stan `ready` gdy `dest` istnieje; `start` pisze strumieniem do `dest + ".part"` (nadpisuje), liczy SHA-256 w locie, po zgodności `rename`; niezgodność → `error: "Suma kontrolna się nie zgadza"`, `.part` usunięty; HTTP ≠ 200 → `error: "Pobieranie nie powiodło się (HTTP <s>)"`; wyjątek → `error: <message>`, `.part` usunięty.
  - `modelDownloader()` singleton z wartościami z Global Constraints.
  - Route: `GET` → `ModelStatus`; `POST` → 202 `ModelStatus` lub 409 `{message:"already-downloading"}`.

- [ ] **Step 1: Failing tests** (katalog tymczasowy, `fetchImpl` z `ReadableStream` dwóch kawałków `[1,2,3]`,`[4,5]`, `sha256` z tych bajtów, `size: 5`):
  - `missing before, ready after with exact bytes` — po zakończeniu `status().state === "ready"`, `received === 5`, plik = `[1,2,3,4,5]`, brak `.part`.
  - `progress is reported while streaming` — po pierwszym kawałku (strumień wstrzymany na obietnicy) `state === "downloading"`, `received === 3`, `total === 5`.
  - `checksum mismatch → error and no file`.
  - `HTTP 404 → error with the status, no .part`.
  - `stale .part from a killed run is overwritten` — przed startem `dest.part` z 10 bajtami śmieci → wynik poprawny.
  - `second start while downloading → false`.
  - route: `POST` dwa razy → 202, 409.
- [ ] **Step 2:** → FAIL. **Step 3:** implementacja (`node:crypto` `createHash`, `fs.createWriteStream`). **Step 4:** → PASS.
- [ ] **Step 5:** `git commit -m "feat(stt): model download with checksum"`

### Task 6: `/api/stt/local` z backendem whisper.cpp

**Files:**
- Modify: `app/api/stt/local/route.ts`
- Test: `tests/stt-local-route.test.ts`

**Interfaces:**
- Consumes: `whisperEngine()`, `WhisperError` (Task 4), `pcmToWav` (Task 3), `modelDownloader()` (Task 5).
- Produces: `POST` — engine ≠ null: `pcmToWav(body.subarray(0, 19_200_000))` → `engine.transcribe` → 200 `{text}`; `WhisperError("no-model")` → 409 `{message:"stt-no-model"}`; `WhisperError("down")` → 503 `{message:"stt-down"}`; engine null → obecna ścieżka. `GET` — dodaje `backend: "whispercpp" | "python"` i `model: ModelStatus["state"]` (dla `python` zawsze `"ready"`).
- Testowalność: route czyta `whisperEngine()` i `modelDownloader()` z barrela; testy podmieniają je przez eksportowane `__setSttForTests({ engine, downloader })` w `src/server/whisper-engine.ts` (no-op poza `NODE_ENV=test`).

- [ ] **Step 1: Failing tests:** engine fake → `transcribe` dostaje WAV zaczynający się od `RIFF` i długości `44 + n`; 409 przy `no-model`; 503 przy `down`; `GET` → `{ok:true, backend:"whispercpp", model:"missing"}` przy braku modelu; bez engine → istniejące testy dalej zielone.
- [ ] **Step 2:** → FAIL. **Step 3:** implementacja. **Step 4:** → PASS.
- [ ] **Step 5:** `git commit -m "feat(stt): route local dictation to whisper.cpp in the desktop app"`

### Task 7: UI — pobieranie modelu i błąd braku modelu

**Files:**
- Modify: `components/settings/keys-section.tsx`, `components/dictation.tsx`
- Test: `tests/render-dictation-engine.test.tsx`, `tests/dictation-local.test.ts`

**Interfaces:**
- Consumes: `GET/POST /api/stt/model`, `GET /api/stt/local` (`backend`, `model`).
- Produces:
  - `LocalSttStatus` rozszerzony: `{ ok: boolean; device?: string | null; backend?: "whispercpp" | "python"; model?: "missing" | "downloading" | "ready" | "error" } | null`
  - `DictationEngineRow` nowe propsy: `download?: { received: number; total: number; error?: string } | null`, `onDownload?: () => void`. Gdy `status.backend === "whispercpp"`: `model === "missing"` → przycisk `data-testid="stt-model-download"` „Pobierz model (ok. 550 MB)”; `"downloading"` → `data-testid="stt-model-progress"` „Pobieranie: X / Y MB” (MB = bajty/1048576, zaokrąglone w dół); `"error"` → tekst błędu + przycisk „Spróbuj ponownie”; `"ready"` → dotychczasowa linia statusu.
  - `dictation.tsx`: `export const LOCAL_STT_NO_MODEL = "Pobierz model dyktowania w Ustawieniach"`; `transcribeLocal` 409 → `throw new Error(LOCAL_STT_NO_MODEL)`; `DictationBar` klik w błąd `LOCAL_STT_NO_MODEL` → `clearError(); openSettings("keys")`.
- Hook stanu w `KeysSection`: podczas `downloading` odpytywanie `GET /api/stt/model` co 1 s.

- [ ] **Step 1: Failing tests:** render czterech stanów (missing/downloading `received: 104857600, total: 574041195` → „Pobieranie: 100 / 547 MB”/error/ready); `transcribeLocal` z 409 → `LOCAL_STT_NO_MODEL`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementacja. **Step 4:** → PASS; `bash scripts/test-isolated.sh` cały zestaw.
- [ ] **Step 5:** `git commit -m "feat(settings): one-click dictation model download"`

### Task 8: Build whisper.cpp, Electron, CI

**Files:**
- Create: `scripts/build-whisper.sh`
- Modify: `electron/main.cjs` (env `LH_WHISPER_BIN`), `electron-builder.yml` (`extraResources`), `.gitignore` (`resources/whisper/`), `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `docs/desktop-release.md`
- Delete: `.github/workflows/notify-website.yml`

**Interfaces:**
- Produces: `scripts/build-whisper.sh [--cpu-only]` → `resources/whisper/whisper-server` (Linux) lub `resources/whisper/whisper-server.exe` (Windows) + biblioteki backendów ggml obok; pobiera źródła `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz` do `build/whisper-src` (gitignored); `--cpu-only` pomija `-DGGML_VULKAN=ON` (lokalny test w WSL bez `glslc`).
- `electron/main.cjs`: w `env` serwera `LH_WHISPER_BIN: path.join(process.resourcesPath, "whisper", process.platform === "win32" ? "whisper-server.exe" : "whisper-server")` gdy plik istnieje.
- `electron-builder.yml`: `extraResources: - from: resources/whisper  to: whisper`.

- [ ] **Step 1:** Lokalnie: `scripts/build-whisper.sh --cpu-only` → `resources/whisper/whisper-server --help` działa.
- [ ] **Step 2: E2E lokalnie (prawdziwy model):** `LH_WHISPER_BIN=$(pwd)/resources/whisper/whisper-server LH_DATA_DIR=<tmp> npx next start -p 3130` (po `npm run build`); `POST /api/stt/model` → odpytywanie `GET` do `ready` (sprawdza pobieranie + sumę z HF); próbka SAPI (Paulina) → `POST /api/stt/local` → tekst zawiera „pochodn” i „sinus”; zapisz czas.
- [ ] **Step 3:** `release.yml`: macierz bez `macos-26`; usunięte kroki mac (Xcode, sekrety, notaryzacja, „Unsigned macOS rehearsal”); przed `electron-builder` krok „Build whisper.cpp”: Windows — Vulkan SDK przez `jakoch/install-vulkan-sdk-action@v1` (wersja przypięta), Linux — `sudo apt-get install -y libvulkan-dev glslc`; potem `bash scripts/build-whisper.sh`; krok „Smoke whisper-server”: `resources/whisper/whisper-server --help` exit 0. `ci.yml`: bez macOS. Usuń `notify-website.yml`. `docs/desktop-release.md`: zaktualizowane tabele platform i assetów.
- [ ] **Step 4:** `bash scripts/test-isolated.sh tests/verify-release.test.ts`, `npx tsc --noEmit`, `npx eslint .` → czyste; `actionlint` jeśli dostępny, inaczej `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml`.
- [ ] **Step 5:** `git commit -m "build: bundle whisper.cpp (Vulkan + CPU) in Windows/Linux installers"`

### Task 9: Fork, próbne wydanie, wydanie 1.0.0

**Files:** brak zmian w kodzie poza poprawkami z prób.

- [ ] **Step 1:** `git status --short` czyste; `git ls-files | grep -E '^(data/|auth.json)'` → pusto.
- [ ] **Step 2:** `gh repo fork amosblomqvist/learnharness --fork-name learnharness-pl --clone=false`; `git remote rename origin upstream`; `git remote add origin git@github.com:UmarlyPoeta/learnharness-pl.git`; `git push origin feat/polski:main`; `gh repo edit UmarlyPoeta/learnharness-pl --description "LearnHarness PL — nieoficjalna polska wersja LearnHarness (agent do nauki, graf wiedzy, dyktowanie offline)" --enable-issues`; włącz Actions w forku (`gh api -X PUT repos/UmarlyPoeta/learnharness-pl/actions/permissions -F enabled=true`).
- [ ] **Step 3:** `gh workflow run release.yml --repo UmarlyPoeta/learnharness-pl --ref main`; `gh run watch` do końca → oba joby zielone; `gh run download` artefaktów.
- [ ] **Step 4: Test instalatora Windows:** skopiuj `LearnHarness-PL-1.0.0-x64-setup.exe` do `%TEMP%`, uruchom instalację per-user (`/S` cicho przez `powershell.exe Start-Process -Wait`), uruchom aplikację, przez jej lokalny port (z logu w `%APPDATA%\LearnHarness PL`) sprawdź: strona główna po polsku, `GET /api/stt/local` → `backend: "whispercpp"`; pobranie modelu i dyktowanie próbką SAPI jak w Task 8 Step 2. Odinstaluj po teście.
- [ ] **Step 5:** `git tag v1.0.0 && git push origin v1.0.0` → workflow tworzy szkic; `gh run watch` → job „Verify draft release” zielony.
- [ ] **Step 6:** Zgłoś użytkownikowi link do szkicu wydania — publikuje on sam („Publish release” na GitHubie).
