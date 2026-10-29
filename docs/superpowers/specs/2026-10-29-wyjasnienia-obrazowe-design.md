# Wyjaśnienia obrazowe — projekt

Data: 2026-10-29 · Status: zatwierdzony w rozmowie, czeka na przegląd specu

Podprojekt B z 4 (kolejność: 1 od korzeni ✓ → **B wyjaśnienia obrazowe** →
A mapa przedmiotu → C przykłady/zadania/kod).

## Cel

Lekcja ma być graficzna: wyprowadzenia jako animacje krok po kroku w stylu
3Blue1Brown, parametry jako instrumenty, geometria jako rysunki — dobierane do
kroku, pokazywane w czacie sesji. Trudność tematu bez zmian.

## Diagnoza

- `demo` i `visual` istnieją, nie są wyłączone, a we wszystkich 5 sesjach
  (50+ quizów) nauczyciel (DeepSeek V4 Pro) nie wywołał ich ani razu —
  `teacher/50-demos.md` każe ich używać „jeśli pojęcie jest dynamiczne”.
- Brak formy „prowadzony pokaz”: `demo` to instrument do zabawy, nie
  wyprowadzenie zsynchronizowane z rozumowaniem.
- Slot „vision” (DeepSeek V4.1 Flash) przyjmuje obrazy (`input: text, image`
  w katalogu OpenRouter) — pętla „obejrzyj render” może działać.

## Ustalenia z rozmowy

- Forma: **D z naciskiem na A** — wszystkie trzy formy dobierane do kroku,
  nowością są animowane wyprowadzenia.
- Technologia: **HTML/JS**, pokazywane w czacie sesji jako karta (jak `demo`).
  Manim — ewentualnie później, osobny podprojekt.
- Kiedy: **C** — reguła „grafika na węzeł planu” + przycisk **„Pokaż”** na
  zaznaczonym fragmencie.
- Architektura: **nowe narzędzie `walkthrough` + wspólny silnik kroków**.

## 1. Silnik kroków i karta

**Podział:** karta w czacie (aplikacja) ma tytuł, **podpis bieżącego kroku**
(markdown + KaTeX, tym samym rendererem co lekcja), ◀ ▶, licznik „3/8”,
←/→ gdy karta ma fokus, „od początku”, powiększenie (duży widok jak przy
rysunkach). Iframe (sandbox jak `demo`) pokazuje tylko **scenę**. Komunikacja
istniejącym mostem `postMessage` (jak `demo-resize`): karta → `goto(n)`,
scena → gotowość/liczba kroków/błąd.

**API silnika** (wstrzykiwany do iframe; podagent pisze tylko skrypt sceny):

- `stage({ x: [xmin, xmax], y: [ymin, ymax] })` — scena w układzie
  matematycznym (SVG, proporcje z zakresów, oś y w górę).
- Obiekty z nazwą: punkt, odcinek, strzałka, wielokąt, krzywa `y = f(x)`
  (lub parametryczna), **siatka przekształcona funkcją** `(u, v) → (x, y)`,
  etykieta tekstowa (Unicode). Kolory z małej, stałej palety.
- Kroki jako **stany**: każdy krok = `caption` (jedno zdanie, markdown +
  `$…$`) + co pokazać / ukryć / jakie nowe wartości właściwości. Silnik
  interpoluje liczby, punkty i parametry funkcji; pojawianie/znikanie
  przez przenikanie. Cofanie zawsze działa (krok = stan).
- Walidacja w silniku: nieznana nazwa obiektu, NaN/∞, współrzędne daleko poza
  sceną, pusty podpis, liczba kroków spoza **3–12** → zgłaszany błąd.
- Poza zakresem v1: 3D, dowolny kod rysujący poza API, suwaki (to `demo`),
  wzory KaTeX na scenie (tylko w podpisie).

## 2. Narzędzie `walkthrough` i podagent

- Narzędzie nauczyciela `walkthrough`, asynchroniczne jak `demo` (ack →
  zadanie w tle → wiadomość z kartą). Wejście: `title`, `brief` (obiekty,
  współrzędne, zmiana i sens podpisu w każdym kroku — podagent nie widzi
  lekcji), opcjonalne `nodeId` (sekcja 3). Dołącza do narzędzi w tle
  (`JOB_TOOLS`, `TOGGLEABLE_TOOLS`, przełącznik w Ustawieniach, etykieta
  aktywności, karta zadania w doku).
- Podagent `walkthrough-builder` — slot modelu **vision**. Narzędzia:
  - `write_scene(script)`;
  - `run_scene` — przeglądarka bez okna ładuje silnik + skrypt, przechodzi
    **wszystkie** kroki, zwraca błędy JS i walidacji per krok oraz listę
    podpisów;
  - `look_step(n)` — zrzut ekranu kroku *n* (PNG) do obejrzenia.
- „Nic niesprawdzonego”: wynik tylko po czystym ostatnim `run_scene` **i**
  obejrzeniu co najmniej pierwszego, ostatniego i jednego środkowego kroku
  (egzekwowane w kodzie, nie tylko w prompcie). Inaczej wynik
  „FAILED: <powód>” → karta pokazuje porażkę, nauczyciel uczy prozą.
- Wynik: `{ title, html (silnik + skrypt, jeden plik), captions: string[],
  tested: true, notes }` — notes dla nauczyciela odwołują się do numerów
  kroków.
- `headless.ts`: nowa metoda — zrzut ekranu strony HTML po wykonaniu
  wyrażenia (np. przejście do kroku *n*); reszta istnieje (`runDemo`).
- Teksty widoczne dla ucznia po polsku.

## 3. Doktryna, przypomnienie, „Pokaż”

**`teacher/50-demos.md` (przepisany):**
- Dobór formy: etapy wyprowadzenia/procesu → `walkthrough`; zależność od
  parametru → `demo`; dokładna statyczna geometria → `visual`; relacje,
  przepływy → mermaid w tekście.
- **Każdy węzeł planu dostaje ≥ 1 grafikę** (`walkthrough` / `demo` /
  `visual`; mermaid się nie liczy), zamówioną **na początku węzła** z jego
  `nodeId`; w międzyczasie uczy dalej; po nadejściu uczy **z nią**,
  odwołując się do kroków/kontrolek.

**Przypomnienie mechaniczne:** `walkthrough`, `demo`, `visual` dostają
opcjonalne `nodeId` (walidowane jak w quizie). Gdy pytanie `check` dotyczy
węzła, dla którego w tej sesji nie zamówiono żadnej grafiki, wynik, który
model dostaje po odpowiedzi na to pytanie, zawiera dopisek: węzeł X nie ma
jeszcze grafiki — zamów ją. Bez blokowania.

**Przycisk „Pokaż”** obok „Dlaczego?” w tym samym pływającym pasku: wstawia
`Pokaż „<fragment>”?` do kompozytora; przy otwartym pytaniu — pominięcie
z notatką `Chcę zobaczyć: „<fragment>”` (jak wariant b), po pokazaniu
nauczyciel zadaje to sprawdzenie ponownie. Doktryna (`teacher/20-teaching.md`):
„Pokaż” = zamów najlepiej pasującą grafikę dla fragmentu (zwykle
`walkthrough`), zapowiedz, ucz dalej, a po nadejściu prowadź przez nią.
Pasek jest ukryty, gdy otwarte jest zadanie ćwiczeniowe (jak „Dlaczego?”).

## Testy

- Silnik: interpolacja stanów, walidacja (nieznane id, NaN, zakres, 3–12
  kroków, pusty podpis), `goto(n)` w obie strony daje ten sam stan co
  przejście sekwencyjne.
- Podagent (faux engine + fałszywy headless): ścieżka sukcesu; brak
  obejrzanych kroków → odmowa ukończenia; błąd w kroku → poprawka →
  ponowny test; porażka → `FAILED`.
- Narzędzie/zadanie: rejestracja w zestawach, przełącznik, `nodeId`
  walidowane.
- Karta: render podpisu z KaTeX, licznik, nawigacja ◀ ▶ (granice), porażka.
- Przypomnienie: check na węźle bez grafiki → dopisek; z grafiką → brak.
- „Pokaż”: tekst prośby, notatka pominięcia, pasek z dwoma przyciskami.
- Kompozycja promptów: nowe reguły obecne, stare „if the concept is
  DYNAMIC” jako jedyny warunek — usunięte.
- Ręcznie: sesja MES „jakobian odwzorowania elementu” — czy pojawia się
  `walkthrough` dla węzła, czy wygląda poprawnie, czy „Pokaż” działa.

## Ryzyka

- Jakość animacji zależy od taniego modelu vision — mitygacja: silnik
  z walidacją + obowiązkowe oglądanie kroków.
- Koszt i czas: każdy węzeł = zadanie w tle z kilkoma zrzutami ekranu.
- DeepSeek może nadal pomijać grafiki — przypomnienie mechaniczne to
  sprawdzi; ręczna próba potwierdzi.
- Konflikty z upstreamem w `50-demos.md`, rejestrach narzędzi i `chat.tsx`.
