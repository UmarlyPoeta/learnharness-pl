# Wydanie LearnHarness PL — projekt

Data: 2026-10-27 · Status: zatwierdzony w rozmowie, czeka na przegląd specu

## Cel

Publiczne repo `UmarlyPoeta/learnharness-pl` z instalatorami Windows i Linux,
które zwykły użytkownik pobiera z GitHub Releases i instaluje bez terminala.
Marka: „LearnHarness PL — nieoficjalna polska wersja LearnHarness”. Lokalne
dyktowanie po polsku działa w zainstalowanej aplikacji bez Pythona.

## Ustalenia z rozmowy

- Platformy: Windows x64 + Linux x64. Bez macOS (brak konta Apple Developer).
- Dyktowanie: whisper.cpp zbudowany w CI z Vulkanem (fallback CPU), model
  pobierany jednym kliknięciem w Ustawieniach.
- Marka i repo: „LearnHarness PL”, fork na GitHubie, ikona z plakietką „PL”.

## 1. Repo i tożsamość

- `gh repo fork amosblomqvist/learnharness --fork-name learnharness-pl`.
  Gałąź `feat/polski` → `main` forka (fast-forward: `feat/polski` jest tylko
  przed upstreamowym `main`). Lokalnie: remote `origin` = fork, `upstream` =
  oryginał (bez pushowania).
- `package.json`: `name: learnharness-pl`, `version: 1.0.0`,
  `homepage: https://github.com/UmarlyPoeta/learnharness-pl`, `description`
  po polsku, `desktopName: learnharness-pl.desktop`; `author` zostaje
  oryginalny, dochodzi `contributors: [UmarlyPoeta]`.
- `electron-builder.yml`: `appId: com.umarlypoeta.LearnHarnessPL`,
  `productName: LearnHarness PL`, `artifactName` z `LearnHarness-PL-…`
  (bez spacji), `publish.owner: UmarlyPoeta`, `publish.repo: learnharness-pl`,
  sekcje `mac`/`dmg` usunięte. Inne `appId` = osobny katalog danych
  (userData) — obie aplikacje mogą współistnieć.
- Ikona: `build/icon-flat.svg` + plakietka „PL” → `build/icon.ico`,
  `build/icon.png` przez `node scripts/make-icons.mjs`.
- `electron/main.cjs`: `PRODUCT_NAME = "LearnHarness PL"` (z niego liczony
  jest katalog userData — bez tej zmiany fork dzieliłby dane z oryginałem),
  menu aplikacji i okna dialogowe (np. „Check for Updates…”, „You're up to
  date.”) po polsku.
- Teksty widoczne dla użytkownika z nazwą „LearnHarness” (tytuł strony w
  `app/layout.tsx`, baner aktualizacji, okno) → „LearnHarness PL”.
- `README.md` po polsku: czym jest, pobieranie (linki do najnowszego
  wydania), ostrzeżenie SmartScreen („Więcej informacji → Uruchom mimo to”),
  pierwsze kroki (klucz OpenRouter, polecane tanie modele), dyktowanie
  lokalne, sekcja „Pochodzenie i licencja”: fork LearnHarness Amosa
  Blomqvista, AGPL-3.0, lista zmian względem oryginału. `LICENSE` bez zmian.
- `.github/ISSUE_TEMPLATE/*` i linki do Issues → repo forka.

## 2. Pipeline wydań

- `release.yml`: usunięte zadanie macOS i jego sekrety; zostają
  `windows-2025` i `ubuntu-24.04`. Każde OS przed `electron-builder` buduje
  whisper.cpp (sekcja 3) i kopiuje wynik do `resources/whisper/`.
- `notify-website.yml` usunięty. `ci.yml`: bez macOS.
- `scripts/verify-release.ts`: oczekuje dokładnie 6 assetów —
  `LearnHarness-PL-<v>-x64-setup.exe`, `…-x64-setup.exe.blockmap`,
  `LearnHarness-PL-<v>-x86_64.AppImage`, `LearnHarness-PL-<v>-amd64.deb`,
  `latest.yml`, `latest-linux.yml`.
- Ręczne uruchomienie workflow = próbne instalatory jako artefakty (7 dni).
  Tag `v<version>` = szkic wydania; publikuje użytkownik.
- Windows niepodpisany (`signExecutable: false`, jak w oryginale).

## 3. whisper.cpp w aplikacji

- Wersja przypięta: whisper.cpp `v1.9.5` (najnowsza w dniu specu).
- Build w CI: `cmake -B build -DGGML_VULKAN=ON -DGGML_BACKEND_DL=ON
  -DGGML_CPU_ALL_VARIANTS=ON -DGGML_NATIVE=OFF -DWHISPER_BUILD_SERVER=ON
  -DCMAKE_BUILD_TYPE=Release`. Windows: Vulkan SDK z LunarG w runnerze;
  Linux: `libvulkan-dev glslc`. Wynik: `whisper-server(.exe)` + biblioteki
  backendów ggml (CPU i Vulkan ładowane dynamicznie: brak GPU/sterownika →
  CPU).
- `electron-builder.yml` `extraResources`: `resources/whisper` → `whisper/`.
- `electron/main.cjs`: przy starcie serwera Next ustawia
  `LH_WHISPER_BIN=<resources>/whisper/whisper-server[.exe]`.
- `src/server/whisper-engine.ts` (nowy):
  - `ensureWhisper(): Promise<{ url: string }>` — startuje `whisper-server`
    na wolnym porcie `127.0.0.1` (`--host 127.0.0.1 --port <p> -m <model>
    -l pl -t <min(8, cpu)>`), czeka na `GET /health` = 200 (limit 60 s),
    jedna instancja naraz;
  - zamyka proces po 600 s bez żądań; awaria procesu → następne żądanie
    startuje go od nowa;
  - `modelPath()` = `<LH_DATA_DIR>/models/ggml-large-v3-turbo-q5_0.bin`.
- `/api/stt/local`: gdy `LH_WHISPER_BIN` ustawione — PCM → WAV (16 kHz,
  mono, 16-bit) → `POST <url>/inference` (multipart: `file`,
  `response_format=json`, `temperature=0`) → `{text}`; brak modelu → 409
  `{message: "stt-no-model"}`. Bez `LH_WHISPER_BIN` — bez zmian (proxy do
  serwera Pythona). `GET` zwraca też `{backend: "whispercpp" | "python",
  model: "missing" | "ready" | "downloading"}`.

## 4. Pobieranie modelu

- `POST /api/stt/model` — startuje pobieranie (jedno naraz; drugi POST →
  409), `GET /api/stt/model` — `{state: "missing"|"downloading"|"ready"|"error",
  received, total, error?}`.
- Źródło: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`,
  SHA-256 przypięty w kodzie (wyliczony z pliku w trakcie implementacji).
  Zapis do `<plik>.part`, sprawdzenie sumy, `rename` na miejsce; zła suma →
  `error`, `.part` usunięty.
- UI (`DictationEngineRow`): przy backendzie `whispercpp` i modelu
  `missing` — przycisk „Pobierz model (ok. 550 MB)”; w trakcie — pasek
  postępu (MB / MB); błąd — komunikat + „Spróbuj ponownie”.
- `transcribeLocal`: 409 `stt-no-model` → błąd `LOCAL_STT_NO_MODEL`
  („Pobierz model dyktowania w Ustawieniach”); `DictationBar` przy tym
  błędzie otwiera Ustawienia → Dostawcy AI (jak przy braku klucza Deepgram).

## 5. Porządki przed forkiem

- Commit izolacji testów (`scripts/test-isolated.sh`, `npm test`).
- 158 sesji-fixtur z `data/chats` i 118 jobów z `data/jobs` (żaden nie
  należy do prawdziwej sesji `chat_mvoijkuu_084b8e5e`) → przeniesione do
  `~/learnharness-test-fixtures-2026-10-26/`, nie kasowane.
- `data/` i `auth.json` są w `.gitignore` — sprawdzić przed pushem, że nic
  z nich nie trafia do repo.

## Błędy

| Sytuacja | Zachowanie |
|---|---|
| brak modelu przy dyktowaniu | „Pobierz model dyktowania w Ustawieniach”, klik → Ustawienia |
| `whisper-server` nie wstaje w 60 s | 503 → „Lokalny Whisper nie działa” (log w katalogu danych) |
| brak Vulkan / GPU | whisper.cpp na CPU (wolniej, działa) |
| przerwane pobieranie / zła suma | stan `error`, plik `.part` usunięty, „Spróbuj ponownie” |
| brak sieci przy pobieraniu | `error` z komunikatem |

## Testy

- `tests/wav.test.ts`: nagłówek WAV (RIFF, 16 kHz, mono, 16-bit, rozmiary).
- `tests/whisper-engine.test.ts`: podstawiony `spawn` + `fetch` — start na
  wolnym porcie, czekanie na `/health`, jedna instancja przy równoległych
  żądaniach, zamknięcie po bezczynności, restart po awarii, 409 bez modelu.
- `tests/stt-model.test.ts`: podstawiony `fetch` ze strumieniem — postęp,
  zła suma → `error` i brak pliku, sukces → `rename`, drugi POST → 409.
- `tests/stt-local-route.test.ts`: gałąź `whispercpp` (multipart do
  `/inference`).
- Render: przycisk pobierania, pasek postępu, błąd.
- CI: ręczne uruchomienie `release.yml` → próbne instalatory; ręcznie:
  instalacja Windows (per-user, bez admina), pobranie modelu, dyktowanie
  próbką SAPI przez `/api/stt/local` zainstalowanej aplikacji.

## Poza zakresem

macOS, podpisywanie kodu, strona WWW, automatyczna synchronizacja z
upstreamem, wybór modelu w UI.
