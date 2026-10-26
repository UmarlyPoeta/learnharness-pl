# Lokalny Whisper do dyktowania — projekt

Data: 2026-10-26 · Status: zatwierdzony w rozmowie, czeka na przegląd specu

## Cel

Dyktowanie po polsku, które rozumie mowę (także terminy techniczne), działa
offline i za darmo, a w UI zachowuje się tak jak dzisiejsze dyktowanie
Deepgram (transkrypt odroczony: tekst wpada do pola raz, po zakończeniu
nagrania). Użytkownik wybiera silnik w ustawieniach: lokalny Whisper
(domyślny) albo Deepgram.

Zakres: jedna maszyna (WSL2, RTX 3060 12 GB), aplikacja uruchamiana przez
`learn` (`next start`). Wydanie desktopowe (Electron) i inne systemy są poza
zakresem — silnik lokalny ma tam po prostu zgłaszać „serwer niedostępny”.

## Ustalenia z rozmowy

- Silnik wybierany w ustawieniach, domyślnie lokalny (odpowiedź użytkownika).
- Podejście A: osobny serwer Pythona z faster-whisper (zatwierdzone; B —
  whisper.cpp, C — transformers.js w przeglądarce odrzucone).
- Deepgram dostaje `language=pl` (dziś URL nie ma języka → model angielski).

## Architektura

```
przeglądarka                         Next.js (learn)              serwer STT (Python)
pcm-capture worklet ──Int16 16 kHz──▶ bufor w useDictation
   stop ─────────── POST /api/stt/local (application/octet-stream) ──▶ POST /transcribe
                                                       ◀── {text} ◀──
   append(text) → pole pytania / composer (istniejąca ścieżka flush)
```

### 1. Serwer STT — `stt/server.py`

- Stdlib `http.server` (ThreadingHTTPServer) na `127.0.0.1:8765`
  (port z `LH_STT_PORT`). Bez zewnętrznego frameworka.
- `POST /transcribe`: ciało = surowe próbki PCM Int16 LE, 16 kHz, mono.
  Limit 10 min audio (19 200 000 bajtów) → 413. Puste ciało → `{"text": ""}`.
  Odpowiedź: `{"text": str, "seconds": float, "device": "cuda"|"cpu"}`.
- `GET /health`: `{"ok": true, "loaded": bool, "device": str|null, "model": str}`.
- Model: `large-v3-turbo` (`LH_STT_MODEL`), `language="pl"`, `beam_size=5`,
  `vad_filter=True`, `condition_on_previous_text=False`, bez `initial_prompt`
  (u Alberta powodował halucynacje na ciszy/muzyce).
- Ładowanie leniwe przy pierwszym żądaniu; zwolnienie po 10 min bez żądań
  (`LH_STT_IDLE_S`). Jedno żądanie naraz (lock) — GPU i tak szereguje.
- Urządzenie: najpierw `cuda` / `float16`; błąd ładowania lub CUDA OOM
  podczas transkrypcji → przeładowanie na `cpu` / `int8` i ponowienie
  tego samego żądania.
- Biblioteki CUDA: pakiety pip `nvidia-cublas-cu12` + `nvidia-cudnn-cu12`
  w venv; skrypt startowy dokłada ich katalogi `lib` do `LD_LIBRARY_PATH`
  (ten sam wzorzec co launcher Alberta).

### 2. Środowisko — `scripts/stt-setup.sh`

Tworzy `~/.local/share/learnharness/stt-venv` (python3 -m venv), instaluje
`faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12`. Idempotentny. Model
jest już w `~/.cache/huggingface` (pobrany dla Alberta) — bez ponownego
pobierania.

### 3. Uruchamianie — `scripts/learn-pl.sh`

Przed `next start`: jeśli venv istnieje, a `GET /health` nie odpowiada,
startuje serwer w tle (`nohup`, log `~/.cache/learnharness-stt.log`).
Brak venv → komunikat „dyktowanie lokalne: uruchom scripts/stt-setup.sh”,
aplikacja startuje normalnie.

### 4. Trasa Next — `app/api/stt/local/route.ts`

- `POST`: przekazuje ciało do `${LH_STT_URL ?? "http://127.0.0.1:8765"}/transcribe`,
  zwraca `{text}`. Serwer nieosiągalny → 503 `{message}`; błąd serwera → 502.
- `GET`: proxy do `/health`; nieosiągalny → `{ok: false}` (200), żeby UI
  mogło pokazać status bez wyjątku.

### 5. Ustawienia

- `src/core/settings.ts`: nowa sekcja `dictation?: { engine?: "local" | "deepgram" }`,
  rozwiązana domyślnie do `{ engine: "local" }`; sanitize odrzuca inne
  wartości (wzorzec `general`). Zapis przez istniejący
  `PUT /api/settings/[section]`: nowy parser `dictation` w `SETTINGS_SECTIONS`
  i `"dictation"` w unii sekcji `write()` w `settings-dialog.tsx`.
  Worklet już nagrywa w 16 kHz (`AudioContext({ sampleRate: 16000 })`),
  więc resampling nie jest potrzebny.
- `components/settings/keys-section.tsx`, grupa „Dyktowanie”: nad wierszem
  klucza Deepgram select „Silnik: Lokalny Whisper / Deepgram” + linia
  statusu z `GET /api/stt/local` („działa · cuda” / „nie działa — uruchom
  `learn`”). Wiersz klucza Deepgram zostaje bez zmian.

### 6. Dyktowanie — `components/dictation.tsx`

- Silnik czytany z ustawień przy starcie nagrania.
- Tryb `local`: bez tokenu i WebSocketu. Ramki z workletu dopisywane do
  tablicy (limit 10 min — po nim nagranie kończy się samo). `stop()`:
  mikrofon wyłącza się najpierw (jak dziś), faza `stopping` z napisem
  „przepisywanie…”, potem jedno `POST /api/stt/local` ze sklejonymi
  ramkami; tekst trafia do `bufferRef` i przez istniejące `cleanup()`/`flush()`.
  Ochrona generacją (`genRef`) jak w ścieżce Deepgram; `cancel()` porzuca
  wynik.
- Pomocnik czysty `concatFrames(frames: ArrayBuffer[]): Uint8Array`
  (eksportowany, testowany).
- Brak klucza Deepgram nie blokuje przycisku, gdy silnik = `local`
  (dzisiejsze `DICTATION_KEYLESS` dotyczy tylko Deepgrama).
- Deepgram: `&language=pl` w `DG_URL`.

## Błędy

| Sytuacja | Zachowanie |
|---|---|
| serwer STT nie działa | błąd w pasku: „Lokalny Whisper nie działa — uruchom learn”, nic nie wklejane |
| cisza / puste nagranie | `text: ""` → nic nie wklejane |
| CUDA OOM | serwer przechodzi na CPU i kończy żądanie (wolniej) |
| nagranie > 10 min | automatyczne zakończenie i transkrypcja zebranego audio |
| anulowanie (Esc) w trakcie przepisywania | wynik porzucony |

## Testy

- `tests/stt-local.test.ts`: trasa `POST`/`GET` z podstawionym `fetch`
  (sukces, 503, 502), `concatFrames`, sanitize sekcji `dictation`.
- Render ustawień: grupa Dyktowanie pokazuje select silnika.
- `stt/test_server.py` (unittest, bez GPU): parsowanie PCM, limit 413, puste
  ciało, `/health` — z podstawionym modelem.
- Ręcznie / skryptem: zdanie po polsku z Edge TTS → PCM 16 kHz →
  `/api/stt/local`, sprawdzenie treści i czasu (cel: < 1,5 s dla 10 s audio
  na GPU).

## Poza zakresem

Transkrypt na żywo, słownik/hotwords z kontekstu sesji, wydanie Electron,
wybór modelu w UI.
