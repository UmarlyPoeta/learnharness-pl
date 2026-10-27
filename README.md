<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="LearnHarness PL" width="640">
  </picture>
</p>

<p align="center"><strong>LearnHarness PL — polska wersja LearnHarness: agent, który uczy.</strong></p>

<p align="center">
  <a href="https://github.com/UmarlyPoeta/learnharness-pl/releases/latest">Pobierz</a> ·
  <a href="#jak-to-działa">Jak to działa</a> ·
  <a href="#pochodzenie-i-licencja">Licencja</a> ·
  <a href="https://github.com/UmarlyPoeta/learnharness-pl/issues">Zgłoś problem</a>
</p>

> **Nieoficjalna polska wersja** aplikacji [LearnHarness](https://github.com/amosblomqvist/learnharness) autorstwa Amosa Blomqvista. Interfejs, nauczyciel i dyktowanie działają po polsku. To nie jest wydanie autora oryginału.

LearnHarness PL używa agentów AI, żeby zaplanować i poprowadzić naukę od tego, co już rozumiesz, do tego, co chcesz zrozumieć. Zamiast ściany tekstu dostajesz pytania, przewidywania i krótkie wyjaśnienia dopasowane do Twojego toku myślenia, a wszystko, czego się nauczysz, trafia do trwałego grafu wiedzy.

![Sesja nauki w LearnHarness](docs/assets/teaching-session.png)

## Pobierz

**[Najnowsze wydanie](https://github.com/UmarlyPoeta/learnharness-pl/releases/latest)**

- **Windows (x64):** pobierz `LearnHarness-PL-<wersja>-x64-setup.exe` i uruchom. Instalator nie jest podpisany, więc Windows może pokazać ostrzeżenie „System Windows ochronił ten komputer” — kliknij **Więcej informacji → Uruchom mimo to**. Instalacja nie wymaga uprawnień administratora.
- **Linux (x64):** pobierz `LearnHarness-PL-<wersja>-x86_64.AppImage`, nadaj mu prawo uruchamiania (w menedżerze plików: Właściwości → „Zezwól na uruchamianie”) i otwórz. Na Debianie/Ubuntu możesz też zainstalować `.deb`.

Aplikacja sama się aktualizuje — gdy wyjdzie nowa wersja, zobaczysz baner z przyciskiem „Uruchom ponownie”.

## Pierwsze kroki

1. Uruchom aplikację i dodaj klucz API dostawcy modeli. Najprościej przez [OpenRouter](https://openrouter.ai/keys) — jeden klucz daje dostęp do wszystkich modeli.
2. Wybierz modele dla trzech poziomów. Tani i sensowny zestaw:
   - **Mocny** (nauczyciel): `deepseek/deepseek-v4-pro`
   - **Tani** (research, dema, graf): `deepseek/deepseek-v4.1-flash`
   - **Wizyjny** (grafiki, PDF): `deepseek/deepseek-v4.1-flash`

   Jedna sesja nauki kosztuje wtedy około 10–15 centów. Do trudnych tematów możesz w trakcie sesji przełączyć model na `anthropic/claude-sonnet-5.5`.
3. Wpisz, czego chcesz się nauczyć — nauczyciel zacznie od sprawdzenia, co już wiesz.

## Jak to działa

1. **Diagnoza.** Zanim zacznie uczyć, agent sprawdza, gdzie kończy się Twoje zrozumienie każdej części tematu.
2. **Plan.** Układa mapę zależności od Twojego punktu startu do celu. Plan widzisz i zmienia się, gdy okaże się, że rozumiesz coś inaczej.
3. **Nauka.** Każdy krok opiera się na czymś, co już rozumiesz: przewidujesz, dostajesz wyjaśnienie, sprawdzasz zrozumienie. Nieporozumienia są naprawiane, zanim cokolwiek na nich zbuduje.
4. **Ćwiczenia.** Osobne sesje stawiają zróżnicowane zadania, w których trzeba samemu przypomnieć sobie właściwą wiedzę.

Pola „Twój tok myślenia” pozwalają opisać rozumowanie, wątpliwości i reakcje własnymi słowami — pisząc albo dyktując. Agent może też robić research w tle, rysować wyjaśnienia i budować interaktywne dema.

![Graf wiedzy LearnHarness](docs/assets/knowledge-graph.png)

## Dyktowanie po polsku

Dyktowanie działa lokalnie, na Twoim komputerze — bez wysyłania głosu do chmury i bez opłat. Za pierwszym razem wejdź w **Ustawienia → Dostawcy AI → Dyktowanie** i kliknij **Pobierz model (ok. 550 MB)**. Model `large-v3-turbo` ([whisper.cpp](https://github.com/ggml-org/whisper.cpp)) korzysta z karty graficznej przez Vulkan, a bez niej działa na procesorze (wolniej). Zamiast lokalnego silnika możesz wybrać Deepgram (wymaga klucza API).

## Twoje klucze, Twoje dane

- **Bez abonamentu.** Płacisz bezpośrednio dostawcy modeli za faktyczne użycie; licznik kosztów pokazuje wydatki na bieżąco.
- **Dane lokalnie.** Sesje, graf, ustawienia i klucze API zostają na Twoim komputerze, w zwykłych plikach.
- **Usługi zewnętrzne.** Modele działają u wybranego dostawcy, więc treść potrzebna do zadania jest do niego wysyłana. Research w sieci i Deepgram też łączą się z internetem; lokalne dyktowanie — nie.

## Rozwój

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # testy w izolowanym katalogu danych, bez sieci i bez LLM
```

Lokalne dyktowanie w trybie deweloperskim (serwer Pythona z faster-whisper):

```bash
scripts/stt-setup.sh   # venv w ~/.local/share/learnharness/stt-venv
scripts/learn-pl.sh    # buduje, uruchamia serwer STT i aplikację
```

Zmienne: `LH_STT_PORT`, `LH_STT_MODEL`, `LH_STT_IDLE_S`, `LH_STT_URL`. Instalatory budują się w GitHub Actions (`.github/workflows/release.yml`), opis w [docs/desktop-release.md](docs/desktop-release.md).

## Pochodzenie i licencja

LearnHarness PL to fork [LearnHarness](https://github.com/amosblomqvist/learnharness) autorstwa **Amosa Blomqvista**, udostępnianego na licencji [AGPL-3.0](LICENSE). Ta wersja jest objęta tą samą licencją; pełny kod źródłowy jest w tym repozytorium.

Zmiany względem oryginału:

- polski interfejs i polskie prompty nauczyciela, ćwiczeń i agentów pomocniczych (graf wiedzy, dema, grafiki),
- lokalne dyktowanie po polsku (whisper.cpp w instalatorze, faster-whisper w trybie deweloperskim) i poprawka języka dla Deepgrama,
- osobna tożsamość aplikacji (nazwa, ikona z plakietką „PL”, katalog danych, kanał aktualizacji),
- instalatory tylko dla Windows i Linux.
